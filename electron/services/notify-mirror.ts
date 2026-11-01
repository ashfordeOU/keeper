// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Shows other apps' notifications in the Island (opt-in, off by default):
//   Linux    the desktop notification bus (dbus-monitor); the normal notification still appears
//   macOS    keeper-helper reads Notification Centre's banners through Accessibility,
//            optionally closing each banner after Keeper shows it (fragile: it reads what
//            macOS draws)
//   Windows  UserNotificationListener when Windows grants it (it needs package identity and
//            the person's consent), otherwise the notification history Windows keeps for the
//            Action Centre, read from a copy whenever it changes
// See core/island-notify.ts for the parsers and filters.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fsp, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isOwnNotification, NotifyDeduper, parseMacBanner, parseWinListenerLine, wpnRowsToNotes, type MirroredNotification } from '../../core/island-notify';

// Kept free of Electron imports at load time (tests read parseNotify straight from here).
const psExe = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const lowerPriority = (c: ChildProcess) => void import('./governor').then((g) => g.lowerPriority(c), () => undefined);

export type { MirroredNotification };

/** Parses one `dbus-monitor` Notify call: app_name, replaces_id, icon, summary, body. */
export function parseNotify(block: string): MirroredNotification | null {
  if (!/member=Notify/.test(block)) return null;
  const strings = [...block.matchAll(/^\s+string "((?:[^"\\]|\\.)*)"/gm)].map((m) => m[1].replace(/\\"/g, '"'));
  if (strings.length < 4) return null;
  const [app, , title, body] = strings;
  if (!title && !body) return null;
  return { app: app || 'Notification', title: title || app, body: (body ?? '').replace(/<[^>]+>/g, '') };
}

const WIN_LISTENER = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
try {
  [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  $l = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
  $acc = Await ($l.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus])
  if ($acc.ToString() -ne 'Allowed') { [Console]::Out.WriteLine('{"error":"' + $acc + '"}'); exit 0 }
} catch { [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)); exit 0 }
$seen = @{}
$first = $true
while ($true) {
  $list = Await ($l.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])
  foreach ($n in $list) {
    if ($seen.ContainsKey($n.Id)) { continue }
    $seen[$n.Id] = 1
    if ($first) { continue }
    $texts = @()
    try { $b = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric); if ($b) { $texts = @($b.GetTextElements() | ForEach-Object { $_.Text }) } } catch {}
    $o = @{ id = $n.Id; appId = $n.AppInfo.AppUserModelId; app = $n.AppInfo.DisplayInfo.DisplayName; texts = $texts }
    [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush()
  }
  $first = $false
  Start-Sleep -Seconds 2
}`;

export type MirrorMode = 'off' | 'bus' | 'accessibility' | 'listener' | 'history' | 'unavailable';

export class NotificationMirror {
  private child: ChildProcess | null = null;
  private buf = '';
  private flush?: NodeJS.Timeout;
  private abort?: AbortController;
  private watcher?: FSWatcher;
  private dedupe = new NotifyDeduper();
  mode: MirrorMode = 'off';
  /** why it is not working, in plain words */
  problem?: string;

  start(onNote: (n: MirroredNotification) => void, o: { dismiss?: boolean } = {}): boolean {
    if (this.mode !== 'off' && this.mode !== 'unavailable') return true;
    const emit = (n: MirroredNotification | null) => {
      if (n && !isOwnNotification(n) && this.dedupe.fresh(n)) onNote(n);
    };
    if (process.platform === 'linux') return this.startLinux(emit);
    if (process.platform === 'darwin') return this.startMac(emit, !!o.dismiss);
    if (process.platform === 'win32') return this.startWindows(emit);
    return false;
  }

  private startLinux(emit: (n: MirroredNotification | null) => void): boolean {
    try {
      this.child = spawn('dbus-monitor', ['--session', "interface='org.freedesktop.Notifications',member='Notify'"], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      this.mode = 'unavailable';
      this.problem = 'dbus-monitor is not installed';
      return false;
    }
    lowerPriority(this.child);
    this.mode = 'bus';
    this.child.on('error', () => { this.stop(); this.mode = 'unavailable'; this.problem = 'dbus-monitor is not installed'; });
    this.child.stdout?.on('data', (d: Buffer) => {
      this.buf += d.toString();
      // Each message starts with "method call".
      const parts = this.buf.split(/\n(?=method call|signal|method return)/);
      this.buf = parts.pop() ?? '';
      for (const p of parts) emit(parseNotify(p));
      // The last message is complete once the output pauses (no server reply may follow it).
      clearTimeout(this.flush);
      this.flush = setTimeout(() => { const rest = this.buf; this.buf = ''; if (rest) emit(parseNotify(rest)); }, 200);
    });
    return true;
  }

  private startMac(emit: (n: MirroredNotification | null) => void, dismiss: boolean): boolean {
    const ac = new AbortController();
    this.abort = ac;
    this.mode = 'accessibility';
    void import('./platform/mac').then(({ macHelperStream }) => macHelperStream('notifications.watch', { dismiss }, (t) => {
      try { emit(parseMacBanner(JSON.parse(t))); } catch { /* not JSON */ }
    }, ac.signal)).catch((e: unknown) => {
      if (this.abort !== ac) return;
      this.mode = 'unavailable';
      this.problem = e instanceof Error ? e.message : String(e);
    });
    return true;
  }

  private startWindows(emit: (n: MirroredNotification | null) => void): boolean {
    let c: ChildProcess;
    try {
      c = spawn(psExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_LISTENER], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    } catch {
      return this.startHistory(emit);
    }
    this.child = c;
    lowerPriority(c);
    this.mode = 'listener';
    let buf = '';
    c.stdout?.setEncoding('utf8');
    c.stdout?.on('data', (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const r = parseWinListenerLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (r && 'error' in r) {
          // No package identity or no consent: read the Action Centre's history instead.
          this.problem = `The notification listener is not available to Keeper (${r.error}); reading the notification history instead`;
          c.kill();
          if (this.child === c) { this.child = null; this.startHistory(emit); }
          return;
        }
        emit(r);
      }
    });
    c.on('error', () => { if (this.child === c) { this.child = null; this.startHistory(emit); } });
    return true;
  }

  /** Windows: %LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db, copied and read when it changes. */
  private startHistory(emit: (n: MirroredNotification | null) => void): boolean {
    const dir = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Notifications');
    const db = path.join(dir, 'wpndatabase.db');
    if (!existsSync(db)) {
      this.mode = 'unavailable';
      this.problem = 'Windows keeps no notification history on this computer';
      return false;
    }
    this.mode = 'history';
    let lastId = -1;
    let busy = false;
    let again = false;
    const read = async () => {
      if (busy) { again = true; return; }
      busy = true;
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-wpn-'));
      try {
        for (const f of ['wpndatabase.db', 'wpndatabase.db-wal', 'wpndatabase.db-shm']) await fsp.copyFile(path.join(dir, f), path.join(tmp, f)).catch(() => undefined);
        const { DatabaseSync } = (await import('node:sqlite' as string)) as { DatabaseSync: new (p: string, o?: object) => { prepare(sql: string): { all(...a: unknown[]): unknown[] }; close(): void } };
        const conn = new DatabaseSync(path.join(tmp, 'wpndatabase.db'), { readOnly: false });
        try {
          if (lastId < 0) {
            const top = conn.prepare('SELECT MAX(Id) AS m FROM Notification').all() as { m: number | null }[];
            lastId = top[0]?.m ?? 0;
          } else {
            const rows = conn.prepare('SELECT n.Id AS Id, h.PrimaryId AS PrimaryId, n.Payload AS Payload, n.ArrivalTime AS ArrivalTime, n.Type AS Type FROM Notification n JOIN NotificationHandler h ON n.HandlerId = h.RecordId WHERE n.Id > ? ORDER BY n.Id').all(lastId) as Parameters<typeof wpnRowsToNotes>[0];
            const r = wpnRowsToNotes(rows, lastId);
            lastId = r.lastId;
            for (const n of r.notes) emit(n);
          }
        } finally {
          conn.close();
        }
      } catch (e) {
        this.problem = `Could not read the notification history: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
        busy = false;
        if (again) { again = false; setTimeout(() => void read(), 500); }
      }
    };
    void read();
    let t: NodeJS.Timeout | undefined;
    try {
      // New toasts land in the write-ahead log; read once things settle.
      this.watcher = watch(dir, (_e, name) => {
        if (!name || !String(name).startsWith('wpndatabase')) return;
        clearTimeout(t);
        t = setTimeout(() => void read(), 700);
      });
    } catch {
      this.mode = 'unavailable';
      this.problem = 'Cannot watch the notification history folder';
      return false;
    }
    return true;
  }

  stop() {
    this.child?.kill();
    this.child = null;
    this.buf = '';
    this.abort?.abort();
    this.abort = undefined;
    this.watcher?.close();
    this.watcher = undefined;
    this.mode = 'off';
  }
}
