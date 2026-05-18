/**
 * Stress tests — simulates complex user flows end-to-end.
 * Uses DuckDB blocking directly with TableManager-like SQL patterns.
 * Tests sequences of operations that have caused bugs in the past.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

class Engine {
  private db: any;
  private conn: any;

  async init() {
    const DIST = join(__dirname, '..', '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
    this.db = await duckdb.createDuckDB({
      mvp: { mainModule: join(DIST, 'duckdb-mvp.wasm'), mainWorker: join(DIST, 'duckdb-node-mvp.worker.cjs') },
      eh: { mainModule: join(DIST, 'duckdb-eh.wasm'), mainWorker: join(DIST, 'duckdb-node-eh.worker.cjs') },
    }, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await this.db.instantiate();
    this.db.open({ query: { castBigIntToDouble: true } });
    this.conn = this.db.connect();
  }

  query(sql: string) {
    const result = this.conn.query(sql);
    const columns: string[] = result.schema.fields.map((f: any) => f.name);
    const rows: string[][] = [];
    for (let i = 0; i < result.numRows; i++) {
      const row: string[] = [];
      for (let j = 0; j < columns.length; j++) {
        const val = result.getChildAt(j)?.get(i);
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

// ─── Helpers (simulate TableManager patterns) ────────────────────────────────

function buildView(engine: Engine, viewName: string, table: string, cols: string, where = '', order = '') {
  try { engine.query(`DROP TABLE IF EXISTS "${viewName}"`); } catch {}
  engine.query(
    `CREATE TEMP TABLE "${viewName}" AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, __rid, ${cols} FROM ` +
    `(SELECT rowid as __rid, ${cols} FROM "${table}" ${where} ${order}) sub`
  );
}

function getPage(engine: Engine, viewName: string, cols: string, limit: number, offset: number) {
  return engine.query(`SELECT __rid, ${cols} FROM "${viewName}" ORDER BY __pos LIMIT ${limit} OFFSET ${offset}`);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Stress Tests — Complex User Flows', () => {
  let engine: Engine;
  const csvPath = join(__dirname, '..', '..', 'test-stress-tmp.csv');
  const cols = '"Name", "Age", "City"';

  beforeEach(async () => {
    engine = new Engine();
    await engine.init();
    writeFileSync(csvPath, 'Name,Age,City\nAlice,30,Rome\nBob,25,Milan\nCharlie,35,Naples\nDiana,28,Turin\nEve,22,Rome\nFrank,40,Milan\nGrace,33,Naples\nHenry,27,Rome\n');
    engine.query(`CREATE TABLE csv AS SELECT * FROM read_csv_auto('${csvPath.replace(/'/g, "''")}', ignore_errors=true)`);
  });

  afterEach(() => {
    engine.dispose();
    try { unlinkSync(csvPath); } catch {}
  });

  // ─── Flow 1: Load → Sort → Filter → Sort again ────────────────────────

  it('load → sort → filter → sort again', () => {
    // Initial view (no sort, no filter)
    buildView(engine, 'v1', 'csv', cols);
    let page = getPage(engine, 'v1', cols, 3, 0);
    expect(page.rows[0][1]).toBe('Alice');

    // Sort by Age ASC
    buildView(engine, 'v1', 'csv', cols, '', 'ORDER BY "Age" ASC NULLS LAST');
    page = getPage(engine, 'v1', cols, 3, 0);
    expect(page.rows[0][1]).toBe('Eve'); // 22

    // Add filter: City = Rome
    buildView(engine, 'v1', 'csv', cols, `WHERE "City" IN ('Rome')`, 'ORDER BY "Age" ASC NULLS LAST');
    page = getPage(engine, 'v1', cols, 10, 0);
    expect(page.rows.length).toBe(3); // Alice, Eve, Henry
    expect(page.rows[0][1]).toBe('Eve'); // 22, sorted

    // Change sort to DESC
    buildView(engine, 'v1', 'csv', cols, `WHERE "City" IN ('Rome')`, 'ORDER BY "Age" DESC NULLS LAST');
    page = getPage(engine, 'v1', cols, 10, 0);
    expect(page.rows[0][1]).toBe('Alice'); // 30, highest in Rome
  });

  // ─── Flow 2: Edit → Sort → Edit again ─────────────────────────────────

  it('edit → sort → edit again → verify data', () => {
    // Edit Alice's age to 99
    engine.query(`UPDATE csv SET "Age" = 99 WHERE rowid = 0`);

    // Sort by Age ASC — Alice should be last
    buildView(engine, 'v2', 'csv', cols, '', 'ORDER BY "Age" ASC NULLS LAST');
    let page = getPage(engine, 'v2', cols, 10, 0);
    expect(page.rows[page.rows.length - 1][1]).toBe('Alice');

    // Edit Bob's city
    engine.query(`UPDATE csv SET "City" = 'Florence' WHERE rowid = 1`);

    // Filter by Florence — only Bob
    buildView(engine, 'v2', 'csv', cols, `WHERE "City" IN ('Florence')`);
    page = getPage(engine, 'v2', cols, 10, 0);
    expect(page.rows.length).toBe(1);
    expect(page.rows[0][1]).toBe('Bob');
  });

  // ─── Flow 3: Delete → Paginate → Delete more ──────────────────────────

  it('delete → paginate → delete more → verify count', () => {
    buildView(engine, 'v3', 'csv', cols);

    // Delete first 2 rows
    engine.query(`DELETE FROM csv WHERE rowid IN (0, 1)`);
    engine.query(`DELETE FROM "v3" WHERE __rid IN (0, 1)`);

    // Paginate — should have 6 rows left
    let page = getPage(engine, 'v3', cols, 10, 0);
    expect(page.rows.length).toBe(6);
    expect(page.rows[0][1]).toBe('Charlie');

    // Delete 2 more
    engine.query(`DELETE FROM csv WHERE rowid IN (2, 3)`);
    engine.query(`DELETE FROM "v3" WHERE __rid IN (2, 3)`);

    page = getPage(engine, 'v3', cols, 10, 0);
    expect(page.rows.length).toBe(4);
    expect(page.rows[0][1]).toBe('Eve');
  });

  // ─── Flow 4: Insert above → Sort → Verify position ────────────────────

  it('insert above → rebuild → sort → verify', () => {
    // Insert above Charlie (rowid 2)
    engine.query(`INSERT INTO csv VALUES ('NewGuy', '31', 'Berlin')`);
    const newRowid = Number(engine.query(`SELECT MAX(rowid) FROM csv`).rows[0][0]);

    // Rebuild table for correct physical order
    const pivot = 2;
    engine.query(
      `CREATE TABLE __tmp AS SELECT ${cols} FROM (` +
      `  SELECT ${cols}, rowid as __rid FROM csv WHERE rowid < ${pivot} AND rowid != ${newRowid}` +
      `  UNION ALL SELECT ${cols}, ${newRowid} as __rid FROM csv WHERE rowid = ${newRowid}` +
      `  UNION ALL SELECT ${cols}, rowid as __rid FROM csv WHERE rowid >= ${pivot} AND rowid != ${newRowid}` +
      `) ORDER BY CASE WHEN __rid = ${newRowid} THEN ${pivot} - 0.5 ELSE __rid END`
    );
    engine.query(`DROP TABLE csv`);
    engine.query(`ALTER TABLE __tmp RENAME TO csv`);

    // Verify physical order
    let r = engine.query(`SELECT "Name" FROM csv`);
    expect(r.rows[2][0]).toBe('NewGuy');

    // Now sort by Age — NewGuy (31) should be between Alice (30) and Charlie (35)
    buildView(engine, 'v4', 'csv', cols, '', 'ORDER BY "Age" ASC NULLS LAST');
    const page = getPage(engine, 'v4', cols, 10, 0);
    const names = page.rows.map(row => row[1]);
    const newGuyIdx = names.indexOf('NewGuy');
    const aliceIdx = names.indexOf('Alice');
    const charlieIdx = names.indexOf('Charlie');
    expect(newGuyIdx).toBeGreaterThan(aliceIdx);
    expect(newGuyIdx).toBeLessThan(charlieIdx);
  });

  // ─── Flow 5: Query inline → Edit via __orig_rid → Clear → Verify ──────

  it('query inline → edit via orig_rid → clear → verify original updated', () => {
    // Simulate inline query: SELECT * FROM csv WHERE City = 'Rome'
    engine.query(`CREATE TEMP TABLE __qr AS SELECT rowid as __orig_rid, * FROM csv WHERE "City" = 'Rome'`);

    // Build view on query result using __orig_rid
    engine.query(
      `CREATE TEMP TABLE __qrv AS SELECT (ROW_NUMBER() OVER() - 1) as __pos, "__orig_rid" as __rid, "Name", "Age", "City" FROM ` +
      `(SELECT "__orig_rid", "Name", "Age", "City" FROM __qr) sub`
    );

    // Get first row's __orig_rid
    const page = engine.query(`SELECT __rid, "Name" FROM __qrv ORDER BY __pos LIMIT 1`);
    const origRid = Number(page.rows[0][0]);
    expect(page.rows[0][1]).toBe('Alice');

    // Edit via __orig_rid on the ORIGINAL table
    engine.query(`UPDATE csv SET "Name" = 'Alice_Modified' WHERE rowid = ${origRid}`);

    // Clear query (drop temp tables)
    engine.query(`DROP TABLE IF EXISTS __qr`);
    engine.query(`DROP TABLE IF EXISTS __qrv`);

    // Verify original table was updated
    const check = engine.query(`SELECT "Name" FROM csv WHERE rowid = ${origRid}`);
    expect(check.rows[0][0]).toBe('Alice_Modified');
  });

  // ─── Flow 6: Multiple sorts in rapid succession ────────────────────────

  it('multiple sorts rapidly (view rebuild each time)', () => {
    // Sort ASC
    buildView(engine, 'v6', 'csv', cols, '', 'ORDER BY "Age" ASC NULLS LAST');
    let page = getPage(engine, 'v6', cols, 1, 0);
    expect(page.rows[0][1]).toBe('Eve'); // 22

    // Sort DESC immediately
    buildView(engine, 'v6', 'csv', cols, '', 'ORDER BY "Age" DESC NULLS LAST');
    page = getPage(engine, 'v6', cols, 1, 0);
    expect(page.rows[0][1]).toBe('Frank'); // 40

    // Sort by Name ASC
    buildView(engine, 'v6', 'csv', cols, '', 'ORDER BY "Name" ASC NULLS LAST');
    page = getPage(engine, 'v6', cols, 1, 0);
    expect(page.rows[0][1]).toBe('Alice');

    // Back to no sort
    buildView(engine, 'v6', 'csv', cols);
    page = getPage(engine, 'v6', cols, 1, 0);
    expect(page.rows[0][1]).toBe('Alice'); // original order
  });

  // ─── Flow 7: Edit type change → Sort → Edit back ──────────────────────

  it('edit changes type → sort still works → edit back restores type', () => {
    // Age is BIGINT. Put a string in it.
    engine.query(`ALTER TABLE csv ALTER COLUMN "Age" TYPE VARCHAR`);
    engine.query(`UPDATE csv SET "Age" = 'unknown' WHERE rowid = 0`);

    // Sort by Age — should still work (VARCHAR sort)
    buildView(engine, 'v7', 'csv', cols, '', 'ORDER BY "Age" ASC NULLS LAST');
    const page = getPage(engine, 'v7', cols, 10, 0);
    // VARCHAR sort: "22" < "25" < "27" < ... < "unknown"
    expect(page.rows[page.rows.length - 1][1]).toBe('Alice'); // "unknown" sorts last alphabetically

    // Fix Alice's age back to numeric
    engine.query(`UPDATE csv SET "Age" = '30' WHERE rowid = 0`);

    // Check if we can tighten back to BIGINT
    const check = engine.query(`SELECT COUNT(*) = COUNT(TRY_CAST("Age" AS BIGINT)) as ok FROM csv WHERE "Age" IS NOT NULL AND "Age" != ''`);
    expect(check.rows[0][0]).toBe('true');

    // Tighten
    engine.query(`UPDATE csv SET "Age" = NULL WHERE "Age" = ''`);
    engine.query(`ALTER TABLE csv ALTER COLUMN "Age" TYPE BIGINT`);

    // Sort by Age as BIGINT — numeric order
    buildView(engine, 'v7', 'csv', cols, '', 'ORDER BY "Age" ASC NULLS LAST');
    const page2 = getPage(engine, 'v7', cols, 1, 0);
    expect(page2.rows[0][1]).toBe('Eve'); // 22
  });

  // ─── Flow 8: Concurrent pagination (multiple pages) ────────────────────

  it('fetch multiple pages from same view', () => {
    buildView(engine, 'v8', 'csv', cols);

    const p1 = getPage(engine, 'v8', cols, 3, 0);
    const p2 = getPage(engine, 'v8', cols, 3, 3);
    const p3 = getPage(engine, 'v8', cols, 3, 6);

    expect(p1.rows.length).toBe(3);
    expect(p2.rows.length).toBe(3);
    expect(p3.rows.length).toBe(2); // only 8 rows total

    // No duplicates across pages
    const allNames = [...p1.rows, ...p2.rows, ...p3.rows].map(r => r[1]);
    expect(new Set(allNames).size).toBe(8);
  });

  // ─── Flow 9: Filter → getUniqueValues (contextual) ────────────────────

  it('getUniqueValues respects active filters', () => {
    // Filter City = Rome, then get unique Ages for Rome only
    const r = engine.query(
      `SELECT DISTINCT CAST("Age" AS VARCHAR) as val FROM csv WHERE "City" IN ('Rome') AND "Age" IS NOT NULL ORDER BY "Age" LIMIT 1000`
    );
    const ages = r.rows.map(row => row[0]);
    expect(ages).toContain('30'); // Alice
    expect(ages).toContain('22'); // Eve
    expect(ages).toContain('27'); // Henry
    expect(ages).not.toContain('25'); // Bob (Milan)
  });

  // ─── Flow 10: Delete all → Empty state ─────────────────────────────────

  it('delete all rows → empty view → no crash', () => {
    engine.query(`DELETE FROM csv`);
    buildView(engine, 'v10', 'csv', cols);
    const page = getPage(engine, 'v10', cols, 10, 0);
    expect(page.rows.length).toBe(0);

    const count = engine.query(`SELECT COUNT(*) FROM "v10"`);
    expect(Number(count.rows[0][0])).toBe(0);
  });

  // ─── Flow 11: Insert → Delete same row → Verify ───────────────────────

  it('insert row → immediately delete it → table unchanged', () => {
    const countBefore = Number(engine.query(`SELECT COUNT(*) FROM csv`).rows[0][0]);

    engine.query(`INSERT INTO csv VALUES ('Temp', '99', 'Nowhere')`);
    const newRowid = Number(engine.query(`SELECT MAX(rowid) FROM csv`).rows[0][0]);
    engine.query(`DELETE FROM csv WHERE rowid = ${newRowid}`);

    const countAfter = Number(engine.query(`SELECT COUNT(*) FROM csv`).rows[0][0]);
    expect(countAfter).toBe(countBefore);
  });

  // ─── Flow 12: Edit → Delete edited row → Sort ─────────────────────────

  it('edit a row → delete it → sort works without the row', () => {
    engine.query(`UPDATE csv SET "Name" = 'MODIFIED' WHERE rowid = 3`);
    engine.query(`DELETE FROM csv WHERE rowid = 3`);

    buildView(engine, 'v12', 'csv', cols, '', 'ORDER BY "Name" ASC NULLS LAST');
    const page = getPage(engine, 'v12', cols, 10, 0);
    const names = page.rows.map(r => r[1]);
    expect(names).not.toContain('MODIFIED');
    expect(names).not.toContain('Diana');
    expect(page.rows.length).toBe(7);
  });

  // ─── Flow 13: Search + Sort + Pagination combined ──────────────────────

  it('search + sort + pagination all together', () => {
    // Search for "Rome" + sort by Name DESC + paginate
    const where = `WHERE (CAST("Name" AS VARCHAR) ILIKE '%rome%' ESCAPE '\\' OR CAST("Age" AS VARCHAR) ILIKE '%rome%' ESCAPE '\\' OR CAST("City" AS VARCHAR) ILIKE '%rome%' ESCAPE '\\')`;
    buildView(engine, 'v13', 'csv', cols, where, 'ORDER BY "Name" DESC NULLS LAST');

    const p1 = getPage(engine, 'v13', cols, 2, 0);
    const p2 = getPage(engine, 'v13', cols, 2, 2);

    expect(p1.rows.length).toBe(2);
    expect(p2.rows.length).toBe(1); // 3 Rome rows total

    // Verify DESC order
    expect(p1.rows[0][1]).toBe('Henry');
    expect(p1.rows[1][1]).toBe('Eve');
    expect(p2.rows[0][1]).toBe('Alice');
  });
});
