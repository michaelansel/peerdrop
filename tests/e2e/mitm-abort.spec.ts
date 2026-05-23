import { test, expect } from '@playwright/test';
import { openApp } from './fixtures/app.js';

/**
 * Squat scenario: when the broker rejects a duplicate peer-id registration, the squatted
 * side must enter a hard-stop "taken" UI with no Confirm button. The cryptographic SAS
 * binding (covered by state.test.ts) prevents any silent compromise in this scenario.
 *
 * Forcing a deterministic collision against a 2^30-id space is not feasible from a single
 * test, so we assert the weaker invariant: a fresh app load either lands on the idle
 * panel or — if a collision happens to occur — lands on the taken panel with no confirm
 * button. Either outcome is safe.
 */
test('app handles peer-id collision/squat by either succeeding or hard-stopping', async ({
  browser,
}) => {
  // Boot one normal app.
  const a = await openApp(browser);

  // Boot a second; under the 2^30 id space, this should overwhelmingly succeed.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?broker=${encodeURIComponent('ws://127.0.0.1:9743/myapp')}`);
  const settled = await Promise.race([
    page.waitForSelector('[data-testid="taken"]', { timeout: 10_000 }).then(() => 'taken'),
    page.waitForSelector('[data-testid="idle"]', { timeout: 10_000 }).then(() => 'idle'),
  ]);
  expect(['taken', 'idle']).toContain(settled);

  if (settled === 'taken') {
    expect(await page.$('[data-testid="confirm-button"]')).toBeNull();
  }

  await a.context.close();
  await context.close();
});

/**
 * The drop-zone is gated behind the local Confirm click: reaching the SAS step is not
 * enough. The cryptographic guarantee that a forged remote `confirm` cannot advance the
 * state machine is covered at the unit level in state.test.ts; here we check the UI
 * invariant that no drop-zone is rendered until the local user confirms.
 */
test('drop-zone is not shown until the local user confirms', async ({ browser }) => {
  const a = await openApp(browser);
  const b = await openApp(browser);

  await a.page.fill('[data-testid="dial-input"]', b.selfPeerId);
  await a.page.click('[data-testid="dial-button"]');

  await Promise.all([
    a.page.waitForSelector('[data-testid="sas-display"]', { timeout: 30_000 }),
    b.page.waitForSelector('[data-testid="sas-display"]', { timeout: 30_000 }),
  ]);

  expect(await a.page.$('[data-testid="drop-zone"]')).toBeNull();
  expect(await b.page.$('[data-testid="drop-zone"]')).toBeNull();

  await a.context.close();
  await b.context.close();
});
