// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Locked folders in the app: this computer's key (kept by the system keychain),
// confirming it is really you (Touch ID, Windows Hello, the account password or
// polkit), the list of locked folders, and locking them again automatically.

import { app, BrowserWindow, dialog, powerMonitor, safeStorage, systemPreferences } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, promises as fsp, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccountAuth, LockedFolder, LockRequest, LockStatus, RelockWhen, UnlockRequest, VaultInfo } from '../../core/api-lock';
import { run } from '../../core/platform';
import {
  attemptDelay, checkLockable, isRecoveryKeyShape, lockFolder, makeWraps, newDataKey, newRecoveryKey, readHeader, unlockFolder, unwrapKey, VaultError,
  type VaultProgress, type Wrap,
} from '../../core/vault';

interface Record_ extends LockedFolder {
  /** the wrapped keys, so the folder can be locked again the same way */
  wraps?: Wrap[];
  /** while unlocked: the folder key, encrypted by the system keychain, to lock again after a restart */
  relockKey?: string;
  failures?: number;
  waitUntil?: number;
}

const file = () => path.join(app.getPath('userData'), 'locked-folders.json');
const keyFile = () => path.join(app.getPath('userData'), 'lock-key.json');

let records: Record_[] | null = null;
/** folder keys of unlocked folders, in memory only */
const keys = new Map<string, Buffer>();
let current: AbortController | null = null;
let notify: (channel: string, ...args: unknown[]) => void = () => undefined;

function load(): Record_[] {
  if (records) return records;
  try {
    records = JSON.parse(readFileSync(file(), 'utf8')) as Record_[];
  } catch {
    records = [];
  }
  return records;
}

let writing: Promise<void> = Promise.resolve();
function save(): Promise<void> {
  const data = JSON.stringify(load(), null, 2);
  writing = writing.then(async () => {
    const tmp = `${file()}.${process.pid}.tmp`;
    await fsp.mkdir(path.dirname(file()), { recursive: true });
    await fsp.writeFile(tmp, data, { mode: 0o600 });
    await fsp.rename(tmp, file());
  }).catch(() => undefined);
  notify('locks-changed');
  return writing;
}

const samePath = (a: string, b: string) => (process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b);
const find = (p: string) => load().find((r) => samePath(r.vault, p) || (r.folder && samePath(r.folder, p)));

function publicView(r: Record_): LockedFolder {
  const { wraps: _w, relockKey: _k, failures: _f, waitUntil: _u, ...rest } = r;
  const state = r.state === 'unlocked' ? (r.folder && existsSync(r.folder) ? 'unlocked' : 'missing') : existsSync(r.vault) ? 'locked' : 'missing';
  return { ...rest, state };
}

// ---------------------------------------------------------------- this computer's key

function keychainUsable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // Without a keyring Electron on Linux uses a fixed key: that would protect nothing.
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
  return true;
}

let device: { id: string; key: Buffer } | null = null;
function deviceKey(create: boolean): { id: string; key: Buffer } | null {
  if (device) return device;
  if (!keychainUsable()) return null;
  try {
    const j = JSON.parse(readFileSync(keyFile(), 'utf8')) as { id: string; enc: string };
    device = { id: j.id, key: Buffer.from(safeStorage.decryptString(Buffer.from(j.enc, 'base64')), 'base64') };
    return device;
  } catch {
    if (!create) return null;
  }
  const key = randomBytes(32);
  const id = randomBytes(8).toString('hex');
  const enc = safeStorage.encryptString(key.toString('base64')).toString('base64');
  writeFileSync(keyFile(), JSON.stringify({ id, enc }), { mode: 0o600 });
  device = { id, key };
  return device;
}

// ---------------------------------------------------------------- is it really you?

function runWithInput(cmd: string, args: string[], input: string, timeout = 120_000): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    const t = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => (stdout += d));
    child.on('error', () => {
      clearTimeout(t);
      resolve({ code: -1, stdout });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, stdout });
    });
    child.stdin.end(input);
  });
}

const PS = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// Windows Hello: face, fingerprint or PIN, through the system's own consent dialog.
const HELLO = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime] | Out-Null
$a = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ("$a" -ne 'Available') { Write-Output "unavailable:$a"; exit }
if ($args.Count -eq 0) { Write-Output 'available'; exit }
$r = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($args[0])) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
Write-Output "result:$r"
`;

// The Windows account password, checked by Windows itself. It arrives on standard input, never on the command line.
const LOGON = `
$sig = '[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool LogonUser(string u, string d, string p, int t, int pr, out IntPtr h); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);'
$k = Add-Type -MemberDefinition $sig -Name Auth -Namespace KeeperLock -PassThru
$pw = [Console]::In.ReadLine()
$h = [IntPtr]::Zero
if ($k::LogonUser($env:USERNAME, $env:USERDOMAIN, $pw, 2, 0, [ref]$h)) { $k::CloseHandle($h) | Out-Null; 'ok' } else { 'fail' }
`;

async function hello(reason?: string): Promise<'ok' | 'unavailable' | 'cancelled' | 'failed'> {
  const script = reason ? `& { ${HELLO} } '${reason.replace(/'/g, "''")}'` : HELLO;
  const r = await run(PS(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], 180_000);
  const out = r.stdout.trim();
  if (out === 'available' || out === 'result:Verified') return 'ok';
  if (!r.ok || out.startsWith('unavailable')) return 'unavailable';
  if (out === 'result:Canceled') return 'cancelled';
  return 'failed';
}

let pkexecPath: string | null | undefined;
async function pkexec(): Promise<string | null> {
  if (pkexecPath !== undefined) return pkexecPath;
  for (const p of ['/usr/bin/pkexec', '/bin/pkexec', '/usr/local/bin/pkexec']) if (existsSync(p)) return (pkexecPath = p);
  return (pkexecPath = null);
}

let helloCache: boolean | undefined;

export async function status(): Promise<LockStatus> {
  const platform = process.platform;
  let account: AccountAuth;
  if (!keychainUsable()) {
    account = { available: false, label: 'Your account', reason: platform === 'linux' ? 'No keyring (such as GNOME Keyring or KWallet) is running, so Keeper has nowhere safe to keep this computer’s key. Use a password instead.' : 'The system keychain is not available.' };
  } else if (platform === 'darwin') {
    const touch = systemPreferences.canPromptTouchID();
    account = { available: true, label: touch ? 'Touch ID or your Mac password' : 'Your Mac password' };
  } else if (platform === 'win32') {
    if (helloCache === undefined) helloCache = (await hello()) === 'ok';
    account = helloCache ? { available: true, label: 'Windows Hello (face, fingerprint or PIN)' } : { available: true, label: 'Your Windows password', needsPassword: true };
  } else {
    account = (await pkexec())
      ? { available: true, label: 'Your password (or fingerprint, where set up)' }
      : { available: false, label: 'Your account', reason: 'This system has no polkit (pkexec) to ask for your password. Use a password instead.' };
  }
  return { account, platform };
}

/** Asks the operating system to confirm it is really the signed-in person. Throws when it is not. */
async function confirmAccount(reason: string, secret?: string, fallback?: boolean): Promise<void> {
  const fail = (m: string) => {
    throw new VaultError('wrong-key', m);
  };
  if (process.platform === 'darwin') {
    if (!fallback && systemPreferences.canPromptTouchID()) {
      try {
        await systemPreferences.promptTouchID(reason);
        return;
      } catch {
        return fail('Touch ID did not confirm it was you. Try again, or use your Mac password.');
      }
    }
    // The system's own password dialog: Keeper never sees the password.
    const r = await run('/usr/bin/osascript', ['-e', `do shell script "/usr/bin/true" with prompt "Keeper wants to ${reason.replace(/["\\]/g, '')}." with administrator privileges`], 180_000);
    if (!r.ok) fail(/-128/.test(r.stderr) ? 'Cancelled.' : 'Your Mac password was not accepted.');
    return;
  }
  if (process.platform === 'win32') {
    if (!fallback && !secret) {
      const h = await hello(`Keeper: ${reason}`);
      if (h === 'ok') return;
      if (h === 'cancelled') fail('Cancelled.');
      if (h === 'failed') fail('Windows Hello did not confirm it was you.');
    }
    if (!secret) fail('Type your Windows password.');
    const r = await runWithInput(PS(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LOGON], `${secret}\n`, 30_000);
    if (r.stdout.trim() !== 'ok') fail('That Windows password is not right.');
    return;
  }
  const pk = await pkexec();
  if (!pk) fail('This system cannot ask for your password (polkit is missing). Use the folder’s password or recovery key.');
  const r = await runWithInput(pk!, ['--disable-internal-agent', '/bin/true'], '', 180_000);
  if (r.code === 0) return;
  fail(r.code === 126 ? 'Cancelled, or the password was not accepted.' : 'No password prompt could be shown (no polkit agent is running). Use the folder’s password or recovery key.');
}

// ---------------------------------------------------------------- locking

function progress(target: string) {
  return (p: VaultProgress) => notify('lock-progress', { ...p, target });
}

function forbidden(): string[] {
  const out = [app.getPath('userData'), path.dirname(process.execPath)];
  try {
    out.push(app.getAppPath());
  } catch {
    /* not packaged */
  }
  // On a Mac the app is the whole Keeper.app bundle.
  const bundle = process.execPath.match(/^(.*?\.app)\//)?.[1];
  if (bundle) out.push(bundle);
  return out;
}

export async function canLock(dir: string): Promise<string | null> {
  const v = await checkLockable(dir, { platform: process.platform, home: os.homedir(), excluded: [] }, forbidden());
  return v.ok ? null : v.reason;
}

const wrapKey = (k: Buffer) => (keychainUsable() ? safeStorage.encryptString(k.toString('base64')).toString('base64') : undefined);
const unwrapStored = (s?: string) => (s && keychainUsable() ? Buffer.from(safeStorage.decryptString(Buffer.from(s, 'base64')), 'base64') : undefined);

export async function lock(req: LockRequest): Promise<{ vault: string; leftovers: boolean }> {
  const why = await canLock(req.dir);
  if (why) throw new VaultError('refused', why);
  if (!isRecoveryKeyShape(req.recoveryKey)) throw new VaultError('refused', 'The recovery key is missing.');
  let dev: { id: string; key: Buffer } | null = null;
  if (req.method === 'account') {
    dev = deviceKey(true);
    if (!dev) throw new VaultError('unsupported', 'This computer has no keychain to keep the key in. Use a password instead.');
  } else if (!req.password || req.password.length < 4) throw new VaultError('refused', 'Choose a password of at least 4 characters.');
  const dataKey = newDataKey();
  const wraps = await makeWraps(dataKey, { password: req.method === 'password' ? req.password : undefined, recovery: req.recoveryKey, deviceKey: dev?.key, deviceId: dev?.id });
  current = new AbortController();
  try {
    const r = await lockFolder(req.dir, { dataKey, wraps, onProgress: progress(req.dir), signal: current.signal });
    const list = load().filter((x) => !samePath(x.vault, r.vault) && !(x.folder && samePath(x.folder, req.dir)));
    list.push({ vault: r.vault, state: 'locked', methods: wraps.map((w) => w.kind), relock: req.relock, idleMinutes: req.idleMinutes, lockedAt: Date.now(), files: r.manifest.files, bytes: r.manifest.bytes, wraps });
    records = list;
    await save();
    return { vault: r.vault, leftovers: r.leftovers };
  } finally {
    current = null;
  }
}

export async function inspect(vault: string): Promise<VaultInfo> {
  const h = await readHeader(vault);
  const dev = deviceKey(false);
  const rec = find(vault);
  return {
    methods: h.wraps.map((w) => w.kind),
    thisComputer: !!dev && h.wraps.some((w) => w.kind === 'device' && w.deviceId === dev.id),
    created: h.created,
    waitSeconds: Math.max(0, Math.ceil(((rec?.waitUntil ?? 0) - Date.now()) / 1000)),
  };
}

export async function unlock(req: UnlockRequest): Promise<{ folder: string }> {
  let rec = find(req.vault);
  if (rec?.waitUntil && rec.waitUntil > Date.now()) throw new VaultError('wrong-key', `Too many wrong tries. Wait ${Math.ceil((rec.waitUntil - Date.now()) / 1000)} seconds.`);
  const header = await readHeader(req.vault);
  let dataKey: Buffer;
  try {
    if (req.method === 'account') {
      const dev = deviceKey(false);
      if (!dev || !header.wraps.some((w) => w.kind === 'device' && w.deviceId === dev.id)) throw new VaultError('wrong-key', 'This folder was not locked on this computer with your account. Use its recovery key.');
      await confirmAccount('unlock “' + path.basename(req.vault).replace(/\.keeperlock$/i, '') + '”', req.secret, req.fallback);
      dataKey = await unwrapKey(header, { deviceKey: dev.key });
    } else if (req.method === 'password') dataKey = await unwrapKey(header, { password: req.secret ?? '' });
    else dataKey = await unwrapKey(header, { recovery: req.secret ?? '' });
  } catch (err) {
    if (err instanceof VaultError && err.code === 'wrong-key' && err.message !== 'Cancelled.') {
      if (!rec) {
        rec = { vault: req.vault, state: 'locked', methods: header.wraps.map((w) => w.kind), relock: 'never', wraps: header.wraps };
        load().push(rec);
      }
      rec.failures = (rec.failures ?? 0) + 1;
      rec.waitUntil = Date.now() + attemptDelay(rec.failures);
      await save();
    }
    throw err;
  }
  current = new AbortController();
  try {
    const r = await unlockFolder(req.vault, dataKey, { onProgress: progress(req.vault), signal: current.signal });
    if (!rec) {
      rec = { vault: req.vault, state: 'unlocked', methods: header.wraps.map((w) => w.kind), relock: req.relock ?? 'never' };
      load().push(rec);
    }
    Object.assign(rec, {
      state: 'unlocked', folder: r.folder, unlockedAt: Date.now(), failures: 0, waitUntil: 0, wraps: header.wraps,
      relock: req.relock ?? rec.relock ?? 'never', idleMinutes: req.idleMinutes ?? rec.idleMinutes, relockKey: wrapKey(dataKey),
      files: r.manifest.files, bytes: r.manifest.bytes,
    });
    keys.set(r.folder, dataKey);
    await save();
    return { folder: r.folder };
  } finally {
    current = null;
  }
}

export async function relock(target: string): Promise<{ vault: string }> {
  const rec = find(target);
  if (!rec || rec.state !== 'unlocked' || !rec.folder) throw new VaultError('refused', 'This folder is not one Keeper unlocked. Use Lock Folder… instead.');
  if (!existsSync(rec.folder)) {
    rec.state = 'locked';
    await save();
    throw new VaultError('refused', 'The unlocked folder is no longer there.');
  }
  const dataKey = keys.get(rec.folder) ?? unwrapStored(rec.relockKey);
  if (!dataKey || !rec.wraps?.length) throw new VaultError('refused', 'Keeper no longer has this folder’s key. Use Lock Folder… to lock it again.');
  current = new AbortController();
  try {
    const r = await lockFolder(rec.folder, { dataKey, wraps: rec.wraps, onProgress: progress(rec.folder), signal: current.signal });
    keys.delete(rec.folder);
    Object.assign(rec, { vault: r.vault, state: 'locked', folder: undefined, relockKey: undefined, unlockedAt: undefined, lockedAt: Date.now(), files: r.manifest.files, bytes: r.manifest.bytes });
    await save();
    return { vault: r.vault };
  } finally {
    current = null;
  }
}

export function list(): LockedFolder[] {
  return load().map(publicView);
}

export async function forget(vault: string): Promise<LockedFolder[]> {
  records = load().filter((r) => !samePath(r.vault, vault));
  await save();
  return list();
}

export async function setRelock(vault: string, when: RelockWhen, idleMinutes?: number): Promise<LockedFolder[]> {
  const r = find(vault);
  if (r) {
    r.relock = when;
    r.idleMinutes = idleMinutes ?? r.idleMinutes;
    await save();
  }
  return list();
}

export function cancel() {
  current?.abort();
}

export async function newKey(): Promise<string> {
  return newRecoveryKey();
}

export async function saveRecoveryKey(key: string, folderName: string): Promise<boolean> {
  const win = BrowserWindow.getFocusedWindow() ?? undefined;
  const r = await dialog.showSaveDialog(win!, { defaultPath: path.join(app.getPath('documents'), `${folderName} - Keeper recovery key.txt`), filters: [{ name: 'Text', extensions: ['txt'] }] });
  if (r.canceled || !r.filePath) return false;
  await fsp.writeFile(r.filePath, `Keeper recovery key for the locked folder “${folderName}”\n\n${key}\n\nKeep this somewhere safe and away from this computer. It unlocks the folder if you forget the password or this computer's account changes.\n`, { mode: 0o600 });
  return true;
}

// ---------------------------------------------------------------- locking again automatically

async function relockWhere(test: (r: Record_) => boolean) {
  for (const r of load().filter((x) => x.state === 'unlocked' && x.folder && existsSync(x.folder) && test(x))) {
    try {
      await relock(r.folder!);
    } catch {
      /* in use or gone: tried again next time */
    }
  }
}

/** Folders to lock before Keeper quits. */
export function pendingOnQuit(): boolean {
  return load().some((r) => r.state === 'unlocked' && r.relock === 'quit' && r.folder && existsSync(r.folder));
}

export function relockOnQuit(): Promise<void> {
  return relockWhere((r) => r.relock === 'quit');
}

export function initLock(broadcast: (channel: string, ...args: unknown[]) => void) {
  notify = broadcast;
  powerMonitor.on('lock-screen', () => void relockWhere((r) => r.relock === 'screen' || r.relock === 'idle'));
  powerMonitor.on('suspend', () => void relockWhere((r) => r.relock === 'screen' || r.relock === 'idle'));
  // "After N minutes": N minutes since unlocking, and nobody has touched the computer for N minutes either.
  setInterval(() => {
    const now = Date.now();
    const idle = powerMonitor.getSystemIdleTime() * 1000;
    void relockWhere((r) => r.relock === 'idle' && !!r.unlockedAt && Math.min(now - r.unlockedAt, idle) >= (r.idleMinutes ?? 15) * 60_000);
  }, 30_000).unref?.();
  // Folders that should have been locked when Keeper last quit (a crash or a forced quit) are locked now.
  const started = Date.now();
  setTimeout(() => void relockWhere((r) => r.relock === 'quit' && (r.unlockedAt ?? 0) < started), 5_000);
}
