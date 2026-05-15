/**
 * Shared type definitions for CSV Table View extension.
 */

// ─── Parse Results ───────────────────────────────────────────────────────────

export interface ParseResult {
  data: string[][];
  headers: string[];
  totalRows: number;
  errors: ParseError[];
}

export interface ParseError {
  type: string;
  code: string;
  message: string;
  row?: number;
}

export interface ParseOptions {
  delimiter?: string;
  maxRows?: number;
  skipEmptyLines?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

// ─── Webview Payloads ────────────────────────────────────────────────────────

export interface CsvPayload {
  headers: string[];
  rows: string[][];
  totalRows: number;
  estimatedTotal: number;
  delimiter: string;
  fileName: string;
  fileSize: number;
  hasMore: boolean;
}

export interface MoreRowsPayload {
  rows: string[][];
  hasMore: boolean;
}

// ─── Messages: Extension → Webview ──────────────────────────────────────────

export type ExtensionMessage =
  | { type: 'csvData'; data: CsvPayload }
  | { type: 'moreRows'; data: MoreRowsPayload }
  | { type: 'error'; message: string };

// ─── Messages: Webview → Extension ──────────────────────────────────────────

export type WebviewMessage =
  | { type: 'refresh' }
  | { type: 'loadMore'; currentRows: number }
  | { type: 'copyToClipboard'; text: string }
  | { type: 'openAsText' };
