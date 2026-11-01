// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Test runs only: point every Electron folder at a throwaway home, before any
// other part of Keeper asks where things live. macOS takes the home folder
// from the system rather than $HOME, so this has to happen inside Keeper.
// Official builds ignore it.
import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

declare const __KEEPER_OFFICIAL__: boolean | undefined;
const official = typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__;
const home = process.env.KEEPER_MACTEST_HOME;

if (!official && home && path.isAbsolute(home)) {
  const userData = process.env.KEEPER_MACTEST_USERDATA || path.join(home, 'Library', 'Application Support', 'Keeper');
  const set = (name: Parameters<typeof app.setPath>[0], p: string) => {
    try {
      app.setPath(name, p);
    } catch {
      /* not on this system */
    }
  };
  process.env.HOME = home;
  set('home', home);
  set('appData', path.join(home, 'Library', 'Application Support'));
  set('userData', userData);
  set('sessionData', userData);
  for (const [name, dir] of [['desktop', 'Desktop'], ['documents', 'Documents'], ['downloads', 'Downloads'], ['music', 'Music'], ['pictures', 'Pictures'], ['videos', 'Movies']] as const) set(name, path.join(home, dir));
  set('logs', path.join(home, 'Library', 'Logs', 'Keeper'));
  set('crashDumps', path.join(userData, 'Crashpad'));
  // Never touch the person's keychain during a test run: an unsigned test build makes macOS
  // stop and ask for their password. Secrets are sealed with a key kept in the test home instead.
  try {
    const keyFile = path.join(home, '.keeper-test-key');
    let key: Buffer;
    try {
      key = fs.readFileSync(keyFile);
      if (key.length !== 32) throw new Error('bad key');
    } catch {
      key = crypto.randomBytes(32);
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(keyFile, key, { mode: 0o600 });
    }
    const seal = (text: string) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    };
    const open = (buf: Buffer) => {
      const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    };
    const replace = (name: string, fn: unknown) => Object.defineProperty(safeStorage, name, { value: fn, configurable: true, writable: true });
    replace('isEncryptionAvailable', () => true);
    replace('isAsyncEncryptionAvailable', async () => true);
    replace('getSelectedStorageBackend', () => 'keeper_test');
    replace('encryptString', (text: string) => seal(text));
    replace('decryptString', (buf: Buffer) => open(buf));
    replace('encryptStringAsync', async (text: string) => seal(text));
    replace('decryptStringAsync', async (buf: Buffer) => ({ result: open(buf), shouldReEncrypt: false }));
    process.env.KEEPER_TEST_KEYCHAIN = '1';
  } catch (e) {
    process.stderr.write(`[test-home] could not replace the keychain: ${(e as Error).message}\n`);
  }
}
