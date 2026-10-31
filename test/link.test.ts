// SPDX-License-Identifier: AGPL-3.0-or-later
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { _test as ch, initiate, pipe, respond, Session, type Wire } from '../core/link/channel';
import { backoff, cloudflaredAsset, ingressYaml, parseLogLine, parseQuickUrl, readyConnections, tunnelArgs } from '../core/link/cloudflared';
import { answerTcp, forwardPort, parseSocksRequest, socksProxy } from '../core/link/forward';
import { deviceId, fingerprint, newIdentity, sign, verify } from '../core/link/identity';
import * as J from '../core/link/jscrypto';
import { openNote, readNotes, sealNote, topicFor, postNote } from '../core/link/mailbox';
import { announcement, decode, encode, keeperDevices, query, TYPE } from '../core/link/mdns';
import { call, Mux, serve } from '../core/link/mux';
import { pairAsHost, pairAsJoiner, sasDigits } from '../core/link/pair';
import { allowed, forwardTargetAllowed } from '../core/link/perms';
import { RelayServer, relayDial, relayListen, relayOnline } from '../core/link/relay';
import { Receiver, safeName, sendFile, transferId } from '../core/link/transfer';
import { acceptWebSocket, connectWs } from '../core/link/ws';

const tmp = fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-link-'));
afterAll(async () => fsp.rm(await tmp, { recursive: true, force: true }));

async function linked(): Promise<[Session, Session, ReturnType<typeof newIdentity>, ReturnType<typeof newIdentity>]> {
  const a = newIdentity();
  const b = newIdentity();
  const [wa, wb] = pipe();
  const [sa, sb] = await Promise.all([initiate(wa, a, b.publicKey), respond(wb, b, (p) => p.equals(a.publicKey))]);
  return [sa, sb, a, b];
}

function muxPair(sa: Session, sb: Session): [Mux, Mux] {
  return [new Mux(sa, true), new Mux(sb, false)];
}

describe('pure-JS crypto (phone companion)', () => {
  it('matches Node for ChaCha20-Poly1305, SHA-256, HMAC and HKDF', () => {
    for (let n = 0; n < 120; n++) {
      const key = crypto.randomBytes(32), nonce = crypto.randomBytes(12), pt = crypto.randomBytes((n * 13) % 400), aad = crypto.randomBytes(n % 33);
      const c = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
      c.setAAD(aad, { plaintextLength: pt.length });
      const exp = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
      expect(Buffer.from(J.seal(key, nonce, pt, aad))).toEqual(exp);
      expect(Buffer.from(J.open(key, nonce, exp, aad)!)).toEqual(pt);
      expect(Buffer.from(J.sha256(pt)).toString('hex')).toBe(crypto.createHash('sha256').update(pt).digest('hex'));
      expect(Buffer.from(J.hkdf(pt, aad, key, 42))).toEqual(Buffer.from(crypto.hkdfSync('sha256', pt, aad, key, 42)));
    }
  });
  it('RFC 8439 2.8.2 test vector', () => {
    const key = J.fromHex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
    const nonce = J.fromHex('070000004041424344454647');
    const aad = J.fromHex('50515253c0c1c2c3c4c5c6c7');
    const pt = J.utf8("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
    const out = J.seal(key, nonce, pt, aad);
    expect(J.toHex(out.subarray(out.length - 16))).toBe('1ae10b594f09e26a7e902ecbd0600691');
  });
  it('refuses a changed message', () => {
    const k = crypto.randomBytes(32), n = crypto.randomBytes(12);
    const s = J.seal(k, n, J.utf8('hello'));
    s[0] ^= 1;
    expect(J.open(k, n, s)).toBeNull();
  });
});

describe('identity', () => {
  it('signs and verifies; ids are short and stable', () => {
    const id = newIdentity();
    const sig = sign(id, Buffer.from('x'));
    expect(verify(id.publicKey, Buffer.from('x'), sig)).toBe(true);
    expect(verify(id.publicKey, Buffer.from('y'), sig)).toBe(false);
    expect(deviceId(id.publicKey)).toMatch(/^[a-z2-9]{16}$/);
    expect(fingerprint(id.publicKey)).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  });
});

describe('secure channel', () => {
  it('connects two trusted devices and carries messages both ways', async () => {
    const [sa, sb, a, b] = await linked();
    expect(sa.peer.equals(b.publicKey)).toBe(true);
    expect(sb.peer.equals(a.publicKey)).toBe(true);
    const got: string[] = [];
    sb.onmessage = (m) => got.push(Buffer.from(m).toString());
    sa.send(Buffer.from('one'));
    sa.send(Buffer.from('two'));
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toEqual(['one', 'two']);
  });

  it('refuses a device that is not the one expected', async () => {
    const a = newIdentity(), b = newIdentity(), c = newIdentity();
    const [wa, wb] = pipe();
    await expect(Promise.all([initiate(wa, a, c.publicKey), respond(wb, b, () => true)])).rejects.toThrow(/not the device/);
  });

  it('refuses an untrusted caller', async () => {
    const a = newIdentity(), b = newIdentity();
    const [wa, wb] = pipe();
    const r = respond(wb, b, () => false);
    void initiate(wa, a, b.publicKey).catch(() => undefined);
    await expect(r).rejects.toThrow(/not paired/);
  });

  it('closes on a replayed or changed message', async () => {
    const a = newIdentity(), b = newIdentity();
    const [wa, wb] = pipe();
    const sent: Uint8Array[] = [];
    const orig = wa.send;
    wa.send = (d) => { sent.push(d); orig(d); };
    const [sa, sb] = await Promise.all([initiate(wa, a, b.publicKey), respond(wb, b, () => true)]);
    const got: string[] = [];
    let closed = '';
    sb.onmessage = (m) => got.push(Buffer.from(m).toString());
    sb.onclose = (r) => (closed = r ?? '');
    sa.send(Buffer.from('hi'));
    await new Promise((r) => setTimeout(r, 5));
    orig(sent[sent.length - 1]); // replay the last message
    await new Promise((r) => setTimeout(r, 5));
    expect(got).toEqual(['hi']);
    expect(closed).toMatch(/integrity/);
  });

  it('GCM with a counter refuses a different counter', () => {
    const k = crypto.randomBytes(32);
    const s = ch.gcmSeal(k, 5n, Buffer.from('x'));
    expect(ch.gcmOpen(k, 5n, s)?.toString()).toBe('x');
    expect(ch.gcmOpen(k, 6n, s)).toBeNull();
  });
});

describe('pairing', () => {
  const run = async (hostSecret: string, joinSecret: string, confirmJ = true, expectHost?: Buffer) => {
    const h = newIdentity(), j = newIdentity();
    const [wh, wj] = pipe();
    const seen: string[] = [];
    const host = pairAsHost(wh, { me: h, info: { name: 'Desk', os: 'linux' }, secret: hostSecret, confirm: async (sas) => (seen.push(sas), true) });
    const join = pairAsJoiner(wj, { me: j, info: { name: 'Laptop', os: 'darwin' }, secret: joinSecret, expectHost: expectHost ?? undefined, confirm: async (sas) => (seen.push(sas), confirmJ) });
    return { h, j, seen, results: await Promise.allSettled([host, join]) };
  };

  it('pairs with the right code; both sides see the same six digits and the same secret', async () => {
    const { h, j, seen, results } = await run('123456', '123456');
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const [rh, rj] = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof pairAsHost>>>).value);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toMatch(/^\d{3} \d{3}$/);
    expect(rh.peer.pub).toBe(j.publicKey.toString('base64'));
    expect(rj.peer.pub).toBe(h.publicKey.toString('base64'));
    expect(rh.peer.name).toBe('Laptop');
    expect(rh.pairSecret).toBe(rj.pairSecret);
  });

  it('refuses a wrong code', async () => {
    const { results } = await run('123456', '654321');
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    expect(String((results[1] as PromiseRejectedResult).reason)).toMatch(/wrong-code/);
  });

  it('stops when one side does not confirm', async () => {
    const { results } = await run('111111', '111111', false);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('a QR pairing refuses a host that is not the one in the code', async () => {
    const { results } = await run('long-secret', 'long-secret', true, newIdentity().publicKey);
    expect(results[1].status).toBe('rejected');
  });

  it('the digits depend on both keys and the transcript', () => {
    const t = crypto.randomBytes(32), a = crypto.randomBytes(32), b = crypto.randomBytes(32);
    expect(sasDigits(t, a, b)).toBe(sasDigits(t, a, b));
    expect(sasDigits(t, a, b)).not.toBe(sasDigits(t, b, a));
  });
});

describe('streams and requests', () => {
  it('runs requests and enforces permissions', async () => {
    const [sa, sb] = await linked();
    const [ma, mb] = muxPair(sa, sb);
    const perms = { sendFiles: true };
    mb.onstream = (st) => {
      const m = String(st.meta.m);
      if (!allowed(perms, m)) return void serve(st, { [m]: () => { throw new Error('Not allowed'); } });
      void serve(st, { hello: (p) => ({ hi: p.name }), 'xfer.offer': () => ({ accept: false }) });
    };
    expect(await call(ma, 'hello', { name: 'x' })).toEqual({ hi: 'x' });
    await expect(call(ma, 'fs.list', {})).rejects.toThrow(/Not allowed/);
    await expect(call(ma, 'nope', {})).rejects.toThrow(/Not allowed/);
    expect(await ma.ping()).toBeGreaterThanOrEqual(0);
  });

  it('keeps many streams independent with flow control', async () => {
    const [sa, sb] = await linked();
    const [ma, mb] = muxPair(sa, sb);
    const sums = new Map<number, number>();
    mb.onstream = (st) => {
      st.ondata = async (c) => {
        await new Promise((r) => setTimeout(r, 1));
        sums.set(st.id, (sums.get(st.id) ?? 0) + c.length);
      };
      st.onend = () => st.end();
      void st.start();
    };
    const big = crypto.randomBytes(3 * 1024 * 1024);
    await Promise.all([1, 2, 3].map(async () => {
      const st = ma.open({ k: 'test' });
      await st.write(big);
      st.end();
    }));
    await new Promise((r) => setTimeout(r, 300));
    expect([...sums.values()]).toEqual([big.length, big.length, big.length]);
  });
});

describe('file transfer', () => {
  it('sends, checks and resumes', async () => {
    const dir = await tmp;
    const src = path.join(dir, 'Photo.jpg');
    const data = crypto.randomBytes(2 * 1024 * 1024 + 123);
    await fsp.writeFile(src, data);
    const [sa, sb] = await linked();
    const [ma, mb] = muxPair(sa, sb);
    const rx = new Receiver(() => path.join(dir, 'in'), () => path.join(dir, 'parts'));
    mb.onstream = (st) => {
      if (st.meta.k === 'rpc') return void serve(st, { 'xfer.offer': (p) => rx.accept(p as never) });
      if (st.meta.k === 'file') void rx.receive(st);
    };
    // An earlier try was cut off after 700 kB: that part is still on disk.
    const st0 = await fsp.stat(src);
    await fsp.mkdir(path.join(dir, 'parts'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'parts', `${transferId(src, st0.size, st0.mtimeMs)}.part`), data.subarray(0, 700_000));
    const progress: number[] = [];
    const r = await sendFile(ma, src, (p) => p.state === 'sending' && progress.push(p.done));
    expect(progress[0]).toBe(700_000); // resumed, not from zero
    expect(await fsp.readFile(r.savedAs!)).toEqual(data);
    // a second copy gets its own name
    const r2 = await sendFile(ma, src);
    expect(path.basename(r2.savedAs!)).toBe('Photo 2.jpg');
  });

  it('a damaged partial file is caught by the final check', async () => {
    const dir = await tmp;
    const src = path.join(dir, 'Doc.pdf');
    const data = crypto.randomBytes(300_000);
    await fsp.writeFile(src, data);
    const [sa, sb] = await linked();
    const [ma, mb] = muxPair(sa, sb);
    const rx = new Receiver(() => path.join(dir, 'in2'), () => path.join(dir, 'parts2'));
    mb.onstream = (st) => {
      if (st.meta.k === 'rpc') return void serve(st, { 'xfer.offer': (p) => rx.accept(p as never) });
      if (st.meta.k === 'file') void rx.receive(st);
    };
    const st0 = await fsp.stat(src);
    await fsp.mkdir(path.join(dir, 'parts2'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'parts2', `${transferId(src, st0.size, st0.mtimeMs)}.part`), crypto.randomBytes(1000));
    await expect(sendFile(ma, src)).rejects.toThrow(/damaged/);
    // and the next try starts over and succeeds
    const r = await sendFile(ma, src);
    expect(await fsp.readFile(r.savedAs!)).toEqual(data);
  });

  it('names never leave the download folder', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('C:\\x\\..\\evil.exe')).toBe('evil.exe');
    expect(safeName('.bashrc')).toBe('bashrc');
    expect(safeName('')).toBe('file');
  });
});

describe('mDNS', () => {
  it('announces and reads back a Keeper device', () => {
    const p = announcement({ id: 'abcdefghijkmnpqr', name: 'Studio Mac', port: 47821, host: 'studio', addresses: ['192.168.1.20', 'fe80::1'], pairing: true, os: 'darwin' });
    const back = decode(encode(p));
    const found = keeperDevices(back);
    expect(found).toEqual([{ id: 'abcdefghijkmnpqr', name: 'Studio Mac', port: 47821, addresses: ['192.168.1.20', 'fe80::1'], pairing: true, os: 'darwin', ttl: 120 }]);
    const q = decode(encode(query()));
    expect(q.questions[0]).toMatchObject({ name: '_keeper._tcp.local', type: TYPE.PTR });
  });

  it('reads compressed names', () => {
    // A response with a PTR whose target points back into the question name.
    const hdr = [0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0];
    const name = [7, ...Buffer.from('_keeper'), 4, ...Buffer.from('_tcp'), 5, ...Buffer.from('local'), 0];
    const rec = [...name, 0, 12, 0, 1, 0, 0, 0, 120, 0, 6, 3, ...Buffer.from('dev'), 0xc0, 12];
    const p = decode(new Uint8Array([...hdr, ...rec]));
    expect(p.answers[0].data).toBe('dev._keeper._tcp.local');
  });
});

describe('WebSocket and relay', () => {
  it('a relay joins two devices and stays blind', async () => {
    const relay = new RelayServer();
    const server = http.createServer((req, res) => { if (!relay.handleHttp(req, res)) { res.writeHead(404); res.end(); } });
    relay.attach(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    const a = newIdentity(), b = newIdentity();
    const incoming = new Promise<Wire>((resolve) => void relayListen(url, b, resolve));
    await new Promise((r) => setTimeout(r, 100));
    expect(await relayOnline(url, [deviceId(b.publicKey), deviceId(a.publicKey)])).toEqual({ [deviceId(b.publicKey)]: true, [deviceId(a.publicKey)]: false });
    const wa = await relayDial(url, deviceId(b.publicKey));
    const pa = initiate(wa, a, b.publicKey);
    const wb = await incoming;
    const [sa, sb] = await Promise.all([pa, respond(wb, b, (p) => p.equals(a.publicKey))]);
    const got = new Promise<string>((r) => (sb.onmessage = (m) => r(Buffer.from(m).toString())));
    sa.send(Buffer.from('through the relay'));
    expect(await got).toBe('through the relay');
    expect(relay.stats.calls).toBe(1);
    // calling a device that is not there fails quickly
    await expect(relayDial(url, deviceId(a.publicKey)).then((w) => new Promise((_, rej) => (w.onclose = (r) => rej(new Error(r)))))).rejects.toThrow(/offline/);
    relay.close();
    server.close();
  });

  it('refuses a listener that cannot prove its id', async () => {
    const relay = new RelayServer();
    const server = http.createServer();
    relay.attach(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const url = `ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    const a = newIdentity();
    const w = await connectWs(`${url}/v1/listen?id=${deviceId(newIdentity().publicKey)}`, 'relay');
    const closed = new Promise<string>((r) => (w.onclose = (x) => r(x ?? '')));
    w.ontext = (s) => {
      const m = JSON.parse(s);
      if (m.t === 'challenge') w.sendText(JSON.stringify({ t: 'auth', pub: a.publicKey.toString('base64'), sig: sign(a, Buffer.from('keeper-relay ' + m.n)).toString('base64') }));
    };
    expect(await closed).toMatch(/bad proof/);
    server.close();
  });

  it('server-side WebSocket handles large and fragmented messages', async () => {
    const server = http.createServer();
    const got = new Promise<number>((resolve) => server.on('upgrade', (req, sock, head) => {
      const c = acceptWebSocket(req, sock, head, 'lan')!;
      c.onmessage = (m) => { c.send(m); resolve(m.length); };
    }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const w = await connectWs(`ws://127.0.0.1:${(server.address() as net.AddressInfo).port}/`, 'lan');
    const echo = new Promise<number>((r) => (w.onmessage = (m) => r(m.length)));
    w.send(crypto.randomBytes(300_000));
    expect(await got).toBe(300_000);
    expect(await echo).toBe(300_000);
    w.close();
    server.close();
  });
});

describe('mailbox rendezvous', () => {
  it('seals notes only the paired device can read', () => {
    const me = newIdentity(), other = newIdentity();
    const secret = crypto.randomBytes(32).toString('base64url');
    const note = sealNote(secret, me, { lan: ['192.168.1.5:47821'], at: Date.now() });
    expect(openNote(secret, note, me.publicKey)?.lan).toEqual(['192.168.1.5:47821']);
    expect(openNote(secret, note, other.publicKey)).toBeNull(); // wrong signer
    expect(openNote(crypto.randomBytes(32).toString('base64url'), note, me.publicKey)).toBeNull(); // wrong secret
    expect(openNote(secret, sealNote(secret, me, { at: Date.now() - 7 * 3600_000 }), me.publicKey)).toBeNull(); // too old
    expect(topicFor(secret)).toMatch(/^keeper-[0-9a-f]{32}$/);
    expect(note).not.toContain('192.168');
  });

  it('posts to and reads from an ntfy-style server', async () => {
    const msgs: string[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.method === 'POST') { msgs.push(body); res.end('{}'); return; }
        res.end(msgs.map((m) => JSON.stringify({ event: 'message', message: m })).join('\n') + '\n' + JSON.stringify({ event: 'message', message: 'junk' }) + '\n');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    const me = newIdentity();
    const secret = crypto.randomBytes(32).toString('base64url');
    await postNote(url, secret, me, { tunnel: 'https://old.example', at: Date.now() - 1000 });
    await postNote(url, secret, me, { tunnel: 'https://new.example', at: Date.now() });
    expect((await readNotes(url, secret, me.publicKey))?.tunnel).toBe('https://new.example');
    server.close();
  });
});

describe('cloudflared', () => {
  it('knows the pinned files and its arguments', () => {
    expect(cloudflaredAsset('linux', 'x64')?.url).toMatch(/cloudflared-linux-amd64$/);
    expect(cloudflaredAsset('darwin', 'arm64')?.archive).toBe('tgz');
    expect(cloudflaredAsset('sunos', 'x64')).toBeNull();
    expect(tunnelArgs({ mode: 'quick' }, 4000, 4001)).toContain('http://127.0.0.1:4000');
    expect(tunnelArgs({ mode: 'named' }, 4000, 4001).join(' ')).not.toMatch(/token/i);
  });
  it('reads its output', () => {
    expect(parseQuickUrl('INF |  https://shy-cat-blue.trycloudflare.com  |')).toBe('https://shy-cat-blue.trycloudflare.com');
    expect(parseLogLine('2026-10-31T01:00:00Z INF Registered tunnel connection connIndex=0').connected).toBe(true);
    expect(parseLogLine('2026-10-31T01:00:00Z ERR Failed to dial: no network').error).toMatch(/Failed to dial/);
    expect(readyConnections('# HELP\ncloudflared_tunnel_ha_connections 4\n')).toBe(4);
    expect(ingressYaml(4000, 'me.example.com', [{ port: 3000, hostname: 'app.example.com' }])).toContain('service: http_status:404');
  });
  it('waits longer after each failure, up to two minutes', () => {
    expect(backoff(1, 0.5)).toBe(1);
    expect(backoff(4, 0.5)).toBe(8);
    expect(backoff(30, 0.5)).toBe(120);
  });
});

describe('port forwarding', () => {
  it('reaches a port on the other device, and SOCKS5 works too', async () => {
    const echo = net.createServer((s) => s.pipe(s));
    await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()));
    const echoPort = (echo.address() as net.AddressInfo).port;
    const [sa, sb] = await linked();
    const [ma, mb] = muxPair(sa, sb);
    mb.onstream = (st) => st.meta.k === 'tcp' && answerTcp(st, (h) => forwardTargetAllowed(h, {}));
    const fwd = await forwardPort(async () => ma, 0, '127.0.0.1', echoPort);
    const roundtrip = (port: number, socks?: { host: string; port: number }) => new Promise<string>((resolve, reject) => {
      const c = net.connect(port, '127.0.0.1');
      let buf = Buffer.alloc(0);
      let stage = socks ? 0 : 2;
      c.on('connect', () => {
        if (socks) c.write(Buffer.from([5, 1, 0]));
        else c.write('ping');
      });
      c.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (stage === 0 && buf.length >= 2) {
          buf = buf.subarray(2);
          stage = 1;
          const h = Buffer.from(socks!.host);
          const req = Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([socks!.port >> 8, socks!.port & 255])]);
          c.write(req);
        }
        if (stage === 1 && buf.length >= 10) {
          if (buf[1] !== 0) return reject(new Error('refused'));
          buf = buf.subarray(10);
          stage = 2;
          c.write('ping');
        }
        if (stage === 2 && buf.toString().includes('ping')) { c.end(); resolve('ping'); }
      });
      c.on('close', () => !buf.toString().includes('ping') && reject(new Error('closed')));
      c.on('error', reject);
    });
    expect(await roundtrip((fwd.address() as net.AddressInfo).port)).toBe('ping');
    const socks = await socksProxy(async () => ma, 0);
    expect(await roundtrip((socks.address() as net.AddressInfo).port, { host: '127.0.0.1', port: echoPort })).toBe('ping');
    // a target outside what the other device allows is refused
    await expect(roundtrip((socks.address() as net.AddressInfo).port, { host: '8.8.8.8', port: 53 })).rejects.toThrow();
    fwd.close(); socks.close(); echo.close();
  });

  it('parses SOCKS requests and limits targets', () => {
    expect(parseSocksRequest(Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, 0x0b, 0xb8]))).toEqual({ host: '127.0.0.1', port: 3000, used: 10 });
    expect(forwardTargetAllowed('localhost', {})).toBe(true);
    expect(forwardTargetAllowed('192.168.1.4', {})).toBe(false);
    expect(forwardTargetAllowed('192.168.1.4', { lan: true })).toBe(true);
    expect(forwardTargetAllowed('8.8.8.8', { lan: true })).toBe(false);
    expect(forwardTargetAllowed('nas.local', { lan: true })).toBe(true);
    expect(forwardTargetAllowed('example.com', { lan: true })).toBe(false);
  });
});
