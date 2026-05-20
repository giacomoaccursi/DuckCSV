/**
 * Column resize via drag on header border.
 */

import { dom } from '../core/dom.js';
import { state } from '../core/state.js';

let resizeState = null;

export function initResize(e) {
  e.preventDefault();
  e.stopPropagation();

  let th = e.target.parentElement;

  // If resize started from letter row, find the corresponding sortable-header below
  if (th.classList.contains('column-select-cell')) {
    const colIdx = th.dataset.columnIndex;
    const headerRow = dom.tableHeader.querySelector('tr:last-child');
    if (headerRow && colIdx !== undefined) {
      th = headerRow.querySelector(`th[data-column-index="${colIdx}"]`) || th;
    }
  }

  const wrapper = document.querySelector('.table-wrapper');

  resizeState = {
    th,
    wrapper,
    startX: e.pageX,
    startWidth: th.offsetWidth,
  };

  document.body.classList.add('resizing');
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
}

function onMove(e) {
  if (!resizeState) { return; }

  const { th, wrapper, startX, startWidth } = resizeState;
  const newWidth = Math.max(40, startWidth + (e.pageX - startX));
  const widthStr = newWidth + 'px';

  // Save scroll position before layout change
  const scrollLeft = wrapper ? wrapper.scrollLeft : 0;

  th.style.width = widthStr;
  th.style.minWidth = widthStr;
  th.style.maxWidth = widthStr;

  const colIdx = th.dataset.columnIndex;
  if (colIdx !== undefined) {
    state.columnWidths[colIdx] = widthStr;

    // Update letter row cell
    const letterCell = dom.tableHeader.querySelector(`.column-select-row th[data-column-index="${colIdx}"]`);
    if (letterCell) {
      letterCell.style.width = widthStr;
      letterCell.style.minWidth = widthStr;
      letterCell.style.maxWidth = widthStr;
    }

    // Update body cells
    const cells = dom.tableBody.querySelectorAll(`td[data-column-index="${colIdx}"]`);
    cells.forEach(td => {
      td.style.width = widthStr;
      td.style.minWidth = widthStr;
      td.style.maxWidth = widthStr;
    });
  }

  // Restore scroll position to prevent visual shift
  if (wrapper) {
    wrapper.scrollLeft = scrollLeft;
  }
}

function onEnd() {
  resizeState = null;
  document.body.classList.remove('resizing');
  document.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseup', onEnd);
}
