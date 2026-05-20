/**
 * Verifies that frontend and backend constants stay in sync.
 */

import { describe, it, expect } from 'vitest';
import { BLOCK_SIZE, MAX_BLOCKS, PREFETCH_THRESHOLD } from '../../src/shared/constants';

// Import frontend constants (plain JS, works with vitest)
import { BLOCK_SIZE as FE_BLOCK_SIZE, MAX_BLOCKS as FE_MAX_BLOCKS, PREFETCH_THRESHOLD as FE_PREFETCH_THRESHOLD } from '../../media/src/constants.js';

describe('Constants sync (backend ↔ frontend)', () => {
  it('BLOCK_SIZE matches', () => {
    expect(BLOCK_SIZE).toBe(FE_BLOCK_SIZE);
  });

  it('MAX_BLOCKS matches', () => {
    expect(MAX_BLOCKS).toBe(FE_MAX_BLOCKS);
  });

  it('PREFETCH_THRESHOLD matches', () => {
    expect(PREFETCH_THRESHOLD).toBe(FE_PREFETCH_THRESHOLD);
  });
});
