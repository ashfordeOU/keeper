// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quick Controls: reads and switches system network, firewall, privacy and
// security settings. Settings are read only when asked (the page, the tray
// menu or the Island tiles open), never on a timer. Changes that need the
// administrator are gathered into one script, so a preset asks once. Changes
// that make the system less protected are refused until the person confirms.
// Every change is logged and can be undone. Settings that systems do not let
// apps change open the right Settings page through the guide.
//
// KEEPER_CONTROLS_DRYRUN=<file> (tests): system changes are written to that
// file instead of run, and remembered as the new state; real readers still run.
// Of Keeper's own settings only the firewall mode changes for real.

import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ControlsResult, ControlsView } from '../../core/api-controls';
import { CONTROLS, CONTROL_BY_ID, PRESET_BY_ID, PRESETS } from '../../core/controls/catalog';
import { batch, CTX_SCRIPTS, ctxParse, readSpec, setSteps, winPerAppScript } from '../../core/controls/cmds';
import { autoPlan, doable, planValues, undoChanges, weakeningWarning, type Plan } from '../../core/controls/plan';
import type { Change, ControlState, ControlValue, Ctx, LogEntry, Os, Step } from '../../core/controls/types';
import { desktopFrom } from '../../core/guide/links';
import { powershell, run } from '../../core/platform';
import type { PermissionGrant } from '../../core/security/types';
import { featureOn } from './features';
import { psRun } from './ps-host';

const OS: Os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux';
const DRY = process.env.KEEPER_CONTROLS_DRYRUN || '';
/** Keeper's own settings that change for real even in a test run */
const DRY_REAL = new Set(['keeperFwMode']);

let broadcast: (channel: string, ...args: unknown[]) => void = () => undefined;
let alert: (title: string, detail: string) => void = () => undefined;
const changeListeners = new Set<() => void>();

// ---------------------------------------------------------------- saved state

interface Saved {
  log: LogEntry[];
  bindings: Record<string, string>;
  /** the blocklists that were on, so switching blocklists back on restores them */
  lastLists?: string[];
}

let saved: Saved = { log: [], bindings: {} };
const file = () => path.join(app.getPath('userData'), 'quick-controls.json');

function load() {
  try {
    const s = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Saved>;
    saved = { log: Array.isArray(s.log) ? s.log.slice(0, 100) : [], bindings: s.bindings ?? {}, lastLists: s.lastLists };
  } catch {
    saved = { log: [], bindings: {} };
  }
}

let writing: Promise<void> = Promise.resolve();
function save() {
  const data = JSON.stringify(saved);
  writing = writing.then(async () => {
    const tmp = `${file()}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file());
  }).catch(() => undefined);
}

// ---------------------------------------------------------------- the system's shape

let ctxCache: { ctx: Ctx; at: number } | null = null;

function onPath(tool: string): boolean {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), '/usr/sbin', '/sbin', '/usr/bin', '/bin'];
  return dirs.some((d) => d && existsSync(path.join(d, tool)));
}

async function gatherCtx(): Promise<Ctx> {
  if (ctxCache && Date.now() - ctxCache.at < 60_000) return ctxCache.ctx;
  const ctx: Ctx = { os: OS };
  if (OS === 'linux') {
    const tools = ['nmcli', 'bluetoothctl', 'rfkill', 'pactl', 'gsettings', 'systemctl', 'ethtool', 'ufw', 'firewall-cmd', 'pkexec'];
    ctx.tools = Object.fromEntries(tools.map((t) => [t, onPath(t)]));
    ctx.linuxFirewall = ctx.tools.ufw ? 'ufw' : ctx.tools['firewall-cmd'] ? 'firewalld' : 'none';
    ctx.gnome = desktopFrom(process.env) === 'gnome';
    if (ctx.tools.nmcli) {
      const r = await run('nmcli', ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active'], 5000);
      if (r.ok) Object.assign(ctx, ctxParse.linux(r.stdout));
    }
  } else if (OS === 'darwin') {
    const [ports, route] = await Promise.all([run('networksetup', ['-listallhardwareports'], 5000), run('route', ['-n', 'get', 'default'], 5000)]);
    Object.assign(ctx, ctxParse.mac(ports.stdout, route.stdout));
  } else {
    const r = await psRun(CTX_SCRIPTS.winAdapter, 8000);
    ctx.winAdapter = r.stdout.trim() || undefined;
  }
  ctxCache = { ctx, at: Date.now() };
  return ctx;
}

// ---------------------------------------------------------------- running steps

async function runStep(s: Step): Promise<{ ok: boolean; stdout: string; message?: string }> {
  if (s.kind === 'cmd') {
    const r = await run(s.cmd, s.args, 15_000);
    return { ok: r.ok, stdout: r.stdout, message: r.stderr.trim().split('\n')[0] };
  }
  if (s.kind === 'ps') return psRun(s.script, 15_000);
  return { ok: false, stdout: '', message: 'Not a plain step' };
}

function adminShell(script: string): Promise<{ ok: boolean; message: string }> {
  if (OS === 'darwin') {
    return new Promise((resolve) => {
      const as = `do shell script ${JSON.stringify(script)} with administrator privileges with prompt "Keeper needs your password to change system settings."`;
      execFile('/usr/bin/osascript', ['-e', as], { timeout: 180_000 }, (err, _o, e) => resolve(err ? { ok: false, message: /User canceled|-128/.test(String(e)) ? 'The administrator prompt was cancelled' : String(e).split('\n')[0] || 'The change did not go through' } : { ok: true, message: 'Done' }));
    });
  }
  return run('pkexec', ['sh', '-c', script], 180_000).then((r) => ({
    ok: r.ok,
    message: r.ok ? 'Done' : /dismissed|Not authorized|126|127/.test(r.stderr) || !r.stderr.trim() ? 'The administrator prompt was cancelled or a change was refused' : r.stderr.trim().split('\n')[0],
  }));
}

async function adminPowerShell(script: string): Promise<{ ok: boolean; message: string }> {
  // The script goes to a file only this user can read; PowerShell starts elevated (one UAC prompt) to run it.
  const dir = path.join(app.getPath('userData'), 'quick-controls');
  await fsp.mkdir(dir, { recursive: true });
  const f = path.join(dir, `change-${Date.now()}.ps1`);
  await fsp.writeFile(f, script, { mode: 0o600 });
  const exe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
  const launcher = `$p = Start-Process -FilePath ${q(exe)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${q(f)}); exit $p.ExitCode`;
  const r = await powershell(launcher, 180_000);
  await fsp.rm(f, { force: true });
  if (r.ok) return { ok: true, message: 'Done' };
  return { ok: false, message: /canceled|cancelled/i.test(r.stderr) ? 'The administrator prompt was cancelled' : 'Some changes did not go through' };
}

/** test runs: what would have run, appended to the dry-run file */
const dryState = new Map<string, ControlValue>();
async function dryWrite(lines: string[]) {
  await fsp.appendFile(DRY, lines.map((l) => `${l}\n`).join(''));
}

// ---------------------------------------------------------------- Keeper's own settings

async function keeperRead(id: string): Promise<{ value: ControlValue | null; note?: string; how?: ControlState['how'] }> {
  switch (id) {
    case 'vpn': {
      const { vpnStatus } = await import('./net');
      const s = await vpnStatus();
      if (!s.vpns.length) return { value: null, how: 'guide', note: 'No VPN is set up yet; add one in VPN.' };
      return { value: s.vpns.some((v) => v.state === 'connected') };
    }
    case 'keeperFwMode': case 'keeperEnforce': case 'dnsFilter': case 'blocklists': {
      const { fwApi } = await import('./fw');
      const st = await fwApi.status();
      if (id === 'keeperFwMode') return { value: st.state.mode };
      if (id === 'keeperEnforce') return { value: st.settings.enforce, note: st.enforcement.message };
      if (id === 'dnsFilter') return { value: st.settings.dnsFilter };
      return { value: st.settings.lists.some((l) => l.enabled) };
    }
    case 'realtime': case 'autoQuarantine': {
      const sec = await import('./security');
      return { value: sec.settings()[id] };
    }
  }
  return { value: null };
}

async function keeperSet(id: string, value: ControlValue): Promise<{ ok: boolean; message: string }> {
  switch (id) {
    case 'vpn': {
      const net = await import('./net');
      const s = await net.vpnStatus();
      if (!s.vpns.length) return { ok: false, message: 'No VPN is set up yet; add one in VPN.' };
      if (value) {
        const v = s.vpns.find((x) => x.state === 'connected') ?? s.vpns[0];
        if (v.state === 'connected') return { ok: true, message: 'Already connected' };
        const r = await net.vpnAction(v.id, 'connect');
        return { ok: r.ok, message: r.message ?? (r.ok ? 'Connected' : 'Could not connect') };
      }
      const on = s.vpns.filter((x) => x.state === 'connected');
      const rs = await Promise.all(on.map((v) => net.vpnAction(v.id, 'disconnect')));
      return { ok: rs.every((r) => r.ok), message: rs.find((r) => !r.ok)?.message ?? 'Disconnected' };
    }
    case 'keeperFwMode': {
      const { fwApi } = await import('./fw');
      await fwApi.setMode(value as 'alert' | 'silent-allow' | 'silent-deny');
      return { ok: true, message: 'Done' };
    }
    case 'keeperEnforce': case 'dnsFilter': {
      const { fwApi } = await import('./fw');
      const st = await fwApi.setSettings(id === 'dnsFilter' ? { dnsFilter: !!value } : { enforce: !!value });
      if (id === 'keeperEnforce' && !!value && !st.enforcement.active) return { ok: false, message: st.enforcement.message ?? 'The rules could not be put in place' };
      return { ok: true, message: 'Done' };
    }
    case 'blocklists': {
      const { fwApi } = await import('./fw');
      const st = await fwApi.status();
      const wanted = new Set(value ? saved.lastLists?.length ? saved.lastLists : ['stevenblack', 'hagezi-tif'] : []);
      if (!value) { saved.lastLists = st.settings.lists.filter((l) => l.enabled).map((l) => l.id); save(); }
      await fwApi.setSettings({ lists: st.settings.lists.map((l) => ({ ...l, enabled: wanted.has(l.id) })) });
      return { ok: true, message: 'Done' };
    }
    case 'realtime': case 'autoQuarantine': {
      const sec = await import('./security');
      await sec.setSettings({ [id]: !!value });
      return { ok: true, message: 'Done' };
    }
  }
  return { ok: false, message: 'Unknown setting' };
}

// ---------------------------------------------------------------- reading

let viewCache: ControlsView | null = null;

const groupOn = (g: string) => featureOn('quickControls') && featureOn(`quickControls${g[0].toUpperCase()}${g.slice(1)}`);

async function readOne(id: string, ctx: Ctx): Promise<ControlState> {
  const def = CONTROL_BY_ID.get(id)!;
  const sup = def.support[OS];
  let how = sup.how;
  let note = sup.note;
  if (how === 'none') return { id, value: null, how, note };
  if (DRY && dryState.has(id)) return { id, value: dryState.get(id)!, how, note };
  if (def.keeper) {
    try {
      const r = await keeperRead(id);
      return { id, value: r.value, how: r.how ?? how, note: r.note ?? note };
    } catch (e) {
      return { id, value: null, how, note: e instanceof Error ? e.message : String(e) };
    }
  }
  // A switch Keeper could make, but the tool it needs is not here: say so and fall back to Settings.
  if ((how === 'direct' || how === 'admin') && !setSteps(id, def.kind === 'choice' ? def.choices![0].value : true, ctx)) {
    const missing = OS === 'linux' ? 'The tool this needs is not installed here' : 'This could not be found on this computer';
    how = def.topic ? 'guide' : 'none';
    note = `${missing}${def.topic ? '; Keeper opens Settings instead' : ''}.`;
  }
  if (how === 'admin' && OS === 'linux' && !ctx.tools?.pkexec) { how = def.topic ? 'guide' : 'none'; note = 'pkexec (polkit) is not installed, so Keeper cannot ask for the administrator password.'; }
  const spec = readSpec(id, ctx);
  if (!spec) return { id, value: null, how, note };
  try {
    const r = await runStep(spec.step);
    const value = r.ok || r.stdout ? spec.parse(r.stdout) : null;
    return { id, value, how, note };
  } catch {
    return { id, value: null, how, note };
  }
}

export async function list(refresh = false): Promise<ControlsView> {
  if (!refresh && viewCache && Date.now() - viewCache.readAt < 5000) return viewCache;
  const ctx = await gatherCtx();
  const defs = CONTROLS.filter((d) => groupOn(d.group));
  const states = await Promise.all(defs.map((d) => Promise.race([
    readOne(d.id, ctx),
    new Promise<ControlState>((r) => setTimeout(() => r({ id: d.id, value: null, how: d.support[OS].how, note: 'Took too long to read' }), 10_000).unref?.()),
  ])));
  let profiles: ControlsView['profiles'] = [];
  try {
    const { fwApi } = await import('./fw');
    const st = await fwApi.status();
    profiles = st.state.profiles.map((p) => ({ id: p.id, name: p.name, active: p.id === st.state.activeProfile }));
  } catch { /* the firewall is off in Features */ }
  viewCache = { os: OS, defs, states, presets: PRESETS, log: saved.log, bindings: saved.bindings, profiles, dryRun: !!DRY, readAt: Date.now() };
  return viewCache;
}

/** the last view read, for menus that cannot wait (the tray) */
export const cached = () => viewCache;

// ---------------------------------------------------------------- changing

function changed() {
  viewCache = null;
  broadcast('controls-changed');
  for (const fn of changeListeners) try { fn(); } catch { /* ignore */ }
}

export function onControlsChanged(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** Puts values in place: plain steps one by one, all administrator steps in one prompt. */
async function apply(title: string, values: Record<string, ControlValue>, opts: { confirmWeaker?: boolean; openGuide?: boolean } = {}): Promise<ControlsResult> {
  const view = await list(true);
  const states = new Map(view.states.map((s) => [s.id, s]));
  const plan = planValues(values, states);
  const weak = plan.items.filter((i) => i.weakening);
  if (weak.length && !opts.confirmWeaker) {
    return { ok: false, message: 'This makes the computer less protected. Confirm to go ahead.', needsConfirm: { warnings: weak.map((i) => weakeningWarning(CONTROL_BY_ID.get(i.id)!, i.to)) } };
  }
  const guided = plan.items.filter((i) => i.how === 'guide');
  const todo = doable(plan.items);
  if (!todo.length) {
    if (guided.length && opts.openGuide) {
      const r = await openSettings(guided[0].id);
      return { ok: r.ok, message: r.ok ? `${CONTROL_BY_ID.get(guided[0].id)!.label} can only be changed in ${r.label ?? 'Settings'}; it is open now.` : r.message ?? 'Could not open Settings', opened: r.label, view };
    }
    const msg = guided.length ? `Change these in Settings: ${guided.map((g) => g.label).join(', ')}.` : plan.skipped.length && !plan.same.length ? `Not on this system: ${plan.skipped.map((s) => s.label).join(', ')}.` : 'Already as asked.';
    return { ok: !guided.length, message: msg, view };
  }

  const ctx = await gatherCtx();
  const steps: Step[] = [];
  const stepOf = new Map<string, Step[]>();
  for (const i of todo) {
    const def = CONTROL_BY_ID.get(i.id)!;
    const s = def.keeper ? [{ kind: 'keeper', id: i.id, value: i.to } as Step] : setSteps(i.id, i.to, ctx) ?? [];
    stepOf.set(i.id, s);
    steps.push(...s);
  }
  const b = batch(steps);
  const failed = new Set<string>();
  const messages: string[] = [];
  const idsWith = (kind: Step['kind']) => [...stepOf].filter(([, s]) => s.some((x) => x.kind === kind)).map(([id]) => id);

  if (DRY) {
    const lines: string[] = [`# ${new Date().toISOString()} ${title}`];
    for (const s of b.plain) {
      if (s.kind === 'keeper' && DRY_REAL.has(s.id)) {
        const r = await keeperSet(s.id, s.value);
        if (!r.ok) { failed.add(s.id); messages.push(r.message); }
      }
      lines.push(s.kind === 'cmd' ? `cmd ${s.cmd} ${s.args.join(' ')}` : s.kind === 'ps' ? `ps ${s.script.split('\n').pop()}` : s.kind === 'keeper' ? `keeper ${s.id}=${String(s.value)}${DRY_REAL.has(s.id) ? ' (real)' : ''}` : '');
    }
    if (b.adminSh) lines.push(`admin-sh ${b.adminSh}`);
    if (b.adminPs) lines.push(`admin-ps ${b.adminPs}`);
    await dryWrite(lines);
    for (const i of todo) if (!failed.has(i.id) && !DRY_REAL.has(i.id)) dryState.set(i.id, i.to);
  } else {
    for (const [id, ss] of stepOf) {
      for (const s of ss) {
        if (s.kind === 'keeper') {
          const r = await keeperSet(s.id, s.value).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
          if (!r.ok) { failed.add(id); messages.push(r.message); }
        } else if (s.kind === 'cmd' || s.kind === 'ps') {
          const r = await runStep(s);
          if (!r.ok) { failed.add(id); if (r.message) messages.push(r.message); }
        }
      }
    }
    if (b.adminSh) {
      const r = await adminShell(b.adminSh);
      if (!r.ok) { for (const id of idsWith('admin-sh')) failed.add(id); messages.push(r.message); }
    }
    if (b.adminPs) {
      const r = await adminPowerShell(b.adminPs);
      if (!r.ok) { for (const id of idsWith('admin-ps')) failed.add(id); messages.push(r.message); }
    }
  }

  // Read again: what actually changed is what goes in the log.
  viewCache = null;
  ctxCache = null;
  const after = await list(true);
  const now = new Map(after.states.map((s) => [s.id, s]));
  const done: Change[] = [];
  for (const i of todo) {
    const v = now.get(i.id)?.value;
    // A batched administrator script reports for all its parts; the new reading says which really changed.
    const ok = v === i.to || (v === null && !failed.has(i.id)) || (v === undefined && !failed.has(i.id));
    if (ok) done.push({ id: i.id, from: i.from, to: i.to });
    else failed.add(i.id);
  }
  if (done.length) {
    saved.log.unshift({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), title, changes: done });
    saved.log = saved.log.slice(0, 100);
    save();
  }
  changed();
  const label = (id: string) => CONTROL_BY_ID.get(id)?.label ?? id;
  const parts: string[] = [];
  if (done.length) parts.push(`Changed: ${done.map((c) => label(c.id)).join(', ')}.`);
  if (failed.size) parts.push(`Did not change: ${[...failed].map(label).join(', ')}${messages.length ? ` (${[...new Set(messages)].join('; ')})` : ''}.`);
  if (guided.length) parts.push(`Change in Settings: ${guided.map((g) => g.label).join(', ')}.`);
  return { ok: !failed.size, message: parts.join(' ') || 'Nothing to change.', view: await list() };
}

export function set(id: string, value: ControlValue, opts: { confirmWeaker?: boolean } = {}): Promise<ControlsResult> {
  const def = CONTROL_BY_ID.get(id);
  if (!def) return Promise.resolve({ ok: false, message: 'Unknown setting' });
  if (def.kind === 'choice' ? !def.choices?.some((c) => c.value === value) : typeof value !== 'boolean') return Promise.resolve({ ok: false, message: 'Not a value this setting takes' });
  const shown = def.kind === 'choice' ? def.choices!.find((c) => c.value === value)!.label : value ? 'on' : 'off';
  return apply(def.kind === 'choice' ? `${def.label}: ${shown}` : `${def.label} ${shown}`, { [id]: value }, { ...opts, openGuide: true });
}

export async function preview(presetId: string): Promise<Plan> {
  const p = PRESET_BY_ID.get(presetId);
  if (!p) throw new Error('No such preset');
  const v = await list(true);
  return planValues(p.values, new Map(v.states.map((s) => [s.id, s])));
}

export function applyPreset(presetId: string, opts: { confirmWeaker?: boolean } = {}): Promise<ControlsResult> {
  const p = PRESET_BY_ID.get(presetId);
  if (!p) return Promise.resolve({ ok: false, message: 'No such preset' });
  return apply(`Preset: ${p.name}`, p.values, opts);
}

export async function undo(logId: string, opts: { confirmWeaker?: boolean } = {}): Promise<ControlsResult> {
  const e = saved.log.find((x) => x.id === logId);
  if (!e) return { ok: false, message: 'That change is no longer in the list.' };
  if (e.undone) return { ok: false, message: 'Already undone.' };
  const back = undoChanges(e);
  if (!back.length) return { ok: false, message: 'Keeper did not know the earlier values, so this cannot be undone.' };
  const r = await apply(`Undo: ${e.title}`, Object.fromEntries(back.map((c) => [c.id, c.to])), opts);
  if (r.ok) { e.undone = true; save(); changed(); r.view = await list(); }
  return r;
}

export async function openSettings(id: string): Promise<{ ok: boolean; label?: string; message?: string }> {
  const def = CONTROL_BY_ID.get(id);
  const topic = def?.topic ?? 'settings';
  const { open } = await import('./guide');
  return open({ topic });
}

export async function bind(profileId: string, presetId: string | null): Promise<ControlsView> {
  if (presetId && !PRESET_BY_ID.has(presetId)) throw new Error('No such preset');
  if (presetId) saved.bindings[profileId] = presetId;
  else delete saved.bindings[profileId];
  save();
  viewCache = null;
  return list();
}

// ---------------------------------------------------------------- per app

export async function perApp(): Promise<{ grants: PermissionGrant[]; notes: string[] }> {
  const sec = await import('./security');
  const r = await sec.permissions();
  return { grants: r.grants, notes: r.notes };
}

export async function perAppSet(g: PermissionGrant, allowed: boolean): Promise<{ ok: boolean; message: string }> {
  if (OS === 'win32' && g.source === 'consent-store' && g.path) {
    const script = winPerAppScript(g.raw, g.path, allowed);
    if (script) {
      if (DRY) { await dryWrite([`ps ${script}`]); return { ok: true, message: 'Done' }; }
      const r = await psRun(script, 15_000);
      if (r.ok) return { ok: true, message: `${g.app} is ${allowed ? 'allowed' : 'no longer allowed'} to use the ${g.service}.` };
    }
  }
  if (allowed) {
    // Granting is the system's own decision: the app asks, or the person allows it in Settings.
    const r = await openSettings(g.service === 'camera' || g.service === 'microphone' || g.service === 'location' ? g.service : 'privacy');
    return { ok: false, message: r.ok ? `Allow it in ${r.label ?? 'Settings'}, which is open now.` : r.message ?? 'Could not open Settings' };
  }
  const sec = await import('./security');
  return sec.revoke(g);
}

// ---------------------------------------------------------------- presets that follow firewall profiles

let lastProfile: string | undefined;

async function profileMaybeChanged() {
  if (!featureOn('quickControls')) return;
  const { fwApi } = await import('./fw');
  const st = await fwApi.status();
  const now = st.state.activeProfile;
  if (now === lastProfile) return;
  const first = lastProfile === undefined;
  lastProfile = now;
  if (first) return;
  const presetId = saved.bindings[now];
  const p = presetId ? PRESET_BY_ID.get(presetId) : undefined;
  if (!p) return;
  const v = await list(true);
  const { apply: strengthen, held } = autoPlan(p, new Map(v.states.map((s) => [s.id, s])));
  // Only direct changes happen on their own; anything that needs a password or weakens protection waits for the person.
  const direct = strengthen.filter((i) => i.how === 'direct');
  const waiting = [...strengthen.filter((i) => i.how !== 'direct'), ...held];
  if (direct.length) await apply(`Preset: ${p.name} (for the ${st.state.profiles.find((x) => x.id === now)?.name ?? now} profile)`, Object.fromEntries(direct.map((i) => [i.id, i.to])), { confirmWeaker: false });
  if (waiting.length) alert(`${p.name} preset`, `${waiting.map((i) => i.label).join(', ')} still to change: open Quick Controls to apply them.`);
}

export async function initControls(d: { broadcast: (channel: string, ...args: unknown[]) => void; alert?: (title: string, detail: string) => void }) {
  broadcast = d.broadcast;
  if (d.alert) alert = d.alert;
  load();
  try {
    const fw = await import('./fw');
    fw.onFwChanged(() => void profileMaybeChanged().catch(() => undefined));
    void fw.fwApi.status().then((s) => (lastProfile = s.state.activeProfile)).catch(() => undefined);
  } catch { /* firewall unavailable */ }
}
