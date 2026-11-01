// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// .base files: database views of notes (table, cards, list) defined in YAML
// with filters (and / or / not of expressions), formulas, property display
// names, and per-view order, sort, group and limit. The expression language
// covers the common part: note properties, file.* fields and methods,
// comparisons, arithmetic, &&, ||, !, string and list methods, if(), now(),
// today(), date(), number(), link(), list() and duration strings ("1 week").

import { expandTag, normTag } from './parse';
import { baseOf, dirOf, extOf, titleOf, type IndexedNote, type VaultFile, type VaultIndex } from './vault';
import { parseYaml, stringifyYaml, type YamlValue } from './yaml';

export type FilterNode = string | { and?: FilterNode[]; or?: FilterNode[]; not?: FilterNode[] };

export interface BaseView {
  type: 'table' | 'cards' | 'list' | string;
  name: string;
  limit?: number;
  filters?: FilterNode;
  order?: string[];
  sort?: { property: string; direction: 'ASC' | 'DESC' }[];
  groupBy?: { property: string; direction?: 'ASC' | 'DESC' };
  [k: string]: unknown;
}

export interface BaseDef {
  filters?: FilterNode;
  formulas?: Record<string, string>;
  properties?: Record<string, { displayName?: string; [k: string]: unknown }>;
  views: BaseView[];
  [k: string]: unknown;
}

export function parseBase(text: string): BaseDef {
  const v = text.trim() ? parseYaml(text) : {};
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, YamlValue>;
  const views = Array.isArray(o.views) ? (o.views as unknown as BaseView[]) : [];
  return { ...(o as object), views: views.length ? views : [{ type: 'table', name: 'Table' }] } as BaseDef;
}

export function serializeBase(b: BaseDef): string {
  return stringifyYaml(b as unknown as Record<string, YamlValue>);
}

// ---------------------------------------------------------------- expressions

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };

function lex(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c) || (c === '.' && /\d/.test(s[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(e[-+]?\d+)?/i.exec(s.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, v = '';
      while (j < s.length && s[j] !== c) {
        if (s[j] === '\\' && j + 1 < s.length) { v += s[j + 1]; j += 2; continue; }
        v += s[j++];
      }
      out.push({ t: 'str', v });
      i = j + 1;
      continue;
    }
    if (/[\p{L}_$]/u.test(c)) {
      const m = /^[\p{L}\p{N}_$-]*/u.exec(s.slice(i))!;
      // a trailing "-" belongs to subtraction
      let id = m[0];
      while (id.endsWith('-')) id = id.slice(0, -1);
      out.push({ t: 'id', v: id });
      i += id.length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/%<>!().,[]'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected “${c}” in ${s}`);
  }
  return out;
}

type Ast =
  | { k: 'lit'; v: unknown }
  | { k: 'id'; name: string }
  | { k: 'member'; obj: Ast; name: string }
  | { k: 'index'; obj: Ast; idx: Ast }
  | { k: 'call'; fn: Ast; args: Ast[] }
  | { k: 'un'; op: string; a: Ast }
  | { k: 'bin'; op: string; a: Ast; b: Ast }
  | { k: 'list'; items: Ast[] };

const PREC: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

const cache = new Map<string, Ast>();

export function parseExpr(src: string): Ast {
  const hit = cache.get(src);
  if (hit) return hit;
  const toks = lex(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`Expected “${v}” in ${src}`); i++; };
  function primary(): Ast {
    const t = toks[i++];
    if (!t) throw new Error(`Unfinished expression: ${src}`);
    let node: Ast;
    if (t.t === 'num' || t.t === 'str') node = { k: 'lit', v: t.v };
    else if (t.t === 'id') node = t.v === 'true' ? { k: 'lit', v: true } : t.v === 'false' ? { k: 'lit', v: false } : t.v === 'null' ? { k: 'lit', v: null } : { k: 'id', name: t.v };
    else if (t.v === '(') { node = expr(0); expect(')'); }
    else if (t.v === '[') {
      const items: Ast[] = [];
      while (!isOp(']')) { items.push(expr(0)); if (isOp(',')) i++; else break; }
      expect(']');
      node = { k: 'list', items };
    } else if (t.v === '!' || t.v === '-') node = { k: 'un', op: t.v, a: unaryOperand() };
    else throw new Error(`Unexpected “${t.v}” in ${src}`);
    return postfix(node);
  }
  function unaryOperand(): Ast { return primary(); }
  function postfix(node: Ast): Ast {
    for (;;) {
      if (isOp('.')) { i++; const id = toks[i++]; if (!id || id.t !== 'id') throw new Error(`Expected a name after “.” in ${src}`); node = { k: 'member', obj: node, name: id.v }; continue; }
      if (isOp('(')) {
        i++;
        const args: Ast[] = [];
        while (!isOp(')')) { args.push(expr(0)); if (isOp(',')) i++; else break; }
        expect(')');
        node = { k: 'call', fn: node, args };
        continue;
      }
      if (isOp('[')) { i++; const idx = expr(0); expect(']'); node = { k: 'index', obj: node, idx }; continue; }
      return node;
    }
  }
  function expr(min: number): Ast {
    let a = primary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < min) return a;
      i++;
      const b = expr(PREC[t.v] + 1);
      a = { k: 'bin', op: t.v, a, b };
    }
  }
  const ast = expr(0);
  if (i < toks.length) throw new Error(`Unexpected “${(toks[i] as { v: unknown }).v}” in ${src}`);
  cache.set(src, ast);
  return ast;
}

export interface Row {
  file: VaultFile;
  note?: IndexedNote;
  formulas: Record<string, unknown>;
}

interface Env {
  row: Row;
  vault: VaultIndex;
  def: BaseDef;
  /** the note embedding the base ("this") */
  thisFile?: string;
  now: Date;
  computing?: Set<string>;
}

class Link { constructor(public path: string, public display?: string) {} toString() { return this.display ?? titleOf(this.path); } }

const DUR = /^\s*(-?\d+(?:\.\d+)?)\s*(y|years?|M|months?|w|weeks?|d|days?|h|hours?|m|minutes?|s|seconds?)\s*$/;

function duration(s: string): { n: number; unit: string } | null {
  const m = DUR.exec(s);
  if (!m) return null;
  const u = m[2];
  const unit = u === 'M' || u.startsWith('month') ? 'M' : u === 'm' || u.startsWith('minute') ? 'm' : u[0];
  return { n: Number(m[1]), unit };
}

function addDuration(d: Date, dur: { n: number; unit: string }, sign: number): Date {
  const r = new Date(d);
  const n = dur.n * sign;
  if (dur.unit === 'y') r.setFullYear(r.getFullYear() + n);
  else if (dur.unit === 'M') r.setMonth(r.getMonth() + n);
  else r.setTime(r.getTime() + n * ({ w: 604_800_000, d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 } as Record<string, number>)[dur.unit]);
  return r;
}

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

function cmp(a: unknown, b: unknown): number {
  const da = toDate(a), db = toDate(b);
  if (da && db && (a instanceof Date || b instanceof Date || (typeof a === 'string' && typeof b === 'string'))) return da.getTime() - db.getTime();
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && !Number.isNaN(Number(b))) return a - Number(b);
  if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '' && !Number.isNaN(Number(a))) return Number(a) - b;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Link || b instanceof Link) return String(a instanceof Link ? a.path : a).replace(/\.md$/, '').toLowerCase() === String(b instanceof Link ? b.path : b).replace(/\.md$/, '').toLowerCase() || String(a) === String(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  if (a == null || b == null) return (a ?? null) === (b ?? null) || (a === '' && b == null) || (b === '' && a == null);
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  if (a instanceof Date || b instanceof Date) { const da = toDate(a), db = toDate(b); return !!da && !!db && da.getTime() === db.getTime(); }
  return String(a) === String(b);
}

/** Unwraps "[[Note]]" property values to links. */
function propValue(v: unknown): unknown {
  if (typeof v === 'string') {
    const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(v.trim());
    if (m) return new Link(m[1], m[2]);
  }
  if (Array.isArray(v)) return v.map(propValue);
  return v;
}

function fileObject(env: Env, path: string) {
  const f = env.vault.get(path);
  return { __file: true, path, f };
}

function fileField(env: Env, path: string, name: string): unknown {
  const f = env.vault.get(path);
  const n = env.vault.note(path);
  switch (name) {
    case 'name': return baseOf(path);
    case 'basename': return titleOf(path);
    case 'path': return path;
    case 'folder': return dirOf(path);
    case 'ext': return extOf(path);
    case 'size': return f?.size ?? 0;
    case 'ctime': return f ? new Date(f.ctime) : null;
    case 'mtime': return f ? new Date(f.mtime) : null;
    case 'tags': return [...new Set(n?.note.tags.map((t) => `#${t.tag}`) ?? [])];
    case 'links': return n ? n.note.links.filter((l) => !l.embed && l.target).map((l) => new Link(env.vault.resolve(l.target, path) ?? l.target)) : [];
    case 'embeds': return n ? n.note.links.filter((l) => l.embed).map((l) => new Link(env.vault.resolve(l.target, path) ?? l.target)) : [];
    case 'backlinks': return env.vault.backlinks(path).map((b) => new Link(b.source));
    case 'properties': return n?.note.props ?? {};
    case 'file': return fileObject(env, path);
  }
  return undefined;
}

function fileMethod(env: Env, path: string, name: string, args: unknown[]): unknown {
  const n = env.vault.note(path);
  switch (name) {
    case 'hasTag': {
      const have = new Set((n?.note.tags ?? []).flatMap((t) => expandTag(t.tag)));
      return args.some((a) => have.has(normTag(String(a))));
    }
    case 'inFolder': {
      const f = String(args[0] ?? '').replace(/^\/+|\/+$/g, '');
      return !f || path.startsWith(`${f}/`);
    }
    case 'hasLink': {
      const t = args[0] instanceof Link ? args[0].path : (args[0] as { path?: string })?.path ?? String(args[0] ?? '');
      const target = env.vault.resolve(t, path) ?? t;
      return (n?.note.links ?? []).some((l) => env.vault.resolve(l.target, path) === target);
    }
    case 'hasProperty': return !!n && String(args[0]) in n.note.props;
    case 'asLink': return new Link(path, args[0] != null ? String(args[0]) : undefined);
    case 'linksTo': return fileMethod(env, path, 'hasLink', args);
  }
  throw new Error(`file.${name}() is not supported`);
}

function method(env: Env, obj: unknown, name: string, args: unknown[]): unknown {
  if (obj && typeof obj === 'object' && (obj as { __file?: boolean }).__file) return fileMethod(env, (obj as { path: string }).path, name, args);
  if (obj instanceof Link) {
    if (name === 'asFile') return fileObject(env, env.vault.resolve(obj.path, env.row.file.path) ?? obj.path);
    if (name === 'linksTo') return eq(obj, args[0]);
    obj = obj.toString();
  }
  if (obj instanceof Date) {
    if (name === 'format') return formatSimple(obj, String(args[0] ?? 'YYYY-MM-DD'));
    if (name === 'date') return new Date(obj.getFullYear(), obj.getMonth(), obj.getDate());
    if (name === 'relative') return relative(obj, env.now);
    if (name === 'isEmpty') return false;
  }
  if (Array.isArray(obj)) {
    switch (name) {
      case 'contains': return obj.some((x) => eq(x, args[0]) || (typeof x === 'string' && typeof args[0] === 'string' && x.replace(/^#/, '').toLowerCase() === args[0].replace(/^#/, '').toLowerCase()));
      case 'containsAll': return args.every((a) => obj.some((x) => eq(x, a)));
      case 'containsAny': return args.some((a) => obj.some((x) => eq(x, a)));
      case 'isEmpty': return obj.length === 0;
      case 'join': return obj.map(String).join(args[0] != null ? String(args[0]) : ', ');
      case 'unique': return [...new Set(obj)];
      case 'reverse': return [...obj].reverse();
      case 'sort': return [...obj].sort(cmp);
      case 'flat': return obj.flat();
      case 'slice': return obj.slice(Number(args[0] ?? 0), args[1] != null ? Number(args[1]) : undefined);
    }
  }
  if (typeof obj === 'string') {
    switch (name) {
      case 'contains': return obj.toLowerCase().includes(String(args[0] ?? '').toLowerCase());
      case 'containsAll': return args.every((a) => obj.toLowerCase().includes(String(a).toLowerCase()));
      case 'containsAny': return args.some((a) => obj.toLowerCase().includes(String(a).toLowerCase()));
      case 'startsWith': return obj.toLowerCase().startsWith(String(args[0] ?? '').toLowerCase());
      case 'endsWith': return obj.toLowerCase().endsWith(String(args[0] ?? '').toLowerCase());
      case 'lower': return obj.toLowerCase();
      case 'upper': return obj.toUpperCase();
      case 'title': return obj.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
      case 'trim': return obj.trim();
      case 'isEmpty': return obj.trim() === '';
      case 'replace': return obj.split(String(args[0])).join(String(args[1] ?? ''));
      case 'split': return obj.split(String(args[0] ?? ','));
      case 'slice': return obj.slice(Number(args[0] ?? 0), args[1] != null ? Number(args[1]) : undefined);
      case 'reverse': return [...obj].reverse().join('');
    }
  }
  if (typeof obj === 'number') {
    switch (name) {
      case 'round': { const p = 10 ** Number(args[0] ?? 0); return Math.round(obj * p) / p; }
      case 'floor': return Math.floor(obj);
      case 'ceil': return Math.ceil(obj);
      case 'abs': return Math.abs(obj);
      case 'toFixed': return obj.toFixed(Number(args[0] ?? 0));
      case 'isEmpty': return false;
    }
  }
  if (obj == null && name === 'isEmpty') return true;
  if (obj == null) return null;
  if (name === 'isTruthy') return truthy(obj);
  if (name === 'toString') return String(obj);
  if (name === 'isType') return typeName(obj) === String(args[0]).toLowerCase();
  throw new Error(`${name}() is not supported here`);
}

function typeName(v: unknown): string {
  if (v == null) return 'null';
  if (Array.isArray(v)) return 'list';
  if (v instanceof Date) return 'date';
  if (v instanceof Link) return 'link';
  return typeof v;
}

function relative(d: Date, now: Date): string {
  const s = Math.round((d.getTime() - now.getTime()) / 1000);
  const a = Math.abs(s);
  const [n, u] = a < 60 ? [a, 'second'] : a < 3600 ? [Math.round(a / 60), 'minute'] : a < 86400 ? [Math.round(a / 3600), 'hour'] : a < 86400 * 30 ? [Math.round(a / 86400), 'day'] : a < 86400 * 365 ? [Math.round(a / (86400 * 30)), 'month'] : [Math.round(a / (86400 * 365)), 'year'];
  const w = `${n} ${u}${n === 1 ? '' : 's'}`;
  return s < 0 ? `${w} ago` : `in ${w}`;
}

function formatSimple(d: Date, f: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return f.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => ({ YYYY: String(d.getFullYear()), MM: p(d.getMonth() + 1), DD: p(d.getDate()), HH: p(d.getHours()), mm: p(d.getMinutes()), ss: p(d.getSeconds()) }[t]!));
}

function lookup(env: Env, name: string): unknown {
  const n = env.row.note;
  if (name === 'file') return fileObject(env, env.row.file.path);
  if (name === 'note') return { __note: true };
  if (name === 'formula') return { __formula: true };
  if (name === 'this') return env.thisFile ? fileObject(env, env.thisFile) : null;
  const props = n?.note.props ?? {};
  const key = name in props ? name : Object.keys(props).find((k) => k.toLowerCase() === name.toLowerCase());
  return key != null ? propValue(props[key]) : null;
}

function formula(env: Env, name: string): unknown {
  if (name in env.row.formulas) return env.row.formulas[name];
  const src = env.def.formulas?.[name];
  if (src == null) return null;
  const busy = env.computing ?? new Set<string>();
  if (busy.has(name)) throw new Error(`Formula ${name} refers to itself`);
  busy.add(name);
  const v = evaluate(parseExpr(String(src)), { ...env, computing: busy });
  busy.delete(name);
  env.row.formulas[name] = v;
  return v;
}

const FUNCS: Record<string, (env: Env, args: unknown[]) => unknown> = {
  now: (env) => env.now,
  today: (env) => new Date(env.now.getFullYear(), env.now.getMonth(), env.now.getDate()),
  date: (_e, a) => toDate(a[0]),
  number: (_e, a) => (typeof a[0] === 'boolean' ? Number(a[0]) : a[0] instanceof Date ? a[0].getTime() : Number(a[0])),
  link: (_e, a) => new Link(String(a[0] instanceof Link ? a[0].path : a[0]), a[1] != null ? String(a[1]) : undefined),
  list: (_e, a) => (Array.isArray(a[0]) ? a[0] : a[0] == null ? [] : [a[0]]),
  if: (_e, a) => (truthy(a[0]) ? a[1] : a[2] ?? null),
  min: (_e, a) => Math.min(...a.map(Number)),
  max: (_e, a) => Math.max(...a.map(Number)),
  duration: (_e, a) => String(a[0]),
};

export function evaluate(ast: Ast, env: Env): unknown {
  switch (ast.k) {
    case 'lit': return ast.v;
    case 'list': return ast.items.map((x) => evaluate(x, env));
    case 'id': return lookup(env, ast.name);
    case 'member': {
      if (ast.obj.k === 'id' && ast.obj.name === 'note') return lookup(env, ast.name);
      if (ast.obj.k === 'id' && ast.obj.name === 'formula') return formula(env, ast.name);
      const o = evaluate(ast.obj, env);
      if (o && typeof o === 'object' && (o as { __file?: boolean }).__file) return fileField(env, (o as { path: string }).path, ast.name);
      if (ast.name === 'length' && (typeof o === 'string' || Array.isArray(o))) return o.length;
      if (o instanceof Date) {
        const m: Record<string, number> = { year: o.getFullYear(), month: o.getMonth() + 1, day: o.getDate(), hour: o.getHours(), minute: o.getMinutes(), second: o.getSeconds() };
        if (ast.name in m) return m[ast.name];
      }
      if (o && typeof o === 'object' && !Array.isArray(o) && !(o instanceof Link)) return propValue((o as Record<string, unknown>)[ast.name]) ?? null;
      return null;
    }
    case 'index': {
      const o = evaluate(ast.obj, env), i = evaluate(ast.idx, env);
      if (ast.obj.k === 'id' && ast.obj.name === 'note') return lookup(env, String(i));
      if (Array.isArray(o)) return o[Number(i) < 0 ? o.length + Number(i) : Number(i)] ?? null;
      if (o && typeof o === 'object') return (o as Record<string, unknown>)[String(i)] ?? null;
      return null;
    }
    case 'call': {
      const args = ast.args.map((a) => evaluate(a, env));
      if (ast.fn.k === 'id') {
        const f = FUNCS[ast.fn.name];
        if (!f) throw new Error(`${ast.fn.name}() is not supported`);
        return f(env, args);
      }
      if (ast.fn.k === 'member') return method(env, evaluate(ast.fn.obj, env), ast.fn.name, args);
      throw new Error('This cannot be called');
    }
    case 'un': {
      const v = evaluate(ast.a, env);
      return ast.op === '!' ? !truthy(v) : -Number(v);
    }
    case 'bin': {
      if (ast.op === '&&') return truthy(evaluate(ast.a, env)) && truthy(evaluate(ast.b, env));
      if (ast.op === '||') { const a = evaluate(ast.a, env); return truthy(a) ? a : evaluate(ast.b, env); }
      const a = evaluate(ast.a, env), b = evaluate(ast.b, env);
      switch (ast.op) {
        case '==': return eq(a, b);
        case '!=': return !eq(a, b);
        case '>': return a != null && b != null && cmp(a, b) > 0;
        case '<': return a != null && b != null && cmp(a, b) < 0;
        case '>=': return a != null && b != null && cmp(a, b) >= 0;
        case '<=': return a != null && b != null && cmp(a, b) <= 0;
        case '+': case '-': {
          const da = toDate(a) ?? (a instanceof Date ? a : null);
          const dur = typeof b === 'string' ? duration(b) : null;
          if (da && dur && (a instanceof Date || typeof a === 'string')) return addDuration(da, dur, ast.op === '+' ? 1 : -1);
          if (ast.op === '-' && a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
          if (ast.op === '+' && (typeof a === 'string' || typeof b === 'string')) return `${a ?? ''}${b ?? ''}`;
          return ast.op === '+' ? Number(a) + Number(b) : Number(a) - Number(b);
        }
        case '*': return Number(a) * Number(b);
        case '/': return Number(a) / Number(b);
        case '%': return Number(a) % Number(b);
      }
    }
  }
  return null;
}

function test(f: FilterNode | undefined, env: Env): boolean {
  if (f == null) return true;
  if (typeof f === 'string') return truthy(evaluate(parseExpr(f), env));
  if (typeof f !== 'object') return !!f;
  if (f.and && !f.and.every((x) => test(x, env))) return false;
  if (f.or && !f.or.some((x) => test(x, env))) return false;
  if (f.not && f.not.some((x) => test(x, env))) return false;
  return true;
}

export interface BaseResult {
  view: BaseView;
  columns: { id: string; label: string }[];
  rows: { path: string; cells: Record<string, unknown> }[];
  groups?: { key: string; rows: number[] }[];
  errors: string[];
  total: number;
}

/** A column value shown as text. */
export function display(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Link) return v.toString();
  if (v instanceof Date) return v.getHours() || v.getMinutes() ? formatSimple(v, 'YYYY-MM-DD HH:mm') : formatSimple(v, 'YYYY-MM-DD');
  if (Array.isArray(v)) return v.map(display).join(', ');
  if (typeof v === 'object') return (v as { path?: string }).path ?? JSON.stringify(v);
  return String(v);
}

export function propLabel(def: BaseDef, id: string): string {
  const name = def.properties?.[id]?.displayName;
  if (name) return name;
  if (id === 'file.name') return 'File name';
  if (id.startsWith('note.')) return id.slice(5);
  if (id.startsWith('formula.')) return id.slice(8);
  if (id.startsWith('file.')) return id.slice(5);
  return id;
}

function cell(env: Env, id: string): unknown {
  const src = id.startsWith('formula.') || id.startsWith('file.') || id.startsWith('note.') ? id : `note[${JSON.stringify(id)}]`;
  return evaluate(parseExpr(src), env);
}

/** Runs one view of a base over the vault (all files; filters decide what shows). */
export function runBase(def: BaseDef, vault: VaultIndex, viewIndex = 0, opts: { thisFile?: string; now?: Date } = {}): BaseResult {
  const view = def.views[viewIndex] ?? def.views[0] ?? { type: 'table', name: 'Table' };
  const now = opts.now ?? new Date();
  const errors: string[] = [];
  const order = view.order?.length ? view.order : ['file.name'];
  const rows: { path: string; cells: Record<string, unknown>; env: Env }[] = [];
  for (const file of vault.allFiles()) {
    const env: Env = { row: { file, note: vault.note(file.path), formulas: {} }, vault, def, thisFile: opts.thisFile, now };
    try {
      if (!test(def.filters, env) || !test(view.filters, env)) continue;
    } catch (e) {
      if (!errors.includes((e as Error).message)) errors.push((e as Error).message);
      continue;
    }
    const cells: Record<string, unknown> = {};
    for (const id of order) {
      try { cells[id] = cell(env, id); } catch (e) { cells[id] = `⚠ ${(e as Error).message}`; }
    }
    rows.push({ path: file.path, cells, env });
  }
  const sorts = view.sort ?? [];
  const groupProp = view.groupBy?.property;
  rows.sort((a, b) => {
    if (groupProp) {
      const c = cmp(display(cell(a.env, groupProp)), display(cell(b.env, groupProp))) * (view.groupBy?.direction === 'DESC' ? -1 : 1);
      if (c) return c;
    }
    for (const s of sorts) {
      let va: unknown, vb: unknown;
      try { va = cell(a.env, s.property); vb = cell(b.env, s.property); } catch { continue; }
      const c = cmp(va, vb);
      if (c) return s.direction === 'DESC' ? -c : c;
    }
    return sorts.length ? 0 : a.path.localeCompare(b.path);
  });
  const total = rows.length;
  const limited = view.limit ? rows.slice(0, view.limit) : rows;
  let groups: BaseResult['groups'];
  if (groupProp) {
    const g = new Map<string, number[]>();
    limited.forEach((r, i) => {
      const k = display(cell(r.env, groupProp));
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(i);
    });
    groups = [...g].map(([key, idx]) => ({ key, rows: idx }));
  }
  return {
    view,
    columns: order.map((id) => ({ id, label: propLabel(def, id) })),
    rows: limited.map((r) => ({ path: r.path, cells: r.cells })),
    groups,
    errors,
    total,
  };
}

export { Link as BaseLink };
