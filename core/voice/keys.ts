// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The talk key: hold to talk, tap to lock on (tap again to finish), Esc to
// throw the take away. Pure: the native key hooks only report presses and
// releases; this decides what they mean.

export type KeyAction = 'start' | 'stop' | 'cancel' | 'lock' | 'none';
export type KeyPhase = 'idle' | 'holding' | 'locked' | 'handsfree';

export interface KeyMachineOptions {
  mode: 'hold' | 'toggle' | 'handsfree';
  doubleTapLatch: boolean;
  /** a press shorter than this is a tap */
  tapMs?: number;
}

export class KeyMachine {
  phase: KeyPhase = 'idle';
  private downAt = 0;
  private isDown = false;

  constructor(public o: KeyMachineOptions) {}

  /** The talk key went down. */
  down(at: number): KeyAction {
    if (this.isDown) return 'none'; // key repeat
    this.isDown = true;
    this.downAt = at;
    if (this.phase === 'idle') {
      if (this.o.mode === 'handsfree') { this.phase = 'handsfree'; return 'start'; }
      this.phase = this.o.mode === 'toggle' ? 'locked' : 'holding';
      return 'start';
    }
    // a press while locked (or hands-free) finishes the take
    if (this.phase === 'locked' || this.phase === 'handsfree') { this.phase = 'idle'; return 'stop'; }
    return 'none';
  }

  /** The talk key came up. */
  up(at: number): KeyAction {
    if (!this.isDown) return 'none';
    this.isDown = false;
    if (this.phase !== 'holding') return 'none';
    const held = at - this.downAt;
    if (held < (this.o.tapMs ?? 300)) {
      // a tap: lock on and keep listening, or (without latching) a press too short to say anything
      if (this.o.doubleTapLatch) { this.phase = 'locked'; return 'lock'; }
      this.phase = 'idle';
      return 'cancel';
    }
    this.phase = 'idle';
    return 'stop';
  }

  /** Esc while listening. */
  escape(): KeyAction {
    if (this.phase === 'idle') return 'none';
    this.phase = 'idle';
    this.isDown = false;
    return 'cancel';
  }

  /** The take ended some other way (silence, time limit, the page's button). */
  reset() {
    this.phase = 'idle';
    this.isDown = false;
  }
}

/** Key names each hook reports, mapped to the setting's names. */
export const KEY_CODES = {
  // macOS virtual key codes (Carbon kVK_*)
  mac: { fn: 63, rightAlt: 61, rightCtrl: 62, rightMeta: 54, rightShift: 60, capsLock: 57, f13: 105, f14: 107, f15: 113, f16: 106, f17: 64, f18: 79, f19: 80, f5: 96, f9: 101, scrollLock: 107, pause: 113 } as Record<string, number>,
  // Windows virtual-key codes (VK_*)
  win: { fn: -1, rightAlt: 0xa5, rightCtrl: 0xa3, rightMeta: 0x5c, rightShift: 0xa1, capsLock: 0x14, f13: 0x7c, f14: 0x7d, f15: 0x7e, f16: 0x7f, f17: 0x80, f18: 0x81, f19: 0x82, f5: 0x74, f9: 0x78, scrollLock: 0x91, pause: 0x13 } as Record<string, number>,
  // Linux input event codes (linux/input-event-codes.h)
  linux: { fn: 464, rightAlt: 100, rightCtrl: 97, rightMeta: 126, rightShift: 54, capsLock: 58, f13: 183, f14: 184, f15: 185, f16: 186, f17: 187, f18: 188, f19: 189, f5: 63, f9: 67, scrollLock: 70, pause: 119 } as Record<string, number>,
  // X11 keysym names (for the XRecord / xinput fallback)
  x11: { fn: 'XF86WakeUp', rightAlt: 'Alt_R', rightCtrl: 'Control_R', rightMeta: 'Super_R', rightShift: 'Shift_R', capsLock: 'Caps_Lock', f13: 'F13', f14: 'F14', f15: 'F15', f16: 'F16', f17: 'F17', f18: 'F18', f19: 'F19', f5: 'F5', f9: 'F9', scrollLock: 'Scroll_Lock', pause: 'Pause' } as Record<string, string>,
};

/** Esc on each system. */
export const ESC_CODES = { mac: 53, win: 0x1b, linux: 1, x11: 'Escape' };

/**
 * One line from `xinput test-xi2 --root` style output, or the evdev reader
 * ("key 97 down") — what the Linux hooks print.
 */
export function parseHookLine(line: string): { code: string; down: boolean } | null {
  const m = /^key\s+(\S+)\s+(down|up)\b/.exec(line.trim());
  return m ? { code: m[1], down: m[2] === 'down' } : null;
}

/**
 * Linux input events read straight from /dev/input/eventN: 24 bytes each on
 * 64-bit systems (time, type, code, value). Key events are type 1; value 1 is
 * a press, 0 a release, 2 a repeat (ignored).
 */
export function parseInputEvents(buf: Uint8Array, recordSize = 24): { code: number; down: boolean }[] {
  const out: { code: number; down: boolean }[] = [];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const off = recordSize - 8;
  for (let i = 0; i + recordSize <= buf.length; i += recordSize) {
    const type = dv.getUint16(i + off, true);
    const code = dv.getUint16(i + off + 2, true);
    const value = dv.getInt32(i + off + 4, true);
    if (type === 1 && value !== 2) out.push({ code, down: value === 1 });
  }
  return out;
}

/** Keyboards in /proc/bus/input/devices (devices that have an event handler and real keys). */
export function keyboardsFromProcDevices(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const ev = /B: EV=([0-9a-f]+)/i.exec(block)?.[1];
    const handler = /H: Handlers=.*\b(event\d+)\b/.exec(block)?.[1];
    if (!ev || !handler) continue;
    // EV_KEY (bit 1) and EV_REP (bit 20) together mark a keyboard; mice and buttons have no repeat
    const bits = parseInt(ev, 16);
    if (bits & 0x2 && bits & 0x100000 && /kbd/.test(block)) out.push(`/dev/input/${handler}`);
  }
  return out;
}

/**
 * Reads `xinput test-xi2 --root` (X11): raw key presses and releases from
 * every app. Feed it lines; it calls back with X keycodes (evdev code + 8).
 */
export class Xi2Reader {
  private type: 'press' | 'release' | null = null;
  constructor(private on: (keycode: number, down: boolean) => void) {}
  line(l: string) {
    const ev = /EVENT type \d+ \((Raw)?Key(Press|Release)\)/.exec(l);
    if (ev) { this.type = ev[2] === 'Press' ? 'press' : 'release'; return; }
    if (/^EVENT type/.test(l)) { this.type = null; return; }
    const d = /^\s*detail:\s*(\d+)/.exec(l);
    if (d && this.type) { this.on(Number(d[1]), this.type === 'press'); this.type = null; }
  }
}
