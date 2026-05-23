import type { Page, BrowserContext, Browser } from '@playwright/test';

const BROKER_URL = 'ws://127.0.0.1:9743/myapp';

export interface AppFixture {
  page: Page;
  selfPeerId: string;
}

/**
 * Open the app in a fresh context pointed at the local in-process PeerJS broker.
 * Waits until the registering UI yields a peer-id (or registration-failed UI appears).
 */
export async function openApp(browser: Browser): Promise<{
  context: BrowserContext;
  page: Page;
  selfPeerId: string;
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?broker=${encodeURIComponent(BROKER_URL)}`);
  // Wait for either the idle panel (success) or the taken panel (failure).
  await page.waitForFunction(() => {
    return (
      document.querySelector('[data-testid="idle"]') !== null ||
      document.querySelector('[data-testid="taken"]') !== null
    );
  });
  const taken = await page.$('[data-testid="taken"]');
  if (taken) {
    throw new Error('peer-id collision while opening test app');
  }
  const idEl = await page.$('[data-testid="self-peer-id-idle"]');
  const selfPeerId = (await idEl?.textContent())?.trim() ?? '';
  if (!/^[0-9A-Z]{3}-[0-9A-Z]{3}$/.test(selfPeerId)) {
    throw new Error(`unexpected self peer-id: ${selfPeerId}`);
  }
  return { context, page, selfPeerId };
}

export async function dial(page: Page, remoteId: string): Promise<void> {
  await page.fill('[data-testid="dial-input"]', remoteId);
  await page.click('[data-testid="dial-button"]');
}

export async function readSas(page: Page): Promise<string> {
  await page.waitForSelector('[data-testid="sas-display"]', { timeout: 30_000 });
  const text = await page.textContent('[data-testid="sas-display"]');
  return (text ?? '').trim();
}

export async function confirmPairing(page: Page): Promise<void> {
  await page.click('[data-testid="confirm-button"]');
}

export const PEERDROP_BROKER_URL = BROKER_URL;
