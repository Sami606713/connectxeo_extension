# Deep Agent — VS Code Extension

A local AI coding agent powered by **LangChain Deep Agents CLI** and **Ollama** open-source models. Works 100% offline, no API keys required.

**🎁 This project is open source and free to use under the MIT License.**

## Features

- 🤖 Chat sidebar panel (like Claude Code / Codex)
- 🧠 All Ollama models: Llama, Qwen, DeepSeek, Mistral, Gemma, Phi, CodeLlama, etc.
- 🔧 Agent tools: file read/write/edit, shell execution, web search
- ✅ Tool approval controls (approve/deny before execution)
- 🔄 Live model switching from dropdown
- 💾 Persistent memory across sessions (via deepagents)
- ⌨️ Keyboard shortcut: `Ctrl+Shift+O`
- 📝 Context menu integration for selected text

## Setup

### 1. Install Ollama
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Run setup script
```bash
./scripts/setup.sh
```
This installs `deepagents-cli` with Ollama support, writes config, and pulls a starter model.

### 3. Install the extension
```bash
npm install
npm run compile
# Then press F5 in VS Code to launch Extension Development Host
```

Or package it:
```bash
npm install -g @vscode/vsce
vsce package
code --install-extension deep-agent-0.1.0.vsix
```

## Supported Models (via Ollama)

| Category | Models |
|---|---|
| **Coding** | `qwen2.5-coder`, `deepseek-coder`, `codestral`, `starcoder2` |
| **Reasoning** | `deepseek-r1`, `qwq`, `qwen3` |
| **General** | `llama3.3`, `mistral`, `gemma3`, `phi4` |
| **Lightweight** | `llama3.2:3b`, `phi3:3.8b`, `qwen2.5-coder:3b` |

Pull any model: `ollama pull <model-name>`

## Configuration

| Setting | Default | Description |
|---|---|---|
| `ollamaDeepAgent.ollamaBaseUrl` | `http://localhost:11434` | Ollama API URL |
| `ollamaDeepAgent.defaultModel` | `qwen2.5-coder:7b` | Default model |
| `ollamaDeepAgent.deepagentsPath` | `deepagents` | Path to CLI binary |
| `ollamaDeepAgent.autoApproveTools` | `false` | Skip tool approval prompts |
| `ollamaDeepAgent.tavilyApiKey` | `""` | Tavily API key for web search |

## Project Structure

```
deep-agent/
├── src/
│   ├── extension.ts          — Extension entry point & commands
│   ├── agent/
│   │   ├── DeepAgentRunner.ts — Spawns deepagents CLI, streams output
│   │   ├── OllamaModels.ts    — Queries Ollama /api/tags for models
│   │   └── SessionManager.ts  — Session persistence & management
│   └── panel/
│       ├── ChatPanel.ts      — WebviewViewProvider + message bridge
│       ├── PlanEditor.ts     — Plan editing functionality
│       └── webview/
│           └── index.html    — Full chat UI (vanilla HTML/CSS/JS)
├── scripts/
│   └── setup.sh              — Installation & configuration script
├── out/                      — Compiled TypeScript output
├── package.json              — Extension manifest & dependencies
└── tsconfig.json             — TypeScript configuration
```

## Commands

| Command | Description |
|---|---|
| `Deep Agent: Open Chat` | Open the chat sidebar panel |
| `Deep Agent: New Session` | Start a fresh conversation |
| `Deep Agent: Stop Agent` | Stop the running agent |
| `Deep Agent: Select Model` | Choose from available Ollama models |
| `Deep Agent: Ask About Selection` | Ask about selected code (context menu) |

## How It Works

User types → ChatPanel → DeepAgentRunner spawns `deepagents --model ollama:<model>` → streams JSON events back → ChatPanel renders in WebView.

## Acknowledgments

This project builds upon:

- **[LangChain Deep Agents](https://github.com/langchain-ai/deep-agents)** - Agent framework for AI-powered coding assistants
- **[Ollama](https://ollama.com/)** - Run large language models locally
- **[VS Code Extension API](https://code.visualstudio.com/api)** - Extension development framework

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

Feel free to use, modify, and distribute this software. Contributions are welcome!
