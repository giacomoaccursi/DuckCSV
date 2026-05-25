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

import { IQueryEngine } from './IQueryEngine';
import { SqlBuilder } from './SqlBuilder';
import { SortState, ColumnFilters, ColumnProfile, SelectionStatsPayload } from '../types';
import * as vscode from 'vscode';
import { basename, extname } from 'path';
import { open } from 'fs/promises';

export interface TableMeta {
  name: string;
  filePath: string;
  delimiter: string;
  delimiterChar: string;
  headers: string[];
  columnTypes: string[];
  originalTypes: string[]; // Types assigned by DuckDB at load time
  rowCount: number;
  useOrigRid?: boolean; // Use __orig_rid column as rowid in view (for query results)
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
  private viewTotalRows: number = 0;
  private viewBuildPromise: Promise<{ viewName: string; totalRows: number }> | null = null;
  private pendingRebuild: Promise<void> | null = null;

  constructor(private readonly engine: IQueryEngine) {}

  // ─── Table Lifecycle ─────────────────────────────────────────────────────

  async loadTable(uri: vscode.Uri, customName?: string): Promise<TableMeta> {
    const tableName = customName ?? this.deriveTableName(uri);
    const filePath = uri.fsPath.replace(/'/g, "''");
    const isParquet = uri.fsPath.toLowerCase().endsWith('.parquet');

    // Only restart worker if reloading the same table (to clear DuckDB file cache)
    if (this.tables.has(tableName)) {
      this.engine.cancel();
    }
    this.viewTable = null;
    this.viewFingerprint = '';
    this.viewTotalRows = 0;
    this.tables.delete(tableName);

    await this.engine.query(`DROP TABLE IF EXISTS ${this.q(tableName)}`);

    if (isParquet) {
      await this.engine.query(
        `CREATE TABLE ${this.q(tableName)} AS SELECT * FROM read_parquet('${filePath}')`
      );
    } else {
      await this.engine.query(
        `CREATE TABLE ${this.q(tableName)} AS SELECT * FROM read_csv_auto('${filePath}', ignore_errors=true)`
      );
    }

    // Get schema + row count in minimal queries
    const escaped = tableName.replace(/'/g, "''");
    const schemaResult = await this.engine.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${escaped}' ORDER BY ordinal_position`
    );
    const headers = schemaResult.rows.map(row => row[0]);
    const columnTypes = schemaResult.rows.map(row => row[1]);

    // Get row count from DuckDB table statistics (avoids full scan)
    const countResult = await this.engine.query(
      `SELECT estimated_size FROM duckdb_tables() WHERE table_name = '${escaped}'`
    );
    let rowCount: number;
    if (countResult.rows.length > 0 && countResult.rows[0][0]) {
      rowCount = Number(countResult.rows[0][0]);
    } else {
      rowCount = await this.getRowCount(tableName);
    }

    // Detect delimiter (only for CSV/TSV — Parquet uses Comma as default for export)
    let delimiterName = 'Comma';
    let delimiterChar = ',';
    if (!isParquet) {
      const detectedDelimiter = await this.detectDelimiterFast(uri.fsPath);
      ({ name: delimiterName, char: delimiterChar } = this.delimiterInfo(detectedDelimiter));
    }

    const meta: TableMeta = {
      name: tableName, filePath: uri.fsPath,
      delimiter: delimiterName, delimiterChar,
      headers, columnTypes, originalTypes: [...columnTypes], rowCount,
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

  /** Register an existing table (e.g. from a query result) without loading from file. */
  registerTable(meta: TableMeta): void {
    this.tables.set(meta.name, meta);
  }

  /** Remove a table from the registry without dropping it from DuckDB. */
  unregisterTable(name: string): void {
    this.tables.delete(name);
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
    const whereStr = SqlBuilder.buildWhere(params.filters, params.searchTerm, headers);
    const orderClause = SqlBuilder.buildOrderBy(params.sort, headers);

    // Fast path: no sort/filter/search → read directly from table (skip view creation)
    if (!whereStr && !orderClause) {
      const columns = headers.map(h => this.q(h)).join(', ');
      const ridSource = meta?.useOrigRid ? '"__orig_rid"' : 'rowid';
      const result = await this.engine.query(
        `SELECT ${ridSource} as __rid, ${columns} FROM ${this.q(tableName)} LIMIT ${params.limit} OFFSET ${params.offset}`
      );
      const totalRows = meta ? meta.rowCount : await this.getRowCount(tableName);

      if (result.rows.length === 0) {
        return { rows: [], rowids: [], filteredCount: totalRows };
      }
      return {
        rows: result.rows.map(row => row.slice(1)),
        rowids: result.rows.map(row => parseInt(row[0], 10)),
        filteredCount: totalRows,
      };
    }

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

  async getUniqueValues(tableName: string, columnIndex: number, filters: ColumnFilters = {}, searchTerm: string = '', afterValue?: string): Promise<string[]> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    if (columnIndex < 0 || columnIndex >= headers.length) { return []; }

    const colName = this.q(headers[columnIndex]);

    // Build WHERE from active filters (excluding the column being queried)
    const otherFilters: ColumnFilters = {};
    for (const [idx, values] of Object.entries(filters)) {
      const colIdx = parseInt(idx, 10);
      if (colIdx !== columnIndex) { otherFilters[colIdx] = values; }
    }
    const baseWhere = SqlBuilder.buildWhere(otherFilters, searchTerm, headers);
    const notNull = `${colName} IS NOT NULL`;
    const conditions = [notNull];

    // Cursor-based pagination: compare on native column type (DuckDB auto-casts the string)
    if (afterValue !== undefined) {
      const escaped = afterValue.replace(/'/g, "''");
      conditions.push(`${colName} > '${escaped}'`);
    }

    const whereStr = baseWhere
      ? `${baseWhere} AND ${conditions.join(' AND ')}`
      : `WHERE ${conditions.join(' AND ')}`;

    const result = await this.engine.query(
      `SELECT DISTINCT CAST(${colName} AS VARCHAR) as val FROM ${this.q(tableName)} ${whereStr} ORDER BY ${colName} LIMIT 100`
    );
    return result.rows.map(row => row[0]).filter(v => v !== '');
  }

  /** Search unique values in a column matching a search term. Used by filter dropdown search. */
  async searchUniqueValues(tableName: string, columnIndex: number, valueTerm: string, filters: ColumnFilters = {}, searchTerm: string = ''): Promise<string[]> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    if (columnIndex < 0 || columnIndex >= headers.length) { return []; }

    const colName = this.q(headers[columnIndex]);
    const escapedTerm = valueTerm.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');

    const otherFilters: ColumnFilters = {};
    for (const [idx, values] of Object.entries(filters)) {
      const colIdx = parseInt(idx, 10);
      if (colIdx !== columnIndex) { otherFilters[colIdx] = values; }
    }
    const baseWhere = SqlBuilder.buildWhere(otherFilters, searchTerm, headers);
    const notNull = `${colName} IS NOT NULL`;
    const ilike = `CAST(${colName} AS VARCHAR) ILIKE '%${escapedTerm}%' ESCAPE '\\'`;
    const conditions = [notNull, ilike];
    const whereStr = baseWhere
      ? `${baseWhere} AND ${conditions.join(' AND ')}`
      : `WHERE ${conditions.join(' AND ')}`;

    const result = await this.engine.query(
      `SELECT DISTINCT CAST(${colName} AS VARCHAR) as val FROM ${this.q(tableName)} ${whereStr} ORDER BY ${colName} LIMIT 100`
    );
    return result.rows.map(row => row[0]).filter(v => v !== '');
  }

  // ─── Column Profiling ──────────────────────────────────────────────────────

  async getColumnProfile(tableName: string, columnIndex: number): Promise<ColumnProfile> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const types = meta ? meta.columnTypes : await this.getColumnTypes(tableName);
    if (columnIndex < 0 || columnIndex >= headers.length) {
      throw new Error(`Invalid column index: ${columnIndex}`);
    }

    const colName = this.q(headers[columnIndex]);
    const quoted = this.q(tableName);
    const colType = types[columnIndex] || 'VARCHAR';
    const isNumeric = this.isNumericType(colType);
    const isDate = this.isDateType(colType);

    // Basic stats
    const statsResult = await this.engine.query(
      `SELECT COUNT(*) as total, COUNT(${colName}) as non_null, COUNT(DISTINCT ${colName}) as unique_count FROM ${quoted}`
    );
    const totalRows = Number(statsResult.rows[0][0]);
    const nonNullCount = Number(statsResult.rows[0][1]);
    const uniqueCount = Number(statsResult.rows[0][2]);
    const nullPercent = totalRows > 0 ? ((totalRows - nonNullCount) / totalRows) * 100 : 0;

    const profile: ColumnProfile = {
      columnName: headers[columnIndex],
      columnType: colType,
      totalRows,
      nonNullCount,
      uniqueCount,
      nullPercent: Math.round(nullPercent * 100) / 100,
      distribution: [],
      chartType: isNumeric ? 'histogram' : isDate ? 'line' : 'bar',
    };

    // Numeric stats
    if (isNumeric) {
      const numResult = await this.engine.query(
        `SELECT CAST(MIN(${colName}) AS VARCHAR), CAST(MAX(${colName}) AS VARCHAR), ` +
        `CAST(AVG(${colName}) AS VARCHAR), CAST(MEDIAN(${colName}) AS VARCHAR), ` +
        `CAST(STDDEV(${colName}) AS VARCHAR) FROM ${quoted} WHERE ${colName} IS NOT NULL`
      );
      if (numResult.rows.length > 0) {
        profile.min = numResult.rows[0][0];
        profile.max = numResult.rows[0][1];
        profile.mean = numResult.rows[0][2];
        profile.median = numResult.rows[0][3];
        profile.stddev = numResult.rows[0][4];
      }

      // Histogram distribution (20 buckets)
      profile.distribution = await this.getNumericDistribution(quoted, colName);
    } else if (isDate) {
      // Date distribution
      profile.distribution = await this.getDateDistribution(quoted, colName);
    } else {
      // Categorical distribution (top 20)
      const catResult = await this.engine.query(
        `SELECT CAST(${colName} AS VARCHAR) as val, COUNT(*) as cnt FROM ${quoted} ` +
        `WHERE ${colName} IS NOT NULL GROUP BY ${colName} ORDER BY cnt DESC LIMIT 20`
      );
      profile.distribution = catResult.rows.map(r => ({
        label: r[0] || '(empty)',
        count: Number(r[1]),
      }));
    }

    return profile;
  }

  private isNumericType(type: string): boolean {
    const numericTypes = ['BIGINT', 'DOUBLE', 'INTEGER', 'FLOAT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'NUMERIC', 'REAL', 'HUGEINT', 'UBIGINT', 'UINTEGER', 'USMALLINT', 'UTINYINT'];
    return numericTypes.some(t => type.toUpperCase().startsWith(t));
  }

  private isDateType(type: string): boolean {
    const dateTypes = ['DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIMESTAMP WITH TIME ZONE'];
    return dateTypes.some(t => type.toUpperCase().startsWith(t));
  }

  private async getNumericDistribution(quotedTable: string, colName: string): Promise<{ label: string; count: number }[]> {
    // Get min/max to compute bucket size
    const rangeResult = await this.engine.query(
      `SELECT MIN(${colName}), MAX(${colName}) FROM ${quotedTable} WHERE ${colName} IS NOT NULL`
    );
    if (rangeResult.rows.length === 0) { return []; }
    const min = Number(rangeResult.rows[0][0]);
    const max = Number(rangeResult.rows[0][1]);
    if (isNaN(min) || isNaN(max) || min === max) {
      return [{ label: String(min), count: 1 }];
    }

    const bucketCount = 20;
    const bucketSize = (max - min) / bucketCount;

    const histResult = await this.engine.query(
      `SELECT FLOOR((${colName} - ${min}) / ${bucketSize}) as bucket, COUNT(*) as cnt ` +
      `FROM ${quotedTable} WHERE ${colName} IS NOT NULL ` +
      `GROUP BY bucket ORDER BY bucket`
    );

    return histResult.rows.map(r => {
      const bucketIdx = Number(r[0]);
      const bucketStart = min + bucketIdx * bucketSize;
      const bucketEnd = bucketStart + bucketSize;
      return {
        label: `${this.formatNumber(bucketStart)}-${this.formatNumber(bucketEnd)}`,
        count: Number(r[1]),
      };
    });
  }

  private async getDateDistribution(quotedTable: string, colName: string): Promise<{ label: string; count: number }[]> {
    const result = await this.engine.query(
      `SELECT CAST(DATE_TRUNC('month', ${colName}) AS VARCHAR) as period, COUNT(*) as cnt ` +
      `FROM ${quotedTable} WHERE ${colName} IS NOT NULL ` +
      `GROUP BY period ORDER BY period LIMIT 30`
    );
    return result.rows.map(r => ({
      label: r[0] || '',
      count: Number(r[1]),
    }));
  }

  private formatNumber(n: number): string {
    if (Number.isInteger(n)) { return String(n); }
    return n.toFixed(1);
  }

  // ─── Selection Stats ─────────────────────────────────────────────────────

  async getSelectionStats(
    tableName: string,
    columns: number[],
    startRow: number,
    endRow: number,
    filters: ColumnFilters,
    sort: SortState,
    searchTerm: string
  ): Promise<SelectionStatsPayload> {
    const meta = this.tables.get(tableName);
    const headers = meta ? meta.headers : await this.getHeaders(tableName);
    const types = meta ? meta.columnTypes : await this.getColumnTypes(tableName);

    const rowCount = endRow - startRow + 1;
    const colCount = columns.length;
    const count = rowCount * colCount;

    // Find numeric columns in the selection
    const numericCols = columns.filter(c => c >= 0 && c < types.length && this.isNumericType(types[c]));

    if (numericCols.length === 0) {
      return { count, hasNumeric: false };
    }

    // Build a subquery that selects only the rows in the positional range
    const whereStr = SqlBuilder.buildWhere(filters, searchTerm, headers);
    const orderClause = SqlBuilder.buildOrderBy(sort, headers);

    // Use a CTE with ROW_NUMBER to get positional access
    const allCols = numericCols.map(c => this.q(headers[c]));
    const selectCols = allCols.join(', ');

    // Build aggregate expressions for all numeric columns combined
    // We compute stats across all selected numeric columns by unpivoting
    const aggParts: string[] = [];
    for (const col of numericCols) {
      const colQ = this.q(headers[col]);
      aggParts.push(`SUM(${colQ})`);
      aggParts.push(`MIN(${colQ})`);
      aggParts.push(`MAX(${colQ})`);
      aggParts.push(`COUNT(${colQ})`);
    }

    // Query: get the rows in the positional range, then aggregate
    const sql = `WITH ranked AS (
      SELECT ${selectCols}, ROW_NUMBER() OVER(${orderClause || ''}) - 1 as __rn
      FROM ${this.q(tableName)} ${whereStr}
    )
    SELECT ${aggParts.join(', ')}
    FROM ranked
    WHERE __rn >= ${startRow} AND __rn <= ${endRow}`;

    const result = await this.engine.query(sql);
    if (result.rows.length === 0) {
      return { count, hasNumeric: true };
    }

    const row = result.rows[0];
    // Parse results: for each numeric column we have SUM, MIN, MAX, COUNT (4 values)
    let totalSum = 0;
    let totalMin = Infinity;
    let totalMax = -Infinity;
    let totalNonNull = 0;

    for (let i = 0; i < numericCols.length; i++) {
      const base = i * 4;
      const sum = Number(row[base]);
      const min = Number(row[base + 1]);
      const max = Number(row[base + 2]);
      const cnt = Number(row[base + 3]);

      if (!isNaN(sum)) { totalSum += sum; }
      if (!isNaN(min) && min < totalMin) { totalMin = min; }
      if (!isNaN(max) && max > totalMax) { totalMax = max; }
      if (!isNaN(cnt)) { totalNonNull += cnt; }
    }

    const avg = totalNonNull > 0 ? totalSum / totalNonNull : undefined;

    return {
      count,
      sum: isFinite(totalSum) ? totalSum : undefined,
      avg,
      min: isFinite(totalMin) ? totalMin : undefined,
      max: isFinite(totalMax) ? totalMax : undefined,
      hasNumeric: true,
    };
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

    // Update the table, widening type if needed
    let typeWidened = false;
    const needsTypeChange = await this.isTypeIncompatible(escapedValue, types[columnIndex], value);
    if (needsTypeChange) {
      await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE VARCHAR`);
      typeWidened = true;
    }
    try {
      await this.engine.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
    } catch {
      await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE VARCHAR`);
      await this.engine.query(`UPDATE ${quoted} SET ${colName} = '${escapedValue}' WHERE rowid = ${rowid}`);
      typeWidened = true;
    }

    // Update meta.columnTypes locally (no query needed)
    if (meta) {
      if (typeWidened) {
        meta.columnTypes[columnIndex] = 'VARCHAR';
      }
      // Try to tighten back to original type
      const tightened = await this.tryTightenColumnType(tableName, columnIndex, value);
      if (tightened && meta.originalTypes[columnIndex]) {
        meta.columnTypes[columnIndex] = meta.originalTypes[columnIndex];
      }
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
      this.viewTotalRows -= rowids.length;
    }
  }

  // ─── Materialized View ───────────────────────────────────────────────────

  invalidateView(): void {
    this.viewFingerprint = '';
  }

  async awaitPendingRebuild(): Promise<void> {
    if (this.pendingRebuild) { await this.pendingRebuild; }
  }

  private async ensureView(
    tableName: string, headers: string[], whereStr: string, orderClause: string
  ): Promise<{ viewName: string; totalRows: number }> {
    if (this.pendingRebuild) { await this.pendingRebuild; }

    const fingerprint = `${tableName}|${whereStr}|${orderClause}`;

    if (this.viewTable && this.viewFingerprint === fingerprint) {
      return { viewName: this.viewTable, totalRows: this.viewTotalRows };
    }

    // If a build is in progress, wait for it then check again
    if (this.viewBuildPromise) {
      await this.viewBuildPromise;
      if (this.viewTable && this.viewFingerprint === fingerprint) {
        return { viewName: this.viewTable, totalRows: this.viewTotalRows };
      }
    }

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

    const meta = this.tables.get(tableName);
    const columns = headers.map(h => this.q(h)).join(', ');
    const ridSource = meta?.useOrigRid ? '"__orig_rid"' : 'rowid';

    // Use subquery to ensure ORDER BY is applied before ROW_NUMBER
    await this.engine.query(
      `CREATE TEMP TABLE ${this.q(viewName)} AS ` +
      `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
      `(SELECT ${ridSource} as __rid, ${columns} FROM ${this.q(tableName)} ${whereStr} ${orderClause}) sub`
    );

    const countResult = await this.engine.query(`SELECT COUNT(*) FROM ${this.q(viewName)}`);
    const totalRows = Number(countResult.rows[0][0]);
    this.viewTotalRows = totalRows;
    return { viewName, totalRows };
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
    this.viewTotalRows++;
  }

  /** Remove a row from the view (for deleteRow). */
  private async removeRowFromView(rowid: number): Promise<void> {
    if (!this.viewTable || !this.viewFingerprint) { return; }
    await this.engine.query(`DELETE FROM ${this.q(this.viewTable)} WHERE __rid = ${rowid}`);
    this.viewTotalRows--;
  }

  /** Update a single cell in the view (for updateCell). */
  private async updateViewCell(columnIndex: number, rowid: number, value: string, meta: TableMeta | undefined): Promise<void> {
    if (!this.viewTable || !this.viewFingerprint || !meta) { return; }

    const colName = this.q(meta.headers[columnIndex]);
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

  /**
   * Try to tighten a VARCHAR column back to its original type.
   * Only runs if:
   * - The column is currently VARCHAR
   * - It was originally a different type (was widened during editing)
   * - The new value is compatible with the original type (there's a chance to tighten)
   */
  private async tryTightenColumnType(tableName: string, columnIndex: number, newValue: string): Promise<boolean> {
    const meta = this.tables.get(tableName);
    if (!meta) { return false; }

    const currentType = meta.columnTypes[columnIndex];
    if (currentType !== 'VARCHAR') { return false; }

    const originalType = meta.originalTypes[columnIndex];
    if (!originalType || originalType === 'VARCHAR') { return false; }

    // Only try if the new value is compatible with the original type
    if (newValue !== '') {
      const escaped = newValue.replace(/'/g, "''");
      try {
        const check = await this.engine.query(
          `SELECT TRY_CAST('${escaped}' AS ${originalType}) IS NOT NULL as ok`
        );
        if (check.rows[0][0] !== 'true') { return false; }
      } catch { return false; }
    }

    // The new value is compatible — check if ALL values can go back to original type
    const colName = this.q(meta.headers[columnIndex]);
    const quoted = this.q(tableName);
    try {
      const check = await this.engine.query(
        `SELECT COUNT(*) = COUNT(TRY_CAST(${colName} AS ${originalType})) as ok FROM ${quoted} WHERE ${colName} IS NOT NULL AND ${colName} != ''`
      );
      if (check.rows[0][0] === 'true') {
        // Convert empty strings to NULL before tightening (ALTER fails on '')
        await this.engine.query(`UPDATE ${quoted} SET ${colName} = NULL WHERE ${colName} = ''`);
        await this.engine.query(`ALTER TABLE ${quoted} ALTER COLUMN ${colName} TYPE ${originalType}`);
        return true;
      }
    } catch { /* can't tighten */ }
    return false;
  }

  // ─── SQL Helpers ─────────────────────────────────────────────────────────

  /** Quote a SQL identifier. */
  private q(name: string): string {
    return SqlBuilder.quote(name);
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

  /**
   * Fast delimiter detection by reading the first 8KB of the file.
   * Counts occurrences of common delimiters in the first line and picks the most frequent.
   */
  private async detectDelimiterFast(filePath: string): Promise<string> {
    try {
      const fh = await open(filePath, 'r');
      const buf = Buffer.alloc(8192);
      const { bytesRead } = await fh.read(buf, 0, 8192, 0);
      await fh.close();

      const sample = buf.toString('utf8', 0, bytesRead);
      const firstLine = sample.split('\n')[0] || '';

      // Count delimiter candidates in the first line
      const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
      for (const ch of firstLine) {
        if (ch in counts) { counts[ch]++; }
      }

      // Pick the delimiter with the highest count (must appear at least once)
      let best = ',';
      let bestCount = 0;
      for (const [delim, count] of Object.entries(counts)) {
        if (count > bestCount) { best = delim; bestCount = count; }
      }
      return best;
    } catch {
      return ','; // fallback
    }
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
