import { describe, it, expect } from 'vitest';
import { parseWireMessage, WireSchemaError } from '../../src/signaling/messages.js';

describe('wire message schema', () => {
  it('accepts well-formed commit/reveal/sdp/ice/confirm/abort messages', () => {
    expect(parseWireMessage({ type: 'commit', commit: 'a'.repeat(64) })).toEqual({
      type: 'commit',
      commit: 'a'.repeat(64),
    });
    expect(
      parseWireMessage({ type: 'reveal', fp: 'b'.repeat(64), nonce: 'c'.repeat(32) }),
    ).toEqual({ type: 'reveal', fp: 'b'.repeat(64), nonce: 'c'.repeat(32) });
    expect(parseWireMessage({ type: 'offer', sdp: 'v=0\r\n' })).toEqual({
      type: 'offer',
      sdp: 'v=0\r\n',
    });
    expect(parseWireMessage({ type: 'answer', sdp: 'v=0\r\n' })).toEqual({
      type: 'answer',
      sdp: 'v=0\r\n',
    });
    expect(parseWireMessage({ type: 'ice', candidate: { candidate: 'abc' } })).toEqual({
      type: 'ice',
      candidate: { candidate: 'abc' },
    });
    expect(parseWireMessage({ type: 'confirm' })).toEqual({ type: 'confirm' });
    expect(parseWireMessage({ type: 'abort', reason: 'user' })).toEqual({
      type: 'abort',
      reason: 'user',
    });
  });

  it('rejects non-object payloads', () => {
    expect(() => parseWireMessage(null)).toThrow(WireSchemaError);
    expect(() => parseWireMessage(42)).toThrow(WireSchemaError);
    expect(() => parseWireMessage('hello')).toThrow(WireSchemaError);
  });

  it('rejects unknown types', () => {
    expect(() => parseWireMessage({ type: 'mystery' })).toThrow(WireSchemaError);
  });

  it('rejects commit values that are not 64 lowercase hex chars', () => {
    expect(() => parseWireMessage({ type: 'commit', commit: 'A'.repeat(64) })).toThrow();
    expect(() => parseWireMessage({ type: 'commit', commit: 'a'.repeat(63) })).toThrow();
    expect(() => parseWireMessage({ type: 'commit' })).toThrow();
  });

  it('rejects reveal values that are not the expected hex lengths', () => {
    expect(() =>
      parseWireMessage({ type: 'reveal', fp: 'a'.repeat(64), nonce: 'b'.repeat(31) }),
    ).toThrow();
    expect(() =>
      parseWireMessage({ type: 'reveal', fp: 'a'.repeat(63), nonce: 'b'.repeat(32) }),
    ).toThrow();
  });

  it('rejects sdp and ice messages with missing fields', () => {
    expect(() => parseWireMessage({ type: 'offer' })).toThrow();
    expect(() => parseWireMessage({ type: 'answer', sdp: '' })).toThrow();
    expect(() => parseWireMessage({ type: 'ice' })).toThrow();
    expect(() => parseWireMessage({ type: 'ice', candidate: 'not-an-object' })).toThrow();
  });

  it('rejects abort messages without a reason', () => {
    expect(() => parseWireMessage({ type: 'abort' })).toThrow();
    expect(() => parseWireMessage({ type: 'abort', reason: '' })).toThrow();
  });
});
