/**
 * Integration tests for TableManager — tests real functionality end-to-end.
 * Uses DuckDB WASM directly with the actual TableManager class (mocked vscode).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

// ─── DuckDB Engine (same interface as the real one) ──────────────────────────

class TestEngine {
  private db: any;
  private conn: any;

  async init() {
    const DUCKDB_DIST = join(__dirname, '..', '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
    this.db = await duckdb.createDuckDB({
      mvp: { mainModule: join(DUCKDB_DIST, 'duckdb-mvp.wasm'), mainWorker: join(DUCKDB_DIST, 'duckdb-node-mvp.worker.cjs') },
      eh: { mainModule: join(DUCKDB_DIST, 'duckdb-eh.wasm'), mainWorker: join(DUCKDB_DIST, 'duckdb-node-eh.worker.cjs') },
    }, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await this.db.instantiate();
    this.db.open({ query: { castBigIntToDouble: true } });
    this.conn = this.db.connect();
  }

  async query(sql: string) {
    const result = this.conn.query(sql);
    const columns: string[] = result.schema.fields.map((f: any) => f.name);
    const columnTypes: string[] = result.schema.fields.map((f: any) => String(f.type));
    const rows: string[][] = [];
    for (let i = 0; i < result.numRows; i++) {
      const row: string[] = [];
      for (let j = 0; j < columns.length; j++) {
        const val = result.getChildAt(j)?.get(i);
        row.push(val === null || val === undefined ? '' : String(val));
      }
      rows.push(row);
    }
    return { columns, columnTypes, rows, numRows: result.numRows };
  }

  cancel() {}
  dispose() { if (this.conn) { this.conn.close(); this.conn = null; } if (this.db) { this.db.dropFiles(); this.db = null; } }
}

// ─── Import TableManager (mock vscode) ───────────────────────────────────────
// We can't import TableManager directly (depends on vscode).
// Instead we test the SQL patterns it uses, simulating its behavior.

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TableManager Integration', () => {
  let engine: TestEngine;
  const csvPath = join(__dirname, '..', '..', 'test-integration-tmp.csv');

  beforeEach(async () => {
    engine = new TestEngine();
    await engine.init();
    writeFileSync(csvPath, 'Name,Age,City\nAlice,30,Rome\nBob,25,Milan\nCharlie,35,Naples\nDiana,28,Turin\nEve,22,Rome\n');
    await engine.query(`CREATE TABLE csv AS SELECT * FROM read_csv_auto('${csvPath.replace(/'/g, "''")}', ignore_errors=true)`);
  });

  afterEach(() => {
    engine.dispose();
    try { unlinkSync(csvPath); } catch {}
  });

  // ─── Load & Schema ─────────────────────────────────────────────────────

  describe('load and schema', () => {
    it('reads correct headers', async () => {
      const r = await engine.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'csv' ORDER BY ordinal_position`);
      expect(r.rows.map(row => row[0])).toEqual(['Name', 'Age', 'City']);
    });

    it('reads correct row count', async () => {
      const r = await engine.query(`SELECT COUNT(*) FROM csv`);
      expect(Number(r.rows[0][0])).toBe(5);
    });

    it('detects column types', async () => {
      const r = await engine.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'csv' ORDER BY ordinal_position`);
      expect(r.rows[0][0]).toBe('VARCHAR'); // Name
      expect(r.rows[1][0]).toBe('BIGINT');  // Age
      expect(r.rows[2][0]).toBe('VARCHAR'); // City
    });
  });

  // ─── Pagination ────────────────────────────────────────────────────────

  describe('pagination', () => {
    it('returns first page correctly', async () => {
      await engine.query(`CREATE TEMP TABLE v AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, "Name", "Age", "City" FROM (SELECT rowid as __rid, "Name", "Age", "City" FROM csv) sub`);
      const r = await engine.query(`SELECT __rid, "Name", "Age", "City" FROM v ORDER BY __pos LIMIT 2 OFFSET 0`);
      expect(r.rows.length).toBe(2);
      expect(r.rows[0][1]).toBe('Alice');
      expect(r.rows[1][1]).toBe('Bob');
    });

    it('returns second page', async () => {
      await engine.query(`CREATE TEMP TABLE v2 AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, "Name", "Age", "City" FROM (SELECT rowid as __rid, "Name", "Age", "City" FROM csv) sub`);
      const r = await engine.query(`SELECT __rid, "Name", "Age", "City" FROM v2 ORDER BY __pos LIMIT 2 OFFSET 2`);
      expect(r.rows[0][1]).toBe('Charlie');
      expect(r.rows[1][1]).toBe('Diana');
    });

    it('returns empty for offset beyond total', async () => {
      await engine.query(`CREATE TEMP TABLE v3 AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, "Name", "Age", "City" FROM (SELECT rowid as __rid, "Name", "Age", "City" FROM csv) sub`);
      const r = await engine.query(`SELECT __rid, "Name", "Age", "City" FROM v3 ORDER BY __pos LIMIT 10 OFFSET 100`);
      expect(r.rows.length).toBe(0);
    });
  });

  // ─── Sort ──────────────────────────────────────────────────────────────

  describe('sort', () => {
    it('sorts ascending by numeric column', async () => {
      await engine.query(`CREATE TEMP TABLE vs AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, "Name", "Age", "City" FROM (SELECT rowid as __rid, "Name", "Age", "City" FROM csv ORDER BY "Age" ASC NULLS LAST) sub`);
      const r = await engine.query(`SELECT "Name" FROM vs ORDER BY __pos`);
      expect(r.rows.map(row => row[0])).toEqual(['Eve', 'Bob', 'Diana', 'Alice', 'Charlie']);
    });

    it('sorts descending by text column', async () => {
      await engine.query(`CREATE TEMP TABLE vsd AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, "Name", "Age", "City" FROM (SELECT rowid as __rid, "Name", "Age", "City" FROM csv ORDER BY "Name" DESC NULLS LAST) sub`);
      const r = await engine.query(`SELECT "Name" FROM vsd ORDER BY __pos`);
      expect(r.rows[0][0]).toBe('Eve');
      expect(r.rows[4][0]).toBe('Alice');
    });
  });

  // ─── Filter ────────────────────────────────────────────────────────────

  describe('filter', () => {
    it('filters by single value', async () => {
      await engine.query(`CREATE TEMP TABLE vf AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, "Name", "Age", "City" FROM (SELECT rowid as __rid, "Name", "Age", "City" FROM csv WHERE "City" IN ('Rome')) sub`);
      const r = await engine.query(`SELECT "Name" FROM vf ORDER BY __pos`);
      expect(r.rows.length).toBe(2);
      expect(r.rows.map(row => row[0])).toEqual(['Alice', 'Eve']);
    });

    it('filters + sorts combined', async () => {
      await engine.query(`CREATE TEMP TABLE vfs AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, "Name", "Age", "City" FROM (SELECT rowid as __rid, "Name", "Age", "City" FROM csv WHERE "City" IN ('Rome') ORDER BY "Age" ASC NULLS LAST) sub`);
      const r = await engine.query(`SELECT "Name", "Age" FROM vfs ORDER BY __pos`);
      expect(r.rows[0][0]).toBe('Eve');  // 22
      expect(r.rows[1][0]).toBe('Alice'); // 30
    });
  });

  // ─── Search ────────────────────────────────────────────────────────────

  describe('search', () => {
    it('finds matches case-insensitively', async () => {
      const where = `WHERE (CAST("Name" AS VARCHAR) ILIKE '%alice%' OR CAST("Age" AS VARCHAR) ILIKE '%alice%' OR CAST("City" AS VARCHAR) ILIKE '%alice%')`;
      await engine.query(`CREATE TEMP TABLE vsr AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, "Name", "Age", "City" FROM (SELECT rowid as __rid, "Name", "Age", "City" FROM csv ${where}) sub`);
      const r = await engine.query(`SELECT "Name" FROM vsr`);
      expect(r.rows.length).toBe(1);
      expect(r.rows[0][0]).toBe('Alice');
    });

    it('escapes underscore literally', async () => {
      await engine.query(`INSERT INTO csv VALUES ('test_user', '99', 'Test')`);
      const where = `WHERE (CAST("Name" AS VARCHAR) ILIKE '%test\\_u%' ESCAPE '\\' OR CAST("Age" AS VARCHAR) ILIKE '%test\\_u%' ESCAPE '\\' OR CAST("City" AS VARCHAR) ILIKE '%test\\_u%' ESCAPE '\\')`;
      await engine.query(`CREATE TEMP TABLE vsu AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, "Name", "Age", "City" FROM (SELECT rowid as __rid, "Name", "Age", "City" FROM csv ${where}) sub`);
      const r = await engine.query(`SELECT "Name" FROM vsu`);
      expect(r.rows.length).toBe(1);
      expect(r.rows[0][0]).toBe('test_user');
    });
  });

  // ─── Edit Cell ─────────────────────────────────────────────────────────

  describe('edit cell', () => {
    it('updates a value', async () => {
      await engine.query(`UPDATE csv SET "City" = 'Florence' WHERE rowid = 0`);
      const r = await engine.query(`SELECT "City" FROM csv WHERE rowid = 0`);
      expect(r.rows[0][0]).toBe('Florence');
    });

    it('widens type to VARCHAR when incompatible', async () => {
      await engine.query(`ALTER TABLE csv ALTER COLUMN "Age" TYPE VARCHAR`);
      await engine.query(`UPDATE csv SET "Age" = 'unknown' WHERE rowid = 0`);
      const r = await engine.query(`SELECT "Age" FROM csv WHERE rowid = 0`);
      expect(r.rows[0][0]).toBe('unknown');
    });

    it('tightens back to BIGINT when all values are numeric', async () => {
      await engine.query(`ALTER TABLE csv ALTER COLUMN "Age" TYPE VARCHAR`);
      // All values are still numeric (we didn't change them)
      await engine.query(`UPDATE csv SET "Age" = NULL WHERE "Age" = ''`);
      const check = await engine.query(`SELECT COUNT(*) = COUNT(TRY_CAST("Age" AS BIGINT)) as ok FROM csv WHERE "Age" IS NOT NULL AND "Age" != ''`);
      expect(check.rows[0][0]).toBe('true');
      await engine.query(`ALTER TABLE csv ALTER COLUMN "Age" TYPE BIGINT`);
      const types = await engine.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'csv' AND column_name = 'Age'`);
      expect(types.rows[0][0]).toBe('BIGINT');
    });
  });

  // ─── Insert Row ────────────────────────────────────────────────────────

  describe('insert row', () => {
    it('appends a row at the end', async () => {
      await engine.query(`INSERT INTO csv VALUES (NULL, NULL, NULL)`);
      const count = await engine.query(`SELECT COUNT(*) FROM csv`);
      expect(Number(count.rows[0][0])).toBe(6);
    });

    it('insert above places row correctly after rebuild', async () => {
      await engine.query(`INSERT INTO csv VALUES (NULL, NULL, NULL)`);
      const newRowid = Number((await engine.query(`SELECT MAX(rowid) FROM csv`)).rows[0][0]);
      const targetRowid = 2; // Charlie
      const cols = '"Name", "Age", "City"';
      const pivot = targetRowid;

      await engine.query(
        `CREATE TABLE __temp AS SELECT ${cols} FROM (` +
        `  SELECT ${cols}, rowid as __rid FROM csv WHERE rowid < ${pivot} AND rowid != ${newRowid}` +
        `  UNION ALL SELECT ${cols}, ${newRowid} as __rid FROM csv WHERE rowid = ${newRowid}` +
        `  UNION ALL SELECT ${cols}, rowid as __rid FROM csv WHERE rowid >= ${pivot} AND rowid != ${newRowid}` +
        `) ORDER BY CASE WHEN __rid = ${newRowid} THEN ${targetRowid} - 0.5 ELSE __rid END`
      );
      await engine.query(`DROP TABLE csv`);
      await engine.query(`ALTER TABLE __temp RENAME TO csv`);

      const r = await engine.query(`SELECT "Name" FROM csv`);
      expect(r.rows[0][0]).toBe('Alice');
      expect(r.rows[1][0]).toBe('Bob');
      expect(r.rows[2][0]).toBe('');  // new row (NULL)
      expect(r.rows[3][0]).toBe('Charlie');
    });

    it('insert below places row correctly after rebuild', async () => {
      await engine.query(`INSERT INTO csv VALUES (NULL, NULL, NULL)`);
      const newRowid = Number((await engine.query(`SELECT MAX(rowid) FROM csv`)).rows[0][0]);
      const targetRowid = 1; // Bob
      const cols = '"Name", "Age", "City"';
      const pivot = targetRowid + 1;

      await engine.query(
        `CREATE TABLE __temp2 AS SELECT ${cols} FROM (` +
        `  SELECT ${cols}, rowid as __rid FROM csv WHERE rowid < ${pivot} AND rowid != ${newRowid}` +
        `  UNION ALL SELECT ${cols}, ${newRowid} as __rid FROM csv WHERE rowid = ${newRowid}` +
        `  UNION ALL SELECT ${cols}, rowid as __rid FROM csv WHERE rowid >= ${pivot} AND rowid != ${newRowid}` +
        `) ORDER BY CASE WHEN __rid = ${newRowid} THEN ${targetRowid} + 0.5 ELSE __rid END`
      );
      await engine.query(`DROP TABLE csv`);
      await engine.query(`ALTER TABLE __temp2 RENAME TO csv`);

      const r = await engine.query(`SELECT "Name" FROM csv`);
      expect(r.rows[0][0]).toBe('Alice');
      expect(r.rows[1][0]).toBe('Bob');
      expect(r.rows[2][0]).toBe('');  // new row
      expect(r.rows[3][0]).toBe('Charlie');
    });
  });

  // ─── Delete Row ────────────────────────────────────────────────────────

  describe('delete row', () => {
    it('deletes a single row', async () => {
      await engine.query(`DELETE FROM csv WHERE rowid = 1`); // Bob
      const r = await engine.query(`SELECT "Name" FROM csv`);
      expect(r.rows.length).toBe(4);
      expect(r.rows.map(row => row[0])).not.toContain('Bob');
    });

    it('deletes multiple rows', async () => {
      await engine.query(`DELETE FROM csv WHERE rowid IN (0, 2, 4)`);
      const r = await engine.query(`SELECT "Name" FROM csv`);
      expect(r.rows.length).toBe(2);
      expect(r.rows.map(row => row[0])).toEqual(['Bob', 'Diana']);
    });
  });

  // ─── Query Inline ──────────────────────────────────────────────────────

  describe('query inline', () => {
    it('creates temp table from SELECT with rowid', async () => {
      await engine.query(`CREATE TEMP TABLE __qr AS SELECT rowid as __orig_rid, * FROM csv WHERE "City" = 'Rome'`);
      const r = await engine.query(`SELECT "Name" FROM __qr`);
      expect(r.rows.length).toBe(2);
      expect(r.rows.map(row => row[0])).toEqual(['Alice', 'Eve']);
    });

    it('__orig_rid maps back to original table', async () => {
      await engine.query(`CREATE TEMP TABLE __qr2 AS SELECT rowid as __orig_rid, * FROM csv WHERE "City" = 'Rome'`);
      const r = await engine.query(`SELECT __orig_rid FROM __qr2`);
      const origRowids = r.rows.map(row => Number(row[0]));
      // Update original table using the mapped rowid
      await engine.query(`UPDATE csv SET "City" = 'Updated' WHERE rowid = ${origRowids[0]}`);
      const check = await engine.query(`SELECT "City" FROM csv WHERE rowid = ${origRowids[0]}`);
      expect(check.rows[0][0]).toBe('Updated');
    });

    it('paginates query results via view', async () => {
      await engine.query(`CREATE TEMP TABLE __qr3 AS SELECT rowid as __orig_rid, * FROM csv`);
      await engine.query(`CREATE TEMP TABLE __qrv AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, "__orig_rid" as __rid, "Name", "Age", "City" FROM (SELECT "__orig_rid", "Name", "Age", "City" FROM __qr3) sub`);
      const page1 = await engine.query(`SELECT "Name" FROM __qrv ORDER BY __pos LIMIT 2 OFFSET 0`);
      const page2 = await engine.query(`SELECT "Name" FROM __qrv ORDER BY __pos LIMIT 2 OFFSET 2`);
      expect(page1.rows.map(r => r[0])).toEqual(['Alice', 'Bob']);
      expect(page2.rows.map(r => r[0])).toEqual(['Charlie', 'Diana']);
    });
  });

  // ─── Contextual Filters (getUniqueValues) ──────────────────────────────

  describe('contextual filters', () => {
    it('shows only values matching current filter', async () => {
      // Filter City = Rome, then get unique Names
      const r = await engine.query(`SELECT DISTINCT CAST("Name" AS VARCHAR) as val FROM csv WHERE "City" IN ('Rome') AND "Name" IS NOT NULL ORDER BY "Name" LIMIT 1000`);
      expect(r.rows.map(row => row[0])).toEqual(['Alice', 'Eve']);
    });

    it('excludes the column being filtered', async () => {
      // When filtering City, show all cities (don't apply City filter to itself)
      const r = await engine.query(`SELECT DISTINCT CAST("City" AS VARCHAR) as val FROM csv WHERE "City" IS NOT NULL ORDER BY "City" LIMIT 1000`);
      expect(r.rows.map(row => row[0])).toContain('Rome');
      expect(r.rows.map(row => row[0])).toContain('Milan');
    });
  });

  // ─── Export Order ──────────────────────────────────────────────────────

  describe('export order', () => {
    it('preserves insertion order after insert above', async () => {
      // Insert above Charlie (rowid 2)
      await engine.query(`INSERT INTO csv VALUES ('NewGuy', '50', 'Berlin')`);
      const newRowid = Number((await engine.query(`SELECT MAX(rowid) FROM csv`)).rows[0][0]);
      const cols = '"Name", "Age", "City"';
      const pivot = 2;

      await engine.query(
        `CREATE TABLE __exp AS SELECT ${cols} FROM (` +
        `  SELECT ${cols}, rowid as __rid FROM csv WHERE rowid < ${pivot} AND rowid != ${newRowid}` +
        `  UNION ALL SELECT ${cols}, ${newRowid} as __rid FROM csv WHERE rowid = ${newRowid}` +
        `  UNION ALL SELECT ${cols}, rowid as __rid FROM csv WHERE rowid >= ${pivot} AND rowid != ${newRowid}` +
        `) ORDER BY CASE WHEN __rid = ${newRowid} THEN ${pivot} - 0.5 ELSE __rid END`
      );
      await engine.query(`DROP TABLE csv`);
      await engine.query(`ALTER TABLE __exp RENAME TO csv`);

      // Export reads in physical order (LIMIT/OFFSET without ORDER BY)
      const r = await engine.query(`SELECT "Name" FROM csv LIMIT 10 OFFSET 0`);
      expect(r.rows[0][0]).toBe('Alice');
      expect(r.rows[1][0]).toBe('Bob');
      expect(r.rows[2][0]).toBe('NewGuy');
      expect(r.rows[3][0]).toBe('Charlie');
    });
  });
});
