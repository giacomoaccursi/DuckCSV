/**
 * QueryExecutor — executes user SQL queries against DuckDB.
 * Normalizes SQL (adds FROM table if missing for single-table context).
 */

import { DuckDbEngine } from './DuckDbEngine';

export interface QueryResult {
  headers: string[];
  rows: string[][];
  rowCount: number;
  totalCount: number;
  executionTimeMs: number;
  error?: string;
}

export class QueryExecutor {
  constructor(private readonly engine: DuckDbEngine) {}

  getEngine(): DuckDbEngine { return this.engine; }

  cancel(): void {
    this.engine.cancel();
  }

  async execute(sql: string, defaultTable?: string): Promise<QueryResult> {
    const start = performance.now();

    try {
      const normalizedSql = defaultTable
        ? this.normalizeSql(sql, defaultTable)
        : sql.trim();

      const result = await this.engine.query(normalizedSql);

      return {
        headers: result.columns,
        rows: result.rows,
        rowCount: result.rows.length,
        totalCount: result.numRows,
        executionTimeMs: performance.now() - start,
        error: result.numRows > result.rows.length
          ? `Showing first ${result.rows.length.toLocaleString()} of ${result.numRows.toLocaleString()} rows`
          : undefined,
      };
    } catch (err: unknown) {
      return {
        headers: [],
        rows: [],
        rowCount: 0,
        totalCount: 0,
        executionTimeMs: performance.now() - start,
        error: err instanceof Error ? err.message : 'Query failed',
      };
    }
  }

  normalizeSql(sql: string, defaultTable: string): string {
    const trimmed = sql.trim();
    const quotedTable = `"${defaultTable.replace(/"/g, '""')}"`;

    // If already has FROM clause referencing any table, leave as-is
    if (/\bFROM\s+/i.test(trimmed)) {
      return trimmed;
    }

    // SELECT without FROM → append FROM defaultTable
    if (/^SELECT\s/i.test(trimmed)) {
      const insertPoint = trimmed.search(/\b(WHERE|ORDER|GROUP|LIMIT|HAVING)\b/i);
      if (insertPoint === -1) {
        return `${trimmed} FROM ${quotedTable}`;
      }
      return `${trimmed.slice(0, insertPoint)}FROM ${quotedTable} ${trimmed.slice(insertPoint)}`;
    }

    // WHERE without SELECT → wrap as SELECT * FROM table WHERE ...
    if (/^WHERE\s/i.test(trimmed)) {
      return `SELECT * FROM ${quotedTable} ${trimmed}`;
    }

    return trimmed;
  }
}
