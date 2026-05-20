/**
 * Integration tests: CommandHistory + TableManager + DuckDB
 *
 * Tests the full undo/redo flow with a real DuckDB instance.
 * Verifies that edit → undo restores original value, insert → undo removes row, etc.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

// ─── Test Engine (implements IQueryEngine) ───────────────────────────────────

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
  dispose() { if (this.conn) { this.conn.close(); } if (this.db) { this.db.dropFiles(); } }
}

// ─── Mock TableManager (minimal, uses real SQL) ──────────────────────────────

class MockTableManager {
  private engine: TestEngine;
  private meta: any;

  constructor(engine: TestEngine) { this.engine = engine; }

  registerMeta(meta: any) { this.meta = meta; }
  getTableMeta(_name: string) { return this.meta; }
  invalidateView() {}

  async updateCell(tableName: string, rowid: number, columnIndex: number, value: string) {
    const colName = `"${this.meta.headers[columnIndex]}"`;
    const escaped = value.replace(/'/g, "''");
    await this.engine.query(`UPDATE "${tableName}" SET ${colName} = '${escaped}' WHERE rowid = ${rowid}`);
  }

  async addRow(tableName: string): Promise<number> {
    const nulls = this.meta.headers.map(() => 'NULL').join(', ');
    await this.engine.query(`INSERT INTO "${tableName}" VALUES (${nulls})`);
    const r = await this.engine.query(`SELECT MAX(rowid) FROM "${tableName}"`);
    return Number(r.rows[0][0]);
  }

  async deleteRow(tableName: string, rowid: number) {
    await this.engine.query(`DELETE FROM "${tableName}" WHERE rowid = ${rowid}`);
  }
}

// ─── Import CommandHistory ───────────────────────────────────────────────────

import { CommandHistory, EditCellCommand, InsertRowCommand, DeleteRowCommand } from '../../src/services/CommandHistory';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CommandHistory Integration', () => {
  let engine: TestEngine;
  let tm: MockTableManager;
  let history: CommandHistory;
  const csvPath = join(__dirname, '..', '..', 'test-cmd-history-tmp.csv');

  beforeEach(async () => {
    engine = new TestEngine();
    await engine.init();
    writeFileSync(csvPath, 'Name,Age\nAlice,30\nBob,25\nCharlie,35\n');
    await engine.query(`CREATE TABLE t AS SELECT * FROM read_csv_auto('${csvPath.replace(/'/g, "''")}', ignore_errors=true)`);
    tm = new MockTableManager(engine);
    tm.registerMeta({ name: 't', headers: ['Name', 'Age'], columnTypes: ['VARCHAR', 'BIGINT'], originalTypes: ['VARCHAR', 'BIGINT'] });
    history = new CommandHistory();
  });

  afterEach(() => {
    engine.dispose();
    try { unlinkSync(csvPath); } catch {}
  });

  describe('EditCellCommand', () => {
    it('execute changes the cell value', async () => {
      const cmd = new EditCellCommand(tm as any, 't', 0, 0, 'Zara');
      cmd.setPreviousValue('Alice');
      await history.execute(cmd);

      const r = await engine.query(`SELECT "Name" FROM t WHERE rowid = 0`);
      expect(r.rows[0][0]).toBe('Zara');
    });

    it('undo restores the original value', async () => {
      const cmd = new EditCellCommand(tm as any, 't', 0, 0, 'Zara');
      cmd.setPreviousValue('Alice');
      await history.execute(cmd);
      await history.undo();

      const r = await engine.query(`SELECT "Name" FROM t WHERE rowid = 0`);
      expect(r.rows[0][0]).toBe('Alice');
    });

    it('redo re-applies the change', async () => {
      const cmd = new EditCellCommand(tm as any, 't', 0, 0, 'Zara');
      cmd.setPreviousValue('Alice');
      await history.execute(cmd);
      await history.undo();
      await history.redo();

      const r = await engine.query(`SELECT "Name" FROM t WHERE rowid = 0`);
      expect(r.rows[0][0]).toBe('Zara');
    });

    it('multiple edits can be undone in order', async () => {
      const cmd1 = new EditCellCommand(tm as any, 't', 0, 0, 'X');
      cmd1.setPreviousValue('Alice');
      await history.execute(cmd1);

      const cmd2 = new EditCellCommand(tm as any, 't', 1, 0, 'Y');
      cmd2.setPreviousValue('Bob');
      await history.execute(cmd2);

      await history.undo(); // undo Y → Bob
      const r1 = await engine.query(`SELECT "Name" FROM t WHERE rowid = 1`);
      expect(r1.rows[0][0]).toBe('Bob');

      await history.undo(); // undo X → Alice
      const r2 = await engine.query(`SELECT "Name" FROM t WHERE rowid = 0`);
      expect(r2.rows[0][0]).toBe('Alice');
    });
  });

  describe('InsertRowCommand', () => {
    it('execute adds a row', async () => {
      const cmd = new InsertRowCommand(tm as any, 't');
      await history.execute(cmd);

      const r = await engine.query(`SELECT COUNT(*) FROM t`);
      expect(Number(r.rows[0][0])).toBe(4);
    });

    it('undo removes the inserted row', async () => {
      const cmd = new InsertRowCommand(tm as any, 't');
      await history.execute(cmd);
      await history.undo();

      const r = await engine.query(`SELECT COUNT(*) FROM t`);
      expect(Number(r.rows[0][0])).toBe(3);
    });
  });

  describe('DeleteRowCommand', () => {
    it('execute removes the row', async () => {
      const cmd = new DeleteRowCommand(tm as any, engine, 't', 0);
      await history.execute(cmd);

      const r = await engine.query(`SELECT COUNT(*) FROM t`);
      expect(Number(r.rows[0][0])).toBe(2);
    });

    it('undo re-inserts the deleted row', async () => {
      const cmd = new DeleteRowCommand(tm as any, engine, 't', 0);
      await history.execute(cmd);
      await history.undo();

      const r = await engine.query(`SELECT COUNT(*) FROM t`);
      expect(Number(r.rows[0][0])).toBe(3);
      // Verify the data is back
      const names = await engine.query(`SELECT "Name" FROM t ORDER BY "Name"`);
      expect(names.rows.map(r => r[0])).toContain('Alice');
    });
  });

  describe('Edge cases', () => {
    it('undo on empty history does nothing', async () => {
      const result = await history.undo();
      expect(result).toBeNull();
    });

    it('redo on empty redo stack does nothing', async () => {
      const result = await history.redo();
      expect(result).toBeNull();
    });

    it('new command after undo clears redo stack', async () => {
      const cmd1 = new EditCellCommand(tm as any, 't', 0, 0, 'X');
      cmd1.setPreviousValue('Alice');
      await history.execute(cmd1);
      await history.undo();

      expect(history.canRedo()).toBe(true);

      const cmd2 = new EditCellCommand(tm as any, 't', 0, 0, 'Y');
      cmd2.setPreviousValue('Alice');
      await history.execute(cmd2);

      expect(history.canRedo()).toBe(false);
    });

    it('edit with special characters (quotes, unicode)', async () => {
      const cmd = new EditCellCommand(tm as any, 't', 0, 0, "O'Brien");
      cmd.setPreviousValue('Alice');
      await history.execute(cmd);

      const r = await engine.query(`SELECT "Name" FROM t WHERE rowid = 0`);
      expect(r.rows[0][0]).toBe("O'Brien");

      await history.undo();
      const r2 = await engine.query(`SELECT "Name" FROM t WHERE rowid = 0`);
      expect(r2.rows[0][0]).toBe('Alice');
    });

    it('edit empty string', async () => {
      const cmd = new EditCellCommand(tm as any, 't', 0, 0, '');
      cmd.setPreviousValue('Alice');
      await history.execute(cmd);

      const r = await engine.query(`SELECT "Name" FROM t WHERE rowid = 0`);
      expect(r.rows[0][0]).toBe('');
    });
  });
});
