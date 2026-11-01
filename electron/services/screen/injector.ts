// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Moves this computer's pointer and presses its keys for a remote viewer that
// is allowed to control it. Events arrive sanitised; this only runs them.
//
//   Linux    xdotool (XTest) on X11. On Wayland, the RemoteDesktop portal
//            (portal.ts): the system asks once, Keeper keeps the restore
//            token; view only when the portal is missing or declined.
//   Windows  a long-lived PowerShell host calling SendInput / SetCursorPos.
//   macOS    keeper-helper's CGEvent methods (needs Accessibility permission).

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Writable } from 'node:stream';
import { coalesce } from '../../../core/screen/input';
import { macCalls, winLines, WIN_INPUT_HOST, xdotoolBatches } from '../../../core/screen/inject';
import type { HostDisplay, InputEvent } from '../../../core/screen/types';
import { run } from '../../../core/platform';
import { PortalInjector, usePortal } from './portal';
import { permissionNeeded } from '../permission-nudge';

export interface InjectorStatus {
  available: boolean;
  /** why control is not possible here, in plain words */
  reason?: string;
  /** macOS: permissions still to grant */
  needs?: ('accessibility' | 'screenRecording')[];
}

export interface Injector {
  status(): Promise<InjectorStatus>;
  send(events: InputEvent[], display: HostDisplay): void;
  stop(): void;
  /** Windows: block this computer's own keyboard and mouse during control (BlockInput); false when not possible */
  block?(on: boolean): Promise<boolean>;
}

class XdotoolInjector implements Injector {
  private queue: InputEvent[] = [];
  private busy = false;
  private display?: HostDisplay;

  async status(): Promise<InjectorStatus> {
    if (process.env.XDG_SESSION_TYPE === 'wayland' && !process.env.DISPLAY) return { available: false, reason: 'This desktop runs Wayland without X11, which does not let apps use the mouse and keyboard. The screen can be watched, not controlled.' };
    const r = await run('xdotool', ['version'], 3000);
    if (!r.ok) return { available: false, reason: 'Controlling this computer needs xdotool (sudo apt install xdotool).' };
    if (process.env.XDG_SESSION_TYPE === 'wayland') return { available: true, reason: 'On Wayland only windows running through XWayland can be controlled.' };
    return { available: true };
  }

  send(events: InputEvent[], display: HostDisplay) {
    this.queue.push(...events);
    this.display = display;
    void this.pump();
  }

  // One xdotool call at a time; while it runs, new events pile up and pointer moves merge.
  private async pump() {
    if (this.busy || !this.display) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const batch = coalesce(this.queue.splice(0));
        for (const args of xdotoolBatches(batch, this.display)) {
          await new Promise<void>((resolve) => {
            const p = spawn('xdotool', args, { stdio: 'ignore' });
            p.on('error', () => resolve());
            p.on('exit', () => resolve());
          });
        }
      }
    } finally {
      this.busy = false;
    }
  }

  stop() {
    this.queue = [];
  }
}

class WindowsInjector implements Injector {
  private ps: ChildProcessByStdio<Writable, null, null> | null = null;

  async status(): Promise<InjectorStatus> {
    return { available: true };
  }

  private host() {
    if (this.ps && !this.ps.killed) return this.ps;
    // The script goes in as -EncodedCommand (UTF-16LE base64), so stdin carries only events.
    const encoded = Buffer.from(WIN_INPUT_HOST, 'utf16le').toString('base64');
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    p.on('exit', () => (this.ps = null));
    p.on('error', () => (this.ps = null));
    p.stdin.on('error', () => undefined);
    this.ps = p;
    return p;
  }

  send(events: InputEvent[], display: HostDisplay) {
    const lines = winLines(coalesce(events), display);
    if (lines.length) this.host().stdin.write(lines.join('\r\n') + '\r\n');
  }

  stop() {
    void this.block(false);
    this.ps?.stdin.end();
    this.ps?.kill();
    this.ps = null;
  }

  /** BlockInput works only from an elevated process (or the unattended service); it says so when it fails. */
  async block(on: boolean): Promise<boolean> {
    const script = `Add-Type -Namespace K -Name B -MemberDefinition '[DllImport("user32.dll")] public static extern bool BlockInput(bool b);'; if ([K.B]::BlockInput($${on ? 'true' : 'false'})) { 'ok' } else { 'no' }`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 8000);
    return r.ok && r.stdout.trim() === 'ok';
  }
}

class MacInjector implements Injector {
  private client: import('../platform/helper-client').HelperClient | null = null;

  private async helper() {
    if (this.client) return this.client;
    const { helperPath } = await import('../platform/mac');
    const { HelperClient } = await import('../platform/helper-client');
    const p = helperPath();
    if (!p) return null;
    this.client = new HelperClient(p, [], 5 * 60_000);
    return this.client;
  }

  async status(): Promise<InjectorStatus> {
    const h = await this.helper();
    if (!h) return { available: false, reason: 'Controlling this Mac needs Keeper’s helper, which is not in this build.' };
    try {
      const s = await h.call<{ accessibility: boolean; screenRecording: boolean }>('input.status', undefined, { timeoutMs: 5000 });
      const needs: InjectorStatus['needs'] = [];
      if (!s.accessibility) needs.push('accessibility');
      if (!s.screenRecording) needs.push('screenRecording');
      return needs.length ? { available: s.accessibility, needs, reason: 'Allow Keeper in System Settings → Privacy & Security (Accessibility to control, Screen Recording to be seen).' } : { available: true };
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Opens macOS's permission prompts. */
  async request() {
    // Points to Settings → Permissions; macOS's own prompts only when the person did not set everything up first.
    if (process.platform === 'darwin' && !permissionNeeded('accessibility', 'remoteScreen')) return;
    const h = await this.helper();
    await h?.call('input.request', undefined, { timeoutMs: 10_000 }).catch(() => undefined);
  }

  send(events: InputEvent[], display: HostDisplay) {
    void this.helper().then((h) => {
      for (const c of macCalls(coalesce(events), display)) void h?.call(c.method, c.params, { timeoutMs: 3000 }).catch(() => undefined);
    });
  }

  stop() {
    /* the helper stops by itself when idle */
  }
}

class NoInjector implements Injector {
  async status(): Promise<InjectorStatus> {
    return { available: false, reason: 'Remote control is not available on this system.' };
  }
  send() {}
  stop() {}
}

let inj: Injector | null = null;

export function injector(): Injector {
  if (!inj && usePortal()) inj = new PortalInjector();
  inj ??= process.platform === 'linux' ? new XdotoolInjector() : process.platform === 'win32' ? new WindowsInjector() : process.platform === 'darwin' ? new MacInjector() : new NoInjector();
  return inj;
}

export async function requestMacPermissions() {
  const i = injector();
  if (i instanceof MacInjector) await i.request();
}
