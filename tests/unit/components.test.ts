import { describe, it, expect } from 'vitest';
import {
  CONFIRM_BUTTON_COPY,
  confirmButton,
  peerIdPair,
  progressBar,
  sasDisplay,
  status,
} from '../../src/ui/components.js';

describe('ui components', () => {
  it('CONFIRM_BUTTON_COPY is exactly the required string', () => {
    expect(CONFIRM_BUTTON_COPY).toBe(
      'I have compared this SAS with the other device and they match',
    );
  });

  it('sasDisplay shows all six digits including leading zeros', () => {
    const el = sasDisplay('000042');
    expect(el.textContent).toBe('000042');
    expect(el.textContent?.length).toBe(6);
    expect(el.dataset['testid']).toBe('sas-display');
  });

  it('sasDisplay rejects non-6-digit input', () => {
    expect(() => sasDisplay('12345')).toThrow();
    expect(() => sasDisplay('1234567')).toThrow();
  });

  it('confirmButton uses the verbatim copy and respects enabled flag', () => {
    const enabled = confirmButton(() => undefined, true);
    expect(enabled.textContent).toBe(CONFIRM_BUTTON_COPY);
    expect(enabled.disabled).toBe(false);

    const disabled = confirmButton(() => undefined, false);
    expect(disabled.disabled).toBe(true);
  });

  it('confirmButton click invokes the handler when enabled', () => {
    let clicked = 0;
    const btn = confirmButton(() => clicked++, true);
    btn.click();
    expect(clicked).toBe(1);
  });

  it('peerIdPair renders both peer-ids in XXX-XXX form', () => {
    const node = peerIdPair({ selfPeerId: 'ABC-123', remotePeerId: 'XYZ-789' });
    const self = node.querySelector('[data-testid="self-peer-id"]');
    const remote = node.querySelector('[data-testid="remote-peer-id"]');
    expect(self?.textContent).toContain('ABC-123');
    expect(remote?.textContent).toContain('XYZ-789');
  });

  it('progressBar clamps percent to 0..100', () => {
    const a = progressBar(-10);
    const aBar = a.querySelector('.progress-bar') as HTMLElement;
    expect(aBar.getAttribute('style')).toContain('width:0%');
    const b = progressBar(150);
    const bBar = b.querySelector('.progress-bar') as HTMLElement;
    expect(bBar.getAttribute('style')).toContain('width:100%');
  });

  it('status renders text with the kind class', () => {
    expect(status('hi', 'info').className).toBe('status');
    expect(status('uh-oh', 'error').className).toBe('status error');
    expect(status('ok', 'ok').className).toBe('status ok');
  });
});
