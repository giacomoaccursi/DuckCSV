/**
 * Table rendering: header and body rows.
 * Uses virtual scrolling — only visible rows + buffer are in the DOM.
 */

import { dom } from './dom.js';
import { state, COLUMN_COLORS } from './state.js';
import { escapeHtml, escapeRegex } from './utils.js';
import { createVirtualScroller } from './virtual-scroll.js';
import { isInSelection } from './selection.js';
import { getDataWindow } from './data-page.js';

let scroller = null;

export function getScroller() { return scroller; }

export function getColumnColor(colIndex) {
  if (!state.colorColumnsEnabled) { return ''; }
  return COLUMN_COLORS[colIndex % COLUMN_COLORS.length];
}

export function renderHeader() {
  if (!dom.tableHeader) { return; }

  dom.tableHeader.innerHTML = '';
  dom.tableHeader.appendChild(createLetterRow());

  const headerRow = createHeaderRow();
  dom.tableHeader.appendChild(headerRow);

  // After browser layout: lock column widths so body rows can't change them
  if (!state.columnWidths || Object.keys(state.columnWidths).length === 0) {
    requestAnimationFrame(() => {
      lockColumnWidths(headerRow);
    });
  }
}

function createLetterRow() {
  const selRow = document.createElement('tr');
  selRow.className = 'column-select-row';

  const selCorner = document.createElement('th');
  selCorner.className = 'row-number-header column-select-corner';
  selRow.appendChild(selCorner);

  state.headers.forEach((_, i) => {
    const selTh = document.createElement('th');
    selTh.className = 'column-select-cell';
    selTh.dataset.columnIndex = i;
    selTh.title = 'Click to select entire column';
    selTh.textContent = columnLetter(i);

    if (state.columnWidths[i]) {
      selTh.style.width = state.columnWidths[i];
      selTh.style.minWidth = state.columnWidths[i];
      selTh.style.maxWidth = state.columnWidths[i];
    }

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    selTh.appendChild(resizeHandle);

    selRow.appendChild(selTh);
  });

  return selRow;
}

function createHeaderRow() {
  const tr = document.createElement('tr');

  const rowNumTh = document.createElement('th');
  rowNumTh.className = 'row-number-header';
  rowNumTh.textContent = '#';
  rowNumTh.title = 'Row Number';
  tr.appendChild(rowNumTh);

  state.headers.forEach((header, i) => {
    const th = document.createElement('th');
    th.className = 'sortable-header';
    th.dataset.columnIndex = i;

    if (state.columnWidths[i]) {
      th.style.width = state.columnWidths[i];
      th.style.minWidth = state.columnWidths[i];
      th.style.maxWidth = state.columnWidths[i];
    }

    const colColor = getColumnColor(i);
    if (colColor) { th.style.backgroundColor = colColor; }

    const content = document.createElement('div');
    content.className = 'header-content';

    const textSpan = document.createElement('span');
    textSpan.className = 'header-text';
    textSpan.textContent = header || `Column ${i + 1}`;
    content.appendChild(textSpan);

    if (state.columnTypes[i]) {
      const typeSpan = document.createElement('span');
      typeSpan.className = 'header-type';
      typeSpan.textContent = state.columnTypes[i];
      content.appendChild(typeSpan);
    }

    const sortIndicator = document.createElement('span');
    sortIndicator.className = 'sort-indicator';
    if (state.sort.columnIndex === i && state.sort.direction !== 'none') {
      th.classList.add('sort-active');
      if (state.sort.direction === 'asc') {
        sortIndicator.innerHTML = '<span class="sort-arrow active">\u25B2</span><span class="sort-arrow dim">\u25BC</span>';
      } else {
        sortIndicator.innerHTML = '<span class="sort-arrow dim">\u25B2</span><span class="sort-arrow active">\u25BC</span>';
      }
    } else {
      sortIndicator.innerHTML = '<span class="sort-arrow dim">\u25B2</span><span class="sort-arrow dim">\u25BC</span>';
    }
    content.appendChild(sortIndicator);
    th.appendChild(content);

    const filterBtn = document.createElement('button');
    filterBtn.className = 'filter-btn';
    filterBtn.dataset.columnIndex = i;
    filterBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16"><path fill="currentColor" d="M1 2h14l-5.5 6.5V14l-3-2V8.5L1 2z"/></svg>';
    if (state.filters[i] && state.filters[i].length > 0) {
      filterBtn.classList.add('filter-active');
    }
    th.appendChild(filterBtn);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    th.appendChild(resizeHandle);

    th.title = (header || `Column ${i + 1}`) + ' (click to sort, funnel to filter)';
    tr.appendChild(th);
  });

  return tr;
}

function lockColumnWidths(headerRow) {
  const ths = headerRow.querySelectorAll('th.sortable-header');
  ths.forEach(th => {
    const w = th.offsetWidth + 'px';
    th.style.width = w;
    th.style.minWidth = w;
    th.style.maxWidth = w;
    const colIdx = th.dataset.columnIndex;
    if (colIdx !== undefined) {
      state.columnWidths[colIdx] = w;
    }
  });
}

export function renderRows() {
  if (!dom.tableBody) { return; }

  const dw = getDataWindow();
  const totalItems = dw ? dw.getTotalRows() : state.filteredRows;

  if (totalItems === 0) {
    if (scroller) { scroller.destroy(); scroller = null; }
    dom.tableBody.innerHTML = '<tr><td colspan="100" class="empty-message">No data to display</td></tr>';
    return;
  }

  const scrollContainer = document.querySelector('.table-wrapper');
  if (!scrollContainer) { return; }

  if (scroller) {
    scroller.update(totalItems);
  } else {
    scroller = createVirtualScroller({
      scrollContainer,
      tbody: dom.tableBody,
      totalItems,
      itemHeight: 33,
      bufferSize: 20,
      columnCount: state.headers.length,
      renderItem: (index) => createRow(index),
      recycleItem: (tr, index) => recycleRow(tr, index),
      onRangeChange: (start, end) => {
        const dw = getDataWindow();
        if (dw) { dw.prefetch(start, end); }
      },
    });

    // After browser layout: lock column widths so body rows can't change them
    if (!state.columnWidths || Object.keys(state.columnWidths).length === 0) {
      requestAnimationFrame(() => {
        const headerRow = dom.tableHeader.querySelector('tr:last-child');
        if (!headerRow) { return; }
        lockColumnWidths(headerRow);
        scroller.refresh();
      });
    }
  }
}

export function renderQueryRows(rows) {
  if (!dom.tableBody) { return; }

  if (scroller) { scroller.destroy(); scroller = null; }

  if (rows.length === 0) {
    dom.tableBody.innerHTML = '<tr><td colspan="100" class="empty-message">No results</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < rows.length; i++) {
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = i;

    const numTd = document.createElement('td');
    numTd.className = 'row-number';
    numTd.textContent = i + 1;
    tr.appendChild(numTd);

    rows[i].forEach((cell, colIndex) => {
      const td = document.createElement('td');
      td.className = 'editable-cell';
      td.textContent = cell || '';
      td.title = cell || '';
      td.dataset.columnIndex = colIndex;
      td.dataset.fullText = cell || '';
      tr.appendChild(td);
    });
    fragment.appendChild(tr);
  }

  dom.tableBody.innerHTML = '';
  dom.tableBody.appendChild(fragment);
}

// ─── Row creation and recycling ──────────────────────────────────────────────

function createRow(index) {
  const dw = getDataWindow();
  const row = dw ? dw.getRow(index) : (state.rows[index] || null);
  const rowid = dw ? dw.getRowid(index) : (state.rowids[index] ?? -1);
  const searchLower = state.searchTerm ? state.searchTerm.toLowerCase() : '';

  const tr = document.createElement('tr');
  tr.dataset.rowIndex = index;
  tr.dataset.rowid = rowid;

  const numTd = document.createElement('td');
  numTd.className = 'row-number';
  numTd.textContent = index + 1;
  tr.appendChild(numTd);

  // If row not loaded yet, show placeholder
  if (!row) {
    const placeholderTd = document.createElement('td');
    placeholderTd.className = 'editable-cell loading-placeholder';
    placeholderTd.colSpan = state.headers.length;
    placeholderTd.textContent = 'Loading...';
    tr.appendChild(placeholderTd);
    return tr;
  }

  row.forEach((cell, colIndex) => {
    const td = document.createElement('td');
    td.className = 'editable-cell';
    const text = cell || '';

    // Apply locked column width
    if (state.columnWidths[colIndex]) {
      td.style.width = state.columnWidths[colIndex];
      td.style.minWidth = state.columnWidths[colIndex];
      td.style.maxWidth = state.columnWidths[colIndex];
    }

    const colColor = getColumnColor(colIndex);
    if (colColor) { td.style.backgroundColor = colColor; }

    if (searchLower && text.toLowerCase().includes(searchLower)) {
      td.innerHTML = highlightMatch(text, state.searchTerm);
    } else {
      td.textContent = text;
    }

    td.title = 'Double-click to edit';
    td.dataset.columnIndex = colIndex;
    td.dataset.rowid = rowid;
    td.dataset.fullText = text;

    if (isInSelection(index, colIndex)) {
      td.classList.add('selected');
    }
    tr.appendChild(td);
  });

  return tr;
}

function recycleRow(tr, index) {
  const dw = getDataWindow();
  const row = dw ? dw.getRow(index) : (state.rows[index] || null);
  const rowid = dw ? dw.getRowid(index) : (state.rowids[index] ?? -1);
  const searchLower = state.searchTerm ? state.searchTerm.toLowerCase() : '';

  tr.dataset.rowIndex = index;
  tr.dataset.rowid = rowid;

  const numTd = tr.children[0];
  numTd.textContent = index + 1;

  // If row not loaded, show placeholder
  if (!row) {
    // Clear existing cells and show placeholder
    while (tr.children.length > 1) { tr.removeChild(tr.lastChild); }
    const placeholderTd = document.createElement('td');
    placeholderTd.className = 'editable-cell loading-placeholder';
    placeholderTd.colSpan = state.headers.length;
    placeholderTd.textContent = 'Loading...';
    tr.appendChild(placeholderTd);
    return;
  }

  // Ensure we have the right number of cells (not a placeholder row)
  if (tr.children.length !== row.length + 1) {
    // Rebuild cells
    while (tr.children.length > 1) { tr.removeChild(tr.lastChild); }
    row.forEach((cell, colIndex) => {
      const td = document.createElement('td');
      td.className = 'editable-cell';
      tr.appendChild(td);
    });
  }

  const cells = tr.children;
  for (let colIndex = 0; colIndex < row.length; colIndex++) {
    const td = cells[colIndex + 1];
    if (!td) { continue; }

    const text = row[colIndex] || '';

    td.classList.remove('selected');
    if (isInSelection(index, colIndex)) {
      td.classList.add('selected');
    }

    if (state.columnWidths[colIndex]) {
      td.style.width = state.columnWidths[colIndex];
      td.style.minWidth = state.columnWidths[colIndex];
      td.style.maxWidth = state.columnWidths[colIndex];
    }

    const colColor = getColumnColor(colIndex);
    td.style.backgroundColor = colColor || '';

    if (searchLower && text.toLowerCase().includes(searchLower)) {
      td.innerHTML = highlightMatch(text, state.searchTerm);
    } else {
      td.textContent = text;
    }

    td.dataset.columnIndex = colIndex;
    td.dataset.rowid = rowid;
    td.dataset.fullText = text;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function highlightMatch(text, term) {
  const escaped = escapeHtml(text);
  const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
  return escaped.replace(regex, '<span class="search-match">$1</span>');
}

function columnLetter(index) {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}
