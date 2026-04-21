import * as vscode from 'vscode';
import * as path from 'path';
import { ChatPanel } from './panel/ChatPanel';
import { OllamaModels } from './agent/OllamaModels';

export function activate(context: vscode.ExtensionContext) {
  const chatPanel = new ChatPanel(context);

  // Status bar icon — bottom bar, always visible
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = '$(robot) Deep Agent';
  statusBarItem.tooltip = 'Open Deep Agent';
  statusBarItem.command = 'ollamaDeepAgent.openChat';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('ollamaDeepAgent.openChat', () => {
      chatPanel.show();
    }),

    vscode.commands.registerCommand('ollamaDeepAgent.newSession', () => {
      chatPanel.newSession();
    }),

    vscode.commands.registerCommand('ollamaDeepAgent.stopAgent', () => {
      chatPanel.stopAgent();
    }),

    vscode.commands.registerCommand('ollamaDeepAgent.sendSelection', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (!selection.trim()) {
        vscode.window.showWarningMessage('No code selected.');
        return;
      }
      const fileName = path.basename(editor.document.fileName);
      chatPanel.show();
      setTimeout(() => chatPanel.sendSelectedCode(fileName, selection), 300);
    }),

    vscode.commands.registerCommand('ollamaDeepAgent.selectModel', async () => {
      const config = vscode.workspace.getConfiguration('ollamaDeepAgent');
      const baseUrl = config.get<string>('ollamaBaseUrl', 'http://localhost:11434');

      const models = await OllamaModels.fetchAvailable(baseUrl);
      if (models.length === 0) {
        vscode.window.showErrorMessage(
          'No Ollama models found. Make sure Ollama is running at ' + baseUrl
        );
        return;
      }

      const picked = await vscode.window.showQuickPick(
        models.map(m => ({ label: m.name, description: m.size, detail: m.family })),
        { placeHolder: 'Select an Ollama model', title: 'Ollama Deep Agent — Choose Model' }
      );

      if (picked) {
        await config.update('defaultModel', picked.label, vscode.ConfigurationTarget.Global);
        chatPanel.setModel(picked.label);
        vscode.window.showInformationMessage(`Model set to: ${picked.label}`);
      }
    })
  );
}

export function deactivate() { }
