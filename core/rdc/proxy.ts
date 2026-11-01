// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reaching a host through an HTTP proxy (CONNECT) or a SOCKS5 proxy. Returns a
// connected socket, as if the host had been dialled directly. Node only.

import net from 'node:net';

export interface ProxySpec {
  type: 'http' | 'socks5';
  host: string;
  port: number;
  user?: string;
  password?: string;
}

function readUntil(sock: net.Socket, done: (buf: Buffer) => number, timeoutMs: number): Promise<{ head: Buffer; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => fail(new Error('The proxy did not answer')), timeoutMs);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const n = done(buf);
      if (n > 0) {
        cleanup();
        resolve({ head: buf.subarray(0, n), rest: buf.subarray(n) });
      }
    };
    const fail = (e: Error) => { cleanup(); reject(e); };
    const onErr = (e: Error) => fail(e);
    const onEnd = () => fail(new Error('The proxy closed the connection'));
    const cleanup = () => { clearTimeout(t); sock.off('data', onData); sock.off('error', onErr); sock.off('end', onEnd); };
    sock.on('data', onData);
    sock.once('error', onErr);
    sock.once('end', onEnd);
  });
}

/** The SOCKS5 CONNECT request for a host name or address. */
export function socks5Request(host: string, port: number): Buffer {
  let addr: Buffer;
  if (net.isIPv4(host)) addr = Buffer.from([1, ...host.split('.').map(Number)]);
  else if (net.isIPv6(host)) {
    const full = host.includes('::') ? expandV6(host) : host.split(':');
    addr = Buffer.concat([Buffer.from([4]), Buffer.from(full.flatMap((g) => { const n = parseInt(g || '0', 16); return [n >> 8, n & 255]; }))]);
  } else {
    const name = Buffer.from(host);
    addr = Buffer.concat([Buffer.from([3, name.length]), name]);
  }
  return Buffer.concat([Buffer.from([5, 1, 0]), addr, Buffer.from([port >> 8, port & 255])]);
}

function expandV6(h: string): string[] {
  const [a, b] = h.split('::');
  const left = a ? a.split(':') : [];
  const right = b ? b.split(':') : [];
  return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
}

/** Opens a connection to host:port through the proxy. */
export async function dialViaProxy(p: ProxySpec, host: string, port: number, timeoutMs = 10_000): Promise<net.Socket> {
  const sock = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host: p.host, port: p.port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(timeoutMs, () => s.destroy(new Error('The proxy did not answer')));
  });
  sock.setTimeout(0);
  try {
    if (p.type === 'http') {
      const target = `${host.includes(':') ? `[${host}]` : host}:${port}`;
      const auth = p.user ? `Proxy-Authorization: Basic ${Buffer.from(`${p.user}:${p.password ?? ''}`).toString('base64')}\r\n` : '';
      sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);
      const { head, rest } = await readUntil(sock, (b) => { const i = b.indexOf('\r\n\r\n'); return i >= 0 ? i + 4 : 0; }, timeoutMs);
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(head.toString('latin1'));
      if (!status || status[1] !== '200') throw new Error(`The proxy refused: ${head.toString('latin1').split('\r\n')[0]}`);
      if (rest.length) sock.unshift(rest);
      return sock;
    }
    const methods = p.user ? [0, 2] : [0];
    sock.write(Buffer.from([5, methods.length, ...methods]));
    const hello = (await readUntil(sock, (b) => (b.length >= 2 ? 2 : 0), timeoutMs)).head;
    if (hello[0] !== 5 || hello[1] === 0xff) throw new Error('The SOCKS proxy refused every sign-in method');
    if (hello[1] === 2) {
      const u = Buffer.from(p.user ?? '');
      const pw = Buffer.from(p.password ?? '');
      sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([pw.length]), pw]));
      const r = (await readUntil(sock, (b) => (b.length >= 2 ? 2 : 0), timeoutMs)).head;
      if (r[1] !== 0) throw new Error('The SOCKS proxy refused the user name or password');
    }
    sock.write(socks5Request(host, port));
    const { head, rest } = await readUntil(sock, (b) => {
      if (b.length < 5) return 0;
      const len = b[3] === 1 ? 4 : b[3] === 4 ? 16 : 1 + b[4];
      return b.length >= 4 + len + 2 ? 4 + len + 2 : 0;
    }, timeoutMs);
    if (head[1] !== 0) throw new Error(`The SOCKS proxy could not connect (code ${head[1]})`);
    if (rest.length) sock.unshift(rest);
    return sock;
  } catch (e) {
    sock.destroy();
    throw e;
  }
}
