/**
 * Services container — groups all backend services for easy passing.
 * Panels receive this instead of 6+ individual parameters.
 */

import { DuckDbEngine } from './DuckDbEngine';
import { TableManager } from './TableManager';
import { TableExporter } from './TableExporter';
import { QueryHistoryService } from './QueryHistoryService';

export interface Services {
  engine: DuckDbEngine;
  tableManager: TableManager;
  tableExporter: TableExporter;
  queryHistory: QueryHistoryService;
}
