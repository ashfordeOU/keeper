// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keys as VNC wants them (X11 keysyms), from the browser's KeyboardEvent, and
// the special key combinations the toolbar sends (Ctrl+Alt+Del and friends).

const NAMED: Record<string, number> = {
  Backspace: 0xff08, Tab: 0xff09, Enter: 0xff0d, Escape: 0xff1b, Insert: 0xff63, Delete: 0xffff,
  Home: 0xff50, End: 0xff57, PageUp: 0xff55, PageDown: 0xff56,
  ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54,
  CapsLock: 0xffe5, NumLock: 0xff7f, ScrollLock: 0xff14, PrintScreen: 0xff61, Pause: 0xff13,
  ContextMenu: 0xff67, AltGraph: 0xfe03, Dead: 0, Unidentified: 0,
};

const BY_CODE: Record<string, number> = {
  ShiftLeft: 0xffe1, ShiftRight: 0xffe2, ControlLeft: 0xffe3, ControlRight: 0xffe4,
  AltLeft: 0xffe9, AltRight: 0xffea, MetaLeft: 0xffeb, MetaRight: 0xffec, OSLeft: 0xffeb, OSRight: 0xffec,
  NumpadEnter: 0xff8d, NumpadAdd: 0xffab, NumpadSubtract: 0xffad, NumpadMultiply: 0xffaa, NumpadDivide: 0xffaf, NumpadDecimal: 0xffae,
};

/** The keysym for a key press, or 0 when there is nothing to send. */
export function keysymFor(e: { key: string; code?: string }): number {
  if (e.code && BY_CODE[e.code] && !(e.code.startsWith('Numpad') && e.key.length === 1 && /\d/.test(e.key))) return BY_CODE[e.code];
  if (e.key === 'Shift') return 0xffe1;
  if (e.key === 'Control') return 0xffe3;
  if (e.key === 'Alt') return 0xffe9;
  if (e.key === 'Meta' || e.key === 'OS') return 0xffeb;
  const f = /^F(\d{1,2})$/.exec(e.key);
  if (f && Number(f[1]) >= 1 && Number(f[1]) <= 24) return 0xffbe + Number(f[1]) - 1;
  if (e.key in NAMED) return NAMED[e.key];
  const cps = [...e.key];
  if (cps.length === 1) {
    const cp = cps[0].codePointAt(0)!;
    if (cp < 0x20) return 0;
    // Latin-1 keysyms are the code point; everything else is Unicode keysym 0x01000000 + code point.
    return cp <= 0xff ? cp : 0x01000000 + cp;
  }
  return 0;
}

export const COMBOS: Record<string, { label: string; keys: number[] }> = {
  cad: { label: 'Ctrl+Alt+Del', keys: [0xffe3, 0xffe9, 0xffff] },
  cae: { label: 'Ctrl+Alt+End', keys: [0xffe3, 0xffe9, 0xff57] },
  win: { label: 'Windows / Super', keys: [0xffeb] },
  alttab: { label: 'Alt+Tab', keys: [0xffe9, 0xff09] },
  esc: { label: 'Esc', keys: [0xff1b] },
  prtsc: { label: 'Print Screen', keys: [0xff61] },
  cf1: { label: 'Ctrl+Alt+F1', keys: [0xffe3, 0xffe9, 0xffbe] },
  cf2: { label: 'Ctrl+Alt+F2', keys: [0xffe3, 0xffe9, 0xffbf] },
};

/** Presses keys in order and lets them go in reverse, as a person would. */
export function comboEvents(keys: number[]): { keysym: number; down: boolean }[] {
  return [...keys.map((k) => ({ keysym: k, down: true })), ...keys.slice().reverse().map((k) => ({ keysym: k, down: false }))];
}

/** Mouse buttons to the RFB mask: left 1, middle 2, right 4, wheel up 8, down 16, left 32, right 64. */
export function buttonMask(buttons: number): number {
  // DOM: 1 left, 2 right, 4 middle.
  return (buttons & 1 ? 1 : 0) | (buttons & 4 ? 2 : 0) | (buttons & 2 ? 4 : 0);
}
