// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// An AI using this computer: the Assistant (with any AI the person set up)
// and agents connected over MCP (Claude Code, Codex, Cursor…) get one
// "computer" tool. Every call goes through here: permission, a per-session
// "may it?" prompt, the blocked-apps check, the secrets check, a rate limit,
// then the pointer and keyboard (the remote-desktop injector) or the system
// (windows, apps, accessibility), and a line in the agents' activity log with
// a small picture of what the AI saw.
//
// While a session runs the Island shows "<AI> is using this computer" with
// Stop, and a global shortcut (⌃⌥⌘. on a Mac, Ctrl+Alt+Shift+. elsewhere)
// stops every session at once.

import { app, desktopCapturer, globalShortcut, screen, shell, type Display } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  blockedBy, changes, describeComputer, findNode, fromToolInput, genericComputerTool, anthropicToolset, parseCombo, RateLimit, secretIn, sessionExpired,
  shotSize, toNormalized, toShot, uiTreeText, type ComputerAction, type ComputerSession, type UiNode,
} from '../../core/computer';
import type { ToolSpec } from '../../core/brain/providers';
import type { HostDisplay, InputEvent, Mods } from '../../core/screen/types';
import { agentSettings, recordAgentActivity, requestApproval } from './agents';
import { focusWindow, frontBounds, frontWindow, listWindows, openApp, pressElement, setAccessibilityEngine, setElementValue, uiTree } from './computer-os';
import { MaybeDelivered } from './agent-desktop';
import { injector } from './screen/injector';
import { axInShot, centre, desktopMarksText, marksFromAx, marksFromOcr, type Mark } from '../../core/cu/marks';
import { fromGeminiCall, geminiBlocked, geminiNeedsConfirmation, openAiActions, type OpenAiNativeArgs, type OpenAiSafetyCheck } from '../../core/cu/native';

export interface ComputerDeps {
  broadcast: (channel: string, ...args: unknown[]) => void;
  alert?: (title: string, detail?: string) => void;
}

export interface ComputerResult {
  text: string;
  isError?: boolean;
  images?: { mime: string; data: string }[];
}

export interface ComputerState {
  sessions: { id: string; client: string; since: number; actions: number }[];
  stopShortcut: string;
}

let deps: ComputerDeps | null = null;
const sessions = new Map<string, ComputerSession>();
const limiter = new RateLimit(90);
let lastTree: UiNode | undefined;
/** the numbered marks last shown to the AI, and the accessibility ids behind them */
let lastMarks: { marks: Mark[]; ids: Map<number, string> } | undefined;
/** actions built inside Keeper (from an AI service's own computer tool), never from a caller's arguments */
const internal = new WeakSet<object>();
/** reads lines of text off a screenshot; set by cu.ts (Tesseract or the system's recognition) */
let readScreenText: ((png: Buffer) => Promise<{ text: string; x0: number; y0: number; x1: number; y1: number; confidence?: number }[]>) | null = null;
export function setScreenTextReader(fn: typeof readScreenText) {
  readScreenText = fn;
}
/** AIs the person stopped: refused until the person asks again (a new Assistant question) or two minutes pass */
const stopped = new Map<string, number>();
const STOP_HOLD_MS = 120_000;
let shortcutOn = false;
/** the screenshot size the AI is working in, per session (coordinates are in it) */
const shots = new Map<string, { width: number; height: number; displayId: number }>();

export const STOP_SHORTCUT = process.platform === 'darwin' ? 'Control+Alt+Command+.' : 'Control+Alt+Shift+.';
const STOP_LABEL = process.platform === 'darwin' ? '⌃⌥⌘.' : 'Ctrl+Alt+Shift+.';

export function initComputer(d: ComputerDeps) {
  deps = d;
  app.on('will-quit', () => stopAll('Keeper is quitting'));
}

export function computerState(): ComputerState {
  return { sessions: [...sessions.values()].map((s) => ({ id: s.id, client: s.client, since: s.started, actions: s.actions })), stopShortcut: STOP_LABEL };
}

// Keeper's browser agent and virtual desktops share the Stop shortcut and the Stop button.
const stopListeners = new Set<(reason: string) => void>();
let extraActive: () => boolean = () => false;
export function onComputerStop(fn: (reason: string) => void): () => void {
  stopListeners.add(fn);
  return () => stopListeners.delete(fn);
}
/** Other kinds of computer use tell this module whether they are running (for the Stop shortcut). */
export function setExtraActive(fn: () => boolean) {
  extraActive = fn;
}
export function refreshComputerShortcut() {
  changed();
}

function changed() {
  deps?.broadcast('computer-state', computerState());
  const active = sessions.size > 0 || extraActive();
  if (active && !shortcutOn) {
    try {
      shortcutOn = globalShortcut.register(STOP_SHORTCUT, () => stopAll('stopped with the shortcut'));
    } catch {
      shortcutOn = false;
    }
  } else if (!active && shortcutOn) {
    globalShortcut.unregister(STOP_SHORTCUT);
    shortcutOn = false;
  }
}

/** Ends every session now (Stop in the Island, the shortcut, quitting). The AI's next step is refused. */
export function stopAll(reason = 'stopped by the person') {
  for (const fn of stopListeners) fn(reason);
  if (!sessions.size) {
    changed();
    return;
  }
  for (const s of sessions.values()) stopped.set(s.client, Date.now());
  for (const s of sessions.values()) recordAgentActivity({ at: Date.now(), client: s.client, action: 'computer', description: `stopped using the computer (${reason})`, status: 'done' });
  sessions.clear();
  shots.clear();
  injector().stop();
  deps?.broadcast('computer-stopped', reason);
  changed();
}

// ---------------------------------------------------------------- the screen

function displayFor(id?: number): Display {
  const all = screen.getAllDisplays();
  return (id !== undefined && all.find((d) => d.id === id)) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

const hostOf = (d: Display): HostDisplay => ({ id: String(d.id), label: d.label || 'Screen', x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, scale: d.scaleFactor, primary: d.id === screen.getPrimaryDisplay().id });
const shotDisplay = (d: Display) => ({ id: String(d.id), x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, scale: d.scaleFactor });

async function capture(d: Display, size: { width: number; height: number }): Promise<Electron.NativeImage> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0];
  if (!src || src.thumbnail.isEmpty()) {
    throw new Error(process.platform === 'darwin' ? 'Keeper cannot see the screen yet: allow it in System Settings → Privacy & Security → Screen Recording.' : 'The screen could not be captured here.');
  }
  return src.thumbnail;
}

async function screenshotFor(sessionId: string): Promise<{ text: string; image: { mime: string; data: string }; small: Buffer }> {
  const prev = shots.get(sessionId);
  const d = displayFor(prev?.displayId);
  const size = shotSize(shotDisplay(d));
  const img = (await capture(d, size)).resize({ width: size.width, height: size.height, quality: 'good' });
  shots.set(sessionId, { width: size.width, height: size.height, displayId: d.id });
  const png = img.toPNG();
  const small = img.resize({ width: 320 }).toJPEG(60);
  return { text: `Screenshot ${size.width}×${size.height} of “${d.label || 'the screen'}”. Coordinates are pixels in this picture.`, image: { mime: 'image/png', data: png.toString('base64') }, small };
}

async function zoom(sessionId: string, region: [number, number, number, number]): Promise<{ mime: string; data: string }> {
  const s = shots.get(sessionId);
  if (!s) throw new Error('Take a screenshot first');
  const d = displayFor(s.displayId);
  const full = { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) };
  const img = await capture(d, full);
  const k = img.getSize().width / s.width;
  const [x0, y0, x1, y1] = region;
  const rect = { x: Math.max(0, Math.round(Math.min(x0, x1) * k)), y: Math.max(0, Math.round(Math.min(y0, y1) * k)), width: Math.max(8, Math.round(Math.abs(x1 - x0) * k)), height: Math.max(8, Math.round(Math.abs(y1 - y0) * k)) };
  const crop = img.crop(rect);
  const long = Math.max(rect.width, rect.height);
  const out = long > 1366 ? crop.resize({ width: Math.round((rect.width * 1366) / long) }) : crop;
  return { mime: 'image/png', data: out.toPNG().toString('base64') };
}

// ---------------------------------------------------------------- pointer and keyboard

function modKeys(mods: string[] | undefined, down: boolean): InputEvent[] {
  const out: InputEvent[] = [];
  for (const m of mods ?? []) {
    const c = parseCombo(m);
    out.push({ t: 'key', code: c.code, key: c.key, down });
  }
  return out;
}

function comboEvents(keys: string): InputEvent[] {
  const c = parseCombo(keys);
  const order: [keyof Mods, string][] = [['ctrl', 'ControlLeft'], ['alt', 'AltLeft'], ['shift', 'ShiftLeft'], ['meta', 'MetaLeft']];
  const held = order.filter(([k]) => c.mods[k]);
  return [
    ...held.map(([, code]): InputEvent => ({ t: 'key', code, down: true })),
    { t: 'key', code: c.code, key: c.key, down: true, mods: c.mods },
    { t: 'key', code: c.code, key: c.key, down: false, mods: c.mods },
    ...held.reverse().map(([, code]): InputEvent => ({ t: 'key', code, down: false })),
  ];
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const btn = (b: 'left' | 'right' | 'middle'): 0 | 1 | 2 => (b === 'left' ? 0 : b === 'middle' ? 1 : 2);

async function pointer(sessionId: string, a: ComputerAction): Promise<string> {
  const s = shots.get(sessionId);
  if (!s && a.type !== 'type' && a.type !== 'key' && a.type !== 'hold_key') throw new Error('Take a screenshot first, so coordinates refer to what you see');
  const d = displayFor(s?.displayId);
  const host = hostOf(d);
  const at = (x: number, y: number) => toNormalized(s!, x, y);
  const send = (ev: InputEvent[]) => injector().send(ev, host);
  const here = () => {
    const p = screen.getCursorScreenPoint();
    return { x: (p.x - d.bounds.x) / d.bounds.width, y: (p.y - d.bounds.y) / d.bounds.height };
  };
  switch (a.type) {
    case 'click': {
      const p = a.x !== undefined && a.y !== undefined ? at(a.x, a.y) : here();
      const ev: InputEvent[] = [...modKeys(a.mods, true), { t: 'move', ...p }];
      for (let i = 0; i < a.count; i++) ev.push({ t: 'down', ...p, button: btn(a.button) }, { t: 'up', ...p, button: btn(a.button) });
      ev.push(...modKeys(a.mods, false));
      send(ev);
      break;
    }
    case 'move': send([{ t: 'move', ...at(a.x, a.y) }]); break;
    case 'drag': {
      const pts = a.path.map(([x, y]) => at(x, y));
      const ev: InputEvent[] = [...modKeys(a.mods, true), { t: 'move', ...pts[0] }, { t: 'down', ...pts[0], button: 0 }];
      // A few steps between the ends, so apps see a real drag.
      for (let i = 1; i < pts.length; i++) {
        const [p0, p1] = [pts[i - 1], pts[i]];
        for (let k = 1; k <= 6; k++) ev.push({ t: 'move', x: p0.x + ((p1.x - p0.x) * k) / 6, y: p0.y + ((p1.y - p0.y) * k) / 6 });
      }
      ev.push({ t: 'up', ...pts[pts.length - 1], button: 0 }, ...modKeys(a.mods, false));
      send(ev);
      break;
    }
    case 'mouse_down': case 'mouse_up': {
      const p = here();
      send([{ t: a.type === 'mouse_down' ? 'down' : 'up', ...p, button: btn(a.button) }]);
      break;
    }
    case 'scroll': {
      const p = a.x !== undefined && a.y !== undefined ? at(a.x, a.y) : here();
      send([...modKeys(a.mods, true), { t: 'move', ...p }, { t: 'wheel', ...p, dx: a.dx, dy: a.dy }, ...modKeys(a.mods, false)]);
      break;
    }
    case 'type': send([{ t: 'text', text: a.text }]); break;
    case 'key': {
      const ev: InputEvent[] = [];
      for (let i = 0; i < (a.repeat ?? 1); i++) ev.push(...comboEvents(a.keys));
      send(ev);
      break;
    }
    case 'hold_key': {
      const all = comboEvents(a.keys);
      const half = Math.ceil(all.length / 2);
      send(all.slice(0, half));
      await wait(a.seconds * 1000);
      send(all.slice(half));
      break;
    }
    default: break;
  }
  return describeComputer(a);
}

// ---------------------------------------------------------------- one call

const LOOKS_ONLY = new Set(['wait', 'cursor_position', 'list_windows']);

/**
 * Runs one computer action for an AI. `client` names it for the prompt and
 * the log (e.g. "Claude in Keeper's Assistant", "Claude Code").
 */
export async function runComputer(client: string, input: Record<string, unknown>, o: { screenshotAfter?: boolean } = {}): Promise<ComputerResult> {
  if (Array.isArray(input.openai_actions) || typeof input.gemini_action === 'string') return runNative(client, input);
  const policy = agentSettings().computer;
  limiter.set(policy.maxActionsPerMinute);
  setAccessibilityEngine(policy.accessibilityEngine);
  let action: ComputerAction;
  try {
    action = internal.has(input) && input.__action ? (input.__action as ComputerAction) : fromToolInput(String(input.action ?? ''), input);
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
  const log = (status: 'done' | 'denied' | 'refused' | 'error' | 'off', detail?: string, shot?: string) =>
    recordAgentActivity({ at: Date.now(), client, action: 'computer', description: describeComputer(action), status, detail, shot });

  if (policy.permission === 'off') {
    log('off');
    return { text: 'The person has not allowed AIs to use this computer (Agents → What agents may do → Use this computer).', isError: true };
  }

  const stoppedAt = stopped.get(client);
  if (stoppedAt && Date.now() - stoppedAt < STOP_HOLD_MS) {
    return { text: 'The person stopped you from using the computer. Stop now and tell them where you got to.', isError: true };
  }
  stopped.delete(client);

  // One session per AI; it ends after a while without actions, after the time limit, or on Stop.
  let s = [...sessions.values()].find((x) => x.client === client);
  if (s) {
    const why = sessionExpired(s, policy);
    if (why) {
      sessions.delete(s.id);
      shots.delete(s.id);
      recordAgentActivity({ at: Date.now(), client, action: 'computer', description: `stopped using the computer (${why})`, status: 'done' });
      s = undefined;
      changed();
    }
  }
  if (!s) {
    if (policy.permission === 'ask') {
      const d = await requestApproval(client, 'computer', `use this computer: see the screen, move the pointer, click and type, until you press Stop (${STOP_LABEL})`, true);
      if (d === 'deny') {
        log('denied');
        return { text: 'The person declined. Do not try to use the computer again unless they ask.', isError: true };
      }
    }
    s = { id: randomUUID(), client, started: Date.now(), last: Date.now(), actions: 0 };
    sessions.set(s.id, s);
    deps?.alert?.(`${client} is using this computer`, `Press ${STOP_LABEL} or Stop in the Island to end it`);
    changed();
  }
  const session = s;

  if (!limiter.take()) {
    log('error', 'too many actions per minute');
    return { text: `Slow down: at most ${policy.maxActionsPerMinute} actions a minute. Wait a moment and try again.`, isError: true };
  }

  // Off-limits apps and private-looking windows are never looked at or touched.
  if (!LOOKS_ONLY.has(action.type)) {
    const front = await frontWindow();
    const why = blockedBy(policy, front);
    if (why) {
      log('refused', why);
      return { text: `Not allowed: ${why}. Ask the person to switch to another app, or do this part themselves.`, isError: true };
    }
  }
  if (action.type === 'type' || action.type === 'set_value') {
    const secret = secretIn(action.text);
    if (secret) {
      log('refused', `would have typed a ${secret}`);
      return { text: `Not allowed: that text looks like a ${secret}. Passwords and keys are never typed by an AI; ask the person to type it.`, isError: true };
    }
  }

  try {
    let text = '';
    let images: ComputerResult['images'];
    let small: Buffer | undefined;
    switch (action.type) {
      case 'screenshot': {
        const r = await screenshotFor(session.id);
        text = r.text;
        images = [r.image];
        small = r.small;
        break;
      }
      case 'zoom': images = [await zoom(session.id, action.region)]; text = 'Closer look at that region.'; break;
      case 'wait': await wait(action.seconds * 1000); text = `Waited ${action.seconds} s`; break;
      case 'cursor_position': {
        const sh = shots.get(session.id);
        const d = displayFor(sh?.displayId);
        const p = screen.getCursorScreenPoint();
        const at = sh ? toShot(sh, shotDisplay(d), p.x, p.y) : p;
        text = `The pointer is at ${at.x},${at.y}${sh ? ' (screenshot pixels)' : ' (screen points; take a screenshot first)'}.`;
        break;
      }
      case 'open': {
        const t = action.target;
        if (/^(https?|mailto):/i.test(t)) { await shell.openExternal(t); text = `Opened ${t}`; }
        else if (path.isAbsolute(t) || t.startsWith('~')) {
          const p = t.startsWith('~') ? path.join(app.getPath('home'), t.slice(1)) : t;
          if (!existsSync(p)) throw new Error(`${t} does not exist`);
          const err = await shell.openPath(p);
          if (err) throw new Error(err);
          text = `Opened ${t}`;
        } else {
          const why = blockedBy(policy, { app: t });
          if (why) throw new Error(`Not allowed: ${why}`);
          text = await openApp(t);
        }
        break;
      }
      case 'list_windows': {
        const ws = (await listWindows()).filter((w) => !blockedBy(policy, { app: w.app, title: w.title }));
        // With Monorail arranging windows, say where each one is on its strip (a tiled window may be off to the side).
        const places = process.platform === 'darwin' ? await (await import('./ashforde/coexist')).placesByWindow().catch(() => new Map<string, string>()) : new Map<string, string>();
        const where = (w: { app: string; title: string }) => places.get(`${w.app.trim().toLowerCase()}|${w.title.trim().toLowerCase()}`);
        text = ws.length ? ws.map((w) => `${w.id}  ${w.app} — ${w.title}${where(w) ? `  (${where(w)})` : ''}`).join('\n') : 'No windows Keeper may show.';
        if (places.size) text += '\nMonorail arranges these windows: bring one forward with focus_window rather than dragging it; a drag swaps tiles.';
        break;
      }
      case 'focus_window': {
        const w = (await listWindows()).find((x) => x.id === action.id);
        if (w) { const why = blockedBy(policy, { app: w.app, title: w.title }); if (why) throw new Error(`Not allowed: ${why}`); }
        // Monorail scrolls its strip to the window, so it is fully on screen; raising it alone may leave it parked at the edge.
        const viaMonorail = !!w && process.platform === 'darwin' && (await (await import('./ashforde/coexist')).focusThroughMonorail(w.app, w.title).catch(() => false));
        if (!viaMonorail) await focusWindow(action.id);
        text = viaMonorail ? 'Brought it to the front (Monorail scrolled to it).' : 'Brought it to the front.';
        break;
      }
      case 'ui_tree': {
        lastTree = await uiTree(action.depth);
        const sh = shots.get(session.id);
        const d = displayFor(sh?.displayId);
        text = uiTreeText(lastTree, (x, y) => (sh ? toShot(sh, shotDisplay(d), x, y) : { x: Math.round(x), y: Math.round(y) }));
        break;
      }
      case 'click_element': {
        const n = findNode(lastTree, action.id);
        if (!n) throw new Error('Unknown control: call ui_tree first and use one of its ids');
        if (!(await pressElement(action.id))) {
          // No accessibility action: click its middle instead.
          if (n.x === undefined || n.y === undefined || n.width === undefined || n.height === undefined) throw new Error('That control cannot be pressed');
          const sh = shots.get(session.id) ?? (await screenshotFor(session.id), shots.get(session.id)!);
          const d = displayFor(sh.displayId);
          const c = toShot(sh, shotDisplay(d), n.x + n.width / 2, n.y + n.height / 2);
          await pointer(session.id, { type: 'click', button: 'left', count: 1, x: c.x, y: c.y });
        }
        text = `Pressed ${n.role}${n.name ? ` “${n.name}”` : ''}.`;
        break;
      }
      case 'set_value': {
        const n = findNode(lastTree, action.id);
        if (!n) throw new Error('Unknown control: call ui_tree first and use one of its ids');
        if (!(await setElementValue(action.id, action.text))) throw new Error('That control does not take a value this way: click it and use type instead');
        text = `Filled ${n.role}${n.name ? ` “${n.name}”` : ''}.`;
        break;
      }
      case 'marks': {
        if (!shots.get(session.id)) await screenshotFor(session.id);
        const sh = shots.get(session.id)!;
        const d = displayFor(sh.displayId);
        lastTree = await uiTree(10).catch(() => undefined);
        let found = marksFromAx(axInShot(lastTree, (x, y) => toShot(sh, shotDisplay(d), x, y)), sh);
        let source = 'from the app’s accessibility information';
        if (found.marks.length < 3 && readScreenText) {
          // Nothing (or next to nothing) from accessibility: read the words in the front window off the screen.
          // Full resolution, cropped to the window and enlarged, so small interface text reads well.
          const scale = d.scaleFactor || 1;
          const full = await capture(d, { width: Math.round(d.bounds.width * scale), height: Math.round(d.bounds.height * scale) });
          const fw = full.getSize();
          const k = fw.width / d.bounds.width;
          const b = (await frontBounds()) ?? (lastTree?.width ? { x: lastTree.x ?? 0, y: lastTree.y ?? 0, width: lastTree.width, height: lastTree.height ?? 0 } : undefined);
          const rx = b ? Math.max(0, Math.round((b.x - d.bounds.x) * k)) : 0;
          const ry = b ? Math.max(0, Math.round((b.y - d.bounds.y) * k)) : 0;
          const rect = b ? { x: rx, y: ry, width: Math.max(8, Math.min(fw.width - rx, Math.round(b.width * k))), height: Math.max(8, Math.min(fw.height - ry, Math.round(b.height * k))) } : { x: 0, y: 0, width: fw.width, height: fw.height };
          const crop = full.crop(rect);
          const up = rect.width < 1800 ? 2 : 1;
          const img = up > 1 ? crop.resize({ width: rect.width * up, height: rect.height * up, quality: 'best' }) : crop;
          const lines = await readScreenText(img.toPNG()).catch(() => []);
          // Picture pixels → screen points → screenshot pixels.
          const toS = (x: number, y: number) => toShot(sh, shotDisplay(d), d.bounds.x + (rect.x + x / up) / k, d.bounds.y + (rect.y + y / up) / k);
          const mapped = lines.map((l) => {
            const a = toS(l.x0, l.y0);
            const z = toS(l.x1, l.y1);
            return { ...l, x0: a.x, y0: a.y, x1: z.x, y1: z.y };
          });
          found = { marks: marksFromOcr(mapped, sh), ids: new Map() };
          source = 'read off the screen';
        }
        lastMarks = found;
        text = found.marks.length
          ? `${found.marks.length} things to act on (${source}). Click one with click_mark and its number; @x,y is its centre in screenshot pixels.\n${desktopMarksText(found.marks)}`
          : 'Nothing to number in the front window. Take a screenshot and click by position instead.';
        break;
      }
      case 'click_mark': {
        const m = lastMarks?.marks.find((x) => x.ref === action.ref);
        if (!m) throw new Error('Unknown mark: call marks first and use one of its numbers');
        const id = lastMarks!.ids.get(m.ref);
        // A press that may already have landed is not followed by a click (it would press twice).
        if (!(id && (await pressElement(id).catch((e) => { if (e instanceof MaybeDelivered) throw e; return false; })))) {
          const c = centre(m.box);
          await pointer(session.id, { type: 'click', button: 'left', count: 1, x: c.x, y: c.y });
        }
        text = `Clicked [${m.ref}] ${m.role}${m.name ? ` “${m.name}”` : ''}.`;
        break;
      }
      default:
        text = await pointer(session.id, action);
    }
    session.actions++;
    session.last = Date.now();
    changed();
    // After anything that changes the screen, the AI gets to see the result.
    if (changes(action) && o.screenshotAfter !== false && action.type !== 'open') {
      await wait(450);
      const r = await screenshotFor(session.id).catch(() => null);
      if (r) { images = [r.image]; small = r.small; text += `\n${r.text}`; }
    }
    let shot: string | undefined;
    if (small) {
      shot = path.join(app.getPath('userData'), 'agents', 'computer', `${Date.now()}-${session.actions}.jpg`);
      await fsp.mkdir(path.dirname(shot), { recursive: true });
      await fsp.writeFile(shot, small).catch(() => (shot = undefined));
    }
    log('done', undefined, shot);
    return { text, images };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('error', msg);
    return { text: msg, isError: true };
  }
}

/**
 * A call from an AI service's own computer tool (OpenAI's computer_call, a
 * Gemini computer-use function): its steps run one by one under the same
 * rules, and the answer is the screen afterwards. A step the service itself
 * flags (OpenAI's pending safety checks, Gemini's require_confirmation) waits
 * for the person; one it blocks never runs.
 */
async function runNative(client: string, input: Record<string, unknown>): Promise<ComputerResult> {
  const gemini = typeof input.gemini_action === 'string';
  const name = gemini ? String(input.gemini_action) : 'computer_call';
  const note = (status: 'denied' | 'refused', detail: string) => recordAgentActivity({ at: Date.now(), client, action: 'computer', description: `${name.replace(/_/g, ' ')} (flagged by the AI service)`, status, detail });
  const blocked = gemini ? geminiBlocked(input) : undefined;
  if (blocked) {
    note('refused', blocked.explanation ?? 'blocked by the AI service');
    return { text: `Not allowed: the AI service blocked this step (${blocked.explanation ?? 'no reason given'}).`, isError: true };
  }
  const flagged = gemini ? geminiNeedsConfirmation(input)?.explanation : (input.pending_safety_checks as OpenAiSafetyCheck[] | undefined)?.map((c) => c.message || c.code || 'safety check').join('; ');
  if (flagged) {
    const d = await requestApproval(client, 'computer', `go ahead with a step its AI service asked to confirm: ${flagged}`, true);
    if (d === 'deny') {
      note('denied', flagged);
      return { text: 'The person declined this step. Do not do it; ask them what to do instead.', isError: true };
    }
  }
  let actions: ComputerAction[];
  try {
    if (gemini) {
      // Gemini points on a 0–999 grid over the screenshot it saw.
      let sh = [...sessions.values()].find((x) => x.client === client);
      if (!sh || !shots.get(sh.id)) {
        const first = await runComputer(client, { action: 'screenshot' });
        if (first.isError) return first;
        sh = [...sessions.values()].find((x) => x.client === client);
      }
      actions = fromGeminiCall(name, input, shots.get(sh!.id)!);
    } else actions = openAiActions(input as unknown as OpenAiNativeArgs);
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
  const texts: string[] = [];
  let images: ComputerResult['images'];
  for (const a of actions) {
    const step = { __action: a };
    internal.add(step);
    const r = await runComputer(client, step, { screenshotAfter: false });
    texts.push(r.text);
    if (r.images) images = r.images;
    if (r.isError) return { text: texts.join('\n'), isError: true };
  }
  // The answer is always the screen after the batch.
  if (!actions.length || actions[actions.length - 1].type !== 'screenshot') {
    await wait(actions.length ? 450 : 0);
    const shot = await runComputer(client, { action: 'screenshot' });
    if (shot.isError) return { text: [...texts, shot.text].join('\n'), isError: true };
    images = shot.images;
  }
  return { text: texts.join('\n') || 'Done.', images };
}

/** A new request from the person lifts an earlier Stop for that AI. */
export function clearStop(client: string) {
  stopped.delete(client);
}

/** Removes activity pictures older than two weeks. */
export async function pruneComputerShots(days = 14) {
  const dir = path.join(app.getPath('userData'), 'agents', 'computer');
  const cutoff = Date.now() - days * 86_400_000;
  for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
    const t = Number(f.split('-')[0]);
    if (Number.isFinite(t) && t < cutoff) await fsp.rm(path.join(dir, f), { force: true });
  }
}

// ---------------------------------------------------------------- the tool, for the Assistant and for MCP

/**
 * The tool as the Assistant offers it. With Claude 5.5 and later the
 * provider sends Claude's own computer-use toolset instead and maps its calls
 * back to this tool.
 */
export function computerToolSpec(): ToolSpec {
  const d = displayFor();
  const size = shotSize(shotDisplay(d));
  const g = genericComputerTool(size.width, size.height);
  // OpenAI's computer tool and Gemini's computer use stand in for it on models that have them.
  return { ...g, native: { anthropic: anthropicToolset(), anthropicToolsetName: 'computer', openai: { width: size.width, height: size.height }, gemini: 'desktop' } };
}

/** Claude's toolset has no app/window/accessibility actions; these come as a second tool beside it. */
export function computerAppsToolSpec(): ToolSpec {
  const g = genericComputerTool(0, 0, ['open', 'list_windows', 'focus_window', 'ui_tree', 'click_element', 'set_value', 'marks', 'click_mark']);
  return { ...g, name: 'computer_apps', description: 'Open apps, web pages and files; list and switch windows; number what can be clicked in the front window (marks, from accessibility or read off the screen) and click one by number (click_mark); read the controls (ui_tree), press one by id (click_element) or fill a field by id (set_value). Same rules as the computer tool.' };
}

export const COMPUTER_INSTRUCTIONS =
  `You can use this computer with the computer tool. Take a screenshot first, act, and check the result. Prefer marks and click_mark (numbered controls) over guessing pixels. ` +
  `Some apps are off limits and passwords are never typed: when refused, tell the person what to do instead. The person can stop you at any time; when a call says you were stopped, stop and summarise.`;

// ---------------------------------------------------------------- wiring

/** Keeper's browser, private desktops and the task plan join the Assistant's computer tools (electron/services/cu.ts). */
interface MoreTools {
  specs: () => ToolSpec[];
  instructions: string;
  handles: (name: string) => boolean;
  run: (client: string, name: string, args: Record<string, unknown>) => Promise<ComputerResult>;
}
let more: MoreTools | null = null;
export function setMoreComputerTools(m: MoreTools) {
  more = m;
}

/** Connects the computer tool to the Assistant and to agents over MCP (called once by main.ts). */
export async function wireComputer(d: ComputerDeps) {
  initComputer(d);
  const { setComputerTools } = await import('./brain');
  const { setComputerHook } = await import('./agents');
  const ASSISTANT = 'Keeper’s Assistant';
  setComputerTools(() => {
    if (agentSettings().computer.permission === 'off') return undefined;
    // The person asked again: an earlier Stop no longer holds.
    clearStop(ASSISTANT);
    return {
      specs: [computerToolSpec(), computerAppsToolSpec(), ...(more?.specs() ?? [])],
      instructions: more ? `${COMPUTER_INSTRUCTIONS} ${more.instructions}` : COMPUTER_INSTRUCTIONS,
      run: async (call) => {
        if (more?.handles(call.name)) {
          const r = await more.run(ASSISTANT, call.name, call.args);
          if (r.isError) throw new Error(r.text);
          const a = String(call.args.action ?? '');
          return { content: r.text, summary: `${call.name === 'browser' ? 'browser' : call.name === 'task_plan' ? 'plan' : 'private desktop'}: ${a.replace(/_/g, ' ')}`, images: r.images };
        }
        const r = await runComputer(ASSISTANT, call.args);
        if (r.isError) throw new Error(r.text);
        const a = String(call.args.action ?? '');
        return { content: r.text, summary: a === 'screenshot' ? 'looked at the screen' : a.replace(/_/g, ' '), images: r.images };
      },
    };
  });
  setComputerHook({
    spec: () => {
      const disp = displayFor();
      const size = shotSize(shotDisplay(disp));
      return genericComputerTool(size.width, size.height);
    },
    run: (client, args) => runComputer(client, args),
  });
  void pruneComputerShots();
}
