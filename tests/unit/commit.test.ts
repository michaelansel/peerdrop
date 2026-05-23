import { describe, it, expect } from 'vitest';
import {
  COMMIT_DOMAIN,
  computeCommit,
  oppositeRole,
  verifyCommit,
  type CommitInput,
} from '../../src/pairing/commit.js';
import { sha256Hex } from '../../src/utils/hash.js';

const sampleFp = 'a'.repeat(64);
const sampleNonce = 'b'.repeat(32);

const base: CommitInput = {
  role: 'dialer',
  selfPeerId: 'ABC-123',
  peerPeerId: 'XYZ-789',
  fp: sampleFp,
  nonce: sampleNonce,
};

describe('commit', () => {
  it('domain string is "peerdrop/commit/v1"', () => {
    expect(COMMIT_DOMAIN).toBe('peerdrop/commit/v1');
  });

  it('matches the known-vector hash for a fixed input (deterministic)', async () => {
    // Compute the expected hash directly here so any change to the formula breaks the test.
    const expected = await sha256Hex(
      `peerdrop/commit/v1` +
        `dialer` +
        `ABC-123` +
        `XYZ-789` +
        sampleFp +
        sampleNonce,
    );
    const actual = await computeCommit(base);
    expect(actual).toBe(expected);
    expect(actual).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any single field changes', async () => {
    const baseHash = await computeCommit(base);
    const variants: Array<Partial<CommitInput>> = [
      { role: 'answerer' },
      { selfPeerId: 'ZZZ-999' },
      { peerPeerId: 'AAA-000' },
      { fp: 'c'.repeat(64) },
      { nonce: 'f'.repeat(32) },
    ];
    for (const v of variants) {
      const h = await computeCommit({ ...base, ...v });
      expect(h).not.toBe(baseHash);
    }
  });

  it('peer-id swap (cross-role replay) produces a different commit', async () => {
    const h1 = await computeCommit(base);
    const h2 = await computeCommit({
      ...base,
      selfPeerId: base.peerPeerId,
      peerPeerId: base.selfPeerId,
    });
    expect(h1).not.toBe(h2);
  });

  it('rejects malformed fingerprint or nonce inputs', async () => {
    await expect(computeCommit({ ...base, fp: 'short' })).rejects.toThrow();
    await expect(computeCommit({ ...base, fp: 'A'.repeat(64) })).rejects.toThrow();
    await expect(computeCommit({ ...base, nonce: 'short' })).rejects.toThrow();
    await expect(
      computeCommit({ ...base, selfPeerId: 'BAD' }),
    ).rejects.toThrow();
  });

  it('verifyCommit returns true for a matching pair and false otherwise', async () => {
    const c = await computeCommit(base);
    expect(await verifyCommit(c, base)).toBe(true);
    expect(await verifyCommit(c, { ...base, nonce: 'c'.repeat(32) })).toBe(false);
  });

  it('oppositeRole flips dialer<->answerer', () => {
    expect(oppositeRole('dialer')).toBe('answerer');
    expect(oppositeRole('answerer')).toBe('dialer');
  });
});
