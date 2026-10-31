// SPDX-License-Identifier: AGPL-3.0-or-later
// Turning what the viewer does into what the host's operating system needs:
// where on which screen (in the units each OS's input API uses), which key
// (each OS numbers keys differently), and the special combinations a viewer
// cannot type because its own computer would catch them.

import type { HostDisplay, InputEvent, Mods, SpecialCombo } from './types';

export type HostOs = 'linux' | 'win32' | 'darwin';

/**
 * A 0..1 position on a display → the coordinates the host's injector takes.
 * Electron lays displays out in points; X11 (XTest) and Windows (SetCursorPos,
 * per-monitor DPI aware) take device pixels; macOS (CGEvent) takes points.
 */
export function toHostPoint(d: HostDisplay, nx: number, ny: number, os: HostOs): { x: number; y: number } {
  const cx = clamp01(nx);
  const cy = clamp01(ny);
  // Never land one pixel outside the display on the right or bottom edge.
  const px = d.x + Math.min(cx * d.width, d.width - 1);
  const py = d.y + Math.min(cy * d.height, d.height - 1);
  if (os === 'darwin') return { x: Math.round(px), y: Math.round(py) };
  return { x: Math.round(px * d.scale), y: Math.round(py * d.scale) };
}

/** The viewer's pointer over the picture (letterboxed in a box of its own size) → 0..1 on the display. */
export function fromViewer(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, videoW: number, videoH: number): { x: number; y: number } | null {
  if (!videoW || !videoH || !box.width || !box.height) return null;
  const s = Math.min(box.width / videoW, box.height / videoH);
  const w = videoW * s;
  const h = videoH * s;
  const ox = box.left + (box.width - w) / 2;
  const oy = box.top + (box.height - h) / 2;
  const x = (clientX - ox) / w;
  const y = (clientY - oy) / h;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;
  return { x, y };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

// ---------------------------------------------------------------- keys

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** DOM KeyboardEvent.code → X keysym name (for XTest through xdotool). */
export function xKeysym(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return `KP_${code.slice(6)}`;
  return X_NAMES[code];
}

const X_NAMES: Record<string, string> = {
  Enter: 'Return', Escape: 'Escape', Backspace: 'BackSpace', Tab: 'Tab', Space: 'space', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  ShiftLeft: 'Shift_L', ShiftRight: 'Shift_R', ControlLeft: 'Control_L', ControlRight: 'Control_R', AltLeft: 'Alt_L', AltRight: 'Alt_R',
  MetaLeft: 'Super_L', MetaRight: 'Super_R', CapsLock: 'Caps_Lock', ContextMenu: 'Menu', PrintScreen: 'Print', ScrollLock: 'Scroll_Lock', Pause: 'Pause',
  Minus: 'minus', Equal: 'equal', BracketLeft: 'bracketleft', BracketRight: 'bracketright', Backslash: 'backslash', Semicolon: 'semicolon',
  Quote: 'apostrophe', Backquote: 'grave', Comma: 'comma', Period: 'period', Slash: 'slash', IntlBackslash: 'less',
  NumpadEnter: 'KP_Enter', NumpadAdd: 'KP_Add', NumpadSubtract: 'KP_Subtract', NumpadMultiply: 'KP_Multiply', NumpadDivide: 'KP_Divide', NumpadDecimal: 'KP_Decimal', NumLock: 'Num_Lock',
  AudioVolumeUp: 'XF86AudioRaiseVolume', AudioVolumeDown: 'XF86AudioLowerVolume', AudioVolumeMute: 'XF86AudioMute',
  MediaPlayPause: 'XF86AudioPlay', MediaTrackNext: 'XF86AudioNext', MediaTrackPrevious: 'XF86AudioPrev',
};

/** DOM code → Windows virtual-key code (SendInput). */
export function winVk(code: string): number | undefined {
  if (/^Key[A-Z]$/.test(code)) return 0x41 + LETTERS.indexOf(code.slice(3).toLowerCase());
  if (/^Digit\d$/.test(code)) return 0x30 + Number(code.slice(5));
  const f = code.match(/^F(\d{1,2})$/);
  if (f && +f[1] >= 1 && +f[1] <= 24) return 0x6f + Number(f[1]);
  if (/^Numpad\d$/.test(code)) return 0x60 + Number(code.slice(6));
  return WIN_VK[code];
}

const WIN_VK: Record<string, number> = {
  Enter: 0x0d, Escape: 0x1b, Backspace: 0x08, Tab: 0x09, Space: 0x20, Delete: 0x2e, Insert: 0x2d, Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
  ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28, ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3,
  AltLeft: 0xa4, AltRight: 0xa5, MetaLeft: 0x5b, MetaRight: 0x5c, CapsLock: 0x14, ContextMenu: 0x5d, PrintScreen: 0x2c, ScrollLock: 0x91, Pause: 0x13,
  Minus: 0xbd, Equal: 0xbb, BracketLeft: 0xdb, BracketRight: 0xdd, Backslash: 0xdc, Semicolon: 0xba, Quote: 0xde, Backquote: 0xc0, Comma: 0xbc, Period: 0xbe, Slash: 0xbf, IntlBackslash: 0xe2,
  NumpadEnter: 0x0d, NumpadAdd: 0x6b, NumpadSubtract: 0x6d, NumpadMultiply: 0x6a, NumpadDivide: 0x6f, NumpadDecimal: 0x6e, NumLock: 0x90,
  AudioVolumeUp: 0xaf, AudioVolumeDown: 0xae, AudioVolumeMute: 0xad, MediaPlayPause: 0xb3, MediaTrackNext: 0xb0, MediaTrackPrevious: 0xb1,
};

/** Windows keys that need the "extended" flag in SendInput. */
export const WIN_EXTENDED = new Set([0x2d, 0x2e, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28, 0xa3, 0xa5, 0x5b, 0x5c, 0x5d, 0x6f, 0x2c, 0x90]);

/** DOM code → macOS virtual key code (CGEvent, ANSI layout positions). */
export function macKeycode(code: string): number | undefined {
  return MAC_KC[code];
}

const MAC_KC: Record<string, number> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9, KeyB: 11, KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15,
  KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit6: 22, Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27,
  Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32, BracketLeft: 33, KeyI: 34, KeyP: 35, Enter: 36, KeyL: 37, KeyJ: 38, Quote: 39,
  KeyK: 40, Semicolon: 41, Backslash: 42, Comma: 43, Slash: 44, KeyN: 45, KeyM: 46, Period: 47, Tab: 48, Space: 49, Backquote: 50, Backspace: 51,
  Escape: 53, MetaRight: 54, MetaLeft: 55, ShiftLeft: 56, CapsLock: 57, AltLeft: 58, ControlLeft: 59, ShiftRight: 60, AltRight: 61, ControlRight: 62,
  F17: 64, NumpadDecimal: 65, NumpadMultiply: 67, NumpadAdd: 69, NumLock: 71, AudioVolumeUp: 72, AudioVolumeDown: 73, AudioVolumeMute: 74,
  NumpadDivide: 75, NumpadEnter: 76, NumpadSubtract: 78, F18: 79, F19: 80, Numpad0: 82, Numpad1: 83, Numpad2: 84, Numpad3: 85, Numpad4: 86,
  Numpad5: 87, Numpad6: 88, Numpad7: 89, F20: 90, Numpad8: 91, Numpad9: 92, F5: 96, F6: 97, F7: 98, F3: 99, F8: 100, F9: 101, F11: 103,
  F13: 105, F16: 106, F14: 107, F10: 109, ContextMenu: 110, F12: 111, F15: 113, Insert: 114, Home: 115, PageUp: 116, Delete: 117, F4: 118,
  End: 119, F2: 120, PageDown: 121, F1: 122, ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126, IntlBackslash: 10,
};

/** A special combination as the host's own key codes, pressed in order and released in reverse. */
export function comboKeys(combo: SpecialCombo, os: HostOs): string[] {
  const C: Record<SpecialCombo, Partial<Record<HostOs, string[]>>> = {
    'ctrl-alt-del': { win32: ['ControlLeft', 'AltLeft', 'Delete'], linux: ['ControlLeft', 'AltLeft', 'Delete'], darwin: ['MetaLeft', 'AltLeft', 'Escape'] },
    'task-manager': { win32: ['ControlLeft', 'ShiftLeft', 'Escape'], linux: ['ControlLeft', 'Escape'], darwin: ['MetaLeft', 'AltLeft', 'Escape'] },
    'alt-tab': { win32: ['AltLeft', 'Tab'], linux: ['AltLeft', 'Tab'], darwin: ['MetaLeft', 'Tab'] },
    'cmd-tab': { darwin: ['MetaLeft', 'Tab'], win32: ['AltLeft', 'Tab'], linux: ['AltLeft', 'Tab'] },
    win: { win32: ['MetaLeft'], linux: ['MetaLeft'], darwin: ['MetaLeft', 'Space'] },
    'cmd-space': { darwin: ['MetaLeft', 'Space'], win32: ['MetaLeft'], linux: ['MetaLeft'] },
    'show-desktop': { win32: ['MetaLeft', 'KeyD'], linux: ['MetaLeft', 'KeyD'], darwin: ['F11'] },
    lock: { win32: ['MetaLeft', 'KeyL'], linux: ['MetaLeft', 'KeyL'], darwin: ['ControlLeft', 'MetaLeft', 'KeyQ'] },
    print: { win32: ['PrintScreen'], linux: ['PrintScreen'], darwin: ['MetaLeft', 'ShiftLeft', 'Digit3'] },
  };
  return C[combo][os] ?? [];
}

/** Modifier keys implied by a key event, as DOM codes. */
export function modCodes(m: Mods | undefined): string[] {
  const out: string[] = [];
  if (m?.ctrl) out.push('ControlLeft');
  if (m?.alt) out.push('AltLeft');
  if (m?.shift) out.push('ShiftLeft');
  if (m?.meta) out.push('MetaLeft');
  return out;
}

// ---------------------------------------------------------------- safety

/** Checks one event from the network; anything malformed is dropped, never guessed at. */
export function sanitize(e: unknown): InputEvent | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  switch (o.t) {
    case 'move': {
      const x = num(o.x), y = num(o.y);
      return Number.isNaN(x) || Number.isNaN(y) ? null : { t: 'move', x: clamp01(x), y: clamp01(y) };
    }
    case 'down':
    case 'up': {
      const x = num(o.x), y = num(o.y), b = num(o.button);
      if (Number.isNaN(x) || Number.isNaN(y) || ![0, 1, 2].includes(b)) return null;
      return { t: o.t, x: clamp01(x), y: clamp01(y), button: b as 0 | 1 | 2 };
    }
    case 'wheel': {
      const x = num(o.x), y = num(o.y), dx = num(o.dx), dy = num(o.dy);
      if ([x, y, dx, dy].some(Number.isNaN)) return null;
      return { t: 'wheel', x: clamp01(x), y: clamp01(y), dx: Math.max(-20, Math.min(20, dx)), dy: Math.max(-20, Math.min(20, dy)) };
    }
    case 'key': {
      if (typeof o.code !== 'string' || !/^[A-Za-z0-9]{1,24}$/.test(o.code) || typeof o.down !== 'boolean') return null;
      const m = (o.mods && typeof o.mods === 'object' ? o.mods : {}) as Record<string, unknown>;
      return { t: 'key', code: o.code, down: o.down, mods: { ctrl: !!m.ctrl, alt: !!m.alt, shift: !!m.shift, meta: !!m.meta } };
    }
    case 'text':
      return typeof o.text === 'string' && o.text.length > 0 ? { t: 'text', text: o.text.slice(0, 2000) } : null;
    case 'combo': {
      const ok: SpecialCombo[] = ['ctrl-alt-del', 'alt-tab', 'cmd-tab', 'win', 'cmd-space', 'lock', 'print', 'task-manager', 'show-desktop'];
      return ok.includes(o.combo as SpecialCombo) ? { t: 'combo', combo: o.combo as SpecialCombo } : null;
    }
    default:
      return null;
  }
}

/** Keeps the latest pointer move and every other event, so a slow injector never falls behind. */
export function coalesce(events: InputEvent[]): InputEvent[] {
  const out: InputEvent[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (e.t === 'move' && last?.t === 'move') out[out.length - 1] = e;
    else out.push(e);
  }
  return out;
}
