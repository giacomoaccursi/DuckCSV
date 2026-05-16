/**
 * Shared data page handling — applies incoming data to state and triggers render.
 * Manages the DataWindow for lazy-loaded row access.
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { renderHeader, renderRows } from './renderer.js';
import { updateStats, showTable } from './ui.js';
import { resetQueryState } from './query.js';
import { clearSortingLock } from './shared-bindings.js';
import { createDataWindow } from './data-window.js';
import { sendMessage } from './messaging.js';

let dataWindow = null;

export function getDataWindow() { return dataWindow; }

/**
 * Handle incoming pageData (lazy-loaded block from backend).
 */
export function onPageDataReceived(data) {
  if (!dataWindow) { return; }
  dataWindow.receiveBlock(data.offset, data.rows, data.rowids);
}

/**
 * @param {object} data - DataPagePayload from the extension
 * @param {object} options
 * @param {boolean} [options.setOriginalHeaders=false]
 * @param {boolean} [options.trackDirty=true]
 */
export function applyDataPage(data, { setOriginalHeaders = false, trackDirty = true } = {}) {
  resetQueryState();
  clearSortingLock();

  state.headers = data.headers;
  if (setOriginalHeaders) {
    state.originalHeaders = data.headers;
  }
  state.columnTypes = data.columnTypes || [];
  state.totalRows = data.totalRows;
  state.filteredRows = data.filteredRows;
  state.delimiter = data.delimiter;
  state.fileName = data.fileName;
  state.fileSize = data.fileSize;
  state.sort = data.sort;
  state.filters = data.filters;
  state.searchTerm = data.searchTerm;
  state.isDirty = trackDirty ? data.isDirty : false;

  // Initialize or reset the DataWindow
  if (dataWindow) { dataWindow.destroy(); }

  dataWindow = createDataWindow({
    totalRows: data.filteredRows,
    blockSize: 500,
    maxBlocks: 20,
    prefetchThreshold: 100,
    fetchBlock: (offset, limit) => {
      sendMessage({ type: 'fetchPage', requestId: Date.now(), offset, limit });
    },
    onDataReady: () => {
      // Refresh visible rows when new data arrives
      renderRows();
    },
  });

  // Seed with the initial rows from the dataPage
  if (data.rows && data.rows.length > 0) {
    dataWindow.seedInitialData(data.rows, data.rowids || [], 0);
  }

  // Store rows/rowids reference for backward compatibility (selection copy, etc.)
  state.rows = data.rows || [];
  state.rowids = data.rowids || [];

  if (dom.searchInput && document.activeElement !== dom.searchInput) {
    dom.searchInput.value = data.searchTerm;
  }

  renderHeader();
  updateStats();
  showTable();
  renderRows();
}
