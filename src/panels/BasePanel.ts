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
import { openQueryResultPanel } from './QueryResultPanel';

export abstract class BasePanel {
  protected readonly panel: vscode.WebviewPanel;
  protected readonly extensionUri: vscode.Uri;
  protected readonly tableManager: TableManager;
  protected readonly queryExecutor: QueryExecutor;
  protected readonly config: ConfigService;
  protected readonly disposables: vscode.Disposable[] = [];
  protected readonly viewState = new ViewState();
  protected pageRequestId: number = 0;

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
        return this.sendCurrentPage();

      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text);
        return;

      case 'fetchPage':
        return this.handleFetchPage(message.requestId, message.offset, message.limit);

      default:
        return;
    }
  }

  // ─── Shared Data Flow ────────────────────────────────────────────────────

  protected async sendCurrentPage(): Promise<void> {
    const tableName = this.getActiveTableName();
    if (!tableName) { return; }

    const requestId = ++this.pageRequestId;

    try {
      // Fetch only the first block (500 rows) — frontend will request more via fetchPage
      const firstBlockSize = 500;

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
      this.postMessage({ type: 'dataPage', data: payload });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  // ─── Common Handlers ─────────────────────────────────────────────────────

  protected async handleGetColumnValues(columnIndex: number): Promise<void> {
    const tableName = this.getActiveTableName();
    if (!tableName) { return; }

    try {
      const values = await this.tableManager.getUniqueValues(tableName, columnIndex);
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
    const result = await this.queryExecutor.execute(sql, tableName || undefined);
    const payload = { ...result, sql };

    if (mode === 'inline') {
      this.postMessage({ type: 'queryResult', data: payload });
    } else {
      openQueryResultPanel(this.extensionUri, payload);
    }
  }

  protected async handleExportQueryResult(headers: string[], rows: string[][]): Promise<void> {
    await exportQueryResultToFile(headers, rows);
  }

  protected async handleFetchPage(requestId: number, offset: number, limit: number): Promise<void> {
    const tableName = this.getActiveTableName();
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
    this.panel.webview.postMessage(message);
  }

  protected postError(error: unknown): void {
    const msg = error instanceof Error ? error.message : 'An unexpected error occurred';
    this.postMessage({ type: 'error', message: msg });
  }

  protected formatSize(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private dispose(): void {
    this.onDispose();

    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
