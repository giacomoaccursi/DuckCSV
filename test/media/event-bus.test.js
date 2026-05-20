/**
 * Tests for event-bus module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { on, off, emit, clear } from '../../media/src/event-bus.js';

describe('Event Bus', () => {
  beforeEach(() => {
    clear();
  });

  it('calls handler when event is emitted', () => {
    const calls = [];
    on('test', (data) => calls.push(data));
    emit('test', 'hello');
    expect(calls).toEqual(['hello']);
  });

  it('supports multiple handlers for same event', () => {
    const calls = [];
    on('test', () => calls.push('a'));
    on('test', () => calls.push('b'));
    emit('test');
    expect(calls).toEqual(['a', 'b']);
  });

  it('does not call handler for different event', () => {
    const calls = [];
    on('foo', () => calls.push('foo'));
    emit('bar');
    expect(calls).toEqual([]);
  });

  it('off removes a specific handler', () => {
    const calls = [];
    const handler = () => calls.push('x');
    on('test', handler);
    off('test', handler);
    emit('test');
    expect(calls).toEqual([]);
  });

  it('on returns unsubscribe function', () => {
    const calls = [];
    const unsub = on('test', () => calls.push('x'));
    unsub();
    emit('test');
    expect(calls).toEqual([]);
  });

  it('clear removes all listeners', () => {
    const calls = [];
    on('a', () => calls.push('a'));
    on('b', () => calls.push('b'));
    clear();
    emit('a');
    emit('b');
    expect(calls).toEqual([]);
  });

  it('emitting non-existent event does nothing', () => {
    expect(() => emit('nonexistent', 'data')).not.toThrow();
  });

  it('handler receives data object', () => {
    const calls = [];
    on('test', (data) => calls.push(data));
    emit('test', { x: 1, y: 2 });
    expect(calls).toEqual([{ x: 1, y: 2 }]);
  });

  it('multiple emits call handler multiple times', () => {
    let count = 0;
    on('test', () => count++);
    emit('test');
    emit('test');
    emit('test');
    expect(count).toBe(3);
  });

  it('off on non-existent event does not throw', () => {
    expect(() => off('nonexistent', () => {})).not.toThrow();
  });
});
