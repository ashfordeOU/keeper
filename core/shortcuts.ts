// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Global shortcuts: how two spellings of one key combination compare, how a
// combination reads on this computer, and what the main process reports for
// each one it tried to register (so Settings → Shortcuts can say "taken by…").

export interface ShortcutStatus {
  /** what the shortcut does, in plain words ("Quick Search", "Studio: record") */
  owner: string;
  accelerator: string;
  /** ok: works; taken: another shortcut or app has it; invalid: not a key combination the system accepts */
  state: 'ok' | 'taken' | 'invalid';
  /** for taken: the Keeper shortcut that has it, or "another app" */
  takenBy?: string;
}

const MOD_ORDER = ['ctrl', 'alt', 'shift', 'super'];

/**
 * One spelling for a combination, so "CmdOrCtrl+Shift+2" and "Shift+CommandOrControl+2"
 * compare equal. CommandOrControl is ⌘ on a Mac and Ctrl elsewhere.
 */
export function normalizeAccel(acc: string, platform: string): string {
  const mac = platform === 'darwin';
  const parts = acc.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  // "+" itself as the key ("Ctrl++") leaves an empty last part.
  const key = acc.trim().endsWith('++') ? 'plus' : parts.pop()!.toLowerCase();
  const mods = new Set<string>();
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === 'commandorcontrol' || p === 'cmdorctrl') mods.add(mac ? 'super' : 'ctrl');
    else if (p === 'command' || p === 'cmd' || p === 'super' || p === 'meta') mods.add('super');
    else if (p === 'control' || p === 'ctrl') mods.add('ctrl');
    else if (p === 'alt' || p === 'option' || p === 'altgr') mods.add('alt');
    else if (p === 'shift') mods.add('shift');
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+');
}

/** "⌘⇧Space" on a Mac, "Ctrl+Shift+Space" elsewhere. Never "CommandOrControl". */
export function accelLabel(acc: string, platform: string): string {
  const n = normalizeAccel(acc, platform);
  if (!n) return '';
  const parts = n.split('+');
  const key = parts.pop()!;
  const name = key === 'plus' ? '+' : key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
  if (platform === 'darwin') return parts.map((m) => ({ ctrl: '⌃', alt: '⌥', shift: '⇧', super: '⌘' })[m]).join('') + name;
  return [...parts.map((m) => ({ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Win' })[m]), name].join('+');
}

/** Turns a key press into an accelerator the system understands ("CommandOrControl+Shift+K"); null for a lone modifier. */
export function accelFromKey(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, platform: string): string | null {
  if (/^(Shift|Control|Alt|Meta|OS|AltGraph|CapsLock|Fn)$/.test(e.key)) return null;
  const mac = platform === 'darwin';
  const mods: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
  if (mac && e.ctrlKey) mods.push('Control');
  if (!mac && e.metaKey) mods.push('Super');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (!mods.length) return null;
  // The physical key, so Shift+2 stays "2" rather than "@".
  const code = e.code ?? '';
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3)
    : /^Digit\d$/.test(code) ? code.slice(5)
      : code === 'Space' || e.key === ' ' ? 'Space'
        : /^F\d{1,2}$/.test(e.key) ? e.key
          : ({ ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Escape', Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab' } as Record<string, string>)[e.key]
            ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return [...mods, key].join('+');
}

/**
 * Keeps track of which of Keeper's own shortcuts holds a key combination while
 * they are registered one after another, so the second one asking for it is
 * reported as "taken by <the first>" instead of failing without a word.
 */
export class ShortcutBook {
  private held = new Map<string, string>();
  private list: ShortcutStatus[] = [];
  constructor(private platform: string) {}

  reset() { this.held.clear(); this.list = []; }

  /** register: the system call; returns false when another app holds the keys, throws when they are not valid */
  claim(acc: string, owner: string, register: () => boolean, heldElsewhereInKeeper = false): boolean {
    if (!acc) return false;
    const key = normalizeAccel(acc, this.platform);
    const prev = this.held.get(key);
    // The same shortcut registered again (its page saved its options): it still works.
    if (prev === owner) {
      this.record({ owner, accelerator: acc, state: 'ok' });
      return true;
    }
    if (prev !== undefined || heldElsewhereInKeeper) {
      this.record({ owner, accelerator: acc, state: 'taken', takenBy: prev ?? 'another Keeper shortcut' });
      return false;
    }
    let ok = false;
    try {
      ok = register();
    } catch {
      this.record({ owner, accelerator: acc, state: 'invalid' });
      return false;
    }
    if (ok) this.held.set(key, owner);
    this.record(ok ? { owner, accelerator: acc, state: 'ok' } : { owner, accelerator: acc, state: 'taken', takenBy: 'another app' });
    return ok;
  }

  private record(s: ShortcutStatus) {
    this.list = [...this.list.filter((x) => x.owner !== s.owner), s];
  }

  status(): ShortcutStatus[] { return this.list; }
}
