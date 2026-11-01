// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Letting an AI use this computer: look at the screen, move the pointer,
// click, type, open apps and read what is in the front window. Pure, so the
// rules are tested; electron/services/computer.ts carries them out.
//
// Safety, in the order it is checked:
//   - off by default; the person chooses Off / Ask (per session) / Allow;
//   - while a session runs the Island says "AI is using this computer" with
//     Stop, and a global shortcut stops it from anywhere;
//   - apps on the blocked list (password managers, keychains, terminals, and
//     windows whose title looks like banking) are never looked at or touched;
//   - text that looks like a secret (keys, passwords, card numbers) is never typed;
//   - a limit on actions per minute and on session length;
//   - every action is written to the agents' activity log, with a small
//     screenshot of what the AI saw.
//
// Three ways to describe the tool, one action vocabulary underneath:
//   - Anthropic's computer-use toolset (computer_toolset_20260801: one
//     tool_use block per action, e.g. "left_click" with coordinate [x, y]);
//   - OpenAI's computer tool in the Responses API ({ type: "computer" },
//     answered by computer_call items with a batch of actions);
//   - a plain function tool "computer" with an action field, for every other
//     AI that can call functions (Grok, Gemini, Mistral, local models…) and
//     for MCP clients.

import { redact } from './brain/redact';
import type { Mods } from './screen/types';

// ---------------------------------------------------------------- the vocabulary

export type Button = 'left' | 'right' | 'middle';

export type ComputerAction =
  | { type: 'screenshot' }
  | { type: 'zoom'; region: [number, number, number, number] }
  | { type: 'click'; x?: number; y?: number; button: Button; count: 1 | 2 | 3; mods?: string[] }
  | { type: 'move'; x: number; y: number }
  | { type: 'drag'; path: [number, number][]; mods?: string[] }
  | { type: 'mouse_down' | 'mouse_up'; button: Button }
  | { type: 'scroll'; x?: number; y?: number; dx: number; dy: number; mods?: string[] }
  | { type: 'type'; text: string }
  | { type: 'key'; keys: string; repeat?: number }
  | { type: 'hold_key'; keys: string; seconds: number }
  | { type: 'wait'; seconds: number }
  | { type: 'cursor_position' }
  | { type: 'open'; target: string }
  | { type: 'list_windows' }
  | { type: 'focus_window'; id: string }
  | { type: 'ui_tree'; depth?: number }
  | { type: 'click_element'; id: string }
  /** numbered marks over what can be clicked in the front window (accessibility, or read from the screen) */
  | { type: 'marks' }
  | { type: 'click_mark'; ref: number };

/** Changes something on the screen (as opposed to only looking). */
export function changes(a: ComputerAction): boolean {
  return !['screenshot', 'zoom', 'wait', 'cursor_position', 'list_windows', 'ui_tree', 'marks'].includes(a.type);
}

/** One line for the activity log. */
export function describeComputer(a: ComputerAction): string {
  const at = (x?: number, y?: number) => (x === undefined || y === undefined ? '' : ` at ${Math.round(x)},${Math.round(y)}`);
  switch (a.type) {
    case 'screenshot': return 'looked at the screen';
    case 'zoom': return `looked closely at ${a.region.map(Math.round).join(',')}`;
    case 'click': return `${a.count === 3 ? 'triple-' : a.count === 2 ? 'double-' : ''}${a.button === 'left' ? '' : a.button + '-'}clicked${at(a.x, a.y)}${a.mods?.length ? ` holding ${a.mods.join('+')}` : ''}`;
    case 'move': return `moved the pointer${at(a.x, a.y)}`;
    case 'drag': return `dragged from ${a.path[0]?.map(Math.round).join(',')} to ${a.path[a.path.length - 1]?.map(Math.round).join(',')}`;
    case 'mouse_down': return `pressed the ${a.button} button`;
    case 'mouse_up': return `released the ${a.button} button`;
    case 'scroll': return `scrolled ${a.dy ? (a.dy > 0 ? 'down' : 'up') : a.dx > 0 ? 'right' : 'left'}${at(a.x, a.y)}`;
    case 'type': return `typed ${a.text.length} character${a.text.length === 1 ? '' : 's'}`;
    case 'key': return `pressed ${a.keys}${a.repeat && a.repeat > 1 ? ` ×${a.repeat}` : ''}`;
    case 'hold_key': return `held ${a.keys} for ${a.seconds} s`;
    case 'wait': return `waited ${a.seconds} s`;
    case 'cursor_position': return 'asked where the pointer is';
    case 'open': return `opened ${a.target}`;
    case 'list_windows': return 'listed the open windows';
    case 'focus_window': return `brought window ${a.id} to the front`;
    case 'ui_tree': return 'read the controls in the front window';
    case 'click_element': return `pressed control ${a.id}`;
    case 'marks': return 'numbered what can be clicked on the screen';
    case 'click_mark': return `clicked mark ${a.ref}`;
  }
}

// ---------------------------------------------------------------- the plain function tool (any AI, MCP)

const ACTION_NAMES = [
  'screenshot', 'zoom', 'left_click', 'right_click', 'middle_click', 'double_click', 'triple_click', 'mouse_move', 'left_click_drag',
  'left_mouse_down', 'left_mouse_up', 'scroll', 'type', 'key', 'hold_key', 'wait', 'cursor_position',
  'open', 'list_windows', 'focus_window', 'ui_tree', 'click_element', 'marks', 'click_mark',
] as const;

/** Actions Anthropic's toolset does not have; with it, these come as a second tool. */
export const EXTRA_ACTIONS = ['open', 'list_windows', 'focus_window', 'ui_tree', 'click_element', 'marks', 'click_mark'] as const;

const coord = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };

export function genericComputerTool(width: number, height: number, actions: readonly string[] = ACTION_NAMES) {
  return {
    name: 'computer',
    description:
      `Use this computer like a person: look at the screen, move the pointer, click, type and press keys, open apps, files and web pages, ` +
      `and read the controls in the front window. The screenshot is ${width}×${height} pixels; coordinates are pixels in it, from the top left. ` +
      `Take a screenshot first and after anything that changes the screen. Prefer marks + click_mark (numbered controls, from accessibility or read off the screen) over guessing pixels. ` +
      `Some apps are off limits and passwords are never typed; the person can stop you at any time.`,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...actions] },
        coordinate: { ...coord, description: '[x, y] in screenshot pixels' },
        start_coordinate: { ...coord, description: 'drag start [x, y]' },
        text: { type: 'string', description: 'text to type; for key/hold_key a key or combination such as "Return", "ctrl+s", "cmd+shift+t"; for clicks optional modifiers such as "shift"' },
        scroll_direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        scroll_amount: { type: 'integer', minimum: 1, maximum: 30 },
        duration: { type: 'number', minimum: 0, maximum: 30, description: 'seconds (wait, hold_key)' },
        repeat: { type: 'integer', minimum: 1, maximum: 100 },
        region: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: 'zoom: [x0, y0, x1, y1]' },
        target: { type: 'string', description: 'open: an app name, a web address or a file path' },
        window_id: { type: 'string', description: 'focus_window: an id from list_windows' },
        element_id: { type: 'string', description: 'click_element: an id from ui_tree' },
        ref: { type: 'integer', minimum: 1, description: 'click_mark: a number from marks' },
        depth: { type: 'integer', minimum: 1, maximum: 12 },
      },
      required: ['action'],
    } as Record<string, unknown>,
  };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const pair = (v: unknown): [number, number] | undefined => (Array.isArray(v) && v.length === 2 && num(v[0]) !== undefined && num(v[1]) !== undefined ? [v[0] as number, v[1] as number] : undefined);
const modsOf = (t: unknown) => (typeof t === 'string' && t.trim() ? t.split('+').map((s) => s.trim().toLowerCase()).filter(Boolean) : undefined);

/** The plain tool's (and Anthropic's toolset member's) input → an action. Throws with a message the AI can act on. */
export function fromToolInput(action: string, input: Record<string, unknown>): ComputerAction {
  const c = pair(input.coordinate);
  const needC = () => { if (!c) throw new Error(`${action} needs coordinate [x, y]`); return c; };
  const text = typeof input.text === 'string' ? input.text : undefined;
  switch (action) {
    case 'screenshot': return { type: 'screenshot' };
    case 'zoom': {
      const r = input.region;
      if (!Array.isArray(r) || r.length !== 4 || r.some((v) => num(v) === undefined)) throw new Error('zoom needs region [x0, y0, x1, y1]');
      return { type: 'zoom', region: r as [number, number, number, number] };
    }
    case 'left_click': case 'right_click': case 'middle_click': case 'double_click': case 'triple_click': {
      const button: Button = action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : 'left';
      const count = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
      return { type: 'click', button, count, ...(c ? { x: c[0], y: c[1] } : {}), ...(modsOf(text) ? { mods: modsOf(text) } : {}) };
    }
    case 'mouse_move': { const p = needC(); return { type: 'move', x: p[0], y: p[1] }; }
    case 'left_click_drag': {
      const s = pair(input.start_coordinate);
      const e = needC();
      if (!s) throw new Error('left_click_drag needs start_coordinate and coordinate');
      return { type: 'drag', path: [s, e], ...(modsOf(text) ? { mods: modsOf(text) } : {}) };
    }
    case 'left_mouse_down': return { type: 'mouse_down', button: 'left' };
    case 'left_mouse_up': return { type: 'mouse_up', button: 'left' };
    case 'scroll': {
      const dir = String(input.scroll_direction ?? 'down');
      const n = Math.max(1, Math.min(30, Math.round(num(input.scroll_amount) ?? 3)));
      const dx = dir === 'left' ? -n : dir === 'right' ? n : 0;
      const dy = dir === 'up' ? -n : dir === 'down' ? n : 0;
      if (!dx && !dy) throw new Error('scroll_direction must be up, down, left or right');
      return { type: 'scroll', dx, dy, ...(c ? { x: c[0], y: c[1] } : {}), ...(modsOf(text) ? { mods: modsOf(text) } : {}) };
    }
    case 'type': if (!text) throw new Error('type needs text'); return { type: 'type', text };
    case 'key': if (!text) throw new Error('key needs text, e.g. "Return" or "ctrl+s"'); return { type: 'key', keys: text, repeat: Math.max(1, Math.min(100, Math.round(num(input.repeat) ?? 1))) };
    case 'hold_key': if (!text) throw new Error('hold_key needs text'); return { type: 'hold_key', keys: text, seconds: Math.max(0, Math.min(30, num(input.duration) ?? 1)) };
    case 'wait': return { type: 'wait', seconds: Math.max(0, Math.min(30, num(input.duration) ?? 1)) };
    case 'cursor_position': return { type: 'cursor_position' };
    case 'open': {
      const t = String(input.target ?? text ?? '').trim();
      if (!t) throw new Error('open needs target: an app name, a web address or a file path');
      return { type: 'open', target: t };
    }
    case 'list_windows': return { type: 'list_windows' };
    case 'focus_window': if (!input.window_id) throw new Error('focus_window needs window_id from list_windows'); return { type: 'focus_window', id: String(input.window_id) };
    case 'ui_tree': return { type: 'ui_tree', depth: Math.max(1, Math.min(12, Math.round(num(input.depth) ?? 6))) };
    case 'click_element': if (!input.element_id) throw new Error('click_element needs element_id from ui_tree'); return { type: 'click_element', id: String(input.element_id) };
    case 'marks': return { type: 'marks' };
    case 'click_mark': {
      const r = num(input.ref) ?? Number(input.ref);
      if (!Number.isInteger(r) || r < 1) throw new Error('click_mark needs ref: a number from marks');
      return { type: 'click_mark', ref: r };
    }
    default: throw new Error(`Unknown computer action "${action}"`);
  }
}

// ---------------------------------------------------------------- Anthropic's toolset

export const ANTHROPIC_TOOLSET = 'computer_toolset_20260801';
/** The 17 members of the toolset; with these the AI names the action in the tool_use block itself. */
export const ANTHROPIC_MEMBERS = [
  'screenshot', 'zoom', 'left_click', 'right_click', 'middle_click', 'double_click', 'triple_click', 'left_click_drag', 'mouse_move',
  'left_mouse_down', 'left_mouse_up', 'cursor_position', 'scroll', 'type', 'key', 'hold_key', 'wait',
] as const;

/** The entry in `tools` for Claude 5.5 and later (no beta header, no display size: coordinates are in the screenshot's pixels). */
export function anthropicToolset(): Record<string, unknown> {
  return { type: ANTHROPIC_TOOLSET };
}

/** A tool_use block from the toolset → an action. */
export function fromAnthropic(block: { name: string; input?: Record<string, unknown>; toolset_name?: string }): ComputerAction {
  return fromToolInput(block.name, block.input ?? {});
}

/** Is this tool_use block one of the toolset's members? */
export function isAnthropicMember(block: { name: string; toolset_name?: string }): boolean {
  return block.toolset_name === 'computer' && (ANTHROPIC_MEMBERS as readonly string[]).includes(block.name);
}

// ---------------------------------------------------------------- OpenAI's computer tool (Responses API)

/** The entry in `tools`: the model works out the screen size from the screenshots. */
export function openAiComputerTool(): Record<string, unknown> {
  return { type: 'computer' };
}

interface OaiAction { type: string; x?: number; y?: number; button?: string; keys?: string[]; text?: string; path?: { x: number; y: number }[]; scroll_x?: number; scroll_y?: number }

const OAI_KEY: Record<string, string> = { ENTER: 'Return', RETURN: 'Return', ESC: 'Escape', ESCAPE: 'Escape', SPACE: 'space', BACKSPACE: 'BackSpace', DELETE: 'Delete', TAB: 'Tab', CTRL: 'ctrl', CONTROL: 'ctrl', ALT: 'alt', OPTION: 'alt', SHIFT: 'shift', CMD: 'cmd', COMMAND: 'cmd', META: 'cmd', SUPER: 'super', WIN: 'super', ARROWUP: 'Up', ARROWDOWN: 'Down', ARROWLEFT: 'Left', ARROWRIGHT: 'Right', UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right', PAGEUP: 'Page_Up', PAGEDOWN: 'Page_Down', HOME: 'Home', END: 'End' };

/** One computer_call's actions → Keeper's. Scroll amounts arrive in pixels; one notch is about 100. */
export function fromOpenAi(actions: OaiAction[]): ComputerAction[] {
  const out: ComputerAction[] = [];
  for (const a of actions) {
    const mods = a.keys?.length && a.type !== 'keypress' ? a.keys.map((k) => OAI_KEY[k.toUpperCase()] ?? k.toLowerCase()) : undefined;
    switch (a.type) {
      case 'click': out.push({ type: 'click', button: a.button === 'right' ? 'right' : a.button === 'wheel' || a.button === 'middle' ? 'middle' : 'left', count: 1, x: a.x, y: a.y, ...(mods ? { mods } : {}) }); break;
      case 'double_click': out.push({ type: 'click', button: 'left', count: 2, x: a.x, y: a.y }); break;
      case 'move': out.push({ type: 'move', x: a.x ?? 0, y: a.y ?? 0 }); break;
      case 'drag': if (a.path && a.path.length >= 2) out.push({ type: 'drag', path: a.path.map((p) => [p.x, p.y] as [number, number]) }); break;
      case 'scroll': {
        const dx = Math.round((a.scroll_x ?? 0) / 100) || Math.sign(a.scroll_x ?? 0);
        const dy = Math.round((a.scroll_y ?? 0) / 100) || Math.sign(a.scroll_y ?? 0);
        if (dx || dy) out.push({ type: 'scroll', x: a.x, y: a.y, dx, dy });
        break;
      }
      case 'keypress': if (a.keys?.length) out.push({ type: 'key', keys: a.keys.map((k) => OAI_KEY[k.toUpperCase()] ?? (k.length === 1 ? k.toLowerCase() : k)).join('+') }); break;
      case 'type': if (a.text) out.push({ type: 'type', text: a.text }); break;
      case 'wait': out.push({ type: 'wait', seconds: 1 }); break;
      case 'screenshot': out.push({ type: 'screenshot' }); break;
      default: throw new Error(`Unknown computer action "${a.type}"`);
    }
  }
  return out;
}

/** What goes back for a computer_call: the screen after its actions. */
export function openAiCallOutput(callId: string, pngBase64: string): Record<string, unknown> {
  return { type: 'computer_call_output', call_id: callId, output: { type: 'computer_screenshot', image_url: `data:image/png;base64,${pngBase64}`, detail: 'original' } };
}

// ---------------------------------------------------------------- screenshots and coordinates

export interface ShotDisplay {
  id: string;
  /** position and size in points, as the OS lays out displays */
  x: number;
  y: number;
  width: number;
  height: number;
  /** device pixels per point */
  scale: number;
}

/** Size to send screenshots at: within the AI's limits, never larger than the screen. */
export function shotSize(d: ShotDisplay, longEdge = 1366, maxPixels = 1_150_000): { width: number; height: number; factor: number } {
  const f = Math.min(1, longEdge / Math.max(d.width, d.height), Math.sqrt(maxPixels / (d.width * d.height)));
  return { width: Math.round(d.width * f), height: Math.round(d.height * f), factor: f };
}

/** A point in the screenshot → 0..1 across the display (what the input layer takes). */
export function toNormalized(shot: { width: number; height: number }, x: number, y: number): { x: number; y: number } {
  const cx = Math.max(0, Math.min(shot.width - 1, x));
  const cy = Math.max(0, Math.min(shot.height - 1, y));
  return { x: cx / shot.width, y: cy / shot.height };
}

/** A point in screen points (from the OS) → the screenshot's pixels. */
export function toShot(shot: { width: number; height: number }, d: ShotDisplay, px: number, py: number): { x: number; y: number } {
  return { x: Math.round(((px - d.x) / d.width) * shot.width), y: Math.round(((py - d.y) / d.height) * shot.height) };
}

// ---------------------------------------------------------------- keys

const NAMED: Record<string, string> = {
  return: 'Enter', enter: 'Enter', kp_enter: 'NumpadEnter', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', del: 'Delete',
  space: 'Space', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', home: 'Home', end: 'End', page_up: 'PageUp', pageup: 'PageUp',
  prior: 'PageUp', page_down: 'PageDown', pagedown: 'PageDown', next: 'PageDown', insert: 'Insert', caps_lock: 'CapsLock', print: 'PrintScreen',
  minus: 'Minus', equal: 'Equal', comma: 'Comma', period: 'Period', slash: 'Slash', backslash: 'Backslash', semicolon: 'Semicolon', apostrophe: 'Quote',
  grave: 'Backquote', bracketleft: 'BracketLeft', bracketright: 'BracketRight',
};
const PUNCT: Record<string, string> = { '-': 'Minus', '=': 'Equal', ',': 'Comma', '.': 'Period', '/': 'Slash', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight' };
const MOD: Record<string, keyof Mods> = { ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt', opt: 'alt', shift: 'shift', cmd: 'meta', command: 'meta', meta: 'meta', super: 'meta', win: 'meta' };

/** "ctrl+shift+t", "Return", "cmd+space" → the key's DOM code and the modifiers held with it. */
export function parseCombo(keys: string): { code: string; key: string; mods: Mods } {
  const parts = keys.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error('No key given');
  const mods: Mods = {};
  let main = '';
  for (const p of parts) {
    const m = MOD[p.toLowerCase()];
    if (m && parts.length > 1) mods[m] = true;
    else main = p;
  }
  if (!main) {
    // Only modifiers, e.g. "cmd": press that modifier on its own.
    const m = MOD[parts[parts.length - 1].toLowerCase()];
    const code = m === 'ctrl' ? 'ControlLeft' : m === 'alt' ? 'AltLeft' : m === 'shift' ? 'ShiftLeft' : 'MetaLeft';
    return { code, key: parts[parts.length - 1], mods: {} };
  }
  const low = main.toLowerCase();
  let code: string;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(low)) code = 'F' + low.slice(1);
  else if (NAMED[low]) code = NAMED[low];
  else if (/^[a-z]$/i.test(main)) code = 'Key' + main.toUpperCase();
  else if (/^[0-9]$/.test(main)) code = 'Digit' + main;
  else if (PUNCT[main]) code = PUNCT[main];
  else if (MOD[low]) code = MOD[low] === 'ctrl' ? 'ControlLeft' : MOD[low] === 'alt' ? 'AltLeft' : MOD[low] === 'shift' ? 'ShiftLeft' : 'MetaLeft';
  else throw new Error(`Unknown key "${main}"`);
  if (/^[A-Z]$/.test(main) && parts.length === 1) mods.shift = true;
  return { code, key: main.length === 1 ? main : low, mods };
}

// ---------------------------------------------------------------- safety

export interface ComputerPolicy {
  permission: 'off' | 'ask' | 'allow';
  /** app names (process or bundle names, case-insensitive substrings) never looked at or touched */
  blockedApps: string[];
  /** words that block a window by its title (banking, wallets…) */
  blockedTitles: string[];
  maxActionsPerMinute: number;
  /** a session ends after this many minutes without an action */
  idleMinutes: number;
  /** and after this many minutes in all */
  maxMinutes: number;
}

export const DEFAULT_BLOCKED_APPS = [
  '1Password', 'Bitwarden', 'KeePassXC', 'KeePass', 'LastPass', 'Dashlane', 'Enpass', 'Proton Pass', 'Keeper Password Manager',
  'Keychain Access', 'Passwords', 'seahorse', 'Credential Manager',
  'Terminal', 'iTerm', 'gnome-terminal', 'konsole', 'xterm', 'WindowsTerminal', 'cmd.exe', 'powershell', 'pwsh',
];
export const DEFAULT_BLOCKED_TITLES = ['online banking', 'internet banking', 'bank account', 'sign in to your bank', 'paypal', 'crypto wallet', 'seed phrase', 'recovery phrase', 'password manager'];

export function defaultComputerPolicy(): ComputerPolicy {
  return { permission: 'off', blockedApps: [...DEFAULT_BLOCKED_APPS], blockedTitles: [...DEFAULT_BLOCKED_TITLES], maxActionsPerMinute: 90, idleMinutes: 10, maxMinutes: 60 };
}

export function normalizeComputerPolicy(raw: unknown): ComputerPolicy {
  const d = defaultComputerPolicy();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ComputerPolicy>;
  const arr = (v: unknown, def: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : def);
  const int = (v: unknown, def: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : def);
  return {
    permission: r.permission === 'ask' || r.permission === 'allow' ? r.permission : 'off',
    blockedApps: arr(r.blockedApps, d.blockedApps),
    blockedTitles: arr(r.blockedTitles, d.blockedTitles),
    maxActionsPerMinute: int(r.maxActionsPerMinute, d.maxActionsPerMinute, 5, 600),
    idleMinutes: int(r.idleMinutes, d.idleMinutes, 1, 240),
    maxMinutes: int(r.maxMinutes, d.maxMinutes, 1, 24 * 60),
  };
}

/** Is the front app or window off limits? Returns the reason, or undefined when it is fine. */
export function blockedBy(policy: ComputerPolicy, front: { app?: string; title?: string; keeper?: boolean }): string | undefined {
  const app = (front.app ?? '').toLowerCase();
  const title = (front.title ?? '').toLowerCase();
  const hit = policy.blockedApps.find((b) => {
    const s = b.toLowerCase();
    // Whole word for short names ("Passwords"), substring for long ones.
    return app && (app === s || app.replace(/\.(exe|app)$/, '') === s || (s.length >= 6 && app.includes(s)));
  });
  if (hit) return `${front.app} is on the list of apps the AI may not see or use`;
  const t = policy.blockedTitles.find((w) => w && title.includes(w.toLowerCase()));
  if (t) return `the front window (“${front.title}”) looks private (${t})`;
  return undefined;
}

/** Text that must never be typed by an AI: anything the secret blanker would remove. */
export function secretIn(text: string): string | undefined {
  const r = redact(text);
  const kinds = Object.keys(r.found ?? {});
  return kinds.length ? kinds.join(', ') : undefined;
}

/** Sliding one-minute window of actions. */
export class RateLimit {
  private times: number[] = [];
  constructor(private perMinute: number) {}
  take(now = Date.now()): boolean {
    this.times = this.times.filter((t) => now - t < 60_000);
    if (this.times.length >= this.perMinute) return false;
    this.times.push(now);
    return true;
  }
  set(perMinute: number) {
    this.perMinute = perMinute;
  }
}

export interface ComputerSession {
  id: string;
  client: string;
  started: number;
  last: number;
  actions: number;
}

/** Why a running session must end now, or undefined. */
export function sessionExpired(s: ComputerSession, p: ComputerPolicy, now = Date.now()): string | undefined {
  if (now - s.last > p.idleMinutes * 60_000) return `no action for ${p.idleMinutes} minutes`;
  if (now - s.started > p.maxMinutes * 60_000) return `the ${p.maxMinutes}-minute limit was reached`;
  return undefined;
}

// ---------------------------------------------------------------- the front window's controls

export interface UiNode {
  id: string;
  role: string;
  name?: string;
  value?: string;
  /** screen points */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  enabled?: boolean;
  children?: UiNode[];
}

/** A compact, indented listing for the AI, with each control's centre in screenshot pixels. */
export function uiTreeText(root: UiNode | undefined, map: (x: number, y: number) => { x: number; y: number }, maxLines = 400): string {
  if (!root) return 'The front app does not expose its controls (or Keeper is not allowed to read them).';
  const lines: string[] = [];
  const walk = (n: UiNode, depth: number) => {
    if (lines.length >= maxLines) return;
    const label = [n.name, n.value && n.value !== n.name ? `= “${n.value.slice(0, 80)}”` : ''].filter(Boolean).join(' ');
    const at = n.x !== undefined && n.y !== undefined && n.width !== undefined && n.height !== undefined ? map(n.x + n.width / 2, n.y + n.height / 2) : undefined;
    // Containers with nothing to say are skipped, their children are not.
    const interesting = !!label || /button|link|field|text|check|radio|menu|tab|combo|slider|list item|cell|image/i.test(n.role);
    if (interesting) lines.push(`${'  '.repeat(depth)}[${n.id}] ${n.role}${label ? ` ${label}` : ''}${at ? ` @${at.x},${at.y}` : ''}${n.enabled === false ? ' (disabled)' : ''}`);
    for (const c of n.children ?? []) walk(c, interesting ? depth + 1 : depth);
  };
  walk(root, 0);
  if (lines.length >= maxLines) lines.push(`… more controls not shown`);
  return lines.join('\n') || 'The front window has no controls Keeper can read.';
}

/** Finds a control by id. */
export function findNode(root: UiNode | undefined, id: string): UiNode | undefined {
  if (!root) return undefined;
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return undefined;
}
