/**
 * CSV Workspace Panel — multi-table environment with JOIN support.
 * Extends BasePanel with: table management, table switching, tables bar.
 */

import * as vscode from 'vscode';
import { TableManager } from '../services/TableManager';
import { DuckDbEngine } from '../services/DuckDbEngine';
import { Services } from '../services/Services';
import { WebviewMessage, DataPagePayload, TableInfo } from '../types';
import { buildWorkspaceHtml } from './buildWorkspaceHtml';
import { BasePanel } from './BasePanel';

export class CsvWorkspacePanel extends BasePanel {
  private static readonly viewType = 'csvWorkspace';

  private activeTable: string = '';
  private pendingInitialUri?: vscode.Uri;

  // ─── Public API ──────────────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    services: Services,
    initialUri?: vscode.Uri
  ): void {
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

    const tableManager = new TableManager(services.engine);
    new CsvWorkspacePanel(panel, extensionUri, tableManager, services.engine, initialUri);
  }

  // ─── Constructor ─────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    tableManager: TableManager,
    engine: DuckDbEngine,
    initialUri?: vscode.Uri
  ) {
    super(panel, extensionUri, tableManager, engine, buildWorkspaceHtml(panel.webview, extensionUri));
    if (initialUri) { this.pendingInitialUri = initialUri; }
  }

  // ─── BasePanel Implementation ────────────────────────────────────────────

  protected getActiveTableName(): string {
    return this.activeTable;
  }

  protected buildPayload(
    result: { rows: string[][]; rowids: number[]; filteredCount: number },
    meta: { headers: string[]; columnTypes: string[]; delimiter: string; rowCount: number; name: string }
  ): DataPagePayload {
    return {
      headers: meta.headers,
      columnTypes: meta.columnTypes,
      rows: result.rows,
      rowids: result.rowids,
      totalRows: meta.rowCount,
      filteredRows: result.filteredCount,
      delimiter: meta.delimiter,
      fileName: meta.name,
      fileSize: 0,
      sort: this.viewState.sort,
      filters: this.viewState.filters,
      searchTerm: this.viewState.searchTerm,
      isDirty: false,
    };
  }

  protected async handleSubclassMessage(message: WebviewMessage): Promise<boolean> {
    switch (message.type) {
      case 'ready':
        if (this.pendingInitialUri) {
          await this.addTableFromUri(this.pendingInitialUri);
          this.pendingInitialUri = undefined;
        }
        this.sendTableList();
        return true;

      case 'addTable':
        await this.handleAddTable(message.filePath);
        return true;

      case 'removeTable':
        await this.handleRemoveTable(message.tableName);
        return true;

      case 'switchTable':
        await this.handleSwitchTable(message.tableName);
        return true;

      case 'cancelQuery':
        this.engine.cancel();
        this.clearInlineQuery();
        if (this.activeTable) {
          this.postMessage({ type: 'loading', loading: true });
          try {
            const tablesToReload = this.tableManager.getLoadedTables().map(t => ({ name: t.name, path: t.filePath }));
            await this.tableManager.dropAllTables();
            for (const t of tablesToReload) {
              await this.tableManager.loadTable(vscode.Uri.file(t.path), t.name);
            }
            await this.sendCurrentPage();
          } catch (error: unknown) {
            this.postError(error);
          } finally {
            this.postMessage({ type: 'loading', loading: false });
          }
        }
        return true;

      default:
        return false;
    }
  }

  protected onDispose(): void {
    this.tableManager.dropAllTables().catch(() => { /* best-effort cleanup on dispose */ });
  }

  // ─── Workspace-specific Logic ────────────────────────────────────────────

  private async addTableFromUri(uri: vscode.Uri): Promise<void> {
    const fileName = uri.fsPath.split('/').pop() || 'file';
    this.postMessage({ type: 'loading', loading: true, message: `Loading ${fileName}...` });

    try {
      const meta = await this.tableManager.loadTable(uri);
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

  private async handleAddTable(filePath: string): Promise<void> {
    if (filePath) {
      await this.addTableFromUri(vscode.Uri.file(filePath));
      return;
    }

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
        if (!this.activeTable) { this.activeTable = meta.name; }
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

    if (this.activeTable === tableName) {
      const tables = this.tableManager.getLoadedTables();
      this.activeTable = tables.length > 0 ? tables[0].name : '';
      this.viewState.reset();
    }

    this.sendTableList();

    if (this.activeTable) {
      await this.sendCurrentPage();
    } else {
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
      headers: [], columnTypes: [], rows: [], rowids: [],
      totalRows: 0, filteredRows: 0, delimiter: '', fileName: '',
      fileSize: 0, sort: { columnIndex: -1, direction: 'none' },
      filters: {}, searchTerm: '', isDirty: false,
    };
  }
}
