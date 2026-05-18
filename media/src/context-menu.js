/**
 * Context menu builder — returns menu items based on current state.
 * Replaces the 3-branch if/else in main.js with a single function.
 */

import { sendMessage } from './messaging.js';
import { getSelection, getSelectionMode } from './selection.js';
import { getDataWindow } from './data-page.js';

/**
 * Build context menu items for a right-click event.
 * @param {MouseEvent} e
 * @returns {{ items: Array, target: Element|null } | null} — null means don't show menu
 */
export function buildContextMenuItems(e) {
  const isReadonly = !!document.body.dataset.readonly;
  const isQueryActive = !!document.body.dataset.queryActive;

  // Case 1: right-click on a row number
  const rowNum = e.target.closest('td.row-number');
  if (rowNum) {
    const tr = rowNum.closest('tr');
    const rowid = parseInt(tr.dataset.rowid, 10);
    if (isNaN(rowid)) { return null; }

    if (isReadonly || isQueryActive) {
      const cell = tr.querySelector('td.editable-cell');
      return {
        items: [{ label: 'Copy cell', action: () => sendMessage({ type: 'copyToClipboard', text: cell?.dataset.fullText || '' }) }],
      };
    }

    const items = [
      { label: 'Insert row above', action: () => sendMessage({ type: 'addRowAt', rowid, position: 'above' }) },
      { label: 'Insert row below', action: () => sendMessage({ type: 'addRowAt', rowid, position: 'below' }) },
    ];

    const sel = getSelection();
    if (sel && getSelectionMode() === 'row') {
      const minRow = Math.min(sel.startRow, sel.endRow);
      const maxRow = Math.max(sel.startRow, sel.endRow);
      const dw = getDataWindow();
      const rowids = [];
      for (let r = minRow; r <= maxRow; r++) {
        const rid = dw ? dw.getRowid(r) : -1;
        if (rid >= 0) { rowids.push(rid); }
      }
      if (rowids.length > 1) {
        items.push({ label: `Delete ${rowids.length} rows`, action: () => sendMessage({ type: 'deleteRows', rowids }) });
      } else {
        items.push({ label: 'Delete row', action: () => sendMessage({ type: 'deleteRow', rowid }) });
      }
    } else {
      items.push({ label: 'Delete row', action: () => sendMessage({ type: 'deleteRow', rowid }) });
    }

    return { items };
  }

  // Case 2: right-click on a data cell
  const cell = e.target.closest('td.editable-cell');
  if (!cell) { return null; }

  const text = cell.dataset.fullText || cell.textContent;

  if (isReadonly || isQueryActive) {
    return {
      items: [{ label: 'Copy cell', action: () => sendMessage({ type: 'copyToClipboard', text }) }],
    };
  }

  const rowid = parseInt(cell.dataset.rowid, 10);
  return {
    items: [
      { label: 'Copy cell', action: () => sendMessage({ type: 'copyToClipboard', text }) },
      { label: 'Delete row', action: () => sendMessage({ type: 'deleteRow', rowid }) },
    ],
  };
}
