// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktop in a Keeper tab, the parts that are plain logic: whether a
// connection opens in a tab or in the outside app (and why), the size to ask
// for, keys as RDP scancodes, the special key combinations, and the checks the
// local relay makes on the engine's request. Shared by the main process, the
// tab and tests.

import { sameToken, type RelayRequest } from './rdcleanpath';
import type { Connection } from './types';

// ---------------------------------------------------------------- tab or outside app

export type EngineState = 'ready' | 'missing' | 'unavailable';

export interface RdpWhere {
  where: 'tab' | 'outside';
  /** why it is not a tab, in plain words (shown once, as a note) */
  reason?: string;
}

/** Things only the outside app does; each sends the connection there, with this reason. */
const OUTSIDE_ONLY: { has: (c: Connection) => boolean; why: string }[] = [
  { has: (c) => !!c.rdp?.gateway, why: 'A Remote Desktop Gateway needs the outside app.' },
  { has: (c) => !!c.rdp?.admin, why: 'The admin (console) session needs the outside app.' },
  { has: (c) => !!c.rdp?.multimon, why: 'Using all monitors needs the outside app.' },
  { has: (c) => !!c.rdp?.drives, why: 'Sharing your home folder needs the outside app.' },
];

/** Where an RDP connection opens. `inTab` is the person's choice in Where it appears (on unless switched off). */
export function rdpWhere(c: Connection, o: { external?: boolean; inTab: boolean; engine: EngineState }): RdpWhere {
  if (o.external) return { where: 'outside' };
  if (c.rdp?.where === 'outside') return { where: 'outside' };
  if (!o.inTab) return { where: 'outside' };
  const only = OUTSIDE_ONLY.find((x) => x.has(c));
  if (only) return { where: 'outside', reason: only.why };
  if (o.engine === 'unavailable') return { where: 'outside', reason: 'Remote Desktop in a tab is not available on this computer.' };
  return { where: 'tab' };
}

/** The connection's options that a tab cannot honour (listed under the editor's choice). */
export function tabLimits(c: Connection): string[] {
  return OUTSIDE_ONLY.filter((x) => x.has(c)).map((x) => x.why);
}

/** "DOMAIN\\name" → the name and its domain; "name" and "name@domain" stay as they are. */
export function splitUser(text: string): { user: string; domain?: string } {
  const t = text.trim();
  const i = t.indexOf('\\');
  return i > 0 && i < t.length - 1 ? { user: t.slice(i + 1), domain: t.slice(0, i) } : { user: t };
}

// ---------------------------------------------------------------- size

/** RDP wants even widths; Windows accepts 200–8192 pixels each way. */
export function evenSize(w: number, h: number): { width: number; height: number } {
  const clamp = (n: number) => Math.max(200, Math.min(8192, Math.round(n)));
  const width = clamp(w);
  return { width: width - (width % 2), height: clamp(h) };
}

/**
 * The desktop size to ask for: the connection's fixed size, the screen for full
 * screen, otherwise the tab's area. `follow` says whether it then follows the tab
 * (no fixed size, and Resize with the window not switched off).
 */
export function desktopSize(c: Connection, area: { width: number; height: number }, screen: { width: number; height: number }): { width: number; height: number; follow: boolean } {
  const r = c.rdp ?? {};
  if (r.width && r.height) return { ...evenSize(r.width, r.height), follow: false };
  if (r.fullscreen) return { ...evenSize(screen.width, screen.height), follow: r.dynamicResolution !== false };
  return { ...evenSize(area.width, area.height), follow: r.dynamicResolution !== false };
}

// ---------------------------------------------------------------- keys

/** KeyboardEvent.code → RDP scancode (set 1; 0xE0xx for the extended keys). The remote computer's own layout applies. */
export const SCANCODES: Record<string, number> = {
  Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06, Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b,
  Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e, Tab: 0x0f,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19, BracketLeft: 0x1a, BracketRight: 0x1b, Enter: 0x1c,
  ControlLeft: 0x1d, KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29,
  ShiftLeft: 0x2a, Backslash: 0x2b, KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30, KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35, ShiftRight: 0x36,
  NumpadMultiply: 0x37, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3a,
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44,
  NumLock: 0x45, ScrollLock: 0x46, Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49, NumpadSubtract: 0x4a, Numpad4: 0x4b, Numpad5: 0x4c, Numpad6: 0x4d, NumpadAdd: 0x4e,
  Numpad1: 0x4f, Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52, NumpadDecimal: 0x53, IntlBackslash: 0x56, F11: 0x57, F12: 0x58, NumpadEqual: 0x59,
  F13: 0x64, F14: 0x65, F15: 0x66, F16: 0x67, F17: 0x68, F18: 0x69, F19: 0x6a, F20: 0x6b, F21: 0x6c, F22: 0x6d, F23: 0x6e, F24: 0x76,
  KanaMode: 0x70, IntlRo: 0x73, Convert: 0x79, NonConvert: 0x7b, IntlYen: 0x7d, NumpadComma: 0x7e,
  MediaTrackPrevious: 0xe010, MediaTrackNext: 0xe019, NumpadEnter: 0xe01c, ControlRight: 0xe01d, AudioVolumeMute: 0xe020, MediaPlayPause: 0xe022, MediaStop: 0xe024,
  AudioVolumeDown: 0xe02e, AudioVolumeUp: 0xe030, BrowserHome: 0xe032, NumpadDivide: 0xe035, PrintScreen: 0xe037, AltRight: 0xe038,
  Home: 0xe047, ArrowUp: 0xe048, PageUp: 0xe049, ArrowLeft: 0xe04b, ArrowRight: 0xe04d, End: 0xe04f, ArrowDown: 0xe050, PageDown: 0xe051, Insert: 0xe052, Delete: 0xe053,
  MetaLeft: 0xe05b, MetaRight: 0xe05c, OSLeft: 0xe05b, OSRight: 0xe05c, ContextMenu: 0xe05d,
};

export type RdpKey = { t: 'scancode'; code: number } | { t: 'unicode'; text: string } | null;

/**
 * What to send for a key. By default the physical key (scancode), so the remote
 * computer's own keyboard layout decides the letter. In "type letters" mode a
 * printable character without Ctrl, Alt or Cmd goes as that character instead,
 * for when the two computers have different layouts.
 */
export function rdpKey(e: { code: string; key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }, mode: 'keys' | 'letters' = 'keys'): RdpKey {
  const sc = SCANCODES[e.code];
  const printable = [...e.key].length === 1 && e.key >= ' ';
  // AltGr arrives as Ctrl+Alt on Windows; its characters still go as letters. Ctrl, Alt or Cmd alone are shortcuts: keys.
  const altGr = !!e.ctrlKey && !!e.altKey;
  if (mode === 'letters' && printable && !e.metaKey && (altGr || (!e.ctrlKey && !e.altKey))) return { t: 'unicode', text: e.key };
  return sc ? { t: 'scancode', code: sc } : null;
}

export const RDP_COMBOS: Record<string, { label: string; keys: number[] }> = {
  cad: { label: 'Ctrl+Alt+Del', keys: [0x1d, 0x38, 0xe053] },
  cae: { label: 'Ctrl+Alt+End', keys: [0x1d, 0x38, 0xe04f] },
  taskmgr: { label: 'Ctrl+Shift+Esc', keys: [0x1d, 0x2a, 0x01] },
  win: { label: 'Windows key', keys: [0xe05b] },
  lock: { label: 'Windows+L (lock)', keys: [0xe05b, 0x26] },
  run: { label: 'Windows+R (run)', keys: [0xe05b, 0x13] },
  alttab: { label: 'Alt+Tab', keys: [0x38, 0x0f] },
  prtsc: { label: 'Print Screen', keys: [0xe037] },
};

/** Presses keys in order and lets them go in reverse, as a person would. */
export function comboScancodes(keys: number[]): { code: number; down: boolean }[] {
  return [...keys.map((code) => ({ code, down: true })), ...keys.slice().reverse().map((code) => ({ code, down: false }))];
}

// ---------------------------------------------------------------- the engine's words

/**
 * The engine's own error text in plain words: its source locations are left out,
 * and a connection that closed mid-way says so.
 */
export function engineMessage(raw: string): string {
  const t = raw.split('\n')[0].replace(/\[[^\]]*@[^\]]*\]\s*/g, '').replace(/^(custom|general) error:\s*/i, '').trim();
  if (!t) return 'The connection did not start.';
  if (/not enough bytes|unexpected eof|connection (was )?(closed|reset)|websocket/i.test(t)) return 'The computer closed the connection before the session started.';
  if (/timed? ?out/i.test(t)) return 'The computer stopped answering.';
  return /[.!?]$/.test(t) ? t[0].toUpperCase() + t.slice(1) : `${t[0].toUpperCase()}${t.slice(1)}.`;
}

// ---------------------------------------------------------------- the relay's checks

/** Why the relay refuses a request, or null when it is the one it expects (right token, right computer). */
export function relayRefusal(req: RelayRequest, expected: { token: string; destination: string }): 'token' | 'destination' | null {
  if (!sameToken(req.token, expected.token)) return 'token';
  if (req.destination.toLowerCase() !== expected.destination.toLowerCase()) return 'destination';
  return null;
}

/** "host:port" as the engine names its destination (IPv6 in brackets). */
export const destinationOf = (host: string, port: number) => `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
