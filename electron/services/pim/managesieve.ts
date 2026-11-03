// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small ManageSieve client (RFC 5804): enough to write Keeper's rules to
// the mail server as one Sieve script and make it the active one. Plain
// sockets, STARTTLS when the server offers it, SASL PLAIN. No window, no
// Electron: it runs wherever Mail runs.

import net from 'node:net';
import tls from 'node:tls';
import { msString, parseCapabilities, responseEnd } from '../../../core/pim/rules';

export interface SieveTarget {
  host: string;
  port?: number;
  user: string;
  pass: string;
  /** accept a self-signed certificate (home servers) */
  insecure?: boolean;
  /** tests only: no TLS at all */
  plain?: boolean;
  timeoutMs?: number;
}

class Conn {
  private buf = '';
  private waiters: (() => void)[] = [];
  private closed = false;
  constructor(public sock: net.Socket | tls.TLSSocket, timeoutMs: number) {
    this.attach(sock);
    sock.setTimeout(timeoutMs, () => sock.destroy(new Error('The mail server did not answer (ManageSieve)')));
  }
  attach(sock: net.Socket | tls.TLSSocket) {
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => { this.buf += d; this.wake(); });
    sock.on('close', () => { this.closed = true; this.wake(); });
    sock.on('error', () => { this.closed = true; this.wake(); });
  }
  private wake() { for (const w of this.waiters.splice(0)) w(); }
  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf('\r\n');
      if (i >= 0) { const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2); return l; }
      if (this.closed) throw new Error('The mail server closed the connection (ManageSieve)');
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
  /** Lines up to and including OK / NO / BYE. Literals ({n}) are read whole. */
  async response(): Promise<{ status: 'OK' | 'NO' | 'BYE'; text: string; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      let l = await this.line();
      const lit = l.match(/\{(\d+)\+?\}$/);
      if (lit) {
        const n = Number(lit[1]);
        while (Buffer.byteLength(this.buf) < n && !this.closed) await new Promise<void>((r) => this.waiters.push(r));
        l += '\n' + this.buf.slice(0, n);
        this.buf = this.buf.slice(n).replace(/^\r\n/, '');
      }
      const end = responseEnd(l);
      if (end) return { ...end, lines };
      lines.push(l);
    }
  }
  send(s: string) { this.sock.write(s); }
  async cmd(s: string) { this.send(`${s}\r\n`); return this.response(); }
}

async function open(t: SieveTarget): Promise<{ c: Conn; caps: ReturnType<typeof parseCapabilities> }> {
  const port = t.port ?? 4190;
  const timeout = t.timeoutMs ?? 15_000;
  const sock = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect(port, t.host, () => resolve(s));
    s.once('error', reject);
  });
  const c = new Conn(sock, timeout);
  let greet = await c.response();
  let caps = parseCapabilities(greet.lines);
  if (!t.plain) {
    if (!caps.starttls) throw new Error('The server offers ManageSieve only without encryption; Keeper will not send your password that way');
    const r = await c.cmd('STARTTLS');
    if (r.status !== 'OK') throw new Error(`STARTTLS was refused: ${r.text}`);
    sock.removeAllListeners('data');
    const secure = tls.connect({ socket: sock, servername: t.host, rejectUnauthorized: !t.insecure });
    await new Promise<void>((resolve, reject) => { secure.once('secureConnect', () => resolve()); secure.once('error', reject); });
    c.attach(secure);
    // The server says its capabilities again after STARTTLS.
    greet = await c.response();
    caps = parseCapabilities(greet.lines);
  }
  if (!caps.sasl.includes('PLAIN')) throw new Error('The server does not take a password over ManageSieve (no SASL PLAIN)');
  const token = Buffer.from(`\0${t.user}\0${t.pass}`).toString('base64');
  const auth = await c.cmd(`AUTHENTICATE "PLAIN" "${token}"`);
  if (auth.status !== 'OK') throw new Error(`The server did not accept the sign-in for its rules: ${auth.text || auth.status}`);
  return { c, caps };
}

/** Does the server answer ManageSieve at all (and how)? */
export async function sieveCapabilities(t: SieveTarget): Promise<{ extensions: string[]; implementation?: string }> {
  const { c, caps } = await open(t);
  await c.cmd('LOGOUT').catch(() => undefined);
  c.sock.destroy();
  return { extensions: caps.extensions, implementation: caps.implementation };
}

/** Writes the script, checks the server accepted it, and makes it the active one. */
export async function putActiveScript(t: SieveTarget, name: string, script: string): Promise<{ extensions: string[] }> {
  const { c, caps } = await open(t);
  try {
    const put = await c.cmd(`PUTSCRIPT ${msString(name)} ${msString(script)}`);
    if (put.status !== 'OK') throw new Error(`The server refused the rules: ${put.text || put.status}`);
    const act = await c.cmd(`SETACTIVE ${msString(name)}`);
    if (act.status !== 'OK') throw new Error(`The server did not switch the rules on: ${act.text || act.status}`);
    return { extensions: caps.extensions };
  } finally {
    await c.cmd('LOGOUT').catch(() => undefined);
    c.sock.destroy();
  }
}

/** The script by name (for tests and to show what is on the server). */
export async function getScript(t: SieveTarget, name: string): Promise<string | undefined> {
  const { c } = await open(t);
  try {
    const r = await c.cmd(`GETSCRIPT ${msString(name)}`);
    if (r.status !== 'OK') return undefined;
    const body = r.lines.join('\n');
    const nl = body.indexOf('\n');
    return nl >= 0 ? body.slice(nl + 1) : '';
  } finally {
    await c.cmd('LOGOUT').catch(() => undefined);
    c.sock.destroy();
  }
}
