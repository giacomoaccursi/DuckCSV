/**
 * CSV Preview Panel — single-file viewer with editing and manual save.
 * Always editable. Save writes to original file, Save As to a new file.
 */

import * as vscode from 'vscode';
import { basename } from 'path';
import { TableManager } from '../services/TableManager';
import { QueryExecutor } from '../services/QueryExecutor';
import { TableExporter } from '../services/TableExporter';
import { ConfigService } from '../services/ConfigService';
import { WebviewMessage, DataPagePayload } from '../types';
import { buildPreviewHtml } from './buildPreviewHtml';
import { BasePanel } from './BasePanel';

export class CsvPreviewPanel extends BasePanel {
  private static readonly viewType = 'csvPreview';
  private static panels = new Map<string, CsvPreviewPanel>();

  private readonly tableExporter: TableExporter;

  private currentUri: vscode.Uri;
  private tableName: string = '';
  private fileName: string = '';
  private fileSize: number = 0;
  private totalRows: number = 0;
  private isDirty: boolean = false;

  // ─── Public API ──────────────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    tableManager: TableManager,
    queryExecutor: QueryExecutor,
    tableExporter: TableExporter,
    config: ConfigService,
    uri: vscode.Uri,
    viewColumn: vscode.ViewColumn | undefined
  ): void {
    const column = viewColumn || vscode.ViewColumn.Beside;
    const key = uri.toString();

    const existing = CsvPreviewPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(column);
      existing.reloadFromDisk();
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

    const instance = new CsvPreviewPanel(panel, extensionUri, tableManager, queryExecutor, tableExporter, config, uri);
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
    uri: vscode.Uri
  ) {
    super(panel, extensionUri, tableManager, queryExecutor, config, buildPreviewHtml(panel.webview, extensionUri));
    this.tableExporter = tableExporter;
    this.currentUri = uri;
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
    };
  }

  protected async handleSubclassMessage(message: WebviewMessage): Promise<boolean> {
    switch (message.type) {
      case 'ready':
        await this.loadDocument();
        return true;
      case 'refresh':
        if (this.isDirty) {
          const answer = await vscode.window.showWarningMessage(
            'You have unsaved changes. Reload will discard them.',
            'Reload', 'Cancel'
          );
          if (answer !== 'Reload') { return true; }
        }
        this.resetState();
        await this.loadDocument();
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
        this.queryExecutor.cancel();
        await this.loadDocument();
        return true;
      case 'openAsText':
        await vscode.window.showTextDocument(this.currentUri);
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
      this.tableManager.dropTable(this.tableName).catch(() => {});
    }
  }

  // ─── Save ────────────────────────────────────────────────────────────────

  private async handleSave(): Promise<void> {
    await this.doExport(this.currentUri.fsPath);
  }

  private async handleSaveAs(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: this.currentUri,
      filters: { 'CSV Files': ['csv', 'tsv'], 'All Files': ['*'] },
      title: 'Save As',
    });
    if (!uri) { return; }
    await this.doExport(uri.fsPath);
  }

  private async doExport(outputPath: string): Promise<void> {
    this.postMessage({ type: 'saving', saving: true });
    try {
      await this.tableExporter.exportTable(this.tableName, outputPath);
      this.isDirty = false;
      this.panel.title = this.fileName;
      this.postMessage({ type: 'saved' });
      await this.sendCurrentPage();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to save file';
      vscode.window.showErrorMessage(`CSV save error: ${msg}`);
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

      this.postMessage({ type: 'loading', loading: true, message: `Loading ${this.fileName} (${this.formatSize(this.fileSize)})...` });

      const meta = await this.tableManager.loadTable(this.currentUri, 'csv');
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
      await this.tableManager.updateCell(this.tableName, rowid, columnIndex, value);
      this.markDirty();
      // Confirm the edit — frontend already updated the cell locally.
      // Don't call sendCurrentPage() to avoid expensive view rebuild on every keystroke.
      this.postMessage({ type: 'cellEditConfirm', data: { rowid, columnIndex, value } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleAddRow(): Promise<void> {
    try {
      await this.tableManager.addRow(this.tableName);
      this.totalRows++;
      this.markDirty();
      this.viewState.applyFilters({});
      this.viewState.applySearch('');
      this.postMessage({ type: 'rowMutation', data: { totalRows: this.totalRows, action: 'add' } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleAddRowAt(rowid: number, position: 'above' | 'below'): Promise<void> {
    try {
      await this.tableManager.addRowAt(this.tableName, rowid, position);
      this.totalRows++;
      this.markDirty();
      this.postMessage({ type: 'rowMutation', data: { totalRows: this.totalRows, action: 'add', rowid, position } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleDeleteRow(rowid: number): Promise<void> {
    try {
      await this.tableManager.deleteRow(this.tableName, rowid);
      this.totalRows--;
      this.markDirty();
      this.postMessage({ type: 'rowMutation', data: { totalRows: this.totalRows, action: 'delete', rowids: [rowid] } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  private async handleDeleteRows(rowids: number[]): Promise<void> {
    try {
      await this.tableManager.deleteRows(this.tableName, rowids);
      this.totalRows -= rowids.length;
      this.markDirty();
      this.postMessage({ type: 'rowMutation', data: { totalRows: this.totalRows, action: 'delete', rowids } });
    } catch (error: unknown) {
      this.postError(error);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private markDirty(): void {
    this.isDirty = true;
    this.panel.title = `● ${this.fileName}`;
  }

  private resetState(): void {
    this.viewState.reset();
    this.isDirty = false;
  }

  private reloadFromDisk(): void {
    this.resetState();
    this.loadDocument();
  }
}
