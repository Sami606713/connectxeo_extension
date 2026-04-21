# Ollama Deep Agent — VS Code Extension

A local AI coding agent powered by **Deep Agents CLI** and **Ollama** open-source models. Works 100% offline, no API keys required.

## Features

- 🤖 Chat sidebar panel (like Claude Code / Codex)
- 🧠 All Ollama models: Llama, Qwen, DeepSeek, Mistral, Gemma, Phi, CodeLlama, etc.
- 🔧 Agent tools: file read/write/edit, shell execution, web search
- ✅ Tool approval controls (approve/deny before execution)
- 🔄 Live model switching from dropdown
- 💾 Persistent memory across sessions (via deepagents)
- ⌨️ Keyboard shortcut: `Ctrl+Shift+O`

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
code --install-extension ollama-deep-agent-0.1.0.vsix
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

## Architecture

```
VS Code Extension (TypeScript)
├── extension.ts          — Commands & activation
├── panel/
│   ├── ChatPanel.ts      — WebviewViewProvider + message bridge
│   └── webview/
│       └── index.html    — Full chat UI (vanilla HTML/CSS/JS)
└── agent/
    ├── DeepAgentRunner.ts — Spawns deepagents CLI, streams output
    └── OllamaModels.ts   — Queries Ollama /api/tags for models
```

**Flow:** User types → ChatPanel → DeepAgentRunner spawns `deepagents --model ollama:<model>` → streams JSON events back → ChatPanel renders in WebView.
