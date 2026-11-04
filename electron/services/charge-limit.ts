// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Battery care: the charge limit, a full charge for a trip and pausing while
// hot. Linux writes the kernel's charge thresholds (one administrator prompt,
// a udev rule keeps them after a restart); Windows opens the maker's own app;
// macOS opens Battery settings (core/charge-limit.ts says why). Nothing runs
// while the part is off; with a trip or heat protection on, one look a minute
// while the laptop is plugged in.

import { app, shell } from 'electron';
import { constants, promises as fsp } from 'node:fs';
import path from 'node:path';
import type { BatteryCareApi, BatteryCareStatus } from '../../core/api-battery';
import {
  chargePlan, normalizeChargeSettings, parseBehaviour, startFor, surfaceNote, sysfsTemp, thresholdFiles, thresholdPlan, tripEnd, udevRule, UDEV_RULE_FILE, vendorApp,
  writeCommands, type ChargeSettings, type SysfsBattery,
} from '../../core/charge-limit';
import { powershell } from '../../core/platform';
import { settings, updateSettings } from '../store';
import { featureOn, onFeature } from './features';
import { poll } from './governor';

const FEATURE = 'chargeLimit';
const OS = process.platform;
/** Tests point this at a stand-in /sys and /etc. */
const ROOT = process.env.KEEPER_CHARGE_TEST_ROOT ?? '';
const SUPPLY = () => `${ROOT}/sys/class/power_supply`;
const RULE = () => `${ROOT}/etc/udev/rules.d/${UDEV_RULE_FILE}`;
const options = () => normalizeChargeSettings(settings().chargeLimit);

let broadcast: (channel: string) => void = () => undefined;
let pausedForHeat = false;
let lastMessage = '';

// ---------------------------------------------------------------- reading

const read = (p: string) => fsp.readFile(p, 'utf8').then((s) => s.trim()).catch(() => undefined);
const num = (s: string | undefined) => (s !== undefined && s !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined);

async function linuxBattery(): Promise<{ battery?: SysfsBattery; plugged: boolean }> {
  let names: string[] = [];
  try { names = await fsp.readdir(SUPPLY()); } catch { return { plugged: false }; }
  let battery: SysfsBattery | undefined;
  let plugged = false;
  for (const n of names.sort()) {
    const dir = path.join(SUPPLY(), n);
    const type = await read(path.join(dir, 'type'));
    if (type === 'Mains' || type === 'USB') { if ((await read(path.join(dir, 'online'))) === '1') plugged = true; continue; }
    if (type !== 'Battery' || battery) continue;
    // Mice, keyboards and headsets have batteries too (scope Device); only the computer's own counts.
    if ((await read(path.join(dir, 'scope'))) === 'Device') continue;
    const files = await fsp.readdir(dir).catch(() => [] as string[]);
    const f = thresholdFiles(files);
    const beh = f.behaviourFile ? parseBehaviour((await read(path.join(dir, f.behaviourFile))) ?? '') : undefined;
    battery = {
      name: n, ...f,
      end: f.endFile ? num(await read(path.join(dir, f.endFile))) : undefined,
      start: f.startFile ? num(await read(path.join(dir, f.startFile))) : undefined,
      behaviour: beh?.current, behaviours: beh?.choices,
      capacity: num(await read(path.join(dir, 'capacity'))),
      status: await read(path.join(dir, 'status')),
      temp: sysfsTemp(await read(path.join(dir, 'temp'))),
    };
  }
  if (battery && /^(charging|full|not charging)$/i.test(battery.status ?? '')) plugged = true;
  return { battery, plugged };
}

async function writable(b: SysfsBattery): Promise<boolean> {
  const files = [b.endFile, b.startFile].filter(Boolean) as string[];
  if (!files.length) return false;
  for (const f of files) {
    try { await fsp.access(path.join(SUPPLY(), b.name, f), constants.W_OK); } catch { return false; }
  }
  return true;
}

async function status(): Promise<BatteryCareStatus> {
  const s = options();
  const base = { settings: s, platform: OS, message: lastMessage || undefined };
  if (OS === 'linux') {
    const { battery: b, plugged } = await linuxBattery();
    if (!b) return { ...base, battery: null, support: 'none', canLimit: false, canPause: false, withoutAsking: false, note: 'This computer has no battery.' };
    const plan = chargePlan(s, Date.now(), b.temp, pausedForHeat);
    const canPause = !!b.behaviours?.includes('inhibit-charge') || !!b.endFile;
    return {
      ...base,
      battery: { percent: b.capacity ?? 0, charging: /^charging$/i.test(b.status ?? ''), plugged, temp: b.temp },
      support: b.endFile ? 'linux' : 'none',
      canLimit: !!b.endFile,
      canPause,
      withoutAsking: await writable(b),
      current: b.end,
      kept: await fsp.access(RULE()).then(() => true, () => false),
      plan,
      note: b.endFile ? undefined : 'This laptop’s battery has no charge limit the system can set. Some makers offer it in their own app or in the firmware settings.',
    };
  }
  const { readBattery } = await import('./system');
  const bat = await readBattery().catch(() => undefined);
  const battery = bat ? { percent: bat.percent, charging: bat.charging, plugged: bat.charging } : null;
  if (!battery) return { ...base, battery: null, support: 'none', canLimit: false, canPause: false, withoutAsking: false, note: 'This computer has no battery.' };
  if (OS === 'darwin') return { ...base, battery, support: 'mac', canLimit: false, canPause: false, withoutAsking: false };
  const r = await powershell('$c = Get-CimInstance Win32_ComputerSystem; [pscustomobject]@{ Maker = $c.Manufacturer; Model = $c.Model; Apps = @(Get-StartApps | Select-Object Name, AppID) } | ConvertTo-Json -Compress -Depth 3', 20_000);
  let maker = '';
  let model = '';
  let apps: { Name: string; AppID: string }[] = [];
  try { const j = JSON.parse(r.stdout); maker = j.Maker ?? ''; model = j.Model ?? ''; apps = Array.isArray(j.Apps) ? j.Apps : j.Apps ? [j.Apps] : []; } catch { /* PowerShell did not answer */ }
  return { ...base, battery, support: 'windows', canLimit: false, canPause: false, withoutAsking: false, vendor: vendorApp(maker, apps) ?? undefined, note: surfaceNote(maker, model) };
}

// ---------------------------------------------------------------- writing (Linux)

async function writeDirect(b: SysfsBattery, end: number) {
  for (const w of thresholdPlan(b, end)) await fsp.writeFile(path.join(SUPPLY(), b.name, w.file), w.value);
}

async function setBehaviour(b: SysfsBattery, pause: boolean): Promise<boolean> {
  if (!b.behaviourFile || !(b.behaviours?.includes('inhibit-charge') || b.behaviour === 'inhibit-charge')) return false;
  const want = pause ? 'inhibit-charge' : 'auto';
  if (b.behaviour === want) return true;
  await fsp.writeFile(path.join(SUPPLY(), b.name, b.behaviourFile), want);
  return true;
}

/** The limit now, kept after a restart; with `withoutAsking`, the person's own group may change it from then on. One administrator prompt. */
async function apply(limit: number, opts: { withoutAsking?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
  if (!featureOn(FEATURE)) return { ok: false, message: 'Battery care is off' };
  const next = normalizeChargeSettings({ ...options(), limit });
  await updateSettings({ chargeLimit: next });
  if (OS !== 'linux') return { ok: false, message: 'Set the limit in your system’s or your laptop maker’s settings' };
  const { battery: b } = await linuxBattery();
  if (!b?.endFile) return { ok: false, message: 'This battery has no charge limit the system can set' };
  const end = chargePlan(next, Date.now()).end;
  // Allowed before stays allowed: the rule written now keeps the group's right to change it.
  const allow = opts.withoutAsking ?? (await writable(b));
  const { runCmds } = await import('./elevate');
  const tmp = path.join(app.getPath('userData'), UDEV_RULE_FILE);
  const gid = typeof process.getgid === 'function' ? process.getgid() : undefined;
  await fsp.writeFile(tmp, udevRule(b, next.limit, allow ? gid : undefined));
  const files = [b.endFile, b.startFile, b.behaviourFile].filter(Boolean).map((f) => path.join(SUPPLY(), b.name, f!));
  const cmds = [
    ...writeCommands(ROOT, b, thresholdPlan(b, end)),
    next.limit >= 100
      ? { file: 'rm', args: ['-f', RULE()], admin: true as const }
      : { file: 'install', args: ['-D', '-m', '644', tmp, RULE()], admin: true as const },
    ...(allow && gid !== undefined && next.limit < 100 ? [{ file: 'chgrp', args: [String(gid), ...files], admin: true as const }, { file: 'chmod', args: ['g+w', ...files], admin: true as const }] : []),
  ];
  const r = await runCmds(cmds, 60_000);
  await fsp.rm(tmp, { force: true });
  lastMessage = r.ok ? '' : r.message;
  broadcast('battery-care-changed');
  schedule(featureOn(FEATURE));
  if (!r.ok) return { ok: false, message: r.message };
  return { ok: true, message: next.limit >= 100 ? 'Charging to 100% again' : `Charging stops at ${next.limit}%${b.startFile ? ` and starts again below ${startFor(next.limit)}%` : ''}` };
}

/** Applies what the plan says now, without asking (only where Keeper may). */
async function tick() {
  if (OS !== 'linux' || !featureOn(FEATURE)) return;
  const s = options();
  if (s.tripUntil && s.tripUntil <= Date.now()) await updateSettings({ chargeLimit: { ...s, tripUntil: 0 } });
  const { battery: b, plugged } = await linuxBattery();
  if (!b?.endFile || !(await writable(b))) return;
  const plan = chargePlan(options(), Date.now(), b.temp, pausedForHeat);
  try {
    if (b.end !== plan.end) await writeDirect(b, plan.end);
    if (plan.pause !== pausedForHeat && plugged) {
      // No pause switch: hold the battery where it is by lowering the end to the current charge.
      if (!(await setBehaviour(b, plan.pause)) && plan.pause && b.capacity !== undefined) await writeDirect(b, Math.max(50, b.capacity));
      pausedForHeat = plan.pause;
    } else if (!plan.pause && pausedForHeat) {
      await setBehaviour(b, false);
      pausedForHeat = false;
    }
  } catch (e) {
    lastMessage = e instanceof Error ? e.message : String(e);
  }
  broadcast('battery-care-changed');
}

async function setTrip(on: boolean): Promise<BatteryCareStatus> {
  const s = options();
  await updateSettings({ chargeLimit: { ...s, tripUntil: on ? tripEnd(Date.now()) : 0 } });
  schedule(featureOn(FEATURE));
  await tick();
  return status();
}

async function setHeat(on: boolean): Promise<BatteryCareStatus> {
  await updateSettings({ chargeLimit: { ...options(), heat: on } as ChargeSettings });
  if (!on && pausedForHeat) {
    const { battery: b } = await linuxBattery();
    if (b && (await writable(b))) { await setBehaviour(b, false).catch(() => false); await writeDirect(b, chargePlan(options(), Date.now()).end).catch(() => undefined); }
    pausedForHeat = false;
  }
  schedule(featureOn(FEATURE));
  await tick();
  return status();
}

async function openSettings(): Promise<void> {
  if (OS === 'darwin') { await shell.openExternal('x-apple.systempreferences:com.apple.Battery-Settings.extension'); return; }
  if (OS === 'win32') {
    const st = await status();
    if (st.vendor?.appId) { await shell.openPath(`shell:AppsFolder\\${st.vendor.appId}`).then((e) => (e ? shell.openExternal(`shell:AppsFolder\\${st.vendor!.appId}`) : undefined)); return; }
    if (st.vendor?.store) { await shell.openExternal(st.vendor.store); return; }
    await shell.openExternal('ms-settings:batterysaver');
  }
}

export const batteryCareApi: BatteryCareApi = { status, apply, setTrip, setHeat, openSettings };

// ---------------------------------------------------------------- schedule

let stopPoll: (() => void) | undefined;

function schedule(on: boolean) {
  const s = options();
  const needed = on && OS === 'linux' && (s.tripUntil > Date.now() || s.heat || pausedForHeat);
  if (!needed) { stopPoll?.(); stopPoll = undefined; return; }
  if (stopPoll) return;
  // A battery warms up and cools down slowly: once a minute is plenty, and it matters while the screen is locked too.
  stopPoll = poll('batteryCare.tick', { baseMs: 60_000, idleFactor: 1, pauseWhenLocked: false }, tick, { feature: FEATURE, now: true });
}

export function startBatteryCare(d: { broadcast: (channel: string) => void }) {
  broadcast = d.broadcast;
  onFeature(FEATURE, schedule, { now: true });
}
