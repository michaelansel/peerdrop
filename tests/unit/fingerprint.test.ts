import { describe, it, expect } from 'vitest';
import {
  extractFingerprint,
  sdpFpToCanonical,
  canonicalToSdpFp,
  sdpFingerprintMatches,
  SdpParseError,
} from '../../src/webrtc/sdp.js';

const CANONICAL =
  'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
const SDP_WIRE =
  'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

function sdpWith(fp: string): string {
  return `v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=fingerprint:sha-256 ${fp}\r\na=setup:actpass\r\na=mid:0\r\n`;
}

describe('sdp fingerprint', () => {
  it('extractFingerprint returns canonical lowercase hex (no colons, no prefix)', () => {
    const sdp = sdpWith(SDP_WIRE);
    expect(extractFingerprint(sdp)).toBe(CANONICAL);
  });

  it('sdpFpToCanonical and canonicalToSdpFp round-trip', () => {
    expect(sdpFpToCanonical(SDP_WIRE)).toBe(CANONICAL);
    expect(canonicalToSdpFp(CANONICAL)).toBe(SDP_WIRE);
  });

  it('rejects malformed canonical fingerprints', () => {
    expect(() => canonicalToSdpFp('zzz')).toThrow(SdpParseError);
    expect(() => canonicalToSdpFp('AABBCC')).toThrow(SdpParseError);
    expect(() => canonicalToSdpFp('a'.repeat(63))).toThrow(SdpParseError);
  });

  it('rejects SDPs with no fingerprint or non-SHA-256 fingerprint', () => {
    expect(() => extractFingerprint('v=0\r\n')).toThrow(SdpParseError);
    const sha1Sdp =
      'v=0\r\na=fingerprint:sha-1 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD\r\n';
    expect(() => extractFingerprint(sha1Sdp)).toThrow(SdpParseError);
  });

  it('sdpFingerprintMatches returns true iff fingerprint matches expected canonical', () => {
    const sdp = sdpWith(SDP_WIRE);
    expect(sdpFingerprintMatches(sdp, CANONICAL)).toBe(true);
    expect(sdpFingerprintMatches(sdp, '0'.repeat(64))).toBe(false);
  });

  it('mismatched fingerprint in SDP is detected', () => {
    const tamperedSdp = sdpWith(
      '11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF',
    );
    expect(extractFingerprint(tamperedSdp)).not.toBe(CANONICAL);
    expect(sdpFingerprintMatches(tamperedSdp, CANONICAL)).toBe(false);
  });

  const OTHER_WIRE =
    '11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF';

  it('rejects an SDP carrying two conflicting sha-256 fingerprint lines', () => {
    // Active-broker trick: a session-level line equal to the value we expect (to slip past
    // a first-match check) plus a media-level line pinning the broker's own DTLS cert.
    const dual =
      `v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n` +
      `a=fingerprint:sha-256 ${SDP_WIRE}\r\n` +
      `m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n` +
      `a=fingerprint:sha-256 ${OTHER_WIRE}\r\na=setup:actpass\r\na=mid:0\r\n`;
    expect(() => extractFingerprint(dual)).toThrow(SdpParseError);
    // A malformed/ambiguous SDP surfaces as a parse error (the state machine catches it and
    // aborts), never as a silent "matches" result.
    expect(() => sdpFingerprintMatches(dual, CANONICAL)).toThrow(SdpParseError);
  });

  it('rejects an SDP mixing sha-256 with another algorithm', () => {
    const mixed =
      `v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n` +
      `a=fingerprint:sha-256 ${SDP_WIRE}\r\n` +
      `a=fingerprint:sha-512 ${SDP_WIRE}:${SDP_WIRE}\r\n`;
    expect(() => extractFingerprint(mixed)).toThrow(SdpParseError);
  });

  it('accepts duplicate fingerprint lines that carry the identical value', () => {
    const dup =
      `v=0\r\na=fingerprint:sha-256 ${SDP_WIRE}\r\n` +
      `m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 ${SDP_WIRE}\r\n`;
    expect(extractFingerprint(dup)).toBe(CANONICAL);
  });
});
