/**
 * Edge case tests — Windows paths, special column names, profiling edge cases.
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

describe('Edge Cases', () => {
  let engine: TestEngine;
  let tm: TableManager;
  const csvPath = join(__dirname, '..', '..', 'test-data-edge.csv');

  beforeEach(async () => {
    engine = new TestEngine();
    await engine.init();
    tm = new TableManager(engine as any);
  });

  afterEach(() => {
    engine.dispose();
    try { unlinkSync(csvPath); } catch {}
  });

  describe('Windows-style paths', () => {
    it('loads file with forward slashes (normalized from backslash)', async () => {
      writeFileSync(csvPath, 'name,value\nAlice,10\nBob,20\n');
      // Simulate what loadTable does: replace backslash with forward slash
      const windowsPath = csvPath.replace(/\//g, '\\');
      const normalized = windowsPath.replace(/\\/g, '/');
      // The normalized path should work with DuckDB
      const uri = { fsPath: normalized } as any;
      const meta = await tm.loadTable(uri, 'wintest');
      expect(meta.headers).toEqual(['name', 'value']);
      expect(meta.rowCount).toBe(2);
    });
  });

  describe('Special column names', () => {
    it('handles columns with spaces', async () => {
      writeFileSync(csvPath, 'First Name,Last Name,Age\nAlice,Smith,30\nBob,Jones,25\n');
      const uri = { fsPath: csvPath } as any;
      const meta = await tm.loadTable(uri, 'spaces');
      expect(meta.headers).toEqual(['First Name', 'Last Name', 'Age']);

      const profile = await tm.getColumnProfile('spaces', 2);
      expect(profile.columnName).toBe('Age');
      expect(profile.min).toBe('25');
      expect(profile.max).toBe('30');
    });

    it('handles columns with special characters', async () => {
      writeFileSync(csvPath, '"col/a","col""b","col,c"\n1,2,3\n4,5,6\n');
      const uri = { fsPath: csvPath } as any;
      const meta = await tm.loadTable(uri, 'special');
      expect(meta.headers.length).toBe(3);

      const page = await tm.getDataPage('special', {
        filters: {}, sort: { columnIndex: -1, direction: 'none' },
        searchTerm: '', offset: 0, limit: 10,
      });
      expect(page.rows.length).toBe(2);
    });

    it('profiles column with unicode name', async () => {
      writeFileSync(csvPath, 'città,età\nRoma,30\nMilano,25\n');
      const uri = { fsPath: csvPath } as any;
      await tm.loadTable(uri, 'unicode');

      const profile = await tm.getColumnProfile('unicode', 0);
      expect(profile.columnName).toBe('città');
      expect(profile.uniqueCount).toBe(2);
    });
  });

  describe('Profiling edge cases', () => {
    it('profiles column with single value', async () => {
      writeFileSync(csvPath, 'name,value\nA,42\nB,42\nC,42\n');
      const uri = { fsPath: csvPath } as any;
      await tm.loadTable(uri, 'single');

      const profile = await tm.getColumnProfile('single', 1);
      expect(profile.uniqueCount).toBe(1);
      expect(profile.min).toBe('42');
      expect(profile.max).toBe('42');
      expect(Number(profile.mean)).toBe(42);
    });

    it('profiles column with negative numbers', async () => {
      writeFileSync(csvPath, 'name,value\nA,-10\nB,0\nC,10\n');
      const uri = { fsPath: csvPath } as any;
      await tm.loadTable(uri, 'negative');

      const profile = await tm.getColumnProfile('negative', 1);
      expect(profile.min).toBe('-10');
      expect(profile.max).toBe('10');
      expect(Number(profile.mean)).toBeCloseTo(0);
    });

    it('profiles column with very large numbers', async () => {
      writeFileSync(csvPath, 'id,amount\n1,1000000000\n2,2000000000\n3,3000000000\n');
      const uri = { fsPath: csvPath } as any;
      await tm.loadTable(uri, 'large');

      const profile = await tm.getColumnProfile('large', 1);
      expect(Number(profile.min)).toBe(1000000000);
      expect(Number(profile.max)).toBe(3000000000);
    });
  });

  describe('Selection stats edge cases', () => {
    it('handles selection on single row', async () => {
      writeFileSync(csvPath, 'name,value\nA,10\nB,20\nC,30\n');
      const uri = { fsPath: csvPath } as any;
      await tm.loadTable(uri, 'sel');

      const stats = await tm.getSelectionStats('sel', [1], 0, 0, {}, { columnIndex: -1, direction: 'none' }, '');
      expect(stats.count).toBe(1);
      expect(stats.sum).toBe(10);
      expect(stats.min).toBe(10);
      expect(stats.max).toBe(10);
    });

    it('handles selection with active filter', async () => {
      writeFileSync(csvPath, 'name,value\nA,10\nB,20\nC,30\nD,40\nE,50\n');
      const uri = { fsPath: csvPath } as any;
      await tm.loadTable(uri, 'selfilt');

      // Filter to only rows where name IN ('A', 'C', 'E')
      const stats = await tm.getSelectionStats(
        'selfilt', [1], 0, 2,
        { 0: ['A', 'C', 'E'] },
        { columnIndex: -1, direction: 'none' }, ''
      );
      // With filter, only 3 rows match. Selecting rows 0-2 = all 3 filtered rows
      expect(stats.count).toBe(3);
      expect(stats.sum).toBe(90); // 10 + 30 + 50
    });

    it('handles selection with search term', async () => {
      writeFileSync(csvPath, 'name,value\nAlice,10\nBob,20\nAlbert,30\n');
      const uri = { fsPath: csvPath } as any;
      await tm.loadTable(uri, 'selsearch');

      // Search "Al" → matches Alice and Albert
      const stats = await tm.getSelectionStats(
        'selsearch', [1], 0, 1,
        {},
        { columnIndex: -1, direction: 'none' }, 'Al'
      );
      expect(stats.count).toBe(2);
      expect(stats.sum).toBe(40); // 10 + 30
    });
  });

  describe('Filenames with spaces', () => {
    const spacePath = join(__dirname, '..', '..', 'test data with spaces.csv');
    const quotePath = join(__dirname, '..', '..', "test'quote.csv");

    afterEach(() => {
      try { unlinkSync(spacePath); } catch {}
      try { unlinkSync(quotePath); } catch {}
    });

    it('loads a file with spaces in the path', async () => {
      writeFileSync(spacePath, 'name,value\nAlice,10\nBob,20\n');
      const uri = { fsPath: spacePath } as any;
      const meta = await tm.loadTable(uri, 'spaced');
      expect(meta.headers).toEqual(['name', 'value']);
      expect(meta.rowCount).toBe(2);
    });

    it('queries data from a file with spaces in the path', async () => {
      writeFileSync(spacePath, 'city,pop\nRome,2800000\nMilan,1400000\nNaples,960000\n');
      const uri = { fsPath: spacePath } as any;
      await tm.loadTable(uri, 'spaced_query');

      const page = await tm.getDataPage('spaced_query', {
        filters: {}, sort: { columnIndex: -1, direction: 'none' },
        searchTerm: '', offset: 0, limit: 10,
      });
      expect(page.rows.length).toBe(3);
      expect(page.rows[0][0]).toBe('Rome');
    });

    it('derives a valid table name from a spaced filename', async () => {
      writeFileSync(spacePath, 'a,b\n1,2\n');
      const uri = { fsPath: spacePath } as any;
      const meta = await tm.loadTable(uri);
      // "test data with spaces" → "test_data_with_spaces"
      expect(meta.name).toBe('test_data_with_spaces');
    });

    it('loads a file with single quote in the path', async () => {
      writeFileSync(quotePath, 'name,value\nAlice,10\nBob,20\n');
      const uri = { fsPath: quotePath } as any;
      const meta = await tm.loadTable(uri, 'quoted');
      expect(meta.headers).toEqual(['name', 'value']);
      expect(meta.rowCount).toBe(2);
    });

    it('loads a file with parentheses in the path', async () => {
      const parenPath = join(__dirname, '..', '..', 'BALANCES_MOCK(1).csv');
      writeFileSync(parenPath, 'account,balance\nA001,1000\nA002,2500\n');
      try {
        const uri = { fsPath: parenPath } as any;
        const meta = await tm.loadTable(uri, 'parens');
        expect(meta.headers).toEqual(['account', 'balance']);
        expect(meta.rowCount).toBe(2);
      } finally {
        try { unlinkSync(parenPath); } catch {}
      }
    });

    it('loads a file with brackets in the path', async () => {
      const bracketPath = join(__dirname, '..', '..', 'data[2024].csv');
      writeFileSync(bracketPath, 'x,y\n1,2\n3,4\n');
      try {
        const uri = { fsPath: bracketPath } as any;
        const meta = await tm.loadTable(uri, 'brackets');
        expect(meta.headers).toEqual(['x', 'y']);
        expect(meta.rowCount).toBe(2);
      } finally {
        try { unlinkSync(bracketPath); } catch {}
      }
    });
  });
});
