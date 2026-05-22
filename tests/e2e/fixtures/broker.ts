import { ExpressPeerServer } from 'peer';
import http from 'node:http';
// We import express directly because PeerServer (the convenience wrapper) doesn't expose
// the underlying http.Server, which makes a clean shutdown impossible. peer brings express
// in transitively, so importing it adds no real cost.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import express from 'express';

export interface RunningBroker {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Boot an in-process PeerJS broker on `port` (127.0.0.1) and return its URL. */
export async function startBroker(port: number): Promise<RunningBroker> {
  const app = express();
  const server = http.createServer(app);
  const peer = ExpressPeerServer(server, {
    path: '/',
    allow_discovery: false,
  });
  app.use('/myapp', peer);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    url: `ws://127.0.0.1:${port}/myapp`,
    port,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

