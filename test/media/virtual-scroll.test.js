/**
 * Tests for virtual-scroll logic.
 * Uses jsdom to simulate a scroll container.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

// We test the logic by creating a minimal DOM and the scroller
// Since createVirtualScroller needs a real DOM, we set up jsdom

describe('VirtualScroller', () => {
  let document;
  let createVirtualScroller;

  beforeEach(async () => {
    const dom = new JSDOM(`
      <div id="container" style="height:330px;overflow:auto;">
        <table>
          <thead id="header"><tr><th>H</th></tr></thead>
          <tbody id="body"></tbody>
        </table>
      </div>
    `);
    document = dom.window.document;
    global.document = document;
    global.window = dom.window;

    // Dynamic import after setting up globals
    const mod = await import('../../media/src/ui/virtual-scroll.js');
    createVirtualScroller = mod.createVirtualScroller;
  });

  it('creates scroller with correct initial range', () => {
    const container = document.getElementById('container');
    const tbody = document.getElementById('body');
    const rendered = [];

    const scroller = createVirtualScroller({
      scrollContainer: container,
      tbody,
      totalItems: 100,
      itemHeight: 33,
      bufferSize: 5,
      columnCount: 1,
      renderItem: (index) => {
        rendered.push(index);
        const tr = document.createElement('tr');
        tr.dataset.rowIndex = index;
        return tr;
      },
      recycleItem: () => {},
      onRangeChange: () => {},
    });

    const range = scroller.getVisibleRange();
    expect(range.start).toBe(0);
    expect(range.end).toBeGreaterThan(0);
  });

  it('update changes totalItems', () => {
    const container = document.getElementById('container');
    const tbody = document.getElementById('body');

    const scroller = createVirtualScroller({
      scrollContainer: container,
      tbody,
      totalItems: 50,
      itemHeight: 33,
      bufferSize: 5,
      columnCount: 1,
      renderItem: () => document.createElement('tr'),
      recycleItem: () => {},
    });

    scroller.update(200);
    // After update, the scroller should still work
    const range = scroller.getVisibleRange();
    expect(range.start).toBeGreaterThanOrEqual(0);
  });

  it('scrollToRow sets scroll position', () => {
    const container = document.getElementById('container');
    const tbody = document.getElementById('body');

    const scroller = createVirtualScroller({
      scrollContainer: container,
      tbody,
      totalItems: 1000,
      itemHeight: 33,
      bufferSize: 5,
      columnCount: 1,
      renderItem: () => document.createElement('tr'),
      recycleItem: () => {},
    });

    scroller.scrollToRow(50);
    expect(container.scrollTop).toBe(50 * 33);
  });
});
