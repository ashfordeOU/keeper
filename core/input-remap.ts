// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mouse buttons and app shortcuts (experimental): give the middle and side
// buttons of a mouse a job (a key combination, in every app or one app), and
// change what a shortcut does in one app ("in Notes, ⌘D sends ⌘⇧D"). Pure
// logic: the buttons and how each system names them, which mapping applies to
// the app in front, the keys to send, and what this computer allows.
// electron/services/input-remap.ts listens (a mouse hook per system) and sends
// keys with the same injector remote control and computer use use.

import { parseCombo } from './computer';
import type { InputEvent, Mods } from './screen/types';

export type MouseButton = 'middle' | 'back' | 'forward';

export const MOUSE_BUTTONS: { id: MouseButton; label: string }[] = [
  { id: 'back', label: 'Back side button' },
  { id: 'forward', label: 'Forward side button' },
  { id: 'middle', label: 'Middle button (wheel click)' },
];

export interface MouseMapping {
  id: string;
  button: MouseButton;
  /** an app's name (or bundle id, program or window class); empty: every app */
  app: string;
  /** the key combination it sends (an Electron accelerator) */
  keys: string;
}

export interface KeyRemap {
  id: string;
  /** the app it applies in (required: a shortcut changed everywhere is a system setting) */
  app: string;
  /** the shortcut you press, and the one the app gets instead */
  from: string;
  to: string;
}

export interface InputRemapSettings {
  mouse: MouseMapping[];
  keys: KeyRemap[];
  /** Windows and macOS: the button's own action is stopped when Keeper gives it a job */
  takeOver: boolean;
}

export const defaultInputRemap = (): InputRemapSettings => ({ mouse: [], keys: [], takeOver: false });

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function normalizeInputRemap(raw: unknown): InputRemapSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<InputRemapSettings>;
  const mouse = (Array.isArray(r.mouse) ? r.mouse : [])
    .filter((m): m is MouseMapping => !!m && MOUSE_BUTTONS.some((b) => b.id === m.button))
    .map((m, i) => ({ id: str(m.id) || `m${i}`, button: m.button, app: str(m.app), keys: str(m.keys) }))
    .slice(0, 30);
  const keys = (Array.isArray(r.keys) ? r.keys : [])
    .filter((k): k is KeyRemap => !!k && typeof k === 'object')
    .map((k, i) => ({ id: str(k.id) || `k${i}`, app: str(k.app), from: str(k.from), to: str(k.to) }))
    .slice(0, 60);
  return { mouse, keys, takeOver: r.takeOver === true };
}

// ---------------------------------------------------------------- how each system names the buttons

/** Linux evdev codes: BTN_MIDDLE, BTN_SIDE / BTN_BACK, BTN_EXTRA / BTN_FORWARD. */
export function buttonFromLinuxCode(code: number): MouseButton | null {
  return code === 0x112 ? 'middle' : code === 0x113 || code === 0x116 ? 'back' : code === 0x114 || code === 0x115 ? 'forward' : null;
}

/** X11 button numbers (xinput's RawButtonPress detail): 2 middle, 8 back, 9 forward. */
export function buttonFromX11(n: number): MouseButton | null {
  return n === 2 ? 'middle' : n === 8 ? 'back' : n === 9 ? 'forward' : null;
}

/** macOS otherMouse button numbers: 2 middle, 3 back, 4 forward. Windows: XBUTTON1 back, XBUTTON2 forward (sent as 3 and 4 by Keeper's hook). */
export function buttonFromNumber(n: number): MouseButton | null {
  return n === 2 ? 'middle' : n === 3 ? 'back' : n === 4 ? 'forward' : null;
}

/** A line from the Mac helper or the Windows hook: "btn 3 down". */
export function parseButtonLine(line: string): { button: MouseButton; down: boolean } | null {
  const m = /^btn (\d+) (down|up)$/.exec(line.trim());
  const b = m ? buttonFromNumber(Number(m[1])) : null;
  return m && b ? { button: b, down: m[2] === 'down' } : null;
}

/**
 * Mice among /proc/bus/input/devices: handlers with a mouseN and an eventN.
 * Returns the /dev/input/eventN paths.
 */
export function miceFromProcDevices(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const h = /^H: Handlers=(.*)$/m.exec(block)?.[1] ?? '';
    if (!/\bmouse\d+\b/.test(h)) continue;
    const ev = /\bevent(\d+)\b/.exec(h);
    if (ev) out.push(`/dev/input/event${ev[1]}`);
  }
  return out;
}

/** xinput test-xi2 --root: "EVENT type 15 (RawButtonPress)" then "    detail: 8". Feed it lines; it calls back on presses. */
export class RawButtonReader {
  private inPress = false;
  constructor(private on: (button: MouseButton) => void) {}
  line(l: string) {
    if (/^EVENT type \d+ \(/.test(l)) { this.inPress = /\(RawButtonPress\)/.test(l); return; }
    if (!this.inPress) return;
    const m = /^\s+detail: (\d+)/.exec(l);
    if (m) {
      this.inPress = false;
      const b = buttonFromX11(Number(m[1]));
      if (b) this.on(b);
    }
  }
}

// ---------------------------------------------------------------- what applies now

/** Does an app setting ("Notes", "com.apple.Notes", "firefox") name the app in front? */
export function appMatches(want: string, front: { app?: string; appId?: string }): boolean {
  const w = want.trim().toLowerCase();
  if (!w) return true;
  const names = [front.app, front.appId].filter(Boolean).map((s) => s!.toLowerCase());
  return names.some((n) => n === w || n.endsWith(`/${w}`) || n.endsWith(`\\${w}`) || n.replace(/\.exe$/, '') === w || n.endsWith(`.${w}`));
}

/** The job a button has in the app in front: that app's own first, then the every-app one. */
export function mappingFor(list: MouseMapping[], button: MouseButton, front: { app?: string; appId?: string }): MouseMapping | undefined {
  const mine = list.filter((m) => m.button === button && m.keys);
  return mine.find((m) => m.app && appMatches(m.app, front)) ?? mine.find((m) => !m.app);
}

/** The app shortcuts that apply while this app is in front. */
export function remapsFor(list: KeyRemap[], front: { app?: string; appId?: string } | undefined): KeyRemap[] {
  if (!front?.app && !front?.appId) return [];
  return list.filter((k) => k.app && k.from && k.to && appMatches(k.app, front));
}

// ---------------------------------------------------------------- the keys to send

/** An Electron accelerator ("CommandOrControl+Shift+T") as the computer tools' combo ("cmd+shift+t" on a Mac). */
export function accelToCombo(acc: string, platform: string): string {
  return acc.split('+').map((p) => p.trim()).filter(Boolean).map((p) => {
    const l = p.toLowerCase();
    if (l === 'commandorcontrol' || l === 'cmdorctrl') return platform === 'darwin' ? 'cmd' : 'ctrl';
    if (l === 'command' || l === 'cmd') return 'cmd';
    if (l === 'control' || l === 'ctrl') return 'ctrl';
    if (l === 'option' || l === 'alt' || l === 'altgr') return 'alt';
    if (l === 'super' || l === 'meta') return 'super';
    if (l === 'return' || l === 'enter') return 'return';
    if (l === 'plus') return '=';
    return p.length === 1 ? p.toLowerCase() : l;
  }).join('+');
}

const MOD_CODES: [keyof Mods, string][] = [['ctrl', 'ControlLeft'], ['alt', 'AltLeft'], ['shift', 'ShiftLeft'], ['meta', 'MetaLeft']];

/**
 * The key events that send `to`. When `held` is the shortcut that triggered it
 * (an app shortcut, whose keys are still down), its modifiers that `to` does not
 * use are let go first, so the app gets exactly `to`.
 */
export function sendEvents(to: string, platform: string, held?: string): InputEvent[] {
  const c = parseCombo(accelToCombo(to, platform));
  const out: InputEvent[] = [];
  if (held) {
    const h = parseCombo(accelToCombo(held, platform));
    for (const [k, code] of MOD_CODES) if (h.mods[k] && !c.mods[k]) out.push({ t: 'key', code, down: false });
  }
  const press = MOD_CODES.filter(([k]) => c.mods[k]);
  for (const [, code] of press) out.push({ t: 'key', code, down: true });
  out.push({ t: 'key', code: c.code, key: c.key, down: true, mods: c.mods }, { t: 'key', code: c.code, key: c.key, down: false, mods: c.mods });
  for (const [, code] of [...press].reverse()) out.push({ t: 'key', code, down: false });
  return out;
}

/** Ready-made jobs for a button, in this system's own keys. */
export function buttonPresets(platform: string): { id: string; label: string; keys: string }[] {
  const mac = platform === 'darwin';
  return [
    { id: 'back', label: 'Go back', keys: mac ? 'Command+[' : 'Alt+Left' },
    { id: 'forward', label: 'Go forward', keys: mac ? 'Command+]' : 'Alt+Right' },
    { id: 'copy', label: 'Copy', keys: 'CommandOrControl+C' },
    { id: 'paste', label: 'Paste', keys: 'CommandOrControl+V' },
    { id: 'undo', label: 'Undo', keys: 'CommandOrControl+Z' },
    { id: 'close', label: 'Close the tab', keys: 'CommandOrControl+W' },
    { id: 'newtab', label: 'New tab', keys: 'CommandOrControl+T' },
    { id: 'windows', label: mac ? 'Show all windows' : platform === 'win32' ? 'Task view' : 'Overview', keys: mac ? 'Control+Up' : platform === 'win32' ? 'Super+Tab' : 'Super+S' },
  ];
}

// ---------------------------------------------------------------- what this computer allows

export type RemapState = 'ready' | 'permission' | 'setup' | 'unsupported';

export interface RemapFacts {
  platform: string;
  wayland?: boolean;
  /** Linux: a mouse's /dev/input device can be read (the "input" group) */
  inputReadable?: boolean;
  /** Linux: xinput is installed and this is X11 */
  xinput?: boolean;
  /** Linux: keys can be sent (xdotool, X11) */
  xdotool?: boolean;
  /** macOS: Keeper's helper is in this build */
  helper?: boolean;
  /** macOS: Accessibility (to send keys) */
  accessibility?: boolean;
}

export interface RemapAvailability {
  mouse: { state: RemapState; line: string; hint?: string };
  keys: { state: RemapState; line: string; hint?: string };
  /** the button's own action can be stopped here */
  canTakeOver: boolean;
}

export function remapAvailability(f: RemapFacts): RemapAvailability {
  if (f.platform === 'darwin') {
    const send = f.accessibility === false ? { state: 'permission' as const, line: 'Sending keys needs Accessibility.', hint: 'System Settings → Privacy & Security → Accessibility → Keeper.' } : null;
    return {
      mouse: !f.helper ? { state: 'unsupported', line: 'This copy of Keeper has no helper to listen to the mouse.' } : send ?? { state: 'ready', line: 'Listens to the middle and side buttons (macOS asks for Input Monitoring once).' },
      keys: send ?? { state: 'ready', line: 'Changes a shortcut while its app is in front.' },
      canTakeOver: true,
    };
  }
  if (f.platform === 'win32') {
    return { mouse: { state: 'ready', line: 'Listens to the middle and side buttons with a small mouse hook.' }, keys: { state: 'ready', line: 'Changes a shortcut while its app is in front.' }, canTakeOver: true };
  }
  if (f.platform === 'linux') {
    if (f.wayland && !f.inputReadable) {
      return {
        mouse: { state: 'setup', line: 'Wayland keeps the mouse private.', hint: 'Join the “input” group (sudo usermod -aG input $USER, then sign in again) so Keeper can listen.' },
        keys: { state: 'unsupported', line: 'Wayland does not let apps send keys to other apps, so shortcuts cannot be changed here.' },
        canTakeOver: false,
      };
    }
    const keys = f.wayland ? { state: 'unsupported' as const, line: 'Wayland does not let apps send keys to other apps, so shortcuts cannot be changed here.' }
      : f.xdotool === false ? { state: 'setup' as const, line: 'Sending keys needs xdotool.', hint: 'sudo apt install xdotool, then check again.' }
      : { state: 'ready' as const, line: 'Changes a shortcut while its app is in front.' };
    const mouse = f.inputReadable || f.xinput
      ? { state: keys.state === 'ready' ? 'ready' as const : keys.state, line: 'Listens to the middle and side buttons. The button still does its own thing too: Linux lets Keeper listen, not take a button over.', hint: keys.state === 'ready' ? undefined : keys.hint ?? keys.line }
      : { state: 'setup' as const, line: 'Listening to the mouse needs xinput, or the “input” group.', hint: 'sudo apt install xinput, or sudo usermod -aG input $USER and sign in again.' };
    return { mouse, keys, canTakeOver: false };
  }
  return { mouse: { state: 'unsupported', line: 'Not on this system.' }, keys: { state: 'unsupported', line: 'Not on this system.' }, canTakeOver: false };
}
