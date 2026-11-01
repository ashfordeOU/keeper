// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Finding a direct path for a connection that runs through a relay or a
// tunnel, and moving it there (core/link/udp.ts, core/link/resume.ts).
//
// The device that dialled makes an offer inside the existing encrypted
// connection: a fresh path key, a connection id and its candidate addresses.
// The other device answers with its own candidates. Both punch at once; the
// first address that answers is used, the normal Link handshake runs on it
// with the pinned device keys, and the connection moves over with every
// stream still open. If the direct path stops, it moves back.
//
// Nothing runs while no device is connected through a relay or tunnel: one UDP
// socket per direct path, closed with it; a failed attempt is tried again
// after 1, 2, 4 … 30 minutes while the device stays connected.

import crypto from 'node:crypto';
import dgram from 'node:dgram';
import os from 'node:os';
import { initiate } from '../../../core/link/channel';
import { allowedCandidates, hostCandidates, parseOffer, retryDelay, wantsDirect, type Candidate, type DirectScope } from '../../../core/link/direct';
import { call, type Mux } from '../../../core/link/mux';
import type { Resumable } from '../../../core/link/resume';
import { bindingRequest, parseBindingResponse, stunTarget } from '../../../core/link/stun';
import { UdpPath } from '../../../core/link/udp';
import type { LinkNode } from './node';

interface Sock {
  s: dgram.Socket;
  port: number;
  path?: UdpPath;
  stun: Map<string, (c: Candidate) => void>;
}

interface ConnLike {
  mux: Mux;
  res?: Resumable;
  initiator: boolean;
  directTries: number;
  directTimer?: NodeJS.Timeout;
}

export class DirectPaths {
  private socks = new Set<Sock>();
  private busy = new Set<string>();
  /** attempts and results, for the tests and the device page */
  stats = { attempts: 0, ok: 0, failed: 0, lastError: '' };

  constructor(private node: LinkNode) {
    node.registerRpc('direct.offer', null, (p) => this.answer(String(p.$device ?? ''), p));
  }

  private scope(): DirectScope | null {
    const s = this.node.data.settings;
    if (s.mode === 'off') return null;
    return s.mode === 'internet' && !s.localOnly ? 'internet' : 'lan';
  }

  private allowed(): boolean {
    return !!this.scope() && this.node.linkHooks.directAllowed?.() !== false;
  }

  /** A new connection: if it goes through a relay or tunnel, look for a direct path soon. */
  consider(device: string, c: ConnLike, delayMs = 1500) {
    if (!c.initiator || !c.res) return;
    clearTimeout(c.directTimer);
    c.directTimer = setTimeout(() => void this.attempt(device, c), delayMs);
    c.directTimer.unref?.();
  }

  /** Looks for a direct path now (also from the device page's Check). */
  async attempt(device: string, c: ConnLike): Promise<boolean> {
    if (!this.allowed() || c.mux.closed || !c.res || !wantsDirect(c.res.kind) || this.busy.has(device)) return false;
    const dev = this.node.data.devices.find((d) => d.id === device);
    if (!dev) return false;
    this.busy.add(device);
    this.stats.attempts++;
    let sock: Sock | null = null;
    try {
      sock = await this.open();
      const key = crypto.randomBytes(32);
      const connId = crypto.randomInt(1, 2 ** 31);
      const path = new UdpPath(sock.s, key, connId, 'controlling');
      sock.path = path;
      const mine = await this.gather(sock);
      const reply = await call<{ candidates: Candidate[] }>(c.mux, 'direct.offer', { v: 1, conn: connId, key: key.toString('base64'), candidates: mine }, 12_000);
      const theirs = allowedCandidates(Array.isArray(reply?.candidates) ? reply.candidates : [], this.scope() ?? 'lan');
      if (!theirs.length) throw new Error('The other device has no address to try');
      await path.punch(theirs, 7000);
      const s = sock;
      path.onclosed = () => this.close(s);
      const session = await initiate(path.wire(), this.node.me, Buffer.from(dev.pub, 'base64'), 10_000);
      await this.node.hello(session, c.res);
      this.stats.ok++;
      c.directTries = 0;
      this.node.linkHooks.changed();
      // When the direct path is lost, try again later (the connection is back on the relay by then).
      const res = c.res;
      res.onpath = () => {
        this.node.linkHooks.changed();
        if (!c.mux.closed && wantsDirect(res.kind)) this.retry(device, c);
      };
      return true;
    } catch (e) {
      this.stats.failed++;
      this.stats.lastError = e instanceof Error ? e.message : String(e);
      if (sock) this.close(sock);
      this.retry(device, c);
      return false;
    } finally {
      this.busy.delete(device);
    }
  }

  private retry(device: string, c: ConnLike) {
    clearTimeout(c.directTimer);
    if (c.mux.closed) return;
    c.directTimer = setTimeout(() => void this.attempt(device, c), retryDelay(c.directTries++));
    c.directTimer.unref?.();
  }

  /** The other device offers a direct path: answer with our addresses and punch from this side too. */
  private async answer(device: string, p: Record<string, unknown>) {
    const scope = this.scope();
    if (!scope || !this.allowed()) throw new Error('Direct connections are off on that device');
    if (!this.node.data.devices.some((d) => d.id === device)) throw new Error('Not paired');
    const offer = parseOffer(p, scope);
    if (!offer) throw new Error('Broken offer');
    const sock = await this.open();
    const path = new UdpPath(sock.s, Buffer.from(offer.key, 'base64'), offer.conn, 'controlled');
    sock.path = path;
    const mine = await this.gather(sock);
    path.onclosed = () => this.close(sock);
    void path.punch(offer.candidates, 9000).then(
      // From here it is an ordinary incoming connection: the pinned-key handshake, then the hello moves the connection over.
      () => void this.node.acceptWire(path.wire()),
      () => this.close(sock),
    );
    return { candidates: mine };
  }

  private async open(): Promise<Sock> {
    const s = dgram.createSocket('udp4');
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.bind(0, () => {
        s.off('error', reject);
        resolve();
      });
    });
    const sock: Sock = { s, port: s.address().port, stun: new Map() };
    s.on('message', (m, r) => {
      const from = { address: r.address.replace(/^::ffff:/, ''), port: r.port };
      if (sock.path?.handle(m, from)) return;
      for (const [tx, done] of sock.stun) {
        const mapped = parseBindingResponse(m, Buffer.from(tx, 'hex'));
        if (mapped) {
          sock.stun.delete(tx);
          done({ type: 'srflx', ...mapped });
        }
      }
    });
    s.on('error', () => this.close(sock));
    this.socks.add(sock);
    return sock;
  }

  /** This side's addresses: network cards, and (for "From anywhere") what STUN servers see. */
  private async gather(sock: Sock): Promise<Candidate[]> {
    const scope = this.scope() ?? 'lan';
    const out = hostCandidates(os.networkInterfaces() as never, sock.port, !!this.node.opts.directLoopback);
    if (scope === 'internet') {
      const stuns = this.node.data.settings.stun.map(stunTarget).filter((x): x is { host: string; port: number } => !!x).slice(0, 2);
      const found = await Promise.all(
        stuns.map(
          (t) =>
            new Promise<Candidate | null>((resolve) => {
              const { packet, txid } = bindingRequest();
              const key = txid.toString('hex');
              const timer = setTimeout(() => {
                sock.stun.delete(key);
                resolve(null);
              }, 1200);
              sock.stun.set(key, (c) => {
                clearTimeout(timer);
                resolve(c);
              });
              try {
                sock.s.send(packet, t.port, t.host, (err) => err && resolve(null));
              } catch {
                resolve(null);
              }
            }),
        ),
      );
      for (const f of found) if (f && !out.some((o) => o.address === f.address && o.port === f.port)) out.push(f);
    }
    return allowedCandidates(out, scope);
  }

  private close(sock: Sock) {
    if (!this.socks.delete(sock)) return;
    sock.path?.close('closed');
    try {
      sock.s.close();
    } catch {
      /* already closed */
    }
  }

  /** open sockets right now (the idle budget test looks at this) */
  get openSockets() {
    return this.socks.size;
  }

  stop() {
    for (const s of [...this.socks]) this.close(s);
  }
}
