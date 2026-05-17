/**
 * BasePanel — shared logic for CSV webview panels.
 *
 * Provides:
 *  - Panel lifecycle (disposables, message routing setup)
 *  - postMessage / postError helpers
 *  - Common message handlers (query, export, columnValues, sort, search, filter, clipboard)
 *  - sendCurrentPage pattern with stale-response handling
 *  - ViewState management
 */

import * as vscode from 'vscode';
import { TableManager } from '../services/TableManager';
import { QueryExecutor } from '../services/QueryExecutor';
import { ConfigService } from '../services/ConfigService';
import { ViewState } from '../shared/ViewState';
import { exportQueryResultToFile } from '../shared/exportQueryResult';
import { WebviewMessage, ExtensionMessage, DataPagePayload } from '../types';
import { QueryHistoryService } from '../services/QueryHistoryService';

export abstract class BasePanel {
  protected readonly panel: vscode.WebviewPanel;
  protected readonly extensionUri: vscode.Uri;
  protected readonly tableManager: TableManager;
  protected readonly queryExecutor: QueryExecutor;
  protected readonly config: ConfigService;
  protected readonly disposables: vscode.Disposable[] = [];
  protected readonly viewState = new ViewState();
  protected pageRequestId: number = 0;
  private inlineQueryTable: string | null = null;
  private disposed = false;
  protected historyService?: QueryHistoryService;
  protected historyKey: string = '';

  constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    tableManager: TableManager,
    queryExecutor: QueryExecutor,
    config: ConfigService,
    html: string
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.tableManager = tableManager;
    this.queryExecutor = queryExecutor;
    this.config = config;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.panel.webview.html = html;
  }

  // ─── Abstract ────────────────────────────────────────────────────────────

  /** Subclass-specific message handling. Return true if handled. */
  protected abstract handleSubclassMessage(message: WebviewMessage): Promise<boolean>;

  /** Get the active table name for queries/data. */
  protected abstract getActiveTableName(): string;

  /** Build the DataPagePayload with subclass-specific fields. */
  protected abstract buildPayload(
    result: { rows: string[][]; rowids: number[]; filteredCount: number },
    meta: { headers: string[]; columnTypes: string[]; delimiter: string; rowCount: number; name: string }
  ): DataPagePayload;

  /** Subclass-specific cleanup on dispose. */
  protected abstract onDispose(): void;

  // ─── Message Router ──────────────────────────────────────────────────────

  private async handleMessage(message: WebviewMessage): Promise<void> {
    // Let subclass handle first
    const handled = await this.handleSubclassMessage(message);
    if (handled) { return; }

    // Common handlers
    switch (message.type) {
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

      case 'executeQuery':
        return this.handleQuery(message.sql, message.mode);

      case 'exportQueryResult':
        return this.handleExportQueryResult(message.headers, message.rows);

      case 'clearQuery':
        return this.handleClearQuery();

      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text);
        return;

      case 'saveHistory':
        if (this.historyService && this.historyKey) {
          this.historyService.saveHistory(this.historyKey, message.history);
        }
        return;

      case 'fetchPage':
        return this.handleFetchPage(message.requestId, message.offset, message.limit);

      default:
        return;
    }
  }

  // ─── Shared Data Flow ────────────────────────────────────────────────────

  /** The effective table: inline query table if active, otherwise the panel's table. */
  private getEffectiveTable(): string {
    return this.inlineQueryTable || this.getActiveTableName();
  }

  protected async sendCurrentPage(): Promise<void> {
    const tableName = this.getEffectiveTable();
    if (!tableName) { return; }

    const requestId = ++this.pageRequestId;

    try {
      // Fetch only the first block (2000 rows) — frontend will request more via fetchPage
      const firstBlockSize = 2000;

      const result = await this.tableManager.getDataPage(tableName, {
        filters: this.viewState.filters,
        sort: this.viewState.sort,
        searchTerm: this.viewState.searchTerm,
        offset: 0,
        limit: firstBlockSize,
      });

      // Discard stale response if a newer request was issued
      if (requestId !== this.pageRequestId) { return; }

      const meta = this.tableManager.getTableMeta(tableName);
      if (!meta) { return; }

      const payload = this.buildPayload(result, meta);
      payload.isQueryResult = !!this.inlineQueryTable;
      this.postMessage({ type: 'dataPage', data: payload });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  // ─── Common Handlers ─────────────────────────────────────────────────────

  protected async handleGetColumnValues(columnIndex: number): Promise<void> {
    const tableName = this.getEffectiveTable();
    if (!tableName) { return; }

    try {
      const values = await this.tableManager.getUniqueValues(
        tableName, columnIndex, this.viewState.filters, this.viewState.searchTerm
      );
      this.postMessage({
        type: 'columnValues',
        data: { columnIndex, values, totalCount: values.length },
      });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  protected async handleQuery(sql: string, mode: 'inline' | 'side'): Promise<void> {
    const tableName = this.getActiveTableName();

    if (mode === 'side') {
      const { QueryResultPanel } = await import('./QueryResultPanel');
      const meta = this.tableManager.getTableMeta(tableName || '');
      const sourceFileName = meta?.filePath ? meta.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') : 'query';
      await QueryResultPanel.open(
        this.extensionUri, this.queryExecutor.getEngine(), this.queryExecutor, this.config, sql, sourceFileName
      );
      return;
    }

    // Inline: execute into temp table with __orig_rid for edit mapping
    const tempName = `__inline_qr_${Date.now()}`;
    const trimmedSql = sql.trim();

    // Try to inject rowid into the SELECT for edit support
    const withRowid = trimmedSql.replace(/^SELECT\s/i, 'SELECT rowid as __orig_rid, ');
    let hasOrigRid = false;

    try {
      await this.queryExecutor.getEngine().query(`CREATE TEMP TABLE "${tempName}" AS ${withRowid}`);
      hasOrigRid = true;
    } catch {
      // Fallback: rowid injection failed (e.g. aggregation, JOIN). Create without it.
      try {
        await this.queryExecutor.getEngine().query(`DROP TABLE IF EXISTS "${tempName}"`);
        await this.queryExecutor.getEngine().query(`CREATE TEMP TABLE "${tempName}" AS ${trimmedSql}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Query failed';
        this.postMessage({ type: 'queryError', message: msg });
        return;
      }
    }

    // Get schema + count (exclude __orig_rid from visible headers)
    const engine = this.queryExecutor.getEngine();
    const schemaResult = await engine.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tempName}' AND column_name != '__orig_rid' ORDER BY ordinal_position`
    );
    const countResult = await engine.query(`SELECT COUNT(*) FROM "${tempName}"`);

    // Drop previous inline query table
    if (this.inlineQueryTable) {
      await engine.query(`DROP TABLE IF EXISTS "${this.inlineQueryTable}"`);
      this.tableManager.unregisterTable(this.inlineQueryTable);
    }

    // Register temp table
    this.inlineQueryTable = tempName;
    this.tableManager.registerTable({
      name: tempName, filePath: '', delimiter: 'Comma', delimiterChar: ',',
      headers: schemaResult.rows.map(r => r[0]),
      columnTypes: schemaResult.rows.map(r => r[1]),
      originalTypes: schemaResult.rows.map(r => r[1]),
      rowCount: Number(countResult.rows[0][0]),
      useOrigRid: hasOrigRid,
    });

    this.viewState.reset();
    await this.sendCurrentPage();
  }

  protected async handleExportQueryResult(_headers: string[], _rows: string[][]): Promise<void> {
    // If inline query is active, export from the temp table
    if (this.inlineQueryTable) {
      const meta = this.tableManager.getTableMeta(this.getActiveTableName());
      const baseName = meta?.filePath ? meta.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') : 'query';
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${baseName}_query_result.csv`),
        filters: { 'CSV Files': ['csv'], 'All Files': ['*'] },
        title: 'Export Query Result',
      });
      if (!uri) { return; }
      const { TableExporter } = await import('../services/TableExporter');
      const exporter = new TableExporter(this.queryExecutor.getEngine(), this.tableManager);
      await exporter.exportTable(this.inlineQueryTable, uri.fsPath);
      return;
    }
    await exportQueryResultToFile(_headers, _rows);
  }

  private async handleClearQuery(): Promise<void> {
    if (this.inlineQueryTable) {
      await this.queryExecutor.getEngine().query(`DROP TABLE IF EXISTS "${this.inlineQueryTable}"`);
      this.tableManager.unregisterTable(this.inlineQueryTable);
      this.inlineQueryTable = null;
    }
    await this.sendCurrentPage();
  }

  /** Reset inline query state (call after engine cancel/restart). */
  protected clearInlineQuery(): void {
    if (this.inlineQueryTable) {
      this.tableManager.unregisterTable(this.inlineQueryTable);
      this.inlineQueryTable = null;
    }
    this.tableManager.invalidateView();
  }

  protected async handleFetchPage(requestId: number, offset: number, limit: number): Promise<void> {
    const tableName = this.getEffectiveTable();
    if (!tableName) { return; }

    try {
      const result = await this.tableManager.getDataPage(tableName, {
        filters: this.viewState.filters,
        sort: this.viewState.sort,
        searchTerm: this.viewState.searchTerm,
        offset,
        limit,
      });

      this.postMessage({
        type: 'pageData',
        requestId,
        offset,
        rows: result.rows,
        rowids: result.rowids,
      });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  protected postMessage(message: ExtensionMessage): void {
    if (this.disposed) { return; }
    try { this.panel.webview.postMessage(message); } catch { /* panel disposed */ }
  }

  protected postError(error: unknown): void {
    const msg = error instanceof Error ? error.message : 'An unexpected error occurred';
    this.postMessage({ type: 'error', message: msg });
  }

  protected sendHistory(): void {
    if (this.historyService && this.historyKey) {
      const history = this.historyService.getHistory(this.historyKey);
      this.postMessage({ type: 'queryHistory', history } as any);
    }
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private dispose(): void {
    this.disposed = true;
    this.onDispose();

    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
