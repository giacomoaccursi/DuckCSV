/**
 * CSV Preview Panel — webview lifecycle and message routing.
 *
 * Responsibilities:
 *  - Create/show/dispose the webview panel
 *  - Route messages between webview and services
 *  - Maintain view state (sort, filters, pagination)
 *
 * Does NOT: generate HTML, execute queries, or render results.
 */

import * as vscode from 'vscode';
import { basename } from 'path';
import { DuckDbService } from '../services/DuckDbService';
import { ConfigService } from '../services/ConfigService';
import { WebviewMessage, ExtensionMessage, DataPagePayload, SortState, ColumnFilters } from '../types';
import { buildPreviewHtml } from './buildPreviewHtml';
import { openQueryResultPanel } from './QueryResultPanel';
import { EditMode } from '../commands/previewCommand';

export class CsvPreviewPanel {
  private static readonly viewType = 'csvPreview';
  private static panels = new Map<string, CsvPreviewPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly duckDb: DuckDbService;
  private readonly config: ConfigService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly mode: EditMode;
  private readonly savePath: string;

  private currentUri: vscode.Uri;
  private fileName: string = '';
  private fileSize: number = 0;
  private delimiter: string = '';
  private headers: string[] = [];
  private totalRows: number = 0;

  // View state
  private sort: SortState = { columnIndex: -1, direction: 'none' };
  private filters: ColumnFilters = {};
  private searchTerm: string = '';
  private pageOffset: number = 0;
  private isDirty: boolean = false;

  // ─── Public API ──────────────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    duckDb: DuckDbService,
    config: ConfigService,
    uri: vscode.Uri,
    viewColumn: vscode.ViewColumn | undefined,
    mode: EditMode,
    savePath: string
  ): void {
    const column = viewColumn || vscode.ViewColumn.Beside;
    const key = `${uri.toString()}:${mode}`;

    const existing = CsvPreviewPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(column);
      return;
    }

    const title = mode === 'edit'
      ? `Edit: ${basename(uri.fsPath)}`
      : `Preview: ${basename(uri.fsPath)}`;

    const panel = vscode.window.createWebviewPanel(
      CsvPreviewPanel.viewType,
      title,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    const instance = new CsvPreviewPanel(panel, extensionUri, duckDb, config, uri, mode, savePath);
    CsvPreviewPanel.panels.set(key, instance);
  }

  // ─── Constructor ─────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    duckDb: DuckDbService,
    config: ConfigService,
    uri: vscode.Uri,
    mode: EditMode,
    savePath: string
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.duckDb = duckDb;
    this.config = config;
    this.currentUri = uri;
    this.mode = mode;
    this.savePath = savePath;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.panel.webview.html = buildPreviewHtml(this.panel.webview, this.extensionUri);
  }

  // ─── Message Router ──────────────────────────────────────────────────────

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.postMessage({
          type: 'modeInfo',
          mode: this.mode,
          savePath: this.savePath,
        });
        return this.loadDocument();
      case 'refresh':
        this.resetState();
        return this.loadDocument();
      case 'loadMore':
        this.pageOffset += this.config.pageSize;
        return this.sendCurrentPage();
      case 'sort':
        this.sort = { columnIndex: message.columnIndex, direction: message.direction };
        this.pageOffset = 0;
        return this.sendCurrentPage();
      case 'search':
        this.searchTerm = message.term;
        this.pageOffset = 0;
        return this.sendCurrentPage();
      case 'getColumnValues':
        return this.handleGetColumnValues(message.columnIndex);
      case 'setFilters':
        this.filters = message.filters;
        this.pageOffset = 0;
        return this.sendCurrentPage();
      case 'editCell':
        return this.handleEditCell(message.rowid, message.columnIndex, message.value);
      case 'addRow':
        return this.handleAddRow();
      case 'deleteRow':
        return this.handleDeleteRow(message.rowid);
      case 'executeQuery':
        return this.handleQuery(message.sql, message.mode);
      case 'clearQuery':
        return this.sendCurrentPage();
      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage('Copied to clipboard');
        return;
      case 'openAsText':
        await vscode.window.showTextDocument(this.currentUri);
        return;
    }
  }

  // ─── Data Loading ────────────────────────────────────────────────────────

  private async loadDocument(): Promise<void> {
    this.postMessage({ type: 'loading', loading: true });

    try {
      const stat = await vscode.workspace.fs.stat(this.currentUri);
      this.fileSize = stat.size;
      this.fileName = basename(this.currentUri.fsPath);

      const meta = await this.duckDb.loadFile(this.currentUri);
      this.headers = meta.headers;
      this.totalRows = meta.totalRows;
      this.delimiter = meta.delimiter;

      this.panel.title = `Preview: ${this.fileName}`;
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    } finally {
      this.postMessage({ type: 'loading', loading: false });
    }
  }

  private async sendCurrentPage(): Promise<void> {
    try {
      const pageSize = this.config.pageSize;
      const limit = this.pageOffset + pageSize;

      const result = await this.duckDb.getDataPage({
        filters: this.filters,
        sort: this.sort,
        searchTerm: this.searchTerm,
        offset: 0,
        limit,
      });

      const payload: DataPagePayload = {
        headers: this.headers,
        rows: result.rows,
        rowids: result.rowids,
        totalRows: this.totalRows,
        filteredRows: result.filteredCount,
        pageOffset: 0,
        pageSize: limit,
        hasMore: limit < result.filteredCount,
        delimiter: this.delimiter,
        fileName: this.fileName,
        fileSize: this.fileSize,
        sort: this.sort,
        filters: this.filters,
        searchTerm: this.searchTerm,
        isDirty: this.isDirty,
      };

      this.postMessage({ type: 'dataPage', data: payload });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  private async handleGetColumnValues(columnIndex: number): Promise<void> {
    try {
      const values = await this.duckDb.getUniqueValues(columnIndex);
      this.postMessage({
        type: 'columnValues',
        data: { columnIndex, values, totalCount: values.length },
      });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleEditCell(rowid: number, columnIndex: number, value: string): Promise<void> {
    try {
      await this.duckDb.updateCell(rowid, columnIndex, value);
      this.isDirty = true;
      await this.persistToDisk();
      this.postMessage({ type: 'cellEditConfirm', data: { rowid, columnIndex, value } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleAddRow(): Promise<void> {
    try {
      await this.duckDb.addRow();
      this.totalRows++;
      this.isDirty = true;
      this.filters = {};
      this.searchTerm = '';
      this.pageOffset = Math.max(0, this.totalRows - this.config.pageSize);
      await this.persistToDisk();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleDeleteRow(rowid: number): Promise<void> {
    try {
      await this.duckDb.deleteRow(rowid);
      this.totalRows--;
      this.isDirty = true;
      await this.persistToDisk();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private async persistToDisk(): Promise<void> {
    try {
      await this.duckDb.exportToCsv(this.savePath);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to save file';
      vscode.window.showErrorMessage(`CSV save error: ${msg}`);
    }
  }

  private async handleQuery(sql: string, mode: 'inline' | 'side'): Promise<void> {
    const result = await this.duckDb.executeQuery(sql);
    const payload = { ...result, sql };

    if (mode === 'inline') {
      this.postMessage({ type: 'queryResult', data: payload });
    } else {
      openQueryResultPanel(this.extensionUri, payload);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private resetState(): void {
    this.sort = { columnIndex: -1, direction: 'none' };
    this.filters = {};
    this.searchTerm = '';
    this.pageOffset = 0;
    this.isDirty = false;
  }

  private postMessage(message: ExtensionMessage): void {
    this.panel.webview.postMessage(message);
  }

  private postError(error: unknown): void {
    const msg = error instanceof Error ? error.message : 'An unexpected error occurred';
    this.postMessage({ type: 'error', message: msg });
  }

  private dispose(): void {
    CsvPreviewPanel.panels.delete(`${this.currentUri.toString()}:${this.mode}`);
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
