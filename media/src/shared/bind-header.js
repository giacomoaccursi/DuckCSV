/**
 * Header interactions: sort, resize, select all, column select, filter.
 */

import { isSortingActive, setSorting } from '../core/app-state.js';

let sortingTimeout = null;

export function clearSortingLock() {
  setSorting(false);
  if (sortingTimeout) { clearTimeout(sortingTimeout); sortingTimeout = null; }
}

/** Exposed for testing only. */
export function isSortingLocked() { return isSortingActive(); }

/**
 * Bind header interactions: sort, resize, select all, column select.
 * Returns timer controls for external cancellation (e.g. dblclick in preview).
 */
export function bindHeaderInteractions(
  tableHeader,
  { state, sendMessage, initResize, handleSelectAll, handleHeaderClickForSelection, openFilterDropdown }
) {
  let headerClickTimer = null;

  if (!tableHeader) { return { getTimer: () => headerClickTimer, clearTimer: () => { if (headerClickTimer) { clearTimeout(headerClickTimer); headerClickTimer = null; } } }; }

  tableHeader.addEventListener('click', (e) => {
    if (e.target.closest('.filter-btn') || e.target.closest('.resize-handle')) { return; }

    const sortIndicator = e.target.closest('.sort-indicator');
    if (!sortIndicator) { return; }

    if (isSortingActive()) { return; }

    const th = e.target.closest('th.sortable-header');
    if (!th) { return; }

    const colIdx = parseInt(th.dataset.columnIndex, 10);
    if (isNaN(colIdx)) { return; }

    let newDirection = 'asc';
    if (state.sort.columnIndex === colIdx) {
      if (state.sort.direction === 'asc') { newDirection = 'desc'; }
      else if (state.sort.direction === 'desc') { newDirection = 'none'; }
    }

    setSorting(true);
    sortingTimeout = setTimeout(() => { setSorting(false); sortingTimeout = null; }, 10000);
    sendMessage({ type: 'sort', columnIndex: colIdx, direction: newDirection });
  });

  tableHeader.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('resize-handle')) { initResize(e); return; }

    const corner = e.target.closest('.row-number-header');
    if (corner) { handleSelectAll(); return; }

    const selCell = e.target.closest('.column-select-cell');
    if (selCell) {
      const colIdx = parseInt(selCell.dataset.columnIndex, 10);
      if (!isNaN(colIdx)) { handleHeaderClickForSelection(colIdx, e); }
    }
  });

  // Filter button (delegated on document)
  document.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('.filter-btn');
    if (!filterBtn) { return; }
    e.stopPropagation();
    const colIdx = parseInt(filterBtn.dataset.columnIndex, 10);
    if (!isNaN(colIdx) && openFilterDropdown) {
      openFilterDropdown(colIdx, filterBtn);
    }
  });

  return {
    getTimer: () => headerClickTimer,
    clearTimer: () => { if (headerClickTimer) { clearTimeout(headerClickTimer); headerClickTimer = null; } },
  };
}
