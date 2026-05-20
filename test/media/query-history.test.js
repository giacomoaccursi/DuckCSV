/**
 * Tests for query-history module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sendMessage before importing
vi.mock('../../media/src/core/messaging.js', () => ({
  sendMessage: vi.fn(),
}));

import { initHistory, addToHistory, getHistory } from '../../media/src/query/query-history.js';

describe('QueryHistory', () => {
  beforeEach(() => {
    initHistory([]);
  });

  describe('initHistory', () => {
    it('sets initial history', () => {
      initHistory(['SELECT 1', 'SELECT 2']);
      expect(getHistory()).toEqual(['SELECT 1', 'SELECT 2']);
    });
  });

  describe('addToHistory', () => {
    it('adds query to front', () => {
      addToHistory('SELECT *');
      expect(getHistory()[0]).toBe('SELECT *');
    });

    it('removes duplicates', () => {
      addToHistory('SELECT 1');
      addToHistory('SELECT 2');
      addToHistory('SELECT 1'); // duplicate
      expect(getHistory()).toEqual(['SELECT 1', 'SELECT 2']);
    });

    it('limits to 50 entries', () => {
      for (let i = 0; i < 60; i++) {
        addToHistory(`SELECT ${i}`);
      }
      expect(getHistory().length).toBe(50);
      expect(getHistory()[0]).toBe('SELECT 59');
    });
  });
});
