// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The visual budget: how much one screen may show at once. A page that asks
// for more puts the rest one click away (a More menu, a tab under More, a
// panel). test/e2e/design-budget.cjs measures every page of the real app at
// 1440×900 and 1024×768 and hands what it saw to checkBudget(); CI fails when a
// page goes over. Pure logic, so the rules themselves are unit-tested.

export const BUDGET = {
  /** tabs in view in one tab row; the rest go under More (src/components/Tabs.tsx) */
  tabs: 6,
  /** buttons with only an icon in one toolbar row */
  iconButtons: 5,
  /** filled accent buttons on one screen */
  primaries: 1,
  /** words in a page title */
  titleWords: 4,
} as const;

export interface Box { x: number; y: number; w: number; h: number }

/** A visible button, as the page draws it. */
export interface SeenButton extends Box {
  /** its accessible name (aria-label, title or text) */
  name: string;
  /** an icon and no words */
  iconOnly: boolean;
  /** where on the page, for the report */
  where: string;
}

export interface SeenTabRow { label: string; tabs: number; where: string }

/** A text that does not fit: `fits` is how many of its characters show before the cut. */
export interface SeenClip { text: string; fits: number; kind: 'title' | 'tab' | 'button' | 'row' | 'placeholder' | 'choice' | 'label'; where: string }

export interface SeenText { text: string; where: string }

/** Everything the budget needs from one page at one window size. */
export interface PageSnapshot {
  page: string;
  size: string;
  title?: string;
  buttons: SeenButton[];
  tabRows: SeenTabRow[];
  primaries: SeenText[];
  clipped: SeenClip[];
  /** visible words on the page (not what people typed, not code or terminals) */
  texts: SeenText[];
  /** "Nothing here yet"-style words shown outside the designed empty state */
  plainEmpties?: SeenText[];
}

export type Rule = 'tabs' | 'icon-buttons' | 'unnamed-icon' | 'primaries' | 'mid-word-cut' | 'raw-path' | 'title-words' | 'plain-empty';

export interface Violation { page: string; size: string; rule: Rule; detail: string; where?: string }

const sameRow = (a: Box, b: Box) => Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) <= Math.max(6, Math.min(a.h, b.h) / 3);

/**
 * Buttons that sit side by side in one row, close together: one toolbar. Labelled buttons
 * count as part of the row (they join its icons together) but only icon-only ones count
 * against the budget.
 */
export function toolbarsOf<T extends Box>(buttons: T[], gap = 48): T[][] {
  const left = [...buttons].sort((a, b) => a.x - b.x);
  const rows: T[][] = [];
  for (const b of left) {
    const row = rows.find((r) => { const last = r[r.length - 1]; return sameRow(last, b) && b.x - (last.x + last.w) <= gap && b.x >= last.x; });
    if (row) row.push(b);
    else rows.push([b]);
  }
  return rows;
}

const WORD = /[\p{L}\p{N}]/u;

/** Cut inside a word: the last character shown and the first one hidden are both letters or digits. */
export function cutMidWord(text: string, fits: number): boolean {
  const t = [...text];
  if (fits <= 0 || fits >= t.length) return false;
  return WORD.test(t[fits - 1]) && WORD.test(t[fits]);
}

// Temporary folders: what a person should never see in a label.
const TEMP = [/(^|[\s(“"'`])\/tmp\//, /\/var\/folders\//, /\/private\/var\//, /\\AppData\\Local\\Temp\\/i, /%TEMP%/i, /\btmp\.[A-Za-z0-9]{6,}\b/, /\/\.cache\//];
// An absolute path of two or more folders, on any system (/Users/ana/Documents, C:\Users\ana, ~/Projects/x).
const PATH = /(?:^|[\s(“"'`=])((?:\/|~\/)(?:[\w.@+-]+\/)+[\w.@+-]*|[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*)/g;
// Addresses, not files.
const NOT_A_PATH = /^\/\/|^\/(?:v\d|api)\//;

/** Raw file system paths and temporary folders in a piece of visible text. */
export function rawPathsIn(text: string): string[] {
  const out: string[] = [];
  for (const re of TEMP) { const m = text.match(re); if (m) out.push(text.slice(Math.max(0, m.index ?? 0), (m.index ?? 0) + 40).trim()); }
  for (const m of text.matchAll(PATH)) {
    const p = m[1];
    if (NOT_A_PATH.test(p) || /:\/\//.test(text.slice(Math.max(0, (m.index ?? 0) - 8), (m.index ?? 0) + 1))) continue;
    // A date or a fraction ("1/2", "11/04/2026") is not a path; a path names at least two folders.
    if (!/[A-Za-z]/.test(p) || p.split(/[\\/]/).filter(Boolean).length < 2) continue;
    if (!out.some((o) => o.includes(p) || p.includes(o))) out.push(p);
  }
  return out;
}

export const words = (s: string) => s.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Every way this page goes over the budget. */
export function checkBudget(s: PageSnapshot): Violation[] {
  const v: Violation[] = [];
  const add = (rule: Rule, detail: string, where?: string) => v.push({ page: s.page, size: s.size, rule, detail, where });
  for (const r of s.tabRows) if (r.tabs > BUDGET.tabs) add('tabs', `${r.tabs} tabs in view in “${r.label}” (at most ${BUDGET.tabs}; the rest go under More)`, r.where);
  for (const row of toolbarsOf(s.buttons)) {
    const icons = row.filter((b) => b.iconOnly);
    if (icons.length > BUDGET.iconButtons) add('icon-buttons', `${icons.length} icon-only buttons in one row (at most ${BUDGET.iconButtons}): ${icons.map((b) => b.name || '?').join(', ')}`, icons[0].where);
  }
  for (const b of s.buttons) if (b.iconOnly && !b.name.trim()) add('unnamed-icon', 'an icon-only button with no label or tooltip', b.where);
  if (s.primaries.length > BUDGET.primaries) add('primaries', `${s.primaries.length} filled buttons (at most ${BUDGET.primaries}): ${s.primaries.map((p) => p.text).join(', ')}`, s.primaries[1].where);
  for (const c of s.clipped) if (cutMidWord(c.text, c.fits)) add('mid-word-cut', `“${[...c.text].slice(0, c.fits).join('')}…” (${c.kind}) is cut inside a word`, c.where);
  const seen = new Set<string>();
  for (const t of s.texts) {
    for (const p of rawPathsIn(t.text)) {
      if (seen.has(p)) continue;
      seen.add(p);
      add('raw-path', `a raw path in the page: “${p.slice(0, 60)}” in “${t.text.slice(0, 80)}”`, t.where);
    }
  }
  for (const e of (s.plainEmpties ?? []).filter((x) => soundsEmpty(x.text))) add('plain-empty', `“${e.text.slice(0, 60)}” is a plain line where a designed empty state belongs (Empty in src/components/ui.tsx)`, e.where);
  if (s.title && words(s.title) > BUDGET.titleWords) add('title-words', `the title “${s.title}” has ${words(s.title)} words (at most ${BUDGET.titleWords})`);
  return v;
}

/** Words that say a list or page is empty ("No backups yet", "Nothing here", "Nothing to show"). */
export function soundsEmpty(text: string): boolean {
  const t = text.trim();
  return t.length <= 90 && /^(no|nothing)\b/i.test(t) && /\b(yet|here|found|to show|so far|added)\b\.?$/i.test(t.replace(/[.!…]+$/, ''));
}

/** A short report, one line per problem, grouped by page. */
export function budgetReport(all: Violation[]): string {
  if (!all.length) return 'Every page is within the visual budget.';
  const by = new Map<string, Violation[]>();
  for (const x of all) by.set(x.page, [...(by.get(x.page) ?? []), x]);
  const lines: string[] = [];
  for (const [page, list] of by) {
    lines.push(`${page}`);
    for (const x of list) lines.push(`  [${x.size}] ${x.rule}: ${x.detail}${x.where ? `  (${x.where})` : ''}`);
  }
  return lines.join('\n');
}
