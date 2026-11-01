// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The live receivers, off until you switch them on: one small HTTP server
// for OwnTracks (POST /owntracks) and the OsmAnd/Traccar protocol (/osmand,
// or / with an id and lat/lon), and an MQTT subscriber for OwnTracks through
// your own broker. Every request needs the receiver's token. Listens on this
// computer only unless you allow your local network.

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';
import { CONNACK_ERRORS, mqttConnect, mqttPing, mqttPuback, mqttRead, mqttSubscribe, ownTracksWho, parseOsmAnd, parseOwnTracks } from '../../../core/tracks/receivers';
import type { LivePosition } from '../../../core/tracks/types';

export interface ReceiverOptions {
  port: number;
  lan: boolean;
  token: string;
  ownTracks: boolean;
  osmand: boolean;
  onPosition: (p: LivePosition) => void;
  onName: (id: string, name: string) => void;
}

let server: http.Server | null = null;
let current: ReceiverOptions | null = null;
let lastError: string | undefined;

function authorized(req: http.IncomingMessage, url: URL, token: string): boolean {
  if (url.searchParams.get('token') === token) return true;
  if (req.headers['x-keeper-token'] === token) return true;
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer ') && auth.slice(7) === token) return true;
  if (auth.startsWith('Basic ')) {
    const [, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    return pass === token;
  }
  return false;
}

function readBody(req: http.IncomingMessage, max = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const o = current;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (code: number, body: string, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
  if (!o) return send(503, '[]');
  if (!authorized(req, url, o.token)) {
    res.setHeader('www-authenticate', 'Basic realm="Keeper"');
    return send(401, '{"error":"token"}');
  }
  let body = '';
  try {
    if (req.method === 'POST') body = await readBody(req);
  } catch {
    return send(413, '{}');
  }
  if (url.pathname.startsWith('/owntracks')) {
    if (!o.ownTracks) return send(404, '{}');
    const u = String(req.headers['x-limit-u'] ?? url.searchParams.get('u') ?? 'me');
    const d = String(req.headers['x-limit-d'] ?? url.searchParams.get('d') ?? 'phone');
    const r = parseOwnTracks(body, `${u}/${d}`);
    if (r.position) o.onPosition(r.position);
    if (r.card) o.onName(r.card.id, r.card.name);
    // OwnTracks expects a JSON array back (friends' positions; none are shared back).
    return send(200, '[]');
  }
  if (url.pathname.startsWith('/osmand') || url.searchParams.has('lat') || url.searchParams.has('id')) {
    if (!o.osmand) return send(404, '{}');
    let p: LivePosition | undefined;
    const ct = String(req.headers['content-type'] ?? '');
    if (body && ct.includes('json')) {
      try { p = parseOsmAnd(JSON.parse(body)); } catch { /* bad JSON */ }
    } else {
      const q = new URLSearchParams(url.search);
      if (body) for (const [k, v] of new URLSearchParams(body)) q.set(k, v);
      p = parseOsmAnd(q);
    }
    if (!p) return send(400, 'missing id, lat or lon', 'text/plain');
    o.onPosition(p);
    return send(200, 'OK', 'text/plain');
  }
  return send(404, '{}');
}

export async function startReceiver(o: ReceiverOptions): Promise<void> {
  const same = current && server && current.port === o.port && current.lan === o.lan;
  current = o;
  if (same) return;
  await stopReceiver();
  current = o;
  lastError = undefined;
  await new Promise<void>((resolve) => {
    const s = http.createServer((req, res) => void handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch { /* gone */ } }));
    s.on('error', (e: NodeJS.ErrnoException) => {
      lastError = e.code === 'EADDRINUSE' ? `Port ${o.port} is in use by another program. Choose another port.` : e.message;
      server = null;
      resolve();
    });
    s.listen(o.port, o.lan ? '0.0.0.0' : '127.0.0.1', () => {
      server = s;
      resolve();
    });
  });
}

export async function stopReceiver(): Promise<void> {
  const s = server;
  server = null;
  current = null;
  if (s) await new Promise<void>((r) => s.close(() => r()));
}

function lanAddress(): string | undefined {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return undefined;
}

export function receiverStatus(): { running: boolean; url?: string; lanUrl?: string; error?: string } {
  const port = (server?.address() as net.AddressInfo | null)?.port;
  if (!server || !port) return { running: false, error: lastError };
  const lan = current?.lan ? lanAddress() : undefined;
  return { running: true, url: `http://127.0.0.1:${port}`, lanUrl: lan ? `http://${lan}:${port}` : undefined };
}

// ---------------------------------------------------------------- MQTT

export interface MqttOptions {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  password?: string;
  topic: string;
  onPosition: (p: LivePosition) => void;
  onName: (id: string, name: string) => void;
  onError: (message: string | undefined) => void;
}

let mqtt: { sock: net.Socket; ping?: NodeJS.Timeout; retry?: NodeJS.Timeout; stopped: boolean; opts: MqttOptions; backoff: number } | null = null;

export function startMqtt(o: MqttOptions) {
  stopMqtt();
  const state = { sock: null as unknown as net.Socket, stopped: false, opts: o, backoff: 5000 } as NonNullable<typeof mqtt>;
  mqtt = state;
  const base = o.topic.replace(/\/#$/, '').replace(/\/\+\/\+$/, '') || 'owntracks';
  const connect = () => {
    if (state.stopped) return;
    const sock = o.tls ? tls.connect({ host: o.host, port: o.port, servername: o.host }) : net.connect({ host: o.host, port: o.port });
    state.sock = sock;
    let buf: Uint8Array = new Uint8Array(0);
    sock.setTimeout(30_000, () => sock.destroy(new Error('The broker did not answer')));
    sock.on(o.tls ? 'secureConnect' : 'connect', () => sock.write(mqttConnect({ clientId: `keeper-${Math.random().toString(36).slice(2, 10)}`, username: o.user || undefined, password: o.password, keepAlive: 60 })));
    sock.on('data', (chunk: Buffer) => {
      const all = new Uint8Array(buf.length + chunk.length);
      all.set(buf, 0);
      all.set(chunk, buf.length);
      const r = mqttRead(all);
      buf = r.rest;
      for (const p of r.packets) {
        if (p.type === 'connack') {
          if (p.code) { o.onError(CONNACK_ERRORS[p.code] ?? `The broker refused (${p.code})`); state.stopped = true; sock.destroy(); return; }
          o.onError(undefined);
          state.backoff = 5000;
          sock.setTimeout(0);
          sock.write(mqttSubscribe(1, [o.topic || 'owntracks/#'], 1));
          clearInterval(state.ping);
          state.ping = setInterval(() => { if (!sock.destroyed) sock.write(mqttPing()); }, 50_000);
        } else if (p.type === 'publish') {
          if (p.qos === 1 && p.id !== undefined) sock.write(mqttPuback(p.id));
          const who = ownTracksWho(p.topic, base);
          if (!who) continue;
          const res = parseOwnTracks(new TextDecoder().decode(p.payload), who);
          if (res.position) o.onPosition({ ...res.position, source: 'mqtt' });
          if (res.card) o.onName(res.card.id, res.card.name);
        }
      }
    });
    sock.on('error', (e) => o.onError(e.message));
    sock.on('close', () => {
      clearInterval(state.ping);
      if (state.stopped) return;
      // Try again later, waiting longer each time (at most 10 minutes).
      state.retry = setTimeout(connect, state.backoff);
      state.backoff = Math.min(state.backoff * 2, 10 * 60_000);
    });
  };
  connect();
}

export function stopMqtt() {
  if (!mqtt) return;
  mqtt.stopped = true;
  clearInterval(mqtt.ping);
  clearTimeout(mqtt.retry);
  mqtt.sock?.destroy();
  mqtt = null;
}

export const mqttRunning = () => !!mqtt && !mqtt.stopped;
