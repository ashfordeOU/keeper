// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Control on Linux Wayland, through the desktop's own permission dialog: the
// xdg-desktop-portal RemoteDesktop portal (with ScreenCast for the stream the
// pointer positions refer to). The person sees the system dialog once; Keeper
// keeps the restore token it returns, so later sessions start without asking
// again until the person revokes it in the system settings.
//
// Pure: request paths, options, and DOM key codes → Linux (evdev) key codes.
// The D-Bus calls are in electron/services/screen/portal.ts.

export const PORTAL_BUS = 'org.freedesktop.portal.Desktop';
export const PORTAL_PATH = '/org/freedesktop/portal/desktop';
export const RD_IFACE = 'org.freedesktop.portal.RemoteDesktop';
export const SC_IFACE = 'org.freedesktop.portal.ScreenCast';

export const DEVICE_KEYBOARD = 1;
export const DEVICE_POINTER = 2;
export const SOURCE_MONITOR = 1;
/** persist_mode 2: until the person revokes it */
export const PERSIST_UNTIL_REVOKED = 2;

/** /org/freedesktop/portal/desktop/request/<sender>/<token>, where the sender is the unique bus name without ':' and with '.' → '_' */
export function requestPath(uniqueName: string, token: string): string {
  return `${PORTAL_PATH}/request/${uniqueName.replace(/^:/, '').replace(/\./g, '_')}/${token}`;
}

export function newToken(prefix = 'keeper'): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

/** Options for SelectDevices: keyboard and pointer, persistent, with the token from last time. */
export function selectDevicesOptions(token: string, restoreToken?: string): Record<string, [string, unknown]> {
  const o: Record<string, [string, unknown]> = {
    handle_token: ['s', token],
    types: ['u', DEVICE_KEYBOARD | DEVICE_POINTER],
    persist_mode: ['u', PERSIST_UNTIL_REVOKED],
  };
  if (restoreToken) o.restore_token = ['s', restoreToken];
  return o;
}

/** Options for ScreenCast.SelectSources on the remote desktop session: one monitor, pointer drawn in. */
export function selectSourcesOptions(token: string): Record<string, [string, unknown]> {
  return { handle_token: ['s', token], types: ['u', SOURCE_MONITOR], multiple: ['b', false], cursor_mode: ['u', 2] };
}

/** Portal response codes: 0 granted, 1 the person cancelled, 2 something else. */
export function responseError(code: number): string | null {
  if (code === 0) return null;
  if (code === 1) return 'Control was not allowed in the system dialog. The screen can still be watched.';
  return 'The system could not start remote control. The screen can still be watched.';
}

export interface PortalStream {
  node: number;
  /** size in logical pixels, when the portal says */
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}

/** The streams from Start's results ("streams": a(ua{sv})). */
export function parseStreams(v: unknown): PortalStream[] {
  if (!Array.isArray(v)) return [];
  const out: PortalStream[] = [];
  for (const s of v) {
    if (!Array.isArray(s) || typeof s[0] !== 'number') continue;
    const props = (s[1] ?? {}) as Record<string, { value?: unknown } | unknown>;
    const val = (k: string) => {
      const x = props[k] as { value?: unknown } | undefined;
      return x && typeof x === 'object' && 'value' in x ? x.value : x;
    };
    const size = val('size') as number[] | undefined;
    const pos = val('position') as number[] | undefined;
    out.push({ node: s[0], width: size?.[0], height: size?.[1], x: pos?.[0], y: pos?.[1] });
  }
  return out;
}

/** 0..1 across the shared screen → stream coordinates. */
export function toStream(x: number, y: number, s: PortalStream, fallback: { width: number; height: number }): { x: number; y: number } {
  const w = s.width ?? fallback.width;
  const h = s.height ?? fallback.height;
  return { x: Math.max(0, Math.min(w - 1, x * w)), y: Math.max(0, Math.min(h - 1, y * h)) };
}

/** Mouse buttons: DOM 0/1/2 → BTN_LEFT / BTN_MIDDLE / BTN_RIGHT. */
export function evdevButton(b: 0 | 1 | 2): number {
  return b === 0 ? 0x110 : b === 1 ? 0x112 : 0x111;
}

const LETTERS: Record<string, number> = { Q: 16, W: 17, E: 18, R: 19, T: 20, Y: 21, U: 22, I: 23, O: 24, P: 25, A: 30, S: 31, D: 32, F: 33, G: 34, H: 35, J: 36, K: 37, L: 38, Z: 44, X: 45, C: 46, V: 47, B: 48, N: 49, M: 50 };

const CODES: Record<string, number> = {
  Escape: 1, Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6, Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11,
  Minus: 12, Equal: 13, Backspace: 14, Tab: 15, BracketLeft: 26, BracketRight: 27, Enter: 28, ControlLeft: 29,
  Semicolon: 39, Quote: 40, Backquote: 41, ShiftLeft: 42, Backslash: 43, Comma: 51, Period: 52, Slash: 53, ShiftRight: 54,
  NumpadMultiply: 55, AltLeft: 56, Space: 57, CapsLock: 58, F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66, F9: 67, F10: 68,
  NumLock: 69, ScrollLock: 70, Numpad7: 71, Numpad8: 72, Numpad9: 73, NumpadSubtract: 74, Numpad4: 75, Numpad5: 76, Numpad6: 77, NumpadAdd: 78,
  Numpad1: 79, Numpad2: 80, Numpad3: 81, Numpad0: 82, NumpadDecimal: 83, IntlBackslash: 86, F11: 87, F12: 88, NumpadEnter: 96, ControlRight: 97,
  NumpadDivide: 98, PrintScreen: 99, AltRight: 100, Home: 102, ArrowUp: 103, PageUp: 104, ArrowLeft: 105, ArrowRight: 106, End: 107, ArrowDown: 108,
  PageDown: 109, Insert: 110, Delete: 111, AudioVolumeMute: 113, AudioVolumeDown: 114, AudioVolumeUp: 115, Pause: 119, MetaLeft: 125, MetaRight: 126,
  ContextMenu: 127, MediaPlayPause: 164, MediaTrackNext: 163, MediaTrackPrevious: 165,
};

/** A DOM KeyboardEvent.code → Linux input key code (as the portal wants), or null. */
export function evdevKey(code: string): number | null {
  const m = code.match(/^Key([A-Z])$/);
  if (m) return LETTERS[m[1]] ?? null;
  return CODES[code] ?? null;
}

/** What the viewer is told when control cannot work on this Wayland desktop. */
export const WAYLAND_VIEW_ONLY = 'This Linux desktop (Wayland) lets other apps control it only through its own permission dialog, which was not available or was declined. You can watch the screen.';
