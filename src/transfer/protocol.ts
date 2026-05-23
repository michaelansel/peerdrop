/**
 * DataChannel binary frames. First byte is the tag.
 *
 *   0x01 META   utf-8 JSON {id, name, size, chunkSize, totalChunks}
 *   0x02 CHUNK  4-byte BE seq, then up to 64 KiB payload
 *   0x03 ACK    4-byte BE cumulative-seq
 *   0x04 DONE   no payload
 *   0x05 ERROR  utf-8 reason
 */

export const FRAME = {
  META: 0x01,
  CHUNK: 0x02,
  ACK: 0x03,
  DONE: 0x04,
  ERROR: 0x05,
} as const;

export type FrameTag = (typeof FRAME)[keyof typeof FRAME];

export interface MetaPayload {
  id: string;
  name: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
}

export const CHUNK_SIZE = 64 * 1024; // 64 KiB
export const WINDOW_SIZE = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeMeta(payload: MetaPayload): Uint8Array {
  const json = JSON.stringify(payload);
  const body = encoder.encode(json);
  const out = new Uint8Array(1 + body.length);
  out[0] = FRAME.META;
  out.set(body, 1);
  return out;
}

export function encodeChunk(seq: number, body: Uint8Array): Uint8Array {
  if (seq < 0 || !Number.isInteger(seq) || seq > 0xffffffff) {
    throw new Error('chunk seq must be a uint32');
  }
  const out = new Uint8Array(1 + 4 + body.length);
  out[0] = FRAME.CHUNK;
  out[1] = (seq >>> 24) & 0xff;
  out[2] = (seq >>> 16) & 0xff;
  out[3] = (seq >>> 8) & 0xff;
  out[4] = seq & 0xff;
  out.set(body, 5);
  return out;
}

export function encodeAck(seq: number): Uint8Array {
  if (seq < 0 || !Number.isInteger(seq) || seq > 0xffffffff) {
    throw new Error('ack seq must be a uint32');
  }
  const out = new Uint8Array(5);
  out[0] = FRAME.ACK;
  out[1] = (seq >>> 24) & 0xff;
  out[2] = (seq >>> 16) & 0xff;
  out[3] = (seq >>> 8) & 0xff;
  out[4] = seq & 0xff;
  return out;
}

export function encodeDone(): Uint8Array {
  return new Uint8Array([FRAME.DONE]);
}

export function encodeError(reason: string): Uint8Array {
  const body = encoder.encode(reason);
  const out = new Uint8Array(1 + body.length);
  out[0] = FRAME.ERROR;
  out.set(body, 1);
  return out;
}

export type DecodedFrame =
  | { type: 'meta'; payload: MetaPayload }
  | { type: 'chunk'; seq: number; body: Uint8Array }
  | { type: 'ack'; seq: number }
  | { type: 'done' }
  | { type: 'error'; reason: string };

export class FrameDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameDecodeError';
  }
}

export function decodeFrame(buf: Uint8Array): DecodedFrame {
  if (buf.length === 0) throw new FrameDecodeError('empty frame');
  const tag = buf[0]!;
  switch (tag) {
    case FRAME.META: {
      const json = decoder.decode(buf.subarray(1));
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new FrameDecodeError('meta is not valid JSON');
      }
      if (!isMeta(parsed)) throw new FrameDecodeError('meta has invalid shape');
      return { type: 'meta', payload: parsed };
    }
    case FRAME.CHUNK: {
      if (buf.length < 5) throw new FrameDecodeError('chunk too short');
      const seq =
        buf[1]! * 0x1000000 + (buf[2]! << 16) + (buf[3]! << 8) + buf[4]!;
      return { type: 'chunk', seq, body: buf.subarray(5) };
    }
    case FRAME.ACK: {
      if (buf.length !== 5) throw new FrameDecodeError('ack must be 5 bytes');
      const seq =
        buf[1]! * 0x1000000 + (buf[2]! << 16) + (buf[3]! << 8) + buf[4]!;
      return { type: 'ack', seq };
    }
    case FRAME.DONE: {
      if (buf.length !== 1) throw new FrameDecodeError('done must be 1 byte');
      return { type: 'done' };
    }
    case FRAME.ERROR: {
      return { type: 'error', reason: decoder.decode(buf.subarray(1)) };
    }
    default:
      throw new FrameDecodeError(`unknown frame tag 0x${tag.toString(16)}`);
  }
}

function isMeta(v: unknown): v is MetaPayload {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m['id'] === 'string' &&
    typeof m['name'] === 'string' &&
    typeof m['size'] === 'number' &&
    typeof m['chunkSize'] === 'number' &&
    typeof m['totalChunks'] === 'number' &&
    m['size'] >= 0 &&
    m['chunkSize'] > 0 &&
    m['totalChunks'] >= 0
  );
}
