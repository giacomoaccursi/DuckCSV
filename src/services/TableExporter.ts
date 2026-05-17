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
    const columns = headers.map(h => `"${h.replace(/"/g, '""')}"`).join(', ');

    const headerLine = headers.map(h => quoteCsvField(h, delimiterChar)).join(delimiterChar);

    // Get the view name for correct row ordering (handles insert above/below)
    const viewSource = this.tableManager.getViewSource();

    const stream = createWriteStream(outputPath, { encoding: 'utf8' });
    stream.write(headerLine + '\n');

    let offset = 0;
    const batchSize = 10_000;

    while (true) {
      let query: string;
      if (viewSource) {
        // Export from the materialized view (preserves insert order)
        query = `SELECT ${columns} FROM "${viewSource.replace(/"/g, '""')}" ORDER BY __pos LIMIT ${batchSize} OFFSET ${offset}`;
      } else {
        // No view available — export from table directly
        const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
        query = `SELECT ${columns} FROM ${quotedTable} LIMIT ${batchSize} OFFSET ${offset}`;
      }

      const result = await this.engine.query(query);

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
