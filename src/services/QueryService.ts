/**
 * SQL query execution service.
 * Runs SQL queries against CsvDocument data using AlaSQL.
 */

import alasql from 'alasql';
import { CsvDocument } from '../models/CsvDocument';

export interface QueryResult {
  headers: string[];
  rows: string[][];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

export class QueryService {
  /**
   * Execute a SQL query against a CsvDocument.
   * The table is referenced as `csv` in the query (or as `?` parameter).
   *
   * Supports: SELECT, WHERE, ORDER BY, GROUP BY, HAVING, LIMIT,
   * aggregations (COUNT, SUM, AVG, MIN, MAX), LIKE, IN, BETWEEN, etc.
   */
  execute(document: CsvDocument, sql: string): QueryResult {
    const start = performance.now();

    try {
      const data = this.toObjectArray(document);
      const normalizedSql = this.normalizeSql(sql);

      const rawResult = alasql(normalizedSql, [data]) as Record<string, unknown>[];

      if (!Array.isArray(rawResult) || rawResult.length === 0) {
        return {
          headers: [],
          rows: [],
          rowCount: 0,
          executionTimeMs: performance.now() - start,
        };
      }

      const headers = Object.keys(rawResult[0]);
      const rows = rawResult.map(obj =>
        headers.map(h => this.formatValue(obj[h]))
      );

      return {
        headers,
        rows,
        rowCount: rows.length,
        executionTimeMs: performance.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Query execution failed';
      return {
        headers: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: performance.now() - start,
        error: message,
      };
    }
  }

  /**
   * Convert CsvDocument data to an array of objects for AlaSQL.
   * Uses sanitized header names as keys.
   */
  private toObjectArray(document: CsvDocument): Record<string, string>[] {
    const headers = document.headers;
    const page = document.getPage(0, document.getTotalRows());
    const data = page.rows;

    return data.map(row => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = row[i] ?? '';
      }
      return obj;
    });
  }

  /**
   * Normalize SQL: if user writes just a WHERE clause or omits FROM,
   * wrap it into a proper SELECT statement.
   */
  private normalizeSql(sql: string): string {
    const trimmed = sql.trim();

    // If it starts with SELECT and has FROM ?, it's ready
    if (/^SELECT\s/i.test(trimmed) && /FROM\s+\?/i.test(trimmed)) {
      return trimmed;
    }

    // If it starts with SELECT but no FROM, inject FROM ?
    if (/^SELECT\s/i.test(trimmed)) {
      // Insert "FROM ?" after the column list (before WHERE/ORDER/GROUP/LIMIT/HAVING or end)
      const insertPoint = trimmed.search(/\b(WHERE|ORDER|GROUP|LIMIT|HAVING)\b/i);
      if (insertPoint === -1) {
        return trimmed + ' FROM ?';
      }
      return trimmed.slice(0, insertPoint) + 'FROM ? ' + trimmed.slice(insertPoint);
    }

    // If it starts with WHERE, wrap as SELECT * FROM ? WHERE ...
    if (/^WHERE\s/i.test(trimmed)) {
      return 'SELECT * FROM ? ' + trimmed;
    }

    // Otherwise assume it's a full query, add FROM ? if missing
    if (!/FROM\s+\?/i.test(trimmed)) {
      return trimmed.replace(/FROM\s+\w+/i, 'FROM ?');
    }

    return trimmed;
  }

  private formatValue(val: unknown): string {
    if (val === null || val === undefined) { return ''; }
    return String(val);
  }
}
