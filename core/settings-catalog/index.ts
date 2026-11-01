// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The whole catalogue, search and the checks every entry must pass.

import { UNSET } from './build';
import { LINUX } from './linux';
import { MACOS } from './macos';
import { removeCmds, validateValue, writeCmds } from './ops';
import type { Os, SettingDef } from './types';
import { WINDOWS } from './windows';

export * from './types';
export { UNSET } from './build';
export { readCmd, parseRead, writeCmds, removeCmds, backupCmd, afterCmds, showCmd, validateValue, AFTER_TEXT, SYSCTL_FILE } from './ops';

export const CATALOG: SettingDef[] = [...MACOS, ...WINDOWS, ...LINUX];

const BY_ID = new Map(CATALOG.map((s) => [s.id, s]));

export function settingById(id: string): SettingDef | undefined {
  return BY_ID.get(id);
}

export function catalogFor(os: Os): SettingDef[] {
  return CATALOG.filter((s) => s.os === os);
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Every word must appear in the title, description, category, keywords or the key itself. Titles rank first. */
export function searchCatalog(query: string, os?: Os, list: SettingDef[] = CATALOG): SettingDef[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const pool = os ? list.filter((s) => s.os === os) : list;
  if (!words.length) return pool;
  const scored: [number, SettingDef][] = [];
  for (const s of pool) {
    const title = norm(s.title);
    const hay = norm([s.title, s.description, s.category, ...(s.keywords ?? []), opText(s), s.id].join(' '));
    if (!words.every((w) => hay.includes(w))) continue;
    const score = words.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + (s.keywords?.some((k) => norm(k).includes(w)) ? 2 : 0), 0);
    scored.push([score, s]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title)).map(([, s]) => s);
}

/** The technical name, so people can search for "swappiness" or "AppleShowAllFiles". */
export function opText(s: SettingDef): string {
  const op = s.op;
  switch (op.t) {
    case 'defaults': return `defaults ${op.domain} ${op.key}`;
    case 'pmset': return `pmset ${op.key}`;
    case 'mdutil': return `mdutil spotlight ${op.volume}`;
    case 'spctl': return 'spctl gatekeeper';
    case 'reg': return `registry ${op.hive}\\${op.path} ${op.name}`;
    case 'powercfg': return `powercfg ${op.what}`;
    case 'service': return `service ${op.name}`;
    case 'winfeature': return `optional feature ${op.name}`;
    case 'gsettings': return `gsettings dconf ${op.schema} ${op.key}`;
    case 'sysctl': return `sysctl ${op.key}`;
    case 'systemd': return `systemd ${op.unit}`;
    case 'timedatectl': return `timedatectl ${op.what}`;
    case 'advice': return 'advice';
  }
}

/** Problems with the catalogue itself (run by the tests): an empty list means every entry is complete and safe. */
export function validateCatalog(list: SettingDef[] = CATALOG): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    const at = (m: string) => out.push(`${s.id}: ${m}`);
    if (seen.has(s.id)) at('duplicate id');
    seen.add(s.id);
    if (!/^(mac|win|linux)\.[a-z0-9.]+$/.test(s.id)) at('bad id');
    if (!s.title || !s.description) at('missing title or description');
    if (!s.sources.length || s.sources.some((u) => !/^https:\/\//.test(u))) at('needs https sources');
    if (!['low', 'medium', 'high'].includes(s.risk)) at('bad risk');
    if (s.risk === 'high' && !s.warning && s.op.t !== 'advice' && s.kind !== 'choice') at('high risk needs a warning');
    if (s.op.t === 'advice') {
      if (!s.steps?.length) at('advice needs steps');
      continue;
    }
    // reader, setter and revert must exist and accept the entry's own values
    if (s.kind === 'toggle' && (s.on === undefined || s.off === undefined || s.on === s.off)) at('toggle needs distinct on/off');
    if (s.kind === 'choice' && (!s.choices || s.choices.length < 2)) at('choice needs choices');
    const values = s.kind === 'toggle' ? [s.on!, s.off!] : s.kind === 'choice' ? s.choices!.map((c) => c.value) : [];
    for (const v of values) {
      if (validateValue(s, v)) at(`own value ${v} rejected: ${validateValue(s, v)}`);
      else if (!writeCmds(s, v).length) at(`no setter for ${v}`);
    }
    if (s.systemDefault === UNSET && !s.removeToRestore && !['defaults', 'reg', 'gsettings'].includes(s.op.t)) at('UNSET default needs a removable op');
    if (s.systemDefault !== UNSET && s.kind !== 'text' && validateValue(s, s.systemDefault)) at(`default ${s.systemDefault} rejected`);
    if (!removeCmds(s).length) at('no revert');
    const keyName = s.op.t === 'defaults' ? s.op.domain : '';
    if (keyName.startsWith('/') && !s.admin) at('system domain needs admin');
    if (s.op.t === 'sysctl' && !s.admin) at('sysctl needs admin');
  }
  return out;
}

export function catalogCounts(): Record<Os, number> {
  return { darwin: catalogFor('darwin').length, win32: catalogFor('win32').length, linux: catalogFor('linux').length };
}
