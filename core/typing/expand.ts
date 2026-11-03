// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Typed snippets: type a short abbreviation (";addr", "/sig") anywhere and it
// becomes its text. The same list as Dictation's spoken snippets (one list
// for voice and typing): a snippet can have something to say, something to
// type, or both. Pure: what was typed, which abbreviation it ends with, and
// the text with its placeholders filled in.
//
// Placeholders in a snippet's text:
//   {date}  {date long}  {date short}  {date iso}  {date +3d}  {date iso -1w}
//   {time}  {time 24h}  {time +2h}     {weekday}  {weekday +1d}
//   {clipboard}                        what is on the clipboard
//   {cursor}                           where the cursor ends up
//   {snippet ;sig}                     another snippet's text
//   {{ and }}                          a brace

import type { Snippet } from '../voice/types';
import type { TypedEvent } from './keys';

export interface TypingSettings {
  /** apps where typed snippets never expand (matched by name) */
  excludeApps: string[];
}

export function defaultTyping(): TypingSettings {
  return { excludeApps: ['1Password', 'Bitwarden', 'KeePass', 'KeePassXC', 'Keychain Access', 'LastPass', 'Dashlane', 'Enpass', 'Proton Pass'] };
}

export function normalizeTyping(raw: unknown): TypingSettings {
  const d = defaultTyping();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<TypingSettings>;
  return { excludeApps: Array.isArray(r.excludeApps) ? r.excludeApps.filter((a): a is string => typeof a === 'string' && !!a.trim()).map((a) => a.trim()) : d.excludeApps };
}

/** Is this app on the list? (by name, ignoring case; "Code" matches "Visual Studio Code") */
export function appExcluded(app: string | undefined, list: string[]): boolean {
  if (!app) return false;
  const a = app.toLowerCase();
  return list.some((x) => x.trim() && a.includes(x.trim().toLowerCase()));
}

// ---------------------------------------------------------------- what was typed

/** The last characters typed in the field in front (cleared by Enter, arrows, clicks and shortcuts). */
export class TypedBuffer {
  text = '';
  constructor(private max = 64) {}
  feed(e: TypedEvent) {
    if (e.t === 'char') this.text = (this.text + e.c).slice(-this.max);
    else if (e.t === 'back') this.text = this.text.slice(0, -1);
    else this.text = '';
  }
  clear() { this.text = ''; }
}

/** An abbreviation may be typed with any letters, digits and marks, but no spaces, 2–32 characters. */
export function validAbbr(abbr: string): boolean {
  return /^\S{2,32}$/.test(abbr);
}

const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/**
 * The snippet whose abbreviation the typed text ends with (the longest one).
 * An abbreviation that starts with a letter or digit counts only at the start
 * of a word, so "addr" inside "paddr" is left alone; one that starts with a
 * mark (";addr", "/sig") counts anywhere.
 */
export function findAbbreviation(typed: string, snippets: Snippet[]): Snippet | undefined {
  let best: Snippet | undefined;
  for (const s of snippets) {
    const a = s.abbr;
    if (!a || !validAbbr(a) || !typed.endsWith(a)) continue;
    if (wordChar(a[0]) && wordChar(typed[typed.length - a.length - 1])) continue;
    if (!best || a.length > best.abbr!.length) best = s;
  }
  return best;
}

// ---------------------------------------------------------------- placeholders

export interface RenderContext {
  now: Date;
  /** the clipboard's text (read only when the snippet asks for it) */
  clipboard?: string;
  locale?: string;
  /** other snippets, for {snippet …} */
  snippets?: Snippet[];
}

export interface Rendered {
  text: string;
  /** characters from the end where the cursor goes ({cursor}); 0 = at the end */
  cursorBack: number;
  /** it used the clipboard */
  usedClipboard: boolean;
}

/** "+3d", "-1w", "+2m", "+1y", "+4h", "+30min": shifts a date. Undefined for anything else. */
export function shiftDate(d: Date, spec: string): Date | undefined {
  const m = /^([+-])(\d{1,4})(min|d|w|m|y|h)$/.exec(spec.trim());
  if (!m) return undefined;
  const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  const r = new Date(d.getTime());
  if (m[3] === 'min') r.setMinutes(r.getMinutes() + n);
  else if (m[3] === 'h') r.setHours(r.getHours() + n);
  else if (m[3] === 'd') r.setDate(r.getDate() + n);
  else if (m[3] === 'w') r.setDate(r.getDate() + n * 7);
  else if (m[3] === 'm') r.setMonth(r.getMonth() + n);
  else r.setFullYear(r.getFullYear() + n);
  return r;
}

const pad = (n: number) => String(n).padStart(2, '0');

function datePart(name: string, args: string[], ctx: RenderContext): string | undefined {
  let d = ctx.now;
  let style = '';
  for (const a of args) {
    const s = shiftDate(d, a);
    if (s) d = s;
    else if (!style) style = a.toLowerCase();
    else return undefined;
  }
  const loc = ctx.locale;
  if (name === 'date') {
    if (!style) return d.toLocaleDateString(loc, { dateStyle: 'medium' });
    if (style === 'long') return d.toLocaleDateString(loc, { dateStyle: 'long' });
    if (style === 'short') return d.toLocaleDateString(loc, { dateStyle: 'short' });
    if (style === 'full') return d.toLocaleDateString(loc, { dateStyle: 'full' });
    if (style === 'iso') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return undefined;
  }
  if (name === 'time') {
    if (!style) return d.toLocaleTimeString(loc, { timeStyle: 'short' });
    if (style === '24h') return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return undefined;
  }
  if (name === 'weekday' && !style) return d.toLocaleDateString(loc, { weekday: 'long' });
  return undefined;
}

/** A snippet's text with its placeholders filled in. Unknown placeholders stay as they are. */
export function renderSnippet(text: string, ctx: RenderContext, depth = 0): Rendered {
  let out = '';
  let cursorAt = -1;
  let usedClipboard = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '{' && text[i + 1] === '{') { out += '{'; i += 2; continue; }
    if (c === '}' && text[i + 1] === '}') { out += '}'; i += 2; continue; }
    if (c === '{') {
      const end = text.indexOf('}', i + 1);
      const body = end > i ? text.slice(i + 1, end).trim() : '';
      const [name, ...args] = body.split(/\s+/);
      let value: string | undefined;
      const n = (name ?? '').toLowerCase();
      if (n === 'cursor' && !args.length) { if (cursorAt < 0) cursorAt = out.length; value = ''; }
      else if (n === 'clipboard' && !args.length) { value = ctx.clipboard ?? ''; usedClipboard = true; }
      else if (n === 'date' || n === 'time' || n === 'weekday') value = datePart(n, args, ctx);
      else if (n === 'snippet' && args.length === 1 && depth < 3) {
        const other = ctx.snippets?.find((s) => s.abbr === args[0] || s.trigger === args[0]);
        if (other) {
          const r = renderSnippet(other.text, ctx, depth + 1);
          value = r.text;
          usedClipboard ||= r.usedClipboard;
        }
      }
      if (end > i && value !== undefined) { out += value; i = end + 1; continue; }
    }
    out += c;
    i++;
  }
  return { text: out, cursorBack: cursorAt < 0 ? 0 : out.length - cursorAt, usedClipboard };
}

/** Does the text ask for the clipboard (directly or through another snippet)? */
export function needsClipboard(text: string): boolean {
  return /\{\s*clipboard\s*\}|\{\s*snippet\s/i.test(text);
}

// ---------------------------------------------------------------- importing

/** Rows of a CSV file (commas, quotes doubled inside quoted fields, line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

/**
 * Snippets from a CSV file: abbreviation, text and (optionally) what to say.
 * A first row of column names is skipped. Rows with an abbreviation already
 * in `existing`, or with nothing to type, are left out.
 */
export function snippetsFromCsv(text: string, existing: Snippet[], newId: () => string): { added: Snippet[]; skipped: number } {
  const rows = parseCsv(text);
  if (rows.length && /^(abbreviation|abbr|keyword|shortcut|type)$/i.test(rows[0][0]?.trim() ?? '')) rows.shift();
  const have = new Set(existing.map((s) => s.abbr).filter(Boolean));
  const added: Snippet[] = [];
  let skipped = 0;
  for (const r of rows) {
    const abbr = (r[0] ?? '').trim();
    const body = r[1] ?? '';
    if (!validAbbr(abbr) || !body || have.has(abbr)) { skipped++; continue; }
    have.add(abbr);
    added.push({ id: newId(), abbr, text: body, trigger: (r[2] ?? '').trim() });
  }
  return { added, skipped };
}
