/**
 * CSV Preview Panel — single-file preview with editing support.
 * Extends BasePanel with: cell editing, row insert/delete, persistence, mode banner.
 */

import * as vscode from 'vscode';
import { basename } from 'path';
import { TableManager } from '../services/TableManager';
import { QueryExecutor } from '../services/QueryExecutor';
import { TableExporter } from '../services/TableExporter';
import { ConfigService } from '../services/ConfigService';
import { WebviewMessage, DataPagePayload } from '../types';
import { buildPreviewHtml } from './buildPreviewHtml';
import { EditMode } from '../commands/previewCommand';
import { BasePanel } from './BasePanel';

export class CsvPreviewPanel extends BasePanel {
  private static readonly viewType = 'csvPreview';
  private static panels = new Map<string, CsvPreviewPanel>();

  private readonly tableExporter: TableExporter;
  private readonly mode: EditMode;
  private readonly savePath: string;

  private currentUri: vscode.Uri;
  private tableName: string = '';
  private fileName: string = '';
  private fileSize: number = 0;
  private totalRows: number = 0;
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
    super(panel, extensionUri, tableManager, queryExecutor, config, buildPreviewHtml(panel.webview, extensionUri));
    this.tableExporter = tableExporter;
    this.currentUri = uri;
    this.mode = mode;
    this.savePath = savePath;
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
        this.postMessage({ type: 'modeInfo', mode: this.mode, savePath: this.savePath });
        await this.loadDocument();
        return true;
      case 'refresh':
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
    CsvPreviewPanel.panels.delete(`${this.currentUri.toString()}:${this.mode}`);

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      this.doExport().catch(() => {});
    }

    if (this.tableName) {
      this.tableManager.dropTable(this.tableName).catch(() => {});
    }
  }

  // ─── Preview-specific Logic ──────────────────────────────────────────────

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

      this.panel.title = `Preview: ${this.fileName}`;
      await this.sendCurrentPage();
    } catch (error: unknown) {
      this.postError(error);
    } finally {
      this.postMessage({ type: 'loading', loading: false });
    }
  }

  private async handleEditCell(rowid: number, columnIndex: number, value: string): Promise<void> {
    try {
      await this.tableManager.updateCell(this.tableName, rowid, columnIndex, value);
      this.isDirty = true;
      this.persistToDisk();
      this.postMessage({ type: 'cellEditConfirm', data: { rowid, columnIndex, value } });
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

  private persistToDisk(): void {
    if (this.persistTimer) { clearTimeout(this.persistTimer); }
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

  private resetState(): void {
    this.viewState.reset();
    this.isDirty = false;
  }

  private reloadFromDisk(): void {
    this.resetState();
    this.loadDocument();
  }
}
