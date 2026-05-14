/**
 * Shared type definitions for CSV Enhanced extension.
 */

// ─── Sort & Filter ───────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc' | 'none';

export interface SortState {
  columnIndex: number;
  direction: SortDirection;
}

/** Map of columnIndex → set of selected values */
export type ColumnFilters = Record<number, string[]>;

// ─── Data Model ──────────────────────────────────────────────────────────────

export interface ParseError {
  type: string;
  code: string;
  message: string;
  row?: number;
}

export interface ParseOptions {
  delimiter?: string;
  skipEmptyLines?: boolean;
}

export interface ParseResult {
  data: string[][];
  headers: string[];
  errors: ParseError[];
}

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

// ─── Webview Payloads ────────────────────────────────────────────────────────

export interface DataPagePayload {
  headers: string[];
  rows: string[][];
  /** Original row indices (in the full dataset) for each row in `rows` */
  originalIndices: number[];
  totalRows: number;
  filteredRows: number;
  pageOffset: number;
  pageSize: number;
  hasMore: boolean;
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

export interface CellEditConfirmPayload {
  originalRowIndex: number;
  columnIndex: number;
  value: string;
}

// ─── Messages: Extension → Webview ──────────────────────────────────────────

export type ExtensionMessage =
  | { type: 'dataPage'; data: DataPagePayload }
  | { type: 'columnValues'; data: ColumnValuesPayload }
  | { type: 'cellEditConfirm'; data: CellEditConfirmPayload }
  | { type: 'error'; message: string }
  | { type: 'loading'; loading: boolean };

// ─── Messages: Webview → Extension ──────────────────────────────────────────

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'loadMore' }
  | { type: 'sort'; columnIndex: number; direction: SortDirection }
  | { type: 'search'; term: string }
  | { type: 'getColumnValues'; columnIndex: number }
  | { type: 'setFilters'; filters: ColumnFilters }
  | { type: 'editCell'; originalRowIndex: number; columnIndex: number; value: string }
  | { type: 'addRow' }
  | { type: 'deleteRow'; originalRowIndex: number }
  | { type: 'copyToClipboard'; text: string }
  | { type: 'openAsText' };
