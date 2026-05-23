import { FileReceiver } from './receiver.js';
import { FileSender } from './sender.js';
import { decodeFrame, FRAME } from './protocol.js';

export type TransferEvent =
  | { type: 'recv-meta'; id: string; name: string; size: number }
  | { type: 'recv-progress'; id: string; receivedBytes: number; totalBytes: number }
  | { type: 'recv-complete'; id: string; name: string; blob: Blob }
  | { type: 'recv-error'; reason: string }
  | { type: 'send-progress'; name: string; sentBytes: number; totalBytes: number }
  | { type: 'send-done'; name: string }
  | { type: 'send-error'; name: string; reason: string };

export type TransferListener = (event: TransferEvent) => void;

/**
 * Owns the file-transfer DataChannel after pairing succeeds. Demultiplexes incoming frames:
 * ACK frames feed the current outbound FileSender; everything else feeds the FileReceiver.
 */
export class TransferController {
  private readonly receiver: FileReceiver;
  private activeSender?: FileSender;
  private activeFileName?: string;
  private readonly listeners: TransferListener[] = [];
  private receiverMetaId?: string;

  constructor(private readonly dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    this.receiver = new FileReceiver({ send: (data) => dc.send(data as unknown as ArrayBuffer) });
    this.receiver.on('meta', (meta) => {
      this.receiverMetaId = meta.id;
      this.emit({ type: 'recv-meta', id: meta.id, name: meta.name, size: meta.size });
    });
    this.receiver.on('progress', ({ receivedBytes, totalBytes }) => {
      if (this.receiverMetaId) {
        this.emit({
          type: 'recv-progress',
          id: this.receiverMetaId,
          receivedBytes,
          totalBytes,
        });
      }
    });
    this.receiver.on('complete', ({ id, name, blob }) => {
      this.emit({ type: 'recv-complete', id, name, blob });
    });
    this.receiver.on('error', ({ reason }) => {
      this.emit({ type: 'recv-error', reason });
    });
    dc.addEventListener('message', (ev) => this.dispatch((ev as MessageEvent).data));
  }

  on(listener: TransferListener): void {
    this.listeners.push(listener);
  }

  async sendFile(file: {
    name: string;
    size: number;
    slice: (start: number, end: number) => Promise<Uint8Array>;
  }): Promise<void> {
    if (this.activeSender) {
      throw new Error('a transfer is already in progress');
    }
    this.activeFileName = file.name;
    const dc = this.dc;
    const sender = new FileSender({
      channel: {
        send: (data: Uint8Array) => dc.send(data as unknown as ArrayBuffer),
        get bufferedAmount() {
          return dc.bufferedAmount;
        },
        get bufferedAmountLowThreshold() {
          return dc.bufferedAmountLowThreshold;
        },
        addEventListener: (t: string, l: () => void) =>
          dc.addEventListener(t as 'bufferedamountlow', l),
        removeEventListener: (t: string, l: () => void) =>
          dc.removeEventListener(t as 'bufferedamountlow', l),
      },
      file,
      onProgress: (sentBytes, totalBytes) => {
        this.emit({ type: 'send-progress', name: file.name, sentBytes, totalBytes });
      },
    });
    this.activeSender = sender;
    try {
      await sender.run();
      this.emit({ type: 'send-done', name: file.name });
    } catch (err) {
      this.emit({
        type: 'send-error',
        name: file.name,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this.activeSender = undefined;
      this.activeFileName = undefined;
    }
  }

  private dispatch(raw: unknown): void {
    const bytes =
      raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : raw instanceof Uint8Array
          ? raw
          : undefined;
    if (!bytes || bytes.length === 0) return;
    if (bytes[0] === FRAME.ACK && this.activeSender) {
      try {
        const frame = decodeFrame(bytes);
        if (frame.type === 'ack') this.activeSender.handleAck(frame.seq);
      } catch {
        // ignore malformed ACK
      }
      return;
    }
    this.receiver.handleFrame(bytes);
  }

  private emit(event: TransferEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // ignore
      }
    }
  }

  get inFlightFile(): string | undefined {
    return this.activeFileName;
  }
}
