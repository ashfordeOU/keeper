// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Phones on this computer's screen: Android through scrcpy (with its own adb),
// iPhone and iPad through an AirPlay receiver. scrcpy is downloaded once on
// first use and its SHA-256 checked before it ever runs; the receiver is the
// system's own (macOS) or UxPlay from the package manager (Linux, Windows).

import { app, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { createWriteStream, existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { run } from '../../../core/platform';
import { adbConnectArgs, adbDropArgs, adbPairArgs, airplayPlan, parseAdbDevices, SCRCPY_VERSION, scrcpyArgs, scrcpyDownload, scrcpyPackageHint, uxplayArgs, type AndroidDevice, type MirrorOptions } from '../../../core/screen/mirror';

const binDir = () => path.join(app.getPath('userData'), 'scrcpy', SCRCPY_VERSION);
const exe = (n: string) => (process.platform === 'win32' ? `${n}.exe` : n);

let downloading: Promise<string> | null = null;
let progress = 0;
const mirrors = new Map<string, ChildProcess>();
let receiver: ChildProcess | null = null;

async function which(cmd: string): Promise<string | null> {
  const r = await run(process.platform === 'win32' ? 'where' : 'which', [cmd], 3000);
  return r.ok ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
}

/** The folder with scrcpy and adb: Keeper's verified copy, else one installed on the system. */
async function tools(): Promise<{ scrcpy: string; adb: string } | null> {
  const dir = binDir();
  const found = await findIn(dir);
  if (found) return found;
  const s = await which('scrcpy');
  const a = await which('adb');
  return s && a ? { scrcpy: s, adb: a } : null;
}

async function findIn(dir: string): Promise<{ scrcpy: string; adb: string } | null> {
  const walk = async (d: string, depth: number): Promise<string | null> => {
    if (depth > 2 || !existsSync(d)) return null;
    if (existsSync(path.join(d, exe('scrcpy'))) && existsSync(path.join(d, exe('adb')))) return d;
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) {
      const r = await walk(path.join(d, e.name), depth + 1);
      if (r) return r;
    }
    return null;
  };
  const d = await walk(dir, 0);
  return d ? { scrcpy: path.join(d, exe('scrcpy')), adb: path.join(d, exe('adb')) } : null;
}

export async function androidStatus() {
  const t = await tools();
  const dl = scrcpyDownload(process.platform, process.arch);
  return {
    ready: !!t,
    version: SCRCPY_VERSION,
    downloading: !!downloading,
    progress,
    canDownload: !!dl,
    hint: dl ? undefined : scrcpyPackageHint(process.platform) ?? undefined,
    size: dl ? undefined : undefined,
  };
}

/** Downloads scrcpy (with adb) from its releases and checks it against the pinned SHA-256. */
export function installAndroidTools(onProgress?: (f: number) => void): Promise<string> {
  downloading ??= (async () => {
    const dl = scrcpyDownload(process.platform, process.arch);
    if (!dl) throw new Error(`There is no ready-made scrcpy for this computer. Install it with: ${scrcpyPackageHint(process.platform) ?? 'your package manager'}`);
    const dir = binDir();
    await fsp.mkdir(dir, { recursive: true });
    const archive = path.join(dir, dl.file);
    const res = await fetch(dl.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Could not download scrcpy (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    const hash = crypto.createHash('sha256');
    const body = Readable.fromWeb(res.body as never);
    body.on('data', (c: Buffer) => {
      got += c.length;
      hash.update(c);
      progress = total ? got / total : 0;
      onProgress?.(progress);
    });
    await pipeline(body, createWriteStream(archive));
    const sum = hash.digest('hex');
    if (sum !== dl.sha256) {
      await fsp.rm(archive, { force: true });
      throw new Error('The downloaded scrcpy did not match its published checksum, so Keeper did not use it.');
    }
    if (dl.kind === 'zip' && process.platform === 'win32') {
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archive.replace(/['‘’‚‛]/g, '$&$&')}' -DestinationPath '${dir.replace(/['‘’‚‛]/g, '$&$&')}' -Force`], 120_000);
      if (!r.ok) throw new Error('Could not unpack scrcpy');
    } else {
      const r = await run('tar', ['-xf', archive, '-C', dir], 120_000);
      if (!r.ok) throw new Error('Could not unpack scrcpy');
    }
    await fsp.rm(archive, { force: true });
    const t = await findIn(dir);
    if (!t) throw new Error('scrcpy was unpacked but its programs were not found');
    if (process.platform !== 'win32') for (const f of [t.scrcpy, t.adb]) await fsp.chmod(f, 0o755).catch(() => undefined);
    return t.scrcpy;
  })().finally(() => {
    downloading = null;
  });
  return downloading;
}

async function need() {
  const t = await tools();
  if (!t) throw new Error('Set up Android mirroring first (Keeper downloads scrcpy, about 15 MB).');
  return t;
}

export async function androidDevices(): Promise<AndroidDevice[]> {
  const t = await tools();
  if (!t) return [];
  const r = await run(t.adb, ['devices', '-l'], 10_000);
  return parseAdbDevices(r.stdout);
}

export async function androidPair(hostPort: string, code: string) {
  const t = await need();
  const r = await run(t.adb, adbPairArgs(hostPort, code), 20_000);
  if (!r.ok || /fail/i.test(r.stdout + r.stderr)) throw new Error((r.stdout + r.stderr).trim().split('\n').pop() || 'Pairing failed');
  return true;
}

export async function androidConnect(hostPort: string) {
  const t = await need();
  const r = await run(t.adb, adbConnectArgs(hostPort), 15_000);
  if (!/connected to/i.test(r.stdout)) throw new Error((r.stdout + r.stderr).trim() || 'Could not connect');
  return true;
}

/** Opens the phone in its own window (scrcpy's). */
export async function androidMirror(o: MirrorOptions): Promise<boolean> {
  const t = await need();
  mirrors.get(o.serial)?.kill();
  const env = { ...process.env, ADB: t.adb };
  const p = spawn(t.scrcpy, scrcpyArgs(o), { env, stdio: 'ignore', detached: false });
  mirrors.set(o.serial, p);
  p.on('exit', () => mirrors.delete(o.serial));
  p.on('error', () => mirrors.delete(o.serial));
  return true;
}

export function androidStop(serial: string) {
  mirrors.get(serial)?.kill();
  mirrors.delete(serial);
}

/** Files dropped on a phone: apps are installed, the rest goes to Download. */
export async function androidDrop(serial: string, files: string[]): Promise<{ file: string; ok: boolean; error?: string }[]> {
  const t = await need();
  const out = [];
  for (const f of files.slice(0, 50)) {
    const r = await run(t.adb, adbDropArgs(serial, f), 10 * 60_000);
    out.push({ file: path.basename(f), ok: r.ok, error: r.ok ? undefined : (r.stderr || r.stdout).trim().slice(0, 200) });
  }
  return out;
}

// ---------------------------------------------------------------- iPhone / iPad (AirPlay, view only)

export async function airplay() {
  const ux = process.platform === 'darwin' ? null : await which('uxplay');
  return { ...airplayPlan(process.platform, ux, os.release()), running: !!receiver };
}

export async function airplayStart(name: string) {
  const plan = await airplay();
  if (plan.how === 'system') {
    if (plan.open) await shell.openExternal(plan.open);
    return plan;
  }
  if (plan.how !== 'uxplay') {
    if (plan.open) await shell.openExternal(plan.open);
    return plan;
  }
  if (!receiver) {
    const ux = (await which('uxplay'))!;
    receiver = spawn(ux, uxplayArgs(name), { stdio: 'ignore' });
    receiver.on('exit', () => (receiver = null));
    receiver.on('error', () => (receiver = null));
  }
  return { ...plan, running: true };
}

export function airplayStop() {
  receiver?.kill();
  receiver = null;
}

export function stopPhones() {
  for (const p of mirrors.values()) p.kill();
  mirrors.clear();
  airplayStop();
}
