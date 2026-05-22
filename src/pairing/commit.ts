import { sha256Hex, concatStrings } from '../utils/hash.js';

export type Role = 'dialer' | 'answerer';

export interface CommitInput {
  role: Role;
  selfPeerId: string; // XXX-XXX form
  peerPeerId: string; // XXX-XXX form
  fp: string; // canonical fingerprint hex (64 lowercase chars)
  nonce: string; // 32 lowercase hex characters
}

export const COMMIT_DOMAIN = 'peerdrop/commit/v1';

/**
 * Compute the commitment as specified in the plan's "Encoding conventions":
 *   sha256( UTF-8( "peerdrop/commit/v1" || role || selfPeerId || peerPeerId || fp || nonce ) )
 * All fields are UTF-8 byte sequences concatenated without separator.
 * Returns 64 lowercase hex characters.
 */
export async function computeCommit(input: CommitInput): Promise<string> {
  validateInput(input);
  const bytes = concatStrings(
    COMMIT_DOMAIN,
    input.role,
    input.selfPeerId,
    input.peerPeerId,
    input.fp,
    input.nonce,
  );
  return sha256Hex(bytes);
}

/**
 * Recompute the commit from the peer's reveal and check it matches what they sent earlier.
 *
 * `expected` is the commit value we received from the peer over the broker.
 * `peerRole` is the OPPOSITE role from ours.
 * `selfPeerId`/`peerPeerId` are flipped relative to our own commit because we're
 *   reconstructing the peer's input from their perspective.
 */
export async function verifyCommit(
  expected: string,
  input: CommitInput,
): Promise<boolean> {
  const actual = await computeCommit(input);
  return constantTimeEqual(expected, actual);
}

export function oppositeRole(role: Role): Role {
  return role === 'dialer' ? 'answerer' : 'dialer';
}

function validateInput(input: CommitInput): void {
  if (input.role !== 'dialer' && input.role !== 'answerer') {
    throw new Error(`invalid role: ${input.role}`);
  }
  if (!/^[0-9a-f]{64}$/.test(input.fp)) {
    throw new Error('fp must be 64 lowercase hex characters');
  }
  if (!/^[0-9a-f]{32}$/.test(input.nonce)) {
    throw new Error('nonce must be 32 lowercase hex characters');
  }
  if (!/^[0-9A-Z]{3}-[0-9A-Z]{3}$/.test(input.selfPeerId)) {
    throw new Error('selfPeerId must be in XXX-XXX form');
  }
  if (!/^[0-9A-Z]{3}-[0-9A-Z]{3}$/.test(input.peerPeerId)) {
    throw new Error('peerPeerId must be in XXX-XXX form');
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
