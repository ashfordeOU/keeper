// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Key presses and clicks anywhere on the screen, for Stage's keystroke and
// click overlays. Runs only while one of them is on, and stops with it.

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { screen } from 'electron';
import { run } from '../../../core/platform';
import { parseMacEvent, parseWinHookLine, parseXmodmap, WIN_HOOK, XinputParser, type InputEvent } from '../../../core/stage/keys';

export interface EventSource { stop(): void; error?: string }

/** Starts listening; `onEvent` gets each key press and click (clicks with screen coordinates). */
export async function listen(onEvent: (e: InputEvent) => void): Promise<EventSource> {
  const withPoint = (e: InputEvent): InputEvent => (e.t === 'click' && e.x === undefined ? { ...e, ...screen.getCursorScreenPoint() } : e);
  if (process.platform === 'darwin') {
    const { macHelperStream } = await import('../platform/mac');
    const ac = new AbortController();
    const src: EventSource = { stop: () => ac.abort() };
    macHelperStream('stage.events', {}, (text) => { const e = parseMacEvent(text); if (e) onEvent(e); }, ac.signal)
      .catch((e: unknown) => { src.error = e instanceof Error ? e.message : String(e); });
    return src;
  }
  if (process.platform === 'win32') {
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_HOOK], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    // The hook reports physical pixels; the overlays work in the screen's own points.
    return fromLines(child, (line) => { const e = parseWinHookLine(line); if (e) onEvent(e.t === 'click' && e.x !== undefined && e.y !== undefined ? { ...e, ...screen.screenToDipPoint({ x: e.x, y: e.y }) } : e); });
  }
  if (!process.env.DISPLAY) return { stop: () => undefined, error: 'Keystrokes and clicks need X11 (Wayland does not share them with apps)' };
  const keymap = parseXmodmap((await run('xmodmap', ['-pke'], 5000)).stdout);
  const child = spawn('xinput', ['test-xi2', '--root'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const parser = new XinputParser(keymap, (e) => onEvent(withPoint(e)));
  child.stdout?.on('data', (d: Buffer) => parser.push(d.toString('utf8')));
  const src: EventSource = { stop: () => { try { child.kill(); } catch { /* gone */ } } };
  child.on('error', () => { src.error = 'Install xinput to show keystrokes and clicks'; });
  return src;
}

function fromLines(child: ChildProcess, onLine: (l: string) => void): EventSource {
  let buf = '';
  child.stdout?.on('data', (d: Buffer) => {
    buf += d.toString('utf8');
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    lines.forEach(onLine);
  });
  const src: EventSource = { stop: () => { try { child.kill(); } catch { /* gone */ } } };
  child.on('error', (e) => { src.error = e.message; });
  return src;
}
