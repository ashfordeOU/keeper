// SPDX-License-Identifier: AGPL-3.0-or-later
// Automatic tidy-up rules. Every rule is off until the user turns it on, can be
// previewed as a dry run, only moves files or sends them to the Trash, and is
// recorded in the history so it can be undone.

import path from 'node:path';
import { DAY } from './format';
import { passesFilters, scoreTerms } from './query/match';
import { parseQuery } from './query/parse';
import type { FileEntry, Rule, RuleAction, RuleCondition, RulePlanItem } from './types';

export function defaultRules(home: string): Rule[] {
  return [
    {
      id: 'old-installers',
      name: 'Send old installers to the Trash',
      enabled: false,
      conditions: [{ type: 'kind', kinds: ['installer'] }, { type: 'olderThanDays', days: 14 }],
      action: { type: 'trash' },
      scope: [path.join(home, 'Downloads')],
    },
    {
      id: 'screenshots-by-month',
      name: 'File screenshots into monthly folders',
      enabled: false,
      conditions: [{ type: 'screenshot' }, { type: 'olderThanDays', days: 1 }],
      action: { type: 'move', to: path.join(home, 'Pictures', 'Screenshots', '{yyyy}-{MM}') },
      scope: [path.join(home, 'Desktop'), path.join(home, 'Downloads')],
    },
    {
      id: 'downloads-by-source',
      name: 'Sort downloads into folders by where they came from',
      enabled: false,
      conditions: [{ type: 'olderThanDays', days: 7 }],
      action: { type: 'move', to: path.join(home, 'Downloads', '{source}') },
      scope: [path.join(home, 'Downloads')],
    },
    {
      id: 'unfinished-downloads',
      name: 'Clear downloads that never finished',
      enabled: false,
      conditions: [{ type: 'nameMatches', pattern: '*.crdownload|*.part|*.partial|*.download' }, { type: 'olderThanDays', days: 3 }],
      action: { type: 'trash' },
      scope: [path.join(home, 'Downloads')],
    },
  ];
}

/** Turns a simple wildcard list ("*.part|report-*") into a RegExp. */
export function globToRegExp(pattern: string): RegExp {
  const alts = pattern.split('|').map((p) => p.trim()).filter(Boolean).map((p) => p.replace(/[.+^${}()[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'));
  return new RegExp(`^(?:${alts.join('|')})$`, 'i');
}

function inScope(f: FileEntry, scope: string[]): boolean {
  if (scope.length === 0) return true;
  // Normalised, so "C:/Users/x/Downloads" and "C:\\Users\\x\\Downloads\\" are the same folder.
  const norm = (p: string) => path.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
  const dir = norm(path.dirname(f.path));
  // Rules look at the top of each folder only, never into sub-folders they created.
  return scope.some((s) => dir === norm(s));
}

export function conditionMatches(f: FileEntry, c: RuleCondition, now = Date.now()): boolean {
  switch (c.type) {
    case 'kind': return c.kinds.includes(f.kind);
    case 'ext': return c.exts.map((e) => e.toLowerCase().replace(/^\./, '')).includes(f.ext);
    case 'screenshot': return !!f.screenshot;
    case 'olderThanDays': {
      const t = c.field === 'created' ? f.btime || f.mtime : c.field === 'opened' ? Math.max(f.atime || 0, f.mtime) : f.mtime;
      return now - t > c.days * DAY;
    }
    case 'largerThan': return f.size > c.bytes;
    case 'inFolder': return f.path.toLowerCase().startsWith(c.folder.toLowerCase() + path.sep) || f.root.toLowerCase() === c.folder.toLowerCase();
    case 'source': return !!f.source && c.sources.includes(f.source.id);
    case 'nameMatches': return globToRegExp(c.pattern).test(f.name);
    case 'query': {
      const { query } = parseQuery(c.text, now);
      return passesFilters(f, query) && scoreTerms(f, query).score >= 0;
    }
  }
}

export function ruleMatches(f: FileEntry, r: Rule, now = Date.now()): boolean {
  return inScope(f, r.scope) && r.conditions.every((c) => conditionMatches(f, c, now));
}

const SAFE_SEGMENT = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 80) || 'Other';

/** Fills {yyyy} {MM} {dd} {kind} {ext} {source} placeholders from the file. */
export function resolveDestination(template: string, f: FileEntry): string {
  const d = new Date(f.mtime);
  const map: Record<string, string> = {
    yyyy: String(d.getFullYear()),
    MM: String(d.getMonth() + 1).padStart(2, '0'),
    dd: String(d.getDate()).padStart(2, '0'),
    month: d.toLocaleString('en-US', { month: 'long' }),
    kind: f.kind.charAt(0).toUpperCase() + f.kind.slice(1),
    ext: f.ext || 'none',
    source: f.source?.name ?? 'Other',
  };
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in map ? SAFE_SEGMENT(map[k]) : m));
}

/** A dry run: what the rule would do right now. */
export function planRule(files: FileEntry[], r: Rule, now = Date.now()): RulePlanItem[] {
  const plan: RulePlanItem[] = [];
  for (const f of files) {
    if (f.cloudOnly || !ruleMatches(f, r, now)) continue;
    const item: RulePlanItem = { file: f, action: r.action };
    if (r.action.type === 'move') {
      const dir = resolveDestination(r.action.to, f);
      // Already where it belongs.
      if (path.dirname(f.path).toLowerCase() === dir.toLowerCase()) continue;
      item.to = path.join(dir, f.name);
    }
    plan.push(item);
  }
  return plan;
}

export function describeAction(a: RuleAction): string {
  if (a.type === 'trash') return 'Move to Trash';
  if (a.type === 'tag') return `Tag #${a.tag}`;
  return `Move to ${a.to}`;
}

export function describeCondition(c: RuleCondition): string {
  switch (c.type) {
    case 'kind': return c.kinds.join(' or ');
    case 'ext': return c.exts.map((e) => '.' + e).join(', ');
    case 'screenshot': return 'is a screenshot';
    case 'olderThanDays': return `${c.field === 'opened' ? 'not opened for' : 'older than'} ${c.days} day${c.days === 1 ? '' : 's'}`;
    case 'largerThan': return `larger than ${Math.round(c.bytes / 1048576)} MB`;
    case 'inFolder': return `in ${c.folder}`;
    case 'source': return `downloaded from ${c.sources.join(' or ')}`;
    case 'nameMatches': return `name matches ${c.pattern}`;
    case 'query': return `matches “${c.text}”`;
  }
}

/** If a file with the same name is already there, add " 2", " 3", ... */
export function uniqueName(target: string, exists: (p: string) => boolean): string {
  if (!exists(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let i = 2; i < 10_000; i++) {
    const p = path.join(dir, `${base} ${i}${ext}`);
    if (!exists(p)) return p;
  }
  return path.join(dir, `${base} ${Date.now()}${ext}`);
}
