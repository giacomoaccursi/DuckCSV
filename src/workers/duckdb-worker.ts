/**
 * DuckDB Worker — runs DuckDB WASM in a separate thread.
 *
 * Receives query requests from the main thread, executes them,
 * and sends back serialized results. The main thread stays free.
 */

import { parentPort } from 'worker_threads';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

// ─── Types ───────────────────────────────────────────────────────────────────

interface QueryRequest {
  id: number;
  type: 'query';
  sql: string;
}

interface QueryResponse {
  id: number;
  type: 'result';
  columns: string[];
  columnTypes: string[];
  rows: string[][];
  numRows: number;
  error?: string;
}

interface InitRequest {
  type: 'init';
  wasmDir: string;
}

interface InitResponse {
  type: 'ready';
}

interface RegisterFileRequest {
  id: number;
  type: 'registerFile';
  virtualName: string;
  content: string;
}

interface ExportParquetRequest {
  id: number;
  type: 'exportParquet';
  tableName: string;
  compression: 'ZSTD' | 'SNAPPY' | 'UNCOMPRESSED';
}

type WorkerMessage = QueryRequest | InitRequest | RegisterFileRequest | ExportParquetRequest;

// ─── State ───────────────────────────────────────────────────────────────────

let db: any = null;
let conn: any = null;

// ─── Message Handler ─────────────────────────────────────────────────────────

parentPort?.on('message', async (msg: WorkerMessage) => {
  switch (msg.type) {
    case 'init':
      await initialize(msg.wasmDir);
      parentPort?.postMessage({ type: 'ready' } as InitResponse);
      break;

    case 'query':
      executeQuery(msg);
      break;

    case 'registerFile':
      registerFile(msg);
      break;

    case 'exportParquet':
      exportParquet(msg);
      break;
  }
});

// ─── Initialization ──────────────────────────────────────────────────────────

async function initialize(wasmDir: string): Promise<void> {
  const DUCKDB_BUNDLES = {
    mvp: {
      mainModule: join(wasmDir, 'duckdb-mvp.wasm'),
      mainWorker: join(wasmDir, 'duckdb-node-mvp.worker.cjs'),
    },
    eh: {
      mainModule: join(wasmDir, 'duckdb-eh.wasm'),
      mainWorker: join(wasmDir, 'duckdb-node-eh.worker.cjs'),
    },
  };

  const logger = new duckdb.ConsoleLogger();
  db = await duckdb.createDuckDB(DUCKDB_BUNDLES, logger, duckdb.NODE_RUNTIME);
  await db.instantiate();
  db.open({ query: { castBigIntToDouble: true } });
  conn = db.connect();
}

// ─── Query Execution ─────────────────────────────────────────────────────────

function executeQuery(msg: QueryRequest): void {
  const { id, sql } = msg;

  try {
    const result = conn.query(sql);

    const columns: string[] = result.schema.fields.map((f: any) => f.name);
    const columnTypes: string[] = result.schema.fields.map((f: any) => f.type?.toString() || '');
    const numRows = result.numRows;
    const numCols = result.numCols;

    // Serialize all result rows
    const rows: string[][] = [];

    // Pre-fetch column vectors to avoid repeated getChildAt lookups
    const columnVectors: any[] = [];
    for (let j = 0; j < numCols; j++) {
      columnVectors.push(result.getChildAt(j));
    }

    // Pre-compute date column flags to avoid toLowerCase() per cell
    const isDateCol: boolean[] = columnTypes.map(t => {
      const lower = t.toLowerCase();
      return lower.includes('date') || lower.includes('timestamp');
    });

    for (let i = 0; i < numRows; i++) {
      const row: string[] = [];
      for (let j = 0; j < numCols; j++) {
        const val = columnVectors[j]?.get(i);
        row.push(formatValue(val, isDateCol[j]));
      }
      rows.push(row);
    }

    const response: QueryResponse = { id, type: 'result', columns, columnTypes, rows, numRows };
    parentPort?.postMessage(response);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Query failed';
    const response: QueryResponse = { id, type: 'result', columns: [], columnTypes: [], rows: [], numRows: 0, error };
    parentPort?.postMessage(response);
  }
}

// ─── Value Formatting ────────────────────────────────────────────────────────

function formatValue(val: any, isDate: boolean): string {
  if (val === null || val === undefined) { return ''; }
  if (val instanceof Date) { return val.toISOString().split('T')[0]; }
  if (typeof val === 'bigint') { return val.toString(); }

  if (typeof val === 'number' && isDate) {
    const ms = val > 1e10 ? val : val * 86400000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }

  return String(val);
}

// ─── File Registration ───────────────────────────────────────────────────────

function registerFile(msg: RegisterFileRequest): void {
  const { id, virtualName, content } = msg;
  try {
    db.registerFileText(virtualName, content);
    parentPort?.postMessage({ id, type: 'result', columns: [], columnTypes: [], rows: [], numRows: 0 });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to register file';
    parentPort?.postMessage({ id, type: 'result', columns: [], columnTypes: [], rows: [], numRows: 0, error });
  }
}

// ─── Parquet Export ──────────────────────────────────────────────────────────

function exportParquet(msg: ExportParquetRequest): void {
  const { id, tableName, compression } = msg;
  const vfsPath = `/tmp/__export_${id}.parquet`;
  const quoted = `"${tableName.replace(/"/g, '""')}"`;

  try {
    // Exclude internal __orig_rid column if present
    const schemaResult = conn.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName.replace(/'/g, "''")}' AND column_name != '__orig_rid' ORDER BY ordinal_position`
    );
    const columns: string[] = [];
    for (let i = 0; i < schemaResult.numRows; i++) {
      columns.push(`"${schemaResult.getChildAt(0)?.get(i)}"`);
    }
    const selectCols = columns.length > 0 ? columns.join(', ') : '*';

    conn.query(`COPY (SELECT ${selectCols} FROM ${quoted}) TO '${vfsPath}' (FORMAT PARQUET, COMPRESSION ${compression})`);
    const buffer: Uint8Array = db.copyFileToBuffer(vfsPath);
    db.dropFile(vfsPath);
    parentPort?.postMessage({ id, type: 'parquetBuffer', buffer }, [buffer.buffer as ArrayBuffer]);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Parquet export failed';
    parentPort?.postMessage({ id, type: 'parquetBuffer', buffer: null, error });
  }
}
