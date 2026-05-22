import type { RunningBroker } from './broker.js';

declare global {
  // eslint-disable-next-line no-var
  var __PEERDROP_BROKER__: RunningBroker | undefined;
}

export default async function globalTeardown(): Promise<void> {
  const broker = globalThis.__PEERDROP_BROKER__;
  if (broker) {
    await broker.close();
    globalThis.__PEERDROP_BROKER__ = undefined;
  }
}
