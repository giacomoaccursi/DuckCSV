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
import { TableManager } from '../services/TableManager';
import { QueryExecutor } from '../services/QueryExecutor';
import { TableExporter } from '../services/TableExporter';
import { ConfigService } from '../services/ConfigService';
import { ViewState } from '../shared/ViewState';
import { exportQueryResultToFile } from '../shared/exportQueryResult';
import { WebviewMessage, ExtensionMessage, DataPagePayload } from '../types';
import { buildPreviewHtml } from './buildPreviewHtml';
import { openQueryResultPanel } from './QueryResultPanel';
import { EditMode } from '../commands/previewCommand';

export class CsvPreviewPanel {
  private static readonly viewType = 'csvPreview';
  private static panels = new Map<string, CsvPreviewPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly tableManager: TableManager;
  private readonly queryExecutor: QueryExecutor;
  private readonly tableExporter: TableExporter;
  private readonly config: ConfigService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly mode: EditMode;
  private readonly savePath: string;

  private currentUri: vscode.Uri;
  private tableName: string = '';
  private fileName: string = '';
  private fileSize: number = 0;
  private delimiter: string = '';
  private headers: string[] = [];
  private columnTypes: string[] = [];
  private totalRows: number = 0;

  // View state
  private readonly viewState = new ViewState();
  private isDirty: boolean = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Public API ──────────────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    tableManager: TableManager,
    queryExecutor: QueryExecutor,
    tableExporter: TableExporter,
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
      existing.reloadFromDisk();
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

    const instance = new CsvPreviewPanel(panel, extensionUri, tableManager, queryExecutor, tableExporter, config, uri, mode, savePath);
    CsvPreviewPanel.panels.set(key, instance);
  }

  // ─── Constructor ─────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    tableManager: TableManager,
    queryExecutor: QueryExecutor,
    tableExporter: TableExporter,
    config: ConfigService,
    uri: vscode.Uri,
    mode: EditMode,
    savePath: string
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.tableManager = tableManager;
    this.queryExecutor = queryExecutor;
    this.tableExporter = tableExporter;
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
      case 'sort':
        this.viewState.applySort(message.columnIndex, message.direction);
        return this.sendCurrentPage();
      case 'search':
        this.viewState.applySearch(message.term);
        return this.sendCurrentPage();
      case 'getColumnValues':
        return this.handleGetColumnValues(message.columnIndex);
      case 'setFilters':
        this.viewState.applyFilters(message.filters);
        return this.sendCurrentPage();
      case 'editCell':
        return this.handleEditCell(message.rowid, message.columnIndex, message.value);
      case 'addRow':
        return this.handleAddRow();
      case 'addRowAt':
        return this.handleAddRowAt(message.rowid, message.position);
      case 'deleteRow':
        return this.handleDeleteRow(message.rowid);
      case 'deleteRows':
        return this.handleDeleteRows(message.rowids);
      case 'executeQuery':
        return this.handleQuery(message.sql, message.mode);
      case 'exportQueryResult':
        return this.handleExportQueryResult(message.headers, message.rows);
      case 'cancelQuery':
        this.queryExecutor.cancel();
        // Worker was terminated — need to reload the table
        await this.loadDocument();
        return;
      case 'clearQuery':
        return this.sendCurrentPage();
      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage('Copied to clipboard');
        return;
      case 'openAsText':
        await vscode.window.showTextDocument(this.currentUri);
        return;
      case 'openWorkspace':
        await vscode.commands.executeCommand('duckcsv.workspace', this.currentUri);
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

      const meta = await this.tableManager.loadTable(this.currentUri, 'csv');
      this.tableName = meta.name;
      this.headers = meta.headers;
      this.columnTypes = meta.columnTypes;
      this.totalRows = meta.rowCount;
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
      const limit = this.config.pageSize;

      const result = await this.tableManager.getDataPage(this.tableName, {
        filters: this.viewState.filters,
        sort: this.viewState.sort,
        searchTerm: this.viewState.searchTerm,
        offset: 0,
        limit,
      });

      const payload: DataPagePayload = {
        headers: this.headers,
        columnTypes: this.columnTypes,
        rows: result.rows,
        rowids: result.rowids,
        totalRows: this.totalRows,
        filteredRows: result.filteredCount,
        delimiter: this.delimiter,
        fileName: this.fileName,
        fileSize: this.fileSize,
        sort: this.viewState.sort,
        filters: this.viewState.filters,
        searchTerm: this.viewState.searchTerm,
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
      const values = await this.tableManager.getUniqueValues(this.tableName, columnIndex);
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
      await this.tableManager.updateCell(this.tableName, rowid, columnIndex, value);
      this.isDirty = true;

      // Refresh column types (may have changed if column was cast to VARCHAR)
      this.columnTypes = await this.tableManager.getColumnTypes(this.tableName);

      this.persistToDisk();
      this.postMessage({ type: 'cellEditConfirm', data: { rowid, columnIndex, value } });

      // Re-send page to update type labels in header
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleAddRow(): Promise<void> {
    try {
      await this.tableManager.addRow(this.tableName);
      this.totalRows++;
      this.isDirty = true;
      this.viewState.applyFilters({});
      this.viewState.applySearch('');
      this.persistToDisk();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleAddRowAt(rowid: number, position: 'above' | 'below'): Promise<void> {
    try {
      await this.tableManager.addRowAt(this.tableName, rowid, position);
      this.totalRows++;
      this.isDirty = true;
      this.persistToDisk();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleDeleteRow(rowid: number): Promise<void> {
    try {
      await this.tableManager.deleteRow(this.tableName, rowid);
      this.totalRows--;
      this.isDirty = true;
      this.persistToDisk();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleDeleteRows(rowids: number[]): Promise<void> {
    try {
      await this.tableManager.deleteRows(this.tableName, rowids);
      this.totalRows -= rowids.length;
      this.isDirty = true;
      this.persistToDisk();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private persistToDisk(): void {
    // Debounce: wait 500ms after last mutation before writing to disk.
    // This avoids re-exporting 2M rows for every single row deletion in rapid succession.
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.doExport();
    }, 500);
  }

  private async doExport(): Promise<void> {
    try {
      await this.tableExporter.exportTable(this.tableName, this.savePath);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to save file';
      vscode.window.showErrorMessage(`CSV save error: ${msg}`);
    }
  }

  private async handleQuery(sql: string, mode: 'inline' | 'side'): Promise<void> {
    const result = await this.queryExecutor.execute(sql, this.tableName);
    const payload = { ...result, sql };

    if (mode === 'inline') {
      this.postMessage({ type: 'queryResult', data: payload });
    } else {
      openQueryResultPanel(this.extensionUri, payload);
    }
  }

  private async handleExportQueryResult(headers: string[], rows: string[][]): Promise<void> {
    await exportQueryResultToFile(headers, rows);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private resetState(): void {
    this.viewState.reset();
    this.isDirty = false;
  }

  private reloadFromDisk(): void {
    this.resetState();
    this.loadDocument();
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

    // Flush any pending persist before closing
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      this.doExport().catch(() => {});
    }

    // Clean up the table from DuckDB
    if (this.tableName) {
      this.tableManager.dropTable(this.tableName).catch(() => {});
    }

    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
