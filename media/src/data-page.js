/**
 * Shared data page handling — applies incoming data to state and triggers render.
 * Manages the DataWindow for lazy-loaded row access.
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { renderHeader, renderRows, getScroller } from './renderer.js';
import { updateStats, showTable } from './ui.js';
import { resetQueryState, setQueryActive } from './query.js';
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
  if (data.isQueryResult) {
    setQueryActive(true);
    document.body.dataset.queryActive = 'true';
  } else {
    delete document.body.dataset.queryActive;
  }
  clearSortingLock();

  state.headers = data.headers;
  if (setOriginalHeaders) {
    state.originalHeaders = data.tableName
      ? [data.tableName, ...data.headers]
      : data.headers;
    state.tableName = data.tableName || '';
  }
  state.columnTypes = data.columnTypes || [];
  state.totalRows = data.totalRows;
  state.filteredRows = data.filteredRows;
  state.delimiter = data.delimiter;
  state.fileName = data.fileName;
  state.fileSize = data.fileSize;

  // Show query label in side panel
  const queryLabel = document.getElementById('queryLabel');
  if (queryLabel) { queryLabel.textContent = data.fileName || ''; }

  // Update query input placeholder with table name
  const queryInput = document.getElementById('queryInput');
  if (queryInput && data.tableName) {
    queryInput.setAttribute('placeholder', `SELECT * FROM ${data.tableName} WHERE ... ORDER BY ... LIMIT 100`);
  }
  state.sort = data.sort;
  state.filters = data.filters;
  state.searchTerm = data.searchTerm;
  state.isDirty = trackDirty ? data.isDirty : false;

  // Enable/disable save button based on dirty state
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) { saveBtn.disabled = !state.isDirty; }

  // Initialize or reset the DataWindow
  if (dataWindow) { dataWindow.destroy(); }

  dataWindow = createDataWindow({
    totalRows: data.filteredRows,
    blockSize: 2000,
    maxBlocks: 50,
    prefetchThreshold: 1000,
    fetchBlock: (offset, limit) => {
      sendMessage({ type: 'fetchPage', requestId: Date.now(), offset, limit });
    },
    onDataReady: () => {
      // Refresh visible rows when new data arrives (without full rebuild)
      const s = getScroller();
      if (s) { s.softRefresh(); }
    },
  });

  // Seed with the initial rows from the dataPage
  if (data.rows && data.rows.length > 0) {
    dataWindow.seedInitialData(data.rows, data.rowids || [], 0);
  }

  if (dom.searchInput && document.activeElement !== dom.searchInput) {
    dom.searchInput.value = data.searchTerm;
  }

  // Preserve focus on query input after query execution
  const qInput = document.getElementById('queryInput');
  const restoreQueryFocus = data.isQueryResult && qInput;

  renderHeader();
  updateStats();
  showTable();
  renderRows();

  if (restoreQueryFocus) { qInput.focus(); }
}
