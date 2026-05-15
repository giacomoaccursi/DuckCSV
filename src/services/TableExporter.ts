/**
 * TableExporter — writes a table back to disk as CSV.
 * Uses DuckDB native COPY TO for maximum performance.
 */

import { DuckDbEngine } from './DuckDbEngine';
import { TableManager } from './TableManager';

export class TableExporter {
  constructor(
    private readonly engine: DuckDbEngine,
    private readonly tableManager: TableManager
  ) {}

  async exportTable(tableName: string, outputPath: string): Promise<void> {
    const meta = this.tableManager.getTableMeta(tableName);
    if (!meta) { throw new Error(`Table "${tableName}" not found`); }

    const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
    const escapedPath = outputPath.replace(/'/g, "''");
    const delimiter = meta.delimiterChar.replace(/'/g, "''");

    await this.engine.query(
      `COPY ${quotedTable} TO '${escapedPath}' (HEADER, DELIMITER '${delimiter}')`
    );
  }
}
