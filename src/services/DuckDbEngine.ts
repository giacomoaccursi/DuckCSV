/**
 * DuckDB Engine — proxy to a worker thread running DuckDB WASM.
 *
 * All queries are executed in a separate thread so the extension host
 * stays responsive. Supports cancellation by terminating the worker.
 */

import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import { join } from 'path';

export interface QueryResponse {
  columns: string[];
  columnTypes: string[];
  rows: string[][];
  numRows: number;
  error?: string;
}

export class DuckDbEngine implements vscode.Disposable {
  private worker: Worker | null = null;
  private initPromise: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: QueryResponse) => void; reject: (e: Error) => void }>();

  dispose(): void {
    this.terminate();
  }

  /**
   * Execute a SQL query. Returns when the query completes.
   * Throws if the worker is not ready or the query fails.
   */
  async query(sql: string): Promise<QueryResponse> {
    await this.ensureReady();

    return new Promise<QueryResponse>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'query', id, sql });
    });
  }

  /**
   * Register a file in DuckDB's virtual filesystem.
   * This bypasses DuckDB's file cache so re-reads pick up changes from disk.
   */
  async registerFile(virtualName: string, content: string): Promise<void> {
    await this.ensureReady();

    return new Promise<void>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, {
        resolve: (_r: QueryResponse) => resolve(),
        reject,
      });
      this.worker!.postMessage({ type: 'registerFile', id, virtualName, content });
    });
  }

  /**
   * Cancel all pending queries by terminating the worker.
   * A new worker will be created on the next query.
   */
  cancel(): void {
    this.terminate();
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.spawnWorker();
    }
    return this.initPromise;
  }

  private intentionalTermination = false;

  private spawnWorker(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const workerPath = join(__dirname, 'duckdb-worker.js');
      this.worker = new Worker(workerPath);

      this.worker.on('message', (msg: any) => {
        if (msg.type === 'ready') {
          resolve();
          return;
        }

        if (msg.type === 'result') {
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error));
            } else {
              pending.resolve(msg);
            }
          }
        }
      });

      this.worker.on('error', (err) => {
        reject(err);
        this.rejectAllPending(err);
      });

      this.worker.on('exit', () => {
        // Only reset state if this wasn't an intentional termination
        // (intentional termination already cleaned up in terminate())
        if (!this.intentionalTermination) {
          this.worker = null;
          this.initPromise = null;
        }
        this.intentionalTermination = false;
      });

      // Send init message with WASM directory
      this.worker.postMessage({ type: 'init', wasmDir: __dirname });
    });
  }

  private terminate(): void {
    this.intentionalTermination = true;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initPromise = null;
    this.rejectAllPending(new Error('Query cancelled'));
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(err);
    }
    this.pending.clear();
  }
}
