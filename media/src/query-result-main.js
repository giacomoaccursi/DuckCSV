/**
 * CSV Enhanced — Query Result Panel Script
 *
 * Lightweight: rendering, local sorting, selection, copy.
 * No backend communication (data is embedded in the page).
 */

import { escapeHtml, escapeRegex, toggle, formatFileSize } from './utils.js';

(function () {
  'use strict';

  // State is injected by the panel as a global variable
  const data = window.__QUERY_RESULT__;
  if (!data) { return; }

  const state = {
    headers: data.headers,
    rows: [...data.rows],
    sort: { columnIndex: -1, direction: 'none' },
  };

  const dom = {
    tableHeader: document.getElementById('tableHeader'),
    tableBody: document.getElementById('tableBody'),
    stats: document.getElementById('stats'),
  };

  // ─── Rendering ─────────────────────────────────────────────────────────────

  function renderHeader() {
    if (!dom.tableHeader) { return; }
    const tr = document.createElement('tr');

    const numTh = document.createElement('th');
    numTh.className = 'row-number-header';
    numTh.textContent = '#';
    tr.appendChild(numTh);

    state.headers.forEach((header, i) => {
      const th = document.createElement('th');
      th.className = 'sortable-header';
      th.dataset.columnIndex = i;

      const content = document.createElement('div');
      content.className = 'header-content';

      const text = document.createElement('span');
      text.className = 'header-text';
      text.textContent = header;
      content.appendChild(text);

      const sortIndicator = document.createElement('span');
      sortIndicator.className = 'sort-indicator';
      if (state.sort.columnIndex === i) {
        th.classList.add('sort-active');
        sortIndicator.innerHTML = state.sort.direction === 'asc'
          ? '<span class="sort-arrow active">\u25B2</span><span class="sort-arrow dim">\u25BC</span>'
          : '<span class="sort-arrow dim">\u25B2</span><span class="sort-arrow active">\u25BC</span>';
      } else {
        sortIndicator.innerHTML = '<span class="sort-arrow dim">\u25B2</span><span class="sort-arrow dim">\u25BC</span>';
      }
      content.appendChild(sortIndicator);
      th.appendChild(content);
      tr.appendChild(th);
    });

    dom.tableHeader.innerHTML = '';
    dom.tableHeader.appendChild(tr);
  }

  function renderRows() {
    if (!dom.tableBody) { return; }
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < state.rows.length; i++) {
      const tr = document.createElement('tr');
      tr.dataset.rowIndex = i;

      const numTd = document.createElement('td');
      numTd.className = 'row-number';
      numTd.textContent = i + 1;
      tr.appendChild(numTd);

      state.rows[i].forEach((cell, colIdx) => {
        const td = document.createElement('td');
        td.className = 'editable-cell';
        td.textContent = cell || '';
        td.title = cell || '';
        td.dataset.columnIndex = colIdx;
        td.dataset.fullText = cell || '';
        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    }

    dom.tableBody.innerHTML = '';
    dom.tableBody.appendChild(fragment);
  }

  // ─── Local Sort ────────────────────────────────────────────────────────────

  function sortColumn(colIdx) {
    let newDir = 'asc';
    if (state.sort.columnIndex === colIdx) {
      if (state.sort.direction === 'asc') { newDir = 'desc'; }
      else if (state.sort.direction === 'desc') { newDir = 'none'; }
    }

    state.sort = { columnIndex: colIdx, direction: newDir };

    if (newDir === 'none') {
      state.rows = [...data.rows]; // reset to original order
    } else {
      const dir = newDir === 'asc' ? 1 : -1;
      const isNum = detectNumeric(state.rows, colIdx);

      state.rows.sort((a, b) => {
        const va = a[colIdx] || '';
        const vb = b[colIdx] || '';
        if (va === vb) { return 0; }
        if (va === '') { return 1; }
        if (vb === '') { return -1; }

        let cmp;
        if (isNum) {
          cmp = parseFloat(va.replace(/[,\s]/g, '')) - parseFloat(vb.replace(/[,\s]/g, ''));
        } else {
          cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
        }
        return cmp * dir;
      });
    }

    renderHeader();
    renderRows();
  }

  function detectNumeric(rows, colIdx) {
    const sample = Math.min(rows.length, 100);
    let num = 0, nonEmpty = 0;
    for (let i = 0; i < sample; i++) {
      const v = (rows[i][colIdx] || '').replace(/[,\s]/g, '');
      if (!v) { continue; }
      nonEmpty++;
      if (!isNaN(Number(v)) && isFinite(Number(v))) { num++; }
    }
    return nonEmpty > 0 && (num / nonEmpty) > 0.9;
  }

  // ─── Selection & Copy ──────────────────────────────────────────────────────

  let selection = null;

  function selectAll() {
    selection = { startRow: 0, startCol: 0, endRow: state.rows.length - 1, endCol: state.headers.length - 1 };
    applyHighlights();
  }

  function handleCellClick(e) {
    const td = e.target.closest('td.editable-cell');
    if (!td) { return; }
    const row = parseInt(td.closest('tr').dataset.rowIndex, 10);
    const col = parseInt(td.dataset.columnIndex, 10);
    if (isNaN(row) || isNaN(col)) { return; }

    if (e.shiftKey && selection) {
      selection.endRow = row;
      selection.endCol = col;
    } else {
      selection = { startRow: row, startCol: col, endRow: row, endCol: col };
    }
    applyHighlights();
  }

  function handleRowClick(e) {
    const td = e.target.closest('td.row-number');
    if (!td) { return; }
    const row = parseInt(td.closest('tr').dataset.rowIndex, 10);
    if (isNaN(row)) { return; }
    selection = { startRow: row, startCol: 0, endRow: row, endCol: state.headers.length - 1 };
    applyHighlights();
  }

  function handleCopy(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'c' || !selection) { return; }
    e.preventDefault();

    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);

    const lines = [];
    // Header
    const hCells = [];
    for (let c = minC; c <= maxC; c++) { hCells.push(state.headers[c] || ''); }
    lines.push(hCells.join('\t'));
    // Data
    for (let r = minR; r <= maxR; r++) {
      const cells = [];
      for (let c = minC; c <= maxC; c++) { cells.push(state.rows[r][c] || ''); }
      lines.push(cells.join('\t'));
    }

    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
  }

  function applyHighlights() {
    dom.tableBody.querySelectorAll('td.selected').forEach(td => td.classList.remove('selected'));
    if (!selection) { return; }

    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);

    dom.tableBody.querySelectorAll('tr').forEach(tr => {
      const rowIdx = parseInt(tr.dataset.rowIndex, 10);
      if (isNaN(rowIdx) || rowIdx < minR || rowIdx > maxR) { return; }
      tr.querySelectorAll('td.editable-cell').forEach(td => {
        const colIdx = parseInt(td.dataset.columnIndex, 10);
        if (colIdx >= minC && colIdx <= maxC) { td.classList.add('selected'); }
      });
    });
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  if (dom.tableHeader) {
    dom.tableHeader.addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable-header');
      if (!th) {
        // # header → select all
        if (e.target.closest('.row-number-header')) { selectAll(); }
        return;
      }
      const colIdx = parseInt(th.dataset.columnIndex, 10);
      if (!isNaN(colIdx)) { sortColumn(colIdx); }
    });
  }

  document.addEventListener('mousedown', (e) => {
    const rowNum = e.target.closest('td.row-number');
    if (rowNum) { handleRowClick(e); return; }
    const td = e.target.closest('td.editable-cell');
    if (td) { handleCellClick(e); }
  });

  document.addEventListener('keydown', handleCopy);

  // Context menu copy
  document.addEventListener('contextmenu', (e) => {
    const td = e.target.closest('td.editable-cell');
    if (!td) { return; }
    e.preventDefault();
    const text = td.dataset.fullText || td.textContent;
    navigator.clipboard.writeText(text).catch(() => {});
  });

  // ─── Init ──────────────────────────────────────────────────────────────────

  renderHeader();
  renderRows();

  if (dom.stats) {
    dom.stats.textContent = `${data.rowCount} rows \u2022 ${data.executionTimeMs.toFixed(1)}ms`;
  }
})();
