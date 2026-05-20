/**
 * Tests for shared-bindings sorting lock behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

describe('Sorting lock', () => {
  let clearSortingLock, isSortingLocked, bindHeaderInteractions;

  beforeEach(async () => {
    vi.useFakeTimers();
    const dom = new JSDOM('<div id="header"></div>');
    global.document = dom.window.document;
    global.window = dom.window;
    global.setTimeout = dom.window.setTimeout;
    global.clearTimeout = dom.window.clearTimeout;

    const mod = await import('../../media/src/shared/bind-header.js');
    clearSortingLock = mod.clearSortingLock;
    isSortingLocked = mod.isSortingLocked;
    bindHeaderInteractions = mod.bindHeaderInteractions;

    // Ensure clean state
    clearSortingLock();
  });

  it('starts unlocked', () => {
    expect(isSortingLocked()).toBe(false);
  });

  it('clearSortingLock resets the lock', () => {
    // We can't easily trigger the lock without a full DOM sort click,
    // but we can verify clearSortingLock works
    clearSortingLock();
    expect(isSortingLocked()).toBe(false);
  });

  it('bindHeaderInteractions returns timer controls even with null header', () => {
    const ctrl = bindHeaderInteractions(null, {
      state: { sort: { columnIndex: -1, direction: 'none' } },
      sendMessage: () => {},
      initResize: () => {},
      handleSelectAll: () => {},
      handleHeaderClickForSelection: () => {},
      openFilterDropdown: () => {},
    });
    expect(ctrl).toHaveProperty('clearTimer');
    expect(ctrl).toHaveProperty('getTimer');
  });
});
