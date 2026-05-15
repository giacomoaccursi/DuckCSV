/**
 * TableExporter — writes a table back to disk as CSV.
 * Uses a streaming approach with large batches for performance.
 */

import { DuckDbEngine } from './DuckDbEngine';
import { TableManager } from './TableManager';
import { createWriteStream } from 'fs';

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

    const headerLine = headers.map(h => this.quoteField(h, delimiterChar)).join(delimiterChar);

    const stream = createWriteStream(outputPath, { encoding: 'utf8' });
    stream.write(headerLine + '\n');

    let offset = 0;
    const batchSize = 100_000;

    while (true) {
      const result = await this.engine.query(
        `SELECT ${columns} FROM ${quotedTable} LIMIT ${batchSize} OFFSET ${offset}`
      );

      if (result.rows.length === 0) { break; }

      // Build batch as a single string to minimize write calls
      let chunk = '';
      for (const row of result.rows) {
        chunk += row.map(cell => this.quoteField(cell, delimiterChar)).join(delimiterChar) + '\n';
      }
      stream.write(chunk);

      if (result.rows.length < batchSize) { break; }
      offset += batchSize;
    }

    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });
  }

  private quoteField(value: string, delimiter: string): string {
    if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }
}
