import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DeepAgentRunner, AgentMessage, AgentOptions } from '../agent/DeepAgentRunner';
import { OllamaModels } from '../agent/OllamaModels';
import { PlanEditor } from './PlanEditor';
import { SessionManager } from '../agent/SessionManager';

export class ChatPanel {
  private panel: vscode.WebviewPanel | undefined;
  private runner: DeepAgentRunner | undefined;
  private currentModel: string;
  private currentMode: 'fast' | 'plan' = 'fast';
  private context: vscode.ExtensionContext;
  private outputChannel: vscode.OutputChannel;
  private lastTaskPrompt = '';
  private fileSnapshotCache = new Map<string, string>();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.outputChannel = vscode.window.createOutputChannel('Deep Agent');
    const config = vscode.workspace.getConfiguration('ollamaDeepAgent');
    this.currentModel = config.get<string>('defaultModel', 'qwen2.5-coder:7b');
  }

  show(): void {
    if (this.panel) { this.panel.reveal(vscode.ViewColumn.Beside); return; }

    this.panel = vscode.window.createWebviewPanel(
      'ollamaDeepAgent', 'Deep Agent',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'src', 'panel', 'webview'),
        ],
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage(msg => this.handleWebviewMessage(msg));
    this.panel.onDidDispose(() => { this.runner?.stop(); this.panel = undefined; });
    this.initPanel();
  }

  setModel(model: string): void {
    this.currentModel = model;
    this.postMessage({ type: 'model_changed', model });
  }

  newSession(): void {
    this.runner?.stop();
    this.runner = undefined;
    this.postMessage({ type: 'session_cleared' });
  }

  stopAgent(): void {
    this.runner?.stop();
    this.postMessage({ type: 'agent_stopped' });
  }

  private async initPanel(): Promise<void> {
    const config = vscode.workspace.getConfiguration('ollamaDeepAgent');
    const baseUrl = config.get<string>('ollamaBaseUrl', 'http://localhost:11434');

    // Check if deepagents is installed
    const needsSetup = !await this.checkDeepagentsInstalled();
    this.postMessage({ type: 'init', model: this.currentModel, mode: this.currentMode, needsSetup });

    const tavilyApiKey = config.get<string>('tavilyApiKey', '');
    this.postMessage({ type: 'init_tavily', tavilyApiKey });

    const running = await OllamaModels.isRunning(baseUrl);
    if (!running) {
      this.postMessage({ type: 'ollama_status', status: 'offline', message: `Ollama not reachable at ${baseUrl}` });
      return;
    }
    const models = await OllamaModels.fetchAvailable(baseUrl);
    this.postMessage({ type: 'ollama_status', status: 'online', models });
  }

  private async handleWebviewMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'send_message': {
        const opts = (msg.opts as AgentOptions) ?? {};
        // Merge saved Tavily key from settings if user hasn't typed one in the panel
        const config2 = vscode.workspace.getConfiguration('ollamaDeepAgent');
        const savedKey = config2.get<string>('tavilyApiKey', '');
        if (opts.webSearch && !opts.tavilyApiKey && savedKey) {
          opts.tavilyApiKey = savedKey;
        }
        await this.runAgent(msg.text as string, msg.mode as 'fast' | 'plan', opts);
        break;
      }
      case 'approve_plan':
        await this.executePlan(msg.steps as string[]);
        break;
      case 'stop':
        this.runner?.stop();
        break;
      case 'new_session':
        this.newSession();
        break;
      case 'set_mode':
        this.currentMode = msg.mode as 'fast' | 'plan';
        break;
      case 'set_model':
        this.currentModel = msg.model as string;
        await vscode.workspace.getConfiguration('ollamaDeepAgent')
          .update('defaultModel', this.currentModel, vscode.ConfigurationTarget.Global);
        break;
      case 'refresh_models': {
        const config = vscode.workspace.getConfiguration('ollamaDeepAgent');
        const baseUrl = config.get<string>('ollamaBaseUrl', 'http://localhost:11434');
        const models = await OllamaModels.fetchAvailable(baseUrl);
        this.postMessage({ type: 'ollama_status', status: 'online', models });
        break;
      }
      case 'select_model':
        vscode.commands.executeCommand('ollamaDeepAgent.selectModel');
        break;
      case 'save_tavily_key':
        await vscode.workspace.getConfiguration('ollamaDeepAgent')
          .update('tavilyApiKey', msg.key as string, vscode.ConfigurationTarget.Global);
        break;
      case 'approve_tool':
        this.runner?.approveToolCall(msg.id as string);
        break;
      case 'deny_tool':
        this.runner?.denyToolCall(msg.id as string);
        break;
      case 'list_threads': {
        const cfg = vscode.workspace.getConfiguration('ollamaDeepAgent');
        const bin = cfg.get<string>('deepagentsPath', 'deepagents');
        const threads = await SessionManager.listThreads(bin);
        this.postMessage({ type: 'threads_list', threads });
        break;
      }
      case 'pick_context_files': {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: true,
          canSelectFolders: false,
          openLabel: 'Add to Context',
          defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        });
        if (!uris?.length) break;
        const files = await Promise.all(uris.map(async u => ({
          path: vscode.workspace.asRelativePath(u),
          content: Buffer.from(await vscode.workspace.fs.readFile(u)).toString(),
        })));
        this.postMessage({ type: 'context_files_added', files });
        break;
      }
      case 'open_plan_md': {
        const tmpPath = require('os').tmpdir() + '/deepagent-plan.md';
        fs.writeFileSync(tmpPath, msg.content as string, 'utf8');
        vscode.window.showTextDocument(vscode.Uri.file(tmpPath), { preview: false });
        break;
      }
      case 'open_file': {
        const filePath = msg.path as string;
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspacePath, filePath);
        if (fs.existsSync(absPath)) {
          vscode.window.showTextDocument(vscode.Uri.file(absPath));
        }
        break;
      }
      case 'add_selection_to_context': {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const selection = editor.selection;
          const code = editor.document.getText(selection);
          const fileName = path.basename(editor.document.fileName);
          this.sendSelectedCode(fileName, code);
        }
        break;
      }
    }
  }

  sendSelectedCode(fileName: string, code: string): void {
    this.postMessage({ type: 'selected_code', fileName, code });
  }

  private async checkDeepagentsInstalled(): Promise<boolean> {
    return new Promise(resolve => {
      const { exec } = require('child_process');
      exec('deepagents --version', (err: unknown) => resolve(!err));
    });
  }

  private snapshotWorkspaceFiles(): void {
    const wp = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    this.fileSnapshotCache.clear();
    for (const doc of vscode.workspace.textDocuments) {
      if (!doc.isUntitled && doc.uri.fsPath.startsWith(wp)) {
        this.fileSnapshotCache.set(doc.uri.fsPath, doc.getText());
      }
    }
  }

  private getOrCreateRunner(): DeepAgentRunner {
    if (!this.runner) {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      this.runner = new DeepAgentRunner(workspacePath);
      this.runner.on('message', (msg: AgentMessage) => {
        this.outputChannel.appendLine(`[MSG] ${msg.type} ${JSON.stringify(msg.content?.slice(0, 80))}`);

        // Intercept plan messages — open in VS Code editor instead of chatbox
        if (msg.type === 'plan' && msg.steps && this.currentMode === 'plan') {
          this.postMessage({ type: 'agent_message', message: { type: 'plan_opening', content: '' } });
          PlanEditor.show(msg.steps, this.lastTaskPrompt, (action, steps, feedback) => {
            if (action === 'approve') {
              this.executePlan(steps);
            } else {
              const revisePrompt = feedback
                ? `Revise this plan based on feedback.\nOriginal task: "${this.lastTaskPrompt}"\nFeedback: ${feedback}\nCurrent steps:\n${steps.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\nOutput a revised numbered plan only.`
                : `Create a numbered plan for: "${this.lastTaskPrompt}"`;
              const config = vscode.workspace.getConfiguration('ollamaDeepAgent');
              this.getOrCreateRunner().start(revisePrompt, this.currentModel, config.get('autoApproveTools', false), true);
            }
          });
          return;
        }

        // Enrich tool_call messages with old/new file content for diff display
        if (msg.type === 'tool_call' && msg.toolInput) {
          try {
            const args = JSON.parse(msg.toolInput);
            const filePath: string = args.path ?? args.file_path ?? '';
            if (filePath) {
              const absPath = path.isAbsolute(filePath)
                ? filePath
                : path.join(workspacePath, filePath);
              const oldContent = this.fileSnapshotCache.get(absPath) ?? '';
              const newContent: string = args.content ?? args.new_content ?? '';
              this.postMessage({
                type: 'agent_message',
                message: { ...msg, oldContent, newContent },
              });
              return;
            }
          } catch { /* fall through to generic postMessage */ }
        }

        this.postMessage({ type: 'agent_message', message: msg });
      });
      this.runner.on('debug', (line: string) => this.outputChannel.appendLine(line));
    }
    return this.runner;
  }

  private async runAgent(prompt: string, mode: 'fast' | 'plan' = 'fast', opts: AgentOptions = {}): Promise<void> {
    const config = vscode.workspace.getConfiguration('ollamaDeepAgent');
    const autoApprove = config.get<boolean>('autoApproveTools', false);
    const runner = this.getOrCreateRunner();
    this.snapshotWorkspaceFiles();
    this.postMessage({ type: 'agent_thinking' });

    this.lastTaskPrompt = prompt;

    if (mode === 'plan') {
      const planPrompt =
        `Create a numbered plan for this task (do NOT execute yet, just plan):\n"${prompt}"\n\n` +
        `List each step on its own line as:\n1. step one\n2. step two\netc.\nMax 8 steps, keep each under 80 chars.`;
      runner.start(planPrompt, this.currentModel, autoApprove, true, opts);
    } else {
      runner.start(prompt, this.currentModel, autoApprove, false, opts);
    }
  }

  private async executePlan(steps: string[], opts: AgentOptions = {}): Promise<void> {
    const config = vscode.workspace.getConfiguration('ollamaDeepAgent');
    const autoApprove = config.get<boolean>('autoApproveTools', false);
    const runner = this.getOrCreateRunner();
    this.snapshotWorkspaceFiles();
    this.postMessage({ type: 'agent_thinking' });

    const executionPrompt =
      `Execute these tasks in order:\n` +
      steps.map((s, i) => `${i + 1}. ${s}`).join('\n');

    runner.start(executionPrompt, this.currentModel, autoApprove, false, opts);
  }

  private postMessage(msg: Record<string, unknown>): void {
    this.panel?.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(this.context.extensionPath, 'src', 'panel', 'webview', 'index.html');
    if (fs.existsSync(htmlPath)) {
      let html = fs.readFileSync(htmlPath, 'utf8');
      const base = webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'src', 'panel', 'webview')
      );
      html = html.replace(/src="(?!http)([^"]+)"/g, `src="${base}/$1"`);
      html = html.replace(/href="(?!http)([^"]+\.css)"/g, `href="${base}/$1"`);
      return html;
    }
    return `<!DOCTYPE html><html><body><p>Loading...</p></body></html>`;
  }
}
