/**
 * Tests for selection stats — verifies that backend SQL correctly computes
 * count, sum, avg, min, max for column selections, including edge cases
 * with NULL values, empty cells, and type-widened columns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';
import { TableManager } from '../../src/services/TableManager';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

class TestEngine {
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

  cancel() {}
  dispose() {
    if (this.conn) { this.conn.close(); this.conn = null; }
    if (this.db) { this.db.dropFiles(); this.db = null; }
  }
}

describe('Selection Stats', () => {
  let engine: TestEngine;
  let tm: TableManager;
  const csvPath = join(__dirname, '..', '..', 'test-data-sel-stats.csv');

  beforeEach(async () => {
    engine = new TestEngine();
    await engine.init();
    tm = new TableManager(engine as any);
  });

  afterEach(() => {
    engine.dispose();
    try { unlinkSync(csvPath); } catch {}
  });

  it('computes sum/avg/min/max on a BIGINT column', async () => {
    writeFileSync(csvPath, 'name,value\nA,10\nB,20\nC,30\nD,40\nE,50\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    const stats = await tm.getSelectionStats('test', [1], 0, 4, {}, { columnIndex: -1, direction: 'none' }, '');
    expect(stats.count).toBe(5);
    expect(stats.hasNumeric).toBe(true);
    expect(stats.sum).toBe(150);
    expect(stats.avg).toBe(30);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(50);
  });

  it('handles NULL values in numeric column', async () => {
    writeFileSync(csvPath, 'name,value\nA,10\nB,\nC,30\nD,\nE,50\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    const stats = await tm.getSelectionStats('test', [1], 0, 4, {}, { columnIndex: -1, direction: 'none' }, '');
    expect(stats.count).toBe(5); // 5 cells total (including NULLs)
    expect(stats.hasNumeric).toBe(true);
    expect(stats.sum).toBe(90); // 10 + 30 + 50
    expect(stats.avg).toBe(30); // 90 / 3 non-null
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(50);
  });

  it('handles column after editing cell to empty (stays BIGINT with NULL)', async () => {
    writeFileSync(csvPath, 'name,value\nA,10\nB,20\nC,30\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    // Editing a BIGINT cell to empty → becomes NULL, type stays BIGINT
    await tm.updateCell('test', 1, 1, '');

    const stats = await tm.getSelectionStats('test', [1], 0, 2, {}, { columnIndex: -1, direction: 'none' }, '');
    expect(stats.count).toBe(3);
    expect(stats.hasNumeric).toBe(true);
    // Row 0: 10, Row 1: NULL, Row 2: 30
    expect(stats.sum).toBe(40); // 10 + 30
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(30);
    expect(stats.avg).toBe(20); // 40 / 2 non-null
  });

  it('returns hasNumeric=false for text-only columns', async () => {
    writeFileSync(csvPath, 'name,city\nAlice,Rome\nBob,Milan\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    const stats = await tm.getSelectionStats('test', [0], 0, 1, {}, { columnIndex: -1, direction: 'none' }, '');
    expect(stats.count).toBe(2);
    expect(stats.hasNumeric).toBe(false);
    expect(stats.sum).toBeUndefined();
  });

  it('respects row range (partial selection)', async () => {
    writeFileSync(csvPath, 'name,value\nA,10\nB,20\nC,30\nD,40\nE,50\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    // Select only rows 1-3 (B=20, C=30, D=40)
    const stats = await tm.getSelectionStats('test', [1], 1, 3, {}, { columnIndex: -1, direction: 'none' }, '');
    expect(stats.count).toBe(3);
    expect(stats.sum).toBe(90);
    expect(stats.avg).toBe(30);
    expect(stats.min).toBe(20);
    expect(stats.max).toBe(40);
  });

  it('respects active sort when computing positional range', async () => {
    writeFileSync(csvPath, 'name,value\nA,50\nB,10\nC,40\nD,20\nE,30\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    // Sort ascending by value: 10, 20, 30, 40, 50
    // Select rows 0-2 → should be 10, 20, 30
    const stats = await tm.getSelectionStats('test', [1], 0, 2, {}, { columnIndex: 1, direction: 'asc' }, '');
    expect(stats.sum).toBe(60); // 10 + 20 + 30
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(30);
  });

  it('handles all-NULL column', async () => {
    writeFileSync(csvPath, 'name,value\nA,\nB,\nC,\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    const meta = tm.getTableMeta('test');
    // DuckDB infers VARCHAR when all values are empty — no numeric stats
    const stats = await tm.getSelectionStats('test', [1], 0, 2, {}, { columnIndex: -1, direction: 'none' }, '');
    expect(stats.count).toBe(3);
    // If DuckDB inferred VARCHAR (all empty), hasNumeric is false
    // If it inferred BIGINT (with NULLs), hasNumeric is true but sum/avg undefined
    if (meta?.columnTypes[1] === 'VARCHAR') {
      expect(stats.hasNumeric).toBe(false);
    } else {
      expect(stats.hasNumeric).toBe(true);
    }
  });
});
