import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { parseWireMessage, type WireMessage } from './messages.js';

export interface SignalingPeerOptions {
  /** Custom broker (dev-only; ignored in prod builds). */
  brokerUrl?: string | undefined;
  /** Peer-id to register (XXX-XXX form). */
  peerId: string;
}

export interface IncomingConnection {
  conn: SignalingChannel;
  remotePeerId: string;
}

export type ConnectionListener = (incoming: IncomingConnection) => void;
export type ErrorListener = (err: PeerError) => void;

export class PeerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PeerError';
  }
}

/**
 * Wraps PeerJS. Single peer per session. Exposes:
 *  - dial(remotePeerId) -> SignalingChannel
 *  - onConnection(cb) -> handler for incoming dials
 *  - onError(cb)
 *  - close()
 */
export class SignalingPeer {
  private readonly peer: Peer;
  private readonly connectionListeners: ConnectionListener[] = [];
  private readonly errorListeners: ErrorListener[] = [];
  public readonly localPeerId: string;
  private opened = false;
  private closed = false;

  constructor(options: SignalingPeerOptions) {
    this.localPeerId = options.peerId;
    const peerOpts: PeerOptions = {};
    if (options.brokerUrl) {
      const url = new URL(options.brokerUrl);
      peerOpts.host = url.hostname;
      if (url.port) peerOpts.port = parseInt(url.port, 10);
      peerOpts.secure = url.protocol === 'wss:' || url.protocol === 'https:';
      // PeerJS concatenates path + "peerjs" without a separator, so it needs a trailing slash.
      if (url.pathname && url.pathname !== '/') {
        peerOpts.path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
      }
    }
    this.peer = new Peer(options.peerId, peerOpts);

    this.peer.on('open', () => {
      this.opened = true;
    });
    this.peer.on('error', (err: Error & { type?: string }) => {
      const code = err.type ?? 'unknown';
      const wrapped = new PeerError(err.message, code);
      for (const l of this.errorListeners) l(wrapped);
    });
    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        const channel = new SignalingChannel(conn);
        const incoming: IncomingConnection = { conn: channel, remotePeerId: conn.peer };
        for (const l of this.connectionListeners) l(incoming);
      });
    });
  }

  async waitOpen(timeoutMs = 10_000): Promise<void> {
    if (this.opened) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new PeerError('timeout waiting for broker', 'broker-timeout'));
      }, timeoutMs);
      const onOpen = () => {
        clearTimeout(timer);
        resolve();
      };
      const onError = (err: Error & { type?: string }) => {
        clearTimeout(timer);
        reject(new PeerError(err.message, err.type ?? 'unknown'));
      };
      this.peer.once('open', onOpen);
      this.peer.once('error', onError);
    });
  }

  dial(remotePeerId: string): Promise<SignalingChannel> {
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(remotePeerId, { reliable: true, serialization: 'json' });
      const timer = setTimeout(() => {
        try {
          conn.close();
        } catch {
          // ignore
        }
        reject(new PeerError('dial timeout', 'dial-timeout'));
      }, 15_000);
      conn.on('open', () => {
        clearTimeout(timer);
        resolve(new SignalingChannel(conn));
      });
      conn.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(new PeerError(err.message, 'dial-error'));
      });
    });
  }

  onConnection(cb: ConnectionListener): void {
    this.connectionListeners.push(cb);
  }

  onError(cb: ErrorListener): void {
    this.errorListeners.push(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.peer.destroy();
    } catch {
      // ignore
    }
  }
}

export type MessageListener = (msg: WireMessage) => void;
export type ChannelCloseListener = () => void;

/** A single DataConnection wrapped with schema validation and typed events. */
export class SignalingChannel {
  private readonly messageListeners: MessageListener[] = [];
  private readonly closeListeners: ChannelCloseListener[] = [];
  private closed = false;

  constructor(private readonly conn: DataConnection) {
    conn.on('data', (raw) => {
      try {
        const msg = parseWireMessage(raw);
        for (const l of this.messageListeners) l(msg);
      } catch {
        // schema violation: drop silently. The state machine's timeout will catch a
        // sufficiently broken peer; we don't echo errors back to a potentially hostile broker.
      }
    });
    conn.on('close', () => {
      this.closed = true;
      for (const l of this.closeListeners) l();
    });
  }

  send(msg: WireMessage): void {
    if (this.closed) throw new Error('channel closed');
    this.conn.send(msg);
  }

  onMessage(cb: MessageListener): void {
    this.messageListeners.push(cb);
  }

  onClose(cb: ChannelCloseListener): void {
    this.closeListeners.push(cb);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.conn.close();
    } catch {
      // ignore
    }
  }
}
