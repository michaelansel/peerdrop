import { describe, it, expect } from 'vitest';
import {
  CHUNK_SIZE,
  WINDOW_SIZE,
  decodeFrame,
  encodeAck,
  encodeChunk,
  encodeDone,
  encodeError,
  encodeMeta,
  FrameDecodeError,
} from '../../src/transfer/protocol.js';

describe('transfer protocol frames', () => {
  it('defaults: 64 KiB chunk size, 16 chunk window', () => {
    expect(CHUNK_SIZE).toBe(64 * 1024);
    expect(WINDOW_SIZE).toBe(16);
  });

  it('META frame round-trips', () => {
    const meta = {
      id: 'abc',
      name: 'photo.jpg',
      size: 1234,
      chunkSize: 64 * 1024,
      totalChunks: 1,
    };
    const encoded = encodeMeta(meta);
    expect(encoded[0]).toBe(0x01);
    const decoded = decodeFrame(encoded);
    expect(decoded).toEqual({ type: 'meta', payload: meta });
  });

  it('CHUNK frame round-trips with correct seq encoding', () => {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = encodeChunk(0x12345678, body);
    expect(encoded[0]).toBe(0x02);
    expect(Array.from(encoded.subarray(1, 5))).toEqual([0x12, 0x34, 0x56, 0x78]);
    const decoded = decodeFrame(encoded);
    if (decoded.type !== 'chunk') throw new Error('expected chunk');
    expect(decoded.seq).toBe(0x12345678);
    expect(Array.from(decoded.body)).toEqual([1, 2, 3, 4, 5]);
  });

  it('CHUNK frame handles max uint32 seq', () => {
    const encoded = encodeChunk(0xffffffff, new Uint8Array(0));
    const decoded = decodeFrame(encoded);
    if (decoded.type !== 'chunk') throw new Error('expected chunk');
    expect(decoded.seq).toBe(0xffffffff);
  });

  it('ACK frame round-trips', () => {
    const encoded = encodeAck(12345);
    expect(encoded[0]).toBe(0x03);
    expect(encoded.length).toBe(5);
    const decoded = decodeFrame(encoded);
    if (decoded.type !== 'ack') throw new Error('expected ack');
    expect(decoded.seq).toBe(12345);
  });

  it('DONE frame round-trips', () => {
    const encoded = encodeDone();
    expect(encoded.length).toBe(1);
    expect(encoded[0]).toBe(0x04);
    expect(decodeFrame(encoded)).toEqual({ type: 'done' });
  });

  it('ERROR frame round-trips with utf-8 reason', () => {
    const encoded = encodeError('disk full ⚠');
    expect(encoded[0]).toBe(0x05);
    const decoded = decodeFrame(encoded);
    if (decoded.type !== 'error') throw new Error('expected error');
    expect(decoded.reason).toBe('disk full ⚠');
  });

  it('rejects empty frames and unknown tags', () => {
    expect(() => decodeFrame(new Uint8Array(0))).toThrow(FrameDecodeError);
    expect(() => decodeFrame(new Uint8Array([0xff]))).toThrow(FrameDecodeError);
  });

  it('rejects malformed meta JSON or invalid shape', () => {
    const bad = new Uint8Array([0x01, ...new TextEncoder().encode('not-json')]);
    expect(() => decodeFrame(bad)).toThrow(FrameDecodeError);
    const wrongShape = new Uint8Array([
      0x01,
      ...new TextEncoder().encode(JSON.stringify({ id: 'x' })),
    ]);
    expect(() => decodeFrame(wrongShape)).toThrow(FrameDecodeError);
  });

  it('rejects CHUNK frames shorter than 5 bytes', () => {
    expect(() => decodeFrame(new Uint8Array([0x02, 0, 0, 0]))).toThrow(FrameDecodeError);
  });

  it('rejects ACK frames of the wrong length', () => {
    expect(() => decodeFrame(new Uint8Array([0x03, 0, 0]))).toThrow(FrameDecodeError);
    expect(() => decodeFrame(new Uint8Array([0x03, 0, 0, 0, 0, 0]))).toThrow(FrameDecodeError);
  });

  it('rejects DONE frames with extra bytes', () => {
    expect(() => decodeFrame(new Uint8Array([0x04, 0]))).toThrow(FrameDecodeError);
  });

  it('rejects negative or non-integer chunk seqs', () => {
    expect(() => encodeChunk(-1, new Uint8Array())).toThrow();
    expect(() => encodeChunk(1.5, new Uint8Array())).toThrow();
    expect(() => encodeChunk(0xffffffff + 1, new Uint8Array())).toThrow();
    expect(() => encodeAck(-1)).toThrow();
  });
});
