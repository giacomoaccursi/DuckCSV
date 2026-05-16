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
    const tableName = customName ?? this.deriveTableName(uri);

    // Drop if already exists
    await this.engine.query(`DROP TABLE IF EXISTS ${this.quoteIdentifier(tableName)}`);

    // Read file content and register as virtual file to bypass DuckDB's file cache
    const fileContent = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(fileContent).toString('utf8');
    const virtualName = `__${tableName}_${Date.now()}.csv`;
    await this.engine.registerFile(virtualName, content);

    // Load from virtual file (always fresh content from disk)
    await this.engine.query(`CREATE TABLE ${this.quoteIdentifier(tableName)} AS SELECT * FROM read_csv_auto('${virtualName}', ignore_errors=true)`);

    // Detect delimiter from file content (first line)
    const firstLine = content.split('\n')[0] || '';
    const { name: delimiterName, char: delimiterChar } = this.detectDelimiterFromLine(firstLine);

    // Get schema (headers + types) and row count in 2 queries instead of 3
    const escaped = tableName.replace(/'/g, "''");
    const schemaResult = await this.engine.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${escaped}' ORDER BY ordinal_position`
    );
    const headers = schemaResult.rows.map(row => row[0]);
    const columnTypes = schemaResult.rows.map(row => row[1]);

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
    await this.engine.query(`DROP TABLE IF EXISTS ${this.quoteIdentifier(name)}`);
    this.tables.delete(name);
  }

  async dropAllTables(): Promise<void> {
    for (const name of this.tables.keys()) {
      await this.engine.query(`DROP TABLE IF EXISTS ${this.quoteIdentifier(name)}`);
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
    const escaped = tableName.replace(/'/g, "''");
    const result = await this.engine.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${escaped}' ORDER BY ordinal_position`
    );
    return result.rows.map(row => row[0]);
  }

  async getColumnTypes(tableName: string): Promise<string[]> {
    const escaped = tableName.replace(/'/g, "''");
    const result = await this.engine.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = '${escaped}' ORDER BY ordinal_position`
    );
    return result.rows.map(row => row[0]);
  }

  async getRowCount(tableName: string): Promise<number> {
    const result = await this.engine.query(`SELECT COUNT(*) as cnt FROM ${this.quoteIdentifier(tableName)}`);
    return Number(result.rows[0][0]);
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
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const whereClauses = this.buildWhereClauses(params.filters, params.searchTerm, headers);
    const orderClause = this.buildOrderClause(params.sort, headers);

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const quoted = this.quoteIdentifier(tableName);
    const columns = headers.map(h => this.quoteIdentifier(h)).join(', ');

    // Single query: fetch data + filtered count via window function
    const result = await this.engine.query(
      `SELECT rowid, ${columns}, COUNT(*) OVER() as __total FROM ${quoted} ${whereStr} ${orderClause} LIMIT ${params.limit} OFFSET ${params.offset}`
    );

    if (result.rows.length === 0) {
      return { rows: [], rowids: [], filteredCount: 0 };
    }

    // __total is the last column in each row
    const lastCol = result.rows[0].length - 1;
    const filteredCount = Number(result.rows[0][lastCol]);
    const rowids = result.rows.map(row => parseInt(row[0], 10));
    const rows = result.rows.map(row => row.slice(1, lastCol));

    return { rows, rowids, filteredCount };
  }

  async getUniqueValues(tableName: string, columnIndex: number): Promise<string[]> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    if (columnIndex < 0 || columnIndex >= headers.length) { return []; }

    const colName = this.quoteIdentifier(headers[columnIndex]);
    const quoted = this.quoteIdentifier(tableName);
    const result = await this.engine.query(
      `SELECT DISTINCT CAST(${colName} AS VARCHAR) as val FROM ${quoted} WHERE ${colName} IS NOT NULL ORDER BY ${colName} LIMIT 1000`
    );

    return result.rows.map(row => row[0]).filter(v => v !== '');
  }

  async updateCell(tableName: string, rowid: number, columnIndex: number, value: string): Promise<void> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    if (columnIndex < 0 || columnIndex >= headers.length) { return; }

    const colName = this.quoteIdentifier(headers[columnIndex]);
    const escapedValue = value.replace(/'/g, "''");
    const quoted = this.quoteIdentifier(tableName);

    // Get current column type to detect if value is incompatible
    const types = meta ? meta.columnTypes : await this.getColumnTypes(tableName);
    const currentType = types[columnIndex];

    // Check if value can be cast to current type
    let needsTypeChange = false;
    if (currentType && currentType !== 'VARCHAR') {
      try {
        const check = await this.engine.query(
          `SELECT TRY_CAST('${escapedValue}' AS ${currentType}) IS NOT NULL as ok`
        );
        const castable = check.rows[0][0];
        if (castable !== 'true' && value !== '') {
          needsTypeChange = true;
        }
      } catch {
        needsTypeChange = true;
      }
    }

    if (needsTypeChange) {
      // Convert column to VARCHAR first, then update
      await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE VARCHAR`);
      await this.engine.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
    } else {
      // Direct update (value is compatible with current type)
      try {
        await this.engine.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
      } catch {
        // Fallback: cast to VARCHAR and retry
        await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE VARCHAR`);
        await this.engine.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
      }
    }

    // After update, try to tighten the column type if it's currently VARCHAR
    await this.tryTightenColumnType(tableName, columnIndex);

    // Update cached metadata
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
    const meta = this.tables.get(tableName);
    const types = meta ? meta.columnTypes : await this.getColumnTypes(tableName);
    if (types[columnIndex] !== 'VARCHAR') { return; }

    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const colName = this.quoteIdentifier(headers[columnIndex]);
    const quoted = this.quoteIdentifier(tableName);

    // Try types from most restrictive to least
    const candidates = ['BOOLEAN', 'BIGINT', 'DOUBLE', 'DATE', 'TIMESTAMP'];

    for (const targetType of candidates) {
      try {
        const check = await this.engine.query(
          `SELECT COUNT(*) = COUNT(TRY_CAST(${colName} AS ${targetType})) as ok FROM ${quoted} WHERE ${colName} IS NOT NULL AND ${colName} != ''`
        );
        const allCastable = check.rows[0][0];
        if (allCastable === 'true') {
          await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE ${targetType}`);
          return;
        }
      } catch {
        // Skip this type
      }
    }
  }

  async addRow(tableName: string): Promise<void> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const nulls = headers.map(() => "NULL").join(', ');
    await this.engine.query(`INSERT INTO ${this.quoteIdentifier(tableName)} VALUES (${nulls})`);
  }

  async addRowAt(tableName: string, rowid: number, position: 'above' | 'below'): Promise<void> {
    const quoted = this.quoteIdentifier(tableName);
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const cols = headers.map(h => this.quoteIdentifier(h)).join(', ');
    const nulls = headers.map(() => "NULL").join(', ');

    // Create a temp table with all rows, inserting the new row at the right position
    const tempName = `__temp_insert_${Date.now()}`;
    const tempQuoted = this.quoteIdentifier(tempName);

    if (position === 'above') {
      // Insert new row before the target rowid
      await this.engine.query(`CREATE TABLE ${tempQuoted} AS 
        SELECT ${cols} FROM (
          SELECT ${cols}, rowid as __rid FROM ${quoted} WHERE rowid < ${rowid}
          UNION ALL
          SELECT ${nulls}, -1 as __rid
          UNION ALL
          SELECT ${cols}, rowid as __rid FROM ${quoted} WHERE rowid >= ${rowid}
        ) ORDER BY CASE WHEN __rid = -1 THEN ${rowid} - 0.5 ELSE __rid END`);
    } else {
      // Insert new row after the target rowid
      await this.engine.query(`CREATE TABLE ${tempQuoted} AS 
        SELECT ${cols} FROM (
          SELECT ${cols}, rowid as __rid FROM ${quoted} WHERE rowid <= ${rowid}
          UNION ALL
          SELECT ${nulls}, -1 as __rid
          UNION ALL
          SELECT ${cols}, rowid as __rid FROM ${quoted} WHERE rowid > ${rowid}
        ) ORDER BY CASE WHEN __rid = -1 THEN ${rowid} + 0.5 ELSE __rid END`);
    }

    await this.engine.query(`DROP TABLE ${quoted}`);
    await this.engine.query(`ALTER TABLE ${tempQuoted} RENAME TO ${quoted}`);
  }

  async deleteRow(tableName: string, rowid: number): Promise<void> {
    await this.engine.query(`DELETE FROM ${this.quoteIdentifier(tableName)} WHERE rowid = ${rowid}`);
  }

  async deleteRows(tableName: string, rowids: number[]): Promise<void> {
    if (rowids.length === 0) { return; }
    if (rowids.length === 1) {
      return this.deleteRow(tableName, rowids[0]);
    }
    const idList = rowids.join(', ');
    await this.engine.query(`DELETE FROM ${this.quoteIdentifier(tableName)} WHERE rowid IN (${idList})`);
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
      default: return { name: 'Comma', char: best || ',' };
    }
  }
}
