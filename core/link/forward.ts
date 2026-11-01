// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reaching a port on another device through the encrypted link, as if it
// were on this one: localhost:3000 here goes to localhost:3000 there. A SOCKS5
// proxy does the same for any address the other device may reach (its own
// ports, and its local network if its owner allows that). Node only.

import net from 'node:net';
import type { Mux, Stream } from './mux';

/** Both directions between a TCP socket and a link stream, with back-pressure. */
export function bridge(sock: net.Socket, st: Stream) {
  let ended = false;
  st.ondata = (c) =>
    new Promise<void>((resolve) => {
      if (sock.destroyed) return resolve();
      if (sock.write(c)) resolve();
      else sock.once('drain', () => resolve());
    });
  st.onend = () => {
    ended = true;
    sock.end();
  };
  st.onreset = () => sock.destroy();
  void st.start();
  sock.on('data', (d) => {
    sock.pause();
    st.write(d).then(() => sock.resume(), () => sock.destroy());
  });
  sock.on('end', () => st.end());
  sock.on('error', () => st.reset('socket error'));
  sock.on('close', () => {
    if (!ended) st.end();
  });
}

/** Listens on a local port; each connection opens a stream to `host:port` on the other device. */
export function forwardPort(getMux: () => Promise<Mux>, localPort: number, host: string, port: number, bind = '127.0.0.1'): Promise<net.Server> {
  const srv = net.createServer((sock) => {
    sock.pause();
    getMux()
      .then((mux) => {
        const st = mux.open({ k: 'tcp', host, port });
        bridge(sock, st);
        sock.resume();
      })
      .catch(() => sock.destroy());
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(localPort, bind, () => resolve(srv));
  });
}

/** The other side: a 'tcp' stream connects to the target if allowed. */
export function answerTcp(st: Stream, allowed: (host: string, port: number) => boolean) {
  const host = String(st.meta.host ?? '');
  const port = Number(st.meta.port ?? 0);
  if (!host || !(port > 0 && port < 65536) || !allowed(host, port)) return st.reset('not allowed');
  const sock = net.connect({ host, port });
  sock.once('connect', () => bridge(sock, st));
  sock.once('error', () => st.reset('could not connect'));
}

// ---------------------------------------------------------------- SOCKS5 (RFC 1928, CONNECT, no authentication; local use only)

export function parseSocksRequest(b: Buffer): { host: string; port: number; used: number } | null {
  if (b.length < 7 || b[0] !== 5 || b[1] !== 1) return null;
  const at = b[3];
  let host: string;
  let off: number;
  if (at === 1) {
    if (b.length < 10) return null;
    host = [...b.subarray(4, 8)].join('.');
    off = 8;
  } else if (at === 3) {
    const n = b[4];
    if (b.length < 5 + n + 2) return null;
    host = b.subarray(5, 5 + n).toString();
    off = 5 + n;
  } else if (at === 4) {
    if (b.length < 22) return null;
    const parts: string[] = [];
    for (let i = 0; i < 8; i++) parts.push(b.readUInt16BE(4 + i * 2).toString(16));
    host = parts.join(':');
    off = 20;
  } else return null;
  return { host, port: b.readUInt16BE(off), used: off + 2 };
}

export function socksProxy(getMux: () => Promise<Mux>, localPort: number, bind = '127.0.0.1'): Promise<net.Server> {
  const srv = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    let stage = 0;
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0) {
        if (buf.length < 2 || buf.length < 2 + buf[1]) return;
        if (buf[0] !== 5) return sock.destroy();
        buf = buf.subarray(2 + buf[1]);
        sock.write(Buffer.from([5, 0]));
        stage = 1;
      }
      if (stage === 1) {
        const r = parseSocksRequest(buf);
        if (!r) {
          if (buf.length > 300) sock.destroy();
          return;
        }
        stage = 2;
        sock.off('data', onData);
        sock.pause();
        const rest = buf.subarray(r.used);
        getMux()
          .then((mux) => {
            const st = mux.open({ k: 'tcp', host: r.host, port: r.port });
            let answered = false;
            const origReset = () => {
              if (!answered) sock.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
            };
            st.onreset = origReset;
            // Reply success straight away; a refused target resets the stream and closes the socket.
            answered = true;
            sock.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
            bridge(sock, st);
            if (rest.length) void st.write(rest);
            sock.resume();
          })
          .catch(() => sock.end(Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0])));
      }
    };
    sock.on('data', onData);
    sock.on('error', () => undefined);
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(localPort, bind, () => resolve(srv));
  });
}
