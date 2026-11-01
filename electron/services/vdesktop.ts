// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A desktop of its own for an AI's app tasks, so the person keeps working on
// theirs. On Linux each task gets a private virtual display (Xvfb); apps are
// started on it and driven with xdotool, and the person can watch it from
// Keeper. Windows and macOS do not let one app run other apps on a hidden
// desktop safely, so there web tasks use Keeper's browser (hidden tabs) and
// app tasks run on the real screen with the Island showing what is going on.

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface VirtualDesktop {
  id: string;
  display: string;
  width: number;
  height: number;
  proc: ChildProcess;
  apps: ChildProcess[];
  client: string;
  started: number;
}

const desktops = new Map<string, VirtualDesktop>();

export function virtualDesktopSupport(): { ok: boolean; why?: string } {
  if (process.platform !== 'linux') return { ok: false, why: process.platform === 'darwin' ? 'macOS does not allow apps on a hidden desktop; app tasks use the real screen with the Island showing it, web tasks use hidden browser tabs' : 'On Windows, apps on a hidden desktop cannot get real input or be seen reliably (input goes only to the desktop in front, and hidden windows are not drawn), so app tasks use the real screen with the Island showing it, and web tasks use hidden browser tabs' };
  if (!['/usr/bin/Xvfb', '/usr/local/bin/Xvfb'].some(existsSync)) return { ok: false, why: 'Xvfb is not installed (sudo apt install xvfb)' };
  if (!['/usr/bin/xdotool', '/usr/local/bin/xdotool'].some(existsSync)) return { ok: false, why: 'xdotool is not installed (sudo apt install xdotool)' };
  return { ok: true };
}

const run = (cmd: string, args: string[], display: string, input?: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    const p = execFile(cmd, args, { env: { ...process.env, DISPLAY: display }, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 15000 }, (err, out) => (err ? reject(err) : resolve(out)));
    if (input) p.stdin?.end(input);
  });

export function desktopsFor(client?: string): VirtualDesktop[] {
  return [...desktops.values()].filter((d) => !client || d.client === client);
}

export async function startDesktop(client: string, width = 1280, height = 800): Promise<VirtualDesktop> {
  const s = virtualDesktopSupport();
  if (!s.ok) throw new Error(s.why);
  let n = 90;
  while (existsSync(`/tmp/.X11-unix/X${n}`) || existsSync(`/tmp/.X${n}-lock`)) n++;
  const display = `:${n}`;
  const proc = spawn('Xvfb', [display, '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !existsSync(`/tmp/.X11-unix/X${n}`); i++) await new Promise((r) => setTimeout(r, 100));
  const d: VirtualDesktop = { id: `vd${n}`, display, width, height, proc, apps: [], client, started: Date.now() };
  desktops.set(d.id, d);
  proc.on('exit', () => desktops.delete(d.id));
  return d;
}

export function openOn(d: VirtualDesktop, command: string, args: string[] = []): ChildProcess {
  const p = spawn(command, args, { env: { ...process.env, DISPLAY: d.display }, stdio: 'ignore', detached: false });
  p.on('error', () => undefined);
  d.apps.push(p);
  return p;
}

export async function shotOf(d: VirtualDesktop): Promise<Buffer> {
  return run('import', ['-window', 'root', 'png:-'], d.display);
}

export async function clickOn(d: VirtualDesktop, x: number, y: number, button = 1) {
  await run('xdotool', ['mousemove', '--sync', String(Math.round(x)), String(Math.round(y)), 'click', String(button)], d.display);
}

/** A private display has no window manager to give the newest window the keyboard, so Keeper does. */
async function focusTop(d: VirtualDesktop) {
  try {
    const ids = (await run('xdotool', ['search', '--onlyvisible', '--name', '.'], d.display)).toString().trim().split('\n').filter(Boolean);
    const top = ids[ids.length - 1];
    if (top) await run('xdotool', ['windowfocus', '--sync', top], d.display);
  } catch {
    /* no window yet */
  }
}

export async function typeOn(d: VirtualDesktop, text: string) {
  await focusTop(d);
  await run('xdotool', ['type', '--delay', '15', '--', text], d.display);
}

export async function keyOn(d: VirtualDesktop, combo: string) {
  await focusTop(d);
  await run('xdotool', ['key', '--', combo.replace(/\bcmd\b|\bctrl\b/gi, 'ctrl').replace(/\s*\+\s*/g, '+')], d.display);
}

export async function windowsOn(d: VirtualDesktop): Promise<string> {
  try {
    const ids = (await run('xdotool', ['search', '--onlyvisible', '--name', '.'], d.display)).toString().trim().split('\n').filter(Boolean);
    const out: string[] = [];
    for (const id of ids.slice(0, 30)) out.push(`${id} ${(await run('xdotool', ['getwindowname', id], d.display)).toString().trim()}`);
    return out.join('\n') || 'No windows yet.';
  } catch {
    return 'No windows yet.';
  }
}

export function stopDesktop(id: string) {
  const d = desktops.get(id);
  if (!d) return;
  for (const a of d.apps) a.kill();
  d.proc.kill();
  desktops.delete(id);
}

export function stopAllDesktops() {
  for (const id of [...desktops.keys()]) stopDesktop(id);
}

export function desktopToolSpec() {
  return {
    name: 'background_desktop',
    description:
      "A desktop of your own, separate from the person's screen (Linux), so they keep working: start it, open an app on it, take screenshots, click, type and press keys there. " +
      'Stop it when done. On macOS and Windows this is not available: use the browser tool for web tasks and the computer tool for apps.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'open', 'screenshot', 'click', 'type', 'key', 'windows', 'stop'] },
        command: { type: 'string', description: 'program to open, e.g. gedit or libreoffice' },
        args: { type: 'array', items: { type: 'string' } },
        x: { type: 'integer' },
        y: { type: 'integer' },
        text: { type: 'string' },
        keys: { type: 'string', description: 'e.g. ctrl+s, Return' },
      },
      required: ['action'],
    },
  };
}
