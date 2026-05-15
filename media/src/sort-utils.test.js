import { describe, it, expect } from 'vitest';
import { detectNumeric, sortRows } from './sort-utils.js';

describe('detectNumeric', () => {
  it('returns true for all-numeric column', () => {
    const rows = [['10'], ['20'], ['30'], ['40']];
    expect(detectNumeric(rows, 0)).toBe(true);
  });

  it('returns true for numeric with commas', () => {
    const rows = [['1,000'], ['2,500'], ['3,100']];
    expect(detectNumeric(rows, 0)).toBe(true);
  });

  it('returns false for text column', () => {
    const rows = [['alice'], ['bob'], ['charlie']];
    expect(detectNumeric(rows, 0)).toBe(false);
  });

  it('returns true when >90% are numeric (mixed)', () => {
    const rows = Array.from({ length: 95 }, (_, i) => [String(i)]);
    rows.push(['abc'], ['def'], ['ghi'], ['jkl'], ['mno']);
    expect(detectNumeric(rows, 0)).toBe(true);
  });

  it('returns false when <=90% are numeric', () => {
    const rows = Array.from({ length: 80 }, (_, i) => [String(i)]);
    for (let i = 0; i < 20; i++) { rows.push(['text' + i]); }
    expect(detectNumeric(rows, 0)).toBe(false);
  });

  it('ignores empty values', () => {
    const rows = [['10'], [''], ['20'], [''], ['30']];
    expect(detectNumeric(rows, 0)).toBe(true);
  });

  it('handles empty rows', () => {
    expect(detectNumeric([], 0)).toBe(false);
  });

  it('handles all-empty column', () => {
    const rows = [[''], [''], ['']];
    expect(detectNumeric(rows, 0)).toBe(false);
  });

  it('works with multi-column rows', () => {
    const rows = [['alice', '10'], ['bob', '20'], ['charlie', '30']];
    expect(detectNumeric(rows, 0)).toBe(false);
    expect(detectNumeric(rows, 1)).toBe(true);
  });

  it('detects floats as numeric', () => {
    const rows = [['3.14'], ['2.71'], ['1.41']];
    expect(detectNumeric(rows, 0)).toBe(true);
  });

  it('detects negative numbers as numeric', () => {
    const rows = [['-5'], ['-10'], ['15']];
    expect(detectNumeric(rows, 0)).toBe(true);
  });
});

describe('sortRows', () => {
  it('sorts numeric column ascending', () => {
    const rows = [['30'], ['10'], ['20']];
    sortRows(rows, 0, 'asc');
    expect(rows).toEqual([['10'], ['20'], ['30']]);
  });

  it('sorts numeric column descending', () => {
    const rows = [['10'], ['30'], ['20']];
    sortRows(rows, 0, 'desc');
    expect(rows).toEqual([['30'], ['20'], ['10']]);
  });

  it('sorts text column ascending (locale-aware)', () => {
    const rows = [['banana'], ['apple'], ['cherry']];
    sortRows(rows, 0, 'asc');
    expect(rows).toEqual([['apple'], ['banana'], ['cherry']]);
  });

  it('sorts text column descending', () => {
    const rows = [['banana'], ['apple'], ['cherry']];
    sortRows(rows, 0, 'desc');
    expect(rows).toEqual([['cherry'], ['banana'], ['apple']]);
  });

  it('pushes empty values to the end regardless of direction', () => {
    const rows = [[''], ['10'], [''], ['5']];
    sortRows(rows, 0, 'asc');
    expect(rows[0]).toEqual(['5']);
    expect(rows[1]).toEqual(['10']);
    expect(rows[2]).toEqual(['']);
    expect(rows[3]).toEqual(['']);
  });

  it('sorts in place and returns the same array reference', () => {
    const rows = [['b'], ['a']];
    const result = sortRows(rows, 0, 'asc');
    expect(result).toBe(rows);
  });

  it('handles numeric sort with comma-formatted numbers', () => {
    const rows = [['1,000'], ['500'], ['2,500']];
    sortRows(rows, 0, 'asc');
    expect(rows).toEqual([['500'], ['1,000'], ['2,500']]);
  });

  it('handles multi-column rows sorting by specific column', () => {
    const rows = [['alice', '30'], ['bob', '10'], ['charlie', '20']];
    sortRows(rows, 1, 'asc');
    expect(rows).toEqual([['bob', '10'], ['charlie', '20'], ['alice', '30']]);
  });

  it('handles single row', () => {
    const rows = [['42']];
    sortRows(rows, 0, 'asc');
    expect(rows).toEqual([['42']]);
  });

  it('handles empty array', () => {
    const rows = [];
    sortRows(rows, 0, 'asc');
    expect(rows).toEqual([]);
  });
});
