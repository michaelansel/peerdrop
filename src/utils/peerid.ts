/**
 * Crockford-base32 alphabet (normative): 32 characters, excludes I L O U, retains 0 and 1.
 * search space = 32^6 = 2^30 = 1,073,741,824
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PEER_ID_LENGTH = 6;

const ALPHABET_BYTES = new Uint8Array(
  Array.from(CROCKFORD_ALPHABET).map((c) => c.charCodeAt(0)),
);

/** Generate a new random peer-id in display form (XXX-XXX). */
export function generatePeerId(): string {
  // Reject-sample to remove modulo bias: bytes 0..255, accept only < 256 - (256 % 32).
  const maxAcceptable = 256 - (256 % CROCKFORD_ALPHABET.length); // 256
  const out = new Array<string>(PEER_ID_LENGTH);
  let i = 0;
  while (i < PEER_ID_LENGTH) {
    const buf = new Uint8Array(PEER_ID_LENGTH - i);
    crypto.getRandomValues(buf);
    for (let j = 0; j < buf.length && i < PEER_ID_LENGTH; j++) {
      const b = buf[j]!;
      if (b < maxAcceptable) {
        out[i++] = CROCKFORD_ALPHABET[b % CROCKFORD_ALPHABET.length]!;
      }
    }
  }
  void ALPHABET_BYTES;
  return formatPeerId(out.join(''));
}

/** Insert a hyphen between groups of 3 characters. Input must be the raw 6-char form. */
export function formatPeerId(raw: string): string {
  if (raw.length !== PEER_ID_LENGTH) throw new Error(`peer-id must be ${PEER_ID_LENGTH} chars`);
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

/** Strip hyphens / whitespace from the display form, returning the 6-char raw form. */
export function rawPeerId(display: string): string {
  return display.replace(/[-\s]/g, '');
}

/**
 * Normalize user-typed input per Crockford recommendations:
 *   I, i, L, l -> 1
 *   O, o -> 0
 *   lowercase letters -> uppercase
 * Rejects: U/u (reserved), any character not in the alphabet after normalization,
 * any input whose stripped length is not exactly 6.
 *
 * Returns the canonical display form (XXX-XXX). Throws on invalid input.
 */
export function normalizePeerId(input: string): string {
  const stripped = input.replace(/[-\s]/g, '').toUpperCase();
  if (stripped.length !== PEER_ID_LENGTH) {
    throw new Error(`peer-id must be ${PEER_ID_LENGTH} characters (excluding hyphens)`);
  }
  let normalized = '';
  for (const c of stripped) {
    if (c === 'U') throw new Error(`character "U" is not allowed in peer-ids`);
    let mapped = c;
    if (c === 'I' || c === 'L') mapped = '1';
    else if (c === 'O') mapped = '0';
    if (!CROCKFORD_ALPHABET.includes(mapped)) {
      throw new Error(`invalid character in peer-id: "${c}"`);
    }
    normalized += mapped;
  }
  return formatPeerId(normalized);
}

/** Validate without throwing — returns true if `input` normalizes cleanly. */
export function isValidPeerIdInput(input: string): boolean {
  try {
    normalizePeerId(input);
    return true;
  } catch {
    return false;
  }
}
