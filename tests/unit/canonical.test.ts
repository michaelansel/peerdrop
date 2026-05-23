import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../../src/utils/hash.js';
import { sdpFpToCanonical, canonicalToSdpFp } from '../../src/webrtc/sdp.js';

describe('canonical encodings', () => {
  it('sha-256 of empty input is the well-known constant', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('sha-256 of "abc" matches the canonical NIST test vector', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('canonical fingerprint round-trips through both forms', () => {
    const canonical =
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    const sdp = canonicalToSdpFp(canonical);
    expect(sdpFpToCanonical(sdp)).toBe(canonical);
  });

  it('canonical fingerprint accepts colon-separated uppercase or lowercase SDP input', () => {
    const canonical =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const upper = canonicalToSdpFp(canonical);
    const lower = upper.toLowerCase();
    expect(sdpFpToCanonical(upper)).toBe(canonical);
    expect(sdpFpToCanonical(lower)).toBe(canonical);
  });
});
