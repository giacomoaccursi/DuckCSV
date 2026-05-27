/**
 * CSV Workspace Panel — multi-table environment with JOIN support.
 * Extends BasePanel with: table management, table switching, tables bar.
 */

import * as vscode from 'vscode';
import { TableManager } from '../services/TableManager';
import { DuckDbEngine } from '../services/DuckDbEngine';
import { Services } from '../services/Services';
import { defaultSidePanelOpener } from './SidePanelOpener';
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
    super(panel, extensionUri, tableManager, engine, defaultSidePanelOpener, buildWorkspaceHtml(panel.webview, extensionUri));
    if (initialUri) { this.pendingInitialUri = initialUri; }

    // Reload tables when the panel becomes visible again (user switches back to this tab).
    // This ensures edited files are re-read from disk.
    this.panel.onDidChangeViewState(
      async (e) => {
        if (e.webviewPanel.visible) {
          await this.reloadAllIfChanged();
        }
      },
      null,
      this.disposables
    );
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
    this.clearInlineQuery();
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
      filters: { 'Data Files': ['csv', 'tsv', 'parquet'] },
      title: 'Add tables to workspace',
    });
    if (!uris || uris.length === 0) { return; }

    this.clearInlineQuery();
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
    this.clearInlineQuery();

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
    this.clearInlineQuery();
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

  /**
   * Check all loaded tables for file changes on disk.
   * If any file was modified, reload it so the workspace shows fresh data.
   */
  private async reloadAllIfChanged(): Promise<void> {
    const tables = this.tableManager.getLoadedTables();
    if (tables.length === 0) { return; }

    // Find which files have changed
    const changed: { filePath: string; name: string }[] = [];
    for (const meta of tables) {
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(meta.filePath));
        const lastKnown = TableManager.getFileMtime(meta.filePath);
        if (lastKnown !== undefined && stat.mtime !== lastKnown) {
          changed.push({ filePath: meta.filePath, name: meta.name });
        }
      } catch { /* file may not exist */ }
    }

    if (changed.length === 0) { return; }

    // Only reload the changed files — loadTable handles the worker restart
    // and restores unchanged tables internally.
    this.postMessage({ type: 'loading', loading: true });
    try {
      for (const t of changed) {
        await this.tableManager.loadTable(vscode.Uri.file(t.filePath), t.name);
      }
      this.sendTableList();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    } finally {
      this.postMessage({ type: 'loading', loading: false });
    }
  }
}
