import { test, expect } from '@playwright/test';
import { confirmPairing, dial, openApp, readSas } from './fixtures/app.js';

async function sendFileFromPage(page: import('@playwright/test').Page, name: string, bytes: Uint8Array): Promise<void> {
  await page.evaluate(
    async ({ name, bytesArray }) => {
      const buf = new Uint8Array(bytesArray);
      const file = new File([buf], name, { type: 'application/octet-stream' });
      const dz = document.querySelector('[data-testid="drop-zone"]') as HTMLElement | null;
      if (!dz) throw new Error('drop-zone not found');
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      dz.dispatchEvent(ev);
    },
    { name, bytesArray: Array.from(bytes) },
  );
}

async function downloadedBytes(
  page: import('@playwright/test').Page,
  id: string,
): Promise<Uint8Array> {
  const href = await page.getAttribute(`[data-testid="download-${id}"]`, 'href');
  if (!href) throw new Error('download link not yet rendered');
  // The href is a blob: URL belonging to the receiver page. Fetch from inside the page.
  const arr = await page.evaluate(async (h) => {
    const r = await fetch(h);
    const buf = new Uint8Array(await r.arrayBuffer());
    return Array.from(buf);
  }, href);
  return new Uint8Array(arr);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

test('a paired desktop receives the exact bytes that the other sent', async ({ browser }) => {
  const a = await openApp(browser);
  const b = await openApp(browser);
  await dial(a.page, b.selfPeerId);
  await Promise.all([readSas(a.page), readSas(b.page)]);
  await confirmPairing(a.page);
  await confirmPairing(b.page);
  await Promise.all([
    a.page.waitForSelector('[data-testid="drop-zone"]'),
    b.page.waitForSelector('[data-testid="drop-zone"]'),
  ]);

  // 1 KiB file: pseudo-random bytes.
  const input = new Uint8Array(1024);
  for (let i = 0; i < input.length; i++) input[i] = (i * 31 + 17) & 0xff;
  const expected = await sha256(input);

  await sendFileFromPage(a.page, 'sample.bin', input);

  // Receiver renders a download-{id} link when complete; we read the rendered href
  // to find the id from the DOM.
  const linkSelector = '[data-testid^="download-"]';
  await b.page.waitForSelector(linkSelector, { timeout: 30_000 });
  const dataTestid = await b.page.getAttribute(linkSelector, 'data-testid');
  const id = (dataTestid ?? '').replace('download-', '');
  expect(id).toBeTruthy();

  const received = await downloadedBytes(b.page, id);
  expect(received.length).toBe(input.length);
  expect(await sha256(received)).toBe(expected);

  await a.context.close();
  await b.context.close();
});
