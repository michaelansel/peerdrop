/**
 * Wire messages sent over the broker DataConnection.
 *
 * Legal sequence (per side):
 *   local sends:    commit  reveal  offer|answer  ice*  confirm
 *   local receives: commit  reveal  offer|answer  ice*  confirm
 *
 * Duplicates of non-ICE messages are protocol violations. Any deviation -> abort.
 */

export interface CommitMessage {
  type: 'commit';
  commit: string; // 64 lowercase hex
}

export interface RevealMessage {
  type: 'reveal';
  fp: string; // canonical fingerprint hex, 64 lowercase hex
  nonce: string; // 32 lowercase hex
}

export interface OfferMessage {
  type: 'offer';
  sdp: string;
}

export interface AnswerMessage {
  type: 'answer';
  sdp: string;
}

export interface IceMessage {
  type: 'ice';
  candidate: RTCIceCandidateInit;
}

export interface ConfirmMessage {
  type: 'confirm';
}

export interface AbortMessage {
  type: 'abort';
  reason: string;
}

export type WireMessage =
  | CommitMessage
  | RevealMessage
  | OfferMessage
  | AnswerMessage
  | IceMessage
  | ConfirmMessage
  | AbortMessage;

export type WireMessageType = WireMessage['type'];

export class WireSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireSchemaError';
  }
}

/**
 * Validate an incoming payload against the wire schema. PeerJS hands us already-parsed
 * objects via on('data'), so this checks shape only. Returns a typed WireMessage or throws.
 */
export function parseWireMessage(payload: unknown): WireMessage {
  if (payload === null || typeof payload !== 'object') {
    throw new WireSchemaError('payload is not an object');
  }
  const m = payload as Record<string, unknown>;
  const type = m['type'];
  switch (type) {
    case 'commit':
      requireHex(m['commit'], 64, 'commit.commit');
      return { type: 'commit', commit: m['commit'] as string };
    case 'reveal':
      requireHex(m['fp'], 64, 'reveal.fp');
      requireHex(m['nonce'], 32, 'reveal.nonce');
      return { type: 'reveal', fp: m['fp'] as string, nonce: m['nonce'] as string };
    case 'offer':
      requireString(m['sdp'], 'offer.sdp');
      return { type: 'offer', sdp: m['sdp'] as string };
    case 'answer':
      requireString(m['sdp'], 'answer.sdp');
      return { type: 'answer', sdp: m['sdp'] as string };
    case 'ice':
      if (!m['candidate'] || typeof m['candidate'] !== 'object') {
        throw new WireSchemaError('ice.candidate must be an object');
      }
      return { type: 'ice', candidate: m['candidate'] as RTCIceCandidateInit };
    case 'confirm':
      return { type: 'confirm' };
    case 'abort':
      requireString(m['reason'], 'abort.reason');
      return { type: 'abort', reason: m['reason'] as string };
    default:
      throw new WireSchemaError(`unknown message type: ${String(type)}`);
  }
}

function requireString(v: unknown, name: string): void {
  if (typeof v !== 'string' || v.length === 0) {
    throw new WireSchemaError(`${name} must be a non-empty string`);
  }
}

function requireHex(v: unknown, length: number, name: string): void {
  if (typeof v !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`).test(v)) {
    throw new WireSchemaError(`${name} must be ${length} lowercase hex characters`);
  }
}
