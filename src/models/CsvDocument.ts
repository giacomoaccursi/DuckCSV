/**
 * CsvDocument — In-memory representation of a parsed CSV file.
 *
 * All data operations (filter, sort, search, pagination, editing) happen here.
 * The webview never touches raw data directly.
 */

import { SortState, SortDirection, ColumnFilters } from '../types';

export interface PageResult {
  rows: string[][];
  originalIndices: number[];
}

export class CsvDocument {
  readonly headers: string[];
  readonly fileName: string;
  readonly fileSize: number;
  /** Human-readable delimiter name (e.g. "Comma") */
  readonly delimiterName: string;
  /** Raw delimiter character used for serialization */
  readonly delimiterChar: string;

  private data: string[][];
  private readonly totalRows: number;
  private dirty: boolean = false;

  // ─── Query State ─────────────────────────────────────────────────────────

  private sort: SortState = { columnIndex: -1, direction: 'none' };
  private filters: ColumnFilters = {};
  private searchTerm: string = '';

  // ─── Cached Results ──────────────────────────────────────────────────────

  private resultIndices: number[] | null = null;
  private uniqueValuesCache = new Map<number, string[]>();

  constructor(params: {
    headers: string[];
    data: string[][];
    fileName: string;
    fileSize: number;
    delimiterName: string;
    delimiterChar: string;
  }) {
    this.headers = params.headers;
    this.data = params.data;
    this.totalRows = params.data.length;
    this.fileName = params.fileName;
    this.fileSize = params.fileSize;
    this.delimiterName = params.delimiterName;
    this.delimiterChar = params.delimiterChar;
  }

  // ─── Public Getters ──────────────────────────────────────────────────────

  getTotalRows(): number {
    return this.totalRows;
  }

  getFilteredRowCount(): number {
    return this.getResultIndices().length;
  }

  getSortState(): SortState {
    return { ...this.sort };
  }

  getFilters(): ColumnFilters {
    return { ...this.filters };
  }

  getSearchTerm(): string {
    return this.searchTerm;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  // ─── Pagination ──────────────────────────────────────────────────────────

  /**
   * Get a page of rows with their original indices.
   */
  getPage(offset: number, limit: number): PageResult {
    const indices = this.getResultIndices();
    const pageIndices = indices.slice(offset, offset + limit);
    return {
      rows: pageIndices.map(i => this.data[i]),
      originalIndices: pageIndices,
    };
  }

  // ─── Unique Values ───────────────────────────────────────────────────────

  /**
   * Get all unique values for a column (from the full dataset, not filtered).
   */
  getUniqueValues(columnIndex: number): string[] {
    const cached = this.uniqueValuesCache.get(columnIndex);
    if (cached) {
      return cached;
    }

    const valueSet = new Set<string>();
    for (let i = 0; i < this.data.length; i++) {
      const val = this.data[i][columnIndex];
      if (val !== undefined && val !== '') {
        valueSet.add(val);
      }
    }

    const sorted = Array.from(valueSet).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    this.uniqueValuesCache.set(columnIndex, sorted);
    return sorted;
  }

  // ─── Cell Editing ────────────────────────────────────────────────────────

  /**
   * Update a single cell value. Invalidates relevant caches.
   */
  setCellValue(originalRowIndex: number, columnIndex: number, value: string): void {
    if (originalRowIndex < 0 || originalRowIndex >= this.data.length) {
      return;
    }
    if (columnIndex < 0 || columnIndex >= this.headers.length) {
      return;
    }

    this.data[originalRowIndex][columnIndex] = value;
    this.dirty = true;

    // Invalidate caches affected by this change
    this.uniqueValuesCache.delete(columnIndex);
    this.invalidateResults();
  }

  /**
   * Serialize the document back to CSV string for writing to disk.
   */
  serialize(): string {
    const delimiter = this.delimiterChar;
    const lines: string[] = [];

    // Header
    lines.push(this.headers.map(h => this.quoteField(h, delimiter)).join(delimiter));

    // Data rows
    for (const row of this.data) {
      lines.push(row.map(cell => this.quoteField(cell ?? '', delimiter)).join(delimiter));
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Mark the document as saved (no longer dirty).
   */
  markClean(): void {
    this.dirty = false;
  }

  // ─── Query Mutators ──────────────────────────────────────────────────────

  setSort(columnIndex: number, direction: SortDirection): void {
    this.sort = { columnIndex, direction };
    this.invalidateResults();
  }

  setFilters(filters: ColumnFilters): void {
    this.filters = filters;
    this.invalidateResults();
  }

  setSearchTerm(term: string): void {
    this.searchTerm = term;
    this.invalidateResults();
  }

  resetQueryState(): void {
    this.sort = { columnIndex: -1, direction: 'none' };
    this.filters = {};
    this.searchTerm = '';
    this.invalidateResults();
  }

  // ─── Internal: Result Computation ────────────────────────────────────────

  private invalidateResults(): void {
    this.resultIndices = null;
  }

  private getResultIndices(): number[] {
    if (this.resultIndices !== null) {
      return this.resultIndices;
    }

    let indices = this.applyFilters();
    indices = this.applySearch(indices);
    indices = this.applySort(indices);

    this.resultIndices = indices;
    return indices;
  }

  private applyFilters(): number[] {
    const activeFilters = Object.entries(this.filters)
      .filter(([_, values]) => values.length > 0)
      .map(([col, values]) => ({
        columnIndex: parseInt(col, 10),
        valueSet: new Set(values),
      }));

    if (activeFilters.length === 0) {
      return Array.from({ length: this.totalRows }, (_, i) => i);
    }

    const result: number[] = [];
    for (let i = 0; i < this.totalRows; i++) {
      const row = this.data[i];
      const passes = activeFilters.every(f => f.valueSet.has(row[f.columnIndex] ?? ''));
      if (passes) {
        result.push(i);
      }
    }
    return result;
  }

  private applySearch(indices: number[]): number[] {
    if (!this.searchTerm) {
      return indices;
    }

    const lower = this.searchTerm.toLowerCase();
    return indices.filter(i => {
      const row = this.data[i];
      return row.some(cell => cell && cell.toLowerCase().includes(lower));
    });
  }

  private applySort(indices: number[]): number[] {
    if (this.sort.direction === 'none' || this.sort.columnIndex < 0) {
      return indices;
    }

    const colIdx = this.sort.columnIndex;
    const direction = this.sort.direction === 'asc' ? 1 : -1;
    const isNumeric = this.detectNumericColumn(colIdx);

    const sorted = [...indices];
    sorted.sort((a, b) => {
      const valA = this.data[a][colIdx] ?? '';
      const valB = this.data[b][colIdx] ?? '';

      if (valA === valB) { return 0; }
      if (valA === '') { return 1; }
      if (valB === '') { return -1; }

      let comparison: number;
      if (isNumeric) {
        comparison = this.parseNumber(valA) - this.parseNumber(valB);
      } else {
        comparison = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      }

      return comparison * direction;
    });

    return sorted;
  }

  // ─── Internal: Helpers ───────────────────────────────────────────────────

  private detectNumericColumn(colIdx: number): boolean {
    const sampleSize = Math.min(this.totalRows, 200);
    let numericCount = 0;
    let nonEmptyCount = 0;

    for (let i = 0; i < sampleSize; i++) {
      const val = this.data[i][colIdx];
      if (!val || val.trim() === '') { continue; }
      nonEmptyCount++;
      if (this.isNumeric(val)) { numericCount++; }
    }

    return nonEmptyCount > 0 && (numericCount / nonEmptyCount) > 0.9;
  }

  private isNumeric(val: string): boolean {
    const cleaned = val.replace(/[,\s]/g, '');
    const num = Number(cleaned);
    return cleaned !== '' && !isNaN(num) && isFinite(num);
  }

  private parseNumber(val: string): number {
    return Number(val.replace(/[,\s]/g, '')) || 0;
  }

  /**
   * Quote a field if it contains the delimiter, quotes, or newlines.
   */
  private quoteField(field: string, delimiter: string): string {
    if (field.includes(delimiter) || field.includes('"') || field.includes('\n') || field.includes('\r')) {
      return '"' + field.replace(/"/g, '""') + '"';
    }
    return field;
  }
}
