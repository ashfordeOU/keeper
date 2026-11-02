// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Global shortcuts: Keeper's defaults never share keys, two spellings of one
// combination compare equal, and a clash is reported instead of swallowed.

import { describe, expect, it } from 'vitest';
import { accelFromKey, accelLabel, normalizeAccel, ShortcutBook } from '../core/shortcuts';
import { defaultIsland, defaultSettings } from '../core/settings';
import { defaultStudioOptions, normalizeStudioOptions } from '../core/studio/api';
import { defaultCaptureOptions } from '../core/capture';
import { DEFAULT_PLACES } from '../core/rdc/places';
import { defaultMonitorSettings } from '../core/monitor-tray';
import { defaultVoiceSettings } from '../core/voice/settings';
import { DEFAULT_PLATFORM } from '../core/platform-integrations';
import { defaultCueSettings } from '../core/cues/api';

describe('default global shortcuts', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    it(`never share keys on ${platform}`, () => {
      const isl = defaultIsland();
      const st = defaultStudioOptions();
      const cap = defaultCaptureOptions();
      const voice = defaultVoiceSettings(platform).dictation;
      const all: Record<string, string> = {
        'Quick Search': defaultSettings([], []).quickSearchShortcut,
        'Copy text from screen': isl.captureShortcut,
        'Studio: record': st.shortcut,
        'Studio: pause': st.pauseShortcut,
        'Clipboard history': isl.pasteShortcut,
        'Open the shelf': isl.shelfShortcut,
        'New task': isl.taskShortcut ?? '',
        'Hide the Island': isl.hideShortcut,
        'Keep awake': isl.awakeShortcut,
        'Open the Island': isl.openShortcut ?? '',
        Dictation: voice.shortcut,
        'Edit by voice': voice.editShortcut ?? '',
        Screenshot: cap.screenshotShortcut,
        'Record the screen': cap.recordShortcut,
        'Pick a color': cap.colorShortcut,
        'Remote Desktops: quick connect': DEFAULT_PLACES.accelerator,
        'Tool launcher': defaultMonitorSettings().launcherShortcut,
        'Ask Keeper': DEFAULT_PLATFORM.askShortcut,
        'New cue': defaultCueSettings().shortcut,
      };
      const seen = new Map<string, string>();
      const clashes: string[] = [];
      for (const [owner, acc] of Object.entries(all)) {
        if (!acc) continue;
        const k = normalizeAccel(acc, platform);
        if (seen.has(k)) clashes.push(`${owner} and ${seen.get(k)} both use ${acc}`);
        seen.set(k, owner);
      }
      expect(clashes).toEqual([]);
    });
  }

  it('Studio no longer records with Copy text from screen’s keys, and old options move over', () => {
    expect(normalizeAccel(defaultStudioOptions().shortcut, 'darwin')).not.toBe(normalizeAccel(defaultIsland().captureShortcut, 'darwin'));
    const moved = normalizeStudioOptions({ shortcut: 'CommandOrControl+Shift+2', pauseShortcut: 'CommandOrControl+Shift+3' });
    expect(moved.shortcut).toBe(defaultStudioOptions().shortcut);
    expect(moved.pauseShortcut).toBe(defaultStudioOptions().pauseShortcut);
    expect(normalizeStudioOptions({ shortcut: 'Alt+F9' }).shortcut).toBe('Alt+F9');
  });
});

describe('accelerators', () => {
  it('compare equal whatever the spelling', () => {
    expect(normalizeAccel('CmdOrCtrl+Shift+2', 'darwin')).toBe(normalizeAccel('Shift+Command+2', 'darwin'));
    expect(normalizeAccel('CommandOrControl+Shift+2', 'linux')).toBe(normalizeAccel('Ctrl+Shift+2', 'linux'));
    expect(normalizeAccel('CommandOrControl+Shift+2', 'linux')).not.toBe(normalizeAccel('Super+Shift+2', 'linux'));
  });
  it('read as keys, never CommandOrControl', () => {
    expect(accelLabel('CommandOrControl+Shift+Space', 'darwin')).toBe('⇧⌘Space');
    expect(accelLabel('CommandOrControl+Shift+Space', 'win32')).toBe('Ctrl+Shift+Space');
  });
  it('come from a key press', () => {
    expect(accelFromKey({ key: '@', code: 'Digit2', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }, 'darwin')).toBe('CommandOrControl+Shift+2');
    expect(accelFromKey({ key: 'Shift', code: 'ShiftLeft', metaKey: false, ctrlKey: false, altKey: false, shiftKey: true }, 'linux')).toBeNull();
    expect(accelFromKey({ key: 'k', code: 'KeyK', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, 'linux')).toBeNull();
  });
});

describe('ShortcutBook', () => {
  it('reports the second of two Keeper shortcuts on the same keys as taken by the first', () => {
    const book = new ShortcutBook('linux');
    const registered: string[] = [];
    const reg = (acc: string) => () => { registered.push(acc); return true; };
    expect(book.claim('CommandOrControl+Shift+2', 'Copy text from screen', reg('a'))).toBe(true);
    expect(book.claim('Ctrl+Shift+2', 'Studio: record', reg('b'))).toBe(false);
    expect(registered).toEqual(['a']);
    expect(book.status()).toContainEqual({ owner: 'Studio: record', accelerator: 'Ctrl+Shift+2', state: 'taken', takenBy: 'Copy text from screen' });
  });
  it('says when another app has the keys, or they are not valid', () => {
    const book = new ShortcutBook('linux');
    book.claim('Ctrl+Alt+S', 'Screenshot', () => false);
    book.claim('Ctrl+Nope', 'Broken', () => { throw new Error('bad'); });
    expect(book.status()).toEqual([
      { owner: 'Screenshot', accelerator: 'Ctrl+Alt+S', state: 'taken', takenBy: 'another app' },
      { owner: 'Broken', accelerator: 'Ctrl+Nope', state: 'invalid' },
    ]);
  });
  it('a shortcut registered again by its own owner still works', () => {
    const book = new ShortcutBook('linux');
    book.claim('Ctrl+Alt+S', 'Screenshot', () => true);
    expect(book.claim('Ctrl+Alt+S', 'Screenshot', () => false, true)).toBe(true);
    expect(book.status()).toEqual([{ owner: 'Screenshot', accelerator: 'Ctrl+Alt+S', state: 'ok' }]);
  });
});
