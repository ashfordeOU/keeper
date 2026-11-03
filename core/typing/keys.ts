// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What was typed, from each system's key listener, as a few plain events:
// a character, Backspace, "start again" (Enter, arrows, a click, a shortcut)
// and a paste (⌘V / Ctrl+V). The macOS and Windows listeners turn keys into
// characters themselves with the keyboard layout in use and print lines
// ("t <json>", "k back", "k reset", "k paste"); on Linux the raw key codes
// are turned into characters here, with the X server's own layout table
// (xmodmap -pke) when there is one, and a US layout otherwise.

export type TypedEvent = { t: 'char'; c: string } | { t: 'back' } | { t: 'reset' } | { t: 'paste' };

/** One line from the macOS or Windows listener; null for anything else ("ready", noise). */
export function parseTypedLine(line: string): TypedEvent | null {
  const l = line.trim();
  if (l.startsWith('t ')) {
    try {
      const c = JSON.parse(l.slice(2));
      if (typeof c === 'string' && c) return { t: 'char', c };
    } catch { /* not JSON */ }
    return null;
  }
  if (l === 'k back') return { t: 'back' };
  if (l === 'k paste') return { t: 'paste' };
  if (l === 'k reset') return { t: 'reset' };
  return null;
}

// ---------------------------------------------------------------- Linux key codes

/** linux/input-event-codes.h: key code → [plain, with Shift] on a US keyboard. */
const US: Record<number, [string, string]> = {
  2: ['1', '!'], 3: ['2', '@'], 4: ['3', '#'], 5: ['4', '$'], 6: ['5', '%'], 7: ['6', '^'], 8: ['7', '&'], 9: ['8', '*'], 10: ['9', '('], 11: ['0', ')'],
  12: ['-', '_'], 13: ['=', '+'],
  16: ['q', 'Q'], 17: ['w', 'W'], 18: ['e', 'E'], 19: ['r', 'R'], 20: ['t', 'T'], 21: ['y', 'Y'], 22: ['u', 'U'], 23: ['i', 'I'], 24: ['o', 'O'], 25: ['p', 'P'],
  26: ['[', '{'], 27: [']', '}'],
  30: ['a', 'A'], 31: ['s', 'S'], 32: ['d', 'D'], 33: ['f', 'F'], 34: ['g', 'G'], 35: ['h', 'H'], 36: ['j', 'J'], 37: ['k', 'K'], 38: ['l', 'L'],
  39: [';', ':'], 40: ["'", '"'], 41: ['`', '~'], 43: ['\\', '|'],
  44: ['z', 'Z'], 45: ['x', 'X'], 46: ['c', 'C'], 47: ['v', 'V'], 48: ['b', 'B'], 49: ['n', 'N'], 50: ['m', 'M'],
  51: [',', '<'], 52: ['.', '>'], 53: ['/', '?'], 57: [' ', ' '], 86: ['<', '>'],
  55: ['*', '*'], 74: ['-', '-'], 78: ['+', '+'], 98: ['/', '/'],
  71: ['7', '7'], 72: ['8', '8'], 73: ['9', '9'], 75: ['4', '4'], 76: ['5', '5'], 77: ['6', '6'], 79: ['1', '1'], 80: ['2', '2'], 81: ['3', '3'], 82: ['0', '0'], 83: ['.', '.'],
};

const K = { backspace: 14, tab: 15, enter: 28, kpEnter: 96, leftCtrl: 29, rightCtrl: 97, leftShift: 42, rightShift: 54, leftAlt: 56, rightAlt: 100, leftMeta: 125, rightMeta: 126, capsLock: 58, esc: 1, v: 47 };
/** Keys that move the cursor or leave the field: start again. */
const RESET = new Set([K.enter, K.kpEnter, K.tab, K.esc, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);

/** X keysym names (xmodmap) for characters that are not their own name. */
const KEYSYM: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', apostrophe: "'", quoteright: "'", parenleft: '(', parenright: ')',
  asterisk: '*', plus: '+', comma: ',', minus: '-', period: '.', slash: '/', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@',
  bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', quoteleft: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  section: '§', degree: '°', sterling: '£', EuroSign: '€', yen: '¥', paragraph: '¶', ssharp: 'ß', mu: 'µ', twosuperior: '²', threesuperior: '³',
  adiaeresis: 'ä', odiaeresis: 'ö', udiaeresis: 'ü', Adiaeresis: 'Ä', Odiaeresis: 'Ö', Udiaeresis: 'Ü', aring: 'å', Aring: 'Å', ae: 'æ', AE: 'Æ', oslash: 'ø', Ooblique: 'Ø', Oslash: 'Ø',
  eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È', agrave: 'à', Agrave: 'À', ccedilla: 'ç', Ccedilla: 'Ç', ugrave: 'ù', ntilde: 'ñ', Ntilde: 'Ñ',
  KP_0: '0', KP_1: '1', KP_2: '2', KP_3: '3', KP_4: '4', KP_5: '5', KP_6: '6', KP_7: '7', KP_8: '8', KP_9: '9', KP_Decimal: '.', KP_Add: '+', KP_Subtract: '-', KP_Multiply: '*', KP_Divide: '/',
};

/** A keysym name as a character: "a" → a, "semicolon" → ;, "U00E9" → é; undefined for keys that type nothing. */
export function keysymChar(name: string): string | undefined {
  if (!name || name === 'NoSymbol') return undefined;
  if (name.length === 1) return name;
  if (/^[0-9]$/.test(name)) return name;
  const u = /^U([0-9A-Fa-f]{4,6})$/.exec(name);
  if (u) return String.fromCodePoint(parseInt(u[1], 16));
  return KEYSYM[name];
}

/** `xmodmap -pke`: X keycode → [plain, with Shift] characters, for keys that type something. */
export function parseXmodmap(text: string): Map<number, [string, string]> {
  const out = new Map<number, [string, string]>();
  for (const line of text.split('\n')) {
    const m = /^keycode\s+(\d+)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const syms = m[2].trim().split(/\s+/);
    const plain = keysymChar(syms[0] ?? '');
    if (!plain) continue;
    const shifted = keysymChar(syms[1] ?? '') ?? (plain.length === 1 ? plain.toUpperCase() : plain);
    out.set(Number(m[1]), [plain, shifted]);
  }
  return out;
}

/**
 * Turns Linux key presses and releases (evdev codes) into typed events,
 * keeping track of Shift, Ctrl, Alt, the Super key and Caps Lock.
 */
export class LinuxKeyReader {
  private shift = 0;
  private ctrl = 0;
  private alt = 0;
  private meta = 0;
  private caps = false;
  private down = new Set<number>();

  /** layout: X keycode (evdev + 8) → characters, from xmodmap; a US layout without it. */
  constructor(private layout?: Map<number, [string, string]>) {}

  key(code: number, isDown: boolean): TypedEvent | null {
    const mod = (n: number) => (isDown ? (this.down.has(code) ? n : n + 1) : Math.max(0, n - 1));
    if (code === K.leftShift || code === K.rightShift) { this.shift = mod(this.shift); this.track(code, isDown); return null; }
    if (code === K.leftCtrl || code === K.rightCtrl) { this.ctrl = mod(this.ctrl); this.track(code, isDown); return null; }
    if (code === K.leftAlt || code === K.rightAlt) { this.alt = mod(this.alt); this.track(code, isDown); return null; }
    if (code === K.leftMeta || code === K.rightMeta) { this.meta = mod(this.meta); this.track(code, isDown); return null; }
    this.track(code, isDown);
    if (!isDown) return null;
    if (code === K.capsLock) { this.caps = !this.caps; return null; }
    if ((this.ctrl || this.meta) && code === K.v) return { t: 'paste' };
    if (this.ctrl || this.meta || this.alt) return { t: 'reset' };
    if (code === K.backspace) return { t: 'back' };
    if (RESET.has(code)) return { t: 'reset' };
    const pair = this.layout?.get(code + 8) ?? US[code];
    if (!pair) return { t: 'reset' };
    const letter = pair[0].length === 1 && pair[0].toLowerCase() !== pair[0].toUpperCase();
    const shifted = this.shift > 0 !== (this.caps && letter);
    return { t: 'char', c: shifted ? pair[1] : pair[0] };
  }

  private track(code: number, isDown: boolean) {
    if (isDown) this.down.add(code);
    else this.down.delete(code);
  }
}
