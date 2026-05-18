/**
 * Query Result Panel — displays SQL query results in a side panel.
 * Uses the same virtual scrolling and lazy loading as the main preview.
 * Results are stored in a temp table and served via getDataPage.
 */

import * as vscode from 'vscode';
import { DuckDbEngine } from '../services/DuckDbEngine';
import { TableManager } from '../services/TableManager';
import { QueryExecutor } from '../services/QueryExecutor';
import { pickFormatAndSave } from '../shared/formatPicker';
import { WebviewMessage, DataPagePayload } from '../types';
import { BasePanel } from './BasePanel';
import { buildQueryResultHtml } from './buildQueryResultHtml';

export class QueryResultPanel extends BasePanel {
  private static counter = 0;

  private tableName: string;
  private sql: string;
  private totalRows: number;
  private sourceFileName: string;

  static async open(
    extensionUri: vscode.Uri,
    engine: DuckDbEngine,
    queryExecutor: QueryExecutor,
    sql: string,
    sourceFileName?: string
  ): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'csvQueryResult',
      `Result: ${sql.slice(0, 40)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    const tableManager = new TableManager(engine);
    const tableName = `__qr_${Date.now()}_${QueryResultPanel.counter++}`;

    // Execute query into a temp table
    try {
      const finalSql = sql.trim();

      await engine.query(`CREATE TABLE "${tableName}" AS ${finalSql}`);
    } catch (err: unknown) {
      panel.webview.html = QueryResultPanel.buildErrorHtml(panel.webview, extensionUri, sql, err);
      return;
    }

    // Get metadata
    const schemaResult = await engine.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position`
    );
    const headers = schemaResult.rows.map(r => r[0]);
    const columnTypes = schemaResult.rows.map(r => r[1]);
    const countResult = await engine.query(`SELECT COUNT(*) FROM "${tableName}"`);
    const totalRows = Number(countResult.rows[0][0]);

    // Register in TableManager so getDataPage works
    tableManager.registerTable({
      name: tableName,
      filePath: '',
      delimiter: 'Comma',
      delimiterChar: ',',
      headers,
      columnTypes,
      originalTypes: [...columnTypes],
      rowCount: totalRows,
    });

    new QueryResultPanel(panel, extensionUri, tableManager, queryExecutor, tableName, sql, totalRows, sourceFileName || 'query');
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    tableManager: TableManager,
    queryExecutor: QueryExecutor,
    tableName: string,
    sql: string,
    totalRows: number,
    sourceFileName: string
  ) {
    super(panel, extensionUri, tableManager, queryExecutor, buildQueryResultHtml(panel.webview, extensionUri));
    this.tableName = tableName;
    this.sql = sql;
    this.totalRows = totalRows;
    this.sourceFileName = sourceFileName;
  }

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
      fileName: `SQL: ${this.sql}`,
      fileSize: 0,
      sort: this.viewState.sort,
      filters: this.viewState.filters,
      searchTerm: this.viewState.searchTerm,
      isDirty: false,
      isQueryResult: true,
    };
  }

  protected async handleSubclassMessage(message: WebviewMessage): Promise<boolean> {
    switch (message.type) {
      case 'ready':
        await this.sendCurrentPage();
        return true;
      case 'exportQueryResult':
        await this.handleExport();
        return true;
      default:
        return false;
    }
  }

  protected onDispose(): void {
    this.tableManager.dropTable(this.tableName).catch(() => {});
  }

  private async handleExport(): Promise<void> {
    const uri = await pickFormatAndSave({
      defaultName: `${this.sourceFileName}_query_result`,
    });
    if (!uri) { return; }

    const { TableExporter } = await import('../services/TableExporter');
    const exporter = new TableExporter(this.queryExecutor.getEngine(), this.tableManager);
    await exporter.exportAuto(this.tableName, uri.fsPath);
    vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private static buildErrorHtml(webview: vscode.Webview, extensionUri: vscode.Uri, sql: string, err: unknown): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));
    const psyduckUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'psyduck.png'));
    const errorMsg = err instanceof Error ? err.message : 'Query failed';

    return `<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';">
      <link href="${styleUri}" rel="stylesheet">
    </head><body>
      <div id="app">
        <div class="toolbar"><div class="toolbar-left"><span class="stats">SQL: ${sql}</span></div></div>
        <div class="query-error">
          <img class="duck-error-icon" src="${psyduckUri}" alt="Error" />
          <span>${errorMsg}</span>
        </div>
      </div>
    </body></html>`;
  }
}

// Legacy export removed — QueryResultPanel.open is used directly via lazy import
