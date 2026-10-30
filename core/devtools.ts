// SPDX-License-Identifier: AGPL-3.0-or-later
// More Toolbox helpers, all pure: line diff, cron explainer, lorem ipsum,
// number bases, colour conversion, HTML entities, CSV → JSON and a small,
// safe Markdown renderer.

// ---------------------------------------------------------------- diff

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
  /** line numbers in the left / right text (1-based) */
  a?: number;
  b?: number;
}

/** Line-by-line diff using the longest common subsequence. */
export function diffLines(left: string, right: string): DiffLine[] {
  const a = left.split(/\r?\n/);
  const b = right.split(/\r?\n/);
  // Trim the common head and tail first: most real diffs are small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  if (A.length * B.length > 4_000_000) throw new Error('These texts are too long to compare line by line');
  const dp: Uint32Array[] = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ type: 'same', text: a[k], a: k + 1, b: k + 1 });
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) {
      out.push({ type: 'same', text: A[i], a: start + i + 1, b: start + j + 1 });
      i++;
      j++;
    } else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push({ type: 'add', text: B[j], b: start + j + 1 });
      j++;
    } else {
      out.push({ type: 'del', text: A[i], a: start + i + 1 });
      i++;
    }
  }
  for (let k = endA; k < a.length; k++) out.push({ type: 'same', text: a[k], a: k + 1, b: endB + (k - endA) + 1 });
  return out;
}

// ---------------------------------------------------------------- cron

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function cronField(f: string, unit: string, names?: string[], offset = 0): string {
  if (f === '*' || f === '?') return '';
  const name = (v: string) => (names ? names[Number(v) - offset] ?? v : v);
  const step = f.match(/^\*\/(\d+)$/);
  if (step) return `every ${step[1]} ${unit}${step[1] === '1' ? '' : 's'}`;
  const parts = f.split(',').map((p) => {
    const r = p.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
    if (r) return `${name(r[1])} through ${name(r[2])}${r[3] ? ` every ${r[3]}` : ''}`;
    return name(p);
  });
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
}

/** "30 9 * * 1-5" -> "At 09:30, Monday through Friday". Five fields; @daily style aliases. */
export function explainCron(expr: string): string {
  const aliases: Record<string, string> = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };
  const e = aliases[expr.trim()] ?? expr.trim();
  const f = e.split(/\s+/);
  if (f.length !== 5) throw new Error('A cron expression has five fields: minute hour day-of-month month day-of-week');
  const [min, hour, dom, mon, dow] = f;
  for (const x of f) if (!/^(\*|\?|\*\/\d+|\d+(-\d+)?(\/\d+)?)(,(\d+(-\d+)?(\/\d+)?))*$/.test(x)) throw new Error(`“${x}” is not a valid cron field`);
  let time: string;
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) time = `At ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  else {
    const m = min === '*' ? 'every minute' : /^\d+$/.test(min) ? `at minute ${min}` : cronField(min, 'minute');
    const h = hour === '*' ? '' : /^\d+$/.test(hour) ? ` past hour ${hour}` : `, ${cronField(hour, 'hour')}`;
    time = (m.charAt(0).toUpperCase() + m.slice(1)) + h;
  }
  const bits = [time];
  if (dom !== '*' && dom !== '?') bits.push(`on day ${cronField(dom, 'day')} of the month`);
  if (mon !== '*') bits.push(`in ${cronField(mon, 'month', MON, 1)}`);
  if (dow !== '*' && dow !== '?') bits.push(cronField(dow.replace(/\b7\b/g, '0'), 'day', DOW, 0));
  return bits.join(', ');
}

// ---------------------------------------------------------------- lorem ipsum

const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum'.split(' ');

export function lorem(paragraphs = 3, sentences = 5, seed = 1): string {
  let s = seed;
  const rnd = (n: number) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % n;
  };
  const out: string[] = [];
  for (let p = 0; p < paragraphs; p++) {
    const ss: string[] = [];
    for (let k = 0; k < sentences; k++) {
      const len = 6 + rnd(10);
      const words = Array.from({ length: len }, (_, i) => (p === 0 && k === 0 && i < 5 ? LOREM[i] : LOREM[rnd(LOREM.length)]));
      ss.push(words.join(' ').replace(/^./, (c) => c.toUpperCase()) + '.');
    }
    out.push(ss.join(' '));
  }
  return out.join('\n\n');
}

// ---------------------------------------------------------------- number bases

export function convertBase(input: string, from: number): { bin: string; oct: string; dec: string; hex: string } | undefined {
  const clean = input.trim().toLowerCase().replace(/^0[xbo]/, '').replace(/[_\s]/g, '');
  if (!clean) return undefined;
  const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, from);
  if (![...clean.replace(/^-/, '')].every((c) => digits.includes(c))) return undefined;
  let v: bigint;
  try {
    const neg = clean.startsWith('-');
    v = [...clean.replace(/^-/, '')].reduce((acc, c) => acc * BigInt(from) + BigInt(digits.indexOf(c)), 0n);
    if (neg) v = -v;
  } catch {
    return undefined;
  }
  return { bin: v.toString(2), oct: v.toString(8), dec: v.toString(10), hex: v.toString(16).toUpperCase() };
}

// ---------------------------------------------------------------- colours

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(input: string): Rgb | undefined {
  const s = input.trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 100) / 100 : 1 };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]) : 1 };
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const { r, g, b } = hslToRgb(+m[1], +m[2], +m[3]);
    return { r, g, b, a: m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]) : 1 };
  }
  return undefined;
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** sRGB -> OKLCH (CSS Color 4). */
export function rgbToOklch({ r, g, b }: Rgb): { l: number; c: number; h: number } {
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l_ = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m_ = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s_ = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const Bv = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(A * A + Bv * Bv);
  let H = (Math.atan2(Bv, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { l: Math.round(L * 1000) / 10, c: Math.round(C * 1000) / 1000, h: C < 0.0001 ? 0 : Math.round(H * 10) / 10 };
}

export function colorFormats(input: string): { hex: string; rgb: string; hsl: string; oklch: string; contrastOnWhite: number; contrastOnBlack: number } | undefined {
  const c = parseColor(input);
  if (!c) return undefined;
  const hex = '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') + (c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, '0') : '');
  const { h, s, l } = rgbToHsl(c);
  const o = rgbToOklch(c);
  const alpha = c.a < 1 ? ` / ${c.a}` : '';
  return {
    hex: hex.toUpperCase(),
    rgb: `rgb(${c.r} ${c.g} ${c.b}${alpha})`,
    hsl: `hsl(${h} ${s}% ${l}%${alpha})`,
    oklch: `oklch(${o.l}% ${o.c} ${o.h}${alpha})`,
    contrastOnWhite: contrast(c, { r: 255, g: 255, b: 255, a: 1 }),
    contrastOnBlack: contrast(c, { r: 0, g: 0, b: 0, a: 1 }),
  };
}

function luminance({ r, g, b }: Rgb): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio, rounded to two decimals. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

// ---------------------------------------------------------------- HTML entities

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function htmlEncode(s: string, all = false): string {
  return s.replace(all ? /[ -￿&<>"']/g : /[&<>"']/g, (c) => ENT[c] ?? `&#${c.codePointAt(0)};`);
}

export function htmlDecode(s: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', euro: '€', pound: '£', yen: '¥' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

// ---------------------------------------------------------------- CSV

/** RFC 4180-ish CSV parser (quotes, doubled quotes, newlines inside quotes). Auto-detects , ; or tab. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? [',', ';', '\t'].map((c) => ({ c, n: (text.split('\n')[0].match(new RegExp(c === '\t' ? '\\t' : c, 'g')) ?? []).length })).sort((a, b) => b.n - a.n)[0].c;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

export function csvToJson(text: string): Record<string, string | number | boolean | null>[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const conv = (v: string): string | number | boolean | null => {
    if (v === '') return null;
    if (/^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v)) return Number(v);
    if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
    return v;
  };
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h || `column${i + 1}`, conv(r[i] ?? '')])));
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

// ---------------------------------------------------------------- Markdown

/** A small Markdown renderer for previews. All input is escaped first, so the output is safe to show. */
export function markdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  let code: string[] | null = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join(' ')}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (code) {
      if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushPara(); closeList(); code = []; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); }
    else if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); }
    else if (/^>\s?/.test(line)) { flushPara(); closeList(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); }
    else if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else if (!line.trim()) { flushPara(); closeList(); }
    else { closeList(); para.push(line.trim()); }
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flushPara();
  closeList();
  return out.join('\n');
}
