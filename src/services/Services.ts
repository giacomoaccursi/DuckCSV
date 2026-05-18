/**
 * Services container — groups all backend services for easy passing.
 * Panels receive this instead of 6+ individual parameters.
 */

import { DuckDbEngine } from './DuckDbEngine';
import { TableManager } from './TableManager';
import { QueryExecutor } from './QueryExecutor';
import { TableExporter } from './TableExporter';
import { ConfigService } from './ConfigService';
import { QueryHistoryService } from './QueryHistoryService';

export interface Services {
  engine: DuckDbEngine;
  tableManager: TableManager;
  queryExecutor: QueryExecutor;
  tableExporter: TableExporter;
  config: ConfigService;
  queryHistory: QueryHistoryService;
}
