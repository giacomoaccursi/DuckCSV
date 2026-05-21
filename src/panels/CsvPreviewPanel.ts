/**
 * CSV Preview Panel — single-file viewer with editing and manual save.
 * Always editable. Save writes to original file, Save As to a new file.
 */

import * as vscode from 'vscode';
import { basename } from 'path';
import { TableExporter } from '../services/TableExporter';
import { Services } from '../services/Services';
import { defaultSidePanelOpener } from './SidePanelOpener';
import { CommandHistory, EditCellCommand, InsertRowCommand, DeleteRowCommand } from '../services/CommandHistory';
import { pickFormatAndSave } from '../shared/formatPicker';
import { WebviewMessage, DataPagePayload } from '../types';
import { buildPreviewHtml } from './buildPreviewHtml';
import { BasePanel } from './BasePanel';

export class CsvPreviewPanel extends BasePanel {
  private static readonly viewType = 'csvPreview';
  private static panels = new Map<string, CsvPreviewPanel>();

  private readonly tableExporter: TableExporter;
  private readonly commandHistory = new CommandHistory();

  private currentUri: vscode.Uri;
  private tableName: string = '';
  private fileName: string = '';
  private fileSize: number = 0;
  private totalRows: number = 0;
  private isDirty: boolean = false;
  private lastMtime: number = 0;

  // ─── Public API ──────────────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    services: Services,
    uri: vscode.Uri,
    viewColumn: vscode.ViewColumn | undefined
  ): void {
    const column = viewColumn || vscode.ViewColumn.Beside;
    const key = uri.toString();

    const existing = CsvPreviewPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(column);
      existing.reloadIfChanged();
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

    const instance = new CsvPreviewPanel(panel, extensionUri, services, uri);
    CsvPreviewPanel.panels.set(key, instance);
  }

  // ─── Constructor ─────────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    services: Services,
    uri: vscode.Uri
  ) {
    super(panel, extensionUri, services.tableManager, services.engine, defaultSidePanelOpener, buildPreviewHtml(panel.webview, extensionUri));
    this.tableExporter = services.tableExporter;
    this.currentUri = uri;
    this.historyService = services.queryHistory;
    this.historyKey = uri.fsPath;
  }

  // ─── BasePanel Implementation ────────────────────────────────────────────

  protected getActiveTableName(): string {
    return this.tableName;
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
      totalRows: this.totalRows,
      filteredRows: result.filteredCount,
      delimiter: meta.delimiter,
      fileName: this.fileName,
      fileSize: this.fileSize,
      sort: this.viewState.sort,
      filters: this.viewState.filters,
      searchTerm: this.viewState.searchTerm,
      isDirty: this.isDirty,
      tableName: this.tableName,
    };
  }

  protected async handleSubclassMessage(message: WebviewMessage): Promise<boolean> {
    switch (message.type) {
      case 'ready':
        await this.loadDocument();
        this.sendHistory();
        return true;
      case 'editCell':
        await this.handleEditCell(message.rowid, message.columnIndex, message.value);
        return true;
      case 'addRow':
        await this.handleAddRow();
        return true;
      case 'addRowAt':
        await this.handleAddRowAt(message.rowid, message.position);
        return true;
      case 'deleteRow':
        await this.handleDeleteRow(message.rowid);
        return true;
      case 'deleteRows':
        await this.handleDeleteRows(message.rowids);
        return true;
      case 'save':
        await this.handleSave();
        return true;
      case 'saveAs':
        await this.handleSaveAs();
        return true;
      case 'cancelQuery':
        this.engine.cancel();
        this.clearInlineQuery();
        await this.loadDocument();
        return true;
      case 'undo':
        await this.handleUndo();
        return true;
      case 'redo':
        await this.handleRedo();
        return true;
      case 'openWorkspace':
        await vscode.commands.executeCommand('duckcsv.workspace', this.currentUri);
        return true;
      default:
        return false;
    }
  }

  protected onDispose(): void {
    CsvPreviewPanel.panels.delete(this.currentUri.toString());

    if (this.isDirty) {
      // Can't show async dialog in dispose — just warn
      vscode.window.showWarningMessage('DuckCSV: Unsaved changes were lost.');
    }

    if (this.tableName) {
      this.tableManager.dropTable(this.tableName).catch(() => { /* best-effort cleanup on dispose */ });
    }
  }

  // ─── Save ────────────────────────────────────────────────────────────────

  private async handleSave(): Promise<void> {
    await this.doExport(this.currentUri.fsPath);
  }

  private async handleSaveAs(): Promise<void> {
    const uri = await pickFormatAndSave({
      defaultName: this.currentUri.fsPath,
      defaultExtension: this.currentUri.fsPath.endsWith('.tsv') ? 'tsv' : 'csv',
    });
    if (!uri) { return; }
    await this.doExport(uri.fsPath);
  }

  private async doExport(outputPath: string): Promise<void> {
    this.postMessage({ type: 'saving', saving: true });
    try {
      await this.tableManager.awaitPendingRebuild();
      await this.tableExporter.exportAuto(this.tableName, outputPath);
      this.isDirty = false;
      this.panel.title = this.fileName;

      // Update lastMtime so reloadIfChanged doesn't trigger unnecessarily
      try {
        const stat = await vscode.workspace.fs.stat(this.currentUri);
        this.lastMtime = stat.mtime;
      } catch { /* ignore */ }

      this.postMessage({ type: 'saved' });
      await this.sendCurrentPage();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to save file';
      vscode.window.showErrorMessage(`Save error: ${msg}`);
    } finally {
      this.postMessage({ type: 'saving', saving: false });
    }
  }

  // ─── Data Loading ────────────────────────────────────────────────────────

  private async loadDocument(): Promise<void> {
    this.postMessage({ type: 'loading', loading: true });

    try {
      const stat = await vscode.workspace.fs.stat(this.currentUri);
      this.fileSize = stat.size;
      this.fileName = basename(this.currentUri.fsPath);
      this.lastMtime = stat.mtime;

      this.postMessage({ type: 'loading', loading: true, message: `Loading ${this.fileName} (${this.formatSize(this.fileSize)})...` });

      let tableName = this.fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (/^\d/.test(tableName)) { tableName = '_' + tableName; }
      const meta = await this.tableManager.loadTable(this.currentUri, tableName);
      this.tableName = meta.name;
      this.totalRows = meta.rowCount;

      this.panel.title = `${this.fileName}`;
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    } finally {
      this.postMessage({ type: 'loading', loading: false });
    }
  }

  // ─── Edit Handlers ───────────────────────────────────────────────────────

  private async handleEditCell(rowid: number, columnIndex: number, value: string): Promise<void> {
    try {
      const meta = this.tableManager.getTableMeta(this.tableName);
      const previousValue = meta ? await this.getCellValue(rowid, columnIndex) : '';

      const cmd = new EditCellCommand(this.tableManager, this.tableName, rowid, columnIndex, value);
      cmd.setPreviousValue(previousValue);
      await this.commandHistory.execute(cmd);

      this.markDirty();
      const updatedMeta = this.tableManager.getTableMeta(this.tableName);
      this.postMessage({ type: 'cellEditConfirm', data: { rowid, columnIndex, value, columnTypes: updatedMeta?.columnTypes } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleAddRow(): Promise<void> {
    try {
      const cmd = new InsertRowCommand(this.tableManager, this.tableName);
      await this.commandHistory.execute(cmd);
      this.totalRows++;
      this.markDirty();
      this.viewState.applyFilters({});
      this.viewState.applySearch('');
      this.postMessage({ type: 'rowMutation', data: { totalRows: this.totalRows, filteredRows: this.totalRows } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleAddRowAt(rowid: number, position: 'above' | 'below'): Promise<void> {
    try {
      await this.tableManager.addRowAt(this.tableName, rowid, position);
      this.totalRows++;
      this.markDirty();
      this.postMessage({ type: 'rowMutation', data: { totalRows: this.totalRows, filteredRows: this.totalRows } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleDeleteRow(rowid: number): Promise<void> {
    try {
      const cmd = new DeleteRowCommand(this.tableManager, this.engine, this.tableName, rowid);
      await this.commandHistory.execute(cmd);
      this.totalRows--;
      this.markDirty();
      this.postMessage({ type: 'rowMutation', data: { totalRows: this.totalRows, filteredRows: this.totalRows } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleDeleteRows(rowids: number[]): Promise<void> {
    try {
      await this.tableManager.deleteRows(this.tableName, rowids);
      this.totalRows -= rowids.length;
      this.markDirty();
      this.postMessage({ type: 'rowMutation', data: { totalRows: this.totalRows, filteredRows: this.totalRows } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private markDirty(): void {
    this.isDirty = true;
    this.panel.title = `● ${this.fileName}`;
  }

  private async handleUndo(): Promise<void> {
    if (!this.commandHistory.canUndo()) { return; }
    try {
      await this.commandHistory.undo();
      this.tableManager.invalidateView();
      this.markDirty();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleRedo(): Promise<void> {
    if (!this.commandHistory.canRedo()) { return; }
    try {
      await this.commandHistory.redo();
      this.tableManager.invalidateView();
      this.markDirty();
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async getCellValue(rowid: number, columnIndex: number): Promise<string> {
    try {
      const meta = this.tableManager.getTableMeta(this.tableName);
      if (!meta) { return ''; }
      const colName = `"${meta.headers[columnIndex].replace(/"/g, '""')}"`;
      const tableName = `"${this.tableName.replace(/"/g, '""')}"`;
      const result = await this.engine.query(
        `SELECT CAST(${colName} AS VARCHAR) FROM ${tableName} WHERE rowid = ${rowid}`
      );
      return result.rows[0]?.[0] || '';
    } catch { return ''; }
  }

  private async reloadIfChanged(): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(this.currentUri);
      if (stat.mtime !== this.lastMtime) {
        this.viewState.reset();
        this.isDirty = false;
        await this.loadDocument();
      }
    } catch { /* file might not exist */ }
  }
}
