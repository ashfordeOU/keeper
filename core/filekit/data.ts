// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Structured data between formats: JSON, YAML, TOML, XML, CSV and TSV, plus
// the small TOML and XML readers and writers they need. Spreadsheets (XLSX,
// ODS) and SQLite are handled by the service with their own libraries and
// meet these through `Table`.

export type Value = null | boolean | number | string | Value[] | { [k: string]: Value };

export interface Table { name?: string; columns: string[]; rows: (string | number | boolean | null)[][] }

// ---------------------------------------------------------------- CSV / TSV

/** RFC 4180 CSV (quotes, doubled quotes, line breaks inside quotes). */
export function parseCsv(text: string, sep?: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const d = sep ?? guessSeparator(s);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

export function guessSeparator(s: string): string {
  const head = s.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = [',', '\t', ';', '|'].map((d) => [d, head.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 1 ? counts[0][0] : ',';
}

export function writeCsv(rows: unknown[][], sep = ','): string {
  const cell = (v: unknown) => {
    const t = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return sep === '\t' ? t.replace(/[\t\r\n]+/g, ' ') : /["\n\r]/.test(t) || t.includes(sep) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return rows.map((r) => r.map(cell).join(sep)).join('\n') + '\n';
}

/** Numbers and true/false read back as such; everything else stays text. */
export function typed(v: string): string | number | boolean | null {
  if (v === '') return null;
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return Number(v);
  if (v === 'true' || v === 'TRUE') return true;
  if (v === 'false' || v === 'FALSE') return false;
  return v;
}

export function csvToTable(text: string, sep?: string): Table {
  const rows = parseCsv(text, sep);
  const columns = (rows.shift() ?? []).map((c, i) => c || `Column ${i + 1}`);
  return { columns, rows: rows.map((r) => columns.map((_, i) => typed(r[i] ?? ''))) };
}

export function tableToCsv(t: Table, sep = ','): string {
  return writeCsv([t.columns, ...t.rows], sep);
}

// ---------------------------------------------------------------- tables <-> values

/** Records (an array of objects) as a table; nested values are kept as JSON text. */
export function valueToTable(v: Value): Table {
  const list: Value[] = Array.isArray(v) ? v : v && typeof v === 'object' ? (findArray(v) ?? [v]) : [v];
  const columns: string[] = [];
  const flat = list.map((r) => flatten(r));
  for (const r of flat) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  return { columns, rows: flat.map((r) => columns.map((c) => (r[c] === undefined ? null : r[c]))) };
}

/** The first list of records inside an object (e.g. {"data": [...]}) */
function findArray(o: { [k: string]: Value }, depth = 0): Value[] | undefined {
  for (const v of Object.values(o)) if (Array.isArray(v) && v.some((x) => x && typeof x === 'object' && !Array.isArray(x))) return v;
  // One level down too, for wrappers like {"rows": {"row": [...]}} from XML.
  if (depth < 3) for (const v of Object.values(o)) if (v && typeof v === 'object' && !Array.isArray(v)) { const f = findArray(v, depth + 1); if (f) return f; }
  return undefined;
}

function flatten(v: Value, prefix = '', out: Record<string, string | number | boolean | null> = {}): Record<string, string | number | boolean | null> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length <= 20 && prefix.split('.').length < 3) flatten(x, key, out);
      else out[key] = x === null || typeof x !== 'object' ? (x as string | number | boolean | null) : JSON.stringify(x);
    }
  } else out[prefix || 'value'] = v === null || typeof v !== 'object' ? (v as string | number | boolean | null) : JSON.stringify(v);
  return out;
}

/** A table back to records; "a.b" columns become nested objects. */
export function tableToValue(t: Table): Value[] {
  return t.rows.map((r) => {
    const o: { [k: string]: Value } = {};
    t.columns.forEach((c, i) => {
      const parts = c.split('.');
      let at = o;
      for (const p of parts.slice(0, -1)) at = (at[p] && typeof at[p] === 'object' && !Array.isArray(at[p]) ? at[p] : (at[p] = {})) as { [k: string]: Value };
      at[parts[parts.length - 1]] = r[i] ?? null;
    });
    return o;
  });
}

// ---------------------------------------------------------------- TOML

/** TOML 1.0 for settings files: tables, arrays of tables, inline tables, strings, numbers, booleans, dates (as text), arrays. */
export function parseToml(src: string): { [k: string]: Value } {
  const root: { [k: string]: Value } = {};
  let cur = root;
  let i = 0;
  const s = src.replace(/\r\n/g, '\n');
  const err = (m: string) => { throw new Error(`TOML line ${s.slice(0, i).split('\n').length}: ${m}`); };
  const ws = () => { while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++; };
  const skip = () => {
    for (;;) {
      ws();
      if (s[i] === '#') while (i < s.length && s[i] !== '\n') i++;
      if (s[i] === '\n') { i++; continue; }
      break;
    }
  };
  const key = (): string[] => {
    const parts: string[] = [];
    for (;;) {
      ws();
      if (s[i] === '"' || s[i] === "'") parts.push(str() as string);
      else { const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i)); if (!m) err('expected a key'); parts.push(m![0]); i += m![0].length; }
      ws();
      if (s[i] === '.') { i++; continue; }
      return parts;
    }
  };
  const str = (): string => {
    const multi = s.startsWith('"""', i) || s.startsWith("'''", i);
    const q = s[i];
    if (multi) {
      const end = s.indexOf(q.repeat(3), i + 3);
      if (end < 0) err('unclosed string');
      let body = s.slice(i + 3, end).replace(/^\n/, '');
      i = end + 3;
      if (q === '"') body = unescape(body.replace(/\\\n\s*/g, ''));
      return body;
    }
    i++;
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\n') err('line break in string');
      if (q === '"' && s[i] === '\\') { out += s.slice(i, i + 2); i += 2; if (s[i - 1] === 'u') { out += s.slice(i, i + 4); i += 4; } else if (s[i - 1] === 'U') { out += s.slice(i, i + 8); i += 8; } continue; }
      out += s[i++];
    }
    i++;
    return q === '"' ? unescape(out) : out;
  };
  const unescape = (t: string) => t.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, e: string) => {
    if (e[0] === 'u' || e[0] === 'U') return String.fromCodePoint(parseInt(e.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\' } as Record<string, string>)[e] ?? e;
  });
  const value = (): Value => {
    ws();
    const c = s[i];
    if (c === '"' || c === "'") return str();
    if (c === '[') {
      i++;
      const arr: Value[] = [];
      for (;;) {
        skip();
        if (s[i] === ']') { i++; return arr; }
        arr.push(value());
        skip();
        if (s[i] === ',') { i++; continue; }
        skip();
        if (s[i] === ']') { i++; return arr; }
        err('expected , or ]');
      }
    }
    if (c === '{') {
      i++;
      const obj: { [k: string]: Value } = {};
      ws();
      if (s[i] === '}') { i++; return obj; }
      for (;;) {
        const k = key();
        ws();
        if (s[i] !== '=') err('expected =');
        i++;
        setPath(obj, k, value());
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return obj; }
        err('expected , or }');
      }
    }
    const m = /^[^\s,\]}#\n]+(?: \d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?/.exec(s.slice(i));
    if (!m) err('expected a value');
    i += m![0].length;
    const t = m![0];
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^[+-]?(inf|nan)$/.test(t)) return t.includes('nan') ? NaN : t.startsWith('-') ? -Infinity : Infinity;
    if (/^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}/.test(t)) return t;
    const n = t.replace(/_/g, '');
    if (/^[+-]?0x[0-9a-f]+$/i.test(n)) return parseInt(n, 16);
    if (/^[+-]?0o[0-7]+$/i.test(n)) return parseInt(n.replace(/0o/i, ''), 8);
    if (/^[+-]?0b[01]+$/i.test(n)) return parseInt(n.replace(/0b/i, ''), 2);
    if (!Number.isNaN(Number(n))) return Number(n);
    return err(`unknown value ${t}`) as never;
  };
  const setPath = (obj: { [k: string]: Value }, path: string[], v: Value) => {
    let at = obj;
    for (const p of path.slice(0, -1)) at = (at[p] ??= {}) as { [k: string]: Value };
    at[path[path.length - 1]] = v;
  };
  const table = (path: string[], arrayOf: boolean) => {
    let at: { [k: string]: Value } = root;
    path.forEach((p, n) => {
      const last = n === path.length - 1;
      if (last && arrayOf) {
        const list = (at[p] ??= []) as Value[];
        const o: { [k: string]: Value } = {};
        list.push(o);
        at = o;
      } else {
        let next = at[p];
        if (Array.isArray(next)) next = next[next.length - 1];
        if (next === undefined) next = at[p] = {};
        at = next as { [k: string]: Value };
      }
    });
    cur = at;
  };
  for (;;) {
    skip();
    if (i >= s.length) break;
    if (s[i] === '[') {
      const arr = s[i + 1] === '[';
      i += arr ? 2 : 1;
      const k = key();
      i += arr ? 2 : 1;
      table(k, arr);
      continue;
    }
    const k = key();
    ws();
    if (s[i] !== '=') err('expected =');
    i++;
    setPath(cur, k, value());
    ws();
    if (s[i] === '#') while (i < s.length && s[i] !== '\n') i++;
    if (i < s.length && s[i] !== '\n') err('expected a new line');
  }
  return root;
}

export function writeToml(v: Value): string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return `value = ${tomlValue(v)}\n`;
  const out: string[] = [];
  const keyOf = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
  const isTable = (x: Value) => !!x && typeof x === 'object' && !Array.isArray(x);
  const isTableArray = (x: Value) => Array.isArray(x) && x.length > 0 && x.every(isTable);
  const emit = (o: { [k: string]: Value }, path: string[]) => {
    for (const [k, x] of Object.entries(o)) if (!isTable(x) && !isTableArray(x) && x !== undefined) out.push(`${keyOf(k)} = ${tomlValue(x)}`);
    for (const [k, x] of Object.entries(o)) {
      if (isTable(x)) { out.push('', `[${[...path, k].map(keyOf).join('.')}]`); emit(x as { [k: string]: Value }, [...path, k]); }
      else if (isTableArray(x)) for (const item of x as { [k: string]: Value }[]) { out.push('', `[[${[...path, k].map(keyOf).join('.')}]]`); emit(item, [...path, k]); }
    }
  };
  emit(v, []);
  return out.join('\n').replace(/^\n+/, '') + '\n';
}

function tomlValue(v: Value): string {
  if (v === null) return '""';
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/.test(v) ? v : JSON.stringify(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
  return `{ ${Object.entries(v).map(([k, x]) => `${/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k)} = ${tomlValue(x)}`).join(', ')} }`;
}

// ---------------------------------------------------------------- XML

export interface XmlNode { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const xmlDecode = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
export const xmlEncode = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A forgiving XML reader: elements, attributes, text, CDATA; comments, doctype and instructions skipped. */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[3]) { while (stack.length > 1 && stack.pop()!.name !== m[3]) { /* close unclosed */ } }
    else if (m[4]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[5] ?? '').matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]] = xmlDecode(a[2] ?? a[3] ?? a[4] ?? '');
      const node: XmlNode = { name: m[4], attrs, children: [] };
      top.children.push(node);
      if (!m[6]) stack.push(node);
    } else if (m[7] !== undefined) {
      const t = xmlDecode(m[7]);
      if (t.trim()) top.children.push(t.trim());
    }
  }
  return root;
}

/**
 * XML as plain data: attributes become "@name", repeated elements become
 * lists, text-only elements become their text, mixed text goes in "#text".
 */
export function xmlToValue(node: XmlNode): Value {
  const kids = node.children.filter((c): c is XmlNode => typeof c !== 'string');
  const text = node.children.filter((c): c is string => typeof c === 'string').join(' ').trim();
  const attrs = Object.entries(node.attrs);
  if (!kids.length && !attrs.length) return text === '' ? null : typedXml(text);
  const o: { [k: string]: Value } = {};
  for (const [k, v] of attrs) o[`@${k}`] = typedXml(v);
  for (const k of kids) {
    const v = xmlToValue(k);
    if (k.name in o) { const cur = o[k.name]; o[k.name] = Array.isArray(cur) ? [...cur, v] : [cur, v]; }
    else o[k.name] = v;
  }
  if (text) o['#text'] = typedXml(text);
  return o;
}

function typedXml(t: string): Value {
  return /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(t) ? Number(t) : t === 'true' ? true : t === 'false' ? false : t;
}

export function xmlDocToValue(src: string): Value {
  const doc = parseXml(src);
  const top = doc.children.find((c): c is XmlNode => typeof c !== 'string');
  if (!top) return null;
  return { [top.name]: xmlToValue(top) };
}

export function valueToXml(v: Value, rootName = 'root'): string {
  const name = (k: string) => { const n = k.replace(/[^A-Za-z0-9_.-]/g, '_'); return /^[A-Za-z_]/.test(n) ? n : `_${n}`; };
  const el = (k: string, x: Value, pad: string): string => {
    if (Array.isArray(x)) return x.map((i) => el(k, i, pad)).join('');
    if (x === null) return `${pad}<${name(k)}/>\n`;
    if (typeof x !== 'object') return `${pad}<${name(k)}>${xmlEncode(String(x))}</${name(k)}>\n`;
    const attrs = Object.entries(x).filter(([a]) => a.startsWith('@')).map(([a, val]) => ` ${name(a.slice(1))}="${xmlEncode(String(val))}"`).join('');
    const kids = Object.entries(x).filter(([a]) => !a.startsWith('@') && a !== '#text');
    const text = x['#text'];
    if (!kids.length) return text === undefined ? `${pad}<${name(k)}${attrs}/>\n` : `${pad}<${name(k)}${attrs}>${xmlEncode(String(text))}</${name(k)}>\n`;
    return `${pad}<${name(k)}${attrs}>\n${text !== undefined ? `${pad}  ${xmlEncode(String(text))}\n` : ''}${kids.map(([a, val]) => el(a, val, `${pad}  `)).join('')}${pad}</${name(k)}>\n`;
  };
  const top = v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 ? Object.entries(v)[0] : [rootName, Array.isArray(v) ? { item: v } : v] as [string, Value];
  return `<?xml version="1.0" encoding="UTF-8"?>\n${el(top[0], top[1], '')}`;
}

// ---------------------------------------------------------------- tables as text

export function tableToMarkdown(t: Table): string {
  const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${t.columns.map(cell).join(' | ')} |`, `| ${t.columns.map(() => '---').join(' | ')} |`, ...t.rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n') + '\n';
}

export function tableToHtml(t: Table, title = 'Table'): string {
  const e = (v: unknown) => xmlEncode(String(v ?? ''));
  return `<!doctype html><meta charset="utf-8"><title>${e(title)}</title><style>body{font:14px system-ui,sans-serif;margin:24px}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f3f3f3}</style>
<table><thead><tr>${t.columns.map((c) => `<th>${e(c)}</th>`).join('')}</tr></thead><tbody>
${t.rows.map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join('')}</tr>`).join('\n')}
</tbody></table>`;
}

/** Markdown pipe tables back to a table (the first one found). */
export function markdownTable(md: string): Table | undefined {
  const lines = md.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/^\s*\|.*\|\s*$/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const split = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const columns = split(lines[i]);
      const rows: Table['rows'] = [];
      for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push(split(lines[j]).map(typed));
      return { columns, rows };
    }
  }
  return undefined;
}
