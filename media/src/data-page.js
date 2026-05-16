/**
 * Shared data page handling — applies incoming data to state and triggers render.
 * Used by both main.js (preview) and workspace-main.js.
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { renderHeader, renderRows } from './renderer.js';
import { updateStats, showTable } from './ui.js';
import { resetQueryState } from './query.js';
import { clearSortingLock } from './shared-bindings.js';

/**
 * @param {object} data - DataPagePayload from the extension
 * @param {object} options
 * @param {boolean} [options.setOriginalHeaders=false] - set state.originalHeaders from data.headers
 * @param {boolean} [options.trackDirty=true] - use data.isDirty (preview) or force false (workspace)
 */
export function applyDataPage(data, { setOriginalHeaders = false, trackDirty = true } = {}) {
  resetQueryState();
  clearSortingLock();

  state.headers = data.headers;
  if (setOriginalHeaders) {
    state.originalHeaders = data.headers;
  }
  state.columnTypes = data.columnTypes || [];
  state.rows = data.rows;
  state.rowids = data.rowids || [];
  state.totalRows = data.totalRows;
  state.filteredRows = data.filteredRows;
  state.delimiter = data.delimiter;
  state.fileName = data.fileName;
  state.fileSize = data.fileSize;
  state.sort = data.sort;
  state.filters = data.filters;
  state.searchTerm = data.searchTerm;
  state.isDirty = trackDirty ? data.isDirty : false;

  if (dom.searchInput && document.activeElement !== dom.searchInput) {
    dom.searchInput.value = data.searchTerm;
  }

  renderHeader();
  updateStats();
  showTable();
  renderRows();
}
