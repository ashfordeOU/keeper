// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Typed snippets: an abbreviation typed in any app becomes its text. The
// listener (typing.ts) runs only while this part is on and at least one
// snippet has something to type. When an abbreviation is typed, Keeper checks
// the app in front (your exclusions, Dictation's excluded apps) and that the
// field is not a password field, then removes the abbreviation with Backspace
// and pastes the text (the clipboard is put back), moving the cursor to
// {cursor} when the snippet has one.

import { appExcluded, findAbbreviation, needsClipboard, normalizeTyping, renderSnippet, TypedBuffer } from '../../core/typing/expand';
import type { TypedEvent } from '../../core/typing/keys';
import type { Snippet } from '../../core/voice/types';
import { powershell, run } from '../../core/platform';
import { readText } from './clip';
import { frontmostApp } from './devices';
import { featureOn, onFeature } from './features';
import { listen, listenStatus, quiet, unlisten, type ListenStatus } from './typing';
import { focusedIsSecure, insertText } from './voice/insert';
import { onVoiceSettings, voiceSettings } from './voice/store';
import { settings } from '../store';

const OWNER = 'snippets';
const buffer = new TypedBuffer(64);
let busy = false;
let lastStatus: ListenStatus = { on: false };
let onExpanded: (abbr: string) => void = () => {};

const typed = (): Snippet[] => voiceSettings().snippets.filter((s) => s.abbr && s.text);

/** Presses a key `n` times in the app in front (Backspace to remove the abbreviation, Left to place the cursor). */
async function press(key: 'back' | 'left', n: number) {
  if (n <= 0) return;
  if (process.platform === 'darwin') {
    const { macHelperCall } = await import('./platform/mac');
    const code = key === 'back' ? 51 : 123;
    try {
      for (let i = 0; i < n; i++) {
        await macHelperCall('input.key', { code, down: true }, 2000);
        await macHelperCall('input.key', { code, down: false }, 2000);
      }
      return;
    } catch { /* fall back to System Events */ }
    await run('/usr/bin/osascript', ['-e', `tell application "System Events" to repeat ${n} times\nkey code ${code}\nend repeat`]);
    return;
  }
  if (process.platform === 'win32') {
    await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{${key === 'back' ? 'BS' : 'LEFT'} ${n}}')`, 8000);
    return;
  }
  const name = key === 'back' ? 'BackSpace' : 'Left';
  if ((await run('xdotool', ['key', '--clearmodifiers', '--repeat', String(n), '--delay', '8', name], 8000)).ok) return;
  await run('wtype', Array.from({ length: n }, () => ['-k', name]).flat(), 8000);
}

async function expand(s: Snippet) {
  busy = true;
  try {
    const app = await frontmostApp().catch(() => undefined);
    const t = normalizeTyping(settings().typing);
    const voiceExcluded = voiceSettings().apps.filter((a) => a.exclude).map((a) => a.app);
    if (appExcluded(app, [...t.excludeApps, ...voiceExcluded])) return;
    // Never into a password field.
    if ((await focusedIsSecure()) === true) return;
    const r = renderSnippet(s.text, { now: new Date(), clipboard: needsClipboard(s.text) ? await readText() : undefined, snippets: voiceSettings().snippets });
    // Our own Backspaces, paste and arrows are not the person's typing.
    quiet(1500 + (s.abbr!.length + r.cursorBack) * 40);
    await press('back', s.abbr!.length);
    await insertText(r.text, 'paste');
    if (r.cursorBack) {
      await new Promise((res) => setTimeout(res, 120));
      await press('left', r.cursorBack);
    }
    onExpanded(s.abbr!);
  } finally {
    buffer.clear();
    busy = false;
  }
}

function onKey(e: TypedEvent) {
  if (busy) return;
  buffer.feed(e);
  if (e.t !== 'char') return;
  const s = findAbbreviation(buffer.text, typed());
  if (s) void expand(s).catch(() => undefined);
}

/** Listens while the part is on and there is something to type; stops otherwise. */
async function sync() {
  const want = featureOn('textSnippets') && typed().length > 0;
  if (want) lastStatus = await listen(OWNER, onKey);
  else { unlisten(OWNER); buffer.clear(); lastStatus = { on: false }; }
}

export function initSnippets(o: { expanded?: (abbr: string) => void } = {}) {
  if (o.expanded) onExpanded = o.expanded;
  onFeature('textSnippets', () => void sync(), { now: true });
  onVoiceSettings((next, prev) => {
    const had = prev.snippets.some((s) => s.abbr);
    const has = next.snippets.some((s) => s.abbr);
    if (had !== has) void sync();
  });
}

/** For the Text snippets page: is it listening, and if not, why. */
export async function snippetsStatus(): Promise<ListenStatus & { wanted: boolean; platform: string }> {
  const wanted = featureOn('textSnippets') && typed().length > 0;
  return { ...(wanted ? listenStatus().on ? listenStatus() : lastStatus : { on: false }), wanted, platform: process.platform };
}

/** Try again (after a permission was given). */
export async function restartSnippets(): Promise<ListenStatus> {
  unlisten(OWNER);
  await sync();
  return lastStatus;
}
