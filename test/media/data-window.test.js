/**
 * Tests for DataWindow — block-based cache with LRU eviction.
 */

import { describe, it, expect, vi } from 'vitest';
import { createDataWindow } from '../../media/src/data-window.js';

describe('DataWindow', () => {
  function makeDW(opts = {}) {
    return createDataWindow({
      totalRows: opts.totalRows ?? 100,
      blockSize: opts.blockSize ?? 10,
      maxBlocks: opts.maxBlocks ?? 3,
      prefetchThreshold: opts.prefetchThreshold ?? 2,
      fetchBlock: opts.fetchBlock ?? vi.fn(),
      onDataReady: opts.onDataReady ?? vi.fn(),
    });
  }

  describe('getRow / getRowid', () => {
    it('returns null for uncached rows', () => {
      const dw = makeDW();
      expect(dw.getRow(0)).toBeNull();
      expect(dw.getRowid(0)).toBe(-1);
    });

    it('returns data after seeding', () => {
      const dw = makeDW();
      dw.seedInitialData([['a', 'b'], ['c', 'd']], [10, 11], 0);
      expect(dw.getRow(0)).toEqual(['a', 'b']);
      expect(dw.getRow(1)).toEqual(['c', 'd']);
      expect(dw.getRowid(0)).toBe(10);
      expect(dw.getRowid(1)).toBe(11);
    });

    it('returns null for out-of-range index', () => {
      const dw = makeDW({ totalRows: 5 });
      expect(dw.getRow(-1)).toBeNull();
      expect(dw.getRow(5)).toBeNull();
      expect(dw.getRowid(5)).toBe(-1);
    });
  });

  describe('receiveBlock', () => {
    it('caches received data', () => {
      const dw = makeDW();
      dw.receiveBlock(0, [['x']], [99]);
      expect(dw.getRow(0)).toEqual(['x']);
      expect(dw.getRowid(0)).toBe(99);
    });

    it('calls onDataReady after receiving', () => {
      const onDataReady = vi.fn();
      const dw = makeDW({ onDataReady });
      dw.receiveBlock(0, [['x']], [0]);
      expect(onDataReady).toHaveBeenCalledOnce();
    });
  });

  describe('prefetch', () => {
    it('requests uncached blocks in range', () => {
      const fetchBlock = vi.fn();
      const dw = makeDW({ fetchBlock, totalRows: 50, blockSize: 10, prefetchThreshold: 5 });
      dw.prefetch(0, 10);
      // Should request blocks 0 and 1 (rows 0-9 and 10-19 with threshold)
      expect(fetchBlock).toHaveBeenCalled();
    });

    it('does not re-request cached blocks', () => {
      const fetchBlock = vi.fn();
      const dw = makeDW({ fetchBlock, totalRows: 50, blockSize: 10 });
      dw.seedInitialData(Array(10).fill(['x']), Array(10).fill(0), 0);
      fetchBlock.mockClear();
      dw.prefetch(0, 5);
      // Block 0 is cached, should not be requested
      const calledOffsets = fetchBlock.mock.calls.map(c => c[0]);
      expect(calledOffsets).not.toContain(0);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest block when maxBlocks exceeded', () => {
      const dw = makeDW({ totalRows: 100, blockSize: 10, maxBlocks: 2 });
      dw.receiveBlock(0, Array(10).fill(['a']), Array(10).fill(0));
      dw.receiveBlock(10, Array(10).fill(['b']), Array(10).fill(1));
      dw.receiveBlock(20, Array(10).fill(['c']), Array(10).fill(2));
      // Block 0 should be evicted (oldest)
      expect(dw.getRow(0)).toBeNull();
      expect(dw.getRow(10)).toEqual(['b']);
      expect(dw.getRow(20)).toEqual(['c']);
    });

    it('LRU updates on access', () => {
      const dw = makeDW({ totalRows: 100, blockSize: 10, maxBlocks: 2 });
      dw.receiveBlock(0, Array(10).fill(['a']), Array(10).fill(0));
      dw.receiveBlock(10, Array(10).fill(['b']), Array(10).fill(1));
      // Access block 0 to make it recent
      dw.getRow(0);
      // Add block 2 — should evict block 1 (now oldest)
      dw.receiveBlock(20, Array(10).fill(['c']), Array(10).fill(2));
      expect(dw.getRow(0)).toEqual(['a']); // still cached
      expect(dw.getRow(10)).toBeNull(); // evicted
    });
  });

  describe('updateCell', () => {
    it('updates a cell by rowid', () => {
      const dw = makeDW();
      dw.seedInitialData([['old', 'val']], [42], 0);
      const found = dw.updateCell(42, 0, 'new');
      expect(found).toBe(true);
      expect(dw.getRow(0)).toEqual(['new', 'val']);
    });

    it('returns false if rowid not in cache', () => {
      const dw = makeDW();
      const found = dw.updateCell(999, 0, 'x');
      expect(found).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('clears all cached data', () => {
      const dw = makeDW();
      dw.seedInitialData([['a']], [0], 0);
      dw.invalidate();
      expect(dw.getRow(0)).toBeNull();
    });
  });

  describe('setTotalRows', () => {
    it('updates the total', () => {
      const dw = makeDW({ totalRows: 10 });
      expect(dw.getTotalRows()).toBe(10);
      dw.setTotalRows(20);
      expect(dw.getTotalRows()).toBe(20);
    });
  });
});
