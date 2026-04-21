import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export type PlanCallback = (action: 'approve' | 'revise', steps: string[], feedback?: string) => void;

export class PlanEditor {
  private static planFilePath = path.join(os.tmpdir(), 'deepagent-plan.md');
  private static watcher: vscode.FileSystemWatcher | undefined;
  private static currentCallback: PlanCallback | undefined;
  private static doc: vscode.TextDocument | undefined;

  static async show(steps: string[], originalTask: string, callback: PlanCallback): Promise<void> {
    PlanEditor.currentCallback = callback;

    const content = PlanEditor.buildMarkdown(steps, originalTask);
    fs.writeFileSync(PlanEditor.planFilePath, content, 'utf8');

    PlanEditor.doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(PlanEditor.planFilePath)
    );

    await vscode.window.showTextDocument(PlanEditor.doc, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
      preserveFocus: false,
    });

    // Watch for saves — when user saves, parse and act
    if (PlanEditor.watcher) PlanEditor.watcher.dispose();
    PlanEditor.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(os.tmpdir()),
        'deepagent-plan.md'
      )
    );

    PlanEditor.watcher.onDidChange(async () => {
      const text = fs.readFileSync(PlanEditor.planFilePath, 'utf8');
      const action = PlanEditor.parseAction(text);
      if (action === 'approve' || action === 'revise') {
        const { steps: parsedSteps, feedback } = PlanEditor.parseContent(text);
        PlanEditor.currentCallback?.(action, parsedSteps, feedback);
        if (action === 'approve') {
          PlanEditor.cleanup();
        }
      }
    });

    // Register approve/revise commands
    vscode.commands.executeCommand('setContext', 'deepagent.planOpen', true);

    vscode.window.showInformationMessage(
      '📋 Deep Agent Plan — Edit steps, add feedback, then save.',
      '▶ Approve & Run', '🔄 Revise Plan'
    ).then(choice => {
      if (!choice) return;
      const text = fs.readFileSync(PlanEditor.planFilePath, 'utf8');
      const { steps: parsedSteps, feedback } = PlanEditor.parseContent(text);
      if (choice === '▶ Approve & Run') {
        PlanEditor.currentCallback?.('approve', parsedSteps);
        PlanEditor.cleanup();
      } else {
        PlanEditor.currentCallback?.('revise', parsedSteps, feedback);
      }
    });
  }

  static updateSteps(steps: string[], completedIndexes: number[]): void {
    if (!fs.existsSync(PlanEditor.planFilePath)) return;
    const text = fs.readFileSync(PlanEditor.planFilePath, 'utf8');
    // Update checkboxes for completed steps
    let updated = text;
    const lines = updated.split('\n');
    const updatedLines = lines.map(line => {
      const m = line.match(/^- \[[ x]\] \*\*Step (\d+):\*\*/);
      if (m) {
        const idx = parseInt(m[1], 10) - 1;
        if (completedIndexes.includes(idx)) {
          return line.replace('- [ ]', '- [x]');
        }
      }
      return line;
    });
    fs.writeFileSync(PlanEditor.planFilePath, updatedLines.join('\n'), 'utf8');
  }

  static cleanup(): void {
    PlanEditor.watcher?.dispose();
    PlanEditor.watcher = undefined;
    PlanEditor.currentCallback = undefined;
    vscode.commands.executeCommand('setContext', 'deepagent.planOpen', false);
  }

  private static buildMarkdown(steps: string[], task: string): string {
    const date = new Date().toLocaleString();
    return [
      `# Deep Agent — Execution Plan`,
      ``,
      `> **Task:** ${task}`,
      `> **Generated:** ${date}`,
      ``,
      `---`,
      ``,
      `## Steps`,
      ``,
      ...steps.map((s, i) => `- [ ] **Step ${i + 1}:** ${s}`),
      ``,
      `---`,
      ``,
      `## Your Feedback *(optional — edit this section before approving)*`,
      ``,
      `> Add your review here. The agent will revise the plan based on your input.`,
      ``,
      `---`,
      ``,
      `## Actions`,
      ``,
      `Save this file after editing. Then use the notification buttons to **Approve & Run** or **Revise Plan**.`,
      ``,
      `<!-- deepagent:action=pending -->`,
    ].join('\n');
  }

  private static parseAction(text: string): string {
    const m = text.match(/<!-- deepagent:action=(\w+) -->/);
    return m ? m[1] : 'pending';
  }

  private static parseContent(text: string): { steps: string[]; feedback: string } {
    const steps: string[] = [];
    const stepRe = /^- \[[ x]\] \*\*Step \d+:\*\* (.+)/gm;
    let m;
    while ((m = stepRe.exec(text)) !== null) {
      steps.push(m[1].trim());
    }

    // Extract feedback section
    const feedbackMatch = text.match(/## Your Feedback[\s\S]*?\n\n([\s\S]*?)\n---/);
    let feedback = '';
    if (feedbackMatch) {
      feedback = feedbackMatch[1]
        .replace(/^> /gm, '')
        .replace('Add your review here. The agent will revise the plan based on your input.', '')
        .trim();
    }

    return { steps: steps.length ? steps : [], feedback };
  }
}
