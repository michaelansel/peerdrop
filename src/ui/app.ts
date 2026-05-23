import { generatePeerId, normalizePeerId, formatPeerId, rawPeerId } from '../utils/peerid.js';
import { createPeerConnection } from '../webrtc/connection.js';
import { SignalingPeer, type SignalingChannel } from '../signaling/peer.js';
import { PairingStateMachine, type PairingPhase } from '../pairing/state.js';
import { TransferController, type TransferEvent } from '../transfer/controller.js';
import {
  confirmButton,
  el,
  peerIdPair,
  progressBar,
  sasDisplay,
  status,
} from './components.js';

interface AppOptions {
  brokerUrl: string | undefined;
}

interface Refs {
  root: HTMLElement;
}

interface AppState {
  selfPeerId: string;
  remotePeerId?: string;
  pairing?: PairingStateMachine;
  transfer?: TransferController;
  abortReason?: string;
  recvMeta?: { id: string; name: string; size: number };
  recvProgress?: { id: string; receivedBytes: number; totalBytes: number };
  recvComplete?: { id: string; name: string; blob: Blob };
  recvError?: string;
  sendProgress?: { name: string; sentBytes: number; totalBytes: number };
  sendDone?: string;
  sendError?: { name: string; reason: string };
}

export function mountApp(refs: Refs, opts: AppOptions): void {
  renderRegistering(refs);
  start(refs, opts).catch((err: unknown) => {
    refs.root.innerHTML = '';
    refs.root.appendChild(
      el('div', { class: 'panel' }, [
        el('h2', {}, ['Could not start']),
        status(err instanceof Error ? err.message : String(err), 'error'),
      ]),
    );
  });
}

async function start(refs: Refs, opts: AppOptions): Promise<void> {
  const { pc, localFp } = await createPeerConnection();
  const selfPeerId = generatePeerId();
  const state: AppState = { selfPeerId };

  const signaling = new SignalingPeer({ peerId: selfPeerId, brokerUrl: opts.brokerUrl });
  let registrationFailed = false;
  signaling.onError((err) => {
    if (err.code === 'unavailable-id' || err.code === 'is-taken') {
      registrationFailed = true;
      renderTaken(refs);
    }
  });

  try {
    await signaling.waitOpen();
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === 'unavailable-id' || e?.code === 'is-taken') {
      renderTaken(refs);
      return;
    }
    throw err;
  }
  if (registrationFailed) return;

  const handleConnection = async (
    channel: SignalingChannel,
    remotePeerIdRaw: string,
    role: 'dialer' | 'answerer',
  ): Promise<void> => {
    if (state.pairing) return;
    const remotePeerId = formatPeerId(rawPeerId(remotePeerIdRaw));
    state.remotePeerId = remotePeerId;
    const pairing = new PairingStateMachine({
      pc,
      localFp,
      role,
      selfPeerId,
      peerPeerId: remotePeerId,
      send: (msg) => channel.send(msg),
      onChannelOpen: (dc) => {
        const transfer = new TransferController(dc);
        state.transfer = transfer;
        transfer.on((ev) => onTransferEvent(state, ev, refs));
      },
    });
    state.pairing = pairing;
    channel.onMessage((msg) => void pairing.handleMessage(msg));
    channel.onClose(() => pairing.abort('channel-closed'));
    pairing.on((ev) => {
      if (ev.type === 'aborted') state.abortReason = ev.reason;
      render(refs, state);
    });
    render(refs, state);
    await pairing.start();
  };

  signaling.onConnection((incoming) => {
    void handleConnection(incoming.conn, incoming.remotePeerId, 'answerer');
  });

  renderIdle(refs, state, async (typed) => {
    let normalized: string;
    try {
      normalized = normalizePeerId(typed);
    } catch (err) {
      renderIdleWithError(refs, state, err instanceof Error ? err.message : String(err));
      return;
    }
    try {
      const ch = await signaling.dial(normalized);
      await handleConnection(ch, normalized, 'dialer');
    } catch (err) {
      renderIdleWithError(refs, state, err instanceof Error ? err.message : String(err));
    }
  });
}

function onTransferEvent(state: AppState, ev: TransferEvent, refs: Refs): void {
  switch (ev.type) {
    case 'recv-meta':
      state.recvMeta = { id: ev.id, name: ev.name, size: ev.size };
      break;
    case 'recv-progress':
      state.recvProgress = ev;
      break;
    case 'recv-complete':
      state.recvComplete = { id: ev.id, name: ev.name, blob: ev.blob };
      break;
    case 'recv-error':
      state.recvError = ev.reason;
      break;
    case 'send-progress':
      state.sendProgress = ev;
      break;
    case 'send-done':
      state.sendDone = ev.name;
      break;
    case 'send-error':
      state.sendError = { name: ev.name, reason: ev.reason };
      break;
  }
  render(refs, state);
}

function renderRegistering(refs: Refs): void {
  refs.root.innerHTML = '';
  refs.root.appendChild(
    el('div', { class: 'panel', dataset: { testid: 'registering' } }, [
      el('h2', {}, ['Connecting…']),
      status('Registering with the signaling broker.', 'info'),
    ]),
  );
}

function renderTaken(refs: Refs): void {
  refs.root.innerHTML = '';
  refs.root.appendChild(
    el('div', { class: 'panel', dataset: { testid: 'taken' } }, [
      el('h2', {}, ['This code is already taken']),
      status('Reload to get a new one.', 'error'),
    ]),
  );
}

function renderIdle(
  refs: Refs,
  state: AppState,
  onDial: (typed: string) => void | Promise<void>,
): void {
  refs.root.innerHTML = '';
  const input = el('input', {
    type: 'text',
    placeholder: 'ABC-DEF',
    maxLength: 7,
    dataset: { testid: 'dial-input' },
  });
  const dialBtn = el(
    'button',
    {
      dataset: { testid: 'dial-button' },
      onclick: () => void onDial(input.value),
    },
    ['Dial'],
  );
  const form = el(
    'form',
    {
      dataset: { testid: 'dial-form' },
    },
    [el('label', {}, ['Their code', input]), dialBtn],
  ) as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void onDial(input.value);
  });

  refs.root.appendChild(
    el('div', { class: 'panel', dataset: { testid: 'idle' } }, [
      el('h2', {}, ['Your code']),
      el(
        'div',
        { class: 'code', dataset: { testid: 'self-peer-id-idle' } },
        [state.selfPeerId],
      ),
      status('Share this code with the other device or type theirs below.', 'info'),
      form,
    ]),
  );
}

function renderIdleWithError(refs: Refs, state: AppState, msg: string): void {
  renderIdle(refs, state, () => {});
  refs.root
    .querySelector('[data-testid="dial-form"]')
    ?.appendChild(
      el('div', { class: 'status error', dataset: { testid: 'dial-error' } }, [msg]),
    );
}

function render(refs: Refs, state: AppState): void {
  const pairing = state.pairing;
  if (!pairing) return;
  const phase = pairing.currentPhase as PairingPhase;
  if (phase === 'aborted') {
    refs.root.innerHTML = '';
    refs.root.appendChild(
      el('div', { class: 'panel', dataset: { testid: 'aborted', reason: state.abortReason ?? 'unknown' } }, [
        el('h2', {}, ['Pairing aborted']),
        status(
          `The connection was closed before pairing completed. (${state.abortReason ?? 'unknown'})`,
          'error',
        ),
      ]),
    );
    return;
  }

  const panel = el('div', {
    class: 'panel',
    dataset: { testid: 'pairing', phase },
  });
  panel.appendChild(el('h2', {}, [phaseLabel(phase)]));
  panel.appendChild(
    peerIdPair({
      selfPeerId: state.selfPeerId,
      remotePeerId: state.remotePeerId ?? '???-???',
    }),
  );
  const sas = pairing.currentSas;
  if (sas) {
    panel.appendChild(el('div', { dataset: { testid: 'sas-section' } }, [sasDisplay(sas)]));
    panel.appendChild(
      el('p', { class: 'confirm-copy' }, [
        'Compare the digits above with the other device. They must match exactly. ',
        'Only click the button below after you have verified the match on both screens.',
      ]),
    );
    const canConfirm =
      (phase === 'awaiting-confirm' || phase === 'channel-open') && !pairing.isLocalConfirmed;
    panel.appendChild(confirmButton(() => pairing.confirmLocal(), canConfirm));
    if (pairing.isLocalConfirmed && phase !== 'confirmed') {
      panel.appendChild(status('Waiting for the other device to confirm…', 'info'));
    }
  } else {
    panel.appendChild(status('Negotiating connection…', 'info'));
  }

  if (pairing.isLocalConfirmed && state.transfer) {
    panel.appendChild(buildTransferUi(state, state.transfer));
  }

  refs.root.innerHTML = '';
  refs.root.appendChild(panel);
}

function phaseLabel(phase: PairingPhase): string {
  switch (phase) {
    case 'idle':
    case 'commit-sent':
    case 'commit-exchanged':
    case 'reveal-sent':
    case 'reveal-exchanged':
    case 'sdp-exchanged':
      return 'Pairing…';
    case 'channel-open':
    case 'awaiting-confirm':
      return 'Verify the code';
    case 'confirmed':
      return 'Paired';
    case 'aborted':
      return 'Aborted';
  }
}

function buildTransferUi(state: AppState, transfer: TransferController): HTMLElement {
  const container = el('div', { dataset: { testid: 'transfer-container' } });
  const dz = el(
    'div',
    {
      class: 'drop-zone',
      dataset: { testid: 'drop-zone' },
    },
    ['Drop a file here to send.'],
  );
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const files = (e as DragEvent).dataTransfer?.files;
    if (!files?.length) return;
    void sendFiles(transfer, Array.from(files));
  });
  container.appendChild(dz);

  if (state.recvMeta) {
    const pct = state.recvProgress
      ? Math.floor((state.recvProgress.receivedBytes / Math.max(1, state.recvProgress.totalBytes)) * 100)
      : 0;
    container.appendChild(
      el('div', { dataset: { testid: `recv-${state.recvMeta.id}` } }, [
        el('div', {}, [`Receiving: ${state.recvMeta.name} (${state.recvMeta.size} bytes)`]),
        progressBar(pct),
      ]),
    );
  }
  if (state.recvComplete) {
    const url = URL.createObjectURL(state.recvComplete.blob);
    container.appendChild(
      el(
        'a',
        {
          href: url,
          download: state.recvComplete.name,
          dataset: { testid: `download-${state.recvComplete.id}` },
        },
        [`Download ${state.recvComplete.name}`],
      ),
    );
  }
  if (state.recvError) {
    container.appendChild(status(`Receive failed: ${state.recvError}`, 'error'));
  }
  if (state.sendProgress) {
    const pct = Math.floor(
      (state.sendProgress.sentBytes / Math.max(1, state.sendProgress.totalBytes)) * 100,
    );
    container.appendChild(
      el(
        'div',
        { dataset: { testid: `send-progress-${state.sendProgress.name}` } },
        [`Sending: ${state.sendProgress.name} — ${pct}%`],
      ),
    );
  }
  if (state.sendDone) {
    container.appendChild(
      el('div', { dataset: { testid: `send-done-${state.sendDone}` } }, [
        `Sent ${state.sendDone}`,
      ]),
    );
  }
  if (state.sendError) {
    container.appendChild(
      status(`Send failed: ${state.sendError.reason}`, 'error'),
    );
  }
  return container;
}

async function sendFiles(transfer: TransferController, files: File[]): Promise<void> {
  for (const file of files) {
    await transfer.sendFile({
      name: file.name,
      size: file.size,
      slice: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
    });
  }
}
