import { SAS_DIGITS } from '../pairing/sas.js';

export const CONFIRM_BUTTON_COPY =
  'I have compared this SAS with the other device and they match';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<HTMLElementTagNameMap[K]> & { class?: string; dataset?: Record<string, string> } = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'class') {
      node.className = String(value);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value as Record<string, string>)) {
        node.dataset[dk] = dv;
      }
    } else {
      // @ts-expect-error generic property assignment
      node[key] = value;
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      node.appendChild(document.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

/**
 * Render a SAS code. Returns the DOM element. The displayed string always has SAS_DIGITS
 * characters — leading zeros are preserved so e.g. "000042" is shown in full.
 */
export function sasDisplay(sas: string): HTMLDivElement {
  if (sas.length !== SAS_DIGITS) {
    throw new Error(`SAS must be ${SAS_DIGITS} digits; got ${sas.length}`);
  }
  return el('div', { class: 'sas', dataset: { testid: 'sas-display' } }, [sas]);
}

export interface PeerIdPairProps {
  selfPeerId: string;
  remotePeerId: string;
}

export function peerIdPair(props: PeerIdPairProps): HTMLDivElement {
  return el('div', { class: 'peer-ids' }, [
    el('div', { class: 'peer-id-block', dataset: { testid: 'self-peer-id' } }, [
      el('span', { class: 'label' }, ['Your code']),
      el('span', { class: 'value' }, [props.selfPeerId]),
    ]),
    el('div', { class: 'peer-id-block', dataset: { testid: 'remote-peer-id' } }, [
      el('span', { class: 'label' }, ['Connected to']),
      el('span', { class: 'value' }, [props.remotePeerId]),
    ]),
  ]);
}

export function confirmButton(onClick: () => void, enabled: boolean): HTMLButtonElement {
  return el(
    'button',
    {
      disabled: !enabled,
      dataset: { testid: 'confirm-button' },
      onclick: onClick,
    },
    [CONFIRM_BUTTON_COPY],
  );
}

export function progressBar(percent: number): HTMLDivElement {
  const pct = Math.max(0, Math.min(100, percent));
  const bar = el('div', { class: 'progress-bar' });
  bar.setAttribute('style', `width:${pct}%`);
  return el('div', { class: 'progress' }, [bar]);
}

export function status(text: string, kind: 'info' | 'error' | 'ok' = 'info'): HTMLDivElement {
  const cls = kind === 'info' ? 'status' : `status ${kind}`;
  return el('div', { class: cls }, [text]);
}
