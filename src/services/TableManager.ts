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
    const filePath = uri.fsPath.replace(/'/g, "''");

    // If reloading an existing table, restart engine to clear DuckDB file cache
    if (this.tables.has(tableName)) {
      this.engine.cancel();
    }

    // Drop if already exists
    await this.engine.query(`DROP TABLE IF EXISTS ${this.quoteIdentifier(tableName)}`);

    // Load directly from file path (fast — DuckDB reads from disk)
    await this.engine.query(`CREATE TABLE ${this.quoteIdentifier(tableName)} AS SELECT * FROM read_csv_auto('${filePath}', ignore_errors=true)`);

    // Detect delimiter using DuckDB's sniffer
    const sniffResult = await this.engine.query(`SELECT Delimiter FROM sniff_csv('${filePath}')`);
    const detectedDelimiter = sniffResult.rows[0]?.[0] || ',';
    const { name: delimiterName, char: delimiterChar } = this.delimiterInfo(detectedDelimiter);

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

  // ─── Materialized View for Fast Pagination ────────────────────────────────

  private viewTable: string | null = null;
  private viewFingerprint: string = '';
  private viewBuildPromise: Promise<{ viewName: string; totalRows: number }> | null = null;

  /**
   * Create or reuse a materialized view (temp table with __pos column)
   * for fast positional access. Only recreated when sort/filter changes.
   * Serialized: concurrent calls wait for the same build to finish.
   */
  private async ensureMaterializedView(
    tableName: string,
    headers: string[],
    whereStr: string,
    orderClause: string
  ): Promise<{ viewName: string; totalRows: number }> {
    const fingerprint = `${tableName}|${whereStr}|${orderClause}`;

    // If view is already valid, return immediately
    if (this.viewTable && this.viewFingerprint === fingerprint) {
      const countResult = await this.engine.query(`SELECT COUNT(*) FROM ${this.quoteIdentifier(this.viewTable)}`);
      const totalRows = Number(countResult.rows[0][0]);
      return { viewName: this.viewTable, totalRows };
    }

    // If a build is already in progress, wait for it
    if (this.viewBuildPromise) {
      return this.viewBuildPromise;
    }

    // Start building — store the promise so concurrent callers can await it
    this.viewBuildPromise = this.buildMaterializedView(tableName, headers, whereStr, orderClause, fingerprint);
    try {
      return await this.viewBuildPromise;
    } finally {
      this.viewBuildPromise = null;
    }
  }

  private async buildMaterializedView(
    tableName: string,
    headers: string[],
    whereStr: string,
    orderClause: string,
    fingerprint: string
  ): Promise<{ viewName: string; totalRows: number }> {
    // Drop old view
    if (this.viewTable) {
      await this.engine.query(`DROP TABLE IF EXISTS ${this.quoteIdentifier(this.viewTable)}`);
    }

    const viewName = `__view_${Date.now()}`;
    this.viewTable = viewName;
    this.viewFingerprint = fingerprint;

    const quoted = this.quoteIdentifier(tableName);
    const columns = headers.map(h => this.quoteIdentifier(h)).join(', ');

    // Create materialized view with sequential __pos
    await this.engine.query(
      `CREATE TEMP TABLE ${this.quoteIdentifier(viewName)} AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, rowid as __rid, ${columns} FROM ${quoted} ${whereStr} ${orderClause}`
    );

    const countResult = await this.engine.query(`SELECT COUNT(*) FROM ${this.quoteIdentifier(viewName)}`);
    const totalRows = Number(countResult.rows[0][0]);

    return { viewName, totalRows };
  }

  /** Invalidate the materialized view (after insert/delete/edit) */
  invalidateView(): void {
    this.viewFingerprint = '';
  }

  /** Get the current view table name (for export with correct ordering) */
  getViewSource(): string | null {
    return (this.viewTable && this.viewFingerprint) ? this.viewTable : null;
  }

  /**
   * Append a row to the materialized view at the end.
   */
  private async appendToView(newRowid: number, tableName: string): Promise<void> {
    if (!this.viewTable || !this.viewFingerprint) { return; }
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const columns = headers.map(h => this.quoteIdentifier(h)).join(', ');
    const quoted = this.quoteIdentifier(tableName);
    const viewQuoted = this.quoteIdentifier(this.viewTable);

    // Get current max __pos
    const maxResult = await this.engine.query(`SELECT COALESCE(MAX(__pos), -1) FROM ${viewQuoted}`);
    const nextPos = Number(maxResult.rows[0][0]) + 1;

    // Insert the new row into the view
    await this.engine.query(
      `INSERT INTO ${viewQuoted} SELECT ${nextPos} as __pos, ${newRowid} as __rid, ${columns} FROM ${quoted} WHERE rowid = ${newRowid}`
    );
  }

  /**
   * Insert a row into the materialized view at a specific position (above/below a target rowid).
   * Calculates __pos as the midpoint between the target and its neighbor,
   * guaranteeing correct ordering even with multiple inserts at the same position.
   */
  private async insertIntoView(newRowid: number, targetRowid: number, position: 'above' | 'below', tableName: string): Promise<void> {
    if (!this.viewTable || !this.viewFingerprint) { return; }
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const columns = headers.map(h => this.quoteIdentifier(h)).join(', ');
    const quoted = this.quoteIdentifier(tableName);
    const viewQuoted = this.quoteIdentifier(this.viewTable);

    // Find the __pos of the target row
    const posResult = await this.engine.query(`SELECT __pos FROM ${viewQuoted} WHERE __rid = ${targetRowid}`);
    if (posResult.rows.length === 0) {
      await this.appendToView(newRowid, tableName);
      return;
    }
    const targetPos = Number(posResult.rows[0][0]);

    let newPos: number;
    if (position === 'above') {
      // Find the row just before the target
      const prevResult = await this.engine.query(
        `SELECT MAX(__pos) FROM ${viewQuoted} WHERE __pos < ${targetPos}`
      );
      const prevPos = prevResult.rows[0][0] !== null ? Number(prevResult.rows[0][0]) : targetPos - 2;
      newPos = (prevPos + targetPos) / 2;
    } else {
      // Find the row just after the target
      const nextResult = await this.engine.query(
        `SELECT MIN(__pos) FROM ${viewQuoted} WHERE __pos > ${targetPos}`
      );
      const nextPos = nextResult.rows[0][0] !== null ? Number(nextResult.rows[0][0]) : targetPos + 2;
      newPos = (targetPos + nextPos) / 2;
    }

    await this.engine.query(
      `INSERT INTO ${viewQuoted} SELECT ${newPos} as __pos, ${newRowid} as __rid, ${columns} FROM ${quoted} WHERE rowid = ${newRowid}`
    );
  }

  /**
   * Remove a row from the materialized view without full rebuild.
   * Used after DELETE to avoid expensive recreation.
   * Note: __pos values will have a gap, but WHERE __pos >= X still works correctly.
   */
  private async removeFromView(rowid: number): Promise<void> {
    if (!this.viewTable || !this.viewFingerprint) { return; }
    const viewQuoted = this.quoteIdentifier(this.viewTable);
    await this.engine.query(`DELETE FROM ${viewQuoted} WHERE __rid = ${rowid}`);
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

    // Use materialized view for O(1) positional access in all cases.
    // The view is cached and only rebuilt when sort/filter/data changes.
    const { viewName, totalRows } = await this.ensureMaterializedView(tableName, headers, whereStr, orderClause);
    const viewQuoted = this.quoteIdentifier(viewName);
    const columns = headers.map(h => this.quoteIdentifier(h)).join(', ');

    const result = await this.engine.query(
      `SELECT __rid, ${columns} FROM ${viewQuoted} ORDER BY __pos LIMIT ${params.limit} OFFSET ${params.offset}`
    );

    if (result.rows.length === 0) {
      return { rows: [], rowids: [], filteredCount: totalRows };
    }

    const rowids = result.rows.map(row => parseInt(row[0], 10));
    const rows = result.rows.map(row => row.slice(1));

    return { rows, rowids, filteredCount: totalRows };
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
    const types = meta ? meta.columnTypes : await this.getColumnTypes(tableName);
    const currentType = types[columnIndex];

    const needsTypeChange = await this.isTypeIncompatible(escapedValue, currentType, value);

    if (needsTypeChange) {
      await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE VARCHAR`);
      await this.engine.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
    } else {
      try {
        await this.engine.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
      } catch {
        await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE VARCHAR`);
        await this.engine.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
      }
    }

    await this.tryTightenColumnType(tableName, columnIndex);

    if (meta) {
      meta.headers = await this.getHeaders(tableName);
      meta.columnTypes = await this.getColumnTypes(tableName);
    }

    // Update the view in-place (cell value changed, position unchanged)
    if (this.viewTable && this.viewFingerprint) {
      const headers = meta ? meta.headers : await this.getHeaders(tableName);
      const colName = this.quoteIdentifier(headers[columnIndex]);
      const viewQuoted = this.quoteIdentifier(this.viewTable);
      const escapedVal = value.replace(/'/g, "''");
      try {
        await this.engine.query(`UPDATE ${viewQuoted} SET ${colName} = '${escapedVal}' WHERE __rid = ${rowid}`);
      } catch {
        // If view update fails (e.g. type mismatch), invalidate for rebuild
        this.invalidateView();
      }
    }
  }

  private async isTypeIncompatible(escapedValue: string, currentType: string, rawValue: string): Promise<boolean> {
    if (!currentType || currentType === 'VARCHAR') { return false; }
    try {
      const check = await this.engine.query(
        `SELECT TRY_CAST('${escapedValue}' AS ${currentType}) IS NOT NULL as ok`
      );
      return check.rows[0][0] !== 'true' && rawValue !== '';
    } catch {
      return true;
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

  async addRow(tableName: string): Promise<number> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const nulls = headers.map(() => "NULL").join(', ');
    await this.engine.query(`INSERT INTO ${this.quoteIdentifier(tableName)} VALUES (${nulls})`);
    // Get the rowid of the newly inserted row
    const result = await this.engine.query(`SELECT MAX(rowid) FROM ${this.quoteIdentifier(tableName)}`);
    const newRowid = Number(result.rows[0][0]);
    await this.appendToView(newRowid, tableName);
    return newRowid;
  }

  async addRowAt(tableName: string, targetRowid: number, position: 'above' | 'below'): Promise<number> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const nulls = headers.map(() => "NULL").join(', ');
    await this.engine.query(`INSERT INTO ${this.quoteIdentifier(tableName)} VALUES (${nulls})`);
    const result = await this.engine.query(`SELECT MAX(rowid) FROM ${this.quoteIdentifier(tableName)}`);
    const newRowid = Number(result.rows[0][0]);
    await this.insertIntoView(newRowid, targetRowid, position, tableName);
    return newRowid;
  }

  async deleteRow(tableName: string, rowid: number): Promise<void> {
    await this.engine.query(`DELETE FROM ${this.quoteIdentifier(tableName)} WHERE rowid = ${rowid}`);
    await this.removeFromView(rowid);
  }

  async deleteRows(tableName: string, rowids: number[]): Promise<void> {
    if (rowids.length === 0) { return; }
    if (rowids.length === 1) {
      return this.deleteRow(tableName, rowids[0]);
    }
    const idList = rowids.join(', ');
    await this.engine.query(`DELETE FROM ${this.quoteIdentifier(tableName)} WHERE rowid IN (${idList})`);
    // Remove from view incrementally
    if (this.viewTable && this.viewFingerprint) {
      const viewQuoted = this.quoteIdentifier(this.viewTable);
      await this.engine.query(`DELETE FROM ${viewQuoted} WHERE __rid IN (${idList})`);
    }
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

  private delimiterInfo(char: string): { name: string; char: string } {
    switch (char) {
      case ',': return { name: 'Comma', char: ',' };
      case ';': return { name: 'Semicolon', char: ';' };
      case '\t': return { name: 'Tab', char: '\t' };
      case '|': return { name: 'Pipe', char: '|' };
      default: return { name: 'Comma', char: char || ',' };
    }
  }
}
