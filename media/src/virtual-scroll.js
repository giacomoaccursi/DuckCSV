/**
 * Virtual Scroller — renders only visible rows + buffer in the DOM.
 *
 * The scroll container (.table-wrapper) contains a <table> with:
 * - <thead> (sticky header, always visible)
 * - <tbody> with spacer-top, real rows, spacer-bottom
 *
 * The total scrollable height = thead height + totalItems * itemHeight.
 * We compute which rows are visible based on scrollTop minus the thead offset.
 */

const DEFAULT_ROW_HEIGHT = 33;
const DEFAULT_BUFFER_SIZE = 20;

export function createVirtualScroller(options) {
  const {
    scrollContainer,
    tbody,
    totalItems: initialTotal,
    itemHeight = DEFAULT_ROW_HEIGHT,
    bufferSize = DEFAULT_BUFFER_SIZE,
    columnCount,
    renderItem,
    recycleItem,
  } = options;

  let totalItems = initialTotal;
  let currentStart = -1;
  let currentEnd = -1;
  let lockedRow = -1;

  // Create spacer elements
  const spacerTop = document.createElement('tr');
  spacerTop.className = 'vs-spacer-top';
  const spacerTopTd = document.createElement('td');
  spacerTopTd.colSpan = columnCount + 1;
  spacerTopTd.style.cssText = 'padding:0;border:none;height:0px;';
  spacerTop.appendChild(spacerTopTd);

  const spacerBottom = document.createElement('tr');
  spacerBottom.className = 'vs-spacer-bottom';
  const spacerBottomTd = document.createElement('td');
  spacerBottomTd.colSpan = columnCount + 1;
  spacerBottomTd.style.cssText = 'padding:0;border:none;height:0px;';
  spacerBottom.appendChild(spacerBottomTd);

  let pool = [];

  function getHeaderHeight() {
    const thead = scrollContainer.querySelector('thead');
    return thead ? thead.offsetHeight : 0;
  }

  function computeRange() {
    const scrollTop = scrollContainer.scrollTop;
    const containerHeight = scrollContainer.clientHeight;
    const headerHeight = getHeaderHeight();

    // How far into the tbody area have we scrolled?
    // The thead is sticky so it doesn't scroll away, but it takes space in the initial layout.
    // scrollTop = 0 means we see the thead + first rows.
    // The tbody starts at scrollTop = 0 visually (thead is sticky overlay).
    // So firstVisible row = scrollTop / itemHeight (the thead doesn't affect row calculation
    // because it's sticky and the spacers control the tbody height).
    const firstVisible = Math.floor(scrollTop / itemHeight);
    const visibleCount = Math.ceil((containerHeight - headerHeight) / itemHeight);

    const start = Math.max(0, firstVisible - bufferSize);
    const end = Math.min(totalItems - 1, firstVisible + visibleCount + bufferSize);
    return { start, end };
  }

  function renderRange(start, end) {
    if (end < start) { return; }
    const neededCount = end - start + 1;

    // Ensure pool has exactly neededCount rows
    while (pool.length < neededCount) {
      pool.push(renderItem(start + pool.length));
    }
    while (pool.length > neededCount) {
      pool.pop();
    }

    // Update every row's content (skip locked row being edited)
    for (let i = 0; i < neededCount; i++) {
      const rowIndex = start + i;
      if (rowIndex === lockedRow) { continue; }
      recycleItem(pool[i], rowIndex);
    }

    // Set spacer heights
    spacerTopTd.style.height = (start * itemHeight) + 'px';
    spacerBottomTd.style.height = (Math.max(0, totalItems - end - 1) * itemHeight) + 'px';

    // Rebuild DOM only if no row is locked (editing)
    // When a row is locked, we only update content in-place (already done above)
    if (lockedRow < 0) {
      tbody.innerHTML = '';
      tbody.appendChild(spacerTop);
      for (let i = 0; i < neededCount; i++) {
        tbody.appendChild(pool[i]);
      }
      tbody.appendChild(spacerBottom);
    } else {
      // Locked row exists — update spacers and ensure all pool rows are in DOM
      // without removing/re-adding (preserves focus on editing input)
      if (spacerTop.parentNode !== tbody) {
        tbody.insertBefore(spacerTop, tbody.firstChild);
      }
      for (let i = 0; i < neededCount; i++) {
        if (pool[i].parentNode !== tbody) {
          tbody.insertBefore(pool[i], spacerBottom);
        }
      }
      if (spacerBottom.parentNode !== tbody) {
        tbody.appendChild(spacerBottom);
      }
    }

    currentStart = start;
    currentEnd = end;
  }

  function onScroll() {
    const { start, end } = computeRange();
    if (start !== currentStart || end !== currentEnd) {
      renderRange(start, end);
    }
  }

  function initialRender() {
    pool = [];
    currentStart = -1;
    currentEnd = -1;
    tbody.innerHTML = '';

    if (totalItems === 0) {
      tbody.appendChild(spacerTop);
      tbody.appendChild(spacerBottom);
      spacerTopTd.style.height = '0px';
      spacerBottomTd.style.height = '0px';
      return;
    }

    const { start, end } = computeRange();
    renderRange(start, end);
  }

  // --- Public API ---

  function update(newTotal) {
    const savedScrollTop = scrollContainer.scrollTop;
    totalItems = newTotal;
    pool = [];
    currentStart = -1;
    currentEnd = -1;
    initialRender();
    // Restore scroll position after data update (insert/delete/sort/filter)
    scrollContainer.scrollTop = savedScrollTop;
    // Trigger a re-render at the restored position
    onScroll();
  }

  function scrollToRow(index) {
    scrollContainer.scrollTop = index * itemHeight;
  }

  function getVisibleRange() {
    return { start: currentStart, end: currentEnd };
  }

  function refresh() {
    currentStart = -1;
    currentEnd = -1;
    onScroll();
  }

  function lockRow(index) { lockedRow = index; }
  function unlockRow() { lockedRow = -1; }

  function destroy() {
    scrollContainer.removeEventListener('scroll', onScroll);
    pool = [];
  }

  // --- Init ---
  scrollContainer.addEventListener('scroll', onScroll, { passive: true });
  initialRender();

  return { update, scrollToRow, getVisibleRange, refresh, lockRow, unlockRow, destroy };
}
