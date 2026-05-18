/**
 * Command Pattern — enables undo/redo for table mutations.
 *
 * Each mutation is wrapped in a Command object with execute() and undo().
 * CommandHistory maintains a stack for Cmd+Z / Cmd+Shift+Z support.
 */

import { TableManager } from './TableManager';
import { IQueryEngine } from './IQueryEngine';

export interface Command {
  execute(): Promise<void>;
  undo(): Promise<void>;
  readonly description: string;
}

export class EditCellCommand implements Command {
  readonly description: string;
  private previousValue: string = '';

  constructor(
    private readonly tableManager: TableManager,
    private readonly tableName: string,
    private readonly rowid: number,
    private readonly columnIndex: number,
    private readonly newValue: string
  ) {
    this.description = `Edit cell [${rowid}, ${columnIndex}]`;
  }

  setPreviousValue(value: string): void {
    this.previousValue = value;
  }

  async execute(): Promise<void> {
    await this.tableManager.updateCell(this.tableName, this.rowid, this.columnIndex, this.newValue);
  }

  async undo(): Promise<void> {
    await this.tableManager.updateCell(this.tableName, this.rowid, this.columnIndex, this.previousValue);
  }
}

export class InsertRowCommand implements Command {
  readonly description = 'Insert row';
  private insertedRowid: number = -1;

  constructor(
    private readonly tableManager: TableManager,
    private readonly tableName: string
  ) {}

  getInsertedRowid(): number { return this.insertedRowid; }

  async execute(): Promise<void> {
    this.insertedRowid = await this.tableManager.addRow(this.tableName);
  }

  async undo(): Promise<void> {
    if (this.insertedRowid >= 0) {
      await this.tableManager.deleteRow(this.tableName, this.insertedRowid);
    }
  }
}

export class DeleteRowCommand implements Command {
  readonly description: string;
  private deletedData: string[] = [];

  constructor(
    private readonly tableManager: TableManager,
    private readonly engine: IQueryEngine,
    private readonly tableName: string,
    private readonly rowid: number
  ) {
    this.description = `Delete row ${rowid}`;
  }

  async execute(): Promise<void> {
    // Save row data before deleting for undo
    const meta = this.tableManager.getTableMeta(this.tableName);
    if (meta) {
      const columns = meta.headers.map(h => `"${h.replace(/"/g, '""')}"`).join(', ');
      const result = await this.engine.query(
        `SELECT ${columns} FROM "${this.tableName.replace(/"/g, '""')}" WHERE rowid = ${this.rowid}`
      );
      if (result.rows.length > 0) {
        this.deletedData = result.rows[0];
      }
    }
    await this.tableManager.deleteRow(this.tableName, this.rowid);
  }

  async undo(): Promise<void> {
    // Re-insert the deleted row
    const meta = this.tableManager.getTableMeta(this.tableName);
    if (!meta || this.deletedData.length === 0) { return; }

    const values = this.deletedData.map(v =>
      v === null || v === '' ? 'NULL' : `'${v.replace(/'/g, "''")}'`
    ).join(', ');
    await this.engine.query(
      `INSERT INTO "${this.tableName.replace(/"/g, '""')}" VALUES (${values})`
    );
    this.tableManager.invalidateView();
  }
}

/**
 * CommandHistory — maintains undo/redo stacks.
 */
export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  async execute(command: Command): Promise<void> {
    await command.execute();
    this.undoStack.push(command);
    this.redoStack = []; // Clear redo on new action
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
  }

  async undo(): Promise<Command | null> {
    const command = this.undoStack.pop();
    if (!command) { return null; }
    await command.undo();
    this.redoStack.push(command);
    return command;
  }

  async redo(): Promise<Command | null> {
    const command = this.redoStack.pop();
    if (!command) { return null; }
    await command.execute();
    this.undoStack.push(command);
    return command;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  clear(): void { this.undoStack = []; this.redoStack = []; }
}
