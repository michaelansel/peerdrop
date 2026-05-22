/**
 * SDP fingerprint conversion. The SDP wire form is e.g.:
 *     a=fingerprint:sha-256 AA:BB:CC:DD:...
 * The canonical form used internally and in hash inputs is:
 *     64 lowercase hex characters, no colons, no algorithm prefix
 *
 * We only support SHA-256 fingerprints (matching the cert we generate in step 0).
 */

const FINGERPRINT_LINE_RE = /^a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)\s*$/m;

export class SdpParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SdpParseError';
  }
}

/**
 * Extract the SHA-256 fingerprint from an SDP string and return it in canonical form.
 * Throws if no SHA-256 fingerprint line is present.
 */
export function extractFingerprint(sdp: string): string {
  const match = sdp.match(FINGERPRINT_LINE_RE);
  if (!match) {
    throw new SdpParseError('SDP has no a=fingerprint:sha-256 line');
  }
  return sdpFpToCanonical(match[1]!);
}

/** Convert "AA:BB:CC:..." (uppercase or lowercase, colon-separated) to 64 lowercase hex chars. */
export function sdpFpToCanonical(sdpFp: string): string {
  const hex = sdpFp.replace(/:/g, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new SdpParseError(`SDP fingerprint is not 32 bytes of hex: ${sdpFp}`);
  }
  return hex;
}

/** Convert canonical "aabbcc..." (64 lowercase hex chars) to the SDP wire form "AA:BB:CC:...". */
export function canonicalToSdpFp(canonical: string): string {
  if (!/^[0-9a-f]{64}$/.test(canonical)) {
    throw new SdpParseError('canonical fingerprint must be 64 lowercase hex characters');
  }
  const upper = canonical.toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < upper.length; i += 2) {
    groups.push(upper.slice(i, i + 2));
  }
  return groups.join(':');
}

/**
 * Compare the fingerprint in `sdp` to the canonical `expected`. Returns true if they match,
 * false otherwise. Throws SdpParseError only if the SDP is malformed.
 */
export function sdpFingerprintMatches(sdp: string, expected: string): boolean {
  return extractFingerprint(sdp) === expected;
}
