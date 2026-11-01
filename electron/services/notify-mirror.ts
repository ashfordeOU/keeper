// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Linux: shows other apps' notifications in the Island by listening to the
// desktop notification bus (read-only; the normal notification still appears).

import { spawn, type ChildProcess } from 'node:child_process';

export interface MirroredNotification {
  app: string;
  title: string;
  body: string;
}

/** Parses one `dbus-monitor` Notify call: app_name, replaces_id, icon, summary, body. */
export function parseNotify(block: string): MirroredNotification | null {
  if (!/member=Notify/.test(block)) return null;
  const strings = [...block.matchAll(/^\s+string "((?:[^"\\]|\\.)*)"/gm)].map((m) => m[1].replace(/\\"/g, '"'));
  if (strings.length < 4) return null;
  const [app, , title, body] = strings;
  if (!title && !body) return null;
  return { app: app || 'Notification', title: title || app, body: (body ?? '').replace(/<[^>]+>/g, '') };
}

export class NotificationMirror {
  private child: ChildProcess | null = null;
  private buf = '';

  start(onNote: (n: MirroredNotification) => void): boolean {
    if (process.platform !== 'linux' || this.child) return !!this.child;
    try {
      this.child = spawn('dbus-monitor', ['--session', "interface='org.freedesktop.Notifications',member='Notify'"], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return false;
    }
    this.child.on('error', () => this.stop());
    this.child.stdout?.on('data', (d: Buffer) => {
      this.buf += d.toString();
      // Each message starts with "method call".
      const parts = this.buf.split(/\n(?=method call|signal|method return)/);
      this.buf = parts.pop() ?? '';
      for (const p of parts) {
        const n = parseNotify(p);
        if (n) onNote(n);
      }
    });
    return true;
  }

  stop() {
    this.child?.kill();
    this.child = null;
    this.buf = '';
  }
}
