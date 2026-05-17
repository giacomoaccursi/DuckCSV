/**
 * Integration tests for TableManager SQL logic.
 * Uses DuckDB WASM (node blocking) directly to test real SQL queries.
 * Catches regressions in sort, filter, pagination, mutations, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

// ─── Test DuckDB Engine ──────────────────────────────────────────────────────

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

  async query(sql: string) {
    const result = this.conn.query(sql);
    const columns: string[] = result.schema.fields.map((f: any) => f.name);
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
    return { columns, rows, numRows: result.numRows };
  }

  dispose() {
    if (this.conn) { this.conn.close(); this.conn = null; }
    if (this.db) { this.db.dropFiles(); this.db = null; }
  }
}

// ─── Helper: build view like TableManager does ───────────────────────────────

async function buildView(engine: TestDuckDbEngine, viewName: string, tableName: string, columns: string, whereStr = '', orderClause = '') {
  await engine.query(
    `CREATE TEMP TABLE "${viewName}" AS ` +
    `SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${columns} FROM ` +
    `(SELECT rowid as __rid, ${columns} FROM "${tableName}" ${whereStr} ${orderClause}) sub`
  );
}

async function getViewRows(engine: TestDuckDbEngine, viewName: string, columns: string, limit = 100, offset = 0) {
  const result = await engine.query(
    `SELECT __rid, ${columns} FROM "${viewName}" ORDER BY __pos LIMIT ${limit} OFFSET ${offset}`
  );
  return result.rows;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TableManager SQL logic', () => {
  let engine: TestDuckDbEngine;
  const testCsvPath = join(__dirname, '..', '..', 'test-data-tmp.csv');
  const columns = '"Name", "Age", "City"';

  beforeEach(async () => {
    engine = new TestDuckDbEngine();
    await engine.init();
    const csv = 'Name,Age,City\nAlice,30,Rome\nBob,25,Milan\nCharlie,35,Naples\nDiana,28,Turin\n';
    writeFileSync(testCsvPath, csv);
    await engine.query(`CREATE TABLE csv AS SELECT * FROM read_csv_auto('${testCsvPath.replace(/'/g, "''")}', ignore_errors=true)`);
  });

  afterEach(() => {
    engine.dispose();
    try { unlinkSync(testCsvPath); } catch {}
  });

  // ─── Sort ────────────────────────────────────────────────────────────────

  describe('sort', () => {
    it('ascending by numeric column', async () => {
      await buildView(engine, 'v', 'csv', columns, '', 'ORDER BY "Age" ASC NULLS LAST');
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.map(r => r[1])).toEqual(['Bob', 'Diana', 'Alice', 'Charlie']);
    });

    it('descending by text column', async () => {
      await buildView(engine, 'v', 'csv', columns, '', 'ORDER BY "Name" DESC NULLS LAST');
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.map(r => r[1])).toEqual(['Diana', 'Charlie', 'Bob', 'Alice']);
    });

    it('no sort preserves insertion order', async () => {
      await buildView(engine, 'v', 'csv', columns);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.map(r => r[1])).toEqual(['Alice', 'Bob', 'Charlie', 'Diana']);
    });

    it('sort with NULLs last', async () => {
      await engine.query(`INSERT INTO csv VALUES (NULL, NULL, NULL)`);
      await buildView(engine, 'v', 'csv', columns, '', 'ORDER BY "Age" ASC NULLS LAST');
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows[rows.length - 1][1]).toBe(''); // NULL name last
      expect(rows[0][1]).toBe('Bob'); // 25 first
    });

    it('sort after cell update reflects new value', async () => {
      await engine.query(`UPDATE csv SET "Age" = 50 WHERE rowid = 0`); // Alice now 50
      await buildView(engine, 'v', 'csv', columns, '', 'ORDER BY "Age" ASC NULLS LAST');
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.map(r => r[1])).toEqual(['Bob', 'Diana', 'Charlie', 'Alice']);
    });

    it('sort after delete excludes deleted row', async () => {
      await engine.query(`DELETE FROM csv WHERE rowid = 1`); // Delete Bob
      await buildView(engine, 'v', 'csv', columns, '', 'ORDER BY "Age" ASC NULLS LAST');
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(3);
      expect(rows.map(r => r[1])).toEqual(['Diana', 'Alice', 'Charlie']);
    });
  });

  // ─── Filter ──────────────────────────────────────────────────────────────

  describe('filter', () => {
    it('single column IN filter', async () => {
      await buildView(engine, 'v', 'csv', columns, `WHERE "City" IN ('Rome', 'Milan')`);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(2);
      expect(rows.map(r => r[1])).toEqual(['Alice', 'Bob']);
    });

    it('filter + sort combined', async () => {
      await buildView(engine, 'v', 'csv', columns, `WHERE "Age" IN ('30', '35', '28')`, 'ORDER BY "Age" ASC NULLS LAST');
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.map(r => r[1])).toEqual(['Diana', 'Alice', 'Charlie']);
    });

    it('filter with no matches returns empty', async () => {
      await buildView(engine, 'v', 'csv', columns, `WHERE "Name" = 'Nobody'`);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(0);
    });

    it('multiple column filters (AND)', async () => {
      await buildView(engine, 'v', 'csv', columns, `WHERE "City" IN ('Rome', 'Milan') AND "Age" IN ('30')`);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(1);
      expect(rows[0][1]).toBe('Alice');
    });
  });

  // ─── Global Search ───────────────────────────────────────────────────────

  describe('global search (ILIKE)', () => {
    it('matches text in any column', async () => {
      const where = `WHERE (CAST("Name" AS VARCHAR) ILIKE '%rome%' OR CAST("Age" AS VARCHAR) ILIKE '%rome%' OR CAST("City" AS VARCHAR) ILIKE '%rome%')`;
      await buildView(engine, 'v', 'csv', columns, where);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(1);
      expect(rows[0][1]).toBe('Alice');
    });

    it('case insensitive', async () => {
      const where = `WHERE (CAST("Name" AS VARCHAR) ILIKE '%BOB%' OR CAST("Age" AS VARCHAR) ILIKE '%BOB%' OR CAST("City" AS VARCHAR) ILIKE '%BOB%')`;
      await buildView(engine, 'v', 'csv', columns, where);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(1);
      expect(rows[0][1]).toBe('Bob');
    });

    it('matches numeric values as text', async () => {
      const where = `WHERE (CAST("Name" AS VARCHAR) ILIKE '%25%' OR CAST("Age" AS VARCHAR) ILIKE '%25%' OR CAST("City" AS VARCHAR) ILIKE '%25%')`;
      await buildView(engine, 'v', 'csv', columns, where);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(1);
      expect(rows[0][1]).toBe('Bob');
    });

    it('search + sort combined', async () => {
      const where = `WHERE (CAST("Name" AS VARCHAR) ILIKE '%a%' OR CAST("Age" AS VARCHAR) ILIKE '%a%' OR CAST("City" AS VARCHAR) ILIKE '%a%')`;
      await buildView(engine, 'v', 'csv', columns, where, 'ORDER BY "Name" ASC NULLS LAST');
      const rows = await getViewRows(engine, 'v', columns);
      // All rows match '%a%' (Alice, Charlie, Diana have 'a'; Milan/Naples have 'a')
      expect(rows.length).toBeGreaterThan(0);
      // Verify sorted
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i][1] >= rows[i - 1][1]).toBe(true);
      }
    });
  });

  // ─── Pagination ──────────────────────────────────────────────────────────

  describe('pagination', () => {
    it('first page', async () => {
      await buildView(engine, 'v', 'csv', columns);
      const rows = await getViewRows(engine, 'v', columns, 2, 0);
      expect(rows.length).toBe(2);
      expect(rows.map(r => r[1])).toEqual(['Alice', 'Bob']);
    });

    it('second page', async () => {
      await buildView(engine, 'v', 'csv', columns);
      const rows = await getViewRows(engine, 'v', columns, 2, 2);
      expect(rows.length).toBe(2);
      expect(rows.map(r => r[1])).toEqual(['Charlie', 'Diana']);
    });

    it('offset beyond total returns empty', async () => {
      await buildView(engine, 'v', 'csv', columns);
      const rows = await getViewRows(engine, 'v', columns, 10, 100);
      expect(rows.length).toBe(0);
    });

    it('pagination after delete (gaps in __pos)', async () => {
      await buildView(engine, 'v', 'csv', columns);
      await engine.query(`DELETE FROM "v" WHERE __rid = 1`); // Delete Bob
      const rows = await getViewRows(engine, 'v', columns, 2, 0);
      expect(rows.length).toBe(2);
      expect(rows[0][1]).toBe('Alice');
      expect(rows[1][1]).toBe('Charlie');
    });

    it('pagination with sort', async () => {
      await buildView(engine, 'v', 'csv', columns, '', 'ORDER BY "Age" ASC NULLS LAST');
      const page1 = await getViewRows(engine, 'v', columns, 2, 0);
      const page2 = await getViewRows(engine, 'v', columns, 2, 2);
      expect(page1.map(r => r[1])).toEqual(['Bob', 'Diana']);
      expect(page2.map(r => r[1])).toEqual(['Alice', 'Charlie']);
    });
  });

  // ─── Mutations ───────────────────────────────────────────────────────────

  describe('mutations', () => {
    it('delete single row from view', async () => {
      await buildView(engine, 'v', 'csv', columns);
      await engine.query(`DELETE FROM csv WHERE rowid = 1`);
      await engine.query(`DELETE FROM "v" WHERE __rid = 1`);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(3);
      expect(rows.map(r => r[1])).toEqual(['Alice', 'Charlie', 'Diana']);
    });

    it('delete multiple rows from view', async () => {
      await buildView(engine, 'v', 'csv', columns);
      await engine.query(`DELETE FROM csv WHERE rowid IN (0, 2)`);
      await engine.query(`DELETE FROM "v" WHERE __rid IN (0, 2)`);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(2);
      expect(rows.map(r => r[1])).toEqual(['Bob', 'Diana']);
    });

    it('append row to view', async () => {
      await buildView(engine, 'v', 'csv', columns);
      await engine.query(`INSERT INTO csv VALUES ('Eve', '22', 'Florence')`);
      const newRowid = (await engine.query(`SELECT MAX(rowid) FROM csv`)).rows[0][0];
      const maxPos = Number((await engine.query(`SELECT COALESCE(MAX(__pos), -1) FROM "v"`)).rows[0][0]);
      await engine.query(`INSERT INTO "v" SELECT ${maxPos + 1} as __pos, ${newRowid} as __rid, ${columns} FROM csv WHERE rowid = ${newRowid}`);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(5);
      expect(rows[4][1]).toBe('Eve');
    });

    it('update cell in view', async () => {
      await buildView(engine, 'v', 'csv', columns);
      await engine.query(`UPDATE csv SET "City" = 'Florence' WHERE rowid = 0`);
      await engine.query(`UPDATE "v" SET "City" = 'Florence' WHERE __rid = 0`);
      const result = await engine.query(`SELECT "City" FROM "v" WHERE __rid = 0`);
      expect(result.rows[0][0]).toBe('Florence');
    });

    it('addRowAt above (table rebuild)', async () => {
      await engine.query(`INSERT INTO csv VALUES (NULL, NULL, NULL)`);
      const newRowid = Number((await engine.query(`SELECT MAX(rowid) FROM csv`)).rows[0][0]);
      const targetRowid = 2; // Charlie
      const pivot = targetRowid;

      await engine.query(
        `CREATE TABLE __temp AS SELECT ${columns} FROM (` +
        `  SELECT ${columns}, rowid as __rid FROM csv WHERE rowid < ${pivot} AND rowid != ${newRowid}` +
        `  UNION ALL SELECT ${columns}, ${newRowid} as __rid FROM csv WHERE rowid = ${newRowid}` +
        `  UNION ALL SELECT ${columns}, rowid as __rid FROM csv WHERE rowid >= ${pivot} AND rowid != ${newRowid}` +
        `) ORDER BY CASE WHEN __rid = ${newRowid} THEN ${targetRowid} - 0.5 ELSE __rid END`
      );
      await engine.query(`DROP TABLE csv`);
      await engine.query(`ALTER TABLE __temp RENAME TO csv`);

      const result = await engine.query(`SELECT "Name" FROM csv`);
      expect(result.rows.map(r => r[0])).toEqual(['Alice', 'Bob', '', 'Charlie', 'Diana']);
    });

    it('addRowAt below (table rebuild)', async () => {
      await engine.query(`INSERT INTO csv VALUES (NULL, NULL, NULL)`);
      const newRowid = Number((await engine.query(`SELECT MAX(rowid) FROM csv`)).rows[0][0]);
      const targetRowid = 1; // Bob
      const pivot = targetRowid + 1;

      await engine.query(
        `CREATE TABLE __temp2 AS SELECT ${columns} FROM (` +
        `  SELECT ${columns}, rowid as __rid FROM csv WHERE rowid < ${pivot} AND rowid != ${newRowid}` +
        `  UNION ALL SELECT ${columns}, ${newRowid} as __rid FROM csv WHERE rowid = ${newRowid}` +
        `  UNION ALL SELECT ${columns}, rowid as __rid FROM csv WHERE rowid >= ${pivot} AND rowid != ${newRowid}` +
        `) ORDER BY CASE WHEN __rid = ${newRowid} THEN ${targetRowid} + 0.5 ELSE __rid END`
      );
      await engine.query(`DROP TABLE csv`);
      await engine.query(`ALTER TABLE __temp2 RENAME TO csv`);

      const result = await engine.query(`SELECT "Name" FROM csv`);
      expect(result.rows.map(r => r[0])).toEqual(['Alice', 'Bob', '', 'Charlie', 'Diana']);
    });
  });

  // ─── Type Coercion ───────────────────────────────────────────────────────

  describe('type coercion', () => {
    it('ALTER to VARCHAR allows text in numeric column', async () => {
      await engine.query(`ALTER TABLE csv ALTER COLUMN "Age" TYPE VARCHAR`);
      await engine.query(`UPDATE csv SET "Age" = 'unknown' WHERE rowid = 0`);
      const result = await engine.query(`SELECT "Age" FROM csv WHERE rowid = 0`);
      expect(result.rows[0][0]).toBe('unknown');
    });

    it('TRY_CAST detects incompatible values', async () => {
      const check = await engine.query(`SELECT TRY_CAST('hello' AS BIGINT) IS NOT NULL as ok`);
      expect(check.rows[0][0]).toBe('false');
    });

    it('TRY_CAST passes for compatible values', async () => {
      const check = await engine.query(`SELECT TRY_CAST('42' AS BIGINT) IS NOT NULL as ok`);
      expect(check.rows[0][0]).toBe('true');
    });

    it('can tighten VARCHAR back to BIGINT', async () => {
      await engine.query(`ALTER TABLE csv ALTER COLUMN "Age" TYPE VARCHAR`);
      const check = await engine.query(
        `SELECT COUNT(*) = COUNT(TRY_CAST("Age" AS BIGINT)) as ok FROM csv WHERE "Age" IS NOT NULL AND "Age" != ''`
      );
      expect(check.rows[0][0]).toBe('true');
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('column names with spaces', async () => {
      await engine.query(`CREATE TABLE special ("First Name" VARCHAR, "Last Name" VARCHAR)`);
      await engine.query(`INSERT INTO special VALUES ('John', 'Doe')`);
      await buildView(engine, 'v', 'special', '"First Name", "Last Name"', '', 'ORDER BY "First Name" ASC');
      const rows = await getViewRows(engine, 'v', '"First Name", "Last Name"');
      expect(rows[0][1]).toBe('John');
    });

    it('single quotes in values', async () => {
      const escaped = "O''Brien";
      await engine.query(`INSERT INTO csv VALUES ('${escaped}', '40', 'Dublin')`);
      const result = await engine.query(`SELECT "Name" FROM csv WHERE "Name" LIKE '%Brien%'`);
      expect(result.rows[0][0]).toBe("O'Brien");
    });

    it('percent in search term is escaped', async () => {
      await engine.query(`INSERT INTO csv VALUES ('100%', '99', 'Test')`);
      // DuckDB ILIKE uses backslash escape for %
      const where = `WHERE CAST("Name" AS VARCHAR) ILIKE '%100\\%%' ESCAPE '\\'`;
      await buildView(engine, 'v', 'csv', columns, where);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(1);
      expect(rows[0][1]).toBe('100%');
    });

    it('empty table produces empty view', async () => {
      await engine.query(`DELETE FROM csv`);
      await buildView(engine, 'v', 'csv', columns);
      const rows = await getViewRows(engine, 'v', columns);
      expect(rows.length).toBe(0);
    });

    it('view count matches after multiple operations', async () => {
      await buildView(engine, 'v', 'csv', columns);

      // Add a row
      await engine.query(`INSERT INTO csv VALUES ('Eve', '22', 'Florence')`);
      const newRowid = (await engine.query(`SELECT MAX(rowid) FROM csv`)).rows[0][0];
      const maxPos = Number((await engine.query(`SELECT COALESCE(MAX(__pos), -1) FROM "v"`)).rows[0][0]);
      await engine.query(`INSERT INTO "v" SELECT ${maxPos + 1} as __pos, ${newRowid} as __rid, ${columns} FROM csv WHERE rowid = ${newRowid}`);

      // Delete a row
      await engine.query(`DELETE FROM csv WHERE rowid = 2`);
      await engine.query(`DELETE FROM "v" WHERE __rid = 2`);

      const count = await engine.query(`SELECT COUNT(*) FROM "v"`);
      expect(Number(count.rows[0][0])).toBe(4); // 4 original + 1 added - 1 deleted = 4
    });
  });
});
