// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Guided fixes: every checker in Keeper reports what the person should do
// through registerFindings(); automatic fixes register a preview, an apply and
// (where possible) an undo through registerAutoFix(). This service keeps the
// To do list, remembers what the person decided, opens the exact settings page
// for a fix, re-checks after they come back, and shows the small window that
// keeps the steps on top while they work in System Settings.

import { app, BrowserWindow, shell } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import type { GuideList } from '../../core/api-guide';
import { mergeFindings, summarize, verifyResult } from '../../core/guide/aggregate';
import { flowAsFinding, FLOWS, searchHowTo, type Platform } from '../../core/guide/builtin';
import { desktopFrom, resolveLink } from '../../core/guide/links';
import type { AutoFixPreview, AutoFixResult, Finding, FindingState, FindingView } from '../../core/guide/types';
import { keepUnmanaged, overlayOptions } from './unmanaged';

export type FindingsProducer = () => Promise<Finding[]> | Finding[];

export interface AutoFix {
  preview(f: Finding): Promise<AutoFixPreview>;
  apply(f: Finding): Promise<AutoFixResult>;
  undo?(f: Finding): Promise<AutoFixResult>;
}

const PLATFORM = (['darwin', 'win32'].includes(process.platform) ? process.platform : 'linux') as Platform;
const producers = new Map<string, FindingsProducer>();
const fixes = new Map<string, AutoFix>();
const found = new Map<string, Finding[]>();
let states: Record<string, FindingState> = {};
let checkedAt: number | undefined;
let broadcast: (channel: string, ...args: unknown[]) => void = () => undefined;
let preloadPath = '';
let refreshing: Promise<void> | null = null;
let alert: ((title: string, detail: string) => void) | undefined;
/** important findings already announced in the Island, so each is said once */
const announced = new Set<string>();

const stateFile = () => path.join(app.getPath('userData'), 'guide.json');

function loadStates() {
  try {
    states = JSON.parse(readFileSync(stateFile(), 'utf8')) as Record<string, FindingState>;
  } catch {
    states = {};
  }
}

let saving: Promise<void> = Promise.resolve();
function saveStates() {
  const data = JSON.stringify(states);
  saving = saving.then(async () => {
    const tmp = `${stateFile()}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, stateFile());
  }).catch(() => undefined);
}

/** A checker adds its findings to the To do list. Called again on every refresh; keep it quick. */
export function registerFindings(source: string, producer: FindingsProducer) {
  producers.set(source, producer);
}

/** An automatic fix: what it will change, doing it, and undoing it when possible. */
export function registerAutoFix(action: string, fix: AutoFix) {
  fixes.set(action, fix);
}

async function runSource(source: string, producer: FindingsProducer) {
  try {
    const list = await Promise.race([Promise.resolve(producer()), new Promise<Finding[]>((_, rej) => setTimeout(() => rej(new Error('timeout')), 30_000))]);
    found.set(source, list.map((f) => ({ ...f, source })));
  } catch {
    // A checker that fails keeps its last findings rather than pretending all is well.
  }
}

/** Re-checks (all checkers, or one). */
export function refresh(source?: string): Promise<void> {
  if (source) {
    const p = producers.get(source);
    return p ? runSource(source, p).then(changed) : Promise.resolve();
  }
  refreshing ??= (async () => {
    await Promise.all([...producers].map(([s, p]) => runSource(s, p)));
    checkedAt = Date.now();
    changed();
    // Something urgent that is new: say it once in the Island.
    for (const f of list().findings) {
      if (f.status !== 'open' || (f.severity !== 'critical' && f.severity !== 'high') || announced.has(f.id)) continue;
      announced.add(f.id);
      alert?.(f.title, 'Open To do in Keeper for the fix');
    }
  })().finally(() => (refreshing = null));
  return refreshing;
}

function allFound(): Finding[] {
  return [...found.values()].flat();
}

export function list(): GuideList {
  const findings = mergeFindings(allFound(), states);
  return { findings, summary: summarize(findings, checkedAt), checkedAt, platform: PLATFORM };
}

function changed() {
  broadcast('guide-changed', list().summary);
}

export function setState(id: string, patch: Partial<FindingState> | null): GuideList {
  if (patch === null) delete states[id];
  else states[id] = { ...states[id], ...patch };
  saveStates();
  changed();
  return list();
}

/** A finding, or a guided flow as flow:<id>. */
export function get(id: string): FindingView | null {
  if (id.startsWith('flow:')) {
    const flow = FLOWS.find((f) => `flow:${f.id}` === id);
    const f = flow && flowAsFinding(flow, PLATFORM);
    return f ? { ...f, state: states[id] ?? {}, status: 'open' } : null;
  }
  return list().findings.find((f) => f.id === id) ?? null;
}

function autoFor(id: string): { f: Finding; fix: AutoFix } {
  const f = get(id);
  if (!f || f.fix.kind !== 'auto') throw new Error('This has no automatic fix');
  const fix = fixes.get(f.fix.action);
  if (!fix) throw new Error('Keeper cannot do this one by itself here');
  return { f, fix };
}

export async function preview(id: string): Promise<AutoFixPreview> {
  const { f, fix } = autoFor(id);
  return fix.preview(f);
}

export async function apply(id: string): Promise<AutoFixResult> {
  const { f, fix } = autoFor(id);
  const r = await fix.apply(f);
  if (r.ok) {
    setState(id, { doneAt: Date.now(), startedAt: undefined });
    await refresh(f.source);
  }
  return { ...r, undoable: r.ok && !!fix.undo };
}

export async function undo(id: string): Promise<AutoFixResult> {
  const { f, fix } = autoFor(id);
  if (!fix.undo) return { ok: false, message: 'This cannot be undone.' };
  const r = await fix.undo(f);
  if (r.ok) {
    setState(id, { doneAt: undefined });
    await refresh(f.source);
  }
  return r;
}

/** Opens a settings page: only links from Keeper's own catalog, never anything a page asks for. */
export async function open(target: { id?: string; topic?: string }): Promise<{ ok: boolean; label?: string; message?: string }> {
  let topic = target.topic;
  if (!topic && target.id) {
    const f = get(target.id);
    if (f?.fix.kind === 'open') topic = f.fix.link;
  }
  if (!topic) return { ok: false, message: 'Nothing to open for this one.' };
  const link = resolveLink(topic, PLATFORM, desktopFrom(process.env));
  if (!link) return { ok: false, message: 'This system has no settings page for that.' };
  if (target.id) setState(target.id, { startedAt: Date.now() });
  // Tests: write what would open instead of opening it.
  const stub = process.env.KEEPER_GUIDE_OPEN_STUB;
  if (stub) {
    await fsp.appendFile(stub, JSON.stringify({ topic: link.topic, url: link.url, cmd: link.cmd }) + '\n');
    return { ok: true, label: link.label };
  }
  try {
    if (link.url) await shell.openExternal(link.url);
    else if (link.cmd) {
      const cmd = link.cmd.filter(Boolean);
      const child = spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore' });
      child.on('error', () => undefined);
      child.unref();
    }
    return { ok: true, label: link.label };
  } catch (e) {
    return { ok: false, label: link.label, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Checks one finding again after the person says they did it. */
export async function verify(id: string): Promise<'done' | 'still-needed'> {
  if (id.startsWith('flow:')) {
    setState(id, { doneAt: Date.now() });
    return 'done';
  }
  const f = allFound().find((x) => x.id === id);
  if (f) await refresh(f.source);
  const result = verifyResult(id, allFound());
  setState(id, result === 'done' ? { doneAt: Date.now(), startedAt: undefined } : { doneAt: undefined });
  return result;
}

/** Started fixes are checked again when the person comes back to Keeper. */
export async function verifyStarted(): Promise<void> {
  const started = Object.entries(states).filter(([, s]) => s.startedAt && !s.doneAt && Date.now() - s.startedAt < 24 * 3600_000).map(([id]) => id);
  for (const id of started) await verify(id).catch(() => undefined);
}

export function howTo(query: string) {
  return searchHowTo(query).slice(0, 8).map(({ flow }) => ({ id: `flow:${flow.id}`, title: flow.title, area: flow.area }));
}

// ---------------------------------------------------------------- the small window that stays on top

let mini: BrowserWindow | null = null;

export function showMini(id: string | null) {
  if (!id) {
    mini?.close();
    mini = null;
    return;
  }
  const query = { view: 'guide-mini', id };
  if (mini && !mini.isDestroyed()) {
    mini.webContents.send('guide-mini', id);
    mini.showInactive();
    return;
  }
  mini = new BrowserWindow({
    ...overlayOptions('guide'),
    width: 360, height: 440, minWidth: 300, minHeight: 260, show: false, alwaysOnTop: true, frame: false, resizable: true,
    skipTaskbar: true, fullscreenable: false, title: 'Keeper guide', backgroundColor: '#00000000', transparent: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true },
  });
  keepUnmanaged(mini, 'guide');
  mini.setAlwaysOnTop(true, 'floating');
  mini.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) void mini.loadURL(`${dev}?${new URLSearchParams(query)}`);
  else void mini.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query });
  mini.once('ready-to-show', () => mini?.showInactive());
  mini.on('closed', () => (mini = null));
}

export function initGuide(d: { broadcast: (channel: string, ...args: unknown[]) => void; preload: string; alert?: (title: string, detail: string) => void }) {
  broadcast = d.broadcast;
  alert = d.alert;
  preloadPath = d.preload;
  loadStates();
}

export const PLATFORM_OF_GUIDE = PLATFORM;
