// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper alongside a running Monorail (macOS): the moments the two must agree
// on something. The rules are in core/ashforde/coexist.ts; the table of every
// area is docs/KEEPER-MONORAIL.md.
//
//   Focus and presentation  follow each other both ways (state.json, monorail:// links)
//   Keep Awake              one hold: Keeper takes over a session Monorail started by hand
//   Stage                   Monorail's layout is read before other apps are hidden and
//                           put back (workspace by workspace, then a re-tile) afterwards
//   computer use            "bring this window forward" scrolls Monorail's strip to it
//   the handshake           Keeper announces itself to Monorail and asks who it is
//
// Idle cost: nothing. Everything here runs at one of those moments, and only
// on a Mac where Monorail's local API answers (switched on in Monorail itself,
// or by Connect in Settings → Ashforde apps).

import { app } from 'electron';
import {
  MODE_OFF, awakeAfterNote, awakeHandOver, desktopOverlap, keeperHello, keeperModeChanged, layoutIntact, layoutRepairs, monorailModeChanged, parseHello, parseWindows,
  type ModeSync, type MonoWindow,
} from '../../../core/ashforde/coexist';
import type { CoexistStatus } from '../../../core/api-ashforde';
import type { MonorailState } from '../../../core/ashforde/monorail';
import * as mono from './monorail';

export interface CoexistDeps {
  /** start or end Keeper's Focus session */
  focus(on: boolean): void;
  /** Keeper's presentation mode (Stage's presentation preset) */
  presentation(on: boolean): void | Promise<unknown>;
  focusOn(): boolean;
  awakeOn(): boolean;
  stageOn(): boolean;
}

let deps: CoexistDeps | null = null;
let focus: ModeSync = { ...MODE_OFF };
let pres: ModeSync = { ...MODE_OFF };
/** the first state.json after the switch goes on is only taken note of: Keeper does not start a Focus session because Monorail happened to be in one */
let seeded = false;
let peer: CoexistStatus['peer'];
let lastStage: CoexistStatus['lastStage'];
let stageBefore: MonoWindow[] | null = null;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Monorail's local API, quietly: undefined when it is not there. */
async function ask(method: 'GET' | 'POST', route: string, body?: Record<string, unknown>, timeout = 1500): Promise<unknown> {
  if (!mono.isMac()) return undefined;
  try {
    return await mono.apiCall(method, route, body, timeout);
  } catch {
    return undefined;
  }
}

/** Monorail runs and its local API answers. */
export async function active(): Promise<boolean> {
  return (await ask('GET', '/state')) !== undefined;
}

export function initCoexist(d: CoexistDeps) {
  deps = d;
  mono.onRawState((s) => onMonorailState(s));
}

// ---------------------------------------------------------------- Focus and presentation

/** Keeper's Focus session started or ended (the Island). */
export function keeperFocus(on: boolean) {
  const r = keeperModeChanged(focus, on);
  focus = r.next;
  if (r.tellMonorail !== undefined && mono.enabledNow() && mono.prefs().followFocus) void mono.openLink({ kind: 'focus-mode', on: r.tellMonorail });
}

/** Keeper's presentation mode, or any Stage, started or ended: Monorail hides its overlays and notices while it lasts. */
export function keeperPresentation(on: boolean) {
  const r = keeperModeChanged(pres, on);
  pres = r.next;
  if (r.tellMonorail !== undefined && mono.enabledNow() && mono.prefs().followPresentation) void mono.openLink({ kind: 'presentation-mode', on: r.tellMonorail });
}

function onMonorailState(s: MonorailState | undefined) {
  if (!s || !deps) return;
  if (!seeded) {
    seeded = true;
    focus = { ...focus, monorail: s.focusMode };
    if (s.presenting !== undefined) pres = { ...pres, monorail: s.presenting };
    return;
  }
  const p = mono.prefs();
  if (p.followFocus) {
    const r = monorailModeChanged({ ...focus, keeper: deps.focusOn() }, s.focusMode);
    focus = r.next;
    if (r.tellKeeper !== undefined) deps.focus(r.tellKeeper);
  }
  // Only newer Monorail versions publish presentation mode in state.json.
  if (p.followPresentation && s.presenting !== undefined) {
    const r = monorailModeChanged({ ...pres, keeper: deps.stageOn() }, s.presenting);
    pres = r.next;
    if (r.tellKeeper !== undefined) void deps.presentation(r.tellKeeper);
  }
}

// ---------------------------------------------------------------- Keep Awake

/** Before Keeper holds the Mac awake: one hold, not two. Returns a note for the person, if any. */
export async function awakeBefore(): Promise<string | undefined> {
  const a = (await ask('GET', '/awake')) as { on?: boolean; status?: string } | undefined;
  const plan = awakeHandOver(a ? { on: !!a.on, status: a.status } : null);
  if (plan.action === 'end-monorail') {
    const r = (await ask('POST', '/awake', { state: 'off' })) as { on?: boolean } | undefined;
    if (!r || r.on) return awakeHandOver({ on: true, status: 'On · its own trigger' }).note;
  }
  return plan.note;
}

/** After Keeper let go: tell the person if Monorail still holds the Mac awake. */
export async function awakeAfter(): Promise<string | undefined> {
  const a = (await ask('GET', '/awake')) as { on?: boolean; status?: string } | undefined;
  return awakeAfterNote(a ? { on: !!a.on, status: a.status } : null);
}

// ---------------------------------------------------------------- Stage

/** Stage is about to hide other apps: remember where Monorail has every window. */
export async function stageWillHide(): Promise<void> {
  stageBefore = parseWindows(await ask('GET', '/windows', undefined, 2500));
  if (!stageBefore.length) stageBefore = null;
}

/**
 * Stage showed the apps again: wait for Monorail to take their windows back,
 * then put any that landed on another workspace back where they were and ask
 * for one re-tile. A few looks over about four seconds, never more.
 */
export async function stageShown(): Promise<string | undefined> {
  const before = stageBefore;
  stageBefore = null;
  if (!before) return undefined;
  let after: MonoWindow[] = [];
  let r = layoutRepairs(before, after);
  for (let i = 0; i < 5; i++) {
    await wait(i === 0 ? 1200 : 700);
    after = parseWindows(await ask('GET', '/windows', undefined, 2500));
    r = layoutRepairs(before, after);
    if (!r.missing.length) break;
  }
  for (const m of r.moves) await ask('POST', '/move', { id: m.id, workspace: m.workspace });
  if (r.moves.length || r.reordered.length) await ask('POST', '/action', { action: 'retile' });
  const intact = layoutIntact(r);
  const note = intact ? 'Monorail’s layout came back as it was.'
    : [r.moves.length ? `${r.moves.length} window${r.moves.length === 1 ? '' : 's'} put back on ${r.moves.length === 1 ? 'its' : 'their'} workspace` : '', r.reordered.length ? `${r.reordered.length} in another slide (re-tiled)` : '', r.missing.length ? `${r.missing.length} not back yet` : ''].filter(Boolean).join(', ') + '.';
  lastStage = { at: Date.now(), intact, moved: r.moves.length, missing: r.missing.length, reordered: r.reordered.length, note };
  return intact ? undefined : `Monorail: ${note}`;
}

/** Any Stage starting or ending: Monorail's overlays and notices stay out of the picture. */
export function stageChanged(on: boolean) {
  keeperPresentation(on);
}

// ---------------------------------------------------------------- computer use

const norm = (s: string) => s.trim().toLowerCase();

/** Brings a window forward through Monorail (it scrolls the strip to it), so a tiled window is fully on screen. False when Monorail does not know it. */
export async function focusThroughMonorail(appName: string, title: string): Promise<boolean> {
  const list = parseWindows(await ask('GET', '/windows'));
  const hit = list.find((w) => norm(w.app) === norm(appName) && norm(w.title) === norm(title))
    ?? list.find((w) => norm(w.app) === norm(appName) && !!title && norm(w.title).includes(norm(title)));
  if (!hit) return false;
  return (await ask('POST', '/focus', { id: hit.id })) !== undefined;
}

/** Where Monorail keeps each window ("app|title" → "workspace 2, slide 3"), for the AI's window list. */
export async function placesByWindow(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const w of parseWindows(await ask('GET', '/windows'))) {
    out.set(`${norm(w.app)}|${norm(w.title)}`, w.floating || w.workspace === undefined ? 'floating in Monorail' : `Monorail workspace ${w.workspace}, slide ${w.slide ?? '?'}`);
  }
  return out;
}

// ---------------------------------------------------------------- the handshake

/** Keeper says who it is (newer Monorail versions keep it) and asks Monorail the same. */
export async function hello(): Promise<CoexistStatus['peer']> {
  const me = keeperHello({ version: app.getVersion(), pid: process.pid, focus: !!deps?.focusOn(), awake: !!deps?.awakeOn(), stage: !!deps?.stageOn() });
  await ask('POST', '/peer', me as never);
  const h = parseHello(await ask('GET', '/hello'));
  peer = h ? { app: h.app, version: h.version } : undefined;
  return peer;
}

/** What Keeper tells Monorail (and anything else on its own channel) about itself. */
export function helloPayload() {
  return keeperHello({ version: app.getVersion(), pid: process.pid, focus: !!deps?.focusOn(), awake: !!deps?.awakeOn(), stage: !!deps?.stageOn() });
}

export async function coexistStatus(): Promise<CoexistStatus> {
  const on = await active();
  if (on && !peer) await hello();
  const ms = mono.monorailSettingsNow();
  return {
    active: on,
    peer,
    focus: { ...focus, keeper: !!deps?.focusOn() },
    presentation: { ...pres, keeper: !!deps?.stageOn() },
    lastStage,
    loopsStopped: mono.readLoopsStopped(),
    desktop: desktopOverlap(ms),
    updatesBy: ms.checkForUpdates === false ? 'keeper' : 'monorail',
  };
}

/** For tests: back to the start. */
export function resetCoexist() {
  focus = { ...MODE_OFF };
  pres = { ...MODE_OFF };
  seeded = false;
  peer = undefined;
  lastStage = undefined;
  stageBefore = null;
}
