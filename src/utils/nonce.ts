/**
 * Generate a cryptographically random nonce string for Content Security Policy.
 */

import { randomBytes } from 'crypto';

export function getNonce(): string {
  return randomBytes(16).toString('hex');
}
