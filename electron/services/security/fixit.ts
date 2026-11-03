// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Fix-it List's work on exact items: the details gathered when a row is
// opened (who signed a login item, what an extension may do, a certificate's
// subject and fingerprint), Show in Finder / Explorer, the browser's own page
// for an extension, and the fixes Keeper can do itself and undo: turning off a
// login item (a copy of its file is kept) and removing a certificate (a copy
// is kept). Nothing here runs until a row is opened or a button is pressed.

import { app, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { createReadStream, existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { docUrl } from '../../../core/brand';
import type { AutoFixPreview, AutoFixResult, Finding, FindingDetails, Fix, Subject } from '../../../core/guide/types';
import { powershell, run } from '../../../core/platform';
import { extensionPageUrl, extensionStoreUrl, permissionMeaning } from '../../../core/security/browsers';
import { runnerOf, signerName } from '../../../core/security/known-tools';
import { launchdJob, parsePlist } from '../../../core/security/plist';
import type { AutoFix } from '../guide';

type LoginItem = Extract<Subject, { kind: 'login-item' }>;
type Extension = Extract<Subject, { kind: 'extension' }>;
type Certificate = Extract<Subject, { kind: 'certificate' }>;
type Row = FindingDetails['sections'][number]['rows'][number];

const PLATFORM = process.platform;
const home = () => os.homedir();
const backups = () => path.join(app.getPath('userData'), 'fixit-backups');
const when = (ms?: number) => (ms ? new Date(ms).toLocaleString() : undefined);
const row = (label: string, value: string | undefined | null, extra: Partial<Row> = {}): Row[] => (value ? [{ label, value, ...extra }] : []);

// ---------------------------------------------------------------- which fixes Keeper can do itself

/** Who may remove a login item: the person, an administrator, or nobody here. */
export function loginItemOwner(s: LoginItem): 'user' | 'admin' | undefined {
  if (s.where === 'launch-agent') return s.path.startsWith(home() + path.sep) ? 'user' : 'admin';
  if (s.where === 'launch-daemon') return 'admin';
  if (s.where === 'autostart' || s.where === 'systemd-user' || s.where === 'startup-folder') return 'user';
  return undefined;
}

export function fixFor(s: Subject): Fix | undefined {
  if (s.kind === 'login-item') {
    const who = loginItemOwner(s);
    return who ? { kind: 'auto', action: 'fixit.login-item', label: 'Turn it off', needsAdmin: who === 'admin' } : undefined;
  }
  if (s.kind === 'certificate') {
    const can = PLATFORM === 'darwin' ? !!s.sha1 : PLATFORM === 'win32' ? !!s.sha1 : !!s.file;
    return can ? { kind: 'auto', action: 'fixit.certificate', label: 'Remove it', needsAdmin: true } : undefined;
  }
  return { kind: 'auto', action: 'fixit.extension', label: `Remove it in ${s.browser}` };
}

// ---------------------------------------------------------------- backups, so a fix can be undone

interface Backup { id: string; subject: Subject; file: string; at: number }

async function readBackups(): Promise<Record<string, Backup>> {
  try {
    return JSON.parse(await fsp.readFile(path.join(backups(), 'index.json'), 'utf8')) as Record<string, Backup>;
  } catch {
    return {};
  }
}

async function writeBackups(b: Record<string, Backup>) {
  await fsp.mkdir(backups(), { recursive: true });
  const f = path.join(backups(), 'index.json');
  await fsp.writeFile(`${f}.tmp`, JSON.stringify(b, null, 1));
  await fsp.rename(`${f}.tmp`, f);
}

async function keepCopy(id: string, subject: Subject, name: string, data: Buffer | string): Promise<string> {
  const dir = path.join(backups(), `${Date.now()}-${createHash('sha256').update(id).digest('hex').slice(0, 10)}`);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, path.basename(name));
  await fsp.writeFile(file, data, { mode: 0o600 });
  const all = await readBackups();
  all[id] = { id, subject, file, at: Date.now() };
  await writeBackups(all);
  return file;
}

async function admin(cmds: { file: string; args: string[] }[]): Promise<{ ok: boolean; message: string }> {
  const { runCmds } = await import('../elevate');
  const r = await runCmds(cmds.map((c) => ({ ...c, admin: true })), 120_000);
  return { ok: r.ok, message: r.message };
}

const uid = () => (typeof process.getuid === 'function' ? process.getuid() : 0);
const unitOf = (s: LoginItem) => path.basename(s.path);

// ---------------------------------------------------------------- login items

function loginItemPreview(s: LoginItem): AutoFixPreview {
  const who = loginItemOwner(s);
  const what = s.where === 'launch-agent' || s.where === 'launch-daemon'
    ? `Keeper stops it (launchctl bootout) and ${who === 'admin' ? 'deletes' : 'moves to the Trash'} ${path.basename(s.path)}, so it no longer starts by itself.`
    : s.where === 'systemd-user'
      ? `Keeper stops and disables the ${unitOf(s)} service and moves its file to the Trash.`
      : `Keeper moves ${path.basename(s.path)} to the ${PLATFORM === 'win32' ? 'Recycle Bin' : 'Trash'}, so it no longer starts when you sign in.`;
  return {
    summary: `${what} A copy of the file is kept, so Undo puts it back and starts it again.`,
    items: [{ label: s.path }, ...(s.program ? [{ label: s.program, detail: 'what it runs (left in place)' }] : [])],
    undoable: true,
    needsAdmin: who === 'admin',
    warning: s.tool ? `This is ${s.tool.name}. It stops working until you turn it on again.` : undefined,
  };
}

async function turnOffLoginItem(id: string, s: LoginItem): Promise<AutoFixResult> {
  const data = await fsp.readFile(s.path).catch(() => undefined);
  if (!data) return { ok: false, message: 'The file is no longer there.' };
  await keepCopy(id, s, s.path, data);
  const who = loginItemOwner(s);
  if (PLATFORM === 'darwin') {
    if (s.where === 'launch-daemon') {
      const r = await admin([{ file: '/bin/sh', args: ['-c', '/bin/launchctl bootout system "$1" 2>/dev/null; /bin/rm -f "$1"', 'sh', s.path] }]);
      if (!r.ok) return { ok: false, message: r.message };
    } else {
      await run('/bin/launchctl', ['bootout', `gui/${uid()}`, s.path], 15_000);
      if (who === 'admin') {
        const r = await admin([{ file: '/bin/rm', args: ['-f', s.path] }]);
        if (!r.ok) return { ok: false, message: r.message };
      } else await shell.trashItem(s.path);
    }
  } else {
    if (s.where === 'systemd-user') await run('systemctl', ['--user', 'disable', '--now', unitOf(s)], 20_000);
    await shell.trashItem(s.path).catch(async () => fsp.rm(s.path, { force: true }));
  }
  return { ok: true, message: `${s.tool?.name ?? s.name} no longer starts by itself. A copy is kept for Undo.` };
}

async function turnOnLoginItem(id: string): Promise<AutoFixResult> {
  const b = (await readBackups())[id];
  if (!b || b.subject.kind !== 'login-item' || !existsSync(b.file)) return { ok: false, message: 'Keeper has no copy to put back.' };
  const s = b.subject;
  if (PLATFORM === 'darwin' && loginItemOwner(s) === 'admin') {
    const boot = s.where === 'launch-daemon' ? '; /bin/launchctl bootstrap system "$2" 2>/dev/null; true' : '';
    const r = await admin([{ file: '/bin/sh', args: ['-c', `/bin/cp "$1" "$2" && /usr/sbin/chown root:wheel "$2" && /bin/chmod 644 "$2"${boot}`, 'sh', b.file, s.path] }]);
    if (!r.ok) return { ok: false, message: r.message };
    if (s.where === 'launch-agent') await run('/bin/launchctl', ['bootstrap', `gui/${uid()}`, s.path], 15_000);
  } else {
    await fsp.mkdir(path.dirname(s.path), { recursive: true });
    await fsp.copyFile(b.file, s.path);
    if (PLATFORM === 'darwin') await run('/bin/launchctl', ['bootstrap', `gui/${uid()}`, s.path], 15_000);
    if (s.where === 'systemd-user') {
      await run('systemctl', ['--user', 'daemon-reload'], 20_000);
      await run('systemctl', ['--user', 'enable', '--now', unitOf(s)], 20_000);
    }
  }
  return { ok: true, message: `${s.tool?.name ?? s.name} starts by itself again.` };
}

// ---------------------------------------------------------------- certificates

const MAC_KEYCHAIN = '/Library/Keychains/System.keychain';

/** The PEM of one certificate in a macOS keychain, by its SHA-1. */
async function macPem(keychain: string, sha1: string): Promise<string | undefined> {
  const r = await run('/usr/bin/security', ['find-certificate', '-a', '-Z', '-p', keychain], 20_000);
  if (!r.ok) return undefined;
  for (const block of r.stdout.split(/\n(?=SHA-256 hash:)|\n(?=SHA-1 hash:)/)) {
    if (!new RegExp(`SHA-1 hash:\\s*${sha1}`, 'i').test(block)) continue;
    return block.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
  }
  return undefined;
}

async function certificatePem(s: Certificate): Promise<string | Buffer | undefined> {
  if (PLATFORM === 'darwin' && s.sha1) return macPem(s.store.startsWith('/') ? s.store : MAC_KEYCHAIN, s.sha1);
  if (PLATFORM === 'win32' && s.sha1 && /^[0-9A-F]+$/i.test(s.sha1)) {
    const r = await powershell(`[Convert]::ToBase64String((Get-Item 'Cert:\\LocalMachine\\Root\\${s.sha1}').RawData)`, 20_000);
    const b64 = r.stdout.trim();
    return r.ok && b64 ? `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n` : undefined;
  }
  if (s.file) return fsp.readFile(s.file).catch(() => undefined);
  return undefined;
}

function certificatePreview(s: Certificate): AutoFixPreview {
  return {
    summary: `Keeper removes “${s.name}” from ${PLATFORM === 'darwin' ? 'the System keychain' : PLATFORM === 'win32' ? 'the computer’s trusted certificates' : 'the system’s trusted certificates'}. Anything that relied on it (a workplace network, a VPN, a developer tool) stops trusting it. A copy is kept, so Undo adds it back.`,
    items: [{ label: s.name, detail: s.sha1 ? `SHA-1 ${s.sha1}` : s.file }],
    undoable: true,
    needsAdmin: true,
  };
}

async function removeCertificate(id: string, s: Certificate): Promise<AutoFixResult> {
  const pem = await certificatePem(s);
  if (!pem) return { ok: false, message: 'Keeper could not find that certificate any more.' };
  await keepCopy(id, s, `${(s.sha1 ?? s.name).replace(/[^\w.-]+/g, '_')}.pem`, pem);
  let r: { ok: boolean; message: string };
  if (PLATFORM === 'darwin') r = await admin([{ file: '/usr/bin/security', args: ['delete-certificate', '-Z', s.sha1!, s.store.startsWith('/') ? s.store : MAC_KEYCHAIN] }]);
  else if (PLATFORM === 'win32') r = await admin([{ file: 'certutil', args: ['-delstore', 'Root', s.sha1!] }]);
  else r = await admin([{ file: 'sh', args: ['-c', 'rm -f "$1" && (update-ca-certificates || update-ca-trust || trust extract-compat) >/dev/null 2>&1; true', 'sh', s.file!] }]);
  return r.ok ? { ok: true, message: `“${s.name}” is no longer trusted. A copy is kept for Undo.` } : { ok: false, message: r.message };
}

async function restoreCertificate(id: string): Promise<AutoFixResult> {
  const b = (await readBackups())[id];
  if (!b || b.subject.kind !== 'certificate' || !existsSync(b.file)) return { ok: false, message: 'Keeper has no copy to put back.' };
  const s = b.subject;
  let r: { ok: boolean; message: string };
  if (PLATFORM === 'darwin') r = await admin([{ file: '/usr/bin/security', args: ['add-trusted-cert', '-d', '-r', 'trustRoot', '-k', s.store.startsWith('/') ? s.store : MAC_KEYCHAIN, b.file] }]);
  else if (PLATFORM === 'win32') r = await admin([{ file: 'certutil', args: ['-addstore', 'Root', b.file] }]);
  else r = await admin([{ file: 'sh', args: ['-c', 'cp "$1" "$2" && (update-ca-certificates || update-ca-trust || trust extract-compat) >/dev/null 2>&1; true', 'sh', b.file, s.file!] }]);
  return r.ok ? { ok: true, message: `“${s.name}” is trusted again.` } : { ok: false, message: r.message };
}

// ---------------------------------------------------------------- extensions: the browser's own page

const MAC_APP: Record<string, string> = { Chrome: 'Google Chrome', Chromium: 'Chromium', Edge: 'Microsoft Edge', Brave: 'Brave Browser', Vivaldi: 'Vivaldi', Opera: 'Opera', Arc: 'Arc', Firefox: 'Firefox' };
const WIN_EXE: Record<string, string> = { Chrome: 'chrome', Chromium: 'chromium', Edge: 'msedge', Brave: 'brave', Vivaldi: 'vivaldi', Opera: 'opera', Firefox: 'firefox' };
const LINUX_BIN: Record<string, string[]> = { Chrome: ['google-chrome', 'google-chrome-stable'], Chromium: ['chromium', 'chromium-browser'], Edge: ['microsoft-edge', 'microsoft-edge-stable'], Brave: ['brave-browser', 'brave'], Vivaldi: ['vivaldi', 'vivaldi-stable'], Opera: ['opera'], Firefox: ['firefox'] };

async function stubbed(entry: Record<string, unknown>): Promise<boolean> {
  const stub = process.env.KEEPER_GUIDE_OPEN_STUB;
  if (!stub) return false;
  await fsp.appendFile(stub, JSON.stringify(entry) + '\n');
  return true;
}

/** Opens the browser at its page for this extension (where Remove is). */
export async function openExtensionPage(s: Extension): Promise<{ ok: boolean; message: string }> {
  const url = extensionPageUrl(s.browser, s.id);
  if (await stubbed({ extension: s.id, browser: s.browser, url })) return { ok: true, message: `Opened ${s.browser}.` };
  const detach = (cmd: string, args: string[]) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  };
  if (PLATFORM === 'darwin') {
    const r = await run('/usr/bin/open', ['-a', MAC_APP[s.browser] ?? s.browser, url], 15_000);
    if (!r.ok) return { ok: false, message: `${s.browser} did not open. Type ${url} in its address bar.` };
  } else if (PLATFORM === 'win32') {
    detach('cmd.exe', ['/c', 'start', '""', WIN_EXE[s.browser] ?? 'chrome', url]);
  } else {
    let found: string | undefined;
    for (const b of LINUX_BIN[s.browser] ?? []) if ((await run('which', [b], 5000)).ok) { found = b; break; }
    if (!found) return { ok: false, message: `${s.browser} was not found. Type ${url} in its address bar.` };
    detach(found, [url]);
  }
  return { ok: true, message: `Opened ${s.browser} at the extension. Press Remove there if you do not need it.` };
}

// ---------------------------------------------------------------- Show in Finder / Explorer

export async function reveal(s: Subject): Promise<{ ok: boolean; message?: string }> {
  const target = s.kind === 'login-item' ? s.path : s.kind === 'certificate' ? s.file : s.profileDir ? path.join(s.profileDir, 'Extensions', s.id) : undefined;
  if (!target || !existsSync(target)) return { ok: false, message: 'It is not a file Keeper can show.' };
  if (await stubbed({ reveal: target })) return { ok: true };
  shell.showItemInFolder(target);
  return { ok: true };
}

export function canReveal(s: Subject): boolean {
  const target = s.kind === 'login-item' ? s.path : s.kind === 'certificate' ? s.file : s.profileDir ? path.join(s.profileDir, 'Extensions', s.id) : undefined;
  return !!target && existsSync(target);
}

// ---------------------------------------------------------------- details, gathered when a row is opened

async function sha256File(file: string): Promise<string | undefined> {
  const st = await fsp.stat(file).catch(() => undefined);
  if (!st?.isFile() || st.size > 512 * 1024 * 1024) return undefined;
  return new Promise((resolve) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', () => resolve(undefined));
  });
}

/** The program's path, without arguments. */
export function programPath(program?: string): string | undefined {
  if (!program) return undefined;
  return program.match(/^"([^"]+)"/)?.[1] ?? program.match(/^'([^']+)'/)?.[1] ?? program.split(/\s+/)[0];
}

async function signature(file: string): Promise<{ rows: Row[]; notarized?: boolean }> {
  if (!existsSync(file)) return { rows: row('Signed', 'The program is not there (it may be installed later or removed)') };
  if (PLATFORM === 'darwin') {
    const [cs, sp] = await Promise.all([run('/usr/bin/codesign', ['-dvvv', file], 15_000), run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '-vv', file], 20_000)]);
    const out = `${cs.stdout}\n${cs.stderr}`;
    if (/not signed at all/i.test(out)) return { rows: row('Signed', 'No — Keeper cannot tell who made it') };
    const authorities = [...out.matchAll(/^Authority=(.+)$/gm)].map((m) => m[1]);
    const sp2 = `${sp.stdout}\n${sp.stderr}`;
    const notarized = /source=Notarized Developer ID/i.test(sp2);
    const who = signerName(authorities[0]);
    return {
      notarized,
      rows: [
        ...row('Signed by', who.name ?? authorities[0]),
        ...row('Developer team', out.match(/^TeamIdentifier=(.+)$/m)?.[1]?.replace('not set', 'none')),
        ...row('Certificate chain', authorities.join(' → ')),
        ...row('Identifier', out.match(/^Identifier=(.+)$/m)?.[1], { mono: true }),
        ...row('Checked by Apple (notarized)', notarized ? 'Yes' : /source=Apple System/i.test(sp2) ? 'Part of macOS' : sp.ok ? 'No (allowed to run)' : 'No'),
        ...row('Code hash', out.match(/^CDHash=(.+)$/m)?.[1], { mono: true }),
      ],
    };
  }
  if (PLATFORM === 'win32') {
    const r = await powershell(`$s=Get-AuthenticodeSignature -LiteralPath '${file.replace(/['‘’‚‛]/g, '$&$&')}'; @{status=[string]$s.Status;signer=[string]$s.SignerCertificate.Subject;issuer=[string]$s.SignerCertificate.Issuer} | ConvertTo-Json -Compress`, 20_000);
    try {
      const o = JSON.parse(r.stdout) as { status?: string; signer?: string; issuer?: string };
      return { rows: [...row('Signature', o.status === 'Valid' ? 'Valid' : o.status === 'NotSigned' ? 'Not signed — Keeper cannot tell who made it' : o.status), ...row('Publisher', o.signer?.match(/CN=([^,]+)/)?.[1] ?? o.signer), ...row('Issued by', o.issuer?.match(/CN=([^,]+)/)?.[1])] };
    } catch {
      return { rows: [] };
    }
  }
  // Linux: which package installed it.
  for (const [cmd, args] of [['dpkg', ['-S', file]], ['rpm', ['-qf', file]], ['pacman', ['-Qo', file]]] as const) {
    const r = await run(cmd, [...args], 10_000);
    if (r.ok && r.stdout.trim()) return { rows: row('Installed by package', r.stdout.trim().split('\n')[0].replace(/:\s.*$/, '').replace(/^.* is owned by /, '')) };
  }
  const st = await fsp.stat(file).catch(() => undefined);
  return { rows: row('Installed by package', st ? `None — owned by ${st.uid === uid() ? 'you' : st.uid === 0 ? 'the system (root)' : `user ${st.uid}`}` : undefined) };
}

const WHERE: Record<string, string> = {
  'launch-agent': 'Launch agent: runs when you sign in', 'launch-daemon': 'Launch daemon: runs for the whole computer, before anyone signs in',
  autostart: 'Autostart entry: runs when you sign in', 'systemd-user': 'Your systemd service', 'systemd-system': 'A system service',
  'run-key': 'Run key in the registry', 'scheduled-task': 'Scheduled task', 'startup-folder': 'Startup folder', cron: 'Scheduled job (cron)',
};

async function loginItemDetails(s: LoginItem): Promise<FindingDetails['sections']> {
  const st = await fsp.stat(s.path).catch(() => undefined);
  const raw = st && st.size < 256 * 1024 ? await fsp.readFile(s.path, 'utf8').catch(() => '') : '';
  let text = raw;
  if (/\.plist$/i.test(s.path) && raw.startsWith('bplist') && PLATFORM === 'darwin') text = (await run('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', s.path], 10_000)).stdout;
  const job = /\.plist$/i.test(s.path) ? launchdJob(parsePlist(text)) : undefined;
  const program = job?.program ?? programPath(s.program);
  const found: Row[] = [
    ...row('Name', s.tool?.name ?? s.name),
    ...row('Label', job?.label ?? s.label, { mono: true }),
    ...row('Where', WHERE[s.where] ?? s.where),
    ...row('File', s.path, { mono: true }),
    ...row('Runs', program, { mono: true }),
    ...row('With', job?.args.length ? job.args.join(' ') : undefined, { mono: true }),
    ...row('Starts at login', job?.runAtLoad === undefined ? undefined : job.runAtLoad ? 'Yes (RunAtLoad)' : 'No'),
    ...row('Kept running', job?.keepAlive === undefined ? undefined : job.keepAlive === true ? 'Yes, restarted if it stops (KeepAlive)' : job.keepAlive === false ? 'No' : job.keepAlive),
    ...row('Runs every', job?.startInterval ? `${job.startInterval} seconds` : undefined),
    ...row('Working folder', job?.workingDirectory, { mono: true }),
    ...row('First noticed', when(s.firstSeen)),
    ...row('File created', when(st?.birthtimeMs || undefined)),
    ...row('File changed', when(st?.mtimeMs)),
  ];
  // A GitHub Actions runner says which repository it works for in its .runner file.
  if (s.tool?.id === 'github-runner') {
    const dir = job?.workingDirectory ?? (program ? path.dirname(program) : undefined);
    const conf = dir ? await fsp.readFile(path.join(dir, '.runner'), 'utf8').catch(() => '') : '';
    let url: string | undefined;
    let name: string | undefined;
    try {
      const o = JSON.parse(conf.replace(/^﻿/, '')) as { gitHubUrl?: string; agentName?: string };
      url = o.gitHubUrl;
      name = o.agentName;
    } catch {
      /* not readable */
    }
    const r = runnerOf(s.label ?? '');
    found.push(...row('Repository', url ?? (r.repo ? `https://github.com/${r.repo}` : undefined), { url: url ?? (r.repo ? `https://github.com/${r.repo}` : undefined) }), ...row('Runner name', name ?? r.runner));
  }
  const sig = program ? await signature(program) : { rows: [] };
  const hash = program && existsSync(program) ? await sha256File(program) : undefined;
  const sections: FindingDetails['sections'] = [
    { title: 'What was found', rows: found },
    { title: 'Who made it', rows: [...(s.tool ? row('Recognised as', `${s.tool.name} by ${s.tool.maker}${s.tool.verified && s.signed ? ' (signed by them)' : ''}`) : []), ...sig.rows, ...row('SHA-256 of the program', hash, { mono: true })] },
  ];
  if (text.trim()) sections.push({ title: 'The file’s contents', rows: [], text: text.length > 8000 ? `${text.slice(0, 8000)}\n…` : text, mono: true });
  return sections;
}

function extensionDetails(s: Extension): FindingDetails['sections'] {
  const store = extensionStoreUrl(s.browser, s.id, s.fromStore);
  return [
    {
      title: 'The extension',
      rows: [
        ...row('Name', s.name),
        ...row('Version', s.version),
        ...row('ID', s.id, { mono: true }),
        ...row('Browser', s.browser),
        ...row('Profile', s.profile),
        ...row('Installed from', s.fromStore === false ? 'Not from the browser’s store (added by a program or by hand)' : s.fromStore ? 'The browser’s store' : undefined),
        ...row('Store page', store, { url: store }),
        ...row('Its page in the browser', extensionPageUrl(s.browser, s.id), { mono: true }),
        ...row('Folder', s.profileDir ? path.join(s.profileDir, 'Extensions', s.id) : undefined, { mono: true }),
      ],
    },
    {
      title: 'What it may do',
      rows: [...s.hostPermissions, ...s.permissions].map((p) => ({ label: p, value: permissionMeaning(p), mono: false })),
    },
  ];
}

async function certificateDetails(s: Certificate): Promise<FindingDetails['sections']> {
  const pem = await certificatePem(s).catch(() => undefined);
  let x: X509Certificate | undefined;
  try {
    x = pem ? new X509Certificate(pem) : undefined;
  } catch {
    x = undefined;
  }
  const dn = (t?: string) => t?.split('\n').filter(Boolean).join(', ');
  return [{
    title: 'The certificate',
    rows: [
      ...row('Name', s.name),
      ...row('Subject', dn(x?.subject)),
      ...row('Issued by', dn(x?.issuer)),
      ...row('Valid from', x ? new Date(x.validFrom).toLocaleDateString() : undefined),
      ...row('Valid until', x ? new Date(x.validTo).toLocaleDateString() : undefined),
      ...row('Can sign other certificates', x ? (x.ca ? 'Yes (a certificate authority)' : 'No') : undefined),
      ...row('SHA-256 fingerprint', x?.fingerprint256 ?? s.sha256, { mono: true }),
      ...row('SHA-1 fingerprint', x?.fingerprint ?? s.sha1, { mono: true }),
      ...row('Kept in', s.store, { mono: s.store.startsWith('/') }),
      ...row('File', s.file, { mono: true }),
    ],
  }];
}

const CONFIDENCE: Record<NonNullable<Finding['confidence']>, string> = {
  sure: 'Keeper is sure this needs doing.',
  likely: 'Probably worth a look.',
  unsure: 'Often fine: Keeper lists it so nothing changes without you knowing.',
};

function learnMoreOf(f: Finding): FindingDetails['learnMore'] {
  const l = f.learnMore;
  if (!l) return undefined;
  if (/^https:\/\//.test(l)) return { label: 'Learn more', url: l };
  const [doc, anchor] = l.split('#');
  return { label: 'Learn more', url: docUrl(doc, anchor) };
}

/** Everything about one finding, gathered when its row is opened. */
export async function details(f: Finding): Promise<FindingDetails> {
  const s = f.subject;
  let sections: FindingDetails['sections'] = [];
  if (s?.kind === 'login-item') sections = await loginItemDetails(s);
  else if (s?.kind === 'extension') sections = extensionDetails(s);
  else if (s?.kind === 'certificate') sections = await certificateDetails(s);
  else if (f.detail || f.impact) sections = [{ title: 'What was found', rows: [...row('Details', f.detail), ...row('Impact', f.impact)] }];
  return {
    sections: sections.filter((x) => x.rows.length || x.text),
    why: f.why,
    confidence: f.confidence ? CONFIDENCE[f.confidence] : undefined,
    learnMore: learnMoreOf(f),
    actions: { reveal: s ? canReveal(s) : false, extensionPage: s?.kind === 'extension' ? s.browser : undefined },
  };
}

// ---------------------------------------------------------------- registered with the guide

export function registerSubjectFixes(register: (action: string, fix: AutoFix) => void) {
  const subjectOf = <K extends Subject['kind']>(f: Finding, kind: K): Extract<Subject, { kind: K }> => {
    if (f.subject?.kind !== kind) throw new Error('This item cannot be fixed that way');
    return f.subject as Extract<Subject, { kind: K }>;
  };
  register('fixit.login-item', {
    async preview(f) { return loginItemPreview(subjectOf(f, 'login-item')); },
    async apply(f) {
      const r = await turnOffLoginItem(f.id, subjectOf(f, 'login-item'));
      if (r.ok) await import('./index').then((m) => m.checkPersistence(false)).catch(() => undefined);
      return r;
    },
    async undo(f) {
      const r = await turnOnLoginItem(f.id);
      if (r.ok) await import('./index').then((m) => m.checkPersistence(false)).catch(() => undefined);
      return r;
    },
  });
  register('fixit.certificate', {
    async preview(f) { return certificatePreview(subjectOf(f, 'certificate')); },
    async apply(f) {
      const r = await removeCertificate(f.id, subjectOf(f, 'certificate'));
      if (r.ok) await import('./index').then((m) => m.overview(true)).catch(() => undefined);
      return r;
    },
    async undo(f) {
      const r = await restoreCertificate(f.id);
      if (r.ok) await import('./index').then((m) => m.overview(true)).catch(() => undefined);
      return r;
    },
  });
  register('fixit.extension', {
    async preview(f) {
      const s = subjectOf(f, 'extension');
      return { summary: `Keeper opens ${s.browser} at the page for “${s.name}”. Press Remove there: browsers only let you remove extensions yourself. Keeper checks again when you come back.`, items: [{ label: s.name, detail: `${s.profile} · ${s.id}` }], undoable: false, opensOnly: true };
    },
    async apply(f) {
      const r = await openExtensionPage(subjectOf(f, 'extension'));
      return { ...r, pending: r.ok };
    },
  });
}
