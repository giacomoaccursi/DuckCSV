/**
 * DuckDB WASM Engine — responsible only for initializing and disposing DuckDB.
 * Exposes the connection for use by other services.
 */

import * as vscode from 'vscode';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

export class DuckDbEngine implements vscode.Disposable {
  private db: any = null;
  private conn: any = null;
  private initPromise: Promise<void> | null = null;

  dispose(): void {
    this.close();
  }

  async getConnection(): Promise<any> {
    await this.ensureReady();
    return this.conn;
  }

  private ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const wasmDir = __dirname;

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
    this.db = await duckdb.createDuckDB(DUCKDB_BUNDLES, logger, duckdb.NODE_RUNTIME);
    await this.db.instantiate();
    this.db.open({ query: { castBigIntToDouble: true } });
    this.conn = this.db.connect();
  }

  private close(): void {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.db) {
      this.db.reset();
      this.db = null;
    }
    this.initPromise = null;
  }
}
