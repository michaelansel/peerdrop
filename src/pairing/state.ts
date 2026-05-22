import { computeCommit, oppositeRole, verifyCommit, type Role } from './commit.js';
import { computeSas } from './sas.js';
import type { WireMessage } from '../signaling/messages.js';
import { extractFingerprint } from '../webrtc/sdp.js';
import { randomHex } from '../utils/hash.js';

export type PairingPhase =
  | 'idle'
  | 'commit-sent'
  | 'commit-exchanged'
  | 'reveal-sent'
  | 'reveal-exchanged'
  | 'sdp-exchanged'
  | 'channel-open'
  | 'awaiting-confirm'
  | 'confirmed'
  | 'aborted';

export const STATE_TIMEOUT_MS = 30_000;

export interface PairingDependencies {
  pc: RTCPeerConnection;
  localFp: string;
  role: Role;
  selfPeerId: string;
  peerPeerId: string;
  send: (msg: WireMessage) => void;
  onChannelOpen?: (channel: RTCDataChannel) => void;
  /** Inject a deterministic nonce (tests only). Defaults to a fresh 16-byte random hex. */
  nonceOverride?: string | undefined;
  /** Defaults to STATE_TIMEOUT_MS. */
  timeoutMs?: number | undefined;
  /** For tests: hook to advance fake timers. Defaults to global setTimeout/clearTimeout. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export type PairingEvent =
  | { type: 'phase'; phase: PairingPhase }
  | { type: 'sas'; sas: string }
  | { type: 'confirmed-remote' }
  | { type: 'channel-open'; channel: RTCDataChannel }
  | { type: 'aborted'; reason: string };

export type PairingListener = (event: PairingEvent) => void;

/**
 * Drives steps 0..11 of the pairing protocol. Step 0 (cert pre-generation) is done by the
 * caller; we receive `pc` and `localFp` already prepared.
 *
 * The state machine is symmetric in the dialer / answerer roles except that the dialer is
 * responsible for creating the WebRTC offer once both reveals have been verified. ICE
 * candidates flow in both directions throughout the SDP exchange phase.
 */
export class PairingStateMachine {
  private phase: PairingPhase = 'idle';
  private readonly nonce: string;
  private selfCommit?: string;
  private peerCommit?: string;
  private peerFp?: string;
  private peerNonce?: string;
  private sas?: string;
  private remoteConfirmed = false;
  private localConfirmed = false;
  private dataChannel?: RTCDataChannel;
  private channelOpenFired = false;
  private sasEmitted = false;
  private aborted = false;
  private revealSent = false;
  private offerSent = false;
  private answerSent = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly listeners: PairingListener[] = [];
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly timeoutMs: number;
  private readonly seenMessageTypes = new Set<WireMessage['type']>();

  constructor(private readonly deps: PairingDependencies) {
    this.nonce = deps.nonceOverride ?? randomHex(16);
    // Bind setTimeout/clearTimeout to globalThis so they keep their browser binding
    // when invoked via `this.setTimeoutFn(...)`. Without bind() the browser throws
    // "Illegal invocation" because setTimeout requires `this === window`.
    this.setTimeoutFn = (deps.setTimeoutFn ?? setTimeout.bind(globalThis)) as typeof setTimeout;
    this.clearTimeoutFn = (deps.clearTimeoutFn ?? clearTimeout.bind(globalThis)) as typeof clearTimeout;
    this.timeoutMs = deps.timeoutMs ?? STATE_TIMEOUT_MS;

    // Wire up DataChannel observation. The dialer creates the channel as part of createOffer
    // below; the answerer receives it via ondatachannel.
    this.deps.pc.addEventListener('datachannel', (ev) => {
      const e = ev as RTCDataChannelEvent;
      this.attachDataChannel(e.channel);
    });
    this.deps.pc.addEventListener('icecandidate', (ev) => {
      const e = ev as RTCPeerConnectionIceEvent;
      if (e.candidate && !this.aborted) {
        this.deps.send({ type: 'ice', candidate: e.candidate.toJSON() });
      }
    });
    // `disconnected` is recoverable in WebRTC (typically transient ICE-keepalive loss),
    // so we only abort on the terminal states.
    this.deps.pc.addEventListener('connectionstatechange', () => {
      const s = this.deps.pc.connectionState;
      if (s === 'failed' || s === 'closed') {
        if (!this.aborted) this.markAborted(`pc-${s}`);
      }
    });
    this.deps.pc.addEventListener('iceconnectionstatechange', () => {
      const s = this.deps.pc.iceConnectionState;
      if (s === 'failed' || s === 'closed') {
        if (!this.aborted) this.markAborted(`ice-${s}`);
      }
    });
  }

  on(listener: PairingListener): void {
    this.listeners.push(listener);
  }

  /** Begin the protocol: compute and send our commit. */
  async start(): Promise<void> {
    this.setPhase('idle');
    this.armTimeout();
    this.selfCommit = await computeCommit({
      role: this.deps.role,
      selfPeerId: this.deps.selfPeerId,
      peerPeerId: this.deps.peerPeerId,
      fp: this.deps.localFp,
      nonce: this.nonce,
    });
    this.deps.send({ type: 'commit', commit: this.selfCommit });
    if (this.deps.role === 'dialer') {
      this.dataChannel = this.deps.pc.createDataChannel('file', { ordered: true });
      this.attachDataChannel(this.dataChannel);
    }
    this.setPhase('commit-sent');
    // If the peer's commit arrived while we were still computing ours, we can now reveal.
    if (this.peerCommit !== undefined) this.maybeSendReveal();
  }

  /** Feed a message from the broker DataConnection. */
  async handleMessage(msg: WireMessage): Promise<void> {
    if (this.aborted) return;
    // `ice` may arrive many times; `confirm` is idempotent UX dimming; `abort` ends the
    // session regardless of state. All other non-ICE message types are once-only — a
    // duplicate is treated as a protocol violation and aborts.
    const enforceOnce = msg.type !== 'ice' && msg.type !== 'confirm' && msg.type !== 'abort';
    if (enforceOnce) {
      if (this.seenMessageTypes.has(msg.type)) {
        return this.abort(`duplicate-${msg.type}`);
      }
      this.seenMessageTypes.add(msg.type);
    }

    try {
      switch (msg.type) {
        case 'commit':
          await this.onCommit(msg.commit);
          break;
        case 'reveal':
          await this.onReveal(msg.fp, msg.nonce);
          break;
        case 'offer':
          await this.onOffer(msg.sdp);
          break;
        case 'answer':
          await this.onAnswer(msg.sdp);
          break;
        case 'ice':
          await this.onIce(msg.candidate);
          break;
        case 'confirm':
          this.onConfirm();
          break;
        case 'abort':
          this.markAborted(`peer:${msg.reason}`);
          break;
      }
    } catch (err) {
      this.abort(err instanceof Error ? err.message : String(err));
    }
  }

  /** Called when the user clicks the local "I have compared this SAS..." button. */
  confirmLocal(): void {
    if (this.aborted) return;
    if (this.phase !== 'awaiting-confirm' && this.phase !== 'channel-open') {
      return;
    }
    this.localConfirmed = true;
    this.deps.send({ type: 'confirm' });
    this.advanceIfConfirmed();
  }

  /** Forcibly tear down (UI-initiated cancellation). */
  abort(reason: string): void {
    if (this.aborted) return;
    try {
      this.deps.send({ type: 'abort', reason });
    } catch {
      // channel may already be gone
    }
    this.markAborted(reason);
  }

  get currentPhase(): PairingPhase {
    return this.phase;
  }

  get currentSas(): string | undefined {
    return this.sas;
  }

  get isLocalConfirmed(): boolean {
    return this.localConfirmed;
  }

  get isRemoteConfirmed(): boolean {
    return this.remoteConfirmed;
  }

  private async onCommit(commit: string): Promise<void> {
    if (this.peerCommit !== undefined) return; // duplicate already handled by seenMessageTypes
    this.peerCommit = commit;
    this.maybeSendReveal();
  }

  /**
   * Send our reveal once both commits are exchanged. Safe to call from either side: it
   * only fires once both selfCommit and peerCommit are set, and only once.
   */
  private maybeSendReveal(): void {
    if (this.revealSent) return;
    if (this.selfCommit === undefined || this.peerCommit === undefined) return;
    this.revealSent = true;
    this.setPhase('commit-exchanged');
    this.deps.send({ type: 'reveal', fp: this.deps.localFp, nonce: this.nonce });
    this.setPhase('reveal-sent');
  }

  private async onReveal(peerFp: string, peerNonce: string): Promise<void> {
    if (this.peerFp !== undefined) return; // duplicate already handled
    if (!this.peerCommit) {
      return this.abort('reveal-before-commit');
    }
    const ok = await verifyCommit(this.peerCommit, {
      role: oppositeRole(this.deps.role),
      selfPeerId: this.deps.peerPeerId,
      peerPeerId: this.deps.selfPeerId,
      fp: peerFp,
      nonce: peerNonce,
    });
    if (!ok) {
      return this.abort('commit-mismatch');
    }
    this.peerFp = peerFp;
    this.peerNonce = peerNonce;
    this.setPhase('reveal-exchanged');

    // The dialer drives offer/answer once it has both reveals (its own already sent,
    // peer's just received).
    if (this.deps.role === 'dialer' && this.revealSent && !this.offerSent) {
      this.offerSent = true;
      const offer = await this.deps.pc.createOffer();
      await this.deps.pc.setLocalDescription(offer);
      this.deps.send({ type: 'offer', sdp: offer.sdp! });
    }
  }

  private async onOffer(sdp: string): Promise<void> {
    if (this.deps.role !== 'answerer') {
      return this.abort('unexpected-offer');
    }
    if (this.peerFp === undefined) {
      return this.abort('offer-before-reveal');
    }
    if (this.answerSent) return; // duplicate already handled
    if (!this.assertSdpFp(sdp, 'offer')) return;
    await this.deps.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this.deps.pc.createAnswer();
    await this.deps.pc.setLocalDescription(answer);
    this.answerSent = true;
    this.deps.send({ type: 'answer', sdp: answer.sdp! });
    this.setPhase('sdp-exchanged');
    void this.maybeAdvanceToSas();
  }

  private async onAnswer(sdp: string): Promise<void> {
    if (this.deps.role !== 'dialer') {
      return this.abort('unexpected-answer');
    }
    if (this.peerFp === undefined) {
      return this.abort('answer-before-reveal');
    }
    if (!this.assertSdpFp(sdp, 'answer')) return;
    await this.deps.pc.setRemoteDescription({ type: 'answer', sdp });
    this.setPhase('sdp-exchanged');
    void this.maybeAdvanceToSas();
  }

  private async onIce(candidate: RTCIceCandidateInit): Promise<void> {
    // ICE may arrive before or after the answer; the browser tolerates buffering.
    try {
      await this.deps.pc.addIceCandidate(candidate);
    } catch {
      // Invalid candidates are a soft error; do not abort.
    }
  }

  private onConfirm(): void {
    this.remoteConfirmed = true;
    this.emit({ type: 'confirmed-remote' });
    this.advanceIfConfirmed();
  }

  private advanceIfConfirmed(): void {
    if (this.localConfirmed && this.remoteConfirmed && this.phase !== 'confirmed' && !this.aborted) {
      this.setPhase('confirmed');
    }
  }

  private assertSdpFp(sdp: string, label: string): boolean {
    if (!this.peerFp) {
      this.abort(`${label}-no-peer-fp`);
      return false;
    }
    try {
      const sdpFp = extractFingerprint(sdp);
      if (sdpFp !== this.peerFp) {
        this.abort(`${label}-fp-mismatch`);
        return false;
      }
      return true;
    } catch {
      this.abort(`${label}-malformed`);
      return false;
    }
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    channel.binaryType = 'arraybuffer';
    const onOpen = () => {
      this.channelOpenFired = true;
      void this.maybeAdvanceToSas();
    };
    const onClose = () => {
      if (!this.aborted) this.markAborted('channel-closed');
    };
    if (channel.readyState === 'open') {
      onOpen();
    } else {
      channel.addEventListener('open', onOpen);
    }
    channel.addEventListener('close', onClose);
  }

  private async maybeAdvanceToSas(): Promise<void> {
    if (this.aborted || this.sasEmitted) return;
    if (!this.channelOpenFired) return;
    if (!this.selfCommit || !this.peerCommit || !this.peerFp || !this.peerNonce) return;
    if (this.phase !== 'sdp-exchanged') return;
    this.sasEmitted = true;
    this.setPhase('channel-open');
    this.sas = await this.computeAndEmitSas();
    this.setPhase('awaiting-confirm');
    if (this.dataChannel) {
      this.emit({ type: 'channel-open', channel: this.dataChannel });
      this.deps.onChannelOpen?.(this.dataChannel);
    }
  }

  private async computeAndEmitSas(): Promise<string> {
    if (!this.selfCommit || !this.peerCommit || !this.peerFp || !this.peerNonce) {
      throw new Error('cannot compute SAS without exchanged values');
    }
    const sas = await computeSas({
      role: this.deps.role,
      selfPeerId: this.deps.selfPeerId,
      peerPeerId: this.deps.peerPeerId,
      selfCommit: this.selfCommit,
      peerCommit: this.peerCommit,
      selfFp: this.deps.localFp,
      peerFp: this.peerFp,
      selfNonce: this.nonce,
      peerNonce: this.peerNonce,
    });
    this.emit({ type: 'sas', sas });
    return sas;
  }

  private setPhase(phase: PairingPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.armTimeout();
    this.emit({ type: 'phase', phase });
  }

  private armTimeout(): void {
    if (this.timer) this.clearTimeoutFn(this.timer);
    if (
      this.aborted ||
      this.phase === 'confirmed' ||
      this.phase === 'awaiting-confirm' ||
      this.phase === 'channel-open'
    ) {
      return;
    }
    this.timer = this.setTimeoutFn(() => this.abort(`timeout-${this.phase}`), this.timeoutMs);
  }

  private markAborted(reason: string): void {
    if (this.aborted) return;
    this.aborted = true;
    if (this.timer) this.clearTimeoutFn(this.timer);
    this.setPhase('aborted');
    this.emit({ type: 'aborted', reason });
  }

  private emit(event: PairingEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // ignore listener errors
      }
    }
  }
}
