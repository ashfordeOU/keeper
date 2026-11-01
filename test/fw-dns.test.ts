// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The DNS filter against real local servers: DNS over HTTPS, DNS over TLS and
// plain UDP upstreams, blocklists, CNAME cloaking, caching and timeouts.
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainSet } from '../core/fw/blocklist';
import { buildQuery, parseMessage, type QueryLogEntry } from '../core/fw/dns';
import { dohClient, dotClient, udpClient } from '../electron/services/fw/dns-client';
import { Resolver } from '../electron/services/fw/resolver';

/** A reply: optional CNAME to `alias`, then an A record. */
function answer(q: Buffer, ip = '10.9.8.7', alias?: string): Buffer {
  const m = parseMessage(q);
  const head = Buffer.from(q.subarray(0, 12));
  head.writeUInt16BE(0x8180, 2);
  head.writeUInt16BE(alias ? 2 : 1, 6);
  const qEnd = 12 + q.subarray(12).indexOf(0) + 1 + 4;
  const parts = [head, q.subarray(12, qEnd)];
  let nameRef = Buffer.from([0xc0, 0x0c]);
  if (alias) {
    const labels = Buffer.concat([...alias.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
    const rr = Buffer.alloc(12);
    nameRef.copy(rr, 0);
    rr.writeUInt16BE(5, 2); rr.writeUInt16BE(1, 4); rr.writeUInt32BE(60, 6); rr.writeUInt16BE(labels.length, 10);
    nameRef = Buffer.from([0xc0 | ((qEnd + 12) >> 8), (qEnd + 12) & 0xff]);
    parts.push(rr, labels);
  }
  const a = Buffer.alloc(16);
  nameRef.copy(a, 0);
  a.writeUInt16BE(m.questions[0].type === 28 ? 28 : 1, 2); a.writeUInt16BE(1, 4); a.writeUInt32BE(120, 6); a.writeUInt16BE(4, 10);
  ip.split('.').forEach((x, i) => a.writeUInt8(+x, 12 + i));
  parts.push(a);
  return Buffer.concat(parts);
}
const reply = (q: Buffer) => { const n = parseMessage(q).questions[0].name; return n.startsWith('alias.') ? answer(q, '10.1.1.1', 'cdn.tracker.test') : n === 'slow.test' ? null : answer(q); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kfw-'));
let haveCert = false;
let cert = Buffer.alloc(0), key = Buffer.alloc(0);
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  cert = fs.readFileSync(path.join(dir, 'c.pem')); key = fs.readFileSync(path.join(dir, 'k.pem')); haveCert = true;
} catch { /* no openssl: the encrypted upstream tests are skipped */ }

let doh: https.Server, dot: tls.Server, udp: dgram.Socket;
let dohPort = 0, dotPort = 0, udpPort = 0;
let dohHits = 0;
beforeAll(async () => {
  udp = dgram.createSocket('udp4');
  udp.on('message', (m, r) => { const a = reply(m); if (a) udp.send(a, r.port, r.address); });
  await new Promise<void>((r) => udp.bind(0, '127.0.0.1', () => r()));
  udpPort = (udp.address() as { port: number }).port;
  if (!haveCert) return;
  doh = https.createServer({ cert, key }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      dohHits++;
      if (req.headers['content-type'] !== 'application/dns-message') { res.statusCode = 415; return res.end(); }
      const a = reply(Buffer.concat(chunks));
      if (!a) return; // never answers
      res.setHeader('content-type', 'application/dns-message');
      res.end(a);
    });
  });
  await new Promise<void>((r) => doh.listen(0, '127.0.0.1', () => r()));
  dohPort = (doh.address() as { port: number }).port;
  dot = tls.createServer({ cert, key }, (s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) {
        const q = buf.subarray(2, 2 + buf.readUInt16BE(0));
        buf = buf.subarray(2 + q.length);
        const a = reply(Buffer.from(q));
        if (a) { const l = Buffer.alloc(2); l.writeUInt16BE(a.length); s.write(Buffer.concat([l, a])); }
      }
    });
  });
  await new Promise<void>((r) => dot.listen(0, '127.0.0.1', () => r()));
  dotPort = (dot.address() as { port: number }).port;
});
afterAll(() => { udp?.close(); doh?.close(); dot?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('upstream clients', () => {
  it('plain UDP', async () => {
    const r = parseMessage(await udpClient('127.0.0.1', udpPort).query(buildQuery('example.test', 1, 11)));
    expect(r.id).toBe(11);
    expect(r.answers[0].data).toBe('10.9.8.7');
  });
  it.skipIf(!haveCert)('DNS over HTTPS (RFC 8484 POST), checking the server certificate', async () => {
    const c = dohClient(`https://localhost:${dohPort}/dns-query`, { ca: cert, bootstrap: ['127.0.0.1'] });
    const r = parseMessage(await c.query(buildQuery('example.test', 1, 12)));
    expect(r.answers[0].data).toBe('10.9.8.7');
    // A server whose certificate is not trusted is refused.
    await expect(dohClient(`https://localhost:${dohPort}/dns-query`, { bootstrap: ['127.0.0.1'] }).query(buildQuery('example.test', 1))).rejects.toThrow();
    c.close();
  });
  it.skipIf(!haveCert)('DNS over TLS (RFC 7858), several questions on one connection, timeout on no answer', async () => {
    const c = dotClient(`127.0.0.1:${dotPort}`, { servername: 'localhost', ca: cert });
    const [a, b] = await Promise.all([c.query(buildQuery('one.test', 1, 21)), c.query(buildQuery('two.test', 1, 22))]);
    expect(parseMessage(a).id).toBe(21);
    expect(parseMessage(b).id).toBe(22);
    await expect(c.query(buildQuery('slow.test', 1, 23), 300)).rejects.toThrow(/too long/);
    c.close();
  });
});

describe('the DNS filter', () => {
  it.skipIf(!haveCert)('answers through DoH, blocks listed names (also behind a CNAME), caches, logs', async () => {
    const lists = new DomainSet();
    lists.add(['ads.test', 'tracker.test'], 'Test list');
    const log: QueryLogEntry[] = [];
    const named: [string, string[]][] = [];
    const r = new Resolver({ port: 0, upstream: { id: 't', name: 'test', kind: 'doh', address: `https://localhost:${dohPort}/dns-query`, bootstrap: ['127.0.0.1'] }, blocked: (n) => lists.match(n), onLog: (e) => log.push(e), onAnswer: (n, a) => named.push([n, a]), test: { ca: cert, rejectUnauthorized: true } });
    const port = await r.start();
    const ask = (name: string, type = 1) => udpClient('127.0.0.1', port).query(buildQuery(name, type)).then(parseMessage);
    expect((await ask('example.test')).answers[0].data).toBe('10.9.8.7');
    const blocked = await ask('x.ads.test');
    expect(blocked.answers[0].data).toBe('0.0.0.0');
    expect((await ask('x.ads.test', 16)).rcode).toBe(3);
    const cloaked = await ask('alias.example.test');
    expect(cloaked.answers[0]?.data).toBe('0.0.0.0');
    const hits = dohHits;
    await ask('example.test');
    expect(dohHits).toBe(hits); // from the cache
    expect(log.find((e) => e.name === 'x.ads.test')?.blockedBy).toBe('Test list');
    expect(log.find((e) => e.name === 'alias.example.test')?.blockedBy).toMatch(/through cdn\.tracker\.test/);
    expect(named.some(([n, a]) => n === 'example.test' && a[0] === '10.9.8.7')).toBe(true);
    // DNS over TCP to the filter as well.
    const tcp = await new Promise<Buffer>((res, rej) => {
      const s = require('node:net').connect(port, '127.0.0.1');
      const q = buildQuery('example.test', 1, 99);
      const l = Buffer.alloc(2); l.writeUInt16BE(q.length);
      s.write(Buffer.concat([l, q]));
      s.on('data', (d: Buffer) => { s.end(); res(d.subarray(2)); });
      s.on('error', rej);
    });
    expect(parseMessage(tcp).id).toBe(99);
    expect(r.stats.blocked).toBeGreaterThanOrEqual(3);
    await r.stop();
  });
  it('answers SERVFAIL when the upstream cannot be reached, and ignores garbage', async () => {
    const r = new Resolver({ port: 0, upstream: { id: 'u', name: 'dead', kind: 'udp', address: '127.0.0.1:9' }, blocked: () => undefined });
    await r.start();
    const m = parseMessage((await r.answer(buildQuery('x.test', 1)))!);
    expect(m.rcode).toBe(2);
    expect(await r.answer(Buffer.from('nope'))).toBeNull();
    await r.stop();
  }, 15_000);
  it('DNS over QUIC is listed but honestly unavailable', async () => {
    const r = new Resolver({ port: 0, upstream: { id: 'q', name: 'doq', kind: 'doq', address: 'x:853' }, blocked: () => undefined });
    await expect(r.start()).rejects.toThrow(/QUIC/);
  });
});
