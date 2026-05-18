/**
 * IRowDataSource — interface for row data access.
 *
 * Defines the contract that DataWindow implements and that renderer,
 * selection, and editing depend on. Allows swapping or mocking the
 * data source without changing consumers.
 *
 * @typedef {object} IRowDataSource
 * @property {function(number): string[]|null} getRow - Get row data by index, or null if not loaded
 * @property {function(number): number} getRowid - Get the rowid for a given index
 * @property {function(): number} getTotalRows - Get total number of rows
 * @property {function(number): boolean} isLoaded - Check if a row index is in cache
 * @property {function(number, number): void} prefetch - Request a range to be loaded
 * @property {function(number): void} setTotalRows - Update total row count
 * @property {function(): void} invalidate - Clear all cached data
 * @property {function(number, number, string): void} updateCell - Update a cell value in cache
 * @property {function(): void} destroy - Cleanup resources
 */

/**
 * Validate that an object implements IRowDataSource.
 * Useful for development-time assertions.
 * @param {object} obj
 * @returns {boolean}
 */
export function isRowDataSource(obj) {
  return obj &&
    typeof obj.getRow === 'function' &&
    typeof obj.getRowid === 'function' &&
    typeof obj.getTotalRows === 'function' &&
    typeof obj.isLoaded === 'function';
}
