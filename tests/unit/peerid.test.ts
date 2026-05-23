import { describe, it, expect } from 'vitest';
import {
  CROCKFORD_ALPHABET,
  PEER_ID_LENGTH,
  generatePeerId,
  formatPeerId,
  normalizePeerId,
  isValidPeerIdInput,
  rawPeerId,
} from '../../src/utils/peerid.js';

describe('peerid', () => {
  it('uses the exact 32-character Crockford alphabet', () => {
    expect(CROCKFORD_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    for (const forbidden of ['I', 'L', 'O', 'U']) {
      expect(CROCKFORD_ALPHABET).not.toContain(forbidden);
    }
    for (const required of ['0', '1']) {
      expect(CROCKFORD_ALPHABET).toContain(required);
    }
  });

  it('peer-id length is 6 characters; search space is exactly 2^30', () => {
    expect(PEER_ID_LENGTH).toBe(6);
    expect(CROCKFORD_ALPHABET.length ** PEER_ID_LENGTH).toBe(2 ** 30);
    expect(2 ** 30).toBe(1_073_741_824);
  });

  it('generates ids in XXX-XXX form using only alphabet characters', () => {
    for (let i = 0; i < 200; i++) {
      const id = generatePeerId();
      expect(id).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/);
      for (const c of rawPeerId(id)) {
        expect(CROCKFORD_ALPHABET).toContain(c);
      }
    }
  });

  it('formatPeerId inserts a hyphen between groups of 3', () => {
    expect(formatPeerId('ABC123')).toBe('ABC-123');
    expect(formatPeerId('000000')).toBe('000-000');
    expect(() => formatPeerId('ABCDE')).toThrow();
    expect(() => formatPeerId('ABCDEFG')).toThrow();
  });

  it('rawPeerId strips hyphens and whitespace', () => {
    expect(rawPeerId('ABC-123')).toBe('ABC123');
    expect(rawPeerId(' ABC - 123 ')).toBe('ABC123');
  });

  it('normalizePeerId maps I/L -> 1, O -> 0 and uppercases lowercase letters', () => {
    expect(normalizePeerId('abc-def')).toBe('ABC-DEF');
    expect(normalizePeerId('ILO-001')).toBe('110-001');
    expect(normalizePeerId('lOL-OIl')).toBe('101-011');
  });

  it('normalizePeerId accepts both dashed and undashed forms', () => {
    expect(normalizePeerId('ABCDEF')).toBe('ABC-DEF');
    expect(normalizePeerId('ABC-DEF')).toBe('ABC-DEF');
    expect(normalizePeerId('A B C D E F')).toBe('ABC-DEF');
  });

  it('normalizePeerId rejects the letter U (Crockford reserved)', () => {
    expect(() => normalizePeerId('ABCDEU')).toThrowError(/"U" is not allowed/);
    expect(() => normalizePeerId('UUUUUU')).toThrow();
  });

  it('normalizePeerId rejects wrong-length inputs', () => {
    expect(() => normalizePeerId('ABC-DE')).toThrow();
    expect(() => normalizePeerId('ABC-DEFG')).toThrow();
    expect(() => normalizePeerId('')).toThrow();
  });

  it('isValidPeerIdInput returns true for valid forms, false otherwise', () => {
    expect(isValidPeerIdInput('ABC-DEF')).toBe(true);
    expect(isValidPeerIdInput('abcdef')).toBe(true);
    expect(isValidPeerIdInput('xxx')).toBe(false);
    expect(isValidPeerIdInput('ABCDEU')).toBe(false);
    expect(isValidPeerIdInput('!!!-!!!')).toBe(false);
  });
});
