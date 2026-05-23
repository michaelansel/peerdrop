import { describe, it, expect } from 'vitest';
import { computeSas, digitsFromHash, SAS_DIGITS, SAS_DOMAIN } from '../../src/pairing/sas.js';
import type { SasInput } from '../../src/pairing/sas.js';

const dialerInput: SasInput = {
  role: 'dialer',
  selfPeerId: 'ABC-123',
  peerPeerId: 'XYZ-789',
  selfCommit: '1'.repeat(64),
  peerCommit: '2'.repeat(64),
  selfFp: 'a'.repeat(64),
  peerFp: 'b'.repeat(64),
  selfNonce: 'c'.repeat(32),
  peerNonce: 'd'.repeat(32),
};

const answererInput: SasInput = {
  ...dialerInput,
  role: 'answerer',
  selfPeerId: dialerInput.peerPeerId,
  peerPeerId: dialerInput.selfPeerId,
  selfCommit: dialerInput.peerCommit,
  peerCommit: dialerInput.selfCommit,
  selfFp: dialerInput.peerFp,
  peerFp: dialerInput.selfFp,
  selfNonce: dialerInput.peerNonce,
  peerNonce: dialerInput.selfNonce,
};

describe('sas', () => {
  it('uses domain "peerdrop/sas/v1" and 6-digit output', async () => {
    expect(SAS_DOMAIN).toBe('peerdrop/sas/v1');
    expect(SAS_DIGITS).toBe(6);
    const sas = await computeSas(dialerInput);
    expect(sas).toMatch(/^[0-9]{6}$/);
  });

  it('both peers compute the same SAS regardless of role', async () => {
    const a = await computeSas(dialerInput);
    const b = await computeSas(answererInput);
    expect(a).toBe(b);
  });

  it('changes when any input field changes', async () => {
    const base = await computeSas(dialerInput);
    const variants: Array<Partial<SasInput>> = [
      { selfPeerId: 'AAA-000' },
      { peerPeerId: 'AAA-000' },
      { selfCommit: '0'.repeat(64) },
      { peerCommit: '0'.repeat(64) },
      { selfFp: '0'.repeat(64) },
      { peerFp: '0'.repeat(64) },
      { selfNonce: '0'.repeat(32) },
      { peerNonce: '0'.repeat(32) },
    ];
    for (const v of variants) {
      const out = await computeSas({ ...dialerInput, ...v });
      expect(out).not.toBe(base);
    }
  });

  it('zero-pads SAS values with leading zeros', () => {
    // Build a hash whose first 4 bytes are 0x00 0x00 0x00 0x2a (decimal 42).
    const hash = new Uint8Array(32);
    hash[3] = 0x2a;
    const out = digitsFromHash(hash, 6);
    expect(out).toBe('000042');
    expect(out).toHaveLength(6);
  });

  it('does not pre-fill or auto-confirm low-entropy outputs', () => {
    const allZero = new Uint8Array(32);
    expect(digitsFromHash(allZero, 6)).toBe('000000');
    const allFf = new Uint8Array(32).fill(0xff);
    const out = digitsFromHash(allFf, 6);
    expect(out).toHaveLength(6);
    expect(/^[0-9]+$/.test(out)).toBe(true);
  });
});
