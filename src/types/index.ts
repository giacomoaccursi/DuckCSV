/**
 * Shared type definitions for CSV Enhanced extension.
 */

// ─── Sort & Filter ───────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc' | 'none';

export interface SortState {
  columnIndex: number;
  direction: SortDirection;
}

/** Map of columnIndex → selected values */
export type ColumnFilters = Record<number, string[]>;

// ─── Table Info (Workspace) ──────────────────────────────────────────────────

export interface TableInfo {
  name: string;
  headers: string[];
  rowCount: number;
  filePath: string;
}

// ─── Webview Payloads ────────────────────────────────────────────────────────

export interface DataPagePayload {
  headers: string[];
  columnTypes: string[];
  rows: string[][];
  rowids: number[];
  totalRows: number;
  filteredRows: number;
  delimiter: string;
  fileName: string;
  fileSize: number;
  sort: SortState;
  filters: ColumnFilters;
  searchTerm: string;
  isDirty: boolean;
}

export interface ColumnValuesPayload {
  columnIndex: number;
  values: string[];
  totalCount: number;
}

export interface QueryResultPayload {
  headers: string[];
  rows: string[][];
  rowCount: number;
  totalCount: number;
  executionTimeMs: number;
  sql: string;
  error?: string;
}

export interface CellEditConfirmPayload {
  rowid: number;
  columnIndex: number;
  value: string;
}

// ─── Messages: Extension → Webview ──────────────────────────────────────────

export type ExtensionMessage =
  | { type: 'dataPage'; data: DataPagePayload }
  | { type: 'columnValues'; data: ColumnValuesPayload }
  | { type: 'cellEditConfirm'; data: CellEditConfirmPayload }
  | { type: 'queryResult'; data: QueryResultPayload }
  | { type: 'modeInfo'; mode: 'readonly' | 'edit'; savePath: string }
  | { type: 'error'; message: string }
  | { type: 'loading'; loading: boolean }
  | { type: 'tableList'; tables: TableInfo[] };

// ─── Messages: Webview → Extension ──────────────────────────────────────────

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'sort'; columnIndex: number; direction: SortDirection }
  | { type: 'search'; term: string }
  | { type: 'getColumnValues'; columnIndex: number }
  | { type: 'setFilters'; filters: ColumnFilters }
  | { type: 'editCell'; rowid: number; columnIndex: number; value: string }
  | { type: 'addRow' }
  | { type: 'addRowAt'; rowid: number; position: 'above' | 'below' }
  | { type: 'deleteRow'; rowid: number }
  | { type: 'deleteRows'; rowids: number[] }
  | { type: 'executeQuery'; sql: string; mode: 'inline' | 'side' }
  | { type: 'exportQueryResult'; headers: string[]; rows: string[][] }
  | { type: 'cancelQuery' }
  | { type: 'clearQuery' }
  | { type: 'copyToClipboard'; text: string }
  | { type: 'openAsText' }
  | { type: 'openWorkspace' }
  | { type: 'addTable'; filePath: string }
  | { type: 'removeTable'; tableName: string }
  | { type: 'switchTable'; tableName: string };
