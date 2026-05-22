import { startBroker, type RunningBroker } from './broker.js';

declare global {
  // eslint-disable-next-line no-var
  var __PEERDROP_BROKER__: RunningBroker | undefined;
}

const BROKER_PORT = 9743;

export default async function globalSetup(): Promise<void> {
  const broker = await startBroker(BROKER_PORT);
  globalThis.__PEERDROP_BROKER__ = broker;
  process.env['PEERDROP_BROKER_URL'] = broker.url;
}
