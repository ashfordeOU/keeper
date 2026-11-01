// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Regression tests for the findings in docs/SECURITY-REVIEW.md.

import crypto from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractCommands } from '../core/archive';
import { psq as fwPsq } from '../core/fw/enforce';
import { openHelpNote, sealHelpNote } from '../core/link/help';
import { deviceId, hkdf, newIdentity, sign } from '../core/link/identity';
import { printable, printCommand } from '../core/link/actions';
import { allowed } from '../core/link/perms';
import { RELAY_EARLY_BYTES, RelayServer } from '../core/link/relay';
import { connectWs } from '../core/link/ws';
import { withHostsBlock } from '../core/mesh/os-plan';
import { hostsChangeAllowed } from '../core/mesh/plan-guard';
import { psq as stagePsq } from '../core/stage/targets';
import { quotePath } from '../core/terminal/profiles';
import { feedAllowed } from '../core/updates';
import { unzip, untar, zip } from '../core/zipwrite';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(__dirname, '..');

/** Reads a PowerShell single-quoted literal the way PowerShell does; returns its value and the rest. */
function readPsLiteral(s: string): { value: string; rest: string } {
  const Q = /['‘’‚‛]/;
  if (!Q.test(s[0])) throw new Error('not a literal');
  let out = '';
  for (let i = 1; i < s.length; i++) {
    if (Q.test(s[i])) {
      if (Q.test(s[i + 1] ?? '')) {
        out += s[i];
        i++;
        continue;
      }
      return { value: out, rest: s.slice(i + 1) };
    }
    out += s[i];
  }
  throw new Error('unterminated');
}

const NASTY = ["it's", 'Bob’s file.docx', "x’; Start-Process calc; ’.pdf", 'a‘b‛c‚d', "C:\\Users\\me\\'; Remove-Item -Recurse C:\\ ;'.exe", '$(calc) `whoami`'];

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('PowerShell literals (F1)', () => {
  it('every quoting helper keeps any kind of quote inside the literal', () => {
    for (const q of [stagePsq, fwPsq, (s: string) => quotePath(s, 'powershell')]) {
      for (const s of NASTY) {
        const r = readPsLiteral(q(s));
        expect(r.value).toBe(s);
        expect(r.rest).toBe('');
      }
    }
  });

  it('remote printing on Windows quotes the file name the same way', () => {
    const cmd = printCommand('C:\\Temp\\x’; calc; ’.pdf', 'win32').args[3];
    const r = readPsLiteral(cmd.slice(cmd.indexOf('-FilePath ') + 10));
    expect(r.value).toBe('C:\\Temp\\x’; calc; ’.pdf');
    expect(r.rest.trim().startsWith('-Verb Print')).toBe(true);
  });

  it('no source file escapes only the plain apostrophe for PowerShell', () => {
    const naive = `replace(/'/g, "''")`;
    const allowed = new Set(['electron/services/filekit-convert.ts']); // SQL (DuckDB) strings, not PowerShell
    const hits = [...walk(path.join(ROOT, 'electron')), ...walk(path.join(ROOT, 'core')), ...walk(path.join(ROOT, 'cli'))]
      .filter((f) => readFileSync(f, 'utf8').includes(naive))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((f) => !allowed.has(f));
    expect(hits).toEqual([]);
  });
});

describe('Help mode notes (F2)', () => {
  it('new notes are v2 (scrypt) and open only with the right password', () => {
    const n = sealHelpNote('123456789', 'ABC234', { relay: 'https://r.example', relayId: 'abc', at: Date.now() });
    expect(n.startsWith('h2.')).toBe(true);
    expect(openHelpNote('123 456 789', 'abc234', n)?.relay).toBe('https://r.example');
    expect(openHelpNote('123456789', 'ABC235', n)).toBeNull();
  });

  it('still reads a v1 note from an older Keeper', () => {
    const key = hkdf(Buffer.from('123456789|ABC234'), Buffer.alloc(0), 'keeper help note', 32);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(JSON.stringify({ tunnel: 'https://t.example', at: Date.now() })), c.final(), c.getAuthTag()]);
    expect(openHelpNote('123456789', 'ABC234', 'h1.' + Buffer.concat([iv, ct]).toString('base64url'))?.tunnel).toBe('https://t.example');
  });
});

describe('Keeper Relay limits (F3)', () => {
  async function relay(limits?: ConstructorParameters<typeof RelayServer>[0]) {
    const r = new RelayServer(limits);
    const server = http.createServer();
    r.attach(server);
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    return { r, server, url, close: () => { r.close(); server.close(); } };
  }

  /** A device that listens on the relay but never picks a call up. */
  async function deafListener(url: string) {
    const b = newIdentity();
    const ws = await connectWs(`${url.replace('http', 'ws')}/v1/listen?id=${deviceId(b.publicKey)}`, 'relay');
    await new Promise<void>((res) => {
      ws.ontext = (s) => {
        const m = JSON.parse(s);
        if (m.t === 'challenge') ws.sendText(JSON.stringify({ t: 'auth', pub: b.publicKey.toString('base64'), sig: sign(b, Buffer.from('keeper-relay ' + m.n)).toString('base64') }));
        if (m.t === 'ready') res();
      };
    });
    return { id: deviceId(b.publicKey), close: () => ws.close('done') };
  }

  it('closes a call that sends too much before it is answered', async () => {
    const x = await relay();
    const l = await deafListener(x.url);
    const w = await connectWs(`${x.url.replace('http', 'ws')}/v1/dial?to=${l.id}`, 'relay');
    const closed = new Promise<string>((r) => (w.onclose = (why) => r(why ?? '')));
    w.send(new Uint8Array(RELAY_EARLY_BYTES + 1));
    expect(await closed).toMatch(/too much/);
    l.close();
    x.close();
  });

  it('refuses more waiting calls to one device than the limit', async () => {
    const x = await relay({ maxPendingPerDevice: 2 });
    const l = await deafListener(x.url);
    const dial = () => connectWs(`${x.url.replace('http', 'ws')}/v1/dial?to=${l.id}`, 'relay', 3000);
    await dial();
    await dial();
    await expect(dial()).rejects.toBeTruthy();
    l.close();
    x.close();
  });
});

describe('archives (F4, F5)', () => {
  it('outside unpack tools always get "--" before the entry name', () => {
    for (const [, args] of extractCommands('/tmp/a.tar', '--to-command=sh -c id', '/tmp/out')) {
      const i = args.indexOf('--to-command=sh -c id');
      expect(i).toBeGreaterThan(args.indexOf('--'));
      expect(args.indexOf('--')).toBeGreaterThanOrEqual(0);
    }
  });

  it('a zip or tar.gz that unpacks to more than the limit is refused', () => {
    const bomb = zip([{ name: 'zeros.bin', data: new Uint8Array(4 * 1024 * 1024) }]);
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(() => unzip(bomb, undefined, 1024 * 1024)).toThrow(/more than/);
    expect(unzip(bomb, undefined, 8 * 1024 * 1024)[0].data!.length).toBe(4 * 1024 * 1024);
    const tgz = gzipSync(Buffer.alloc(4 * 1024 * 1024));
    expect(() => untar(tgz, 1024 * 1024)).toThrow(/more than/);
  });
});

describe('Keeper Link (F6, F14)', () => {
  it('only listed methods are allowed, never inherited names', () => {
    for (const m of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(allowed({ browse: true, write: true } as never, m)).toBe(false);
    expect(allowed({ browse: true } as never, 'fs.list')).toBe(true);
  });

  it('only documents, pictures and text are printed for another device', () => {
    for (const ok of ['a.pdf', 'b.PNG', 'c.docx', 'notes.txt']) expect(printable(ok)).toBe(true);
    for (const bad of ['a.bat', 'b.cmd', 'c.vbs', 'd.js', 'e.lnk', 'f.docm', 'g.xlsm', 'h.exe', 'i.hta', 'noext', 'j.html']) expect(printable(bad)).toBe(false);
  });
});

describe('mesh helper and /etc/hosts (F7)', () => {
  const base = '127.0.0.1\tlocalhost\n::1\tlocalhost\n';
  it('allows Keeper’s block with mesh addresses only', () => {
    const next = withHostsBlock(base, [{ ip: 'fd7a:115c:a1e0::1', names: ['laptop.keeper'] }]);
    expect(hostsChangeAllowed(base, next)).toBeNull();
    expect(hostsChangeAllowed(next, withHostsBlock(next, []))).toBeNull();
  });
  it('refuses other changes', () => {
    expect(hostsChangeAllowed(base, base + '6.6.6.6\tgithub.com\n')).toMatch(/only Keeper/);
    expect(hostsChangeAllowed(base, withHostsBlock(base, [{ ip: '6.6.6.6', names: ['github.com'] }]))).toMatch(/mesh addresses/);
    expect(hostsChangeAllowed(base, withHostsBlock(base, [{ ip: 'fd00::1', names: ['bad name'] }]))).toMatch(/bad name|mesh/);
    expect(hostsChangeAllowed(base, '')).toMatch(/only Keeper/);
  });
});

describe('updates (F8)', () => {
  it('takes an update feed only over https or from this computer', () => {
    expect(feedAllowed('https://mirror.example/keeper')).toBe(true);
    expect(feedAllowed('http://127.0.0.1:8080')).toBe(true);
    expect(feedAllowed('http://mirror.example/keeper')).toBe(false);
    expect(feedAllowed('file:///tmp/x')).toBe(false);
    expect(feedAllowed(undefined)).toBe(false);
  });
});

describe('OwnTracks receiver token (F15)', () => {
  it('needs the exact token, and never an empty or short one', async () => {
    const { authorized } = await import('../electron/services/tracks/receivers');
    const req = (h: Record<string, string>) => ({ headers: h }) as unknown as http.IncomingMessage;
    const tok = 'abcdefghijklmnop';
    expect(authorized(req({}), new URL(`http://x/?token=${tok}`), tok)).toBe(true);
    expect(authorized(req({ authorization: `Basic ${Buffer.from(`me:${tok}`).toString('base64')}` }), new URL('http://x/'), tok)).toBe(true);
    expect(authorized(req({ authorization: `Basic ${Buffer.from('me:wrong').toString('base64')}` }), new URL('http://x/'), tok)).toBe(false);
    expect(authorized(req({}), new URL('http://x/?token='), '')).toBe(false);
    expect(authorized(req({ 'x-keeper-token': 'short' }), new URL('http://x/'), 'short')).toBe(false);
  });
});

describe('navigation guard (F9)', () => {
  it('lets Keeper pages go only to Keeper’s own page', async () => {
    const { appNavAllowed, isKeeperPage, externalAllowed } = await import('../electron/nav-guard');
    const index = path.resolve('/opt/keeper/resources/app/dist/index.html');
    const own = new URL(`file://${index.split(path.sep).join('/')}?view=island`).toString();
    expect(appNavAllowed(own, index)).toBe(true);
    expect(appNavAllowed('file:///home/me/Downloads/evil.html', index)).toBe(false);
    expect(appNavAllowed('https://evil.example/', index)).toBe(false);
    expect(appNavAllowed('http://localhost:5180/?view=app', index, 'http://localhost:5180')).toBe(true);
    expect(appNavAllowed('http://localhost:51800/', index, 'http://localhost:5180')).toBe(false);
    expect(isKeeperPage(own, index)).toBe(true);
    expect(isKeeperPage('data:text/html,x', index)).toBe(true);
    expect(isKeeperPage('https://example.com/', index)).toBe(false);
    expect(externalAllowed('https://example.com')).toBe(true);
    expect(externalAllowed('file:///etc/passwd')).toBe(false);
    expect(externalAllowed('javascript:alert(1)')).toBe(false);
  });
});

describe('agent terminal bridge (F10)', () => {
  it('never counts a plain shell prompt as an agent waiting for a message', async () => {
    const { looksIdle } = await import('../core/terminal/agent/bridge');
    expect(looksIdle('claude', 'bye\nuser@box:~/src$ ', true)).toBe(false);
    expect(looksIdle('aider', 'user@box:~$ ', true)).toBe(false);
    expect(looksIdle('unknown-tool', '$ ', true)).toBe(false);
    expect(looksIdle('aider', 'model: gpt\n> ', true)).toBe(true);
    // Still used (not strict) to tell when an answer has finished.
    expect(looksIdle('claude', 'user@box:~/src$ ')).toBe(true);
  });
});

describe('mail attachments (F12)', () => {
  it('knows which attachments would run code if opened', async () => {
    const { riskyAttachment } = await import('../core/pim/mail');
    for (const bad of ['invoice.pdf.exe', 'a.JS', 'b.vbs', 'c.lnk', 'd.docm', 'e.hta', 'f.iso', 'g.command', 'h.exe.', 'i.app']) expect(riskyAttachment(bad)).toBe(true);
    for (const ok of ['a.pdf', 'b.docx', 'c.jpg', 'd.txt', 'e.zip', 'f.ics']) expect(riskyAttachment(ok)).toBe(false);
  });
});

describe('D1: the image library', () => {
  it('uses sharp 0.35.5 or newer (older libvips, libheif and librsvg have published CVEs)', () => {
    const root = path.resolve(__dirname, '..');
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version: string }> };
    const atLeast = (v: string) => { const [a, b, c] = v.replace(/^[\^~]/, '').split('.').map(Number); return a > 0 || b > 35 || (b === 35 && c >= 5); };
    expect(atLeast(pkg.dependencies.sharp), pkg.dependencies.sharp).toBe(true);
    expect(atLeast(lock.packages['node_modules/sharp'].version)).toBe(true);
  });
});
