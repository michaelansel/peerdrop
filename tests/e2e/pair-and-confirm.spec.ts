import { test, expect } from '@playwright/test';
import { confirmPairing, dial, openApp, readSas } from './fixtures/app.js';

test('two desktops complete commit-reveal pairing and display the same 6-digit SAS', async ({
  browser,
}) => {
  const a = await openApp(browser);
  const b = await openApp(browser);

  // A dials B
  await dial(a.page, b.selfPeerId);

  const [sasA, sasB] = await Promise.all([readSas(a.page), readSas(b.page)]);
  expect(sasA).toMatch(/^[0-9]{6}$/);
  expect(sasB).toMatch(/^[0-9]{6}$/);
  expect(sasA).toBe(sasB);

  // Both screens display the peer-id pair next to the SAS.
  for (const ctx of [a, b]) {
    const self = await ctx.page.textContent('[data-testid="self-peer-id"]');
    const remote = await ctx.page.textContent('[data-testid="remote-peer-id"]');
    expect(self).toContain(ctx === a ? a.selfPeerId : b.selfPeerId);
    expect(remote).toContain(ctx === a ? b.selfPeerId : a.selfPeerId);
  }

  // Confirm button has the exact required copy.
  for (const ctx of [a, b]) {
    const text = await ctx.page.textContent('[data-testid="confirm-button"]');
    expect(text?.trim()).toBe(
      'I have compared this SAS with the other device and they match',
    );
  }

  await confirmPairing(a.page);
  await confirmPairing(b.page);

  await Promise.all([
    a.page.waitForSelector('[data-testid="drop-zone"]', { timeout: 15_000 }),
    b.page.waitForSelector('[data-testid="drop-zone"]', { timeout: 15_000 }),
  ]);

  await a.context.close();
  await b.context.close();
});
