/**
 * Table rendering: header and body rows.
 */

import { dom } from './dom.js';
import { state, COLUMN_COLORS } from './state.js';
import { escapeHtml, escapeRegex } from './utils.js';

export function getColumnColor(colIndex) {
  if (!state.colorColumnsEnabled) { return ''; }
  return COLUMN_COLORS[colIndex % COLUMN_COLORS.length];
}

export function renderHeader() {
  if (!dom.tableHeader) { return; }

  dom.tableHeader.innerHTML = '';

  // Selection row: column letters (A, B, C, ... Z, AA, AB, ...)
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
    selRow.appendChild(selTh);
  });

  dom.tableHeader.appendChild(selRow);

  // Header row: column names, sort, filter, resize
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

    // Content: text + sort indicator
    const content = document.createElement('div');
    content.className = 'header-content';

    const textSpan = document.createElement('span');
    textSpan.className = 'header-text';
    textSpan.textContent = header || `Column ${i + 1}`;
    content.appendChild(textSpan);

    // Column type badge
    if (state.columnTypes[i]) {
      const typeSpan = document.createElement('span');
      typeSpan.className = 'header-type';
      typeSpan.textContent = state.columnTypes[i];
      content.appendChild(typeSpan);
    }

    const sortIndicator = document.createElement('span');
    sortIndicator.className = 'sort-indicator';
    if (state.sort.columnIndex === i) {
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

    // Filter button
    const filterBtn = document.createElement('button');
    filterBtn.className = 'filter-btn';
    filterBtn.title = 'Filter column';
    filterBtn.dataset.columnIndex = i;
    filterBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16"><path fill="currentColor" d="M1 2h14l-5.5 6.5V14l-3-2V8.5L1 2z"/></svg>';
    if (state.filters[i] && state.filters[i].length > 0) {
      filterBtn.classList.add('filter-active');
    }
    th.appendChild(filterBtn);

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    th.appendChild(resizeHandle);

    th.title = (header || `Column ${i + 1}`) + ' (click to sort, funnel to filter)';
    tr.appendChild(th);
  });

  dom.tableHeader.appendChild(tr);
}

export function renderRows() {
  if (!dom.tableBody) { return; }

  if (state.rows.length === 0) {
    dom.tableBody.innerHTML = '<tr><td colspan="100" class="empty-message">No data to display</td></tr>';
    return;
  }

  const searchLower = state.searchTerm ? state.searchTerm.toLowerCase() : '';
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < state.rows.length; i++) {
    fragment.appendChild(createRow(state.rows[i], i, state.rowids[i], searchLower));
  }

  dom.tableBody.innerHTML = '';
  dom.tableBody.appendChild(fragment);
}

export function renderQueryRows(rows) {
  if (!dom.tableBody) { return; }

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

function createRow(row, displayIndex, rowid, searchLower) {
  const tr = document.createElement('tr');
  tr.dataset.rowIndex = displayIndex;
  tr.dataset.rowid = rowid;

  const numTd = document.createElement('td');
  numTd.className = 'row-number';
  numTd.textContent = displayIndex + 1;
  tr.appendChild(numTd);

  row.forEach((cell, colIndex) => {
    const td = document.createElement('td');
    td.className = 'editable-cell';
    const text = cell || '';

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
    tr.appendChild(td);
  });

  return tr;
}

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
