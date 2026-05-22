import {
  CHUNK_SIZE,
  WINDOW_SIZE,
  encodeMeta,
  encodeChunk,
  encodeDone,
  type MetaPayload,
} from './protocol.js';
import { planChunks } from './chunker.js';

export interface ChannelLike {
  send(data: Uint8Array): void;
  readyState?: string;
  bufferedAmount?: number;
  bufferedAmountLowThreshold?: number;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

export interface SenderInputFile {
  name: string;
  size: number;
  /** Read [start, end) inclusive-exclusive. */
  slice: (start: number, end: number) => Promise<Uint8Array>;
}

export interface SenderOptions {
  channel: ChannelLike;
  file: SenderInputFile;
  id?: string;
  chunkSize?: number;
  windowSize?: number;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}

export class FileSender {
  private readonly chunkSize: number;
  private readonly windowSize: number;
  private readonly id: string;
  private highestAckedSeq = -1;
  private resolveDone?: () => void;
  private rejectDone?: (err: Error) => void;
  private aborted = false;
  private nextToSendSeq = 0;
  private readonly plan: ReturnType<typeof planChunks>;

  constructor(private readonly opts: SenderOptions) {
    this.chunkSize = opts.chunkSize ?? CHUNK_SIZE;
    this.windowSize = opts.windowSize ?? WINDOW_SIZE;
    this.id = opts.id ?? crypto.randomUUID();
    this.plan = planChunks(opts.file.size, this.chunkSize);
  }

  get totalChunks(): number {
    return this.plan.length;
  }

  /** Feed an incoming cumulative-ack seq number. */
  handleAck(seq: number): void {
    if (this.aborted) return;
    if (seq > this.highestAckedSeq) {
      this.highestAckedSeq = seq;
      this.opts.onProgress?.(this.bytesAcked(), this.opts.file.size);
      void this.pump();
      if (this.highestAckedSeq >= this.plan.length - 1) {
        try {
          this.opts.channel.send(encodeDone());
        } catch (err) {
          this.rejectDone?.(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        this.resolveDone?.();
      }
    }
  }

  abort(reason = 'aborted'): void {
    if (this.aborted) return;
    this.aborted = true;
    this.rejectDone?.(new Error(reason));
  }

  /** Start the transfer. Resolves when DONE has been sent after the last ACK. */
  async run(): Promise<void> {
    if (this.plan.length === 0) {
      const meta: MetaPayload = {
        id: this.id,
        name: this.opts.file.name,
        size: 0,
        chunkSize: this.chunkSize,
        totalChunks: 0,
      };
      this.opts.channel.send(encodeMeta(meta));
      this.opts.channel.send(encodeDone());
      return;
    }
    const meta: MetaPayload = {
      id: this.id,
      name: this.opts.file.name,
      size: this.opts.file.size,
      chunkSize: this.chunkSize,
      totalChunks: this.plan.length,
    };
    this.opts.channel.send(encodeMeta(meta));
    const done = new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    await this.pump();
    await done;
  }

  private async pump(): Promise<void> {
    while (!this.aborted) {
      const inFlight = this.nextToSendSeq - (this.highestAckedSeq + 1);
      if (inFlight >= this.windowSize) return;
      if (this.nextToSendSeq >= this.plan.length) return;
      const c = this.plan[this.nextToSendSeq]!;
      this.nextToSendSeq++;
      const body = await this.opts.file.slice(c.start, c.end);
      await this.waitForBuffer();
      if (this.aborted) return;
      try {
        this.opts.channel.send(encodeChunk(c.seq, body));
      } catch (err) {
        this.rejectDone?.(err instanceof Error ? err : new Error(String(err)));
        return;
      }
    }
  }

  private bytesAcked(): number {
    const seq = this.highestAckedSeq;
    if (seq < 0) return 0;
    if (seq >= this.plan.length - 1) return this.opts.file.size;
    return (seq + 1) * this.chunkSize;
  }

  private async waitForBuffer(): Promise<void> {
    const ch = this.opts.channel;
    if (typeof ch.bufferedAmount !== 'number' || !ch.addEventListener) return;
    const threshold = ch.bufferedAmountLowThreshold ?? 256 * 1024;
    if (ch.bufferedAmount <= threshold) return;
    await new Promise<void>((resolve) => {
      const onLow = () => {
        ch.removeEventListener?.('bufferedamountlow', onLow);
        resolve();
      };
      ch.addEventListener?.('bufferedamountlow', onLow);
    });
  }
}
