/**
 * IQueryEngine — interface for executing SQL queries.
 * Allows TableManager to be tested with a mock implementation.
 */

import { QueryResponse } from './DuckDbEngine';

export interface IQueryEngine {
  query(sql: string): Promise<QueryResponse>;
  cancel(): void;
}
