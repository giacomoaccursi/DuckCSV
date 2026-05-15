/**
 * CSV Preview Panel — manages the webview lifecycle and message routing.
 * Delegates CSV loading to CsvParserService.
 */

import * as vscode from 'vscode';
import { basename } from 'path';
import { CsvParserService } from '../services/CsvParserService';
import { WebviewMessage, ExtensionMessage } from '../types';
import { getNonce } from '../utils/nonce';

export class CsvPreviewPanel {
  private static readonly viewType = 'csvPreview';
  private static panels = new Map<string, CsvPreviewPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly parserService: CsvParserService;
  private readonly disposables: vscode.Disposable[] = [];
  private currentUri: vscode.Uri;

  // ─── Public API ──────────────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    parserService: CsvParserService,
    uri: vscode.Uri,
    viewColumn?: vscode.ViewColumn
  ): void {
    const column = viewColumn || vscode.ViewColumn.Beside;
    const key = uri.toString();

    // Reuse existing panel for the same file
    const existing = CsvPreviewPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CsvPreviewPanel.viewType,
      `Preview: ${basename(uri.fsPath)}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    const instance = new CsvPreviewPanel(panel, extensionUri, parserService, uri);
    CsvPreviewPanel.panels.set(key, instance);
  }

  // ─── Constructor ─────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    parserService: CsvParserService,
    uri: vscode.Uri
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.parserService = parserService;
    this.currentUri = uri;

    this.panel.webview.html = this.buildHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleWebviewMessage(msg),
      null,
      this.disposables
    );

    this.loadUri(uri);
  }

  // ─── Message Handling ────────────────────────────────────────────────────

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'refresh':
        await this.loadUri(this.currentUri);
        break;

      case 'loadMore':
        await this.loadMore(message.currentRows);
        break;

      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage('Copied to clipboard');
        break;

      case 'openAsText':
        await vscode.window.showTextDocument(this.currentUri);
        break;
    }
  }

  // ─── Data Loading ────────────────────────────────────────────────────────

  private async loadUri(uri: vscode.Uri): Promise<void> {
    this.currentUri = uri;
    this.panel.title = `Preview: ${basename(uri.fsPath)}`;

    try {
      const payload = await this.parserService.loadFile(uri);
      this.postMessage({ type: 'csvData', data: payload });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load CSV file';
      this.postMessage({ type: 'error', message: msg });
    }
  }

  private async loadMore(currentRows: number): Promise<void> {
    try {
      const payload = await this.parserService.loadMoreRows(this.currentUri, currentRows);
      this.postMessage({ type: 'moreRows', data: payload });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load more rows';
      this.postMessage({ type: 'error', message: msg });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private postMessage(message: ExtensionMessage): void {
    this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    CsvPreviewPanel.panels.delete(this.currentUri.toString());

    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }

  // ─── HTML Generation ─────────────────────────────────────────────────────

  private buildHtml(): string {
    const webview = this.panel.webview;
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'script.js')
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>CSV Preview</title>
</head>
<body>
  <div id="app">
    <div class="toolbar">
      <div class="toolbar-left">
        <button id="refreshBtn" class="btn" title="Refresh">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M13.5 2.5a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-3.5a.5.5 0 1 1 0-1H13V3.5a.5.5 0 0 1 .5-.5z"/>
            <path fill="currentColor" d="M13.354 3.354a.5.5 0 0 1 0 .707A7 7 0 1 1 3 8a.5.5 0 0 1 1 0 6 6 0 1 0 9.061-5.146.5.5 0 0 1 .293-.9z"/>
          </svg>
        </button>
        <button id="openAsTextBtn" class="btn" title="Open as Text">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M5 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H5zm0 1h6v10H5V3z"/>
            <path fill="currentColor" d="M6 5h4v1H6V5zm0 2h4v1H6V7zm0 2h3v1H6V9z"/>
          </svg>
        </button>
        <input type="text" id="searchInput" class="search-input" placeholder="Search..." />
      </div>
      <div class="toolbar-right">
        <span id="stats" class="stats"></span>
      </div>
    </div>

    <div id="errorContainer" class="error-container hidden">
      <div class="error-message">
        <span id="errorText"></span>
      </div>
    </div>

    <div id="loadingContainer" class="loading-container">
      <div class="spinner"></div>
      <div>Loading CSV...</div>
    </div>

    <div id="tableContainer" class="table-container hidden">
      <div class="table-wrapper">
        <table id="csvTable">
          <thead id="tableHeader"></thead>
          <tbody id="tableBody"></tbody>
        </table>
      </div>
      <div id="loadMoreContainer" class="load-more-container hidden">
        <button id="loadMoreBtn" class="btn btn-primary">Load More Rows</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
