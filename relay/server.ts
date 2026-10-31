// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper Relay as a standalone program. Build: node relay/build.mjs
// Run:   PORT=8080 node relay/dist/keeper-relay.mjs
// Put it behind HTTPS (a reverse proxy, or a Cloudflare tunnel) and enter its
// https address in Keeper → Devices → Remote Access → Keeper Relay.

import http from 'node:http';
import { RelayServer } from '../core/link/relay';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';
const relay = new RelayServer({
  bytesPerSecond: Number(process.env.BYTES_PER_SECOND ?? 0) || undefined,
  maxListeners: Number(process.env.MAX_DEVICES ?? 10_000),
});
const server = http.createServer((req, res) => {
  if (!relay.handleHttp(req, res)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});
relay.attach(server);
server.listen(port, host, () => console.log(`Keeper Relay listening on ${host}:${port}`));
const stop = () => {
  relay.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
