// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Small text formats Keeper reads and writes itself: subtitles, calendars,
// contacts and notebooks.

import { writeCsv, xmlEncode } from './data';

// ---------------------------------------------------------------- subtitles

export interface Cue { start: number; end: number; text: string }

export type SubFormat = 'srt' | 'vtt' | 'ass' | 'ssa' | 'lrc' | 'sbv' | 'txt' | 'json';

function clock(t: string): number {
  const m = t.trim().replace(',', '.').match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function parseSubtitles(text: string, ext: string): Cue[] {
  const s = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const e = ext.toLowerCase();
  if (e === 'ass' || e === 'ssa') {
    const cues: Cue[] = [];
    let fields: string[] = [];
    for (const line of s.split('\n')) {
      if (/^Format:/i.test(line) && fields.length === 0 && /Text/.test(line) && /Start/.test(line)) fields = line.slice(7).split(',').map((f) => f.trim().toLowerCase());
      const m = line.match(/^Dialogue:\s*(.*)$/i);
      if (!m) continue;
      const f = fields.length ? fields : ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const parts = m[1].split(',');
      const textAt = f.indexOf('text');
      const v = (k: string) => parts[f.indexOf(k)];
      cues.push({ start: clock(v('start')), end: clock(v('end')), text: parts.slice(textAt).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim() });
    }
    return cues;
  }
  if (e === 'lrc') {
    const out: Cue[] = [];
    for (const line of s.split('\n')) {
      const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      const t = line.replace(/\[[^\]]*\]/g, '').trim();
      for (const st of stamps) out.push({ start: Number(st[1]) * 60 + Number(st[2]), end: NaN, text: t });
    }
    out.sort((a, b) => a.start - b.start);
    out.forEach((c, i) => (c.end = out[i + 1]?.start ?? c.start + 4));
    return out.filter((c) => c.text);
  }
  if (e === 'json') return (JSON.parse(s) as Cue[]).map((c) => ({ start: Number(c.start), end: Number(c.end), text: String(c.text) }));
  // SRT, VTT, SBV: blocks separated by blank lines with "a --> b" (or "a,b" in SBV).
  const out: Cue[] = [];
  for (const block of s.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const at = lines.findIndex((l) => /-->/.test(l) || /^\d+:\d+:\d+\.\d+,\d+:\d+:\d+\.\d+$/.test(l.trim()));
    if (at < 0) continue;
    const [a, b] = lines[at].includes('-->') ? lines[at].split('-->') : lines[at].split(',');
    const start = clock(a);
    const end = clock(b.trim().split(/\s+/)[0]);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    out.push({ start, end, text: lines.slice(at + 1).join('\n').replace(/<[^>]+>/g, '').trim() });
  }
  return out;
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
function stamp(t: number, sep: string, msDigits = 3): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const frac = String(ms % 1000).padStart(3, '0').slice(0, msDigits);
  return `${pad(h)}:${pad(m)}:${pad(sec)}${sep}${frac}`;
}

export function writeSubtitles(cues: Cue[], format: SubFormat): string {
  switch (format) {
    case 'srt': return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');
    case 'vtt': return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n')}`;
    case 'sbv': return cues.map((c) => `${stamp(c.start, '.').replace(/^0/, '')},${stamp(c.end, '.').replace(/^0/, '')}\n${c.text}\n`).join('\n');
    case 'lrc': return cues.map((c) => `[${pad(Math.floor(c.start / 60))}:${(c.start % 60).toFixed(2).padStart(5, '0')}]${c.text.replace(/\n/g, ' ')}`).join('\n') + '\n';
    case 'txt': return cues.map((c) => c.text).join('\n') + '\n';
    case 'json': return JSON.stringify(cues, null, 2);
    case 'ass': case 'ssa': {
      const t = (x: number) => stamp(x, '.', 2).replace(/^0/, '');
      return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,56,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,40,40,50,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${cues.map((c) => `Dialogue: 0,${t(c.start)},${t(c.end)},Default,,0,0,0,,${c.text.replace(/\n/g, '\\N')}`).join('\n')}\n`;
    }
  }
}

/** Moves every cue by seconds (negative is earlier) and stretches by a factor (for frame-rate changes). */
export function shiftCues(cues: Cue[], seconds: number, factor = 1): Cue[] {
  return cues.map((c) => ({ ...c, start: Math.max(0, c.start * factor + seconds), end: Math.max(0, c.end * factor + seconds) }));
}

// ---------------------------------------------------------------- calendars and contacts

/** Unfolds RFC 5545/6350 content lines into name, parameters and value. */
export function contentLines(text: string): { name: string; params: Record<string, string>; value: string }[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out: { name: string; params: Record<string, string>; value: string }[] = [];
  for (const l of lines) {
    const m = l.match(/^([A-Za-z0-9-.]+)((?:;[^:;]+=(?:"[^"]*"|[^:;]*))*):(.*)$/);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (const p of m[2].matchAll(/;([^=;]+)=("[^"]*"|[^:;]*)/g)) params[p[1].toUpperCase()] = p[2].replace(/^"|"$/g, '');
    out.push({ name: m[1].replace(/^item\d+\./i, '').toUpperCase(), params, value: m[3] });
  }
  return out;
}

const unescapeText = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** "20261031T090000Z" -> "2026-10-31 09:00 UTC"; all-day dates stay dates. */
export function icsDate(v: string, tz?: string): string {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return v;
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}${m[7] ? ' UTC' : tz ? ` ${tz}` : ''}`;
}

export interface CalEvent { summary: string; start: string; end: string; location: string; description: string; organizer: string; status: string; rrule: string; uid: string }

export function parseIcs(text: string): CalEvent[] {
  const out: CalEvent[] = [];
  let cur: CalEvent | null = null;
  let depth = 0;
  for (const l of contentLines(text)) {
    if (l.name === 'BEGIN' && l.value.toUpperCase() === 'VEVENT') { cur = { summary: '', start: '', end: '', location: '', description: '', organizer: '', status: '', rrule: '', uid: '' }; depth = 0; continue; }
    if (!cur) continue;
    if (l.name === 'BEGIN') { depth++; continue; }
    if (l.name === 'END' && depth > 0) { depth--; continue; }
    if (l.name === 'END' && l.value.toUpperCase() === 'VEVENT') { out.push(cur); cur = null; continue; }
    if (depth) continue;
    switch (l.name) {
      case 'SUMMARY': cur.summary = unescapeText(l.value); break;
      case 'DTSTART': cur.start = icsDate(l.value, l.params.TZID); break;
      case 'DTEND': cur.end = icsDate(l.value, l.params.TZID); break;
      case 'LOCATION': cur.location = unescapeText(l.value); break;
      case 'DESCRIPTION': cur.description = unescapeText(l.value); break;
      case 'ORGANIZER': cur.organizer = (l.params.CN ? `${l.params.CN} ` : '') + l.value.replace(/^mailto:/i, ''); break;
      case 'STATUS': cur.status = l.value; break;
      case 'RRULE': cur.rrule = l.value; break;
      case 'UID': cur.uid = l.value; break;
    }
  }
  return out;
}

export interface Contact { name: string; given: string; family: string; org: string; title: string; emails: string[]; phones: string[]; address: string; url: string; birthday: string; note: string }

export function parseVcf(text: string): Contact[] {
  const out: Contact[] = [];
  let c: Contact | null = null;
  for (const l of contentLines(text)) {
    if (l.name === 'BEGIN' && /vcard/i.test(l.value)) { c = { name: '', given: '', family: '', org: '', title: '', emails: [], phones: [], address: '', url: '', birthday: '', note: '' }; continue; }
    if (!c) continue;
    if (l.name === 'END') { if (!c.name) c.name = [c.given, c.family].filter(Boolean).join(' ') || c.org || c.emails[0] || ''; out.push(c); c = null; continue; }
    const v = unescapeText(l.value);
    switch (l.name) {
      case 'FN': c.name = v; break;
      case 'N': { const [fam, giv] = l.value.split(';'); c.family = unescapeText(fam ?? ''); c.given = unescapeText(giv ?? ''); break; }
      case 'ORG': c.org = v.replace(/;/g, ', ').replace(/, $/, ''); break;
      case 'TITLE': c.title = v; break;
      case 'EMAIL': c.emails.push(v); break;
      case 'TEL': c.phones.push(v.replace(/^tel:/i, '')); break;
      case 'ADR': c.address = l.value.split(';').map(unescapeText).filter(Boolean).join(', '); break;
      case 'URL': c.url = v; break;
      case 'BDAY': c.birthday = v; break;
      case 'NOTE': c.note = v; break;
    }
  }
  return out;
}

export function eventsToCsv(events: CalEvent[]): string {
  return writeCsv([['Subject', 'Start', 'End', 'Location', 'Description', 'Organizer', 'Status', 'Repeats', 'UID'], ...events.map((e) => [e.summary, e.start, e.end, e.location, e.description, e.organizer, e.status, e.rrule, e.uid])]);
}

export function contactsToCsv(list: Contact[]): string {
  const maxE = Math.max(1, ...list.map((c) => c.emails.length));
  const maxP = Math.max(1, ...list.map((c) => c.phones.length));
  const head = ['Name', 'Given name', 'Family name', 'Organization', 'Title', ...Array.from({ length: maxE }, (_, i) => `E-mail ${i + 1}`), ...Array.from({ length: maxP }, (_, i) => `Phone ${i + 1}`), 'Address', 'Website', 'Birthday', 'Notes'];
  return writeCsv([head, ...list.map((c) => [c.name, c.given, c.family, c.org, c.title, ...Array.from({ length: maxE }, (_, i) => c.emails[i] ?? ''), ...Array.from({ length: maxP }, (_, i) => c.phones[i] ?? ''), c.address, c.url, c.birthday, c.note])]);
}

/** Contacts back to vCard 3.0 (from a CSV with Name/E-mail/Phone… columns). */
export function contactsToVcf(rows: Record<string, string>[]): string {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const pick = (r: Record<string, string>, re: RegExp) => Object.entries(r).filter(([k, v]) => re.test(k) && v).map(([, v]) => v);
  return rows.map((r) => {
    const name = pick(r, /^(name|full ?name|display ?name)$/i)[0] ?? [pick(r, /^(given|first)/i)[0], pick(r, /^(family|last|surname)/i)[0]].filter(Boolean).join(' ');
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(name)}`, `N:${esc(pick(r, /^(family|last|surname)/i)[0] ?? '')};${esc(pick(r, /^(given|first)/i)[0] ?? '')};;;`];
    for (const o of pick(r, /^(organi[sz]ation|company|org)$/i)) lines.push(`ORG:${esc(o)}`);
    for (const e of pick(r, /e-?mail/i)) lines.push(`EMAIL;TYPE=INTERNET:${e}`);
    for (const p of pick(r, /phone|mobile|tel/i)) lines.push(`TEL:${p}`);
    for (const u of pick(r, /^(website|url|web)$/i)) lines.push(`URL:${u}`);
    for (const n of pick(r, /^notes?$/i)) lines.push(`NOTE:${esc(n)}`);
    lines.push('END:VCARD');
    return lines.join('\r\n');
  }).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- notebooks

interface NbCell { cell_type: 'code' | 'markdown' | 'raw'; source: string | string[]; outputs?: { output_type: string; text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string }[] }

const joinSrc = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join('') : s ?? '');

export function notebookCells(json: string): { lang: string; cells: NbCell[] } {
  const nb = JSON.parse(json) as { cells?: NbCell[]; worksheets?: { cells: NbCell[] }[]; metadata?: { kernelspec?: { language?: string }; language_info?: { name?: string } } };
  const cells = nb.cells ?? nb.worksheets?.[0]?.cells ?? [];
  return { lang: nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? 'python', cells };
}

/** A notebook as a script: markdown becomes comments, code stays code. */
export function notebookToScript(json: string): { text: string; ext: string } {
  const { lang, cells } = notebookCells(json);
  const c = lang === 'python' || lang === 'r' || lang === 'julia' ? '#' : '//';
  const ext = ({ python: 'py', r: 'r', julia: 'jl', javascript: 'js', typescript: 'ts', scala: 'scala' } as Record<string, string>)[lang] ?? 'txt';
  const text = cells.map((cell) => {
    const src = joinSrc(cell.source);
    return cell.cell_type === 'code' ? `${c} %%\n${src}` : `${c} %% [markdown]\n${src.split('\n').map((l) => `${c} ${l}`).join('\n')}`;
  }).join('\n\n') + '\n';
  return { text, ext };
}

export function notebookToMarkdown(json: string): string {
  const { lang, cells } = notebookCells(json);
  return cells.map((cell) => {
    const src = joinSrc(cell.source);
    if (cell.cell_type !== 'code') return src;
    const outs = (cell.outputs ?? []).map((o) => {
      const t = joinSrc(o.text ?? o.data?.['text/plain']) || (o.ename ? `${o.ename}: ${o.evalue}` : '');
      const img = o.data?.['image/png'];
      return img ? `![output](data:image/png;base64,${joinSrc(img).replace(/\s/g, '')})` : t ? `\`\`\`\n${t.trimEnd()}\n\`\`\`` : '';
    }).filter(Boolean);
    return [`\`\`\`${lang}\n${src.trimEnd()}\n\`\`\``, ...outs].join('\n\n');
  }).join('\n\n') + '\n';
}

export function notebookToHtml(json: string, title: string, markdownToHtml: (md: string) => string): string {
  const { cells } = notebookCells(json);
  const e = (t: string) => xmlEncode(t);
  const body = cells.map((cell) => {
    const src = joinSrc(cell.source);
    if (cell.cell_type === 'markdown') return `<div class="md">${markdownToHtml(src)}</div>`;
    if (cell.cell_type === 'raw') return `<pre>${e(src)}</pre>`;
    const outs = (cell.outputs ?? []).map((o) => {
      const img = o.data?.['image/png'];
      if (img) return `<img src="data:image/png;base64,${joinSrc(img).replace(/\s/g, '')}">`;
      const html = o.data?.['text/html'];
      if (html) return `<div class="html">${joinSrc(html).replace(/<script[\s\S]*?<\/script>/gi, '')}</div>`;
      const t = joinSrc(o.text ?? o.data?.['text/plain']) || (o.ename ? `${o.ename}: ${o.evalue}` : '');
      return t ? `<pre class="out">${e(t)}</pre>` : '';
    }).join('');
    return `<pre class="code">${e(src)}</pre>${outs}`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${e(title)}</title><style>body{font:15px/1.55 system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 16px}pre{white-space:pre-wrap;padding:10px 12px;border-radius:6px}pre.code{background:#f5f5f7;border-left:3px solid #6366f1}pre.out{background:#fff;border:1px solid #eee}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:3px 6px}</style>\n${body}`;
}
