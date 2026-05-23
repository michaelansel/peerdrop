/**
 * SDP fingerprint conversion. The SDP wire form is e.g.:
 *     a=fingerprint:sha-256 AA:BB:CC:DD:...
 * The canonical form used internally and in hash inputs is:
 *     64 lowercase hex characters, no colons, no algorithm prefix
 *
 * We only support SHA-256 fingerprints (matching the cert we generate in step 0).
 */

// Matches every `a=fingerprint:<algorithm> <value>` line, capturing algorithm and value.
// Global + multiline so we can inspect *all* fingerprint lines, not just the first.
const FINGERPRINT_LINE_RE = /^a=fingerprint:(\S+)[ \t]+([0-9A-Fa-f:]+)\s*$/gm;

export class SdpParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SdpParseError';
  }
}

/**
 * Extract the SHA-256 fingerprint from an SDP string and return it in canonical form.
 *
 * Security: we must verify the *same* fingerprint the browser will enforce for the DTLS
 * handshake. SDP can legally carry a fingerprint at the session level and/or per m-section,
 * and a media-level value overrides the session-level one. A malicious broker that controls
 * the relayed SDP could otherwise place the value we expect on one line (to pass our check)
 * while the browser actually pins a *different* line — substituting its own DTLS cert and
 * defeating the SAS binding. To close that gap we require that EVERY fingerprint line is
 * SHA-256 and that they all carry the identical value; anything else aborts the pairing.
 */
export function extractFingerprint(sdp: string): string {
  const matches = [...sdp.matchAll(FINGERPRINT_LINE_RE)];
  if (matches.length === 0) {
    throw new SdpParseError('SDP has no a=fingerprint line');
  }
  let canonical: string | undefined;
  for (const m of matches) {
    const algorithm = m[1]!.toLowerCase();
    if (algorithm !== 'sha-256') {
      throw new SdpParseError(`unsupported fingerprint algorithm: ${m[1]}`);
    }
    const fp = sdpFpToCanonical(m[2]!);
    if (canonical === undefined) {
      canonical = fp;
    } else if (fp !== canonical) {
      throw new SdpParseError('conflicting a=fingerprint lines in SDP');
    }
  }
  return canonical!;
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
