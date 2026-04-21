import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import * as pty from 'node-pty';

export interface AgentMessage {
  type: 'output' | 'tool_call' | 'tool_result' | 'approval_request' | 'error' | 'done' | 'plan' | 'plan_step' | 'terminal_output';
  content: string;
  toolName?: string;
  toolInput?: string;
  oldContent?: string;
  newContent?: string;
  id?: string;
  steps?: string[];
  index?: number;
  status?: string;
}

export interface AgentOptions {
  webSearch?: boolean;
  tavilyApiKey?: string;
  maxTurns?: number;
  agentName?: string;
  skills?: string[];
  resumeThreadId?: string;
  shellPresets?: string[];
  startupCmd?: string;
  mcpConfig?: Record<string, unknown>;
}

export class DeepAgentRunner extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private workspacePath: string;
  private planMode = false;
  private planBuffer = '';
  private webSearchEnabled = false;
  private toolCallBuffer = '';
  private toolCallName = '';
  private inToolCall = false;

  constructor(workspacePath: string) {
    super();
    this.workspacePath = workspacePath;
  }

  get isRunning(): boolean {
    return this.ptyProcess !== null;
  }

  start(prompt: string, model: string, _autoApprove: boolean, planMode = false, opts: AgentOptions = {}): void {
    if (this.isRunning) this.stop();

    this.shownWarnings.clear();
    this.inTraceback = false;
    this.planMode = planMode;
    this.planBuffer = '';
    this.webSearchEnabled = opts.webSearch ?? false;
    this.toolCallBuffer = '';
    this.toolCallName = '';
    this.inToolCall = false;

    const config = vscode.workspace.getConfiguration('ollamaDeepAgent');
    const deepagentsPath = config.get<string>('deepagentsPath', 'deepagents');
    const ollamaBaseUrl = config.get<string>('ollamaBaseUrl', 'http://localhost:11434');

    const args: string[] = ['-M', `ollama:${model}`];

    if (_autoApprove) args.push('-y');
    if (opts.agentName) args.push('-a', opts.agentName);
    if (opts.resumeThreadId) args.push('-r', opts.resumeThreadId);
    if (opts.maxTurns && opts.maxTurns > 0) args.push('--max-turns', String(opts.maxTurns));
    if (opts.skills) { for (const s of opts.skills) args.push('--skill', s); }
    if (opts.startupCmd) args.push('--startup-cmd', opts.startupCmd);

    // Shell allow-list: combine presets + web search
    const allowSet = new Set(opts.shellPresets?.filter(p => p !== 'curl') ?? []);
    if (opts.webSearch) allowSet.add('curl');
    if (allowSet.has('all')) {
      args.push('--shell-allow-list', 'all');
    } else if (allowSet.size > 0) {
      args.push('--shell-allow-list', [...allowSet].join(','));
    }

    // MCP config — write temp JSON file
    if (opts.mcpConfig) {
      const os = require('os') as typeof import('os');
      const tmpMcp = os.tmpdir() + '/deepagent-mcp.json';
      require('fs').writeFileSync(tmpMcp, JSON.stringify(opts.mcpConfig));
      args.push('--mcp-config', tmpMcp);
    }

    args.push('-n', prompt);

    this.debug(`Spawning PTY: ${deepagentsPath} ${args.join(' ')}`);

    try {
      this.ptyProcess = pty.spawn(deepagentsPath, args, {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: this.workspacePath,
        env: {
          ...process.env as { [key: string]: string },
          OLLAMA_HOST: ollamaBaseUrl,
          NO_COLOR: '1',
          TERM: 'xterm-color',
          ...(opts.webSearch && opts.tavilyApiKey ? { TAVILY_API_KEY: opts.tavilyApiKey } : {}),
        },
      });
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      let msg = `Failed to spawn deepagents: ${e.message}`;
      if (e.code === 'ENOENT') msg = `"deepagents" not found.\n\nInstall:\n  uv tool install 'deepagents-cli[ollama]'`;
      this.emit('message', { type: 'error', content: msg } as AgentMessage);
      return;
    }

    this.debug(`PTY PID: ${this.ptyProcess.pid}`);
    let buffer = '';

    this.ptyProcess.onData((data: string) => {
      this.debug(`[PTY data] ${JSON.stringify(data)}`);

      const clean = data
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b[()][AB012]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

      buffer += clean;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (this.isNoise(trimmed)) continue;
        this.processLine(trimmed);
      }
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.debug(`PTY exited — code: ${exitCode}, signal: ${signal}`);
      const remaining = buffer.trim();
      if (remaining) {
        if (this.isNoise(remaining)) {
          // skip
        } else {
          this.processLine(remaining);
        }
        buffer = '';
      }
      // If plan mode and we got a plan buffer, try to parse it
      if (this.planMode && this.planBuffer) {
        this.tryParsePlan(this.planBuffer);
        this.planBuffer = '';
      }
      this.emit('message', { type: 'done', content: '' } as AgentMessage);
      this.ptyProcess = null;
    });
  }

  sendInput(text: string): void { this.ptyProcess?.write(text + '\r'); }
  approveToolCall(_id: string): void { this.sendInput('y'); }
  denyToolCall(_id: string): void { this.sendInput('n'); }

  stop(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
  }

  private processLine(line: string): void {
    // Approval prompt detection
    if (/\[y\/n\]|Proceed\?|Allow.*\?/i.test(line)) {
      this.emit('message', { type: 'approval_request', content: line, id: `appr_${Date.now()}` } as AgentMessage);
      return;
    }

    // Tool call detection — buffer multi-line JSON args
    const toolMatch = line.match(/(?:🔧\s*)?Calling tool:\s*(\S+)\s*(.*)/);
    if (toolMatch) {
      this.toolCallName = toolMatch[1];
      const rest = toolMatch[2].trim();
      this.toolCallBuffer = rest.startsWith('{') ? rest : '';
      this.inToolCall = rest.startsWith('{');
      if (this.inToolCall) { this.tryFlushToolCall(); return; }
      this.emit('message', { type: 'tool_call', toolName: this.toolCallName, content: line } as AgentMessage);
      return;
    }

    // Continue buffering multi-line JSON tool args
    if (this.inToolCall) {
      this.toolCallBuffer += '\n' + line;
      this.tryFlushToolCall();
      return;
    }

    // In plan mode, accumulate numbered lines
    if (this.planMode) {
      this.planBuffer += line + '\n';
      return;
    }

    // Terminal output detection
    if (/^(PASSED|FAILED|ERROR|npm (ERR|WARN)|✓|✗|\d+ (passed|failed)|\$ )/.test(line)) {
      this.emit('message', { type: 'terminal_output', content: line } as AgentMessage);
      return;
    }

    this.emit('message', { type: 'output', content: line } as AgentMessage);
  }

  private tryFlushToolCall(): void {
    try {
      JSON.parse(this.toolCallBuffer);
      this.emit('message', {
        type: 'tool_call',
        toolName: this.toolCallName,
        toolInput: this.toolCallBuffer,
        content: `Calling tool: ${this.toolCallName} ${this.toolCallBuffer}`,
      } as AgentMessage);
      this.toolCallBuffer = '';
      this.toolCallName = '';
      this.inToolCall = false;
    } catch { /* keep buffering */ }
  }

  private tryExtractPlanSteps(text: string): string[] | null {
    // Match numbered lines: "1. step", "1) step", "Step 1: step"
    const lines = text.split('\n');
    const steps: string[] = [];
    for (const line of lines) {
      const m = line.match(/^\s*(?:step\s*)?\d+[.):\-]\s*(.+)/i);
      if (m && m[1].trim().length > 3) {
        steps.push(m[1].trim());
      }
    }
    return steps.length >= 2 ? steps : null;
  }

  private tryParsePlan(text: string): void {
    const steps = this.tryExtractPlanSteps(text);
    if (steps) {
      this.emit('message', { type: 'plan', steps, content: '' } as AgentMessage);
    } else {
      this.emit('message', { type: 'output', content: text } as AgentMessage);
    }
  }

  private shownWarnings = new Set<string>();

  private inTraceback = false;

  private isNoise(line: string): boolean {
    // Spinner frames
    if (/^[⠁⠂⠄⠈⠐⠠⡀⢀⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠛⠟⠯⠷⠾⠽⠻⠺⠲⠱⠉⠃⠅⠆⠌⠍⠎⠑⠒⠓⠔⠕⠖⠗⠚⠜⠝⠞]\s/.test(line)) return true;
    // CLI metadata
    if (/^(CLI:|Running task non-interactively|Starting LangGraph server|✓ Server ready|✓ Task completed)/.test(line)) return true;
    if (/^(Agent active\s|Thread:|Model\s+Reqs\s+InputTok|Usage Stats)/.test(line)) return true;
    if (/\d+\s+\d+\.?\d*[KM]?\s+\d+/.test(line)) return true;
    // Warning boilerplate
    if (/^(Install:|To suppress,|suppress\s*=|\[warnings\])/.test(line)) return true;
    if (/edit ~\/.deepagents\/config\.toml/.test(line)) return true;
    if (/ripgrep/.test(line)) return true;
    if (/TAVILY_API_KEY|tavily|Get a key at/.test(line) && !this.webSearchEnabled) return true;
    if (/^Warning:/.test(line)) {
      if (this.shownWarnings.has(line)) return true;
      this.shownWarnings.add(line);
      return false;
    }
    // Python traceback — suppress raw stack, show clean error instead
    if (/^Traceback \(most recent call last\)/.test(line)) {
      this.inTraceback = true;
      return true;
    }
    if (this.inTraceback) {
      // End of traceback is the final exception line
      if (/^[A-Za-z].*Exception|^[A-Za-z].*Error/.test(line)) {
        this.inTraceback = false;
        // Emit a clean error message
        const remoteMatch = line.match(/'message':\s*'([^']+)'/);
        const cleanMsg = remoteMatch
          ? `Cloud model error: ${remoteMatch[1]}. Try a different model or retry.`
          : line;
        this.emit('message', { type: 'error', content: cleanMsg } as AgentMessage);
      }
      return true; // suppress all traceback lines
    }
    // Suppress "Unexpected error (RemoteException): ..." duplicate line
    if (/^Unexpected error/.test(line)) return true;
    return false;
  }

  private debug(msg: string): void {
    this.emit('debug', `[DeepAgent] ${msg}`);
  }
}
