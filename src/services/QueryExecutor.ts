/**
 * QueryExecutor — provides access to DuckDB engine with cancel support.
 */

import { DuckDbEngine } from './DuckDbEngine';

export class QueryExecutor {
  constructor(private readonly engine: DuckDbEngine) {}

  getEngine(): DuckDbEngine { return this.engine; }

  cancel(): void {
    this.engine.cancel();
  }
}
