// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keyboard shortcuts written as text ("CmdOrCtrl+Shift+D") and matched against
// key presses, so people can change them in a simple editor.

export interface KeyCombo {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const ALIASES: Record<string, string> = {
  esc: 'escape', return: 'enter', del: 'delete', space: ' ', plus: '+', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright',
  pgup: 'pageup', pgdn: 'pagedown', backtick: '`', grave: '`',
};

/** Parses "CmdOrCtrl+Shift+D"; `mac` decides what CmdOrCtrl means. Returns null for nonsense. */
export function parseCombo(text: string, mac: boolean): KeyCombo | null {
  if (!text.trim()) return null;
  // "Ctrl++" means Ctrl and the plus key.
  const parts = text.replace(/\+\+$/, '+plus').split('+').map((p) => p.trim()).filter(Boolean);
  const c: KeyCombo = { key: '', ctrl: false, meta: false, alt: false, shift: false };
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === 'cmdorctrl' || p === 'commandorcontrol' || p === 'mod') {
      if (mac) c.meta = true;
      else c.ctrl = true;
    } else if (p === 'ctrl' || p === 'control') c.ctrl = true;
    else if (p === 'cmd' || p === 'command' || p === 'meta' || p === 'super' || p === 'win') c.meta = true;
    else if (p === 'alt' || p === 'option' || p === 'opt') c.alt = true;
    else if (p === 'shift') c.shift = true;
    else if (c.key) return null;
    else c.key = ALIASES[p] ?? p;
  }
  return c.key ? c : null;
}

/** The key a press stands for, independent of keyboard layout where possible. */
function keyOf(e: KeyLike): string {
  const k = e.key.toLowerCase();
  // With Alt (Option on a Mac) the character changes; use the physical key instead.
  if (e.code) {
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
    if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
    if (e.code === 'Backquote') return '`';
    if (e.code === 'Equal') return '=';
    if (e.code === 'Minus') return '-';
    if (e.code === 'BracketLeft') return '[';
    if (e.code === 'BracketRight') return ']';
  }
  return k;
}

export function matches(combo: KeyCombo, e: KeyLike): boolean {
  if (combo.ctrl !== e.ctrlKey || combo.meta !== e.metaKey || combo.alt !== e.altKey) return false;
  const k = keyOf(e);
  // Shift is implied by symbols like "+" on most layouts; only demand it when written.
  if (combo.shift !== e.shiftKey && !(combo.key === '+' || combo.key === '=')) return false;
  return k === combo.key || (combo.key === '=' && (k === '+' || k === '=')) || (combo.key === '+' && (k === '+' || k === '='));
}

/** The action bound to a key press, if any. */
export function actionFor(bindings: Record<string, string>, e: KeyLike, mac: boolean): string | undefined {
  for (const [action, text] of Object.entries(bindings)) {
    const c = parseCombo(text, mac);
    if (c && matches(c, e)) return action;
  }
  return undefined;
}

/** "⌘⇧D" on a Mac, "Ctrl+Shift+D" elsewhere. */
export function formatCombo(text: string, mac: boolean): string {
  const c = parseCombo(text, mac);
  if (!c) return text;
  const key = c.key.length === 1 ? c.key.toUpperCase() : c.key.replace(/^arrow/, '').replace(/^\w/, (x) => x.toUpperCase());
  if (mac) return `${c.ctrl ? '⌃' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.meta ? '⌘' : ''}${key === ' ' ? 'Space' : key}`;
  return [c.ctrl && 'Ctrl', c.meta && 'Win', c.alt && 'Alt', c.shift && 'Shift', key === ' ' ? 'Space' : key].filter(Boolean).join('+');
}

/** Turns a key press into the text form, for the "press the new shortcut" box. */
export function comboFromEvent(e: KeyLike, mac: boolean): string | null {
  const k = keyOf(e);
  if (['control', 'shift', 'alt', 'meta'].includes(k)) return null;
  const parts: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('CmdOrCtrl');
  if (mac && e.ctrlKey) parts.push('Ctrl');
  if (!mac && e.metaKey) parts.push('Super');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const name = k === ' ' ? 'Space' : k.startsWith('arrow') ? k.slice(5).replace(/^\w/, (x) => x.toUpperCase()) : k.length === 1 ? k.toUpperCase() : k.replace(/^\w/, (x) => x.toUpperCase());
  parts.push(name);
  return parts.join('+');
}

/** Bindings that share the same keys (so the editor can warn). */
export function conflicts(bindings: Record<string, string>, mac: boolean): [string, string][] {
  const out: [string, string][] = [];
  const entries = Object.entries(bindings);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = parseCombo(entries[i][1], mac);
      const b = parseCombo(entries[j][1], mac);
      if (a && b && JSON.stringify(a) === JSON.stringify(b)) out.push([entries[i][0], entries[j][0]]);
    }
  }
  return out;
}
