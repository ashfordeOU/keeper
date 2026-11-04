// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Signatures you already have elsewhere: a Google account's send-from
// addresses (Gmail settings, with the sign-in Keeper already has), Apple
// Mail's signature files on a Mac, Outlook's saved signatures on Windows and
// Thunderbird's identities on every system. Read only; each is cleaned
// (core/pim/signatures.ts) before the person picks it.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appleMailVersion, parseProfilesIni, thunderbirdRoots } from '../../../core/pim/mail-import';
import { appleSignatureNames, fromGmailSendAs, fromHtmFile, fromMailSignatureFile, fromThunderbirdPrefs } from '../../../core/pim/signatures';

export interface FoundSignature {
  /** where it came from, for people ("Gmail", "Apple Mail", "Outlook", "Thunderbird") */
  source: string;
  name: string;
  html: string;
  /** the address it belongs to, when the other app says */
  email?: string;
}

/** Where the Gmail settings API lives (tests point it at a stand-in server). */
export const GMAIL_API = { base: 'https://gmail.googleapis.com/gmail/v1' };

/** The send-from addresses of a Google account, with their signatures and Reply-To. */
export async function gmailSendAs(token: string) {
  const res = await fetch(`${GMAIL_API.base}/users/me/settings/sendAs`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) throw new Error('Google did not allow reading your signature. Sign in again from Settings → Mail & Calendar.');
  if (!res.ok) throw new Error(`Google answered ${res.status}`);
  return fromGmailSendAs((await res.json()) as Parameters<typeof fromGmailSendAs>[0]);
}

async function appleMail(home: string): Promise<FoundSignature[]> {
  const mail = path.join(home, 'Library', 'Mail');
  const v = appleMailVersion(await fsp.readdir(mail).catch(() => []));
  if (!v) return [];
  const dir = path.join(mail, v, 'MailData', 'Signatures');
  const names = appleSignatureNames(await fsp.readFile(path.join(dir, 'AllSignatures.plist'), 'utf8').catch(() => ''));
  const out: FoundSignature[] = [];
  for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
    if (!f.endsWith('.mailsignature')) continue;
    const html = fromMailSignatureFile(await fsp.readFile(path.join(dir, f), 'utf8').catch(() => ''));
    if (html) out.push({ source: 'Apple Mail', name: names[f.replace(/\.mailsignature$/, '')] ?? 'Signature', html });
  }
  return out;
}

async function outlookWindows(appData: string): Promise<FoundSignature[]> {
  const dir = path.join(appData, 'Microsoft', 'Signatures');
  const out: FoundSignature[] = [];
  for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
    if (!/\.html?$/i.test(f)) continue;
    const buf = await fsp.readFile(path.join(dir, f)).catch(() => null);
    if (!buf) continue;
    // Saved as UTF-16 (with a byte-order mark) or a Windows code page; the latter reads closely enough as Latin-1.
    const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : /charset=["']?utf-8/i.test(buf.subarray(0, 2000).toString('latin1')) ? buf.toString('utf8') : buf.toString('latin1');
    const html = fromHtmFile(text);
    if (html) out.push({ source: 'Outlook', name: f.replace(/\.html?$/i, ''), html });
  }
  return out;
}

async function thunderbird(home: string): Promise<FoundSignature[]> {
  const out: FoundSignature[] = [];
  for (const root of thunderbirdRoots(process.platform, home, process.env.APPDATA)) {
    const ini = await fsp.readFile(path.join(root, 'profiles.ini'), 'utf8').catch(() => null);
    if (!ini) continue;
    for (const p of parseProfilesIni(ini, root, path.sep)) {
      const prefs = await fsp.readFile(path.join(p.path, 'prefs.js'), 'utf8').catch(() => null);
      if (!prefs) continue;
      for (const id of fromThunderbirdPrefs(prefs)) {
        let html = id.html;
        if (!html && id.file) {
          const f = path.isAbsolute(id.file) ? id.file : path.join(p.path, id.file);
          const text = await fsp.readFile(f, 'utf8').catch(() => '');
          html = text ? fromHtmFile(/<[a-z]/i.test(text) ? text : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')) : undefined;
        }
        if (html) out.push({ source: 'Thunderbird', name: id.name ? `${id.name} (${id.email})` : id.email!, html, email: id.email });
      }
    }
  }
  return out;
}

/** Signatures kept by the other mail apps on this computer. */
export async function localSignatures(home = os.homedir()): Promise<FoundSignature[]> {
  const lists = await Promise.all([
    process.platform === 'darwin' ? appleMail(home) : Promise.resolve([]),
    process.platform === 'win32' ? outlookWindows(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')) : Promise.resolve([]),
    thunderbird(home),
  ]);
  return lists.flat();
}
