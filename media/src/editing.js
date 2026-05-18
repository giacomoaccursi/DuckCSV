/**
 * Inline cell editing: double-click to edit, Enter/Escape/blur to commit/cancel.
 */

import { state } from './state.js';
import { sendMessage } from './messaging.js';
import { updateStats } from './ui.js';
import { getScroller, renderHeader } from './renderer.js';
import { getDataWindow } from './data-page.js';

let editingCell = null;
let afterCommitFn = null;

export function setAfterCommit(fn) { afterCommitFn = fn; }

export function startCellEdit(td) {
  if (editingCell) { commitEdit(); }

  const rowid = parseInt(td.dataset.rowid, 10);
  const columnIndex = parseInt(td.dataset.columnIndex, 10);
  const currentValue = td.dataset.fullText || '';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cell-edit-input';
  input.value = currentValue;

  td.innerHTML = '';
  td.appendChild(input);
  td.classList.add('editing');

  input.focus();
  input.select();

  const rowIndex = parseInt(td.closest('tr').dataset.rowIndex, 10);
  editingCell = { td, input, rowid, columnIndex, originalValue: currentValue, rowIndex };

  // Lock this row so virtual scroller won't recycle it
  const scroller = getScroller();
  if (scroller && !isNaN(rowIndex)) { scroller.lockRow(rowIndex); }

  input.addEventListener('keydown', handleKeydown);
  input.addEventListener('blur', handleBlur);
}

export function isEditing() {
  return editingCell !== null;
}

export function onCellEditConfirm(data) {
  if (!data) { return; }
  // Update the DataWindow cache so scrolling away and back shows the new value
  const dw = getDataWindow();
  if (dw) { dw.updateCell(data.rowid, data.columnIndex, data.value); }

  // Update column types in header if they changed
  if (data.columnTypes && JSON.stringify(data.columnTypes) !== JSON.stringify(state.columnTypes)) {
    state.columnTypes = data.columnTypes;
    renderHeader();
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitEdit(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); }
}

function handleBlur() {
  setTimeout(() => { if (editingCell) { commitEdit(); } }, 50);
}

function commitEdit() {
  if (!editingCell) { return; }

  const { td, input, rowid, columnIndex, originalValue, rowIndex } = editingCell;
  const newValue = input.value;

  input.removeEventListener('keydown', handleKeydown);
  input.removeEventListener('blur', handleBlur);
  td.classList.remove('editing');
  editingCell = null;

  // Unlock the row for virtual scroller
  const scroller = getScroller();
  if (scroller) { scroller.unlockRow(); }

  td.textContent = newValue;
  td.dataset.fullText = newValue;

  if (newValue !== originalValue) {
    // Update DataWindow cache so virtual scroller shows the new value
    const dw = getDataWindow();
    if (dw) { dw.updateCell(rowid, columnIndex, newValue); }

    // Mark dirty immediately (don't wait for backend confirmation)
    state.isDirty = true;
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) { saveBtn.disabled = false; }
    updateStats();

    td.classList.add('cell-modified');
    setTimeout(() => td.classList.remove('cell-modified'), 1500);
    sendMessage({ type: 'editCell', rowid, columnIndex, value: newValue });
  }

  // Notify caller to re-select this cell
  if (afterCommitFn && !isNaN(rowIndex)) {
    afterCommitFn(rowIndex, columnIndex);
  }
}

function cancelEdit() {
  if (!editingCell) { return; }

  const { td, input, originalValue } = editingCell;
  input.removeEventListener('keydown', handleKeydown);
  input.removeEventListener('blur', handleBlur);
  td.classList.remove('editing');
  td.textContent = originalValue;
  editingCell = null;

  const scroller = getScroller();
  if (scroller) { scroller.unlockRow(); }
}
