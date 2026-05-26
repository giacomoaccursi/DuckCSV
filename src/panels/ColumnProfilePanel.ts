/**
 * ColumnProfilePanel — side panel showing column statistics and distribution chart.
 * Uses Chart.js for rendering histograms, bar charts, and line charts.
 */

import * as vscode from 'vscode';
import { ColumnProfile } from '../types';
import { buildProfileHtml } from './buildProfileHtml';

export class ColumnProfilePanel {
  private static currentPanel: ColumnProfilePanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static open(extensionUri: vscode.Uri, profile: ColumnProfile): void {
    // Reuse existing panel if open
    if (ColumnProfilePanel.currentPanel) {
      ColumnProfilePanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      ColumnProfilePanel.currentPanel.update(extensionUri, profile);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'csvColumnProfile',
      `📊 ${profile.columnName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: false,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    ColumnProfilePanel.currentPanel = new ColumnProfilePanel(panel, extensionUri, profile);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, profile: ColumnProfile) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.update(extensionUri, profile);
  }

  private update(extensionUri: vscode.Uri, profile: ColumnProfile): void {
    this.panel.title = `📊 ${profile.columnName}`;
    this.panel.webview.html = buildProfileHtml(this.panel.webview, extensionUri, profile);
  }

  private dispose(): void {
    ColumnProfilePanel.currentPanel = undefined;
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
