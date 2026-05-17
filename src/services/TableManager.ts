/**
 * TableManager — manages loading/dropping tables, metadata, data pages, and mutations.
 *
 * Uses a materialized view (temp table with __pos column) for fast positional pagination.
 * The view is cached and only rebuilt when sort/filter changes or after structural mutations.
 *
 * Mutation strategy:
 * - updateCell: UPDATE in-place on both table and view (no rebuild)
 * - addRow (append): INSERT + append to view (no rebuild)
 * - addRowAt (positional): INSERT + async table rebuild in background
 * - deleteRow/deleteRows: DELETE from both table and view (no rebuild)
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

  // ─── View State ──────────────────────────────────────────────────────────

  private viewTable: string | null = null;
  private viewFingerprint: string = '';
  private viewBuildPromise: Promise<{ viewName: string; totalRows: number }> | null = null;
  private pendingRebuild: Promise<void> | null = null;

  constructor(private readonly engine: DuckDbEngine) {}

  // ─── Table Lifecycle ─────────────────────────────────────────────────────

  async loadTable(uri: vscode.Uri, customName?: string): Promise<TableMeta> {
    const tableName = customName ?? this.deriveTableName(uri);
    const filePath = uri.fsPath.replace(/'/g, "''");

    if (this.tables.has(tableName)) {
      this.engine.cancel(); // Clear DuckDB file cache on reload
    }

    await this.engine.query(`DROP TABLE IF EXISTS ${this.q(tableName)}`);
    await this.engine.query(
      `CREATE TABLE ${this.q(tableName)} AS SELECT * FROM read_csv_auto('${filePath}', ignore_errors=true)`
    );

    const sniffResult = await this.engine.query(`SELECT Delimiter FROM sniff_csv('${filePath}')`);
    const detectedDelimiter = sniffResult.rows[0]?.[0] || ',';
    const { name: delimiterName, char: delimiterChar } = this.delimiterInfo(detectedDelimiter);

    const escaped = tableName.replace(/'/g, "''");
    const schemaResult = await this.engine.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${escaped}' ORDER BY ordinal_position`
    );
    const headers = schemaResult.rows.map(row => row[0]);
    const columnTypes = schemaResult.rows.map(row => row[1]);
    const rowCount = await this.getRowCount(tableName);

    const meta: TableMeta = {
      name: tableName, filePath: uri.fsPath,
      delimiter: delimiterName, delimiterChar,
      headers, columnTypes, rowCount,
    };
    this.tables.set(tableName, meta);
    return meta;
  }

  async dropTable(name: string): Promise<void> {
    await this.engine.query(`DROP TABLE IF EXISTS ${this.q(name)}`);
    this.tables.delete(name);
  }

  async dropAllTables(): Promise<void> {
    for (const name of this.tables.keys()) {
      await this.engine.query(`DROP TABLE IF EXISTS ${this.q(name)}`);
    }
    this.tables.clear();
  }

  getLoadedTables(): TableMeta[] {
    return Array.from(this.tables.values());
  }

  getTableMeta(name: string): TableMeta | undefined {
    return this.tables.get(name);
  }

  // ─── Schema Queries ──────────────────────────────────────────────────────

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
    const result = await this.engine.query(`SELECT COUNT(*) FROM ${this.q(tableName)}`);
    return Number(result.rows[0][0]);
  }

  // ─── Data Page (Pagination) ──────────────────────────────────────────────

  async getDataPage(
    tableName: string,
    params: { filters: ColumnFilters; sort: SortState; searchTerm: string; offset: number; limit: number }
  ): Promise<DataPage> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const whereStr = this.buildWhereStr(params.filters, params.searchTerm, headers);
    const orderClause = this.buildOrderClause(params.sort, headers);

    const { viewName, totalRows } = await this.ensureView(tableName, headers, whereStr, orderClause);
    const columns = headers.map(h => this.q(h)).join(', ');

    const result = await this.engine.query(
      `SELECT __rid, ${columns} FROM ${this.q(viewName)} ORDER BY __pos LIMIT ${params.limit} OFFSET ${params.offset}`
    );

    if (result.rows.length === 0) {
      return { rows: [], rowids: [], filteredCount: totalRows };
    }

    return {
      rows: result.rows.map(row => row.slice(1)),
      rowids: result.rows.map(row => parseInt(row[0], 10)),
      filteredCount: totalRows,
    };
  }

  async getUniqueValues(tableName: string, columnIndex: number): Promise<string[]> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    if (columnIndex < 0 || columnIndex >= headers.length) { return []; }

    const colName = this.q(headers[columnIndex]);
    const result = await this.engine.query(
      `SELECT DISTINCT CAST(${colName} AS VARCHAR) as val FROM ${this.q(tableName)} WHERE ${colName} IS NOT NULL ORDER BY ${colName} LIMIT 1000`
    );
    return result.rows.map(row => row[0]).filter(v => v !== '');
  }

  // ─── Mutations ───────────────────────────────────────────────────────────

  async updateCell(tableName: string, rowid: number, columnIndex: number, value: string): Promise<void> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    if (columnIndex < 0 || columnIndex >= headers.length) { return; }

    const colName = this.q(headers[columnIndex]);
    const escapedValue = value.replace(/'/g, "''");
    const quoted = this.q(tableName);
    const types = meta ? meta.columnTypes : await this.getColumnTypes(tableName);

    // Update the table
    const needsTypeChange = await this.isTypeIncompatible(escapedValue, types[columnIndex], value);
    if (needsTypeChange) {
      await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE VARCHAR`);
    }
    try {
      await this.engine.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
    } catch {
      await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE VARCHAR`);
      await this.engine.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
    }

    await this.tryTightenColumnType(tableName, columnIndex);
    if (meta) {
      meta.headers = await this.getHeaders(tableName);
      meta.columnTypes = await this.getColumnTypes(tableName);
    }

    // Update the view in-place (position unchanged)
    this.updateViewCell(columnIndex, rowid, value, meta);
  }

  async addRow(tableName: string): Promise<number> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const nulls = headers.map(() => "NULL").join(', ');

    await this.engine.query(`INSERT INTO ${this.q(tableName)} VALUES (${nulls})`);
    const result = await this.engine.query(`SELECT MAX(rowid) FROM ${this.q(tableName)}`);
    const newRowid = Number(result.rows[0][0]);

    await this.appendRowToView(newRowid, tableName);
    return newRowid;
  }

  async addRowAt(tableName: string, targetRowid: number, position: 'above' | 'below'): Promise<number> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const nulls = headers.map(() => "NULL").join(', ');

    // Fast: simple INSERT to get a rowid immediately
    await this.engine.query(`INSERT INTO ${this.q(tableName)} VALUES (${nulls})`);
    const result = await this.engine.query(`SELECT MAX(rowid) FROM ${this.q(tableName)}`);
    const newRowid = Number(result.rows[0][0]);

    this.invalidateView();

    // Background: rebuild table so physical order matches logical order (for save)
    this.pendingRebuild = this.rebuildForInsert(tableName, headers, newRowid, targetRowid, position)
      .finally(() => { this.pendingRebuild = null; });

    return newRowid;
  }

  async deleteRow(tableName: string, rowid: number): Promise<void> {
    await this.engine.query(`DELETE FROM ${this.q(tableName)} WHERE rowid = ${rowid}`);
    await this.removeRowFromView(rowid);
  }

  async deleteRows(tableName: string, rowids: number[]): Promise<void> {
    if (rowids.length === 0) { return; }
    if (rowids.length === 1) { return this.deleteRow(tableName, rowids[0]); }

    const idList = rowids.join(', ');
    await this.engine.query(`DELETE FROM ${this.q(tableName)} WHERE rowid IN (${idList})`);

    if (this.viewTable && this.viewFingerprint) {
      await this.engine.query(`DELETE FROM ${this.q(this.viewTable)} WHERE __rid IN (${idList})`);
    }
  }

  // ─── Materialized View ───────────────────────────────────────────────────

  invalidateView(): void {
    this.viewFingerprint = '';
  }

  private async ensureView(
    tableName: string, headers: string[], whereStr: string, orderClause: string
  ): Promise<{ viewName: string; totalRows: number }> {
    if (this.pendingRebuild) { await this.pendingRebuild; }

    const fingerprint = `${tableName}|${whereStr}|${orderClause}`;

    if (this.viewTable && this.viewFingerprint === fingerprint) {
      const countResult = await this.engine.query(`SELECT COUNT(*) FROM ${this.q(this.viewTable)}`);
      return { viewName: this.viewTable, totalRows: Number(countResult.rows[0][0]) };
    }

    if (this.viewBuildPromise) { return this.viewBuildPromise; }

    this.viewBuildPromise = this.buildView(tableName, headers, whereStr, orderClause, fingerprint);
    try {
      return await this.viewBuildPromise;
    } finally {
      this.viewBuildPromise = null;
    }
  }

  private async buildView(
    tableName: string, headers: string[], whereStr: string, orderClause: string, fingerprint: string
  ): Promise<{ viewName: string; totalRows: number }> {
    if (this.viewTable) {
      await this.engine.query(`DROP TABLE IF EXISTS ${this.q(this.viewTable)}`);
    }

    const viewName = `__view_${Date.now()}`;
    this.viewTable = viewName;
    this.viewFingerprint = fingerprint;

    const columns = headers.map(h => this.q(h)).join(', ');

    // Use subquery to ensure ORDER BY is applied before ROW_NUMBER
    await this.engine.query(
      `CREATE TEMP TABLE ${this.q(viewName)} AS ` +
      `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
      `(SELECT rowid as __rid, ${columns} FROM ${this.q(tableName)} ${whereStr} ${orderClause}) sub`
    );

    const countResult = await this.engine.query(`SELECT COUNT(*) FROM ${this.q(viewName)}`);
    return { viewName, totalRows: Number(countResult.rows[0][0]) };
  }

  /** Append a new row to the end of the view (for addRow). */
  private async appendRowToView(newRowid: number, tableName: string): Promise<void> {
    if (!this.viewTable || !this.viewFingerprint) { return; }

    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const columns = headers.map(h => this.q(h)).join(', ');
    const viewQ = this.q(this.viewTable);

    const maxResult = await this.engine.query(`SELECT COALESCE(MAX(__pos), -1) FROM ${viewQ}`);
    const nextPos = Number(maxResult.rows[0][0]) + 1;

    await this.engine.query(
      `INSERT INTO ${viewQ} SELECT ${nextPos} as __pos, ${newRowid} as __rid, ${columns} FROM ${this.q(tableName)} WHERE rowid = ${newRowid}`
    );
  }

  /** Remove a row from the view (for deleteRow). */
  private async removeRowFromView(rowid: number): Promise<void> {
    if (!this.viewTable || !this.viewFingerprint) { return; }
    await this.engine.query(`DELETE FROM ${this.q(this.viewTable)} WHERE __rid = ${rowid}`);
  }

  /** Update a single cell in the view (for updateCell). */
  private async updateViewCell(columnIndex: number, rowid: number, value: string, meta: TableMeta | undefined): Promise<void> {
    if (!this.viewTable || !this.viewFingerprint) { return; }

    const headers = meta ? meta.headers : await this.getHeaders('');
    const colName = this.q(headers[columnIndex]);
    const escapedVal = value.replace(/'/g, "''");

    try {
      await this.engine.query(`UPDATE ${this.q(this.viewTable)} SET ${colName} = '${escapedVal}' WHERE __rid = ${rowid}`);
    } catch {
      this.invalidateView();
    }
  }

  // ─── Background Table Rebuild ────────────────────────────────────────────

  /**
   * Rebuild the table so a newly inserted row is at the correct physical position.
   * Runs asynchronously — getDataPage waits for completion via pendingRebuild.
   */
  private async rebuildForInsert(
    tableName: string, headers: string[], newRowid: number, targetRowid: number, position: 'above' | 'below'
  ): Promise<void> {
    const quoted = this.q(tableName);
    const cols = headers.map(h => this.q(h)).join(', ');
    const tempName = `__temp_reorder_${Date.now()}`;
    const tempQ = this.q(tempName);

    const pivot = position === 'above' ? targetRowid : targetRowid + 1;
    const newRowPos = position === 'above' ? `${targetRowid} - 0.5` : `${targetRowid} + 0.5`;

    await this.engine.query(
      `CREATE TABLE ${tempQ} AS SELECT ${cols} FROM (` +
      `  SELECT ${cols}, rowid as __rid FROM ${quoted} WHERE rowid < ${pivot} AND rowid != ${newRowid}` +
      `  UNION ALL` +
      `  SELECT ${cols}, ${newRowid} as __rid FROM ${quoted} WHERE rowid = ${newRowid}` +
      `  UNION ALL` +
      `  SELECT ${cols}, rowid as __rid FROM ${quoted} WHERE rowid >= ${pivot} AND rowid != ${newRowid}` +
      `) ORDER BY CASE WHEN __rid = ${newRowid} THEN ${newRowPos} ELSE __rid END`
    );

    await this.engine.query(`DROP TABLE ${quoted}`);
    await this.engine.query(`ALTER TABLE ${tempQ} RENAME TO ${quoted}`);
    this.invalidateView();
  }

  // ─── Type Helpers ────────────────────────────────────────────────────────

  private async isTypeIncompatible(escapedValue: string, currentType: string, rawValue: string): Promise<boolean> {
    if (!currentType || currentType === 'VARCHAR') { return false; }
    if (rawValue === '') { return false; }
    try {
      const check = await this.engine.query(
        `SELECT TRY_CAST('${escapedValue}' AS ${currentType}) IS NOT NULL as ok`
      );
      return check.rows[0][0] !== 'true';
    } catch {
      return true;
    }
  }

  private async tryTightenColumnType(tableName: string, columnIndex: number): Promise<void> {
    const meta = this.tables.get(tableName);
    const types = meta ? meta.columnTypes : await this.getColumnTypes(tableName);
    if (types[columnIndex] !== 'VARCHAR') { return; }

    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const colName = this.q(headers[columnIndex]);
    const quoted = this.q(tableName);
    const candidates = ['BOOLEAN', 'BIGINT', 'DOUBLE', 'DATE', 'TIMESTAMP'];

    for (const targetType of candidates) {
      try {
        const check = await this.engine.query(
          `SELECT COUNT(*) = COUNT(TRY_CAST(${colName} AS ${targetType})) as ok FROM ${quoted} WHERE ${colName} IS NOT NULL AND ${colName} != ''`
        );
        if (check.rows[0][0] === 'true') {
          await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE ${targetType}`);
          return;
        }
      } catch { /* skip */ }
    }
  }

  // ─── SQL Helpers ─────────────────────────────────────────────────────────

  /** Quote a SQL identifier. */
  private q(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  private buildWhereStr(filters: ColumnFilters, searchTerm: string, headers: string[]): string {
    const clauses: string[] = [];

    for (const [colIdx, values] of Object.entries(filters)) {
      if (values.length === 0) { continue; }
      const colName = this.q(headers[parseInt(colIdx, 10)]);
      const escaped = values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
      clauses.push(`${colName} IN (${escaped})`);
    }

    if (searchTerm) {
      const escaped = searchTerm.replace(/'/g, "''").replace(/%/g, '\\%');
      const searchClauses = headers.map(h => `CAST(${this.q(h)} AS VARCHAR) ILIKE '%${escaped}%'`);
      clauses.push(`(${searchClauses.join(' OR ')})`);
    }

    return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  private buildOrderClause(sort: SortState, headers: string[]): string {
    if (sort.direction === 'none' || sort.columnIndex < 0 || sort.columnIndex >= headers.length) {
      return '';
    }
    const dir = sort.direction === 'asc' ? 'ASC' : 'DESC';
    return `ORDER BY ${this.q(headers[sort.columnIndex])} ${dir} NULLS LAST`;
  }

  private deriveTableName(uri: vscode.Uri): string {
    const fileName = basename(uri.fsPath, extname(uri.fsPath));
    let name = fileName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (/^\d/.test(name)) { name = '_' + name; }
    if (!this.tables.has(name)) { return name; }

    let counter = 2;
    while (this.tables.has(`${name}_${counter}`)) { counter++; }
    return `${name}_${counter}`;
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
