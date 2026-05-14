/**
 * CSV Preview Panel — manages the webview lifecycle and message routing.
 * Delegates data operations to CsvDocument and file writes to CsvWriterService.
 */

import * as vscode from 'vscode';
import { basename } from 'path';
import { CsvParserService } from '../services/CsvParserService';
import { CsvWriterService } from '../services/CsvWriterService';
import { QueryService } from '../services/QueryService';
import { ConfigService } from '../services/ConfigService';
import { CsvDocument } from '../models/CsvDocument';
import { WebviewMessage, ExtensionMessage, DataPagePayload, QueryResultPayload } from '../types';
import { getNonce } from '../utils/nonce';

export class CsvPreviewPanel {
  private static readonly viewType = 'csvPreview';
  private static panels = new Map<string, CsvPreviewPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly parserService: CsvParserService;
  private readonly writerService: CsvWriterService;
  private readonly queryService: QueryService;
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
    queryService: QueryService,
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

    const instance = new CsvPreviewPanel(panel, extensionUri, parserService, writerService, queryService, config, uri);
    CsvPreviewPanel.panels.set(key, instance);
  }

  // ─── Constructor ─────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    parserService: CsvParserService,
    writerService: CsvWriterService,
    queryService: QueryService,
    config: ConfigService,
    uri: vscode.Uri
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.parserService = parserService;
    this.writerService = writerService;
    this.queryService = queryService;
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

      case 'addRow':
        this.handleAddRow();
        break;

      case 'deleteRow':
        this.handleDeleteRow(message.originalRowIndex);
        break;

      case 'executeQuery':
        this.handleQuery(message.sql, message.mode);
        break;

      case 'clearQuery':
        this.sendCurrentPage();
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

    this.postMessage({
      type: 'cellEditConfirm',
      data: { originalRowIndex, columnIndex, value },
    });
  }

  // ─── Row Operations ─────────────────────────────────────────────────────

  private handleAddRow(): void {
    if (!this.document) { return; }

    // Clear filters/search so the new empty row is visible
    this.document.resetQueryState();
    this.document.addRow();
    this.writerService.scheduleWrite(this.currentUri, this.document);

    // Jump to last page to show the new row
    const total = this.document.getFilteredRowCount();
    const pageSize = this.config.pageSize;
    this.pageOffset = Math.max(0, total - pageSize);

    this.sendCurrentPage();
  }

  private handleDeleteRow(originalRowIndex: number): void {
    if (!this.document) { return; }

    const deleted = this.document.deleteRow(originalRowIndex);
    if (!deleted) { return; }

    this.writerService.scheduleWrite(this.currentUri, this.document);

    // Re-send current page (indices have shifted)
    this.sendCurrentPage();
  }

  // ─── Query Execution ─────────────────────────────────────────────────────

  private handleQuery(sql: string, mode: 'inline' | 'side'): void {
    if (!this.document) { return; }

    const result = this.queryService.execute(this.document, sql);

    const payload: QueryResultPayload = {
      headers: result.headers,
      rows: result.rows,
      rowCount: result.rowCount,
      executionTimeMs: result.executionTimeMs,
      sql,
      error: result.error,
    };

    if (mode === 'inline') {
      this.postMessage({ type: 'queryResult', data: payload });
    } else {
      // Open result in a side panel
      this.openQueryResultPanel(payload);
    }
  }

  private openQueryResultPanel(payload: QueryResultPayload): void {
    const panel = vscode.window.createWebviewPanel(
      'csvQueryResult',
      `Query Result`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] }
    );

    const webview = panel.webview;
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css')
    );
    const nonce = getNonce();

    const rowsHtml = payload.error
      ? `<div class="error-container"><div class="error-message"><span>${this.escapeHtml(payload.error)}</span></div></div>`
      : this.buildResultTableHtml(payload);

    panel.webview.html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Query Result</title>
</head>
<body>
  <div id="app">
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="stats">SQL: ${this.escapeHtml(payload.sql)}</span>
      </div>
      <div class="toolbar-right">
        <span class="stats">${payload.rowCount} rows \u2022 ${payload.executionTimeMs.toFixed(1)}ms</span>
      </div>
    </div>
    <div class="table-container">
      <div class="table-wrapper">
        ${rowsHtml}
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  private buildResultTableHtml(payload: QueryResultPayload): string {
    const headerCells = payload.headers.map(h => `<th>${this.escapeHtml(h)}</th>`).join('');
    const bodyRows = payload.rows.map((row, i) => {
      const cells = row.map(cell => `<td title="${this.escapeHtml(cell)}">${this.escapeHtml(cell)}</td>`).join('');
      return `<tr><td class="row-number">${i + 1}</td>${cells}</tr>`;
    }).join('');

    return `<table id="csvTable">
      <thead><tr><th class="row-number-header">#</th>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
        <button id="refreshBtn" class="btn" title="Reload file from disk">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M13 2v4H9l1.6-1.6A4.5 4.5 0 0 0 8 3.5a4.5 4.5 0 1 0 4.5 4.5h1A5.5 5.5 0 1 1 8 2.5c1.4 0 2.7.5 3.6 1.4L13 2z"/>
          </svg>
        </button>
        <button id="openAsTextBtn" class="btn" title="Open file as plain text">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M3 1h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm7 0v3h3L10 1zM5 6h6v1H5V6zm0 2h6v1H5V8zm0 2h4v1H5v-1z"/>
          </svg>
        </button>
        <button id="colorBtn" class="btn" title="Toggle column colors for better readability">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M8 1C4.1 1 1 4.1 1 8s3.1 7 7 7 7-3.1 7-7-3.1-7-7-7zm0 1c1.2 0 2.3.4 3.2 1H8V3h-.5V2.02c.2-.01.3-.02.5-.02zM4.8 3h2.7v3H2.3A5.97 5.97 0 0 1 4.8 3zM2 8c0-.4 0-.7.1-1h5.4v2H2.1C2 8.7 2 8.4 2 8zm2.8 5A5.97 5.97 0 0 1 2.3 10h5.2v3H4.8zm3.7 0V10h5.2a5.97 5.97 0 0 1-2.5 3H8.5zm5.4-4H8.5V6h5.4c.1.3.1.6.1 1s0 .7-.1 1z"/>
          </svg>
        </button>
        <button id="addRowBtn" class="btn" title="Add new row at the end">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path fill="currentColor" d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          </svg>
        </button>
        <input type="text" id="searchInput" class="search-input" placeholder="Search..." />
      </div>
      <div class="toolbar-right">
        <span id="stats" class="stats"></span>
      </div>
    </div>

    <div class="query-bar">
      <input type="text" id="queryInput" class="query-input" placeholder="SQL: SELECT * WHERE Status = 'Active' ORDER BY Name LIMIT 100" />
      <button id="queryRunBtn" class="btn" title="Run query inline (replaces current view)">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path fill="currentColor" d="M4 2l10 6-10 6V2z"/>
        </svg>
      </button>
      <button id="querySideBtn" class="btn" title="Run query in side panel">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path fill="currentColor" d="M1 2h14v12H1V2zm1 1v10h6V3H2zm7 0v10h5V3H9z"/>
          <path fill="currentColor" d="M10.5 6.5l3 1.5-3 1.5v-3z"/>
        </svg>
      </button>
      <button id="queryClearBtn" class="btn hidden" title="Clear query and return to data">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.5 9.8L10.8 11.5 8 8.7l-2.8 2.8-.7-.7L7.3 8 4.5 5.2l.7-.7L8 7.3l2.8-2.8.7.7L8.7 8l2.8 2.8z"/>
        </svg>
      </button>
      <span id="queryError" class="query-error hidden"></span>
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
