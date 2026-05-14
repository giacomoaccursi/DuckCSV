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
  columnTypes: string[];
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

    // Drop if already exists
    conn.query(`DROP TABLE IF EXISTS ${this.quoteIdentifier(tableName)}`);

    // Load directly from file path (fast for large files)
    conn.query(`CREATE TABLE ${this.quoteIdentifier(tableName)} AS SELECT * FROM read_csv_auto('${filePath}', ignore_errors=true)`);

    // Detect delimiter from first line
    const fs = require('fs');
    const firstChunk = Buffer.alloc(4096);
    const fd = fs.openSync(uri.fsPath, 'r');
    fs.readSync(fd, firstChunk, 0, 4096, 0);
    fs.closeSync(fd);
    const firstLine = firstChunk.toString('utf8').split('\n')[0] || '';
    const { name: delimiterName, char: delimiterChar } = this.detectDelimiterFromLine(firstLine);

    // Get headers
    const headers = await this.getHeaders(tableName);

    // Get column types
    const columnTypes = await this.getColumnTypes(tableName);

    // Get row count
    const rowCount = await this.getRowCount(tableName);

    const meta: TableMeta = {
      name: tableName,
      filePath: uri.fsPath,
      delimiter: delimiterName,
      delimiterChar,
      headers,
      columnTypes,
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

  async dropAllTables(): Promise<void> {
    const conn = await this.engine.getConnection();
    for (const name of this.tables.keys()) {
      conn.query(`DROP TABLE IF EXISTS ${this.quoteIdentifier(name)}`);
    }
    this.tables.clear();
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

  async getColumnTypes(tableName: string): Promise<string[]> {
    const conn = await this.engine.getConnection();
    const escaped = tableName.replace(/'/g, "''");
    const result = conn.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = '${escaped}' ORDER BY ordinal_position`
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
      `SELECT DISTINCT CAST(${colName} AS VARCHAR) as val FROM ${quoted} WHERE ${colName} IS NOT NULL ORDER BY ${colName}`
    );

    return this.arrowTableToRows(result).map((row: string[]) => row[0]).filter(v => v !== '');
  }

  async updateCell(tableName: string, rowid: number, columnIndex: number, value: string): Promise<void> {
    const conn = await this.engine.getConnection();
    const headers = await this.getHeaders(tableName);
    if (columnIndex < 0 || columnIndex >= headers.length) { return; }

    const colName = this.quoteIdentifier(headers[columnIndex]);
    const escapedValue = value.replace(/'/g, "''");
    const quoted = this.quoteIdentifier(tableName);

    // Get current column type to detect if value is incompatible
    const types = await this.getColumnTypes(tableName);
    const currentType = types[columnIndex];

    // Check if value can be cast to current type
    let needsTypeChange = false;
    if (currentType && currentType !== 'VARCHAR') {
      try {
        const check = conn.query(
          `SELECT TRY_CAST('${escapedValue}' AS ${currentType}) IS NOT NULL as ok`
        );
        const castable = check.get(0)?.ok;
        if (!castable && value !== '') {
          needsTypeChange = true;
        }
      } catch {
        needsTypeChange = true;
      }
    }

    if (needsTypeChange) {
      // Convert column to VARCHAR first, then update
      conn.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE VARCHAR`);
      conn.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
    } else {
      // Direct update (value is compatible with current type)
      try {
        conn.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
      } catch {
        // Fallback: cast to VARCHAR and retry
        conn.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE VARCHAR`);
        conn.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
      }
    }

    // After update, try to tighten the column type if it's currently VARCHAR
    await this.tryTightenColumnType(tableName, columnIndex);

    // Update cached metadata
    const meta = this.tables.get(tableName);
    if (meta) {
      meta.headers = await this.getHeaders(tableName);
      meta.columnTypes = await this.getColumnTypes(tableName);
    }
  }

  /**
   * If a column is VARCHAR, check if all values can be cast to a tighter type (BIGINT, DOUBLE, DATE).
   * If so, alter the column type.
   */
  private async tryTightenColumnType(tableName: string, columnIndex: number): Promise<void> {
    const conn = await this.engine.getConnection();
    const types = await this.getColumnTypes(tableName);
    if (types[columnIndex] !== 'VARCHAR') { return; }

    const headers = await this.getHeaders(tableName);
    const colName = this.quoteIdentifier(headers[columnIndex]);
    const quoted = this.quoteIdentifier(tableName);

    // Try types from most restrictive to least
    const candidates = ['BOOLEAN', 'BIGINT', 'DOUBLE', 'DATE', 'TIMESTAMP'];

    for (const targetType of candidates) {
      try {
        const check = conn.query(
          `SELECT COUNT(*) = COUNT(TRY_CAST(${colName} AS ${targetType})) as ok FROM ${quoted} WHERE ${colName} IS NOT NULL AND ${colName} != ''`
        );
        const allCastable = check.get(0)?.ok;
        if (allCastable) {
          conn.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE ${targetType}`);
          return;
        }
      } catch {
        // Skip this type
      }
    }
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

    // Get column types from schema to handle date/timestamp formatting
    const colTypes: string[] = table.schema.fields.map((f: any) => f.type?.toString() || '');

    for (let i = 0; i < numRows; i++) {
      const row: string[] = [];
      for (let j = 0; j < numCols; j++) {
        const val = table.getChildAt(j)?.get(i);
        row.push(this.formatArrowValue(val, colTypes[j]));
      }
      rows.push(row);
    }

    return rows;
  }

  private formatArrowValue(val: any, colType: string): string {
    if (val === null || val === undefined) { return ''; }

    // Handle Date objects
    if (val instanceof Date) {
      return val.toISOString().split('T')[0];
    }

    // Handle BigInt
    if (typeof val === 'bigint') {
      return val.toString();
    }

    // Handle numeric values that represent dates (epoch ms or epoch days)
    if (typeof val === 'number') {
      const typeLower = colType.toLowerCase();
      if (typeLower.includes('date') || typeLower.includes('timestamp')) {
        // DuckDB dates come as epoch days (int32) or epoch ms
        const ms = val > 1e10 ? val : val * 86400000; // if small number, it's days
        const d = new Date(ms);
        if (!isNaN(d.getTime())) {
          return d.toISOString().split('T')[0];
        }
      }
    }

    return String(val);
  }

  private detectDelimiterFromLine(firstLine: string): { name: string; char: string } {
    const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };

    for (const char of firstLine) {
      if (char in counts) { counts[char]++; }
    }

    let best = ',';
    let bestCount = 0;
    for (const [char, count] of Object.entries(counts)) {
      if (count > bestCount) { bestCount = count; best = char; }
    }

    switch (best) {
      case ',': return { name: 'Comma', char: ',' };
      case ';': return { name: 'Semicolon', char: ';' };
      case '\t': return { name: 'Tab', char: '\t' };
      case '|': return { name: 'Pipe', char: '|' };
      default: return { name: 'Comma', char: ',' };
    }
  }
}
