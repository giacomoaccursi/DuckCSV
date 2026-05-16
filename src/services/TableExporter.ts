/**
 * TableExporter — writes a table back to disk as CSV.
 * Uses batched SELECT queries and writes from the main thread
 * (DuckDB WASM COPY TO does not write to real filesystem from worker threads).
 */

import { DuckDbEngine } from './DuckDbEngine';
import { TableManager } from './TableManager';
import { createWriteStream } from 'fs';
import { quoteCsvField } from '../shared/csvUtils';

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
    const batchSize = 100_000;

    while (true) {
      const result = await this.engine.query(
        `SELECT ${columns} FROM ${quotedTable} LIMIT ${batchSize} OFFSET ${offset}`
      );

      if (result.rows.length === 0) { break; }

      const lines: string[] = [];
      for (const row of result.rows) {
        lines.push(row.map(cell => quoteCsvField(cell, delimiterChar)).join(delimiterChar));
      }
      stream.write(lines.join('\n') + '\n');

      if (result.rows.length < batchSize) { break; }
      offset += batchSize;
    }

    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });
  }
}
