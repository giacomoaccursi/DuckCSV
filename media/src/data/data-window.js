/**
 * DataWindow — block-based cache for lazy-loaded row data.
 *
 * Divides the dataset into fixed-size blocks. Blocks are fetched on-demand
 * from the backend and evicted (LRU) when the cache exceeds maxBlocks.
 *
 * The virtual scroller reads rows via getRow(index). If the row isn't cached,
 * it returns null (caller shows placeholder) and triggers a fetch.
 */

const DEFAULT_BLOCK_SIZE = 500;
const DEFAULT_MAX_BLOCKS = 20;
const DEFAULT_PREFETCH_THRESHOLD = 100;

/**
 * @param {object} options
 * @param {number} options.totalRows - total rows in the dataset
 * @param {number} [options.blockSize=500] - rows per block
 * @param {number} [options.maxBlocks=20] - max blocks in cache
 * @param {number} [options.prefetchThreshold=100] - rows from block edge to trigger prefetch
 * @param {function(offset: number, limit: number): void} options.fetchBlock - request data from backend
 * @param {function(): void} options.onDataReady - called when new data arrives (to refresh visible rows)
 */
export function createDataWindow(options) {
  const {
    totalRows: initialTotal,
    blockSize = DEFAULT_BLOCK_SIZE,
    maxBlocks = DEFAULT_MAX_BLOCKS,
    prefetchThreshold = DEFAULT_PREFETCH_THRESHOLD,
    fetchBlock,
    onDataReady,
  } = options;

  let totalRows = initialTotal;

  // Cache: Map<blockIndex, { rows: string[][], rowids: number[], lastAccess: number }>
  const cache = new Map();
  // Track in-flight requests to avoid duplicate fetches
  const pending = new Set();
  let accessCounter = 0;

  // ─── Public API ──────────────────────────────────────────────────────────

  function getRow(index) {
    if (index < 0 || index >= totalRows) { return null; }
    const blockIdx = Math.floor(index / blockSize);
    const block = cache.get(blockIdx);
    if (!block) {
      requestBlock(blockIdx);
      return null;
    }
    block.lastAccess = ++accessCounter;
    const localIdx = index - blockIdx * blockSize;
    return block.rows[localIdx] || null;
  }

  function getRowid(index) {
    if (index < 0 || index >= totalRows) { return -1; }
    const blockIdx = Math.floor(index / blockSize);
    const block = cache.get(blockIdx);
    if (!block) { return -1; }
    block.lastAccess = ++accessCounter;
    const localIdx = index - blockIdx * blockSize;
    return block.rowids[localIdx] ?? -1;
  }

  function isLoaded(index) {
    if (index < 0 || index >= totalRows) { return false; }
    const blockIdx = Math.floor(index / blockSize);
    return cache.has(blockIdx);
  }

  function getTotalRows() {
    return totalRows;
  }

  function setTotalRows(n) {
    totalRows = n;
  }

  function invalidate() {
    cache.clear();
    pending.clear();
  }

  /**
   * Pre-fetch blocks that cover the given range.
   * Called by the virtual scroller when the visible range changes.
   */
  function prefetch(start, end) {
    const startBlock = Math.floor(Math.max(0, start - prefetchThreshold) / blockSize);
    const endBlock = Math.floor(Math.min(totalRows - 1, end + prefetchThreshold) / blockSize);

    for (let b = startBlock; b <= endBlock; b++) {
      if (!cache.has(b) && !pending.has(b)) {
        requestBlock(b);
      }
    }
  }

  /**
   * Receive data from backend for a specific offset.
   * Called by the message handler when pageData arrives.
   */
  function receiveBlock(offset, rows, rowids) {
    const blockIdx = Math.floor(offset / blockSize);
    pending.delete(blockIdx);

    cache.set(blockIdx, {
      rows,
      rowids,
      lastAccess: ++accessCounter,
    });

    evictIfNeeded();

    if (onDataReady) { onDataReady(); }
  }

  /**
   * Seed the cache with initial data (from the first dataPage).
   */
  function seedInitialData(rows, rowids, offset = 0) {
    // Split into blocks
    for (let i = 0; i < rows.length; i += blockSize) {
      const blockIdx = Math.floor((offset + i) / blockSize);
      const blockRows = rows.slice(i, i + blockSize);
      const blockRowids = rowids.slice(i, i + blockSize);
      cache.set(blockIdx, {
        rows: blockRows,
        rowids: blockRowids,
        lastAccess: ++accessCounter,
      });
    }
  }

  function destroy() {
    cache.clear();
    pending.clear();
  }

  /**
   * Update a cell value in the cache by rowid.
   * Scans cached blocks to find the row with the given rowid.
   */
  function updateCell(rowid, columnIndex, value) {
    for (const block of cache.values()) {
      const idx = block.rowids.indexOf(rowid);
      if (idx !== -1) {
        if (block.rows[idx]) {
          block.rows[idx][columnIndex] = value;
        }
        return true;
      }
    }
    return false;
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  function requestBlock(blockIdx) {
    if (pending.has(blockIdx)) { return; }
    pending.add(blockIdx);

    const offset = blockIdx * blockSize;
    const limit = Math.min(blockSize, totalRows - offset);
    fetchBlock(offset, limit);
  }

  function evictIfNeeded() {
    while (cache.size > maxBlocks) {
      // Find LRU block
      let oldestKey = null;
      let oldestAccess = Infinity;
      for (const [key, block] of cache) {
        if (block.lastAccess < oldestAccess) {
          oldestAccess = block.lastAccess;
          oldestKey = key;
        }
      }
      if (oldestKey !== null) {
        cache.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  return {
    getRow,
    getRowid,
    isLoaded,
    getTotalRows,
    setTotalRows,
    invalidate,
    prefetch,
    receiveBlock,
    seedInitialData,
    updateCell,
    destroy,
  };
}
