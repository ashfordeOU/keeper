// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Opens places, forecasts, events, addresses and numbers in the person's own
// apps (core/native-apps.ts has the rules). Looking for apps happens the first
// time a kind is used and is remembered until Settings asks again: a few file
// checks and "who answers this link" questions, never a timer.

import { app, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  KIND_LABEL, NATIVE_KINDS, autoChoice, cleanParams, isNativeKind, nativeCandidates, nativeChoices, planNative,
  type Detect, type Installed, type Launch, type NativeKind, type NativeKindInfo, type NativeOs,
} from '../../core/native-apps';
import { settings } from '../store';

const OS = process.platform as NativeOs;
const found = new Map<NativeKind, Installed>();

function expand(p: string): string {
  const home = os.homedir();
  const out = p
    .replace(/^~(?=\/)/, home)
    .replace('%APPDATA%', process.env.APPDATA || path.join(home, 'AppData', 'Roaming'))
    .replace('%PROGRAMDATA%', process.env.ProgramData || 'C:\\ProgramData');
  return path.normalize(out);
}

const LINUX_APP_DIRS = () => {
  const home = os.homedir();
  const data = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  return [
    path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'applications'),
    ...data.map((d) => path.join(d, 'applications')),
    path.join(home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications'),
    '/var/lib/flatpak/exports/share/applications', '/var/lib/snapd/desktop/applications',
  ];
};

const onPath = (bin: string) => (process.env.PATH || '').split(path.delimiter).some((d) => d && existsSync(path.join(d, bin)));

/** The answer for one candidate: what was found, or undefined. */
function detect(d: Detect): string | undefined {
  try {
    if ('always' in d) return '';
    if ('paths' in d) return d.paths.map(expand).find((p) => existsSync(p));
    if ('scheme' in d) {
      // Asks the system which app opens this kind of link (Launch Services, the registry, xdg-mime).
      const name = app.getApplicationNameForProtocol(`${d.scheme}://`);
      return name ? name.replace(/\.(app|exe|desktop)$/i, '') : undefined;
    }
    if ('bin' in d) return onPath(d.bin) ? d.bin : undefined;
    if ('desktop' in d) return onPath('gtk-launch') && LINUX_APP_DIRS().some((dir) => existsSync(path.join(dir, `${d.desktop}.desktop`))) ? d.desktop : undefined;
    if ('desktopName' in d) {
      // Browsers put the web apps they install here, as chrome-<id>-Default.desktop and the like.
      const dir = LINUX_APP_DIRS()[0];
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.desktop') || !/^(chrome|chromium|msedge|brave|vivaldi)-/.test(f)) continue;
        if (readFileSync(path.join(dir, f), 'utf8').split('\n').some((l) => l.trim() === `Name=${d.desktopName}`)) return path.join(dir, f);
      }
    }
  } catch { /* not there */ }
  return undefined;
}

function installed(kind: NativeKind): Installed {
  let got = found.get(kind);
  if (got) return got;
  got = {};
  for (const c of nativeCandidates(kind, OS)) {
    if (c.web) continue;
    const v = detect(c.detect);
    if (v !== undefined) got[c.id] = v;
  }
  found.set(kind, got);
  return got;
}

/** Runs one way of opening; true when the system took it. */
function launch(l: Launch): Promise<boolean> {
  if (l.how === 'url') return shell.openExternal(l.url).then(() => true, () => false);
  if (l.how === 'spawn') {
    return new Promise((resolve) => {
      try {
        const child = spawn(l.file, l.args, { detached: true, stdio: 'ignore' });
        child.once('error', () => resolve(false));
        child.once('spawn', () => { child.unref(); resolve(true); });
      } catch { resolve(false); }
    });
  }
  // open and gtk-launch hand the app over and exit; a non-zero exit means it is not there.
  return new Promise((resolve) => execFile(l.file, l.args, { timeout: 15_000 }, (err) => resolve(!err)));
}

export async function nativeOpen(kind: unknown, raw: unknown): Promise<{ ok: boolean; app?: string; copy?: string }> {
  if (!isNativeKind(kind)) return { ok: false };
  const params = cleanParams(raw);
  const plan = planNative(kind, OS, installed(kind), settings().nativeApps?.[kind], params);
  for (const t of plan.tries) if (await launch(t.launch)) return { ok: true, app: t.name };
  // Nothing on this computer can call or text: the number goes to the clipboard instead.
  return { ok: false, copy: kind === 'call' || kind === 'messages' || kind === 'mail' ? params.to : undefined };
}

export function nativeApps(refresh?: boolean): NativeKindInfo[] {
  if (refresh) found.clear();
  const prefs = settings().nativeApps ?? {};
  return NATIVE_KINDS.map((kind) => {
    const inst = installed(kind);
    return { kind, label: KIND_LABEL[kind], choices: nativeChoices(kind, OS, inst), auto: autoChoice(kind, OS, inst), pick: prefs[kind] || 'auto' };
  });
}
