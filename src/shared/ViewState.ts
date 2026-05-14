/**
 * ViewState — encapsulates view state (sort, filters, search, pagination).
 * Reusable by both single-file and workspace panels.
 */

import { SortState, SortDirection, ColumnFilters } from '../types';

export class ViewState {
  sort: SortState = { columnIndex: -1, direction: 'none' };
  filters: ColumnFilters = {};
  searchTerm: string = '';
  pageOffset: number = 0;

  reset(): void {
    this.sort = { columnIndex: -1, direction: 'none' };
    this.filters = {};
    this.searchTerm = '';
    this.pageOffset = 0;
  }

  applySort(columnIndex: number, direction: SortDirection): void {
    this.sort = { columnIndex, direction };
    this.pageOffset = 0;
  }

  applySearch(term: string): void {
    this.searchTerm = term;
    this.pageOffset = 0;
  }

  applyFilters(filters: ColumnFilters): void {
    this.filters = filters;
    this.pageOffset = 0;
  }

  nextPage(pageSize: number): void {
    this.pageOffset += pageSize;
  }
}
