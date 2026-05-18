/**
 * Shared event bindings used by both main.js and workspace-main.js.
 * Reduces duplication of search, query bar, header, and selection wiring.
 */

const DEBOUNCE_MS = 300;
let isSorting = false;

export function clearSortingLock() { isSorting = false; }

/**
 * Bind the search input with debounced messaging.
 */
export function bindSearchInput(searchInput, sendMessage) {
  if (!searchInput) { return; }
  let timeout = null;
  searchInput.addEventListener('input', (e) => {
    if (timeout) { clearTimeout(timeout); }
    timeout = setTimeout(() => {
      sendMessage({ type: 'search', term: e.target.value.trim() });
    }, DEBOUNCE_MS);
  });
}

/**
 * Bind query bar buttons and input (run, side, clear, export, autocomplete).
 * @param {object} ctx - QueryBarContext with all dependencies
 */
export function bindQueryBar(ctx) {
  const { queryInput, queryRunBtn, querySideBtn, queryClearBtn, queryExportBtn,
    sendMessage, isQueryRunning, setQueryRunning, isQueryActive, clearQuery,
    closeAutocomplete, handleAutocompleteKeydown, showAutocomplete, addToHistory } = ctx;
  if (queryRunBtn) {
    queryRunBtn.addEventListener('click', () => {
      if (isQueryRunning()) {
        sendMessage({ type: 'cancelQuery' });
        setQueryRunning(false);
        return;
      }
      const sql = queryInput ? queryInput.value.trim() : '';
      if (sql) {
        setQueryRunning(true);
        if (addToHistory) { addToHistory(sql); }
        sendMessage({ type: 'executeQuery', sql, mode: 'inline' });
      }
    });
  }

  if (querySideBtn) {
    querySideBtn.addEventListener('click', () => {
      const sql = queryInput ? queryInput.value.trim() : '';
      if (sql) {
        if (addToHistory) { addToHistory(sql); }
        sendMessage({ type: 'executeQuery', sql, mode: 'side' });
      }
    });
  }

  if (queryClearBtn) { queryClearBtn.addEventListener('click', clearQuery); }

  if (queryExportBtn) {
    queryExportBtn.addEventListener('click', () => {
      if (isQueryActive()) {
        sendMessage({ type: 'exportQueryResult', headers: [], rows: [] });
      }
    });
  }

  if (queryInput) {
    queryInput.addEventListener('keydown', (e) => {
      if (handleAutocompleteKeydown(e)) { return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        closeAutocomplete();
        const sql = queryInput.value.trim();
        if (sql) {
          if (addToHistory) { addToHistory(sql); }
          sendMessage({ type: 'executeQuery', sql, mode: 'side' });
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        closeAutocomplete();
        const sql = queryInput.value.trim();
        if (sql) {
          if (addToHistory) { addToHistory(sql); }
          setQueryRunning(true);
          sendMessage({ type: 'executeQuery', sql, mode: 'inline' });
        }
      } else if (e.key === 'Escape') {
        clearQuery();
      }
    });
    queryInput.addEventListener('input', () => showAutocomplete(queryInput));
    queryInput.addEventListener('blur', () => setTimeout(closeAutocomplete, 150));
    queryInput.addEventListener('focus', () => {
      if (queryInput.value.trim()) { showAutocomplete(queryInput); }
    });
  }
}

/**
 * Bind header interactions: sort (with click timer), resize, select all, column select.
 * Returns the headerClickTimer for external cancellation (e.g. dblclick in preview).
 */
export function bindHeaderInteractions(
  tableHeader,
  { state, sendMessage, initResize, handleSelectAll, handleHeaderClickForSelection, openFilterDropdown }
) {
  let headerClickTimer = null;

  if (!tableHeader) { return { getTimer: () => headerClickTimer, clearTimer: () => { if (headerClickTimer) { clearTimeout(headerClickTimer); headerClickTimer = null; } } }; }

  tableHeader.addEventListener('click', (e) => {
    if (e.target.closest('.filter-btn') || e.target.closest('.resize-handle')) { return; }

    // Sort only when clicking on the sort indicator arrows
    const sortIndicator = e.target.closest('.sort-indicator');
    if (!sortIndicator) { return; }

    if (isSorting) { return; }

    const th = e.target.closest('th.sortable-header');
    if (!th) { return; }

    const colIdx = parseInt(th.dataset.columnIndex, 10);
    if (isNaN(colIdx)) { return; }

    let newDirection = 'asc';
    if (state.sort.columnIndex === colIdx) {
      if (state.sort.direction === 'asc') { newDirection = 'desc'; }
      else if (state.sort.direction === 'desc') { newDirection = 'none'; }
    }

    isSorting = true;
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

/**
 * Bind selection (cell click, row number), copy shortcut, arrow navigation, and tooltip.
 */
export function bindSelectionAndTooltip(
  { handleCellClick, handleRowNumberClick, handleCopyShortcut, handleArrowNavigation, isEditing, showTooltip, hideTooltip, onEnterCell }
) {
  document.addEventListener('mousedown', (e) => {
    const rowNum = e.target.closest('td.row-number');
    if (rowNum) { handleRowNumberClick(e); return; }
    const td = e.target.closest('td.editable-cell');
    if (td && !isEditing()) { handleCellClick(e); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isEditing() && onEnterCell) {
      onEnterCell();
      return;
    }
    handleCopyShortcut(e);
    handleArrowNavigation(e);
  });

  document.addEventListener('mouseover', (e) => {
    if (isEditing()) { return; }
    const cell = e.target.closest('td, th');
    if (cell && cell.scrollWidth > cell.clientWidth && !cell.classList.contains('editing')) {
      showTooltip(cell.dataset.fullText || cell.textContent, e.pageX, e.pageY);
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('td, th')) { hideTooltip(); }
  });
}
