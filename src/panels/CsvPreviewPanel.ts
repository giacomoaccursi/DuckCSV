/**
 * CSV Preview Panel — manages the webview lifecycle and message routing.
 * Delegates data operations to CsvDocument and file writes to CsvWriterService.
 */

import * as vscode from 'vscode';
import { basename } from 'path';
import { CsvParserService } from '../services/CsvParserService';
import { CsvWriterService } from '../services/CsvWriterService';
import { ConfigService } from '../services/ConfigService';
import { CsvDocument } from '../models/CsvDocument';
import { WebviewMessage, ExtensionMessage, DataPagePayload } from '../types';
import { getNonce } from '../utils/nonce';

export class CsvPreviewPanel {
  private static readonly viewType = 'csvPreview';
  private static panels = new Map<string, CsvPreviewPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly parserService: CsvParserService;
  private readonly writerService: CsvWriterService;
  private readonly config: ConfigService;
  private readonly disposables: vscode.Disposable[] = [];

  private currentUri: vscode.Uri;
  private document: CsvDocument | null = null;
  private pageOffset: number = 0;

  // ─── Public API ──────────────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    parserService: CsvParserService,
    writerService: CsvWriterService,
    config: ConfigService,
    uri: vscode.Uri,
    viewColumn?: vscode.ViewColumn
  ): void {
    const column = viewColumn || vscode.ViewColumn.Beside;
    const key = uri.toString();

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

    const instance = new CsvPreviewPanel(panel, extensionUri, parserService, writerService, config, uri);
    CsvPreviewPanel.panels.set(key, instance);
  }

  // ─── Constructor ─────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    parserService: CsvParserService,
    writerService: CsvWriterService,
    config: ConfigService,
    uri: vscode.Uri
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.parserService = parserService;
    this.writerService = writerService;
    this.config = config;
    this.currentUri = uri;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      null,
      this.disposables
    );

    // Set HTML last — script sends 'ready' when loaded
    this.panel.webview.html = this.buildHtml();
  }

  // ─── Message Handling ────────────────────────────────────────────────────

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.loadDocument();
        break;

      case 'refresh':
        this.document = null;
        await this.loadDocument();
        break;

      case 'loadMore':
        this.pageOffset += this.config.pageSize;
        this.sendCurrentPage();
        break;

      case 'sort':
        if (this.document) {
          this.document.setSort(message.columnIndex, message.direction);
          this.pageOffset = 0;
          this.sendCurrentPage();
        }
        break;

      case 'search':
        if (this.document) {
          this.document.setSearchTerm(message.term);
          this.pageOffset = 0;
          this.sendCurrentPage();
        }
        break;

      case 'getColumnValues':
        if (this.document) {
          const values = this.document.getUniqueValues(message.columnIndex);
          this.postMessage({
            type: 'columnValues',
            data: { columnIndex: message.columnIndex, values, totalCount: values.length },
          });
        }
        break;

      case 'setFilters':
        if (this.document) {
          this.document.setFilters(message.filters);
          this.pageOffset = 0;
          this.sendCurrentPage();
        }
        break;

      case 'editCell':
        this.handleCellEdit(message.originalRowIndex, message.columnIndex, message.value);
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

  // ─── Cell Editing ────────────────────────────────────────────────────────

  private handleCellEdit(originalRowIndex: number, columnIndex: number, value: string): void {
    if (!this.document) { return; }

    this.document.setCellValue(originalRowIndex, columnIndex, value);
    this.writerService.scheduleWrite(this.currentUri, this.document);

    // Confirm edit to webview
    this.postMessage({
      type: 'cellEditConfirm',
      data: { originalRowIndex, columnIndex, value },
    });
  }

  // ─── Data Loading ────────────────────────────────────────────────────────

  private async loadDocument(): Promise<void> {
    this.postMessage({ type: 'loading', loading: true });

    try {
      this.document = await this.parserService.loadDocument(this.currentUri);
      this.pageOffset = 0;
      this.panel.title = `Preview: ${this.document.fileName}`;
      this.sendCurrentPage();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to load CSV file';
      this.postMessage({ type: 'error', message: msg });
    } finally {
      this.postMessage({ type: 'loading', loading: false });
    }
  }

  private sendCurrentPage(): void {
    if (!this.document) { return; }

    const pageSize = this.config.pageSize;
    const page = this.document.getPage(0, this.pageOffset + pageSize);
    const filteredCount = this.document.getFilteredRowCount();

    const payload: DataPagePayload = {
      headers: this.document.headers,
      rows: page.rows,
      originalIndices: page.originalIndices,
      totalRows: this.document.getTotalRows(),
      filteredRows: filteredCount,
      pageOffset: 0,
      pageSize: this.pageOffset + pageSize,
      hasMore: (this.pageOffset + pageSize) < filteredCount,
      delimiter: this.document.delimiterName,
      fileName: this.document.fileName,
      fileSize: this.document.fileSize,
      sort: this.document.getSortState(),
      filters: this.document.getFilters(),
      searchTerm: this.document.getSearchTerm(),
      isDirty: this.document.isDirty(),
    };

    this.postMessage({ type: 'dataPage', data: payload });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private postMessage(message: ExtensionMessage): void {
    this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    CsvPreviewPanel.panels.delete(this.currentUri.toString());
    this.document = null;

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
        <button id="colorBtn" class="btn" title="Toggle column colors">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 0 1 4.9 3H8V2.5zm-1 0v3H3.1A5.5 5.5 0 0 1 7 2.5zM2.5 8A5.5 5.5 0 0 1 3.1 6.5H7V9.5H3.1A5.5 5.5 0 0 1 2.5 8zm4.5 3.5v2a5.5 5.5 0 0 1-3.9-3h3.9zm1 2v-2h3.9a5.5 5.5 0 0 1-3.9 2zM8 9.5V6.5h4.9a5.5 5.5 0 0 1 0 3H8z"/>
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

    <div id="loadingContainer" class="loading-container hidden">
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
