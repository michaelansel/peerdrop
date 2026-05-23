import { describe, it, expect } from 'vitest';
import { FileSender, type ChannelLike as SenderChannel } from '../../src/transfer/sender.js';
import { FileReceiver } from '../../src/transfer/receiver.js';
import { decodeFrame, FRAME } from '../../src/transfer/protocol.js';
import { sha256Hex } from '../../src/utils/hash.js';

/**
 * Loopback channel: paired sender + receiver routes. Each side has a "send" that
 * delivers to the other's listeners. We demux by tag byte so the receiver sees
 * META/CHUNK/DONE and the sender sees ACK.
 */
function makeLoopback(): { senderChannel: SenderChannel; receiver: FileReceiver } {
  let senderInstance: FileSender | undefined;
  const receiver = new FileReceiver({
    send: (data: Uint8Array) => {
      // ACK frames from receiver back to sender.
      if (data[0] === FRAME.ACK && senderInstance) {
        const frame = decodeFrame(data);
        if (frame.type === 'ack') senderInstance.handleAck(frame.seq);
      }
    },
  });
  const senderChannel: SenderChannel = {
    send: (data: Uint8Array) => {
      // Deliver META/CHUNK/DONE to the receiver synchronously.
      receiver.handleFrame(data);
    },
  };
  // Expose a setter for the sender once it exists.
  (senderChannel as SenderChannel & { _setSender: (s: FileSender) => void })._setSender = (s) => {
    senderInstance = s;
  };
  return { senderChannel, receiver };
}

async function bytesOfBlob(blob: Blob): Promise<Uint8Array> {
  // jsdom's Blob lacks .arrayBuffer() and its Response stringifies Blobs;
  // FileReader works correctly.
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error ?? new Error('FileReader error'));
    fr.readAsArrayBuffer(blob);
  });
}

function fileFromBytes(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.length,
    slice: async (start: number, end: number) =>
      bytes.subarray(start, end).slice(),
  };
}

describe('sender + receiver loopback', () => {
  it('transfers a small file with sha256-matching contents', async () => {
    const { senderChannel, receiver } = makeLoopback();
    const input = new Uint8Array(1024);
    for (let i = 0; i < input.length; i++) input[i] = (i * 31 + 17) & 0xff;
    const inputHash = await sha256Hex(input);

    let completed: { name: string; blob: Blob } | undefined;
    receiver.on('complete', (e) => {
      completed = { name: e.name, blob: e.blob };
    });

    const sender = new FileSender({
      channel: senderChannel,
      file: fileFromBytes('a.bin', input),
      chunkSize: 100,
      windowSize: 4,
    });
    (senderChannel as SenderChannel & { _setSender: (s: FileSender) => void })._setSender(sender);
    await sender.run();

    expect(completed).toBeDefined();
    expect(completed?.name).toBe('a.bin');
    const out = await bytesOfBlob(completed!.blob);
    expect(out).toEqual(input);
    expect(await sha256Hex(out)).toBe(inputHash);
  });

  it('transfers a 2 MiB file with default chunk size', async () => {
    const { senderChannel, receiver } = makeLoopback();
    const input = new Uint8Array(2 * 1024 * 1024);
    for (let i = 0; i < input.length; i++) input[i] = i & 0xff;
    const inputHash = await sha256Hex(input);

    let completed: { blob: Blob } | undefined;
    receiver.on('complete', (e) => {
      completed = { blob: e.blob };
    });

    const sender = new FileSender({
      channel: senderChannel,
      file: fileFromBytes('big.bin', input),
    });
    (senderChannel as SenderChannel & { _setSender: (s: FileSender) => void })._setSender(sender);
    await sender.run();

    const out = await bytesOfBlob(completed!.blob);
    expect(out.length).toBe(input.length);
    expect(await sha256Hex(out)).toBe(inputHash);
  });

  it('handles a 0-byte file (META + DONE only)', async () => {
    const { senderChannel, receiver } = makeLoopback();
    let completed: { blob: Blob; size: number } | undefined;
    receiver.on('complete', (e) => {
      completed = { blob: e.blob, size: e.size };
    });
    const sender = new FileSender({
      channel: senderChannel,
      file: fileFromBytes('empty.bin', new Uint8Array(0)),
    });
    (senderChannel as SenderChannel & { _setSender: (s: FileSender) => void })._setSender(sender);
    await sender.run();
    expect(completed?.size).toBe(0);
    expect((await bytesOfBlob(completed!.blob)).length).toBe(0);
  });

  it('emits progress events while sending', async () => {
    const { senderChannel, receiver } = makeLoopback();
    void receiver;
    const input = new Uint8Array(1000);
    const sender = new FileSender({
      channel: senderChannel,
      file: fileFromBytes('p.bin', input),
      chunkSize: 100,
      windowSize: 4,
    });
    (senderChannel as SenderChannel & { _setSender: (s: FileSender) => void })._setSender(sender);
    const seen: Array<[number, number]> = [];
    sender['opts'].onProgress = (s, t) => seen.push([s, t]);
    await sender.run();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toEqual([1000, 1000]);
  });
});

describe('receiver edge cases', () => {
  it('rejects a chunk before META', () => {
    const events: string[] = [];
    const receiver = new FileReceiver({ send: () => undefined });
    receiver.on('error', (e) => events.push(e.reason));
    receiver.handleFrame(new Uint8Array([FRAME.CHUNK, 0, 0, 0, 0, 1, 2]));
    expect(events[0]).toBe('chunk-before-meta');
  });

  it('rejects DONE before all chunks arrived', () => {
    const errors: string[] = [];
    const receiver = new FileReceiver({ send: () => undefined });
    receiver.on('error', (e) => errors.push(e.reason));
    const meta = {
      id: 'x',
      name: 'f',
      size: 200,
      chunkSize: 100,
      totalChunks: 2,
    };
    const encoded = new Uint8Array(
      1 + new TextEncoder().encode(JSON.stringify(meta)).length,
    );
    encoded[0] = FRAME.META;
    encoded.set(new TextEncoder().encode(JSON.stringify(meta)), 1);
    receiver.handleFrame(encoded);
    receiver.handleFrame(new Uint8Array([FRAME.DONE]));
    expect(errors[0]).toBe('done-with-missing-chunks');
  });

  it('rejects a duplicate META', () => {
    const errors: string[] = [];
    const receiver = new FileReceiver({ send: () => undefined });
    receiver.on('error', (e) => errors.push(e.reason));
    const meta = { id: 'x', name: 'f', size: 0, chunkSize: 100, totalChunks: 0 };
    const enc = new Uint8Array(
      1 + new TextEncoder().encode(JSON.stringify(meta)).length,
    );
    enc[0] = FRAME.META;
    enc.set(new TextEncoder().encode(JSON.stringify(meta)), 1);
    receiver.handleFrame(enc);
    receiver.handleFrame(enc);
    expect(errors[0]).toBe('duplicate-meta');
  });

  it('treats receiving an ACK as a protocol error', () => {
    const errors: string[] = [];
    const receiver = new FileReceiver({ send: () => undefined });
    receiver.on('error', (e) => errors.push(e.reason));
    receiver.handleFrame(new Uint8Array([FRAME.ACK, 0, 0, 0, 1]));
    expect(errors[0]).toBe('unexpected-ack');
  });
});
