/**
 * TableManager — manages loading/dropping tables, metadata, data pages, and unique values.
 * Depends on DuckDbEngine for database access.
 */

import { DuckDbEngine } from './DuckDbEngine';
import { SortState, ColumnFilters } from '../types';
import * as vscode from 'vscode';
import { basename, extname } from 'path';

export interface TableMeta {
  name: string;
  filePath: string;
  delimiter: string;
  delimiterChar: string;
  headers: string[];
  rowCount: number;
}

export interface DataPage {
  rows: string[][];
  rowids: number[];
  filteredCount: number;
}

export class TableManager {
  private tables = new Map<string, TableMeta>();

  constructor(private readonly engine: DuckDbEngine) {}

  async loadTable(uri: vscode.Uri, customName?: string): Promise<TableMeta> {
    const conn = await this.engine.getConnection();
    const filePath = uri.fsPath.replace(/'/g, "''");

    const tableName = customName ?? this.deriveTableName(uri);

    // Drop if already exists (e.g. reopening same file)
    conn.query(`DROP TABLE IF EXISTS ${this.quoteIdentifier(tableName)}`);

    // Force DuckDB to re-read the file by using a fresh read
    // CHECKPOINT ensures any cached state is flushed
    try { conn.query('CHECKPOINT'); } catch { /* ignore if not supported */ }

    // Create table from CSV with type inference enabled
    conn.query(`CREATE TABLE ${this.quoteIdentifier(tableName)} AS SELECT * FROM read_csv_auto('${filePath}', ignore_errors=true)`);

    // Detect delimiter
    const { name: delimiterName, char: delimiterChar } = this.detectDelimiter(filePath, conn);

    // Get headers
    const headers = await this.getHeaders(tableName);

    // Get row count
    const rowCount = await this.getRowCount(tableName);

    const meta: TableMeta = {
      name: tableName,
      filePath: uri.fsPath,
      delimiter: delimiterName,
      delimiterChar,
      headers,
      rowCount,
    };

    this.tables.set(tableName, meta);
    return meta;
  }

  async dropTable(name: string): Promise<void> {
    const conn = await this.engine.getConnection();
    conn.query(`DROP TABLE IF EXISTS ${this.quoteIdentifier(name)}`);
    this.tables.delete(name);
  }

  getLoadedTables(): TableMeta[] {
    return Array.from(this.tables.values());
  }

  getTableMeta(name: string): TableMeta | undefined {
    return this.tables.get(name);
  }

  async getHeaders(tableName: string): Promise<string[]> {
    const conn = await this.engine.getConnection();
    const escaped = tableName.replace(/'/g, "''");
    const result = conn.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${escaped}' ORDER BY ordinal_position`
    );
    return this.arrowTableToRows(result).map((row: string[]) => row[0]);
  }

  async getRowCount(tableName: string): Promise<number> {
    const conn = await this.engine.getConnection();
    const result = conn.query(`SELECT COUNT(*) as cnt FROM ${this.quoteIdentifier(tableName)}`);
    return Number(result.get(0)?.cnt ?? 0);
  }

  async getDataPage(
    tableName: string,
    params: {
      filters: ColumnFilters;
      sort: SortState;
      searchTerm: string;
      offset: number;
      limit: number;
    }
  ): Promise<DataPage> {
    const conn = await this.engine.getConnection();
    const headers = await this.getHeaders(tableName);
    const whereClauses = this.buildWhereClauses(params.filters, params.searchTerm, headers);
    const orderClause = this.buildOrderClause(params.sort, headers);

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const quoted = this.quoteIdentifier(tableName);

    // Get filtered count
    const countResult = conn.query(`SELECT COUNT(*) as cnt FROM ${quoted} ${whereStr}`);
    const filteredCount = Number(countResult.get(0)?.cnt ?? 0);

    // Get page with rowid
    const columns = headers.map(h => this.quoteIdentifier(h)).join(', ');
    const pageResult = conn.query(
      `SELECT rowid, ${columns} FROM ${quoted} ${whereStr} ${orderClause} LIMIT ${params.limit} OFFSET ${params.offset}`
    );

    const allRows = this.arrowTableToRows(pageResult);
    const rowids = allRows.map((row: string[]) => parseInt(row[0], 10));
    const rows = allRows.map((row: string[]) => row.slice(1));

    return { rows, rowids, filteredCount };
  }

  async getUniqueValues(tableName: string, columnIndex: number): Promise<string[]> {
    const conn = await this.engine.getConnection();
    const headers = await this.getHeaders(tableName);
    if (columnIndex < 0 || columnIndex >= headers.length) { return []; }

    const colName = this.quoteIdentifier(headers[columnIndex]);
    const quoted = this.quoteIdentifier(tableName);
    const result = conn.query(
      `SELECT DISTINCT ${colName} FROM ${quoted} WHERE ${colName} IS NOT NULL AND ${colName} != '' ORDER BY ${colName}`
    );

    return this.arrowTableToRows(result).map((row: string[]) => row[0]);
  }

  async updateCell(tableName: string, rowid: number, columnIndex: number, value: string): Promise<void> {
    const conn = await this.engine.getConnection();
    const headers = await this.getHeaders(tableName);
    if (columnIndex < 0 || columnIndex >= headers.length) { return; }

    const colName = this.quoteIdentifier(headers[columnIndex]);
    const escapedValue = value.replace(/'/g, "''");
    const quoted = this.quoteIdentifier(tableName);

    conn.query(
      `UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`
    );
  }

  async addRow(tableName: string): Promise<void> {
    const conn = await this.engine.getConnection();
    const headers = await this.getHeaders(tableName);
    const nulls = headers.map(() => "NULL").join(', ');
    conn.query(`INSERT INTO ${this.quoteIdentifier(tableName)} VALUES (${nulls})`);
  }

  async deleteRow(tableName: string, rowid: number): Promise<void> {
    const conn = await this.engine.getConnection();
    conn.query(`DELETE FROM ${this.quoteIdentifier(tableName)} WHERE rowid = ${rowid}`);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private deriveTableName(uri: vscode.Uri): string {
    const fileName = basename(uri.fsPath, extname(uri.fsPath));
    let name = fileName.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    // Ensure name doesn't start with a digit
    if (/^\d/.test(name)) {
      name = '_' + name;
    }

    // Deduplicate if name already exists
    if (!this.tables.has(name)) {
      return name;
    }

    let counter = 2;
    while (this.tables.has(`${name}_${counter}`)) {
      counter++;
    }
    return `${name}_${counter}`;
  }

  private quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  private buildWhereClauses(filters: ColumnFilters, searchTerm: string, headers: string[]): string[] {
    const clauses: string[] = [];

    // Column filters
    for (const [colIdx, values] of Object.entries(filters)) {
      if (values.length === 0) { continue; }
      const colName = this.quoteIdentifier(headers[parseInt(colIdx, 10)]);
      const escaped = values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
      clauses.push(`${colName} IN (${escaped})`);
    }

    // Global search (ILIKE across all columns)
    if (searchTerm) {
      const escaped = searchTerm.replace(/'/g, "''").replace(/%/g, '\\%');
      const searchClauses = headers.map(h =>
        `CAST(${this.quoteIdentifier(h)} AS VARCHAR) ILIKE '%${escaped}%'`
      );
      clauses.push(`(${searchClauses.join(' OR ')})`);
    }

    return clauses;
  }

  private buildOrderClause(sort: SortState, headers: string[]): string {
    if (sort.direction === 'none' || sort.columnIndex < 0 || sort.columnIndex >= headers.length) {
      return '';
    }
    const colName = this.quoteIdentifier(headers[sort.columnIndex]);
    const dir = sort.direction === 'asc' ? 'ASC' : 'DESC';
    return `ORDER BY ${colName} ${dir} NULLS LAST`;
  }

  private arrowTableToRows(table: any): string[][] {
    const rows: string[][] = [];
    const numRows = table.numRows;
    const numCols = table.numCols;

    for (let i = 0; i < numRows; i++) {
      const row: string[] = [];
      for (let j = 0; j < numCols; j++) {
        const val = table.getChildAt(j)?.get(i);
        row.push(val === null || val === undefined ? '' : String(val));
      }
      rows.push(row);
    }

    return rows;
  }

  private detectDelimiter(filePath: string, conn: any): { name: string; char: string } {
    try {
      const result = conn.query(`SELECT * FROM sniff_csv('${filePath}')`);
      const row = result.get(0);
      const delim = row?.Delimiter ?? ',';
      switch (delim) {
        case ',': return { name: 'Comma', char: ',' };
        case ';': return { name: 'Semicolon', char: ';' };
        case '\t': return { name: 'Tab', char: '\t' };
        case '|': return { name: 'Pipe', char: '|' };
        default: return { name: 'Auto', char: ',' };
      }
    } catch {
      return { name: 'Auto', char: ',' };
    }
  }
}
