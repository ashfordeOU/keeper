// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Anonymous usage stats (Settings → Privacy). At most once a day, when the
// computer is idle and online, Keeper sends one small report built by
// core/telemetry.ts → buildPayload. Days that could not be sent wait, at most
// a week. Off by the switch, KEEPER_TELEMETRY=0, DO_NOT_TRACK=1 or the policy
// file; while off nothing is collected and nothing is sent, not even a goodbye.
//
// No timers of its own: one regular check through the governor (poll), which
// pauses while the feature is off, and the sending waits with whenIdle.

import { app, BrowserWindow, net, screen } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, promises as fsp, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FEATURES } from '../../core/features';
import { detectInstallSource } from '../../core/install-source';
import { run } from '../../core/platform';
import {
  buildPayload, enqueue, isInstallId, macHasBattery, OFF_REASON_TEXT, offReason, parsePolicy, policyPath, TELEMETRY_ENDPOINT, utcDay, uuidFromBytes,
  validateBody, type ManagedPolicy, type PingBody, type TelemetryInputs, type UsagePayload, type UsageStatsStatus,
} from '../../core/telemetry';
import { featureOn, listFeatures, onFeature, setExternalOff, setFeature } from './features';
import { poll, pollNow, usage, whenIdle } from './governor';
import { placeEnv } from './island-place';

declare const __KEEPER_OFFICIAL__: boolean | undefined;
/** Set by scripts/build-main.mjs from KEEPER_OFFICIAL_BUILD=1 in the release workflow. */
export const OFFICIAL = typeof __KEEPER_OFFICIAL__ === 'boolean' ? __KEEPER_OFFICIAL__ : false;
const FEATURE = 'usageStats';

// Test hooks, never in an official build: another address, a shorter interval, another policy file.
const testable = !OFFICIAL;
const ENDPOINT = (testable && process.env.KEEPER_TELEMETRY_URL) || TELEMETRY_ENDPOINT;
const INTERVAL = (testable && Number(process.env.KEEPER_TELEMETRY_INTERVAL_MS)) || 0;
const POLICY_FILE = (testable && process.env.KEEPER_POLICY_FILE) || policyPath(process.platform, process.env);
// Test runs on CI machines report nothing unless a test points Keeper at its own stand-in server.
const CI_QUIET = !!process.env.CI && !(testable && process.env.KEEPER_TELEMETRY_URL);

interface Stored {
  installId: string;
  activeDays: string[];
  /** day → page → opens */
  pages: Record<string, Record<string, number>>;
  /** day → counters */
  health: Record<string, { crashes: number; restarts: number; memSum: number; cpuSum: number; samples: number }>;
  startupMs?: number;
  queue: UsagePayload[];
  /** the day the last report was made for (one per day) */
  madeFor?: string;
  last?: { at: number; body: PingBody };
  lastAttempt?: { at: number; result: string };
  /** v: how it was detected (2: macOS asks for the battery, not the model name) */
  hw?: { hasBattery: boolean | null; tablet?: boolean; gpu: number[]; v?: number };
}

const file = () => path.join(app.getPath('userData'), 'usage-stats.json');
let data: Stored | null = null;
let policy: ManagedPolicy | null = null;
let started = false;

const newId = () => uuidFromBytes(randomBytes(16));

function load(): Stored {
  if (data) return data;
  let d: Partial<Stored> = {};
  try { d = JSON.parse(readFileSync(file(), 'utf8')); } catch { /* first run */ }
  data = {
    installId: isInstallId(d.installId) ? d.installId : newId(),
    activeDays: Array.isArray(d.activeDays) ? d.activeDays : [],
    pages: d.pages && typeof d.pages === 'object' ? d.pages : {},
    health: d.health && typeof d.health === 'object' ? d.health : {},
    startupMs: d.startupMs,
    queue: Array.isArray(d.queue) ? d.queue : [],
    madeFor: d.madeFor,
    last: d.last,
    lastAttempt: d.lastAttempt,
    hw: d.hw,
  };
  return data;
}

let writing: Promise<void> = Promise.resolve();
function save(): Promise<void> {
  const text = JSON.stringify(load());
  writing = writing.then(async () => {
    await fsp.mkdir(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, text, { mode: 0o600 });
    await fsp.rename(tmp, file());
  }).catch(() => undefined);
  return writing;
}

function readPolicy(): ManagedPolicy | null {
  try { return parsePolicy(readFileSync(POLICY_FILE, 'utf8')); } catch { return null; }
}

function reason() {
  return offReason({ switchOn: featureOn(FEATURE), env: process.env, policy });
}

/** May stats be collected and sent right now? */
export function usageStatsOn(): boolean {
  return reason() === null;
}

// ---------------------------------------------------------------- collecting (only while on)

const today = () => utcDay(Date.now());

function healthToday() {
  const d = load();
  return (d.health[today()] ??= { crashes: 0, restarts: 0, memSum: 0, cpuSum: 0, samples: 0 });
}

function prune() {
  const d = load();
  const weekAgo = utcDay(Date.now() - 7 * 86_400_000);
  d.activeDays = [...new Set(d.activeDays)].filter((x) => x >= weekAgo).sort();
  for (const k of Object.keys(d.pages)) if (k < weekAgo) delete d.pages[k];
  for (const k of Object.keys(d.health)) if (k < weekAgo) delete d.health[k];
}

/** A main page was opened (from the interface; the name only). */
export function notePage(name: string) {
  if (!usageStatsOn() || typeof name !== 'string' || !/^[a-z][a-zA-Z0-9-]{0,31}$/.test(name)) return;
  const d = load();
  const day = today();
  if (!d.activeDays.includes(day)) d.activeDays.push(day);
  const p = (d.pages[day] ??= {});
  if (Object.keys(p).length < 100 || p[name]) p[name] = (p[name] ?? 0) + 1;
}

function noteCrash() {
  if (usageStatsOn()) healthToday().crashes++;
}

function sample() {
  const u = usage();
  const h = healthToday();
  h.memSum += u.memory;
  h.cpuSum += u.cpu;
  h.samples++;
}

const HW_VERSION = 2;

export async function hardware(): Promise<NonNullable<Stored['hw']>> {
  const d = load();
  // Earlier versions took any Mac whose model name lacks "MacBook" (Mac16,6 and the like) for a desktop.
  if (d.hw && (d.hw.v ?? 1) >= HW_VERSION) return d.hw;
  let gpu: number[] = [];
  try {
    const info = (await app.getGPUInfo('basic')) as { gpuDevice?: { vendorId?: number }[] };
    gpu = (info.gpuDevice ?? []).map((g) => Number(g.vendorId) || 0);
  } catch { /* not available */ }
  let hasBattery: boolean | null = null;
  let tablet: boolean | undefined;
  try {
    if (process.platform === 'linux') hasBattery = readdirSync('/sys/class/power_supply').some((n) => /^BAT/i.test(n));
    else if (process.platform === 'darwin') {
      const model = placeEnv().macModel ?? (await run('/usr/sbin/sysctl', ['-n', 'hw.model'], 5000)).stdout.trim();
      const pmset = await run('/usr/bin/pmset', ['-g', 'batt'], 5000);
      hasBattery = macHasBattery({ pmset: pmset.ok ? pmset.stdout : undefined, model });
      if (hasBattery === null) hasBattery = macHasBattery({ ioreg: (await run('/usr/sbin/ioreg', ['-rn', 'AppleSmartBattery'], 5000)).stdout, model });
    } else if (process.platform === 'win32') {
      // Chassis types from the firmware: 8–14 and 31 portable, 30 and 32 tablets, 3–7, 13, 15, 16, 35 and 36 desktops.
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_SystemEnclosure).ChassisTypes'], 15_000);
      const types = r.stdout.split(/\s+/).map(Number).filter((n) => n > 0);
      if (types.some((t) => t === 30 || t === 32)) { hasBattery = true; tablet = true; } else if (types.some((t) => [8, 9, 10, 11, 12, 14, 31].includes(t))) hasBattery = true;
      else if (types.length) hasBattery = false;
    }
  } catch { /* unknown */ }
  d.hw = { hasBattery, tablet, gpu, v: HW_VERSION };
  return d.hw;
}

async function counts(): Promise<{ ai: number; devices: number }> {
  let ai = 0;
  let devices = 0;
  try {
    const { connections } = await import('./brain');
    ai = (await connections()).connections.filter((c) => c.needsKey && c.hasKey).length;
  } catch { /* the brain is not running */ }
  try {
    const { linkNode } = await import('./link');
    devices = linkNode()?.state().devices.length ?? 0;
  } catch { /* Link is off */ }
  return { ai, devices };
}

/** The numbers for today, gathered now. Pure building happens in core/telemetry.ts. */
async function inputs(): Promise<TelemetryInputs> {
  const d = load();
  const day = today();
  const hw = await hardware();
  const { ai, devices } = await counts();
  const h = d.health[day] ?? { crashes: 0, restarts: 0, memSum: 0, cpuSum: 0, samples: 0 };
  const u = h.samples ? null : usage();
  const env = placeEnv();
  return {
    installId: d.installId,
    now: Date.now(),
    version: app.getVersion(),
    official: OFFICIAL,
    installSource: detectInstallSource(process.execPath, process.env, process.platform, existsSync),
    platform: process.platform,
    osRelease: process.platform === 'darwin' ? process.getSystemVersion() : os.release(),
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model ?? '',
    cores: os.cpus().length,
    totalMemBytes: os.totalmem(),
    gpuVendorIds: hw.gpu,
    hasBattery: hw.hasBattery,
    tablet: hw.tablet,
    displays: screen.getAllDisplays().length,
    notch: Object.keys(env.notchRects ?? {}).length > 0,
    locale: app.getSystemLocale?.() || app.getLocale(),
    activeDays: d.activeDays,
    featuresOn: listFeatures().filter((f) => f.on).map((f) => f.id),
    knownFeatures: FEATURES.map((f) => f.id),
    pageOpens: d.pages[day] ?? {},
    aiProviders: ai,
    devices,
    crashes: h.crashes,
    restarts: h.restarts,
    avgMemoryBytes: h.samples ? h.memSum / h.samples : u!.memory,
    avgCpuPct: h.samples ? h.cpuSum / h.samples : u!.cpu,
    startupMs: d.startupMs,
  };
}

// ---------------------------------------------------------------- sending

async function firewallBlocks(): Promise<boolean> {
  try {
    const { ownConnectionDenied } = await import('./fw');
    return await ownConnectionDenied(new URL(ENDPOINT).hostname, Number(new URL(ENDPOINT).port) || 443);
  } catch {
    return false;
  }
}

async function send(): Promise<void> {
  const d = load();
  if (!d.queue.length) return;
  const body: PingBody = { pings: d.queue };
  // The same check the server does: never send anything outside the schema.
  if (!validateBody(body).ok) {
    d.queue = [];
    d.lastAttempt = { at: Date.now(), result: 'Not sent: the report did not match the schema' };
    return;
  }
  if (await firewallBlocks()) {
    d.lastAttempt = { at: Date.now(), result: 'Not sent: blocked by your firewall rule' };
    return;
  }
  if (!net.isOnline()) {
    d.lastAttempt = { at: Date.now(), result: 'Waiting: offline' };
    return;
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      signal: AbortSignal.timeout(20_000),
    });
    // Switched off while it was on its way: forget the result, keep nothing.
    if (!usageStatsOn()) return;
    if (res.ok) {
      d.last = { at: Date.now(), body };
      d.queue = [];
      d.lastAttempt = { at: Date.now(), result: 'Sent' };
    } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      // The server will never take these: drop them rather than retry forever.
      d.queue = [];
      d.lastAttempt = { at: Date.now(), result: `Not accepted (${res.status})` };
    } else d.lastAttempt = { at: Date.now(), result: `Will try again later (${res.status})` };
  } catch {
    // Not deployed yet, offline, or blocked elsewhere: quietly try another day; the queue stays capped.
    d.lastAttempt = { at: Date.now(), result: 'Will try again later (no answer)' };
  }
}

let busy = false;
/** The regular check: note Keeper's own use, make today's report once, and send when idle. */
async function tick() {
  policy = readPolicy();
  if (busy || !usageStatsOn()) return;
  busy = true;
  try {
    sample();
    prune();
    const d = load();
    const day = today();
    if (d.madeFor !== day) {
      d.queue = enqueue(d.queue.filter((q) => q.id === d.installId), buildPayload(await inputs()), Date.now());
      d.madeFor = day;
    }
    await save();
    if (!d.queue.length || CI_QUIET) return;
    await whenIdle('sources');
    if (!usageStatsOn()) return;
    await send();
    await save();
  } finally {
    busy = false;
  }
}

// ---------------------------------------------------------------- the interface

export async function status(): Promise<UsageStatsStatus> {
  policy = readPolicy();
  const d = load();
  const r = reason();
  let next: PingBody | null = null;
  try {
    const p = buildPayload(await inputs());
    next = { pings: enqueue(d.queue.filter((q) => q.id === d.installId), p, Date.now()) };
  } catch { /* shown as unavailable */ }
  const host = new URL(ENDPOINT).hostname;
  return {
    on: r === null,
    switchOn: featureOn(FEATURE),
    offReason: r,
    offText: r ? OFF_REASON_TEXT[r] : undefined,
    locked: r !== null && r !== 'switch',
    installId: d.installId,
    endpoint: ENDPOINT,
    host,
    last: d.last,
    next,
    queued: d.queue.length,
    lastAttempt: d.lastAttempt,
    blockedByFirewall: await firewallBlocks(),
    policyFile: POLICY_FILE,
  };
}

export async function setOn(on: boolean): Promise<UsageStatsStatus> {
  await setFeature(FEATURE, on);
  return status();
}

/** A new random ID; the old one's unsent days are dropped, so nothing links the two. */
export async function resetId(): Promise<UsageStatsStatus> {
  const d = load();
  d.installId = newId();
  d.queue = [];
  d.madeFor = undefined;
  d.last = undefined;
  d.lastAttempt = undefined;
  await save();
  if (usageStatsOn()) pollNow('usageStats.daily');
  return status();
}

export async function setBlocked(blocked: boolean): Promise<UsageStatsStatus> {
  const { setOwnConnectionBlocked } = await import('./fw');
  await setOwnConnectionBlocked(new URL(ENDPOINT).hostname, blocked, 'Keeper: anonymous usage stats');
  return status();
}

/** Turned off: forget everything collected and queued. The install ID stays (reset it to change it). */
function forget() {
  const d = load();
  d.queue = [];
  d.pages = {};
  d.health = {};
  d.activeDays = [];
  d.madeFor = undefined;
  void save();
}

export function startUsageStats() {
  if (started) return;
  started = true;
  policy = readPolicy();
  load();
  // Settings → Features shows it off when the environment or a policy switched it off.
  setExternalOff(FEATURE, () => { const r = reason(); return r !== null && r !== 'switch'; });
  // Crashes and service restarts, counted (no details) only while on.
  app.on('render-process-gone', (_e, _w, det) => { if (det.reason !== 'clean-exit' && det.reason !== 'killed') noteCrash(); });
  app.on('child-process-gone', (_e, det) => { if (det.reason === 'crashed' || det.reason === 'oom') noteCrash(); });
  void import('../svc/host').then(({ onHostRestarted }) => onHostRestarted(() => { if (usageStatsOn()) healthToday().restarts++; })).catch(() => undefined);
  void import('../resilience').then(({ lastRun }) => { if (lastRun?.unclean) noteCrash(); }).catch(() => undefined);
  // How long the window took to show its first page.
  const first = (w: BrowserWindow) => w.webContents.once('did-finish-load', () => {
    if (usageStatsOn()) load().startupMs = Math.round(process.uptime() * 1000);
  });
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) first(existing);
  else app.once('browser-window-created', (_e, w) => first(w));
  onFeature(FEATURE, (on) => { if (!on) forget(); });
  if (!usageStatsOn()) forget();
  // Switched off for good by the environment: no regular check at all.
  const r = reason();
  if (r === 'env' || r === 'dnt') return;
  // First look ten minutes after start (an hour once today's report is made); paused while switched off.
  poll('usageStats.daily', () => ({ baseMs: INTERVAL || (load().madeFor === today() ? 60 : 10) * 60_000, idleFactor: 1 }), tick, { now: false, feature: FEATURE });
  app.on('before-quit', () => { if (usageStatsOn()) void save(); });
}
