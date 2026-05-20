/**
 * Tests for IRowDataSource validation.
 */

import { describe, it, expect } from 'vitest';
import { isRowDataSource } from '../../media/src/data/row-data-source.js';

describe('isRowDataSource', () => {
  it('returns true for valid implementation', () => {
    const valid = {
      getRow: () => null,
      getRowid: () => -1,
      getTotalRows: () => 0,
      isLoaded: () => false,
    };
    expect(isRowDataSource(valid)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isRowDataSource(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isRowDataSource(undefined)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isRowDataSource({})).toBe(false);
  });

  it('returns false if getRow is missing', () => {
    expect(isRowDataSource({
      getRowid: () => -1,
      getTotalRows: () => 0,
      isLoaded: () => false,
    })).toBe(false);
  });

  it('returns false if getRowid is missing', () => {
    expect(isRowDataSource({
      getRow: () => null,
      getTotalRows: () => 0,
      isLoaded: () => false,
    })).toBe(false);
  });

  it('returns false if getTotalRows is missing', () => {
    expect(isRowDataSource({
      getRow: () => null,
      getRowid: () => -1,
      isLoaded: () => false,
    })).toBe(false);
  });

  it('returns false if isLoaded is missing', () => {
    expect(isRowDataSource({
      getRow: () => null,
      getRowid: () => -1,
      getTotalRows: () => 0,
    })).toBe(false);
  });

  it('returns false if methods are not functions', () => {
    expect(isRowDataSource({
      getRow: 'not a function',
      getRowid: () => -1,
      getTotalRows: () => 0,
      isLoaded: () => false,
    })).toBe(false);
  });

  it('returns true even with extra properties', () => {
    const extended = {
      getRow: () => null,
      getRowid: () => -1,
      getTotalRows: () => 0,
      isLoaded: () => false,
      prefetch: () => {},
      invalidate: () => {},
      destroy: () => {},
    };
    expect(isRowDataSource(extended)).toBe(true);
  });
});
