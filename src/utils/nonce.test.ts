import { describe, it, expect } from 'vitest';
import { getNonce } from './nonce';

describe('getNonce', () => {
  it('returns a 32-character hex string', () => {
    const nonce = getNonce();
    expect(nonce).toHaveLength(32);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates unique values on each call', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => getNonce()));
    expect(nonces.size).toBe(100);
  });
});
