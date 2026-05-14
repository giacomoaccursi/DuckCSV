/**
 * TableExporter — writes a table back to disk as CSV.
 * Fetches data in batches of 10k rows (the worker's per-query cap).
 */

import { DuckDbEngine } from './DuckDbEngine';
import { TableManager } from './TableManager';
import { writeFileSync } from 'fs';

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
    const lines = [headerLine];

    let offset = 0;
    const batchSize = 10_000;

    while (true) {
      const result = await this.engine.query(
        `SELECT ${columns} FROM ${quotedTable} LIMIT ${batchSize} OFFSET ${offset}`
      );

      for (const row of result.rows) {
        lines.push(row.map(cell => this.quoteField(cell, delimiterChar)).join(delimiterChar));
      }

      if (result.rows.length < batchSize) { break; }
      offset += batchSize;
    }

    writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
  }

  private quoteField(value: string, delimiter: string): string {
    if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }
}
