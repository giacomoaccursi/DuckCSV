/**
 * Shared constants — centralizes magic numbers used across the codebase.
 */

/** Number of rows per block for lazy loading (frontend DataWindow + backend first page). */
export const BLOCK_SIZE = 2000;

/** Maximum number of blocks kept in the frontend DataWindow cache. */
export const MAX_BLOCKS = 50;

/** Rows from block edge before triggering a prefetch. */
export const PREFETCH_THRESHOLD = 1000;

/** Number of rows per batch when exporting a table to CSV. */
export const EXPORT_BATCH_SIZE = 50_000;

/** Maximum number of queries stored in history per file. */
export const MAX_QUERY_HISTORY = 50;
