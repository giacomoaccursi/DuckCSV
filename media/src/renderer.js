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

    const sortIndicator = document.createElement('span');
    sortIndicator.className = 'sort-indicator';
    if (state.sort.columnIndex === i) {
      th.classList.add('sort-active');
      sortIndicator.textContent = state.sort.direction === 'asc' ? ' \u25B2' : ' \u25BC';
    } else {
      sortIndicator.textContent = ' \u21C5';
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

  dom.tableHeader.innerHTML = '';
  dom.tableHeader.appendChild(tr);
}

export function renderRows() {
  if (!dom.tableBody) { return; }

  if (state.rows.length === 0) {
    dom.tableBody.innerHTML = '<tr><td colspan="100" class="empty-message">No data to display</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < state.rows.length; i++) {
    fragment.appendChild(createRow(state.rows[i], i, state.rowids[i]));
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
    const numTd = document.createElement('td');
    numTd.className = 'row-number';
    numTd.textContent = i + 1;
    tr.appendChild(numTd);

    rows[i].forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell || '';
      td.title = cell || '';
      tr.appendChild(td);
    });
    fragment.appendChild(tr);
  }

  dom.tableBody.innerHTML = '';
  dom.tableBody.appendChild(fragment);
}

function createRow(row, displayIndex, rowid) {
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

    if (state.searchTerm && text.toLowerCase().includes(state.searchTerm.toLowerCase())) {
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
