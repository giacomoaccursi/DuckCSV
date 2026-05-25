/**
 * Tests for getColumnProfile — verifies stats and null% calculation,
 * including after cell edits that create NULLs.
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

describe('getColumnProfile', () => {
  let engine: TestEngine;
  let tm: TableManager;
  const csvPath = join(__dirname, '..', '..', 'test-data-profile.csv');

  beforeEach(async () => {
    engine = new TestEngine();
    await engine.init();
    tm = new TableManager(engine as any);
  });

  afterEach(() => {
    engine.dispose();
    try { unlinkSync(csvPath); } catch {}
  });

  it('computes correct stats for numeric column', async () => {
    writeFileSync(csvPath, 'name,value\nA,10\nB,20\nC,30\nD,40\nE,50\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    const profile = await tm.getColumnProfile('test', 1);
    expect(profile.columnName).toBe('value');
    expect(profile.totalRows).toBe(5);
    expect(profile.nonNullCount).toBe(5);
    expect(profile.uniqueCount).toBe(5);
    expect(profile.nullPercent).toBe(0);
    expect(profile.min).toBe('10');
    expect(profile.max).toBe('50');
    expect(profile.chartType).toBe('histogram');
  });

  it('computes null% with NULLs in CSV', async () => {
    writeFileSync(csvPath, 'name,value\nA,10\nB,\nC,30\nD,\nE,50\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    const profile = await tm.getColumnProfile('test', 1);
    expect(profile.totalRows).toBe(5);
    expect(profile.nonNullCount).toBe(3);
    expect(profile.nullPercent).toBe(40); // 2/5 = 40%
  });

  it('computes null% after editing a cell to empty', async () => {
    writeFileSync(csvPath, 'name,value\nAlice,10\nBob,20\nCharlie,30\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    // Before edit: 0% null
    let profile = await tm.getColumnProfile('test', 0); // name column (VARCHAR)
    expect(profile.nullPercent).toBe(0);
    expect(profile.nonNullCount).toBe(3);

    // Edit cell to empty string (this is what the UI does)
    await tm.updateCell('test', 0, 0, '');

    // After edit: empty string should count as null → 1/3 = 33.33%
    profile = await tm.getColumnProfile('test', 0);
    expect(profile.nonNullCount).toBe(2);
    expect(profile.nullPercent).toBeCloseTo(33.33, 1);
  });

  it('computes stats for text column', async () => {
    writeFileSync(csvPath, 'name,city\nAlice,Rome\nBob,Rome\nCharlie,Milan\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    const profile = await tm.getColumnProfile('test', 1);
    expect(profile.columnName).toBe('city');
    expect(profile.totalRows).toBe(3);
    expect(profile.uniqueCount).toBe(2);
    expect(profile.nullPercent).toBe(0);
    expect(profile.chartType).toBe('bar');
    expect(profile.distribution.length).toBeGreaterThan(0);
    // Rome appears twice, Milan once
    const rome = profile.distribution.find(d => d.label === 'Rome');
    expect(rome?.count).toBe(2);
  });

  it('handles all-NULL numeric column', async () => {
    writeFileSync(csvPath, 'name,value\nA,10\nB,20\nC,30\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    // Make all cells NULL
    await tm.updateCell('test', 0, 1, '');
    await tm.updateCell('test', 1, 1, '');
    await tm.updateCell('test', 2, 1, '');

    const profile = await tm.getColumnProfile('test', 1);
    expect(profile.totalRows).toBe(3);
    expect(profile.nonNullCount).toBe(0);
    expect(profile.nullPercent).toBe(100);
  });

  it('updates stats after adding a value to a NULL cell', async () => {
    writeFileSync(csvPath, 'name,value\nA,10\nB,\nC,30\n');
    const uri = { fsPath: csvPath } as any;
    await tm.loadTable(uri, 'test');

    let profile = await tm.getColumnProfile('test', 1);
    expect(profile.nonNullCount).toBe(2);
    expect(profile.nullPercent).toBeCloseTo(33.33, 1);

    // Fill in the NULL cell
    await tm.updateCell('test', 1, 1, '20');

    profile = await tm.getColumnProfile('test', 1);
    expect(profile.nonNullCount).toBe(3);
    expect(profile.nullPercent).toBe(0);
    expect(profile.min).toBe('10');
    expect(profile.max).toBe('30');
  });
});
