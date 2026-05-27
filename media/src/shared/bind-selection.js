/**
 * Selection and tooltip binding (cell click, row number, copy, arrow nav, tooltip).
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
    // Don't intercept keys when focus is in an input or textarea
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') { return; }

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
