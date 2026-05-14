/**
 * CSV Workspace Panel — multi-table environment with JOIN support.
 *
 * Responsibilities:
 *  - Manage multiple loaded tables
 *  - Switch active table for grid display
 *  - Route messages for query, sort, filter, search
 *  - No cell editing (read-only workspace)
 */

import * as vscode from 'vscode';
import { DuckDbEngine } from '../services/DuckDbEngine';
import { TableManager } from '../services/TableManager';
import { QueryExecutor } from '../services/QueryExecutor';
import { ConfigService } from '../services/ConfigService';
import { ViewState } from '../shared/ViewState';
import { WebviewMessage, ExtensionMessage, DataPagePayload, TableInfo } from '../types';
import { buildWorkspaceHtml } from './buildWorkspaceHtml';
import { openQueryResultPanel } from './QueryResultPanel';

export class CsvWorkspacePanel {
  private static readonly viewType = 'csvWorkspace';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly tableManager: TableManager;
  private readonly queryExecutor: QueryExecutor;
  private readonly config: ConfigService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly viewState = new ViewState();

  private activeTable: string = '';

  // ─── Public API ──────────────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    engine: DuckDbEngine,
    queryExecutor: QueryExecutor,
    config: ConfigService,
    initialUri?: vscode.Uri
  ): void {
    // Always create a new workspace — each one is independent
    const panel = vscode.window.createWebviewPanel(
      CsvWorkspacePanel.viewType,
      'CSV Workspace',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableForms: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    // Each workspace gets its own TableManager (isolated table set)
    const tableManager = new TableManager(engine);

    new CsvWorkspacePanel(panel, extensionUri, tableManager, queryExecutor, config, initialUri);
  }

  // ─── Constructor ─────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    tableManager: TableManager,
    queryExecutor: QueryExecutor,
    config: ConfigService,
    initialUri?: vscode.Uri
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

    this.panel.webview.html = buildWorkspaceHtml(this.panel.webview, this.extensionUri);

    if (initialUri) {
      this.pendingInitialUri = initialUri;
    }
  }

  private pendingInitialUri?: vscode.Uri;

  // ─── Message Router ──────────────────────────────────────────────────────

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        if (this.pendingInitialUri) {
          await this.addTableFromUri(this.pendingInitialUri);
          this.pendingInitialUri = undefined;
        }
        this.sendTableList();
        return;

      case 'addTable':
        await this.handleAddTable(message.filePath);
        return;

      case 'removeTable':
        await this.handleRemoveTable(message.tableName);
        return;

      case 'switchTable':
        await this.handleSwitchTable(message.tableName);
        return;

      case 'loadMore':
        this.viewState.nextPage(this.config.pageSize);
        return this.sendCurrentPage();

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

      case 'clearQuery':
        return this.sendCurrentPage();

      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text);
        return;

      default:
        return;
    }
  }

  // ─── Table Management ────────────────────────────────────────────────────

  private async addTableFromUri(uri: vscode.Uri): Promise<void> {
    this.postMessage({ type: 'loading', loading: true });

    try {
      const meta = await this.tableManager.loadTable(uri);

      // Set as active if first table
      if (!this.activeTable) {
        this.activeTable = meta.name;
        this.viewState.reset();
      }

      this.sendTableList();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    } finally {
      this.postMessage({ type: 'loading', loading: false });
    }
  }

  private async handleAddTable(_filePath: string): Promise<void> {
    // If filePath provided (from drag and drop), use it directly
    if (_filePath) {
      const uri = vscode.Uri.file(_filePath);
      await this.addTableFromUri(uri);
      return;
    }

    // Otherwise open file picker
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { 'CSV Files': ['csv', 'tsv'] },
      title: 'Add CSV tables to workspace',
    });

    if (!uris || uris.length === 0) { return; }

    this.postMessage({ type: 'loading', loading: true });

    try {
      for (const uri of uris) {
        const meta = await this.tableManager.loadTable(uri);
        if (!this.activeTable) {
          this.activeTable = meta.name;
        }
      }

      this.viewState.reset();
      this.sendTableList();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    } finally {
      this.postMessage({ type: 'loading', loading: false });
    }
  }

  private async handleRemoveTable(tableName: string): Promise<void> {
    await this.tableManager.dropTable(tableName);

    // If removed the active table, switch to another
    if (this.activeTable === tableName) {
      const tables = this.tableManager.getLoadedTables();
      this.activeTable = tables.length > 0 ? tables[0].name : '';
      this.viewState.reset();
    }

    this.sendTableList();

    if (this.activeTable) {
      await this.sendCurrentPage();
    } else {
      // No tables left — show empty state
      this.postMessage({ type: 'dataPage', data: this.emptyPayload() });
    }
  }

  private async handleSwitchTable(tableName: string): Promise<void> {
    const meta = this.tableManager.getTableMeta(tableName);
    if (!meta) { return; }

    this.activeTable = tableName;
    this.viewState.reset();
    await this.sendCurrentPage();
  }

  // ─── Data Page ───────────────────────────────────────────────────────────

  private async sendCurrentPage(): Promise<void> {
    if (!this.activeTable) { return; }

    try {
      const meta = this.tableManager.getTableMeta(this.activeTable);
      if (!meta) { return; }

      const limit = this.viewState.pageOffset + this.config.pageSize;

      const result = await this.tableManager.getDataPage(this.activeTable, {
        filters: this.viewState.filters,
        sort: this.viewState.sort,
        searchTerm: this.viewState.searchTerm,
        offset: 0,
        limit,
      });

      const payload: DataPagePayload = {
        headers: meta.headers,
        columnTypes: meta.columnTypes,
        rows: result.rows,
        rowids: result.rowids,
        totalRows: meta.rowCount,
        filteredRows: result.filteredCount,
        pageOffset: 0,
        pageSize: limit,
        hasMore: limit < result.filteredCount,
        delimiter: meta.delimiter,
        fileName: meta.name,
        fileSize: 0,
        sort: this.viewState.sort,
        filters: this.viewState.filters,
        searchTerm: this.viewState.searchTerm,
        isDirty: false,
      };

      this.postMessage({ type: 'dataPage', data: payload });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  private async handleGetColumnValues(columnIndex: number): Promise<void> {
    if (!this.activeTable) { return; }

    try {
      const values = await this.tableManager.getUniqueValues(this.activeTable, columnIndex);
      this.postMessage({
        type: 'columnValues',
        data: { columnIndex, values, totalCount: values.length },
      });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleQuery(sql: string, mode: 'inline' | 'side'): Promise<void> {
    // Workspace: no default table — user must specify table names in query
    const result = await this.queryExecutor.execute(sql);
    const payload = { ...result, sql };

    if (mode === 'inline') {
      this.postMessage({ type: 'queryResult', data: payload });
    } else {
      openQueryResultPanel(this.extensionUri, payload);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private sendTableList(): void {
    const tables: TableInfo[] = this.tableManager.getLoadedTables().map(meta => ({
      name: meta.name,
      headers: meta.headers,
      rowCount: meta.rowCount,
      filePath: meta.filePath,
    }));

    this.postMessage({ type: 'tableList', tables });
  }

  private emptyPayload(): DataPagePayload {
    return {
      headers: [],
      columnTypes: [],
      rows: [],
      rowids: [],
      totalRows: 0,
      filteredRows: 0,
      pageOffset: 0,
      pageSize: 0,
      hasMore: false,
      delimiter: '',
      fileName: '',
      fileSize: 0,
      sort: { columnIndex: -1, direction: 'none' },
      filters: {},
      searchTerm: '',
      isDirty: false,
    };
  }

  private postMessage(message: ExtensionMessage): void {
    this.panel.webview.postMessage(message);
  }

  private postError(error: unknown): void {
    const msg = error instanceof Error ? error.message : 'An unexpected error occurred';
    this.postMessage({ type: 'error', message: msg });
  }

  private dispose(): void {
    // Drop all tables owned by this workspace
    this.tableManager.dropAllTables().catch(() => {});

    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
