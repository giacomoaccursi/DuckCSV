/**
 * ViewState — encapsulates view state (sort, filters, search).
 * Reusable by both single-file and workspace panels.
 */

import { SortState, SortDirection, ColumnFilters } from '../types';

export class ViewState {
  sort: SortState = { columnIndex: -1, direction: 'none' };
  filters: ColumnFilters = {};
  searchTerm: string = '';

  reset(): void {
    this.sort = { columnIndex: -1, direction: 'none' };
    this.filters = {};
    this.searchTerm = '';
  }

  applySort(columnIndex: number, direction: SortDirection): void {
    this.sort = { columnIndex, direction };
  }

  applySearch(term: string): void {
    this.searchTerm = term;
  }

  applyFilters(filters: ColumnFilters): void {
    this.filters = filters;
  }
}
