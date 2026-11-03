// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The selection bar: select text in any app, press the shortcut, and a small
// bar beside the pointer offers Copy, Search, Translate, Rewrite, Define and
// Open link. The selection is read through the system's accessibility
// interface where it can be (macOS: the focused element's selected text;
// Windows: UI Automation's text selection; Linux: the X11/Wayland primary
// selection), and otherwise by copying it (the clipboard is put back). AI
// actions use the AI chosen in Settings → AI, which may run on this computer;
// nothing is sent until a button is pressed. Results come back in the bar
// with Replace (pasted over the selection) and Copy.

import { app, BrowserWindow, screen, shell } from 'electron';
import { actionsFor, cleanReply, linkIn, mailIn, normalizeSelection, searchLink, SELECTION_MAX, selectionPrompt, targetLanguage, type SelectionActionId, type SelectionView } from '../../core/selection';
import { powershell, run } from '../../core/platform';
import { writeText } from './clip';
import { frontmostApp } from './devices';
import { featureOn, onFeature } from './features';
import { keepUnmanaged, overlayOptions } from './unmanaged';
import { insertText, readSelection } from './voice/insert';
import { settings } from '../store';

export interface SelectionDeps {
  preload: string;
  lockDown: (win: BrowserWindow) => void;
  load: (win: BrowserWindow, view: string) => void;
}

let deps: SelectionDeps | null = null;
let win: BrowserWindow | null = null;
let current: SelectionView | null = null;
const W = 460;
const H_BAR = 132;

// ---------------------------------------------------------------- reading the selection

async function viaAccessibility(): Promise<string> {
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to tell (first application process whose frontmost is true) to get value of attribute "AXSelectedText" of (value of attribute "AXFocusedUIElement")'], 1500);
    const t = r.ok ? r.stdout.replace(/\n$/, '') : '';
    return t === 'missing value' ? '' : t;
  }
  if (process.platform === 'win32') {
    const r = await powershell(`Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes
$e = [System.Windows.Automation.AutomationElement]::FocusedElement
$p = $null
if ($e -and $e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$p)) { $s = $p.GetSelection(); if ($s.Length) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $s[0].GetText(${SELECTION_MAX}) } }`, 4000);
    return r.ok ? r.stdout.replace(/\r?\n$/, '') : '';
  }
  return '';
}

declare const __KEEPER_OFFICIAL__: boolean | undefined;
/** Tests only (never in official builds): KEEPER_TEST_SELECTION stands in for the selected text under a virtual display. */
const TEST_SELECTION = () => ((typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__) ? undefined : process.env.KEEPER_TEST_SELECTION);

/** The selected text in the app in front, and how it was read. */
export async function readSelectedText(): Promise<{ text: string; how: SelectionView['how'] }> {
  const test = TEST_SELECTION();
  if (test !== undefined) return { text: test, how: 'accessibility' };
  const t = await viaAccessibility().catch(() => '');
  if (t.trim()) return { text: t.slice(0, SELECTION_MAX), how: 'accessibility' };
  if (process.platform === 'linux') {
    // The primary selection: what is selected now, without copying it.
    const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
    const tries: [string, string[]][] = wayland ? [['wl-paste', ['--primary', '--no-newline']], ['xclip', ['-o', '-selection', 'primary']]] : [['xclip', ['-o', '-selection', 'primary']], ['xsel', ['-o', '-p']]];
    for (const [cmd, args] of tries) {
      const r = await run(cmd, args, 1500).catch(() => null);
      if (r?.ok && r.stdout.trim()) return { text: r.stdout.slice(0, SELECTION_MAX), how: 'primary' };
    }
  }
  const c = await readSelection().catch(() => '');
  return c.trim() ? { text: c.slice(0, SELECTION_MAX), how: 'copy' } : { text: '', how: 'none' };
}

// ---------------------------------------------------------------- the AI

async function aiInfo(): Promise<SelectionView['ai']> {
  try {
    const { brainSettings } = await import('./brain');
    const b = brainSettings();
    const c = b.connections.find((x) => x.id === b.active);
    if (!c) return undefined;
    const local = c.kind === 'ollama' || c.kind === 'platform' || /\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(c.baseUrl ?? '');
    return { label: c.label, local };
  } catch {
    return undefined;
  }
}

async function askAI(action: 'translate' | 'rewrite' | 'shorter' | 'define', text: string, language: string): Promise<string> {
  const { brainSettings, providerForConnection } = await import('./brain');
  const p = await providerForConnection(brainSettings().active);
  const r = await p.chat([{ role: 'user', content: selectionPrompt(action, text, language) }], [], { maxTokens: 3000, signal: AbortSignal.timeout(90_000) });
  const out = cleanReply(r.text);
  if (!out) throw new Error('The AI gave no answer');
  return out;
}

// ---------------------------------------------------------------- the window

function position(h: number) {
  const p = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(p);
  const x = Math.min(Math.max(d.workArea.x + 8, p.x - W / 2), d.workArea.x + d.workArea.width - W - 8);
  // Below the pointer, or above it near the bottom of the screen.
  const below = p.y + 18;
  const y = below + h > d.workArea.y + d.workArea.height ? Math.max(d.workArea.y, p.y - h - 18) : below;
  return { x: Math.round(x), y: Math.round(y), width: W, height: h };
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    ...overlayOptions('selection'),
    width: W, height: H_BAR, frame: false, transparent: true, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true,
    fullscreenable: false, hasShadow: false, webPreferences: { preload: deps!.preload, contextIsolation: true, sandbox: true },
  });
  keepUnmanaged(win, 'selection');
  deps!.lockDown(win);
  deps!.load(win, 'selection');
  win.on('blur', () => { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); });
  win.on('closed', () => (win = null));
  return win;
}

/** Reads the selection and shows the bar beside the pointer. */
export async function showSelectionBar(): Promise<SelectionView> {
  if (!deps || !featureOn('selectionBar')) throw new Error('Selection actions are off');
  const s = normalizeSelection(settings().selection);
  const [{ text, how }, appName, ai] = await Promise.all([readSelectedText(), frontmostApp().catch(() => undefined), aiInfo()]);
  current = {
    text,
    app: appName,
    how,
    ai,
    language: targetLanguage(s.language, app.getLocale()),
    actions: actionsFor(text, s.actions, !!ai),
  };
  const w = ensureWindow();
  w.setBounds(position(H_BAR));
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const send = () => w.webContents.send('event:selection-changed');
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
  else send();
  w.show();
  w.focus();
  return current;
}

export function selectionCurrent(): SelectionView | null {
  return current;
}

/** Gives focus back to the app the text came from. */
async function hideBar() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  win.hide();
  if (process.platform === 'darwin') app.hide();
  await new Promise((r) => setTimeout(r, 160));
}

/** Runs an action on the current selection. AI actions return their result for the bar to show. */
export async function selectionRun(action: SelectionActionId): Promise<{ result?: string; done?: boolean }> {
  const c = current;
  if (!c?.text) throw new Error('No text is selected');
  const s = normalizeSelection(settings().selection);
  switch (action) {
    case 'copy':
      await writeText(c.text);
      await hideBar();
      return { done: true };
    case 'plain':
      await writeText(c.text);
      await hideBar();
      return { done: true };
    case 'search':
      await shell.openExternal(searchLink(s.searchUrl, c.text));
      await hideBar();
      return { done: true };
    case 'open': {
      const u = linkIn(c.text);
      if (!u) throw new Error('That is not a web address');
      await shell.openExternal(u);
      await hideBar();
      return { done: true };
    }
    case 'mail': {
      const m = mailIn(c.text);
      if (!m) throw new Error('That is not a mail address');
      await shell.openExternal(`mailto:${m}`);
      await hideBar();
      return { done: true };
    }
    case 'translate':
    case 'rewrite':
    case 'shorter':
    case 'define':
      return { result: await askAI(action, c.text, c.language) };
    default:
      throw new Error('Unknown action');
  }
}

/** Puts text over the selection in the app it came from. */
export async function selectionReplace(text: string) {
  await hideBar();
  await insertText(text, 'paste');
}

export async function selectionCopy(text: string) {
  await writeText(text);
  await hideBar();
}

export function selectionClose() {
  void hideBar();
}

/** The bar grows to show a result, and back. */
export function selectionResize(height: number) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const h = Math.max(80, Math.min(520, Math.round(height)));
  if (b.height !== h) win.setBounds({ ...b, height: h });
}

export function initSelectionBar(d: SelectionDeps) {
  deps = d;
  // Off: its window goes (it is made again on first use).
  onFeature('selectionBar', (on) => { if (!on && win && !win.isDestroyed()) { win.destroy(); win = null; current = null; } });
}
