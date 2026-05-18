/**
 * InlineQueryManager — manages inline query lifecycle.
 *
 * Handles temp table creation with __orig_rid injection, cleanup,
 * and routing between the inline query table and the panel's default table.
 */

import { IQueryEngine } from './IQueryEngine';
import { TableManager } from './TableManager';

export interface InlineQueryResult {
  tempTableName: string;
  cancelled?: boolean;
  error?: string;
}

export class InlineQueryManager {
  private inlineTable: string | null = null;

  constructor(
    private readonly engine: IQueryEngine,
    private readonly tableManager: TableManager
  ) {}

  /** Whether an inline query is currently active. */
  isActive(): boolean {
    return this.inlineTable !== null;
  }

  /** Get the active inline table name, or null if none. */
  getActiveTable(): string | null {
    return this.inlineTable;
  }

  /** Get the effective table: inline query table if active, otherwise the given default. */
  getEffectiveTable(defaultTable: string): string {
    return this.inlineTable || defaultTable;
  }

  /**
   * Execute a SQL query inline: creates a temp table with optional __orig_rid.
   * Returns the temp table name, or an error/cancelled indicator.
   */
  async executeInline(sql: string): Promise<InlineQueryResult> {
    const tempName = `__inline_qr_${Date.now()}`;
    const trimmedSql = sql.trim();

    // Try to inject rowid into the SELECT for edit support
    const withRowid = trimmedSql.replace(/^SELECT\s/i, 'SELECT rowid as __orig_rid, ');
    let hasOrigRid = false;

    try {
      await this.engine.query(`CREATE TEMP TABLE "${tempName}" AS ${withRowid}`);
      hasOrigRid = true;
    } catch (firstErr: unknown) {
      if (firstErr instanceof Error && firstErr.message.includes('cancelled')) {
        return { tempTableName: '', cancelled: true };
      }
      // Fallback: rowid injection failed (e.g. aggregation, JOIN). Create without it.
      try {
        await this.engine.query(`DROP TABLE IF EXISTS "${tempName}"`);
        await this.engine.query(`CREATE TEMP TABLE "${tempName}" AS ${trimmedSql}`);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('cancelled')) {
          return { tempTableName: '', cancelled: true };
        }
        const msg = err instanceof Error ? err.message : 'Query failed';
        return { tempTableName: '', error: msg };
      }
    }

    // Get schema + count (exclude __orig_rid from visible headers)
    const schemaResult = await this.engine.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tempName}' AND column_name != '__orig_rid' ORDER BY ordinal_position`
    );
    const countResult = await this.engine.query(`SELECT COUNT(*) FROM "${tempName}"`);

    // Drop previous inline query table
    await this.clear();

    // Register temp table
    this.inlineTable = tempName;
    this.tableManager.registerTable({
      name: tempName, filePath: '', delimiter: 'Comma', delimiterChar: ',',
      headers: schemaResult.rows.map(r => r[0]),
      columnTypes: schemaResult.rows.map(r => r[1]),
      originalTypes: schemaResult.rows.map(r => r[1]),
      rowCount: Number(countResult.rows[0][0]),
      useOrigRid: hasOrigRid,
    });

    return { tempTableName: tempName };
  }

  /** Drop the inline query temp table and unregister it. */
  async clear(): Promise<void> {
    if (this.inlineTable) {
      await this.engine.query(`DROP TABLE IF EXISTS "${this.inlineTable}"`);
      this.tableManager.unregisterTable(this.inlineTable);
      this.inlineTable = null;
    }
  }

  /** Reset state without dropping (used after engine cancel/restart). */
  reset(): void {
    if (this.inlineTable) {
      this.tableManager.unregisterTable(this.inlineTable);
      this.inlineTable = null;
    }
    this.tableManager.invalidateView();
  }
}
