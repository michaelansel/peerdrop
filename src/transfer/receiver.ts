import { decodeFrame, encodeAck, type MetaPayload } from './protocol.js';

export interface ReceiverEventMap {
  meta: MetaPayload;
  progress: { receivedBytes: number; totalBytes: number };
  complete: { id: string; name: string; size: number; blob: Blob };
  error: { reason: string };
}

export interface ChannelLike {
  send(data: Uint8Array): void;
}

type ReceiverEventName = keyof ReceiverEventMap;

export class FileReceiver {
  private meta?: MetaPayload;
  private buffers: Uint8Array[] = [];
  private receivedSeq = -1;
  private receivedBytes = 0;
  private aborted = false;
  private readonly listeners: { [K in ReceiverEventName]: Array<(e: ReceiverEventMap[K]) => void> } =
    {
      meta: [],
      progress: [],
      complete: [],
      error: [],
    };

  constructor(private readonly channel: ChannelLike) {}

  on<K extends ReceiverEventName>(event: K, listener: (e: ReceiverEventMap[K]) => void): void {
    this.listeners[event].push(listener);
  }

  handleFrame(buf: Uint8Array): void {
    if (this.aborted) return;
    let frame;
    try {
      frame = decodeFrame(buf);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'decode-error');
      return;
    }
    switch (frame.type) {
      case 'meta':
        this.onMeta(frame.payload);
        break;
      case 'chunk':
        this.onChunk(frame.seq, frame.body);
        break;
      case 'done':
        this.onDone();
        break;
      case 'error':
        this.fail(frame.reason);
        break;
      case 'ack':
        // The receiver does not expect to receive ACKs.
        this.fail('unexpected-ack');
        break;
    }
  }

  abort(reason = 'aborted'): void {
    if (this.aborted) return;
    this.fail(reason);
  }

  private onMeta(meta: MetaPayload): void {
    if (this.meta) {
      this.fail('duplicate-meta');
      return;
    }
    this.meta = meta;
    this.buffers = new Array(meta.totalChunks);
    this.emit('meta', meta);
    this.emit('progress', { receivedBytes: 0, totalBytes: meta.size });
    if (meta.totalChunks === 0) {
      // Zero-byte files complete on DONE.
    }
  }

  private onChunk(seq: number, body: Uint8Array): void {
    if (!this.meta) {
      this.fail('chunk-before-meta');
      return;
    }
    if (seq >= this.meta.totalChunks) {
      this.fail('chunk-out-of-range');
      return;
    }
    if (this.buffers[seq]) {
      // Duplicate; re-ack but ignore.
      this.channel.send(encodeAck(this.receivedSeq));
      return;
    }
    this.buffers[seq] = body.slice();
    this.receivedBytes += body.length;
    // Advance cumulative-acked seq as far as the contiguous prefix.
    while (this.receivedSeq + 1 < this.meta.totalChunks && this.buffers[this.receivedSeq + 1]) {
      this.receivedSeq++;
    }
    this.channel.send(encodeAck(this.receivedSeq));
    this.emit('progress', { receivedBytes: this.receivedBytes, totalBytes: this.meta.size });
  }

  private onDone(): void {
    if (!this.meta) {
      this.fail('done-before-meta');
      return;
    }
    if (this.receivedSeq + 1 !== this.meta.totalChunks) {
      this.fail('done-with-missing-chunks');
      return;
    }
    const blob = new Blob(this.buffers as unknown as BlobPart[], {
      type: 'application/octet-stream',
    });
    this.emit('complete', {
      id: this.meta.id,
      name: this.meta.name,
      size: this.meta.size,
      blob,
    });
  }

  private fail(reason: string): void {
    if (this.aborted) return;
    this.aborted = true;
    this.emit('error', { reason });
  }

  private emit<K extends ReceiverEventName>(event: K, payload: ReceiverEventMap[K]): void {
    for (const l of this.listeners[event]) {
      try {
        l(payload);
      } catch {
        // ignore listener errors
      }
    }
  }
}
