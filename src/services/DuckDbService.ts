/**
 * DuckDB WASM Service — single engine for all data operations.
 *
 * Lazy-initialized on first use. Once loaded, stays in memory for the session.
 * Handles: CSV loading, querying, filtering, sorting, pagination, editing, export.
 */

import * as vscode from 'vscode';
import { join } from 'path';
import { SortState, ColumnFilters } from '../types';

// DuckDB WASM Node.js blocking API
// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

export interface QueryResult {
  headers: string[];
  rows: string[][];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

export class DuckDbService implements vscode.Disposable {
  private currentDelimiter: string = ',';
  private db: any = null;
  private conn: any = null;
  private initPromise: Promise<void> | null = null;

  dispose(): void {
    this.close();
  }

  // ─── Initialization (lazy) ───────────────────────────────────────────────

  private ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    // WASM files are copied to dist/ by webpack CopyPlugin
    const wasmDir = __dirname;

    const DUCKDB_BUNDLES = {
      mvp: {
        mainModule: join(wasmDir, 'duckdb-mvp.wasm'),
        mainWorker: join(wasmDir, 'duckdb-node-mvp.worker.cjs'),
      },
      eh: {
        mainModule: join(wasmDir, 'duckdb-eh.wasm'),
        mainWorker: join(wasmDir, 'duckdb-node-eh.worker.cjs'),
      },
    };

    const logger = new duckdb.ConsoleLogger();
    this.db = await duckdb.createDuckDB(DUCKDB_BUNDLES, logger, duckdb.NODE_RUNTIME);
    await this.db.instantiate();
    this.db.open({ query: { castBigIntToDouble: true } });
    this.conn = this.db.connect();
  }

  private close(): void {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.db) {
      this.db.reset();
      this.db = null;
    }
    this.initPromise = null;
  }

  // ─── File Loading ────────────────────────────────────────────────────────

  /**
   * Load a CSV file into DuckDB as a table named 'csv'.
   * Uses read_csv_auto for automatic delimiter/type detection.
   */
  async loadFile(uri: vscode.Uri): Promise<{ headers: string[]; totalRows: number; delimiter: string }> {
    await this.ensureReady();

    const filePath = uri.fsPath.replace(/'/g, "''");

    // Drop previous table if exists
    this.conn.query("DROP TABLE IF EXISTS csv");

    // Load with all columns as VARCHAR to avoid type conversion errors on empty/mixed values
    this.conn.query(`CREATE TABLE csv AS SELECT * FROM read_csv_auto('${filePath}', all_varchar=true)`);

    // Get metadata
    const headers = this.getHeaders();
    const totalRows = this.getTotalRows();
    const delimiter = this.detectDelimiter(filePath);
    this.currentDelimiter = this.delimiterNameToChar(delimiter);

    return { headers, totalRows, delimiter };
  }

  // ─── Query Execution ─────────────────────────────────────────────────────

  /**
   * Execute a raw SQL query. The table is named 'csv'.
   */
  async executeQuery(sql: string): Promise<QueryResult> {
    await this.ensureReady();

    const start = performance.now();

    try {
      const normalizedSql = this.normalizeSql(sql);
      const result = this.conn.query(normalizedSql);

      const headers = result.schema.fields.map((f: any) => f.name);
      const rows = this.arrowTableToRows(result);

      return {
        headers,
        rows,
        rowCount: rows.length,
        executionTimeMs: performance.now() - start,
      };
    } catch (err: unknown) {
      return {
        headers: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: performance.now() - start,
        error: err instanceof Error ? err.message : 'Query failed',
      };
    }
  }

  // ─── Data Page (with filters, sort, search, pagination) ──────────────────

  /**
   * Get a page of data with all active filters, sort, and search applied.
   */
  async getDataPage(params: {
    filters: ColumnFilters;
    sort: SortState;
    searchTerm: string;
    offset: number;
    limit: number;
  }): Promise<{ rows: string[][]; rowids: number[]; filteredCount: number }> {
    await this.ensureReady();

    const headers = this.getHeaders();
    const whereClauses = this.buildWhereClauses(params.filters, params.searchTerm, headers);
    const orderClause = this.buildOrderClause(params.sort, headers);

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Get filtered count
    const countResult = this.conn.query(`SELECT COUNT(*) as cnt FROM csv ${whereStr}`);
    const filteredCount = Number(countResult.get(0)?.cnt ?? 0);

    // Get page with rowid for editing support
    const columns = headers.map(h => this.quoteIdentifier(h)).join(', ');

    const pageResult = this.conn.query(
      `SELECT rowid, ${columns} FROM csv ${whereStr} ${orderClause} LIMIT ${params.limit} OFFSET ${params.offset}`
    );

    const allRows = this.arrowTableToRows(pageResult);
    // First column is rowid, rest is data
    const rowids = allRows.map(row => parseInt(row[0], 10));
    const rows = allRows.map(row => row.slice(1));

    return { rows, rowids, filteredCount };
  }

  // ─── Unique Values ───────────────────────────────────────────────────────

  async getUniqueValues(columnIndex: number): Promise<string[]> {
    await this.ensureReady();

    const headers = this.getHeaders();
    if (columnIndex < 0 || columnIndex >= headers.length) { return []; }

    const colName = this.quoteIdentifier(headers[columnIndex]);
    const result = this.conn.query(
      `SELECT DISTINCT ${colName} FROM csv WHERE ${colName} IS NOT NULL AND ${colName} != '' ORDER BY ${colName}`
    );

    return this.arrowTableToRows(result).map(row => row[0]);
  }

  // ─── Cell Editing ────────────────────────────────────────────────────────

  async updateCell(rowid: number, columnIndex: number, value: string): Promise<void> {
    await this.ensureReady();

    const headers = this.getHeaders();
    if (columnIndex < 0 || columnIndex >= headers.length) { return; }

    const colName = this.quoteIdentifier(headers[columnIndex]);
    const escapedValue = value.replace(/'/g, "''");

    this.conn.query(
      `UPDATE csv SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`
    );
  }

  // ─── Row Operations ──────────────────────────────────────────────────────

  async addRow(): Promise<void> {
    await this.ensureReady();

    const headers = this.getHeaders();
    const nulls = headers.map(() => "''").join(', ');
    this.conn.query(`INSERT INTO csv VALUES (${nulls})`);
  }

  async deleteRow(rowid: number): Promise<void> {
    await this.ensureReady();
    this.conn.query(`DELETE FROM csv WHERE rowid = ${rowid}`);
  }

  // ─── Export ──────────────────────────────────────────────────────────────

  async exportToCsv(outputPath: string): Promise<void> {
    await this.ensureReady();

    const fs = require('fs');
    const headers = this.getHeaders();

    // Detect delimiter from the original file format
    const delimiter = this.detectCurrentDelimiter();

    // Build CSV content from in-memory table
    const headerLine = headers.map(h => this.quoteField(h, delimiter)).join(delimiter);

    const dataResult = this.conn.query(
      `SELECT ${headers.map(h => this.quoteIdentifier(h)).join(', ')} FROM csv`
    );
    const rows = this.arrowTableToRows(dataResult);

    const lines = [headerLine];
    for (const row of rows) {
      lines.push(row.map(cell => this.quoteField(cell, delimiter)).join(delimiter));
    }

    fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
  }

  private detectCurrentDelimiter(): string {
    return this.currentDelimiter;
  }

  private delimiterNameToChar(name: string): string {
    switch (name) {
      case 'Comma': return ',';
      case 'Semicolon': return ';';
      case 'Tab': return '\t';
      case 'Pipe': return '|';
      default: return ',';
    }
  }

  private quoteField(value: string, delimiter: string): string {
    if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  getHeaders(): string[] {
    if (!this.conn) { return []; }
    const result = this.conn.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'csv' ORDER BY ordinal_position");
    return this.arrowTableToRows(result).map(row => row[0]);
  }

  getTotalRows(): number {
    if (!this.conn) { return 0; }
    const result = this.conn.query("SELECT COUNT(*) as cnt FROM csv");
    return Number(result.get(0)?.cnt ?? 0);
  }

  private detectDelimiter(filePath: string): string {
    try {
      const result = this.conn.query(`SELECT * FROM sniff_csv('${filePath}')`);
      const row = result.get(0);
      const delim = row?.Delimiter ?? ',';
      switch (delim) {
        case ',': return 'Comma';
        case ';': return 'Semicolon';
        case '\t': return 'Tab';
        case '|': return 'Pipe';
        default: return 'Auto';
      }
    } catch {
      return 'Auto';
    }
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

  private normalizeSql(sql: string): string {
    const trimmed = sql.trim();

    if (/FROM\s+csv/i.test(trimmed)) {
      return trimmed;
    }

    if (/^SELECT\s/i.test(trimmed)) {
      const insertPoint = trimmed.search(/\b(WHERE|ORDER|GROUP|LIMIT|HAVING)\b/i);
      if (insertPoint === -1) {
        return trimmed + ' FROM csv';
      }
      return trimmed.slice(0, insertPoint) + 'FROM csv ' + trimmed.slice(insertPoint);
    }

    if (/^WHERE\s/i.test(trimmed)) {
      return 'SELECT * FROM csv ' + trimmed;
    }

    return trimmed;
  }

  private quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
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
}
