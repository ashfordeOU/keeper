// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The YAML that note properties (frontmatter) and .base files use: maps,
// lists (block and [flow]), quoted and plain scalars, numbers, booleans,
// null, and block strings (| and >). Not all of YAML — anchors, tags and
// multi-document streams are not needed for vault files. Values that are
// not understood are kept as text, so nothing is lost on a round trip.

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

interface Line { indent: number; text: string; n: number }

function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q && s[i - 1] !== '\\') q = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s:[{,-]/.test(s[i - 1])) q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}

function splitFlow(s: string): string[] {
  const out: string[] = [];
  let depth = 0, q: string | null = null, cur = '';
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function scalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try { return JSON.parse(s) as string; } catch { return s.slice(1, -1); }
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('[') && s.endsWith(']')) return splitFlow(s.slice(1, -1)).map(scalar);
  if (s.startsWith('{') && s.endsWith('}')) {
    const o: Record<string, YamlValue> = {};
    for (const part of splitFlow(s.slice(1, -1))) {
      const i = part.indexOf(':');
      if (i > 0) o[unquoteKey(part.slice(0, i))] = scalar(part.slice(i + 1));
    }
    return o;
  }
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) && !/^0\d/.test(s)) return Number(s);
  return s;
}

function unquoteKey(k: string): string {
  const t = k.trim();
  const v = scalar(t);
  return typeof v === 'string' ? v : t;
}

/** Finds the colon that ends a mapping key (not inside quotes, followed by space or end). */
function keyColon(s: string): number {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if ((c === '"' || c === "'") && i === 0) { q = c; continue; }
    if (c === ':' && (i + 1 === s.length || s[i + 1] === ' ' || s[i + 1] === '\t')) return i;
    if (c === '[' || c === '{') return -1;
  }
  return -1;
}

export function parseYaml(text: string): YamlValue {
  const lines: Line[] = [];
  text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, n) => {
    const indent = raw.length - raw.trimStart().length;
    lines.push({ indent, text: raw.trim() === '' ? '' : stripComment(raw.slice(indent)), n });
  });
  let i = 0;
  const skip = () => { while (i < lines.length && (lines[i].text === '' || lines[i].text === '---')) i++; };

  function block(indent: number, style: string): string {
    const parts: string[] = [];
    let base = -1;
    while (i < lines.length) {
      const l = lines[i];
      const raw = l.text === '' ? '' : l;
      if (raw !== '' && l.indent <= indent) break;
      if (raw !== '' && base < 0) base = l.indent;
      parts.push(raw === '' ? '' : ' '.repeat(Math.max(0, l.indent - base)) + l.text);
      i++;
    }
    while (parts.length && parts[parts.length - 1] === '') parts.pop();
    const keep = style.includes('+');
    const body = style.startsWith('>') ? parts.join('\n').replace(/([^\n])\n(?=[^\n ])/g, '$1 ') : parts.join('\n');
    return body + (style.includes('-') ? '' : '\n') + (keep ? '' : '');
  }

  function value(rest: string, indent: number): YamlValue {
    if (/^[|>][-+]?$/.test(rest)) return block(indent, rest);
    if (rest !== '') return scalar(rest);
    skip();
    if (i >= lines.length) return null;
    const next = lines[i];
    if (next.indent > indent || (next.indent === indent && next.text.startsWith('- '))) return node(next.indent);
    if (next.indent === indent && next.text === '-') return node(next.indent);
    return null;
  }

  function node(indent: number): YamlValue {
    skip();
    if (i >= lines.length) return null;
    const first = lines[i];
    if (first.text === '-' || first.text.startsWith('- ')) {
      const arr: YamlValue[] = [];
      while (i < lines.length) {
        skip();
        if (i >= lines.length) break;
        const l = lines[i];
        if (l.indent !== indent || !(l.text === '-' || l.text.startsWith('- '))) break;
        const rest = l.text === '-' ? '' : l.text.slice(2).trim();
        const c = keyColon(rest);
        if (rest && c > 0) {
          // A map inside a list item: "- key: value" with more keys indented below.
          const inner = indent + 2;
          lines[i] = { ...l, indent: inner, text: rest };
          arr.push(node(inner));
        } else {
          i++;
          arr.push(value(rest, indent));
        }
      }
      return arr;
    }
    const c = keyColon(first.text);
    if (c < 0) {
      i++;
      return scalar(first.text);
    }
    const obj: Record<string, YamlValue> = {};
    while (i < lines.length) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      if (l.indent !== indent) break;
      const k = keyColon(l.text);
      if (k < 0) break;
      const key = unquoteKey(l.text.slice(0, k));
      i++;
      obj[key] = value(l.text.slice(k + 1).trim(), indent);
    }
    return obj;
  }

  skip();
  if (i >= lines.length) return null;
  return node(lines[i].indent);
}

const PLAIN = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^:#]*$/;

function quote(s: string): string {
  if (s === '') return '""';
  if (PLAIN.test(s) && !/\s$/.test(s) && typeof scalar(s) === 'string' && !/: /.test(s)) return s;
  return JSON.stringify(s);
}

function emit(v: YamlValue, indent: number, out: string[], prefix: string) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) { out.push(`${prefix} []`); return; }
    out.push(prefix);
    const ip = ' '.repeat(indent + 2);
    for (const x of v) {
      if (x && typeof x === 'object' && !Array.isArray(x)) {
        const sub: string[] = [];
        emitMap(x, indent + 4, sub);
        sub[0] = `${ip}- ${sub[0].trimStart()}`;
        out.push(...sub);
      } else if (Array.isArray(x)) emit(x, indent + 2, out, `${ip}-`);
      else out.push(`${ip}- ${atom(x)}`);
    }
    return;
  }
  if (v && typeof v === 'object') {
    if (Object.keys(v).length === 0) { out.push(`${prefix} {}`); return; }
    out.push(prefix);
    emitMap(v, indent + 2, out);
    return;
  }
  if (typeof v === 'string' && v.includes('\n')) {
    out.push(`${prefix} |${v.endsWith('\n') ? '' : '-'}`);
    for (const l of v.replace(/\n$/, '').split('\n')) out.push(l ? `${pad}  ${l}` : '');
    return;
  }
  out.push(`${prefix} ${atom(v)}`);
}

function atom(v: YamlValue): string {
  if (v === null) return '';
  if (typeof v === 'string') return quote(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function emitMap(o: { [k: string]: YamlValue }, indent: number, out: string[]) {
  const pad = ' '.repeat(indent);
  for (const [k, v] of Object.entries(o)) {
    const key = PLAIN.test(k) && !/\s$/.test(k) ? k : JSON.stringify(k);
    if (v === null) out.push(`${pad}${key}:`);
    else emit(v, indent, out, `${pad}${key}:`);
  }
}

/** Writes properties the way the properties editor does: block lists, plain values when safe. */
export function stringifyYaml(v: { [k: string]: YamlValue }): string {
  const out: string[] = [];
  emitMap(v, 0, out);
  return out.join('\n') + (out.length ? '\n' : '');
}
