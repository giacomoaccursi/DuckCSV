import { describe, it, expect } from 'vitest';
import { ViewState } from './ViewState';

describe('ViewState', () => {
  it('initializes with default values', () => {
    const vs = new ViewState();
    expect(vs.sort).toEqual({ columnIndex: -1, direction: 'none' });
    expect(vs.filters).toEqual({});
    expect(vs.searchTerm).toBe('');
  });

  describe('applySort', () => {
    it('sets sort state', () => {
      const vs = new ViewState();
      vs.applySort(2, 'asc');
      expect(vs.sort).toEqual({ columnIndex: 2, direction: 'asc' });
    });

    it('overwrites previous sort', () => {
      const vs = new ViewState();
      vs.applySort(1, 'asc');
      vs.applySort(3, 'desc');
      expect(vs.sort).toEqual({ columnIndex: 3, direction: 'desc' });
    });
  });

  describe('applySearch', () => {
    it('sets search term', () => {
      const vs = new ViewState();
      vs.applySearch('hello');
      expect(vs.searchTerm).toBe('hello');
    });

    it('overwrites previous search', () => {
      const vs = new ViewState();
      vs.applySearch('first');
      vs.applySearch('second');
      expect(vs.searchTerm).toBe('second');
    });
  });

  describe('applyFilters', () => {
    it('sets filters', () => {
      const vs = new ViewState();
      const filters = { 0: ['a', 'b'], 2: ['x'] };
      vs.applyFilters(filters);
      expect(vs.filters).toEqual(filters);
    });

    it('replaces previous filters entirely', () => {
      const vs = new ViewState();
      vs.applyFilters({ 0: ['a'] });
      vs.applyFilters({ 1: ['b'] });
      expect(vs.filters).toEqual({ 1: ['b'] });
    });
  });

  describe('reset', () => {
    it('resets all state to defaults', () => {
      const vs = new ViewState();
      vs.applySort(2, 'desc');
      vs.applySearch('test');
      vs.applyFilters({ 0: ['x'] });

      vs.reset();

      expect(vs.sort).toEqual({ columnIndex: -1, direction: 'none' });
      expect(vs.filters).toEqual({});
      expect(vs.searchTerm).toBe('');
    });
  });
});
