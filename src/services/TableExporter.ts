/**
 * TableExporter — writes a table back to disk as CSV.
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
    const conn = await this.engine.getConnection();
    const meta = this.tableManager.getTableMeta(tableName);

    if (!meta) {
      throw new Error(`Table "${tableName}" not found`);
    }

    const { headers, delimiterChar } = meta;
    const quotedTable = `"${tableName.replace(/"/g, '""')}"`;

    // Build header line
    const headerLine = headers.map(h => this.quoteField(h, delimiterChar)).join(delimiterChar);

    // Fetch all data
    const columns = headers.map(h => `"${h.replace(/"/g, '""')}"`).join(', ');
    const dataResult = conn.query(`SELECT ${columns} FROM ${quotedTable}`);
    const rows = this.arrowTableToRows(dataResult);

    // Build CSV content
    const lines = [headerLine];
    for (const row of rows) {
      lines.push(row.map(cell => this.quoteField(cell, delimiterChar)).join(delimiterChar));
    }

    writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
  }

  private quoteField(value: string, delimiter: string): string {
    if (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
  }

  private arrowTableToRows(table: any): string[][] {
    const rows: string[][] = [];
    const numRows = table.numRows;
    const numCols = table.numCols;

    for (let i = 0; i < numRows; i++) {
      const row: string[] = [];
      for (let j = 0; j < numCols; j++) {
        const val = table.getChildAt(j)?.get(i);
        row.push(val === null || val === undefined ? '' : String(val));
      }
      rows.push(row);
    }

    return rows;
  }
}
