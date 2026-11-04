// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail's security rules: encryption is required (except on this computer), a
// server with a bad certificate is refused with a plain explanation (never
// skipped unless the person ticked the box), and after signing in no password
// or sign-in token is in any file Keeper wrote.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { assertSecure, certificateProblem, isLoopback, leaksIn } from '../core/pim/security';
import type { Account } from '../core/pim/types';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-sec-test-'));
process.env.KEEPER_PIM_DIR = path.join(dir, 'pim');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Every file under a folder, read as text. */
function allText(root: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ file: p, text: fs.readFileSync(p, 'latin1') });
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

describe('encryption is required', () => {
  it('allows plain connections only to this computer', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('localhost')).toBe(true);
    expect(isLoopback('[::1]')).toBe(true);
    expect(isLoopback('imap.example.com')).toBe(false);
    expect(isLoopback('127.0.0.1.evil.example')).toBe(false);
    expect(() => assertSecure({ host: 'imap.example.com', security: 'none' })).toThrow(/only connects without encryption to a server on this computer/);
    expect(() => assertSecure({ host: '127.0.0.1', security: 'none' })).not.toThrow();
    expect(() => assertSecure({ host: 'imap.example.com', security: 'starttls' })).not.toThrow();
  });
  it('refuses a plain connection to another server before connecting', async () => {
    const { MailAccount, smtpVerify } = await import('../electron/services/pim/mail');
    const a: Account = { id: 'x', kind: 'imap', label: 'x', identities: [], imap: { host: 'imap.example.com', port: 143, security: 'none' }, smtp: { host: 'smtp.example.com', port: 25, security: 'none' }, mail: true, calendar: false, contacts: false };
    await expect(new MailAccount(a, async () => ({ user: 'u', pass: 'p' })).test()).rejects.toThrow(/without encryption/);
    await expect(smtpVerify(a, { user: 'u', pass: 'p' })).rejects.toThrow(/without encryption/);
  });
});

describe('certificate problems are said, not skipped', () => {
  it('names each problem in plain words', () => {
    expect(certificateProblem({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }, 'mail.home')).toMatch(/made itself.*Accept a self-signed certificate/);
    expect(certificateProblem({ code: 'CERT_HAS_EXPIRED' }, 'x')).toMatch(/run out/);
    expect(certificateProblem(new Error("Hostname/IP does not match certificate's altnames"), 'x')).toMatch(/different name/);
    expect(certificateProblem(new Error('Invalid login'), 'x')).toBeUndefined();
  });

  const hasOpenssl = (() => { try { execFileSync('openssl', ['version']); return true; } catch { return false; } })();
  it.skipIf(!hasOpenssl)('refuses a self-signed IMAP server unless the box is ticked', async () => {
    const key = path.join(dir, 'k.pem');
    const cert = path.join(dir, 'c.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
    const server = tls.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (s) => { s.on('error', () => undefined); s.write('* OK ready\r\n'); s.on('data', (d) => { const tag = String(d).split(' ')[0]; s.write(`${tag} NO not today\r\n`); }); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const { MailAccount } = await import('../electron/services/pim/mail');
    const acct = (insecureTls: boolean): Account => ({ id: 'x', kind: 'imap', label: 'x', identities: [], imap: { host: '127.0.0.1', port, security: 'tls' }, mail: true, calendar: false, contacts: false, insecureTls });
    try {
      const refused = await new MailAccount(acct(false), async () => ({ user: 'u', pass: 'p' })).test().then(() => null, (e: Error) => e);
      expect(refused?.message).toMatch(/certificate it made itself.*didn’t connect/);
      const ticked = await new MailAccount(acct(true), async () => ({ user: 'u', pass: 'p' })).test().then(() => null, (e: Error) => e);
      // With the box ticked the certificate is accepted; the stand-in server then turns the sign-in down.
      expect(ticked?.message ?? '').not.toMatch(/certificate/);
    } finally {
      server.close();
    }
  }, 30_000);
});

describe('no secrets in files', () => {
  it('keeps sign-in tokens out of every file written (the keychain, or memory where there is none)', async () => {
    const { signIn, saveTokens } = await import('../electron/services/pim/oauth');
    const { putSecret, writeJson, files } = await import('../electron/services/pim/store');
    const ACCESS = 'ya29.access-token-ABCDEFGHIJKLMNOP';
    const REFRESH = '1//refresh-token-QRSTUVWXYZ123456';
    const PASSWORD = 'correct horse battery staple 42';
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const logs: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); }));
    try {
      const browser = async (url: string) => {
        const u = new URL(url);
        const back = new URL(u.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'c');
        back.searchParams.set('state', u.searchParams.get('state')!);
        const http = await import('node:http');
        await new Promise<void>((r) => http.get(back.toString(), (res) => { res.resume(); res.on('end', () => r()); }));
      };
      const t = await signIn('google', { clientId: 'cid' }, 'ana@gmail.example', browser);
      await saveTokens('acct1', t);
      await putSecret('pass.acct2', PASSWORD);
      // What Keeper writes about accounts: their settings, never the secret.
      await writeJson(files.accounts(), [{ id: 'acct1', kind: 'google', label: 'ana@gmail.example', oauth: 'google', identities: [], mail: true, calendar: true, contacts: true }]);
      const written = allText(dir);
      expect(written.length).toBeGreaterThan(0);
      for (const f of written) expect(leaksIn(f.text, [ACCESS, REFRESH, PASSWORD]), f.file).toEqual([]);
      expect(leaksIn(logs.join('\n'), [ACCESS, REFRESH, PASSWORD])).toEqual([]);
    } finally {
      for (const s of spies) s.mockRestore();
      vi.unstubAllGlobals();
    }
  }, 15_000);
});
