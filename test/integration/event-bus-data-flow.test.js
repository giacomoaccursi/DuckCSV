/**
 * Integration tests: Event Bus + DataWindow + Data Page flow
 *
 * Tests that the event-bus correctly connects data-page to renderer-like consumers.
 * Simulates the full data flow: dataPage arrives → event emitted → consumer reacts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('Event Bus + Data Flow Integration', () => {
  let document, on, emit, clear, createDataWindow;

  beforeEach(async () => {
    const dom = new JSDOM('<div id="app"><input id="searchInput" /><div id="tableContainer"></div><div id="tableHeader"></div><div id="tableBody"></div><span id="stats"></span></div>');
    document = dom.window.document;
    global.document = document;
    global.window = dom.window;

    // Clear module cache for fresh imports
    const busMod = await import('../../media/src/event-bus.js');
    on = busMod.on;
    emit = busMod.emit;
    clear = busMod.clear;
    clear();

    const dwMod = await import('../../media/src/data-window.js');
    createDataWindow = dwMod.createDataWindow;
  });

  it('data:pageApplied event is emittable and receivable', () => {
    const calls = [];
    on('data:pageApplied', () => calls.push('rendered'));
    emit('data:pageApplied');
    expect(calls).toEqual(['rendered']);
  });

  it('data:mutated event carries filteredRows', () => {
    const calls = [];
    on('data:mutated', (data) => calls.push(data.filteredRows));
    emit('data:mutated', { filteredRows: 42 });
    expect(calls).toEqual([42]);
  });

  it('data:ready event triggers on DataWindow receiveBlock', () => {
    const calls = [];
    on('data:ready', () => calls.push('ready'));

    // Simulate: DataWindow calls onDataReady when block arrives
    const dw = createDataWindow({
      totalRows: 100,
      blockSize: 10,
      maxBlocks: 5,
      prefetchThreshold: 5,
      fetchBlock: () => {},
      onDataReady: () => emit('data:ready'),
    });

    // Simulate receiving a block
    dw.receiveBlock(0, [['a'], ['b']], [0, 1]);
    expect(calls).toEqual(['ready']);
  });

  it('multiple listeners on same event all fire', () => {
    const calls = [];
    on('data:pageApplied', () => calls.push('A'));
    on('data:pageApplied', () => calls.push('B'));
    on('data:pageApplied', () => calls.push('C'));
    emit('data:pageApplied');
    expect(calls).toEqual(['A', 'B', 'C']);
  });

  it('unsubscribe prevents further calls', () => {
    const calls = [];
    const unsub = on('data:pageApplied', () => calls.push('x'));
    emit('data:pageApplied');
    unsub();
    emit('data:pageApplied');
    expect(calls).toEqual(['x']);
  });

  it('DataWindow prefetch triggers fetchBlock callback', () => {
    const fetched = [];
    const dw = createDataWindow({
      totalRows: 1000,
      blockSize: 100,
      maxBlocks: 5,
      prefetchThreshold: 50,
      fetchBlock: (offset, limit) => fetched.push({ offset, limit }),
      onDataReady: () => {},
    });

    // Seed block 0
    dw.seedInitialData(Array(100).fill(['x']), Array(100).fill(0).map((_, i) => i), 0);

    // Prefetch around row 150 (should request block 1)
    dw.prefetch(100, 200);
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.some(f => f.offset === 100)).toBe(true);
  });

  it('DataWindow getRow returns null for unloaded block and triggers fetch', () => {
    const fetched = [];
    const dw = createDataWindow({
      totalRows: 1000,
      blockSize: 100,
      maxBlocks: 5,
      prefetchThreshold: 50,
      fetchBlock: (offset, limit) => fetched.push({ offset, limit }),
      onDataReady: () => {},
    });

    const row = dw.getRow(500); // block 5, not loaded
    expect(row).toBeNull();
    expect(fetched.some(f => f.offset === 500)).toBe(true);
  });

  it('DataWindow updateCell modifies cached data', () => {
    const dw = createDataWindow({
      totalRows: 10,
      blockSize: 10,
      maxBlocks: 5,
      prefetchThreshold: 5,
      fetchBlock: () => {},
      onDataReady: () => {},
    });

    dw.seedInitialData([['Alice', '30'], ['Bob', '25']], [0, 1], 0);
    dw.updateCell(0, 0, 'Zara');
    expect(dw.getRow(0)).toEqual(['Zara', '30']);
  });

  it('DataWindow invalidate clears all cached data', () => {
    const dw = createDataWindow({
      totalRows: 10,
      blockSize: 10,
      maxBlocks: 5,
      prefetchThreshold: 5,
      fetchBlock: () => {},
      onDataReady: () => {},
    });

    dw.seedInitialData([['Alice']], [0], 0);
    expect(dw.getRow(0)).toEqual(['Alice']);

    dw.invalidate();
    expect(dw.getRow(0)).toBeNull(); // cleared
  });
});
