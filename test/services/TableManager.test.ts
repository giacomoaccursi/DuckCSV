/**
 * Integration tests for TableManager.
 * Uses DuckDB WASM (node blocking) directly to test real SQL queries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';

// Use the same DuckDB blocking API as the worker
// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

// ─── Minimal DuckDbEngine interface for testing ──────────────────────────────

interface QueryResponse {
  columns: string[];
  columnTypes: string[];
  rows: string[][];
  numRows: number;
}

class TestDuckDbEngine {
  private db: any;
  private conn: any;

  async init() {
    const DUCKDB_DIST = join(__dirname, '..', '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
    const DUCKDB_BUNDLES = {
      mvp: {
        mainModule: join(DUCKDB_DIST, 'duckdb-mvp.wasm'),
        mainWorker: join(DUCKDB_DIST, 'duckdb-node-mvp.worker.cjs'),
      },
      eh: {
        mainModule: join(DUCKDB_DIST, 'duckdb-eh.wasm'),
        mainWorker: join(DUCKDB_DIST, 'duckdb-node-eh.worker.cjs'),
      },
    };
    const logger = new duckdb.VoidLogger();
    this.db = await duckdb.createDuckDB(DUCKDB_BUNDLES, logger, duckdb.NODE_RUNTIME);
    await this.db.instantiate();
    this.db.open({ query: { castBigIntToDouble: true } });
    this.conn = this.db.connect();
  }

  async query(sql: string): Promise<QueryResponse> {
    const result = this.conn.query(sql);
    const columns: string[] = result.schema.fields.map((f: any) => f.name);
    const columnTypes: string[] = result.schema.fields.map((f: any) => String(f.type));
    const rows: string[][] = [];
    for (let i = 0; i < result.numRows; i++) {
      const row: string[] = [];
      for (let j = 0; j < columns.length; j++) {
        const col = result.getChildAt(j);
        const val = col?.get(i);
        row.push(val === null || val === undefined ? '' : String(val));
      }
      rows.push(row);
    }
    return { columns, columnTypes, rows, numRows: result.numRows };
  }

  cancel() {}

  dispose() {
    if (this.conn) { this.conn.close(); this.conn = null; }
    if (this.db) { this.db.dropFiles(); this.db = null; }
  }
}

// ─── Import TableManager (need to mock vscode) ──────────────────────────────

// We can't import TableManager directly because it imports 'vscode'.
// Instead, test the SQL logic directly using the engine.

describe('TableManager SQL logic', () => {
  let engine: TestDuckDbEngine;
  const testCsvPath = join(__dirname, '..', '..', 'test-data-tmp.csv');

  beforeEach(async () => {
    engine = new TestDuckDbEngine();
    await engine.init();

    // Create a test CSV
    const csv = 'Name,Age,City\nAlice,30,Rome\nBob,25,Milan\nCharlie,35,Naples\nDiana,28,Turin\n';
    writeFileSync(testCsvPath, csv);

    // Load it into DuckDB
    await engine.query(`CREATE TABLE csv AS SELECT * FROM read_csv_auto('${testCsvPath.replace(/'/g, "''")}', ignore_errors=true)`);
  });

  afterEach(() => {
    engine.dispose();
    try { unlinkSync(testCsvPath); } catch {}
  });

  // ─── Sort Tests ──────────────────────────────────────────────────────────

  describe('sort via materialized view', () => {
    it('should sort ascending', async () => {
      const columns = '"Name", "Age", "City"';
      const orderClause = 'ORDER BY "Age" ASC NULLS LAST';

      // Build view with subquery (the fix for ROW_NUMBER)
      await engine.query(
        `CREATE TEMP TABLE __view_test AS ` +
        `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
        `(SELECT rowid as __rid, ${columns} FROM "csv" ${orderClause}) sub`
      );

      const result = await engine.query(
        `SELECT __rid, ${columns} FROM __view_test ORDER BY __pos LIMIT 4 OFFSET 0`
      );

      // Should be sorted by Age ascending: Bob(25), Diana(28), Alice(30), Charlie(35)
      expect(result.rows[0][1]).toBe('Bob');
      expect(result.rows[1][1]).toBe('Diana');
      expect(result.rows[2][1]).toBe('Alice');
      expect(result.rows[3][1]).toBe('Charlie');
    });

    it('should sort descending', async () => {
      const columns = '"Name", "Age", "City"';
      const orderClause = 'ORDER BY "Name" DESC NULLS LAST';

      await engine.query(
        `CREATE TEMP TABLE __view_desc AS ` +
        `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
        `(SELECT rowid as __rid, ${columns} FROM "csv" ${orderClause}) sub`
      );

      const result = await engine.query(
        `SELECT __rid, ${columns} FROM __view_desc ORDER BY __pos LIMIT 4 OFFSET 0`
      );

      // Should be sorted by Name descending: Diana, Charlie, Bob, Alice
      expect(result.rows[0][1]).toBe('Diana');
      expect(result.rows[1][1]).toBe('Charlie');
      expect(result.rows[2][1]).toBe('Bob');
      expect(result.rows[3][1]).toBe('Alice');
    });

    it('should return unsorted when no ORDER BY', async () => {
      const columns = '"Name", "Age", "City"';

      await engine.query(
        `CREATE TEMP TABLE __view_nosort AS ` +
        `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
        `(SELECT rowid as __rid, ${columns} FROM "csv" ) sub`
      );

      const result = await engine.query(
        `SELECT __rid, ${columns} FROM __view_nosort ORDER BY __pos LIMIT 4 OFFSET 0`
      );

      // Should be in original CSV order: Alice, Bob, Charlie, Diana
      expect(result.rows[0][1]).toBe('Alice');
      expect(result.rows[1][1]).toBe('Bob');
      expect(result.rows[2][1]).toBe('Charlie');
      expect(result.rows[3][1]).toBe('Diana');
    });
  });

  // ─── Filter Tests ────────────────────────────────────────────────────────

  describe('filter via materialized view', () => {
    it('should filter rows with WHERE clause', async () => {
      const columns = '"Name", "Age", "City"';
      const whereStr = `WHERE "City" IN ('Rome', 'Milan')`;

      await engine.query(
        `CREATE TEMP TABLE __view_filter AS ` +
        `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
        `(SELECT rowid as __rid, ${columns} FROM "csv" ${whereStr} ) sub`
      );

      const result = await engine.query(
        `SELECT __rid, ${columns} FROM __view_filter ORDER BY __pos`
      );

      expect(result.rows.length).toBe(2);
      expect(result.rows[0][1]).toBe('Alice');
      expect(result.rows[1][1]).toBe('Bob');
    });

    it('should filter and sort together', async () => {
      const columns = '"Name", "Age", "City"';
      const whereStr = `WHERE "Age" IN ('30', '35', '28')`;
      const orderClause = 'ORDER BY "Age" ASC NULLS LAST';

      await engine.query(
        `CREATE TEMP TABLE __view_fs AS ` +
        `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
        `(SELECT rowid as __rid, ${columns} FROM "csv" ${whereStr} ${orderClause}) sub`
      );

      const result = await engine.query(
        `SELECT __rid, ${columns} FROM __view_fs ORDER BY __pos`
      );

      expect(result.rows.length).toBe(3);
      expect(result.rows[0][1]).toBe('Diana');  // 28
      expect(result.rows[1][1]).toBe('Alice');  // 30
      expect(result.rows[2][1]).toBe('Charlie'); // 35
    });
  });

  // ─── Pagination Tests ────────────────────────────────────────────────────

  describe('pagination via OFFSET/LIMIT', () => {
    it('should paginate correctly', async () => {
      const columns = '"Name", "Age", "City"';

      await engine.query(
        `CREATE TEMP TABLE __view_page AS ` +
        `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
        `(SELECT rowid as __rid, ${columns} FROM "csv" ) sub`
      );

      const page1 = await engine.query(
        `SELECT __rid, ${columns} FROM __view_page ORDER BY __pos LIMIT 2 OFFSET 0`
      );
      expect(page1.rows.length).toBe(2);
      expect(page1.rows[0][1]).toBe('Alice');
      expect(page1.rows[1][1]).toBe('Bob');

      const page2 = await engine.query(
        `SELECT __rid, ${columns} FROM __view_page ORDER BY __pos LIMIT 2 OFFSET 2`
      );
      expect(page2.rows.length).toBe(2);
      expect(page2.rows[0][1]).toBe('Charlie');
      expect(page2.rows[1][1]).toBe('Diana');
    });
  });

  // ─── Mutation Tests ──────────────────────────────────────────────────────

  describe('mutations', () => {
    it('should delete a row from view', async () => {
      const columns = '"Name", "Age", "City"';

      await engine.query(
        `CREATE TEMP TABLE __view_del AS ` +
        `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
        `(SELECT rowid as __rid, ${columns} FROM "csv" ) sub`
      );

      // Delete Bob (rowid 1)
      await engine.query(`DELETE FROM "csv" WHERE rowid = 1`);
      await engine.query(`DELETE FROM __view_del WHERE __rid = 1`);

      const result = await engine.query(
        `SELECT __rid, ${columns} FROM __view_del ORDER BY __pos`
      );

      expect(result.rows.length).toBe(3);
      expect(result.rows[0][1]).toBe('Alice');
      expect(result.rows[1][1]).toBe('Charlie');
      expect(result.rows[2][1]).toBe('Diana');
    });

    it('should append a row to view', async () => {
      const columns = '"Name", "Age", "City"';

      await engine.query(
        `CREATE TEMP TABLE __view_add AS ` +
        `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
        `(SELECT rowid as __rid, ${columns} FROM "csv" ) sub`
      );

      // Insert a new row
      await engine.query(`INSERT INTO "csv" VALUES ('Eve', '22', 'Florence')`);
      const newRowResult = await engine.query(`SELECT MAX(rowid) FROM "csv"`);
      const newRowid = Number(newRowResult.rows[0][0]);

      // Append to view
      const maxPosResult = await engine.query(`SELECT COALESCE(MAX(__pos), -1) FROM __view_add`);
      const nextPos = Number(maxPosResult.rows[0][0]) + 1;
      await engine.query(
        `INSERT INTO __view_add SELECT ${nextPos} as __pos, ${newRowid} as __rid, ${columns} FROM "csv" WHERE rowid = ${newRowid}`
      );

      const result = await engine.query(
        `SELECT __rid, ${columns} FROM __view_add ORDER BY __pos`
      );

      expect(result.rows.length).toBe(5);
      expect(result.rows[4][1]).toBe('Eve');
    });

    it('should update a cell in view', async () => {
      const columns = '"Name", "Age", "City"';

      await engine.query(
        `CREATE TEMP TABLE __view_upd AS ` +
        `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
        `(SELECT rowid as __rid, ${columns} FROM "csv" ) sub`
      );

      // Update Alice's city
      await engine.query(`UPDATE "csv" SET "City" = 'Florence' WHERE rowid = 0`);
      await engine.query(`UPDATE __view_upd SET "City" = 'Florence' WHERE __rid = 0`);

      const result = await engine.query(
        `SELECT "City" FROM __view_upd WHERE __rid = 0`
      );

      expect(result.rows[0][0]).toBe('Florence');
    });
  });
});
