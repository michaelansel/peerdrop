import { sha256Bytes, concatStrings } from '../utils/hash.js';
import type { Role } from './commit.js';

export const SAS_DOMAIN = 'peerdrop/sas/v1';
export const SAS_DIGITS = 6;

export interface SasInput {
  role: Role;
  selfPeerId: string;
  peerPeerId: string;
  selfCommit: string;
  peerCommit: string;
  selfFp: string;
  peerFp: string;
  selfNonce: string;
  peerNonce: string;
}

/**
 * Compute the 6-digit SAS from both sides' commitments, fingerprints, and nonces.
 *
 * Both peers compute the same value because we order by role (dialer first, answerer second)
 * rather than by lex-min of any broker-controlled value. Each peer assembles the input in
 * dialer-then-answerer order regardless of which role it occupies locally.
 *
 * Returns a zero-padded decimal string of length SAS_DIGITS.
 */
export async function computeSas(input: SasInput): Promise<string> {
  const dialer = input.role === 'dialer' ? 'self' : 'peer';
  const answerer = input.role === 'dialer' ? 'peer' : 'self';

  const dialerPeerId = dialer === 'self' ? input.selfPeerId : input.peerPeerId;
  const answererPeerId = answerer === 'self' ? input.selfPeerId : input.peerPeerId;
  const dialerCommit = dialer === 'self' ? input.selfCommit : input.peerCommit;
  const answererCommit = answerer === 'self' ? input.selfCommit : input.peerCommit;
  const dialerFp = dialer === 'self' ? input.selfFp : input.peerFp;
  const answererFp = answerer === 'self' ? input.selfFp : input.peerFp;
  const dialerNonce = dialer === 'self' ? input.selfNonce : input.peerNonce;
  const answererNonce = answerer === 'self' ? input.selfNonce : input.peerNonce;

  const bytes = concatStrings(
    SAS_DOMAIN,
    dialerPeerId,
    answererPeerId,
    dialerCommit,
    answererCommit,
    dialerFp,
    answererFp,
    dialerNonce,
    answererNonce,
  );
  const hash = await sha256Bytes(bytes);
  return digitsFromHash(hash, SAS_DIGITS);
}

/**
 * Extract `digits` decimal digits from the first 4 bytes of the hash, zero-padded.
 * Using only the first 4 bytes gives us 2^32 ≈ 4.3 × 10^9 values, plenty for 6 decimal
 * digits (10^6 outputs). The truncation is uniformly distributed modulo 10^digits
 * (with a tiny bias well under 1 ppm).
 */
export function digitsFromHash(hash: Uint8Array, digits: number): string {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value = value * 256 + hash[i]!;
  }
  const mod = 10 ** digits;
  const trimmed = value % mod;
  return trimmed.toString().padStart(digits, '0');
}
