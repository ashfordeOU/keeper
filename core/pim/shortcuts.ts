// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keyboard shortcuts in Mail: three sets people already know (web mail with
// single letters, the desktop mail app with modifier keys, and a fast
// triage style) and the person's own changes on top.

export type MailAction =
  | 'next' | 'prev' | 'reply' | 'replyAll' | 'forward' | 'compose' | 'archive' | 'trash'
  | 'flag' | 'unread' | 'read' | 'snooze' | 'search' | 'select' | 'back' | 'important' | 'other' | 'followUp';

export type SchemeId = 'gmail' | 'apple' | 'superhuman';

export const ACTION_LABELS: Record<MailAction, string> = {
  next: 'Next message', prev: 'Previous message', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward', compose: 'New message',
  archive: 'Archive', trash: 'Delete', flag: 'Flag', unread: 'Mark as unread', read: 'Mark as read', snooze: 'Snooze', search: 'Search',
  select: 'Select', back: 'Back to the list', important: 'Show Important', other: 'Show Other', followUp: 'Follow up',
};

export const SCHEMES: Record<SchemeId, { label: string; keys: Partial<Record<MailAction, string[]>> }> = {
  gmail: {
    label: 'Web mail (single letters)',
    keys: {
      next: ['j', 'ArrowDown'], prev: ['k', 'ArrowUp'], reply: ['r'], replyAll: ['a'], forward: ['f'], compose: ['c', 'mod+n'], archive: ['e'], trash: ['#', 'Delete'],
      flag: ['s'], unread: ['shift+u'], read: ['shift+i'], snooze: ['b'], search: ['/'], select: ['x'], back: ['u', 'Escape'], important: ['g i'], other: ['g o'], followUp: ['shift+f'],
    },
  },
  apple: {
    label: 'Desktop mail (with ⌘ / Ctrl)',
    keys: {
      next: ['ArrowDown'], prev: ['ArrowUp'], reply: ['mod+r'], replyAll: ['mod+shift+r'], forward: ['mod+shift+f'], compose: ['mod+n'], archive: ['mod+ctrl+a'], trash: ['Delete', 'Backspace'],
      flag: ['mod+alt+l'], unread: ['mod+shift+u'], read: ['mod+shift+i'], snooze: ['mod+shift+s'], search: ['mod+alt+f'], back: ['Escape'], important: ['mod+alt+1'], other: ['mod+alt+2'],
    },
  },
  superhuman: {
    label: 'Fast triage (E done, H snooze)',
    keys: {
      next: ['j', 'ArrowDown'], prev: ['k', 'ArrowUp'], reply: ['r', 'Enter'], replyAll: ['a'], forward: ['f'], compose: ['c', 'mod+n'], archive: ['e'], trash: ['#'],
      flag: ['s'], unread: ['u'], read: ['shift+u'], snooze: ['h'], search: ['/'], select: ['x'], back: ['Escape'], important: ['tab'], other: ['shift+tab'], followUp: ['shift+f'],
    },
  },
};

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * A key press as text: "mod+shift+r", "#", "ArrowDown". "mod" is ⌘ on a Mac
 * and Ctrl elsewhere. Shift is left out for symbols it makes ("#", "?").
 */
export function comboOf(e: KeyLike, mac: boolean): string {
  const parts: string[] = [];
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (mod) parts.push('mod');
  if (mac && e.ctrlKey) parts.push('ctrl');
  if (!mac && e.metaKey) parts.push('meta');
  if (e.altKey) parts.push('alt');
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const letter = /^[a-z0-9]$/.test(k);
  if (e.shiftKey && (letter || e.key.length > 1)) parts.push('shift');
  parts.push(k === ' ' ? 'space' : e.key === 'Tab' ? 'tab' : k);
  return parts.join('+');
}

/** Every key bound to each action: the scheme's, with the person's own changes (empty = none). */
export function bindings(scheme: SchemeId, overrides: Partial<Record<MailAction, string>> = {}): Map<string, MailAction> {
  const out = new Map<string, MailAction>();
  const s = SCHEMES[scheme] ?? SCHEMES.gmail;
  const actions = new Set<MailAction>([...Object.keys(s.keys), ...Object.keys(overrides)] as MailAction[]);
  for (const a of actions) {
    const keys = overrides[a] !== undefined ? overrides[a]!.split(',').map((x) => x.trim()).filter(Boolean) : s.keys[a] ?? [];
    for (const k of keys) out.set(normal(k), a);
  }
  return out;
}

/** "Shift+U" and "shift+u" are the same; two-key sequences keep their space. */
function normal(k: string): string {
  return k.split(' ').map((step) => {
    const parts = step.split('+');
    const key = parts.pop()!;
    const mods = parts.map((p) => p.toLowerCase()).map((p) => (p === 'cmd' || p === 'ctrl/cmd' ? 'mod' : p));
    const order = ['mod', 'ctrl', 'meta', 'alt', 'shift'];
    mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return [...mods, key.length === 1 ? key.toLowerCase() : key].join('+');
  }).join(' ');
}

/**
 * Turns key presses into actions, including two-key sequences ("g i").
 * Returns the action, 'wait' when the press starts a sequence, or undefined.
 */
export function makeResolver(map: Map<string, MailAction>) {
  let pending = '';
  let pendingAt = 0;
  const starts = new Set([...map.keys()].filter((k) => k.includes(' ')).map((k) => k.split(' ')[0]));
  return (combo: string, now = Date.now()): MailAction | 'wait' | undefined => {
    if (pending && now - pendingAt < 1500) {
      const seq = `${pending} ${combo}`;
      pending = '';
      if (map.has(seq)) return map.get(seq);
    }
    pending = '';
    if (map.has(combo)) return map.get(combo);
    if (starts.has(combo)) {
      pending = combo;
      pendingAt = now;
      return 'wait';
    }
    return undefined;
  };
}

/** How a combo reads on this computer: "⌘⇧R" on a Mac, "Ctrl+Shift+R" elsewhere. */
export function showCombo(k: string, mac: boolean): string {
  return k.split(' ').map((step) => {
    const parts = step.split('+');
    const key = parts.pop()!;
    const name = ({ ArrowDown: '↓', ArrowUp: '↑', Escape: 'Esc', Delete: 'Del', Backspace: '⌫', Enter: '↩', tab: 'Tab' } as Record<string, string>)[key] ?? (key.length === 1 ? key.toUpperCase() : key);
    const mods = parts.map((p) => (mac ? ({ mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' } as Record<string, string>)[p] : ({ mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' } as Record<string, string>)[p]) ?? p);
    return mac ? [...mods, name].join('') : [...mods, name].join('+');
  }).join(' then ');
}

/**
 * The key shown on the New message button: the person's own choice, else the
 * one with ⌘ / Ctrl (⌘N, Ctrl+N), else the set's single letter.
 */
export function composeShortcut(scheme: SchemeId, overrides: Partial<Record<MailAction, string>> = {}, mac = false): string | undefined {
  const keys = [...bindings(scheme, overrides)].filter(([, a]) => a === 'compose').map(([k]) => k);
  const pick = overrides.compose !== undefined ? keys[0] : keys.find((k) => k.startsWith('mod+')) ?? keys[0];
  return pick ? showCombo(pick, mac) : undefined;
}
