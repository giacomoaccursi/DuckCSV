/**
 * Column resize via drag on header border.
 */

import { dom } from './dom.js';
import { state } from './state.js';

let resizeState = null;

export function initResize(e) {
  e.preventDefault();
  e.stopPropagation();

  const th = e.target.parentElement;
  resizeState = { th, startX: e.pageX, startWidth: th.offsetWidth };
  document.body.classList.add('resizing');

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
}

function onMove(e) {
  if (!resizeState) { return; }

  const newWidth = Math.max(40, resizeState.startWidth + (e.pageX - resizeState.startX));
  const widthStr = newWidth + 'px';

  resizeState.th.style.width = widthStr;
  resizeState.th.style.minWidth = widthStr;
  resizeState.th.style.maxWidth = widthStr;

  const colIdx = resizeState.th.dataset.columnIndex;
  if (colIdx !== undefined) {
    state.columnWidths[colIdx] = widthStr;
    const cells = dom.tableBody.querySelectorAll(`td[data-column-index="${colIdx}"]`);
    cells.forEach(td => {
      td.style.width = widthStr;
      td.style.minWidth = widthStr;
      td.style.maxWidth = widthStr;
    });
  }
}

function onEnd() {
  resizeState = null;
  document.body.classList.remove('resizing');
  document.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseup', onEnd);
}
