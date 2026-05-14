/**
 * Centralized application state.
 */

export const COLUMN_COLORS = [
  'rgba(66, 135, 245, 0.10)',
  'rgba(72, 199, 142, 0.10)',
  'rgba(245, 166, 35, 0.10)',
  'rgba(155, 89, 182, 0.10)',
  'rgba(231, 76, 60, 0.10)',
  'rgba(26, 188, 156, 0.10)',
  'rgba(241, 196, 15, 0.08)',
  'rgba(232, 67, 147, 0.10)',
];

export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING',
  'LIMIT', 'OFFSET', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN',
  'LIKE', 'IS NULL', 'IS NOT NULL', 'AS', 'DISTINCT',
  'ASC', 'DESC', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'UNION',
];

export const state = {
  headers: [],        // current displayed headers (may change with query results)
  originalHeaders: [], // always the file's original headers (for autocomplete)
  columnTypes: [],    // column data types from DuckDB
  rows: [],
  rowids: [],
  totalRows: 0,
  filteredRows: 0,
  hasMore: false,
  delimiter: '',
  fileName: '',
  fileSize: 0,
  sort: { columnIndex: -1, direction: 'none' },
  filters: {},
  searchTerm: '',
  isDirty: false,
  columnValues: null,
  colorColumnsEnabled: false,
  columnWidths: {},
};
