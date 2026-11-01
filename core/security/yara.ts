// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A pure-JavaScript matcher for the commonly used part of the YARA rule
// language, so open rule sets work without installing the yara program.
//
// Supported:  text strings ("…" with nocase, wide, ascii, fullword), hex strings
//   ({ 4D 5A ?? 90 [2-4] (6A | 6B) }), regular expressions (/…/is), and conditions
//   with and/or/not/(), any/all/N of them, any/all/N of ($a*), $a, #a > N,
//   $a at N, filesize with KB/MB, uint8/16/32(be)(offset) == value, true/false.
// Not supported (a rule using them is skipped with a reason): modules (pe., elf.,
//   math.), for-loops, external variables, xor/base64 modifiers.

export interface YaraString {
  id: string;
  re: RegExp;
}

export interface YaraRule {
  name: string;
  tags: string[];
  meta: Record<string, string>;
  strings: YaraString[];
  condition: string;
}

export interface YaraMatch {
  rule: string;
  tags: string[];
  meta: Record<string, string>;
  strings: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function unescapeText(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|n|t|r|"|\\)/g, (_, e: string) => (e[0] === 'x' ? String.fromCharCode(parseInt(e.slice(1), 16)) : e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e));
}

function textRe(text: string, mods: string[]): RegExp {
  const raw = unescapeText(text);
  const plain = [...raw].map((c) => escapeRe(c));
  const alts: string[] = [];
  const ascii = mods.includes('ascii') || !mods.includes('wide');
  if (ascii) alts.push(plain.join(''));
  if (mods.includes('wide')) alts.push(plain.map((c) => `${c}\\x00`).join(''));
  let body = alts.length > 1 ? `(?:${alts.join('|')})` : alts[0];
  if (mods.includes('fullword')) body = `(?<![A-Za-z0-9_])${body}(?![A-Za-z0-9_])`;
  return new RegExp(body, mods.includes('nocase') ? 'gi' : 'g');
}

function hexRe(hex: string): RegExp {
  const toks = hex.replace(/\/\/.*$/gm, '').match(/\[\s*\d*\s*-?\s*\d*\s*\]|\(|\)|\||[0-9A-Fa-f?]{2}/g) ?? [];
  let re = '';
  for (const t of toks) {
    if (t === '(' || t === ')' || t === '|') re += t === '(' ? '(?:' : t;
    else if (t.startsWith('[')) {
      const m = t.match(/\[\s*(\d*)\s*(-?)\s*(\d*)\s*\]/)!;
      const lo = m[1] || '0';
      re += m[2] ? `[\\s\\S]{${lo},${m[3]}}` : `[\\s\\S]{${lo}}`;
    } else if (t === '??') re += '[\\s\\S]';
    else if (t[0] === '?') re += `[${[...Array(16)].map((_, i) => `\\x${i.toString(16)}${t[1]}`).join('')}]`;
    else if (t[1] === '?') re += `[\\x${t[0]}0-\\x${t[0]}f]`;
    else re += `\\x${t}`;
  }
  return new RegExp(re, 'g');
}

/** Parses rule text into rules; rules using unsupported features come back in `skipped`. */
export function parseYara(src: string): { rules: YaraRule[]; skipped: { name: string; reason: string }[] } {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*import\s+"[^"]+"\s*$/gm, '');
  const rules: YaraRule[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const ruleRe = /(?:private\s+|global\s+)*rule\s+(\w+)\s*(?::\s*([\w\s]+?))?\s*\{([\s\S]*?)\n?\s*condition\s*:\s*([\s\S]*?)\}\s*(?=(?:(?:private\s+|global\s+)*rule\s|$))/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(text))) {
    const [, name, tagText, body, cond] = m;
    try {
      const meta: Record<string, string> = {};
      const metaPart = body.match(/meta\s*:([\s\S]*?)(?=strings\s*:|$)/)?.[1] ?? '';
      for (const mm of metaPart.matchAll(/(\w+)\s*=\s*("([^"]*)"|\S+)/g)) meta[mm[1]] = mm[3] ?? mm[2];
      const strings: YaraString[] = [];
      const strPart = body.match(/strings\s*:([\s\S]*)$/)?.[1] ?? '';
      const sre = /(\$\w*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"((?:\s+(?:nocase|wide|ascii|fullword|private|xor|base64|base64wide))*)|\{([^}]*)\}|\/((?:[^/\\\n]|\\.)*)\/([is]*))/g;
      let sm: RegExpExecArray | null;
      let anon = 0;
      while ((sm = sre.exec(strPart))) {
        const id = sm[1] === '$' ? `$_anon${anon++}` : sm[1];
        if (sm[2] !== undefined) {
          const mods = (sm[3] ?? '').trim().split(/\s+/).filter(Boolean);
          if (mods.some((x) => /xor|base64/.test(x))) throw new Error(`modifier ${mods.find((x) => /xor|base64/.test(x))} not supported`);
          strings.push({ id, re: textRe(sm[2], mods) });
        } else if (sm[4] !== undefined) strings.push({ id, re: hexRe(sm[4]) });
        else strings.push({ id, re: new RegExp(sm[5], `g${sm[6].includes('i') ? 'i' : ''}${sm[6].includes('s') ? 's' : ''}`) });
      }
      if (/\b(pe|elf|math|hash|cuckoo|magic|dotnet|time)\.|\bfor\s+(any|all|\d+)\b/.test(cond)) throw new Error('uses a module or a for-loop');
      rules.push({ name, tags: (tagText ?? '').trim().split(/\s+/).filter(Boolean), meta, strings, condition: cond.trim() });
    } catch (e) {
      skipped.push({ name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { rules, skipped };
}

// ---------------------------------------------------------------- evaluation

type Tok = { t: 'num' | 'id' | 'str' | 'op' | 'kw'; v: string };

function tokenize(cond: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(0x[0-9a-fA-F]+|\d+(?:KB|MB)?|[$#@!][\w*]*|\w+|==|!=|<=|>=|[<>()=,*\\])/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cond))) {
    const v = m[1];
    if (/^(0x|\d)/.test(v)) out.push({ t: 'num', v });
    else if (/^[$#@!]/.test(v)) out.push({ t: 'str', v });
    else if (/^(and|or|not|of|them|any|all|at|in|filesize|true|false|uint8|uint16|uint32|uint16be|uint32be|none)$/.test(v)) out.push({ t: 'kw', v });
    else if (/^\w+$/.test(v)) out.push({ t: 'id', v });
    else out.push({ t: 'op', v });
  }
  return out;
}

function num(v: string): number {
  if (v.startsWith('0x')) return parseInt(v, 16);
  if (v.endsWith('KB')) return parseInt(v) * 1024;
  if (v.endsWith('MB')) return parseInt(v) * 1024 * 1024;
  return Number(v);
}

interface Ctx {
  data: Buffer;
  hits: Map<string, number[]>;
  ruleHits: Map<string, boolean>;
}

function evalCondition(rule: YaraRule, cond: string, ctx: Ctx): boolean {
  const toks = tokenize(cond);
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const ids = (pattern?: string) => {
    const all = rule.strings.map((s) => s.id);
    if (!pattern || pattern === 'them') return all;
    const pats = pattern.split(',').map((p) => p.trim());
    return all.filter((id) => pats.some((p) => (p.endsWith('*') ? id.startsWith(p.slice(0, -1)) : id === p)));
  };
  const count = (id: string) => ctx.hits.get(id)?.length ?? 0;

  function value(): number {
    const t = take();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') return num(t.v);
    if (t.t === 'kw' && t.v === 'filesize') return ctx.data.length;
    if (t.t === 'kw' && /^uint/.test(t.v)) {
      take(); // (
      const off = value();
      take(); // )
      const d = ctx.data;
      if (off < 0 || off >= d.length) return -1;
      const be = t.v.endsWith('be');
      const size = t.v.startsWith('uint8') ? 1 : t.v.startsWith('uint16') ? 2 : 4;
      if (off + size > d.length) return -1;
      return size === 1 ? d.readUInt8(off) : size === 2 ? (be ? d.readUInt16BE(off) : d.readUInt16LE(off)) : be ? d.readUInt32BE(off) : d.readUInt32LE(off);
    }
    if (t.t === 'str' && t.v.startsWith('#')) return count(`$${t.v.slice(1)}`);
    if (t.t === 'str' && t.v.startsWith('@')) return ctx.hits.get(`$${t.v.slice(1)}`)?.[0] ?? -1;
    if (t.t === 'op' && t.v === '(') {
      const v = value();
      take();
      return v;
    }
    throw new Error(`unexpected ${t.v}`);
  }

  function primary(): boolean {
    const t = peek();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'kw' && t.v === 'not') {
      take();
      return !primary();
    }
    if (t.t === 'op' && t.v === '(') {
      take();
      const v = orExpr();
      take();
      return v;
    }
    if (t.t === 'kw' && (t.v === 'true' || t.v === 'false')) {
      take();
      return t.v === 'true';
    }
    if ((t.t === 'kw' && (t.v === 'any' || t.v === 'all' || t.v === 'none')) || (t.t === 'num' && toks[i + 1]?.v === 'of')) {
      take();
      take(); // of
      let set: string[];
      if (peek()?.v === 'them') {
        take();
        set = ids('them');
      } else {
        take(); // (
        const parts: string[] = [];
        while (peek() && peek().v !== ')') {
          const x = take();
          if (x.v !== ',') parts.push(x.v);
        }
        take();
        set = ids(parts.join(','));
      }
      const n = set.filter((id) => count(id) > 0).length;
      return t.v === 'any' ? n > 0 : t.v === 'all' ? n === set.length && set.length > 0 : t.v === 'none' ? n === 0 : n >= num(t.v);
    }
    if (t.t === 'str' && t.v.startsWith('$') && !['==', '!=', '<', '>', '<=', '>='].includes(toks[i + 1]?.v)) {
      take();
      if (peek()?.v === 'at') {
        take();
        const at = value();
        return (ctx.hits.get(t.v) ?? []).includes(at);
      }
      return count(t.v) > 0;
    }
    if (t.t === 'id' && ctx.ruleHits.has(t.v)) {
      take();
      return ctx.ruleHits.get(t.v)!;
    }
    const a = value();
    const op = take();
    const b = value();
    switch (op?.v) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
      default: throw new Error(`unexpected ${op?.v}`);
    }
  }
  function andExpr(): boolean {
    let v = primary();
    while (peek()?.v === 'and') {
      take();
      const r = primary();
      v = v && r;
    }
    return v;
  }
  function orExpr(): boolean {
    let v = andExpr();
    while (peek()?.v === 'or') {
      take();
      const r = andExpr();
      v = v || r;
    }
    return v;
  }
  const result = orExpr();
  if (i < toks.length) throw new Error(`unexpected ${toks[i].v}`);
  return result;
}

/** Rules that match the data (at most `maxHits` positions recorded per string). */
export function matchYara(rules: YaraRule[], data: Buffer, maxHits = 64): YaraMatch[] {
  const text = data.toString('latin1');
  const out: YaraMatch[] = [];
  const ruleHits = new Map<string, boolean>();
  for (const r of rules) {
    const hits = new Map<string, number[]>();
    for (const s of r.strings) {
      s.re.lastIndex = 0;
      const pos: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = s.re.exec(text)) && pos.length < maxHits) {
        pos.push(m.index);
        if (m[0].length === 0) s.re.lastIndex++;
      }
      if (pos.length) hits.set(s.id, pos);
    }
    let ok = false;
    try {
      ok = evalCondition(r, r.condition, { data, hits, ruleHits });
    } catch {
      ok = false;
    }
    ruleHits.set(r.name, ok);
    if (ok) out.push({ rule: r.name, tags: r.tags, meta: r.meta, strings: [...hits.keys()] });
  }
  return out;
}
