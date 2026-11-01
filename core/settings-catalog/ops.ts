// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Turns catalogue operations into the exact commands Keeper runs (argument
// lists, never a shell string from the person), and turns their output back
// into values. Pure: tested with sample output from each system.

import { UNSET } from './build';
import type { After, Cmd, Op, SettingDef } from './types';

const HKEY = (hive: 'HKCU' | 'HKLM', path: string) => `${hive}\\${path}`;

/** The command that prints the current value, or null when Keeper cannot read it without an administrator. */
export function readCmd(op: Op): Cmd | null {
  switch (op.t) {
    case 'defaults':
      return { file: '/usr/bin/defaults', args: [...(op.currentHost ? ['-currentHost'] : []), 'read', op.domain, op.key] };
    case 'pmset':
      return { file: '/usr/bin/pmset', args: ['-g', 'custom'] };
    case 'mdutil':
      return { file: '/usr/bin/mdutil', args: ['-s', op.volume] };
    case 'spctl':
      return { file: '/usr/sbin/spctl', args: ['--status'] };
    case 'reg':
      return { file: 'reg', args: ['query', HKEY(op.hive, op.path), ...(op.name ? ['/v', op.name] : ['/ve'])] };
    case 'powercfg':
      if (op.what === 'hibernate') return { file: 'reg', args: ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power', '/v', 'HibernateEnabled'] };
      return { file: 'powercfg', args: ['/q', 'SCHEME_CURRENT', ...POWER_IDS[op.what]] };
    case 'service':
      return { file: 'sc', args: ['qc', op.name] };
    case 'winfeature':
      // Reading optional features needs an administrator on Windows.
      return null;
    case 'gsettings':
      return { file: 'gsettings', args: ['get', op.schema, op.key] };
    case 'sysctl':
      return { file: 'sysctl', args: ['-n', op.key] };
    case 'systemd':
      return { file: 'systemctl', args: [...(op.user ? ['--user'] : []), 'is-enabled', op.unit] };
    case 'timedatectl':
      return { file: 'timedatectl', args: ['show', '-p', op.what === 'ntp' ? 'NTP' : 'LocalRTC', '--value'] };
    case 'advice':
      return op.read ? { file: op.read.file, args: op.read.args } : null;
  }
}

const POWER_IDS: Record<string, string[]> = {
  'monitor-timeout-ac': ['SUB_VIDEO', 'VIDEOIDLE'],
  'monitor-timeout-dc': ['SUB_VIDEO', 'VIDEOIDLE'],
  'standby-timeout-ac': ['SUB_SLEEP', 'STANDBYIDLE'],
  'standby-timeout-dc': ['SUB_SLEEP', 'STANDBYIDLE'],
};

/**
 * The raw value from a read command's output, or undefined when the setting is
 * not set (the system default applies). `ok` is the command's success.
 */
export function parseRead(def: SettingDef, stdout: string, ok: boolean): string | undefined {
  const op = def.op;
  const out = stdout.replace(/\r/g, '');
  switch (op.t) {
    case 'defaults': {
      if (!ok) return undefined;
      const v = out.trim();
      if (op.type === 'bool') return v === '1' || /^true$/i.test(v) || /^yes$/i.test(v) ? 'true' : 'false';
      return v;
    }
    case 'pmset': {
      // `pmset -g custom` lists each power source; the first value of a key is enough to show it.
      const m = out.match(new RegExp(`^\\s*${escapeRe(op.key)}\\s+(\\S+)`, 'm'));
      return m?.[1];
    }
    case 'mdutil':
      if (/Indexing enabled/i.test(out)) return 'on';
      if (/Indexing disabled|Indexing and searching disabled/i.test(out)) return 'off';
      return undefined;
    case 'spctl':
      return /assessments enabled/i.test(out) ? 'on' : /assessments disabled/i.test(out) ? 'off' : undefined;
    case 'reg':
    case 'powercfg':
      if (op.t === 'powercfg' && op.what !== 'hibernate') {
        const ac = op.what.endsWith('-ac');
        const m = out.match(ac ? /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i : /Current DC Power Setting Index:\s*0x([0-9a-f]+)/i);
        // powercfg reports seconds; the catalogue shows minutes.
        return m ? String(Math.round(parseInt(m[1], 16) / 60)) : undefined;
      }
      if (op.t === 'powercfg') {
        const v = parseRegQuery(out, ok);
        return v === undefined ? undefined : v === '0' ? 'off' : 'on';
      }
      return parseRegQuery(out, ok);
    case 'service': {
      const m = out.match(/START_TYPE\s*:\s*\d+\s+(\w+)/);
      if (!m) return undefined;
      return { AUTO_START: 'auto', DEMAND_START: 'demand', DISABLED: 'disabled', BOOT_START: 'boot', SYSTEM_START: 'system' }[m[1]] ?? m[1].toLowerCase();
    }
    case 'winfeature':
      return /State\s*:\s*Enabled/i.test(out) ? 'on' : /State\s*:\s*Disabled/i.test(out) ? 'off' : undefined;
    case 'gsettings':
      return ok ? parseGVariant(out.trim()) : undefined;
    case 'sysctl':
      return ok ? out.trim().replace(/\s+/g, ' ') : undefined;
    case 'systemd': {
      const v = out.trim().split('\n')[0];
      return v || undefined;
    }
    case 'timedatectl':
      return ok ? (out.trim() === 'yes' ? 'on' : 'off') : undefined;
    case 'advice':
      return ok ? out.trim().slice(0, 4000) : undefined;
  }
}

/** `reg query` output → the value (DWORDs as decimal), or undefined when absent. */
export function parseRegQuery(out: string, ok = true): string | undefined {
  if (!ok) return undefined;
  const m = out.match(/^\s+(\S.*?)\s+(REG_\w+)\s*(.*)$/m);
  if (!m) return undefined;
  const [, , type, data] = m;
  if (type === 'REG_DWORD' || type === 'REG_QWORD') return String(parseInt(data.trim(), 16));
  return data.trim();
}

/** GVariant text from gsettings → plain value: 'abc' → abc, uint32 5 → 5, true → true. */
export function parseGVariant(v: string): string {
  let s = v.replace(/^(u?int(16|32|64)|double|byte)\s+/, '');
  if (/^'.*'$/.test(s) || /^".*"$/.test(s)) s = s.slice(1, -1).replace(/\\'/g, "'");
  return s;
}

/** GVariant text to pass to `gsettings set`. */
export function toGVariant(type: string, value: string): string {
  if (type === 'bool') return value === 'true' ? 'true' : 'false';
  if (type === 'int' || type === 'float') return value;
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Checks a value against the entry before anything runs. Returns an error message or null. */
export function validateValue(def: SettingDef, value: string): string | null {
  if (def.op.t === 'advice') return 'Keeper only explains this one; follow the steps to change it';
  if (value === UNSET) return def.op.t === 'defaults' || def.op.t === 'reg' || def.op.t === 'gsettings' ? null : 'This setting cannot be unset';
  if (def.kind === 'toggle') return value === def.on || value === def.off ? null : `Must be ${def.on} or ${def.off}`;
  if (def.kind === 'choice') return def.choices?.some((c) => c.value === value) ? null : 'Not one of the choices';
  if (def.kind === 'number') {
    if (!/^-?\d+(\.\d+)?$/.test(value)) return 'Must be a number';
    const n = Number(value);
    if (def.min !== undefined && n < def.min) return `At least ${def.min}`;
    if (def.max !== undefined && n > def.max) return `At most ${def.max}`;
    if (def.op.t !== 'defaults' || (def.op as { type?: string }).type !== 'float') {
      if (!Number.isInteger(n)) return 'Must be a whole number';
    }
    return null;
  }
  // text: paths and names only, never anything a shell could act on
  if (value.length > 300) return 'Too long';
  if (/[\0\n\r`$;|&<>]/.test(value)) return 'Contains characters Keeper will not pass on';
  return null;
}

/** The commands that set a value. */
export function writeCmds(def: SettingDef, value: string): Cmd[] {
  if (value === UNSET) return removeCmds(def);
  const op = def.op;
  const admin = def.admin;
  switch (op.t) {
    case 'defaults': {
      const flag = { bool: '-bool', int: '-int', float: '-float', string: '-string' }[op.type];
      return [{ file: '/usr/bin/defaults', args: [...(op.currentHost ? ['-currentHost'] : []), 'write', op.domain, op.key, flag, value], admin }];
    }
    case 'pmset':
      return [{ file: '/usr/bin/pmset', args: [`-${op.scope ?? 'a'}`, op.key, value], admin: true }];
    case 'mdutil':
      return [{ file: '/usr/bin/mdutil', args: ['-i', value, op.volume], admin: true }];
    case 'spctl':
      return [{ file: '/usr/sbin/spctl', args: [value === 'on' ? '--master-enable' : '--master-disable'], admin: true }];
    case 'reg':
      return [{ file: 'reg', args: ['add', HKEY(op.hive, op.path), ...(op.name ? ['/v', op.name] : ['/ve']), '/t', op.type, '/d', value, '/f'], admin: admin || op.hive === 'HKLM' }];
    case 'powercfg':
      if (op.what === 'hibernate') return [{ file: 'powercfg', args: ['/hibernate', value === 'on' ? 'on' : 'off'], admin: true }];
      return [{ file: 'powercfg', args: ['/change', op.what, value] }];
    case 'service':
      return [{ file: 'sc', args: ['config', op.name, 'start=', value], admin: true }];
    case 'winfeature':
      return [{ file: 'dism', args: ['/online', value === 'on' ? '/enable-feature' : '/disable-feature', `/featurename:${op.name}`, ...(value === 'on' ? ['/all'] : []), '/norestart'], admin: true }];
    case 'gsettings':
      return [{ file: 'gsettings', args: ['set', op.schema, op.key, toGVariant(op.type, value)] }];
    case 'sysctl':
      return [
        { file: 'sysctl', args: ['-w', `${op.key}=${value}`], admin: true },
        // Kept after a restart: Keeper's own drop-in file, one line per setting.
        { file: 'sh', args: ['-c', sysctlPersistScript(op.key, value)], admin: true },
      ];
    case 'systemd':
      return [{ file: 'systemctl', args: [...(op.user ? ['--user'] : []), value === 'enabled' ? 'enable' : 'disable', '--now', op.unit], admin: !op.user }];
    case 'timedatectl':
      return [{ file: 'timedatectl', args: [op.what === 'ntp' ? 'set-ntp' : 'set-local-rtc', value === 'on' ? 'true' : 'false'] }];
    case 'advice':
      return [];
  }
}

export const SYSCTL_FILE = '/etc/sysctl.d/99-keeper.conf';

/** A fixed script with a validated key and value: the key is from the catalogue and the value is lower-case letters, digits, underscores and spaces only. */
export function sysctlPersistScript(key: string, value: string): string {
  if (!/^[a-z0-9_.]+$/.test(key) || !/^[a-z0-9_ ]+$/.test(value)) throw new Error('Refusing an unexpected sysctl key or value');
  return `mkdir -p /etc/sysctl.d && touch ${SYSCTL_FILE} && grep -v '^${key}=' ${SYSCTL_FILE} > ${SYSCTL_FILE}.tmp; echo '${key}=${value}' >> ${SYSCTL_FILE}.tmp && mv ${SYSCTL_FILE}.tmp ${SYSCTL_FILE}`;
}

/** The commands that put a setting back to how it was before Keeper set it (remove the override). */
export function removeCmds(def: SettingDef): Cmd[] {
  const op = def.op;
  switch (op.t) {
    case 'defaults':
      return [{ file: '/usr/bin/defaults', args: [...(op.currentHost ? ['-currentHost'] : []), 'delete', op.domain, op.key], admin: def.admin }];
    case 'reg':
      return [{ file: 'reg', args: ['delete', HKEY(op.hive, op.path), ...(op.name ? ['/v', op.name] : ['/ve']), '/f'], admin: def.admin || op.hive === 'HKLM' }];
    case 'gsettings':
      return [{ file: 'gsettings', args: ['reset', op.schema, op.key] }];
    default:
      return writeCmds(def, def.systemDefault);
  }
}

/** A snapshot of the area a change touches, saved before the first change (for one-click restore). */
export function backupCmd(op: Op, file: string): Cmd | null {
  switch (op.t) {
    case 'defaults':
      return op.currentHost ? null : { file: '/usr/bin/defaults', args: ['export', op.domain, file] };
    case 'reg':
      return { file: 'reg', args: ['export', HKEY(op.hive, op.path), file, '/y'] };
    case 'gsettings':
      return { file: 'gsettings', args: ['list-recursively', op.schema] };
    default:
      return null;
  }
}

/** What runs after a change so it shows (Dock, Finder, menu bar relaunch). Others are told to the person. */
export function afterCmds(after: After): Cmd[] {
  if (after === 'relaunch-dock') return [{ file: '/usr/bin/killall', args: ['Dock'] }];
  if (after === 'relaunch-finder') return [{ file: '/usr/bin/killall', args: ['Finder'] }];
  if (after === 'relaunch-menubar') return [{ file: '/usr/bin/killall', args: ['SystemUIServer'] }];
  return [];
}

export const AFTER_TEXT: Record<After, string> = {
  none: 'Takes effect straight away',
  'relaunch-dock': 'The Dock restarts for a moment',
  'relaunch-finder': 'Finder restarts for a moment',
  'relaunch-menubar': 'The menu bar restarts for a moment',
  'relaunch-explorer': 'Takes effect after File Explorer restarts (or sign out and in)',
  'relaunch-app': 'Takes effect when the app is next opened',
  logout: 'Takes effect after you sign out and back in',
  restart: 'Takes effect after a restart',
};

/** One line for the preview: exactly what will run, quoted so it can be read (and copied) safely. */
export function showCmd(c: Cmd): string {
  const q = (a: string) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  return `${c.admin ? '(as administrator) ' : ''}${[c.file, ...c.args].map(q).join(' ')}`;
}
