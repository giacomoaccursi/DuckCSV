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
import { DuckDbEngine } from '../services/DuckDbEngine';
import { TableExporter } from '../services/TableExporter';
import { InlineQueryManager } from '../services/InlineQueryManager';
import { ISidePanelOpener } from './SidePanelOpener';
import { ViewState } from '../shared/ViewState';
import { BLOCK_SIZE } from '../shared/constants';
import { pickFormatAndSave } from '../shared/formatPicker';
import { exportQueryResultToFile } from '../shared/exportQueryResult';
import { WebviewMessage, ExtensionMessage, DataPagePayload } from '../types';
import { QueryHistoryService } from '../services/QueryHistoryService';
import { ColumnProfilePanel } from './ColumnProfilePanel';

export abstract class BasePanel {
  protected readonly panel: vscode.WebviewPanel;
  protected readonly extensionUri: vscode.Uri;
  protected readonly tableManager: TableManager;
  protected readonly engine: DuckDbEngine;
  protected readonly sidePanelOpener: ISidePanelOpener;
  protected readonly disposables: vscode.Disposable[] = [];
  protected readonly viewState = new ViewState();
  protected readonly inlineQuery: InlineQueryManager;
  protected pageRequestId: number = 0;
  private disposed = false;
  protected historyService?: QueryHistoryService;
  protected historyKey: string = '';

  constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    tableManager: TableManager,
    engine: DuckDbEngine,
    sidePanelOpener: ISidePanelOpener,
    html: string
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.tableManager = tableManager;
    this.engine = engine;
    this.sidePanelOpener = sidePanelOpener;
    this.inlineQuery = new InlineQueryManager(engine, tableManager);

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
        return this.handleGetColumnValues(message.columnIndex, message.afterValue);

      case 'searchColumnValues':
        return this.handleSearchColumnValues(message.columnIndex, message.term);

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

      case 'profileColumn':
        return this.handleProfileColumn(message.columnIndex);

      default:
        return;
    }
  }

  // ─── Shared Data Flow ────────────────────────────────────────────────────

  /** The effective table: inline query table if active, otherwise the panel's table. */
  private getEffectiveTable(): string {
    return this.inlineQuery.getEffectiveTable(this.getActiveTableName());
  }

  protected async sendCurrentPage(): Promise<void> {
    const tableName = this.getEffectiveTable();
    if (!tableName) { return; }

    const requestId = ++this.pageRequestId;

    try {
      // Fetch only the first block — frontend will request more via fetchPage
      const result = await this.tableManager.getDataPage(tableName, {
        filters: this.viewState.filters,
        sort: this.viewState.sort,
        searchTerm: this.viewState.searchTerm,
        offset: 0,
        limit: BLOCK_SIZE,
      });

      // Discard stale response if a newer request was issued
      if (requestId !== this.pageRequestId) { return; }

      const meta = this.tableManager.getTableMeta(tableName);
      if (!meta) { return; }

      const payload = this.buildPayload(result, meta);
      payload.isQueryResult = this.inlineQuery.isActive();
      this.postMessage({ type: 'dataPage', data: payload });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  // ─── Common Handlers ─────────────────────────────────────────────────────

  protected async handleGetColumnValues(columnIndex: number, afterValue?: string): Promise<void> {
    const tableName = this.getEffectiveTable();
    if (!tableName) { return; }

    try {
      const values = await this.tableManager.getUniqueValues(
        tableName, columnIndex, this.viewState.filters, this.viewState.searchTerm, afterValue
      );
      this.postMessage({
        type: 'columnValues',
        data: { columnIndex, values, totalCount: values.length, isAppend: afterValue !== undefined },
      });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  protected async handleSearchColumnValues(columnIndex: number, term: string): Promise<void> {
    const tableName = this.getEffectiveTable();
    if (!tableName) { return; }

    try {
      const values = await this.tableManager.searchUniqueValues(
        tableName, columnIndex, term, this.viewState.filters, this.viewState.searchTerm
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
      const meta = this.tableManager.getTableMeta(tableName || '');
      const sourceFileName = meta?.filePath ? meta.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') : 'query';
      await this.sidePanelOpener.open(this.extensionUri, this.engine, sql, sourceFileName);
      return;
    }

    const result = await this.inlineQuery.executeInline(sql);
    if (result.cancelled) { return; }
    if (result.error) {
      this.postMessage({ type: 'queryError', message: result.error });
      return;
    }

    this.viewState.reset();
    await this.sendCurrentPage();
  }

  protected async handleExportQueryResult(_headers: string[], _rows: string[][]): Promise<void> {
    // If inline query is active, export from the temp table
    const inlineTable = this.inlineQuery.getActiveTable();
    if (inlineTable) {
      const meta = this.tableManager.getTableMeta(this.getActiveTableName());
      const baseName = meta?.filePath ? meta.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') : 'query';
      const uri = await pickFormatAndSave({ defaultName: `${baseName}_query_result` });
      if (!uri) { return; }
      try {
        const exporter = new TableExporter(this.engine, this.tableManager);
        await exporter.exportAuto(inlineTable, uri.fsPath);
        vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
      } catch (error: unknown) {
        this.postError(error);
      }
      return;
    }
    await exportQueryResultToFile(_headers, _rows);
  }

  private async handleClearQuery(): Promise<void> {
    await this.inlineQuery.clear();
    await this.sendCurrentPage();
  }

  /** Reset inline query state (call after engine cancel/restart). */
  protected clearInlineQuery(): void {
    this.inlineQuery.reset();
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

  protected async handleProfileColumn(columnIndex: number): Promise<void> {
    const tableName = this.getEffectiveTable();
    if (!tableName) { return; }

    try {
      const profile = await this.tableManager.getColumnProfile(tableName, columnIndex);
      ColumnProfilePanel.open(this.extensionUri, profile);
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
      this.postMessage({ type: 'queryHistory', history });
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
