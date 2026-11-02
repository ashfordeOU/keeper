// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Privacy & Security: the overview with its score, scans with several engines,
// real-time protection of the places files arrive, quarantine, watching for new
// startup items and miner-like processes, and a timeline of what happened.
//
// No tool can promise to catch everything; Keeper layers its own checks, YARA
// rules, ClamAV's signatures and the system's own engine (Defender on Windows)
// and says plainly which of them are working.

import { app, dialog, net, shell } from 'electron';
import { existsSync, promises as fsp, readFileSync, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ConnectionsView, EngineStatus, SecurityOverview, SecuritySettings } from '../../../core/api-security';
import { run } from '../../../core/platform';
import { clamscanArgs, freshclamArgs, freshclamConfig, parseClamOutput, parseClamVersion } from '../../../core/security/clamav';
import { autoQuarantine, sniff, RISKY, suspiciousProcess } from '../../../core/security/heuristics';
import { countInRange, passwordPrefix, RANGE_URL } from '../../../core/security/hibp';
import { encodeMessage, hostManifest, hostManifestLocations } from '../../../core/security/nativemsg';
import { macSettingsPane, tccutilArgs } from '../../../core/security/permissions';
import { protectionFindings } from '../../../core/security/posture';
import { open as unseal, seal } from '../../../core/security/quarantine';
import { BUILTIN_RULES } from '../../../core/security/rules';
import { browserFindings, connectionFindings, malwareFindings, normalizeFindings, permissionFindings, persistenceFindings, reportText, score, scoreLabel, sortFindings, topActions } from '../../../core/security/score';
import { appPrivacy, exposedListeners, parseDisconnect, parseDomainList, trackerIndex, type TrackerIndex } from '../../../core/security/trackers';
import type { BrowserProfile, Detection, Finding, PermissionGrant, PersistenceItem, QuarantineItem, ScanKind, ScanProgress, SecurityEvent, SiteReport } from '../../../core/security/types';
import { getSecret, setSecret } from '../../store';
import { checkProtection } from '../protection';
import { lowerPriority, pace, poll } from '../governor';
import { readBrowsers, readPermissions, readPersistence, readPosture, signerOf } from './collect';

const dir = () => path.join(app.getPath('userData'), 'security');
const file = (n: string) => path.join(dir(), n);
const readFileSyncSafe = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

const DEFAULTS: SecuritySettings = {
  realtime: true, autoQuarantine: true, clamavUpdates: true, hashLookups: false, behaviour: true, persistenceAlerts: true,
  ruleSources: [], trackerLists: [], extensionLists: [], schedule: 'weekly',
};

interface State {
  settings: SecuritySettings;
  ignored: string[];
  knownPersistence: Record<string, PersistenceItem>;
  baselined: boolean;
  scans: ScanProgress[];
  active: Detection[];
  sites: SiteReport[];
  lastFullScan?: number;
  extensionSeen?: number;
}

let state: State = { settings: { ...DEFAULTS }, ignored: [], knownPersistence: {}, baselined: false, scans: [], active: [], sites: [] };
let deps: { broadcast: (ch: string, ...a: unknown[]) => void; alert: (title: string, detail: string) => void; notify?: (title: string, body: string) => void };
let saveTimer: NodeJS.Timeout | undefined;

async function load() {
  await fsp.mkdir(dir(), { recursive: true });
  try {
    const s = JSON.parse(await fsp.readFile(file('state.json'), 'utf8')) as Partial<State>;
    state = { ...state, ...s, settings: { ...DEFAULTS, ...(s.settings ?? {}) } };
  } catch {
    /* first run */
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = `${file('state.json')}.${process.pid}.tmp`;
    void fsp.writeFile(tmp, JSON.stringify(state)).then(() => fsp.rename(tmp, file('state.json'))).catch(() => undefined);
  }, 500);
}

// ---------------------------------------------------------------- timeline

async function event(e: Omit<SecurityEvent, 'id' | 'at'>) {
  const ev: SecurityEvent = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...e };
  await fsp.appendFile(file('events.jsonl'), JSON.stringify(ev) + '\n').catch(() => undefined);
  deps?.broadcast('security-event', ev);
  if (ev.severity === 'high' || ev.severity === 'critical' || ev.kind === 'detection' || ev.kind === 'quarantine') deps?.alert(ev.title, ev.detail ?? '');
  return ev;
}

export async function events(limit = 200): Promise<SecurityEvent[]> {
  const text = await fsp.readFile(file('events.jsonl'), 'utf8').catch(() => '');
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length > 4000) await fsp.writeFile(file('events.jsonl'), lines.slice(-2000).join('\n') + '\n').catch(() => undefined);
  return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l) as SecurityEvent; } catch { return null; } }).filter((x): x is SecurityEvent => !!x);
}

// ---------------------------------------------------------------- worker (built-in engines)

let worker: Worker | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let workerIdle: NodeJS.Timeout | undefined;
let rulesInfo = { rules: 0, skipped: 0 };

async function ask<T>(msg: Record<string, unknown>): Promise<T> {
  if (!worker) {
    worker = new Worker(path.join(__dirname, 'security-worker.cjs'));
    worker.on('message', (m: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.ok) p?.resolve(m.result);
      else p?.reject(new Error(m.error));
    });
    worker.on('error', () => undefined);
    worker.on('exit', () => {
      worker = undefined;
      for (const p of pending.values()) p.reject(new Error('the checker stopped'));
      pending.clear();
    });
    const text = [BUILTIN_RULES, ...(await extraRules())].join('\n');
    const hashes = await extraHashes();
    const id = ++seq;
    const r = await new Promise<{ rules: number; skipped: unknown[] }>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker!.postMessage({ id, type: 'rules', text, hashes });
    });
    rulesInfo = { rules: r.rules, skipped: r.skipped.length };
  }
  clearTimeout(workerIdle);
  // The checker stops after a quiet minute, so idle Keeper holds no rules in memory.
  workerIdle = setTimeout(() => void worker?.terminate(), 60_000);
  workerIdle.unref?.();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ id, ...msg });
  });
}

async function extraRules(): Promise<string[]> {
  const out: string[] = [];
  for (const n of await fsp.readdir(file('rules')).catch(() => [] as string[])) if (/\.(yar|yara)$/i.test(n)) out.push(await fsp.readFile(path.join(file('rules'), n), 'utf8').catch(() => ''));
  return out;
}

async function extraHashes(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const n of await fsp.readdir(file('hashes')).catch(() => [] as string[])) {
    const text = await fsp.readFile(path.join(file('hashes'), n), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      const m = line.match(/\b([a-f0-9]{64})\b(?:[\s,;]+(.+))?/i);
      if (m) out[m[1].toLowerCase()] = (m[2] ?? n).trim().slice(0, 80) || 'Listed malware';
    }
  }
  return out;
}

// ---------------------------------------------------------------- ClamAV and the system's engines

const clamDb = () => file('clamav-db');

async function which(cmd: string): Promise<string | undefined> {
  const r = process.platform === 'win32' ? await run('where.exe', [cmd]) : await run('/usr/bin/env', ['which', cmd]);
  const p = r.stdout.split(/\r?\n/)[0]?.trim();
  if (r.ok && p) return p;
  for (const c of process.platform === 'win32' ? [`C:\\Program Files\\ClamAV\\${cmd}.exe`] : [`/opt/homebrew/bin/${cmd}`, `/usr/local/bin/${cmd}`, `/usr/bin/${cmd}`]) if (existsSync(c)) return c;
  return undefined;
}

async function clam(): Promise<{ clamscan?: string; clamdscan?: string; freshclam?: string; daemon: boolean; version?: ReturnType<typeof parseClamVersion>; db?: string }> {
  const [clamscan, clamdscan, freshclam] = await Promise.all([which('clamscan'), which('clamdscan'), which('freshclam')]);
  const ownDb = existsSync(path.join(clamDb(), 'daily.cvd')) || existsSync(path.join(clamDb(), 'daily.cld'));
  let version: ReturnType<typeof parseClamVersion> | undefined;
  if (clamscan) {
    const v = await run(clamscan, ['--version', ...(ownDb ? [`--database=${clamDb()}`] : [])], 15_000);
    version = parseClamVersion(v.stdout);
  }
  let daemon = false;
  if (clamdscan) daemon = (await run(clamdscan, ['--version'], 5_000)).stdout.includes('/');
  return { clamscan, clamdscan, freshclam, daemon, version, db: ownDb ? clamDb() : undefined };
}

export async function installClamav(): Promise<{ ok: boolean; message: string }> {
  let r: { ok: boolean; stdout: string; stderr: string };
  if (process.platform === 'darwin') {
    const brew = (await which('brew')) ?? (existsSync('/opt/homebrew/bin/brew') ? '/opt/homebrew/bin/brew' : undefined);
    if (!brew) return { ok: false, message: 'Install Homebrew first (brew.sh), or install ClamAV from clamav.net, then check again.' };
    r = await run(brew, ['install', 'clamav'], 900_000);
  } else if (process.platform === 'win32') {
    r = await run('winget.exe', ['install', '--id', 'Cisco.ClamAV', '-e', '--accept-package-agreements', '--accept-source-agreements'], 900_000);
  } else {
    const apt = await which('apt-get');
    const dnf = await which('dnf');
    const pac = await which('pacman');
    const args = apt ? ['apt-get', 'install', '-y', 'clamav'] : dnf ? ['dnf', 'install', '-y', 'clamav', 'clamav-update'] : pac ? ['pacman', '-S', '--noconfirm', 'clamav'] : null;
    if (!args) return { ok: false, message: 'Install the clamav package with your distribution’s package manager, then check again.' };
    r = await run('pkexec', args, 900_000);
  }
  if (!r.ok) return { ok: false, message: (r.stderr || r.stdout).split('\n').filter(Boolean).slice(-2).join(' ') || 'The installation did not finish.' };
  void event({ kind: 'scan', severity: 'info', title: 'ClamAV installed', detail: 'Its signatures are downloaded next.' });
  return updateSignatures();
}

export async function updateSignatures(): Promise<{ ok: boolean; message: string }> {
  const c = await clam();
  if (!c.freshclam) return { ok: false, message: 'freshclam (ClamAV’s updater) is not installed.' };
  await fsp.mkdir(clamDb(), { recursive: true });
  const conf = file('freshclam.conf');
  await fsp.writeFile(conf, freshclamConfig(clamDb(), os.userInfo().username));
  const r = await run(c.freshclam, freshclamArgs(clamDb(), conf), 600_000);
  const ok = r.ok || /up.to.date|updated/i.test(r.stdout + r.stderr);
  if (ok) void event({ kind: 'scan', severity: 'info', title: 'Malware signatures updated' });
  return { ok, message: ok ? 'Signatures are up to date.' : (r.stderr || r.stdout).split('\n').filter(Boolean).slice(-1)[0] ?? 'The update failed.' };
}

async function defenderCheck(files: string[]): Promise<Detection[]> {
  if (process.platform !== 'win32' || !files.length) return [];
  const exe = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe');
  if (!existsSync(exe)) return [];
  const out: Detection[] = [];
  for (const f of files.slice(0, 50)) {
    const r = await run(exe, ['-Scan', '-ScanType', '3', '-File', f, '-DisableRemediation'], 120_000);
    const name = (r.stdout.match(/Threat\s*:\s*(.+)/) ?? [])[1]?.trim();
    if (name || /found \d+ threats?/i.test(r.stdout)) out.push({ path: f, engine: 'defender', name: name ?? 'Defender detection', severity: 'high', confidence: 'certain', why: 'Microsoft Defender recognises this file as malware.' });
  }
  return out;
}

export async function engines(): Promise<EngineStatus[]> {
  const c = await clam();
  const list: EngineStatus[] = [
    { id: 'builtin', name: 'Keeper’s built-in checks', state: 'on', detail: 'Disguised programs, risky macros and scripts, the EICAR test file' },
    { id: 'yara', name: 'YARA rules', state: 'on', detail: `${rulesInfo.rules || 5} rules${rulesInfo.skipped ? `, ${rulesInfo.skipped} skipped (unsupported features)` : ''}` },
    c.clamscan
      ? { id: 'clamav', name: 'ClamAV signatures', state: 'on', detail: `${c.version?.engine ? `ClamAV ${c.version.engine}` : 'ClamAV'}${c.version?.signatures ? ` · signatures ${c.version.signatures}` : ''}${c.daemon ? ' · fast scanning (daemon)' : ''}`, updated: c.version?.date }
      : { id: 'clamav', name: 'ClamAV signatures', state: 'missing', detail: 'Not installed. Adds millions of known-malware signatures.' },
    { id: 'reputation', name: 'Fingerprint lookups', state: state.settings.hashLookups ? 'on' : 'off', detail: 'MalwareBazaar (abuse.ch): only the file’s SHA-256 is sent' },
  ];
  if (process.platform === 'win32') {
    const p = await checkProtection().catch(() => undefined);
    const d = p?.checks.find((x) => x.id === 'defender');
    list.push({ id: 'defender', name: 'Microsoft Defender', state: d?.status === 'ok' ? 'on' : d?.status === 'off' ? 'off' : 'unavailable', detail: 'Also checks files Keeper finds suspicious' });
  }
  if (process.platform === 'darwin') {
    const p = await checkProtection().catch(() => undefined);
    const x = p?.checks.find((c2) => c2.id === 'xprotect');
    list.push({ id: 'xprotect', name: 'XProtect (macOS)', state: x?.status === 'ok' ? 'on' : x?.status === 'warn' ? 'on' : 'unavailable', detail: x?.detail ?? 'Built into macOS; blocks known malware when apps open' });
  }
  return list;
}

// ---------------------------------------------------------------- reputation (opt-in)

async function reputation(sha: string): Promise<Detection | undefined> {
  if (!state.settings.hashLookups) return undefined;
  const key = await getSecret('security.abusechKey');
  try {
    const res = await net.fetch('https://mb-api.abuse.ch/api/v1/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(key ? { 'Auth-Key': key } : {}) }, body: `query=get_info&hash=${sha}` });
    const o = (await res.json()) as { query_status?: string; data?: { signature?: string; file_name?: string }[] };
    if (o.query_status === 'ok' && o.data?.length) return { path: '', engine: 'reputation', name: o.data[0].signature ?? 'Known malware', severity: 'high', confidence: 'certain', sha256: sha, why: 'MalwareBazaar lists this exact file as malware.' };
  } catch {
    /* offline or no key: the local engines still ran */
  }
  return undefined;
}

// ---------------------------------------------------------------- scanning

const running = new Map<string, AbortController>();

function where(p: string): 'downloads' | 'temp' | 'desktop' | 'documents' | 'apps' | 'other' {
  const h = os.homedir();
  if (p.startsWith(path.join(h, 'Downloads'))) return 'downloads';
  if (p.startsWith(path.join(h, 'Desktop'))) return 'desktop';
  if (p.startsWith(path.join(h, 'Documents'))) return 'documents';
  if (p.startsWith(os.tmpdir()) || /[\\/](tmp|Temp)[\\/]/.test(p)) return 'temp';
  if (/^\/Applications|^C:\\Program Files|^\/usr\/|^\/opt\//i.test(p)) return 'apps';
  return 'other';
}

function quickPaths(): string[] {
  const h = os.homedir();
  const list = ['Downloads', 'Desktop', 'Documents'].map((d) => path.join(h, d));
  if (process.platform === 'darwin') list.push(path.join(h, 'Library/LaunchAgents'), '/Library/LaunchAgents', '/Library/LaunchDaemons', path.join(h, 'Library/Application Support'));
  else if (process.platform === 'win32') list.push(path.join(h, 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup'), os.tmpdir());
  else list.push(path.join(h, '.config/autostart'), path.join(h, '.config/systemd/user'), path.join(h, '.local/bin'), '/tmp');
  return list.filter((p) => existsSync(p));
}

async function* walk(root: string, signal: AbortSignal, depth = 0): AsyncGenerator<string> {
  if (signal.aborted || depth > 24) return;
  const st = await fsp.lstat(root).catch(() => undefined);
  if (!st) return;
  if (st.isFile()) {
    yield root;
    return;
  }
  if (!st.isDirectory()) return;
  if (/[\\/](node_modules|\.git|Library[\\/]Caches|\.cache|proc|sys|dev)$/.test(root) && depth > 0) return;
  for (const name of await fsp.readdir(root).catch(() => [] as string[])) {
    if (signal.aborted) return;
    yield* walk(path.join(root, name), signal, depth + 1);
  }
}

export async function scan(kind: ScanKind, paths?: string[]): Promise<ScanProgress> {
  const id = `${kind}-${Date.now().toString(36)}`;
  const roots = kind === 'quick' ? quickPaths() : kind === 'full' ? [os.homedir(), ...(process.platform === 'darwin' ? ['/Applications'] : process.platform === 'win32' ? [] : ['/opt', '/usr/local'])].filter(existsSync) : (paths ?? []).filter(existsSync);
  const p: ScanProgress = { id, kind, state: 'running', started: Date.now(), files: 0, bytes: 0, detections: [], engines: ['heuristic', 'yara', 'hash', 'signature'] };
  const ac = new AbortController();
  running.set(id, ac);
  state.scans = [p, ...state.scans.filter((s) => s.state !== 'running')].slice(0, 30);
  deps?.broadcast('security-scan', p);
  void (async () => {
    try {
      const c = await clam();
      if (c.clamscan) p.engines.push('clamav');
      let lastSend = 0;
      for (const root of roots) {
        for await (const f of walk(root, ac.signal)) {
          if (ac.signal.aborted) break;
          // Full scans look inside every file; quick and custom scans read risky kinds and small files.
          const st = await fsp.stat(f).catch(() => undefined);
          if (!st) continue;
          const head = await readHead(f);
          if (kind !== 'full' && !RISKY.has(sniff(head, f)) && st.size > 2_000_000) continue;
          const r = await ask<{ detections: Detection[]; size: number; sha256?: string }>({ type: 'check', file: f, location: where(f) }).catch(() => ({ detections: [] as Detection[], size: 0, sha256: undefined }));
          p.files++;
          p.bytes += r.size;
          p.current = f;
          if (r.sha256 && !r.detections.length && RISKY.has(sniff(head, f))) {
            const rep = await reputation(r.sha256);
            if (rep) r.detections.push({ ...rep, path: f });
          }
          for (const d of r.detections) await found(d, p);
          if (Date.now() - lastSend > 400) {
            lastSend = Date.now();
            deps?.broadcast('security-scan', { ...p });
          }
          if (p.files % 50 === 0) await pace('scan', ac.signal).catch(() => undefined);
        }
      }
      // ClamAV reads everything in one go (archives included), at low priority.
      if (c.clamscan && !ac.signal.aborted && roots.length) {
        p.message = 'Checking with ClamAV signatures…';
        deps?.broadcast('security-scan', { ...p });
        const args = c.daemon && c.clamdscan ? clamscanArgs(roots, { daemon: true }) : clamscanArgs(roots, { database: c.db, archives: true });
        const out = await runLow(c.daemon && c.clamdscan ? c.clamdscan : c.clamscan, args, ac.signal);
        for (const d of parseClamOutput(out)) await found({ ...d, confidence: d.confidence, sha256: undefined } as Detection, p);
      }
      if (process.platform === 'win32' && !ac.signal.aborted) for (const d of await defenderCheck(p.detections.map((x) => x.path))) await found(d, p);
      p.state = ac.signal.aborted ? 'stopped' : 'done';
    } catch (e) {
      p.state = 'failed';
      p.message = e instanceof Error ? e.message : String(e);
    } finally {
      p.ended = Date.now();
      p.current = undefined;
      running.delete(id);
      if (kind === 'full' && p.state === 'done') state.lastFullScan = p.ended;
      save();
      deps?.broadcast('security-scan', { ...p });
      void event({ kind: 'scan', severity: p.detections.length ? 'high' : 'info', title: `${kind === 'quick' ? 'Quick' : kind === 'full' ? 'Full' : 'Custom'} scan ${p.state === 'stopped' ? 'stopped' : 'finished'}: ${p.detections.length ? `${p.detections.length} found` : 'nothing found'}`, detail: `${p.files.toLocaleString()} files checked` });
    }
  })();
  return p;
}

async function readHead(f: string): Promise<Buffer> {
  try {
    const fh = await fsp.open(f, 'r');
    const b = Buffer.alloc(16);
    await fh.read(b, 0, 16, 0);
    await fh.close();
    return b;
  } catch {
    return Buffer.alloc(0);
  }
}

function runLow(cmd: string, args: string[], signal: AbortSignal): Promise<string> {
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  return new Promise((resolve) => {
    const ch = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    lowerPriority(ch);
    let out = '';
    ch.stdout.setEncoding('utf8');
    ch.stdout.on('data', (d: string) => (out += d));
    const stop = () => ch.kill();
    signal.addEventListener('abort', stop, { once: true });
    ch.on('close', () => resolve(out));
    ch.on('error', () => resolve(out));
  });
}

async function found(d: Detection, p?: ScanProgress) {
  if (p && !p.detections.some((x) => x.path === d.path && x.name === d.name)) p.detections.push(d);
  if (!state.active.some((x) => x.path === d.path && x.name === d.name)) state.active.push(d);
  save();
  await event({ kind: 'detection', severity: d.severity, title: `${d.name} found in ${path.basename(d.path)}`, detail: d.why, path: d.path });
  if (state.settings.autoQuarantine && autoQuarantine(d) && existsSync(d.path)) await quarantineFile(d.path).catch(() => undefined);
}

export function stopScan(id: string) {
  running.get(id)?.abort();
}

export function scans(): ScanProgress[] {
  return state.scans;
}

// ---------------------------------------------------------------- quarantine

async function qKey(): Promise<Buffer> {
  const s = await getSecret('security.quarantineKey');
  if (s) return Buffer.from(s, 'base64');
  // Without a keychain, the key lives in a file only this user can read (weaker, said in the docs).
  const kf = file('quarantine.key');
  try {
    return Buffer.from(await fsp.readFile(kf, 'utf8'), 'base64');
  } catch {
    const { randomBytes } = await import('node:crypto');
    const k = randomBytes(32);
    if (!(await setSecret('security.quarantineKey', k.toString('base64')))) await fsp.writeFile(kf, k.toString('base64'), { mode: 0o600 });
    return k;
  }
}

async function qIndex(): Promise<QuarantineItem[]> {
  try {
    return JSON.parse(await fsp.readFile(file('quarantine/index.json'), 'utf8'));
  } catch {
    return [];
  }
}

async function qSave(items: QuarantineItem[]) {
  await fsp.mkdir(file('quarantine'), { recursive: true });
  await fsp.writeFile(file('quarantine/index.json'), JSON.stringify(items, null, 1));
}

export async function quarantine(): Promise<QuarantineItem[]> {
  return qIndex();
}

export async function quarantineFile(p: string): Promise<QuarantineItem> {
  const st = await fsp.stat(p);
  if (!st.isFile()) throw new Error('Only files can be quarantined');
  const data = await fsp.readFile(p);
  const { sha256 } = await import('../../../core/security/quarantine');
  const sha = sha256(data);
  const id = `${Date.now().toString(36)}-${sha.slice(0, 8)}`;
  await fsp.mkdir(file('quarantine'), { recursive: true });
  await fsp.writeFile(file(`quarantine/${id}.kq`), seal(data, await qKey()), { mode: 0o600 });
  // Only once the sealed copy is safely written is the original removed.
  await fsp.rm(p, { force: true });
  const dets = state.active.filter((d) => d.path === p);
  const item: QuarantineItem = { id, originalPath: p, name: path.basename(p), size: st.size, sha256: sha, detections: dets.map((d) => ({ engine: d.engine, name: d.name, severity: d.severity, confidence: d.confidence })), at: Date.now(), mode: st.mode & 0o777 };
  await qSave([item, ...(await qIndex())]);
  state.active = state.active.filter((d) => d.path !== p);
  save();
  await event({ kind: 'quarantine', severity: 'medium', title: `${item.name} was moved to quarantine`, detail: 'It is encrypted and cannot run. You can put it back or delete it.', path: p });
  return item;
}

export async function restore(id: string, to?: string): Promise<{ path: string }> {
  const items = await qIndex();
  const it = items.find((x) => x.id === id);
  if (!it) throw new Error('Not in quarantine');
  const data = unseal(await fsp.readFile(file(`quarantine/${id}.kq`)), await qKey());
  let dest = to ?? it.originalPath;
  if (existsSync(dest)) dest = dest.replace(/(\.[^./\\]+)?$/, ' (restored)$1');
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, data, { mode: it.mode ?? 0o644 });
  await fsp.rm(file(`quarantine/${id}.kq`), { force: true });
  await qSave(items.filter((x) => x.id !== id));
  await event({ kind: 'restore', severity: 'low', title: `${it.name} was put back`, detail: dest, path: dest });
  return { path: dest };
}

export async function deleteQuarantined(id: string) {
  const items = await qIndex();
  const it = items.find((x) => x.id === id);
  await fsp.rm(file(`quarantine/${id}.kq`), { force: true });
  await qSave(items.filter((x) => x.id !== id));
  if (it) await event({ kind: 'quarantine', severity: 'info', title: `${it.name} was deleted from quarantine` });
}

// ---------------------------------------------------------------- real-time protection

const watchers: FSWatcher[] = [];
const due = new Map<string, NodeJS.Timeout>();

function realtimeFolders(): { dir: string; recursive: boolean }[] {
  const h = os.homedir();
  const linux = process.platform === 'linux';
  return [
    { dir: path.join(h, 'Downloads'), recursive: !linux },
    { dir: path.join(h, 'Desktop'), recursive: false },
    { dir: path.join(h, 'Documents'), recursive: false },
  ].filter((x) => existsSync(x.dir));
}

const PARTIAL = /\.(crdownload|part|partial|download|tmp|opdownload)$/i;

function onFileEvent(full: string) {
  if (PARTIAL.test(full) || path.basename(full).startsWith('.')) return;
  clearTimeout(due.get(full));
  due.set(full, setTimeout(() => {
    due.delete(full);
    void (async () => {
      // Wait until the file stops growing (a download still being written).
      const a = await fsp.stat(full).catch(() => undefined);
      if (!a?.isFile()) return;
      await new Promise((r) => setTimeout(r, 700));
      const b = await fsp.stat(full).catch(() => undefined);
      if (!b || b.size !== a.size) return onFileEvent(full);
      const r = await ask<{ detections: Detection[]; sha256?: string }>({ type: 'check', file: full, location: where(full) }).catch(() => ({ detections: [] as Detection[], sha256: undefined }));
      const c = await clam();
      if (c.daemon && c.clamdscan) for (const d of parseClamOutput(await runLow(c.clamdscan, clamscanArgs([full], { daemon: true }), new AbortController().signal))) r.detections.push(d as Detection);
      if (!r.detections.length && r.sha256) {
        const rep = await reputation(r.sha256);
        if (rep) r.detections.push({ ...rep, path: full });
      }
      if (process.platform === 'win32' && r.detections.some((d) => d.confidence !== 'certain')) r.detections.push(...(await defenderCheck([full])));
      for (const d of r.detections) await found(d);
    })();
  }, 1200));
}

function startRealtime() {
  stopRealtime();
  for (const f of realtimeFolders()) {
    try {
      watchers.push(watch(f.dir, { recursive: f.recursive, persistent: false }, (_e, name) => name && onFileEvent(path.join(f.dir, String(name)))));
    } catch {
      /* a folder that cannot be watched is scanned on schedule instead */
    }
  }
}

function stopRealtime() {
  for (const w of watchers.splice(0)) w.close();
}

// ---------------------------------------------------------------- persistence & behaviour

let persistWatchers: FSWatcher[] = [];
let persistDue: NodeJS.Timeout | undefined;

export async function checkPersistence(alert = true): Promise<PersistenceItem[]> {
  const now = Date.now();
  const items = await readPersistence();
  const fresh: PersistenceItem[] = [];
  for (const i of items) {
    if (state.knownPersistence[i.id]) continue;
    const exe = i.command?.match(/^"([^"]+)"|^(\S+)/)?.slice(1).find(Boolean);
    const sig = exe ? await signerOf(exe).catch(() => undefined) : undefined;
    const full: PersistenceItem = { ...i, firstSeen: now, signed: sig?.signed, signer: sig?.signer };
    state.knownPersistence[i.id] = full;
    fresh.push(full);
  }
  for (const id of Object.keys(state.knownPersistence)) if (!items.some((i) => i.id === id)) delete state.knownPersistence[id];
  if (!state.baselined) state.baselined = true;
  else if (alert && state.settings.persistenceAlerts) for (const f of fresh) await event({ kind: 'persistence', severity: f.signed === false ? 'high' : 'medium', title: `New item set to start automatically: ${f.name}`, detail: [f.command, f.location].filter(Boolean).join(' · '), path: f.location });
  save();
  return Object.values(state.knownPersistence);
}

export async function persistence(): Promise<PersistenceItem[]> {
  return Object.values(state.knownPersistence).sort((a, b) => b.firstSeen - a.firstSeen);
}

function watchPersistence() {
  for (const w of persistWatchers.splice(0)) w.close();
  const { persistenceLocations } = require('../../../core/security/heuristics') as typeof import('../../../core/security/heuristics');
  for (const loc of persistenceLocations(process.platform, os.homedir())) {
    if (!existsSync(loc.dir)) continue;
    try {
      persistWatchers.push(watch(loc.dir, { persistent: false }, () => {
        clearTimeout(persistDue);
        persistDue = setTimeout(() => void checkPersistence(), 1500);
      }));
    } catch {
      /* polled instead */
    }
  }
}

async function checkBehaviour() {
  if (!state.settings.behaviour) return;
  try {
    const { sample } = await import('../procs');
    const s = await sample();
    for (const pr of s.procs) {
      const why = suspiciousProcess(pr);
      if (why) await event({ kind: 'detection', severity: 'high', title: `${pr.name} ${why}`, detail: `Process ${pr.pid}${pr.path ? ` · ${pr.path}` : ''}. Stop it from Health → Processes if you do not know it.` });
    }
  } catch {
    /* the process list is unavailable here */
  }
}

// ---------------------------------------------------------------- overview

let cache: { at: number; perms?: PermissionGrant[]; permNotes?: string[]; browsers?: BrowserProfile[]; posture?: Finding[] } = { at: 0 };

async function trackers(): Promise<TrackerIndex> {
  let extra = {};
  for (const n of await fsp.readdir(file('trackers')).catch(() => [] as string[])) {
    const text = await fsp.readFile(path.join(file('trackers'), n), 'utf8').catch(() => '');
    extra = { ...extra, ...(n.endsWith('.json') ? parseDisconnect(text) : parseDomainList(text, 'advertising', n.replace(/\.\w+$/, ''))) };
  }
  return trackerIndex(extra);
}

async function knownBadExtensions(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fsp.readFile(file('known-bad-extensions.json'), 'utf8'));
  } catch {
    return {};
  }
}

export async function connections(): Promise<ConnectionsView> {
  const idx = await trackers();
  let flows: Parameters<typeof appPrivacy>[0] = [];
  try {
    const net2 = await import('../net');
    const s = await net2.sample();
    flows = s.flows.map((f) => ({ app: f.app, remote: f.remote, remotePort: f.remotePort, host: f.host, country: f.country, scope: f.scope, bytesIn: f.bytesIn, bytesOut: f.bytesOut, state: f.state, localPort: f.localPort, local: f.local } as never));
  } catch {
    /* Network Activity is off or unavailable */
  }
  return { apps: appPrivacy(flows, idx), listeners: exposedListeners(flows as never), sites: state.sites.slice(0, 200), extensionConnected: !!state.extensionSeen && Date.now() - state.extensionSeen < 7 * 86_400_000 };
}

export async function overview(refresh = false): Promise<SecurityOverview> {
  if (refresh || Date.now() - cache.at > 5 * 60_000) {
    const [perms, browsers, posture, prot] = await Promise.all([readPermissions().catch(() => ({ grants: [], notes: [] })), readBrowsers(await knownBadExtensions()).catch(() => []), readPosture().catch(() => []), checkProtection().catch(() => undefined)]);
    cache = { at: Date.now(), perms: perms.grants, permNotes: perms.notes, browsers, posture: [...(prot ? protectionFindings(prot.checks) : []), ...posture] };
  }
  const conn = await connections();
  const c = await clam();
  const signatureAgeDays = c.version?.date ? Math.round((Date.now() - c.version.date) / 86_400_000) : undefined;
  const persisted = await persistence();
  const recent = persisted.filter((p) => Date.now() - p.firstSeen < 7 * 86_400_000 && state.baselined);
  let findings: Finding[] = [
    ...(cache.posture ?? []),
    ...permissionFindings(cache.perms ?? []),
    ...browserFindings(cache.browsers ?? []),
    ...connectionFindings(conn.apps, conn.listeners),
    ...malwareFindings({ active: state.active.filter((d) => existsSync(d.path)), realtime: state.settings.realtime, engines: { clamav: { installed: !!c.clamscan, signatureAgeDays } }, lastFullScan: state.lastFullScan }),
    ...persistenceFindings(recent, new Set()),
  ];
  findings = normalizeFindings(findings).map((f) => ({ ...f, ignored: state.ignored.includes(f.id) }));
  const counts = { permissions: 0, connections: 0, browsers: 0, posture: 0, malware: 0, persistence: 0 } as SecurityOverview['counts'];
  for (const f of findings) if (!f.ignored && f.severity !== 'info') counts[f.area]++;
  const s = score(findings);
  const last = state.scans.find((x) => x.state === 'done');
  return {
    score: s, label: scoreLabel(s), findings: sortFindings(findings), top: topActions(findings), counts, engines: await engines(),
    quarantined: (await qIndex()).length,
    lastScan: last ? { kind: last.kind, at: last.ended ?? last.started, files: last.files, found: last.detections.length } : undefined,
    notes: cache.permNotes ?? [], checkedAt: cache.at,
  };
}

export async function permissions() {
  const r = await readPermissions();
  cache.perms = r.grants;
  cache.permNotes = r.notes;
  return { ...r, platform: process.platform };
}

export async function browsers(): Promise<BrowserProfile[]> {
  return (cache.browsers = await readBrowsers(await knownBadExtensions()));
}

export async function revoke(g: PermissionGrant): Promise<{ ok: boolean; message: string }> {
  if (process.platform === 'darwin') {
    const args = /^[A-Za-z0-9.-]+$/.test(g.app) ? tccutilArgs(g.raw, g.app) : null;
    if (args) {
      const r = await run('/usr/bin/tccutil', args, 10_000);
      if (r.ok) {
        void event({ kind: 'permission', severity: 'info', title: `${g.app} no longer has ${g.service} access`, detail: 'It will ask again next time it needs it.' });
        return { ok: true, message: `${g.app} will have to ask again.` };
      }
    }
    await shell.openExternal(macSettingsPane(g.service));
    return { ok: false, message: 'Turn it off in the System Settings pane that just opened.' };
  }
  if (process.platform === 'win32') {
    const page: Record<string, string> = { camera: 'ms-settings:privacy-webcam', microphone: 'ms-settings:privacy-microphone', location: 'ms-settings:privacy-location', contacts: 'ms-settings:privacy-contacts', calendars: 'ms-settings:privacy-calendar', files: 'ms-settings:privacy-broadfilesystemaccess', photos: 'ms-settings:privacy-pictures', screen: 'ms-settings:privacy-graphicsCaptureProgrammatic' };
    await shell.openExternal(page[g.service] ?? 'ms-settings:privacy');
    return { ok: false, message: 'Turn it off in the Settings page that just opened.' };
  }
  if (g.source === 'flatpak' && /^[\w.-]+$/.test(g.app)) {
    const [table, object] = g.raw.split('/');
    const r = table && object && !g.raw.includes('=') ? await run('flatpak', ['permission-set', table, object, g.app, 'no'], 10_000) : await run('flatpak', ['override', '--user', g.raw.startsWith('devices') ? '--nodevice=all' : g.raw.startsWith('filesystems') ? '--nofilesystem=home' : '--nosocket=pulseaudio', g.app], 10_000);
    if (r.ok) {
      void event({ kind: 'permission', severity: 'info', title: `${g.app} no longer has ${g.service} access` });
      return { ok: true, message: 'Done. Restart the app for it to take effect.' };
    }
    return { ok: false, message: r.stderr.trim() || 'Flatpak refused the change.' };
  }
  return { ok: false, message: 'This system has no per-app switch for that; remove the app or run it sandboxed (Flatpak).' };
}

export async function fix(id: string): Promise<{ ok: boolean; message: string }> {
  const o = await overview();
  const f = o.findings.find((x) => x.id === id);
  if (!f?.fix) return { ok: false, message: 'Nothing to do automatically.' };
  if (f.fix.settings) {
    await shell.openExternal(f.fix.settings);
    return { ok: true, message: 'Opened the right settings page.' };
  }
  switch (f.fix.action) {
    case 'realtime-on': await setSettings({ realtime: true }); return { ok: true, message: 'Real-time protection is on.' };
    case 'install-clamav': return installClamav();
    case 'update-signatures': return updateSignatures();
    case 'scan': await scan((f.fix.arg as ScanKind) ?? 'quick'); return { ok: true, message: 'Scan started.' };
    case 'quarantine': await quarantineFile(String(f.fix.arg)); return { ok: true, message: 'Moved to quarantine.' };
    case 'run': {
      if (process.platform !== 'linux' || !f.fix.arg) break;
      const [cmd, ...args] = f.fix.arg.split(' ');
      const r = await run(cmd, args, 120_000);
      return { ok: r.ok, message: r.ok ? 'Done.' : r.stderr.trim() || 'It did not work.' };
    }
  }
  return { ok: false, message: 'Follow the steps shown to fix this.' };
}

export async function ignore(id: string, ignored: boolean) {
  state.ignored = ignored ? [...new Set([...state.ignored, id])] : state.ignored.filter((x) => x !== id);
  save();
}

export function settings(): SecuritySettings {
  return state.settings;
}

export async function setSettings(patch: Partial<SecuritySettings>): Promise<SecuritySettings> {
  const prev = state.settings;
  state.settings = { ...state.settings, ...patch };
  save();
  if (prev.realtime !== state.settings.realtime) {
    if (state.settings.realtime) startRealtime();
    else stopRealtime();
  }
  if (patch.ruleSources || patch.trackerLists || patch.extensionLists) await refreshLists().catch(() => undefined);
  return state.settings;
}

/** Downloads the rule sets, hash lists and tracker lists the person added. */
async function refreshLists() {
  const get = async (u: string) => (/^https?:\/\//.test(u) ? (await net.fetch(u)).text() : fsp.readFile(u, 'utf8'));
  const store = async (sub: string, name: string, text: string) => {
    await fsp.mkdir(file(sub), { recursive: true });
    await fsp.writeFile(file(`${sub}/${name}`), text);
  };
  for (const [i, u] of state.settings.ruleSources.entries()) {
    const text = await get(u).catch(() => '');
    if (/\brule\s+\w+/.test(text)) await store('rules', `source-${i}.yar`, text);
    else if (/\b[a-f0-9]{64}\b/i.test(text)) await store('hashes', `source-${i}.txt`, text);
  }
  for (const [i, u] of state.settings.trackerLists.entries()) {
    const text = await get(u).catch(() => '');
    if (text) await store('trackers', `list-${i}${text.trim().startsWith('{') ? '.json' : '.txt'}`, text);
  }
  let bad: Record<string, string> = {};
  for (const u of state.settings.extensionLists) {
    try {
      bad = { ...bad, ...JSON.parse(await get(u)) };
    } catch {
      /* not JSON */
    }
  }
  await fsp.writeFile(file('known-bad-extensions.json'), JSON.stringify(bad));
  void worker?.terminate();
}

export async function checkPassword(password: string): Promise<{ count: number }> {
  const { prefix, suffix } = passwordPrefix(password);
  const res = await net.fetch(RANGE_URL + prefix, { headers: { 'Add-Padding': 'true', 'user-agent': 'Keeper by Ashforde' } });
  if (!res.ok) throw new Error(`The breach database answered ${res.status}`);
  return { count: countInRange(await res.text(), suffix) };
}

export async function exportReport(): Promise<string | null> {
  const o = await overview();
  const r = await dialog.showSaveDialog({ defaultPath: path.join(os.homedir(), 'Desktop', `Keeper security report ${new Date().toISOString().slice(0, 10)}.txt`) });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, reportText({ score: o.score, findings: o.findings, at: Date.now(), host: os.hostname() }));
  return r.filePath;
}

// ---------------------------------------------------------------- browser extension

/** A page report from Keeper's browser extension (through the native messaging host). */
export function siteReport(r: SiteReport) {
  if (!r || typeof r.site !== 'string' || !Array.isArray(r.thirdParties)) return;
  state.extensionSeen = Date.now();
  state.sites = [{ ...r, thirdParties: r.thirdParties.slice(0, 200), at: Date.now() }, ...state.sites.filter((s) => s.site !== r.site)].slice(0, 300);
  save();
}

async function writeIfChanged(f: string, text: string, mode?: number): Promise<boolean> {
  try {
    if ((await fsp.readFile(f, 'utf8')) === text) return false;
  } catch {
    /* not there yet */
  }
  await fsp.writeFile(f, text, mode ? { mode } : undefined);
  return true;
}

/**
 * Registers Keeper with every browser found here (native messaging), and
 * refreshes the easy-to-pick copy of the extension. Safe to run again and
 * again: unchanged files are left alone. `also` names registration places of
 * browsers that are installed but have never made their own folder.
 */
export async function installBrowserHost(also: string[] = [], force = false): Promise<{ installed: string[]; extensionFolder: string }> {
  const cli = path.join(app.getAppPath(), 'dist-cli', 'keeper.cjs').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  const exe = process.execPath;
  const launcher = process.platform === 'win32' ? file('native-host.cmd') : file('native-host.sh');
  await fsp.mkdir(dir(), { recursive: true });
  await writeIfChanged(launcher, process.platform === 'win32' ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${cli}" browser-host\r\n` : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe}" "${cli}" browser-host\n`, 0o755);
  const installed: string[] = [];
  // Windows registry keys already pointing at the right file (so reg.exe is not run every time).
  const regDone = file('native-host-registered.json');
  let registered: Record<string, string> = {};
  try { registered = JSON.parse(await fsp.readFile(regDone, 'utf8')); } catch { /* none yet */ }
  for (const loc of hostManifestLocations(process.platform, os.homedir())) {
    const manifest = JSON.stringify(hostManifest(launcher, loc.engine, []), null, 2);
    try {
      if (loc.dir) {
        if (!existsSync(path.dirname(loc.dir)) && !also.includes(loc.browser)) continue;
        await fsp.mkdir(loc.dir, { recursive: true });
        await writeIfChanged(path.join(loc.dir, 'org.ashforde.keeper.json'), manifest);
      } else if (loc.regKey) {
        const mf = file(`native-host-${loc.engine}.json`);
        await writeIfChanged(mf, manifest);
        if (force || registered[loc.regKey] !== mf) {
          const r = await run('reg.exe', ['add', loc.regKey, '/ve', '/t', 'REG_SZ', '/d', mf, '/f']);
          if (!r.ok) continue;
          registered[loc.regKey] = mf;
        }
      }
      installed.push(loc.browser);
    } catch {
      /* that browser is skipped */
    }
  }
  if (process.platform === 'win32') await fsp.writeFile(regDone, JSON.stringify(registered)).catch(() => undefined);
  const { prepareExtensionCopies, bundledExtensionFolder } = await import('../browser-extension-copy');
  const copies = await prepareExtensionCopies().catch(() => null);
  return { installed, extensionFolder: copies?.chromium ?? bundledExtensionFolder() };
}

/** Is Keeper registered at this place (a folder or, on Windows, a registry key it set)? */
export function browserHostRegistered(loc: { dir?: string; regKey?: string }): boolean {
  if (loc.dir) return existsSync(path.join(loc.dir, 'org.ashforde.keeper.json'));
  if (!loc.regKey) return false;
  try {
    return !!JSON.parse(readFileSyncSafe(file('native-host-registered.json')) || '{}')[loc.regKey];
  } catch {
    return false;
  }
}

/** Exported for the CLI's browser-host bridge tests. */
export const _frame = encodeMessage;

// ---------------------------------------------------------------- start / stop

export async function startSecurity(d: typeof deps) {
  deps = d;
  await load();
  if (state.settings.realtime) startRealtime();
  watchPersistence();
  // The first look records what is already there; later looks report what is new.
  poll('security.persistence', { baseMs: 30 * 60_000, idleFactor: 2 }, () => checkPersistence(), { now: true, feature: 'security' });
  poll('security.behaviour', { baseMs: 10 * 60_000, idleFactor: 3 }, () => checkBehaviour(), { now: false, feature: 'security' });
  poll('security.signatures', { baseMs: 12 * 3600_000, idleFactor: 1 }, async () => { if (state.settings.clamavUpdates && (await clam()).freshclam) await updateSignatures(); }, { now: false, feature: 'security' });
  poll('security.schedule', { baseMs: 6 * 3600_000, idleFactor: 1 }, async () => {
    const every = state.settings.schedule === 'daily' ? 86_400_000 : state.settings.schedule === 'weekly' ? 7 * 86_400_000 : 0;
    const last = state.scans.find((s) => s.kind === 'quick' || s.kind === 'full');
    if (every && (!last || Date.now() - last.started > every)) await scan('quick');
  }, { now: false, feature: 'security' });
}

export function stopSecurity() {
  stopRealtime();
  for (const w of persistWatchers.splice(0)) w.close();
  for (const a of running.values()) a.abort();
  void worker?.terminate();
}
