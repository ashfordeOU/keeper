// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Relay as a standalone program. Build: node relay/build.mjs
// Run:   PORT=8080 node relay/dist/keeper-relay.mjs
// Put it behind HTTPS (a reverse proxy, or a Cloudflare tunnel) and enter its
// https address in Keeper → Devices → Remote Access → Keeper Relay.

import http from 'node:http';
import { RelayServer } from '../core/link/relay';
import { attachRelays, PacketRelayServer } from '../core/mesh/packet-relay';

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
// Keeper Mesh: WireGuard packets between devices that cannot reach each other directly (still end-to-end encrypted).
const packets = new PacketRelayServer({ bytesPerSecond: Number(process.env.BYTES_PER_SECOND ?? 0) || undefined, maxDevices: Number(process.env.MAX_DEVICES ?? 10_000) });
attachRelays(server, relay, packets);
server.listen(port, host, () => console.log(`Keeper Relay listening on ${host}:${port}`));
const stop = () => {
  relay.close();
  packets.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
