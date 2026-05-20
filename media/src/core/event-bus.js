/**
 * Event Bus — lightweight pub/sub for frontend module communication.
 *
 * Decouples modules that currently import each other directly.
 * Usage:
 *   import { emit, on, off } from './event-bus.js';
 *   on('cell:committed', (data) => { ... });
 *   emit('cell:committed', { rowid, col, value });
 */

/** @type {Map<string, Set<function>>} */
const listeners = new Map();

/**
 * Subscribe to an event.
 * @param {string} event
 * @param {function} handler
 * @returns {function} unsubscribe function
 */
export function on(event, handler) {
  if (!listeners.has(event)) { listeners.set(event, new Set()); }
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

/**
 * Unsubscribe from an event.
 * @param {string} event
 * @param {function} handler
 */
export function off(event, handler) {
  const handlers = listeners.get(event);
  if (handlers) { handlers.delete(handler); }
}

/**
 * Emit an event to all subscribers.
 * @param {string} event
 * @param {*} data
 */
export function emit(event, data) {
  const handlers = listeners.get(event);
  if (!handlers) { return; }
  for (const handler of handlers) {
    handler(data);
  }
}

/**
 * Remove all listeners (useful for cleanup/testing).
 */
export function clear() {
  listeners.clear();
}
