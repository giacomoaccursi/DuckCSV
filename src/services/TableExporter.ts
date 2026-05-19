/**
 * TableExporter — writes a table back to disk as CSV.
 * Uses batched SELECT queries and writes from the main thread
 * (DuckDB WASM COPY TO does not write to real filesystem from worker threads).
 */

import { DuckDbEngine } from './DuckDbEngine';
import { TableManager } from './TableManager';
import { createWriteStream, writeFileSync } from 'fs';
import { quoteCsvField } from '../shared/csvUtils';
import { EXPORT_BATCH_SIZE } from '../shared/constants';

export class TableExporter {
  constructor(
    private readonly engine: DuckDbEngine,
    private readonly tableManager: TableManager
  ) {}

  async exportTable(tableName: string, outputPath: string): Promise<void> {
    const meta = this.tableManager.getTableMeta(tableName);
    if (!meta) { throw new Error(`Table "${tableName}" not found`); }

    const { headers, delimiterChar } = meta;
    const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
    const columns = headers.map(h => `"${h.replace(/"/g, '""')}"`).join(', ');

    const headerLine = headers.map(h => quoteCsvField(h, delimiterChar)).join(delimiterChar);

    const stream = createWriteStream(outputPath, { encoding: 'utf8' });
    stream.write(headerLine + '\n');

    let offset = 0;

    while (true) {
      const result = await this.engine.query(
        `SELECT ${columns} FROM ${quotedTable} LIMIT ${EXPORT_BATCH_SIZE} OFFSET ${offset}`
      );

      if (result.rows.length === 0) { break; }

      const lines: string[] = [];
      for (const row of result.rows) {
        lines.push(row.map(cell => quoteCsvField(cell, delimiterChar)).join(delimiterChar));
      }
      stream.write(lines.join('\n') + '\n');

      if (result.rows.length < EXPORT_BATCH_SIZE) { break; }
      offset += EXPORT_BATCH_SIZE;
    }

    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });
  }

  async exportAsParquet(tableName: string, outputPath: string): Promise<void> {
    const meta = this.tableManager.getTableMeta(tableName);
    if (!meta) { throw new Error(`Table "${tableName}" not found`); }

    const buffer = await this.engine.exportParquet(tableName, 'ZSTD');
    writeFileSync(outputPath, buffer);
  }

  /** Export a table to the given path, choosing format based on file extension. */
  async exportAuto(tableName: string, outputPath: string): Promise<void> {
    if (outputPath.endsWith('.parquet')) {
      return this.exportAsParquet(tableName, outputPath);
    }
    return this.exportTable(tableName, outputPath);
  }
}