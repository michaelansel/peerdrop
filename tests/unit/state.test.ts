import { describe, it, expect, vi } from 'vitest';
import {
  PairingStateMachine,
  STATE_TIMEOUT_MS,
  type PairingDependencies,
  type PairingEvent,
  type PairingPhase,
} from '../../src/pairing/state.js';
import type { WireMessage } from '../../src/signaling/messages.js';
import { computeCommit, oppositeRole, type Role } from '../../src/pairing/commit.js';

/** Minimal RTCPeerConnection stub usable in jsdom (no real WebRTC). */
function fakePc(opts: { role: Role; localFp: string }): {
  pc: RTCPeerConnection;
  emitChannel: (label: string) => MockChannel;
  pendingChannels: MockChannel[];
  setRemote?: (sdp: string) => void;
} {
  const listeners = new Map<string, Array<(ev: Event) => void>>();
  const pendingChannels: MockChannel[] = [];
  const pc = {
    createDataChannel(label: string): RTCDataChannel {
      const ch = new MockChannel(label);
      pendingChannels.push(ch);
      // Mark as open asynchronously.
      queueMicrotask(() => ch.open());
      return ch as unknown as RTCDataChannel;
    },
    createOffer: async () => ({
      type: 'offer',
      sdp: sdpWithFp(opts.localFp),
    }),
    createAnswer: async () => ({
      type: 'answer',
      sdp: sdpWithFp(opts.localFp),
    }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
    addIceCandidate: async () => undefined,
    addEventListener(name: string, cb: (ev: Event) => void) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name)!.push(cb);
    },
    removeEventListener() {
      // no-op
    },
    close() {},
  } as unknown as RTCPeerConnection;

  void opts.role;
  return {
    pc,
    emitChannel: (label: string) => {
      const ch = new MockChannel(label);
      const ev = { channel: ch as unknown as RTCDataChannel } as unknown as Event;
      (listeners.get('datachannel') ?? []).forEach((cb) => cb(ev));
      queueMicrotask(() => ch.open());
      return ch;
    },
    pendingChannels,
  };
}

class MockChannel {
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer';
  readyState: 'connecting' | 'open' | 'closed' = 'connecting';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  private openListeners: Array<() => void> = [];
  private messageListeners: Array<(ev: MessageEvent) => void> = [];
  constructor(public label: string) {}
  addEventListener(name: string, cb: () => void): void {
    if (name === 'open') this.openListeners.push(cb);
    if (name === 'message') this.messageListeners.push(cb as (ev: MessageEvent) => void);
  }
  removeEventListener() {}
  send() {}
  close() {
    this.readyState = 'closed';
  }
  open() {
    this.readyState = 'open';
    for (const cb of this.openListeners) cb();
  }
}

function sdpWithFp(canonicalFp: string): string {
  const upper = canonicalFp.toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < upper.length; i += 2) groups.push(upper.slice(i, i + 2));
  return `v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 ${groups.join(':')}\r\n`;
}

interface Harness {
  sm: PairingStateMachine;
  sent: WireMessage[];
  events: PairingEvent[];
  deps: PairingDependencies;
  emitChannel: (label: string) => MockChannel;
}

function buildHarness(overrides: Partial<PairingDependencies> = {}): Harness {
  const role: Role = overrides.role ?? 'dialer';
  const localFp = overrides.localFp ?? 'a'.repeat(64);
  const { pc, emitChannel } = fakePc({ role, localFp });
  const sent: WireMessage[] = [];
  const events: PairingEvent[] = [];
  const deps: PairingDependencies = {
    pc,
    localFp,
    role,
    selfPeerId: overrides.selfPeerId ?? 'ABC-123',
    peerPeerId: overrides.peerPeerId ?? 'XYZ-789',
    send: overrides.send ?? ((m: WireMessage) => sent.push(m)),
    // An explicit `nonceOverride: undefined` opts into a fresh random nonce; omitting
    // the key gives the deterministic test default.
    nonceOverride: 'nonceOverride' in overrides ? overrides.nonceOverride : '1'.repeat(32),
    timeoutMs: overrides.timeoutMs ?? STATE_TIMEOUT_MS,
  };
  const sm = new PairingStateMachine(deps);
  sm.on((ev) => events.push(ev));
  return { sm, sent, events, deps, emitChannel };
}

async function peerCommit(deps: PairingDependencies, peerNonce: string, peerFp: string) {
  return computeCommit({
    role: oppositeRole(deps.role),
    selfPeerId: deps.peerPeerId,
    peerPeerId: deps.selfPeerId,
    fp: peerFp,
    nonce: peerNonce,
  });
}

describe('PairingStateMachine — happy path (dialer)', () => {
  it('drives the legal sequence and ends at awaiting-confirm with a SAS', async () => {
    const h = buildHarness({ role: 'dialer' });
    const peerFp = 'b'.repeat(64);
    const peerNonce = '2'.repeat(32);
    const peerCmt = await peerCommit(h.deps, peerNonce, peerFp);

    await h.sm.start();
    expect(h.sent[0]?.type).toBe('commit');
    expect(h.sm.currentPhase).toBe('commit-sent');

    await h.sm.handleMessage({ type: 'commit', commit: peerCmt });
    expect(h.sent[1]?.type).toBe('reveal');
    expect(h.sm.currentPhase).toBe('reveal-sent');

    await h.sm.handleMessage({ type: 'reveal', fp: peerFp, nonce: peerNonce });
    expect(h.sm.currentPhase).toBe('reveal-exchanged');
    // Dialer creates offer
    const offer = h.sent.find((m) => m.type === 'offer');
    expect(offer).toBeDefined();

    // Peer answer (matches peerFp). The channel-open microtask may already have fired
    // before this resolves, advancing the phase past sdp-exchanged.
    await h.sm.handleMessage({ type: 'answer', sdp: sdpWithFp(peerFp) });

    // Wait for queued microtask that opens the data channel.
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

    expect(['channel-open', 'awaiting-confirm']).toContain(h.sm.currentPhase);
    expect(h.sm.currentSas).toMatch(/^[0-9]{6}$/);
  });
});

describe('PairingStateMachine — answerer flow', () => {
  it('answerer responds to offer and reaches SAS', async () => {
    const h = buildHarness({ role: 'answerer' });
    const peerFp = 'c'.repeat(64);
    const peerNonce = '3'.repeat(32);
    const peerCmt = await peerCommit(h.deps, peerNonce, peerFp);

    await h.sm.start();
    await h.sm.handleMessage({ type: 'commit', commit: peerCmt });
    await h.sm.handleMessage({ type: 'reveal', fp: peerFp, nonce: peerNonce });
    expect(h.sm.currentPhase).toBe('reveal-exchanged');
    // Dialer is the peer; we receive an offer.
    await h.sm.handleMessage({ type: 'offer', sdp: sdpWithFp(peerFp) });
    expect(h.sent.find((m) => m.type === 'answer')).toBeDefined();
    expect(h.sm.currentPhase).toBe('sdp-exchanged');
    // Trigger our own data channel open via the ondatachannel listener.
    h.emitChannel('file');
    await Promise.resolve();
    for (let _i = 0; _i < 10; _i++) await new Promise((r) => setTimeout(r, 0));
    expect(['channel-open', 'awaiting-confirm']).toContain(h.sm.currentPhase);
    expect(h.sm.currentSas).toMatch(/^[0-9]{6}$/);
  });
});

describe('PairingStateMachine — protocol violations', () => {
  it('aborts on a commit-mismatch (tampered reveal)', async () => {
    const h = buildHarness({ role: 'dialer' });
    const peerFp = 'd'.repeat(64);
    const peerNonce = '4'.repeat(32);
    const peerCmt = await peerCommit(h.deps, peerNonce, peerFp);

    await h.sm.start();
    await h.sm.handleMessage({ type: 'commit', commit: peerCmt });
    // Tamper: claim a different fp than what was committed to.
    await h.sm.handleMessage({ type: 'reveal', fp: 'e'.repeat(64), nonce: peerNonce });
    expect(h.sm.currentPhase).toBe('aborted');
    const abortEv = h.events.find((e) => e.type === 'aborted') as
      | { type: 'aborted'; reason: string }
      | undefined;
    expect(abortEv?.reason).toBe('commit-mismatch');
  });

  it('aborts when remote SDP fingerprint != revealed fp', async () => {
    const h = buildHarness({ role: 'dialer' });
    const peerFp = 'd'.repeat(64);
    const peerNonce = '5'.repeat(32);
    const peerCmt = await peerCommit(h.deps, peerNonce, peerFp);

    await h.sm.start();
    await h.sm.handleMessage({ type: 'commit', commit: peerCmt });
    await h.sm.handleMessage({ type: 'reveal', fp: peerFp, nonce: peerNonce });
    // Send an answer whose SDP fp differs from what was revealed.
    await h.sm.handleMessage({ type: 'answer', sdp: sdpWithFp('f'.repeat(64)) });
    expect(h.sm.currentPhase).toBe('aborted');
    const ev = h.events.find((e) => e.type === 'aborted') as
      | { type: 'aborted'; reason: string }
      | undefined;
    expect(ev?.reason).toBe('answer-fp-mismatch');
  });

  it('aborts on a duplicate commit', async () => {
    const h = buildHarness({ role: 'dialer' });
    await h.sm.start();
    await h.sm.handleMessage({ type: 'commit', commit: 'a'.repeat(64) });
    await h.sm.handleMessage({ type: 'commit', commit: 'a'.repeat(64) });
    expect(h.sm.currentPhase).toBe('aborted');
    const ev = h.events.find((e) => e.type === 'aborted') as
      | { type: 'aborted'; reason: string }
      | undefined;
    expect(ev?.reason).toBe('duplicate-commit');
  });

  it('aborts on a duplicate reveal', async () => {
    const h = buildHarness({ role: 'dialer' });
    const peerFp = 'd'.repeat(64);
    const peerNonce = '6'.repeat(32);
    const peerCmt = await peerCommit(h.deps, peerNonce, peerFp);
    await h.sm.start();
    await h.sm.handleMessage({ type: 'commit', commit: peerCmt });
    await h.sm.handleMessage({ type: 'reveal', fp: peerFp, nonce: peerNonce });
    await h.sm.handleMessage({ type: 'reveal', fp: peerFp, nonce: peerNonce });
    expect(h.sm.currentPhase).toBe('aborted');
  });

  it('rejects an offer when in the wrong phase', async () => {
    const h = buildHarness({ role: 'answerer' });
    await h.sm.start();
    // No commit/reveal yet; offer here is out-of-order.
    await h.sm.handleMessage({ type: 'offer', sdp: sdpWithFp('a'.repeat(64)) });
    expect(h.sm.currentPhase).toBe('aborted');
  });
});

describe('PairingStateMachine — confirm semantics', () => {
  it('forged remote confirm before local click does NOT advance to confirmed', async () => {
    const h = buildHarness({ role: 'dialer' });
    const peerFp = 'd'.repeat(64);
    const peerNonce = '7'.repeat(32);
    const peerCmt = await peerCommit(h.deps, peerNonce, peerFp);
    await h.sm.start();
    await h.sm.handleMessage({ type: 'commit', commit: peerCmt });
    await h.sm.handleMessage({ type: 'reveal', fp: peerFp, nonce: peerNonce });
    await h.sm.handleMessage({ type: 'answer', sdp: sdpWithFp(peerFp) });
    for (let _i = 0; _i < 10; _i++) await new Promise((r) => setTimeout(r, 0));
    // Forged confirm
    await h.sm.handleMessage({ type: 'confirm' });
    expect(h.sm.isRemoteConfirmed).toBe(true);
    expect(h.sm.isLocalConfirmed).toBe(false);
    expect(h.sm.currentPhase).not.toBe('confirmed');
  });

  it('receiving confirm twice is idempotent (no abort)', async () => {
    const h = buildHarness({ role: 'dialer' });
    const peerFp = 'd'.repeat(64);
    const peerNonce = '8'.repeat(32);
    const peerCmt = await peerCommit(h.deps, peerNonce, peerFp);
    await h.sm.start();
    await h.sm.handleMessage({ type: 'commit', commit: peerCmt });
    await h.sm.handleMessage({ type: 'reveal', fp: peerFp, nonce: peerNonce });
    await h.sm.handleMessage({ type: 'answer', sdp: sdpWithFp(peerFp) });
    for (let _i = 0; _i < 10; _i++) await new Promise((r) => setTimeout(r, 0));
    await h.sm.handleMessage({ type: 'confirm' });
    await h.sm.handleMessage({ type: 'confirm' });
    expect(h.sm.currentPhase).not.toBe('aborted');
    expect(h.sm.isRemoteConfirmed).toBe(true);
  });

  it('transitions to confirmed only when both sides confirm', async () => {
    const h = buildHarness({ role: 'dialer' });
    const peerFp = 'd'.repeat(64);
    const peerNonce = '9'.repeat(32);
    const peerCmt = await peerCommit(h.deps, peerNonce, peerFp);
    await h.sm.start();
    await h.sm.handleMessage({ type: 'commit', commit: peerCmt });
    await h.sm.handleMessage({ type: 'reveal', fp: peerFp, nonce: peerNonce });
    await h.sm.handleMessage({ type: 'answer', sdp: sdpWithFp(peerFp) });
    for (let _i = 0; _i < 10; _i++) await new Promise((r) => setTimeout(r, 0));

    h.sm.confirmLocal();
    expect(h.sent.find((m) => m.type === 'confirm')).toBeDefined();
    expect(h.sm.currentPhase).not.toBe('confirmed');

    await h.sm.handleMessage({ type: 'confirm' });
    expect(h.sm.currentPhase).toBe('confirmed');
  });
});

describe('PairingStateMachine — abort + timeout', () => {
  it('receiving an abort cleanly tears down and surfaces reason', async () => {
    const h = buildHarness({ role: 'dialer' });
    await h.sm.start();
    await h.sm.handleMessage({ type: 'abort', reason: 'user-cancel' });
    expect(h.sm.currentPhase).toBe('aborted');
    const ev = h.events.find((e) => e.type === 'aborted') as
      | { type: 'aborted'; reason: string }
      | undefined;
    expect(ev?.reason).toContain('peer:user-cancel');
  });

  it('per-state timeout fires when the peer never responds', async () => {
    vi.useFakeTimers();
    try {
      const h = buildHarness({ role: 'dialer', timeoutMs: 1000 });
      await h.sm.start();
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      expect(h.sm.currentPhase).toBe('aborted');
      const ev = h.events.find((e) => e.type === 'aborted') as
        | { type: 'aborted'; reason: string }
        | undefined;
      expect(ev?.reason).toContain('timeout-');
    } finally {
      vi.useRealTimers();
    }
  });

  it('explicit abort sends an abort message and transitions to aborted', async () => {
    const h = buildHarness({ role: 'dialer' });
    await h.sm.start();
    h.sm.abort('user-cancel');
    expect(h.sm.currentPhase).toBe('aborted');
    expect(h.sent.find((m) => m.type === 'abort' && m.reason === 'user-cancel')).toBeDefined();
  });
});

describe('PairingStateMachine — generated nonces are fresh per instance', () => {
  it('two instances with identical inputs emit different commits (fresh random nonce)', async () => {
    const h1 = buildHarness({ nonceOverride: undefined as unknown as string });
    const h2 = buildHarness({ nonceOverride: undefined as unknown as string });
    await h1.sm.start();
    await h2.sm.start();
    const c1 = h1.sent.find((m) => m.type === 'commit');
    const c2 = h2.sent.find((m) => m.type === 'commit');
    expect(c1?.type).toBe('commit');
    expect(c2?.type).toBe('commit');
    // Same peer-ids, role, and fp; the only differing input is the per-instance nonce.
    expect((c1 as { commit: string }).commit).not.toBe((c2 as { commit: string }).commit);
  });
});

describe('PairingStateMachine — phase events', () => {
  it('emits phase events in order during the happy path', async () => {
    const h = buildHarness({ role: 'dialer' });
    const peerFp = 'd'.repeat(64);
    const peerNonce = 'a'.repeat(32);
    const peerCmt = await peerCommit(h.deps, peerNonce, peerFp);
    await h.sm.start();
    await h.sm.handleMessage({ type: 'commit', commit: peerCmt });
    await h.sm.handleMessage({ type: 'reveal', fp: peerFp, nonce: peerNonce });
    await h.sm.handleMessage({ type: 'answer', sdp: sdpWithFp(peerFp) });
    for (let _i = 0; _i < 10; _i++) await new Promise((r) => setTimeout(r, 0));
    const phases = h.events
      .filter((e): e is { type: 'phase'; phase: PairingPhase } => e.type === 'phase')
      .map((e) => e.phase);
    expect(phases).toContain('commit-sent');
    expect(phases).toContain('commit-exchanged');
    expect(phases).toContain('reveal-sent');
    expect(phases).toContain('reveal-exchanged');
    expect(phases).toContain('sdp-exchanged');
  });
});
