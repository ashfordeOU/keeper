// SPDX-License-Identifier: AGPL-3.0-or-later
// Apps that start with the computer. Switching one off uses the same setting
// the OS's own tools use, so it can always be switched back on.

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { powershell, run } from '../../core/platform';
import type { StartupItem } from '../../core/types';

const HEAVY = /teams|discord|steam|onedrive|dropbox|creative cloud|adobe|docker|spotify|zoom|slack|epic|origin|battle\.net|googledrive|icloud|skype|chrome|edge/i;
const impact = (name: string, cmd: string): StartupItem['impact'] => (HEAVY.test(name + cmd) ? 'high' : /update|helper|agent|tray/i.test(name + cmd) ? 'low' : 'medium');
const idOf = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

// ---------------------------------------------------------------- macOS

async function plistJson(file: string): Promise<Record<string, unknown> | null> {
  const r = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], 5000);
  try {
    return r.ok ? JSON.parse(r.stdout) : null;
  } catch {
    return null;
  }
}

async function macItems(): Promise<StartupItem[]> {
  const uid = process.getuid?.() ?? 501;
  const disabled = new Set<string>();
  for (const domain of [`gui/${uid}`, 'system']) {
    const r = await run('/bin/launchctl', ['print-disabled', domain], 5000);
    for (const m of r.stdout.matchAll(/"([^"]+)" => (true|disabled)/g)) disabled.add(m[1]);
  }
  const dirs: [string, 'user' | 'system', string][] = [
    [path.join(os.homedir(), 'Library', 'LaunchAgents'), 'user', 'Launch agent'],
    ['/Library/LaunchAgents', 'system', 'Launch agent (all users)'],
    ['/Library/LaunchDaemons', 'system', 'Background service'],
  ];
  const items: StartupItem[] = [];
  for (const [dir, scope, source] of dirs) {
    let names: string[] = [];
    try {
      names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.plist'));
    } catch {
      continue;
    }
    for (const n of names) {
      const file = path.join(dir, n);
      const p = await plistJson(file);
      const label = (p?.Label as string) ?? n.replace(/\.plist$/, '');
      if (label.startsWith('com.apple.')) continue;
      const prog = (p?.Program as string) ?? ((p?.ProgramArguments as string[]) ?? [])[0] ?? '';
      const appName = prog.match(/\/([^/]+)\.app\//)?.[1] ?? label.split('.').slice(-2, -1)[0] ?? label;
      items.push({
        id: `launchd:${scope}:${label}:${file}`,
        name: appName.charAt(0).toUpperCase() + appName.slice(1),
        command: prog || label,
        enabled: !disabled.has(label) && p?.Disabled !== true,
        scope,
        source,
        impact: impact(appName, prog),
      });
    }
  }
  const li = await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to get the {name, path} of every login item'], 8000);
  if (li.ok && li.stdout.trim()) {
    const parts = li.stdout.trim().split(', ');
    const half = Math.floor(parts.length / 2);
    for (let i = 0; i < half; i++) items.push({ id: `login:${parts[i]}`, name: parts[i], command: parts[half + i], enabled: true, scope: 'user', source: 'Login item', impact: impact(parts[i], parts[half + i]) });
  }
  return items;
}

async function macToggle(item: StartupItem, enabled: boolean): Promise<void> {
  if (item.id.startsWith('login:')) {
    if (enabled) throw new Error('Add it back in System Settings → General → Login Items');
    const name = item.id.slice(6).replace(/"/g, '\\"');
    await run('/usr/bin/osascript', ['-e', `tell application "System Events" to delete login item "${name}"`]);
    return;
  }
  const [, scope, label, file] = item.id.match(/^launchd:(user|system):([^:]+):(.+)$/)!;
  const uid = process.getuid?.() ?? 501;
  const domain = scope === 'user' ? `gui/${uid}` : file.includes('LaunchDaemons') ? 'system' : `gui/${uid}`;
  const cmd = enabled
    ? `/bin/launchctl enable ${domain}/${label}; /bin/launchctl bootstrap ${domain} '${file}' 2>/dev/null; true`
    : `/bin/launchctl disable ${domain}/${label}; /bin/launchctl bootout ${domain} '${file}' 2>/dev/null; true`;
  if (domain === 'system') {
    const r = await run('/usr/bin/osascript', ['-e', `do shell script ${JSON.stringify(cmd)} with administrator privileges`], 120_000);
    if (!r.ok) throw new Error('Administrator permission was not given');
  } else {
    await run('/bin/sh', ['-c', cmd]);
  }
}

// ---------------------------------------------------------------- Windows

const RUN_KEYS: [string, 'user' | 'system', string][] = [
  ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'user', 'Registry (you)'],
  ['HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'system', 'Registry (all users)'],
  ['HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', 'system', 'Registry (all users, 32-bit)'],
];
const APPROVED = (hive: string) => `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run`;

function parseReg(out: string): { name: string; type: string; data: string }[] {
  return out.split(/\r?\n/).map((l) => l.match(/^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => ({ name: m[1], type: m[2], data: m[3] }));
}

async function winItems(): Promise<StartupItem[]> {
  const items: StartupItem[] = [];
  for (const [key, scope, source] of RUN_KEYS) {
    const hive = key.slice(0, 4);
    const [vals, approved] = await Promise.all([run('reg', ['query', key]), run('reg', ['query', APPROVED(hive)])]);
    const state = new Map(parseReg(approved.stdout).map((v) => [v.name, v.data]));
    for (const v of parseReg(vals.stdout)) {
      const flag = state.get(v.name);
      const enabled = !flag || /^0[26]/.test(flag);
      const exe = v.data.match(/"([^"]+)"|^(\S+)/)?.slice(1).find(Boolean) ?? v.data;
      items.push({ id: `reg:${key}:${v.name}`, name: v.name, command: v.data, enabled, scope, source, impact: impact(v.name, exe) });
    }
  }
  const folder = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const approvedFolder = parseReg((await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder'])).stdout);
  try {
    for (const n of await fsp.readdir(folder)) {
      if (n.toLowerCase() === 'desktop.ini') continue;
      const flag = approvedFolder.find((a) => a.name === n)?.data;
      items.push({ id: `folder:${n}`, name: n.replace(/\.lnk$/i, ''), command: path.join(folder, n), enabled: !flag || /^0[26]/.test(flag), scope: 'user', source: 'Startup folder', impact: impact(n, n) });
    }
  } catch {
    /* no startup folder */
  }
  return items;
}

async function winToggle(item: StartupItem, enabled: boolean): Promise<void> {
  // Task Manager writes 12 bytes: 02 = on, 03 = off, followed by a timestamp.
  const data = enabled ? '020000000000000000000000' : '030000000000000000000000';
  let key: string;
  let name: string;
  if (item.id.startsWith('folder:')) {
    key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder';
    name = item.id.slice(7);
  } else {
    const m = item.id.match(/^reg:(.+):([^:]+)$/)!;
    key = APPROVED(m[1].slice(0, 4));
    name = m[2];
  }
  const args = ['add', key, '/v', name, '/t', 'REG_BINARY', '/d', data, '/f'];
  if (item.scope === 'system') {
    const r = await powershell(`Start-Process reg -ArgumentList '${args.map((a) => `"${a}"`).join(' ').replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`, 120_000);
    if (!r.ok) throw new Error('Administrator permission was not given');
  } else {
    const r = await run('reg', args);
    if (!r.ok) throw new Error(r.stderr || 'Could not change the setting');
  }
}

// ---------------------------------------------------------------- Linux

const userAutostart = () => path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'autostart');

function desktopField(text: string, key: string): string | undefined {
  return text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();
}

async function linuxItems(): Promise<StartupItem[]> {
  const byName = new Map<string, StartupItem>();
  for (const [dir, scope] of [['/etc/xdg/autostart', 'system'], [userAutostart(), 'user']] as const) {
    let names: string[] = [];
    try {
      names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.desktop'));
    } catch {
      continue;
    }
    for (const n of names) {
      const text = await fsp.readFile(path.join(dir, n), 'utf8').catch(() => '');
      if (desktopField(text, 'NoDisplay') === 'true' && scope === 'system' && !byName.has(n)) continue;
      const name = desktopField(text, 'Name') ?? n.replace(/\.desktop$/, '');
      const cmd = desktopField(text, 'Exec') ?? '';
      const enabled = desktopField(text, 'Hidden') !== 'true' && desktopField(text, 'X-GNOME-Autostart-enabled') !== 'false';
      // A user file overrides the system file of the same name.
      byName.set(n, { id: `xdg:${n}`, name, command: cmd, enabled, scope: 'user', source: scope === 'user' ? 'Autostart' : 'Autostart (system default)', impact: impact(name, cmd) });
    }
  }
  return [...byName.values()];
}

async function linuxToggle(item: StartupItem, enabled: boolean): Promise<void> {
  const n = item.id.slice(4);
  const userFile = path.join(userAutostart(), n);
  let text = await fsp.readFile(userFile, 'utf8').catch(() => fsp.readFile(path.join('/etc/xdg/autostart', n), 'utf8'));
  text = text.replace(/^Hidden=.*\n?/m, '').replace(/^X-GNOME-Autostart-enabled=.*\n?/m, '');
  text = text.replace(/(\[Desktop Entry\][^\n]*\n)/, `$1Hidden=${enabled ? 'false' : 'true'}\nX-GNOME-Autostart-enabled=${enabled}\n`);
  await fsp.mkdir(userAutostart(), { recursive: true });
  await fsp.writeFile(userFile, text);
}

// ---------------------------------------------------------------- public

export async function listStartup(): Promise<StartupItem[]> {
  const items = process.platform === 'darwin' ? await macItems() : process.platform === 'win32' ? await winItems() : await linuxItems();
  return items.map((i) => ({ ...i, id: i.id.length > 200 ? idOf(i.id) : i.id })).sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
}

export async function toggleStartup(id: string, enabled: boolean): Promise<StartupItem[]> {
  const item = (await listStartup()).find((i) => i.id === id);
  if (!item) throw new Error('That startup item no longer exists');
  if (process.platform === 'darwin') await macToggle(item, enabled);
  else if (process.platform === 'win32') await winToggle(item, enabled);
  else await linuxToggle(item, enabled);
  return listStartup();
}
