// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Relay as a Cloudflare Worker with Durable Objects (same protocol as
// relay/server.ts; see core/link/relay.ts). One Durable Object per listening
// device holds its control socket and joins calls to it. Deploy:
//   cd relay/cloudflare && npx wrangler deploy
// then enter https://<your worker>.workers.dev in Keeper → Remote Access → Keeper Relay.
// It only ever passes along end-to-end encrypted bytes between paired devices.

const ID_RE = /^[a-z2-9]{16}$/;
const B32 = 'abcdefghijkmnpqrstuvwxyz23456789';

async function deviceId(pub) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', pub));
  let bits = 0, acc = 0, out = '';
  for (const b of h) {
    acc = ((acc << 8) | b) >>> 0;
    bits += 8;
    while (bits >= 5 && out.length < 16) { out += B32[(acc >>> (bits - 5)) & 31]; bits -= 5; }
    if (out.length >= 16) break;
  }
  return out;
}

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/' ) return new Response('Keeper Relay. It only passes along end-to-end encrypted traffic between paired Keeper devices.\n');
    if (u.pathname === '/v1/online') {
      const ids = (u.searchParams.get('ids') ?? '').split(',').filter((x) => ID_RE.test(x)).slice(0, 64);
      const out = {};
      await Promise.all(ids.map(async (id) => {
        const r = await env.RELAY.get(env.RELAY.idFromName(id)).fetch('https://do/online');
        out[id] = (await r.text()) === '1';
      }));
      return Response.json(out, { headers: { 'access-control-allow-origin': '*' } });
    }
    if (req.headers.get('upgrade') !== 'websocket') return new Response('not found', { status: 404 });
    let id;
    if (u.pathname === '/v1/listen') id = u.searchParams.get('id');
    else if (u.pathname === '/v1/dial') id = u.searchParams.get('to');
    else if (u.pathname === '/v1/accept') id = (u.searchParams.get('tag') ?? '').split('.')[0];
    if (!id || !ID_RE.test(id)) return new Response('bad request', { status: 400 });
    return env.RELAY.get(env.RELAY.idFromName(id)).fetch(req);
  },
};

export class Relay {
  constructor(state) {
    this.state = state;
    this.listener = null;
    this.pending = new Map();
  }

  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/online') return new Response(this.listener ? '1' : '0');
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    if (u.pathname === '/v1/listen') this.listen(server, u.searchParams.get('id'));
    else if (u.pathname === '/v1/dial') this.dial(server, u.searchParams.get('to'));
    else if (u.pathname === '/v1/accept') this.accept(server, u.searchParams.get('tag'));
    else server.close(1008, 'not found');
    return new Response(null, { status: 101, webSocket: client });
  }

  listen(ws, id) {
    const challenge = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    let ok = false;
    ws.send(JSON.stringify({ t: 'challenge', n: challenge }));
    const timer = setTimeout(() => !ok && ws.close(1008, 'no proof'), 10_000);
    ws.addEventListener('message', async (e) => {
      if (typeof e.data !== 'string') return;
      let m;
      try { m = JSON.parse(e.data); } catch { return ws.close(1008, 'bad message'); }
      if (!ok && m.t === 'auth') {
        try {
          const pub = b64(String(m.pub));
          const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
          const good = (await deviceId(pub)) === id && (await crypto.subtle.verify({ name: 'Ed25519' }, key, b64(String(m.sig)), new TextEncoder().encode('keeper-relay ' + challenge)));
          if (!good) return ws.close(1008, 'bad proof');
        } catch { return ws.close(1008, 'bad proof'); }
        ok = true;
        clearTimeout(timer);
        try { this.listener?.close(1000, 'replaced'); } catch { /* gone */ }
        this.listener = ws;
        ws.send(JSON.stringify({ t: 'ready' }));
      } else if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong' }));
    });
    ws.addEventListener('close', () => { if (this.listener === ws) this.listener = null; });
  }

  dial(ws, to) {
    if (!this.listener) return ws.close(1000, 'offline');
    const tag = `${to}.${crypto.randomUUID().replace(/-/g, '')}`;
    const early = [];
    const onMsg = (e) => early.length < 64 && early.push(e.data);
    ws.addEventListener('message', onMsg);
    const timer = setTimeout(() => { this.pending.delete(tag); ws.close(1000, 'no answer'); }, 15_000);
    this.pending.set(tag, { ws, early, onMsg, timer });
    this.listener.send(JSON.stringify({ t: 'incoming', tag }));
  }

  accept(ws, tag) {
    const p = this.pending.get(tag);
    if (!p) return ws.close(1000, 'gone');
    this.pending.delete(tag);
    clearTimeout(p.timer);
    p.ws.removeEventListener('message', p.onMsg);
    const pass = (to) => (e) => { try { to.send(e.data); } catch { /* closed */ } };
    p.ws.addEventListener('message', pass(ws));
    ws.addEventListener('message', pass(p.ws));
    p.ws.addEventListener('close', (e) => { try { ws.close(1000, e.reason); } catch { /* closed */ } });
    ws.addEventListener('close', (e) => { try { p.ws.close(1000, e.reason); } catch { /* closed */ } });
    for (const d of p.early) ws.send(d);
  }
}
