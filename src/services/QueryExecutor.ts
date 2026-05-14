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

  async execute(sql: string, defaultTable?: string): Promise<QueryResult> {
    const conn = await this.engine.getConnection();
    const start = performance.now();

    try {
      const normalizedSql = defaultTable
        ? this.normalizeSql(sql, defaultTable)
        : sql.trim();

      const MAX_DISPLAY_ROWS = 10_000;
      const result = conn.query(normalizedSql);

      const headers: string[] = result.schema.fields.map((f: any) => f.name);
      const totalCount = result.numRows;
      const rows = this.arrowTableToRows(result, MAX_DISPLAY_ROWS);

      return {
        headers,
        rows,
        rowCount: rows.length,
        totalCount,
        executionTimeMs: performance.now() - start,
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

  private normalizeSql(sql: string, defaultTable: string): string {
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

  private arrowTableToRows(table: any, maxRows?: number): string[][] {
    const rows: string[][] = [];
    const numRows = Math.min(table.numRows, maxRows ?? table.numRows);
    const numCols = table.numCols;

    for (let i = 0; i < numRows; i++) {
      const row: string[] = [];
      for (let j = 0; j < numCols; j++) {
        const val = table.getChildAt(j)?.get(i);
        row.push(this.formatValue(val));
      }
      rows.push(row);
    }

    return rows;
  }

  private formatValue(val: any): string {
    if (val === null || val === undefined) { return ''; }
    if (val instanceof Date) { return val.toISOString().split('T')[0]; }
    if (typeof val === 'bigint') { return val.toString(); }
    return String(val);
  }
}
