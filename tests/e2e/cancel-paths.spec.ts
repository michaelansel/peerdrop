import { test, expect } from '@playwright/test';
import { dial, openApp, readSas } from './fixtures/app.js';

test('closing one tab during pairing aborts the other side cleanly', async ({ browser }) => {
  const a = await openApp(browser);
  const b = await openApp(browser);

  await dial(a.page, b.selfPeerId);
  await Promise.all([readSas(a.page), readSas(b.page)]);

  // Close A; B should reach the abort UI. WebRTC dead-peer detection can take a
  // while in headless browsers; allow up to 45 s.
  await a.context.close();
  await b.page.waitForSelector('[data-testid="aborted"]', { timeout: 45_000 });
  expect(await b.page.$('[data-testid="aborted"]')).not.toBeNull();
  // Confirm button must NOT be reachable from the aborted state.
  expect(await b.page.$('[data-testid="confirm-button"]')).toBeNull();

  await b.context.close();
});
