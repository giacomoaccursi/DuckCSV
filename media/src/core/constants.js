/**
 * Shared constants for the frontend webview.
 * IMPORTANT: Keep in sync with src/shared/constants.ts
 */

/** Number of rows per block for lazy loading. */
export const BLOCK_SIZE = 2000;

/** Maximum number of blocks kept in the DataWindow cache. */
export const MAX_BLOCKS = 50;

/** Rows from block edge before triggering a prefetch. */
export const PREFETCH_THRESHOLD = 1000;
