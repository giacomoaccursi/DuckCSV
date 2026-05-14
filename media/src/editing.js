/**
 * Inline cell editing: double-click to edit, Enter/Escape/blur to commit/cancel.
 */

import { state } from './state.js';
import { sendMessage } from './messaging.js';
import { updateStats } from './ui.js';

let editingCell = null;

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

  editingCell = { td, input, rowid, columnIndex, originalValue: currentValue };

  input.addEventListener('keydown', handleKeydown);
  input.addEventListener('blur', handleBlur);
}

export function isEditing() {
  return editingCell !== null;
}

export function onCellEditConfirm() {
  state.isDirty = true;
  updateStats();
}

function handleKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); }
}

function handleBlur() {
  setTimeout(() => { if (editingCell) { commitEdit(); } }, 50);
}

function commitEdit() {
  if (!editingCell) { return; }

  const { td, input, rowid, columnIndex, originalValue } = editingCell;
  const newValue = input.value;

  input.removeEventListener('keydown', handleKeydown);
  input.removeEventListener('blur', handleBlur);
  td.classList.remove('editing');
  editingCell = null;

  td.textContent = newValue;
  td.dataset.fullText = newValue;

  if (newValue !== originalValue) {
    td.classList.add('cell-modified');
    setTimeout(() => td.classList.remove('cell-modified'), 1500);
    sendMessage({ type: 'editCell', rowid, columnIndex, value: newValue });
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
}
