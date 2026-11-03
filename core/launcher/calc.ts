// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sums typed into Quick Search: "12*(3+4)", "2^10", "sqrt 2", "15% of 80",
// "120 + 15%", "1e3 / 7". A small parser of its own: nothing is ever run as
// code. Unit and currency conversion come from the Island converter
// (core/island-tools/units.ts); this only does arithmetic.

export interface CalcResult {
  value: number;
  /** the result as shown (up to 10 significant digits, no trailing zeros) */
  text: string;
}

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'id'; v: string } | { t: '(' } | { t: ')' } | { t: ',' };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp,
  min: Math.min, max: Math.max,
};
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: Math.PI * 2 };

function tokenize(src: string): Tok[] | undefined {
  const s = src.replace(/[×✕]/g, '*').replace(/[÷]/g, '/').replace(/[−–]/g, '-').replace(/\*\*/g, '^');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    // Numbers: 1,234.5 (thousands commas only between groups of three), .5, 1e-3
    const num = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d*\.?\d+)(?:e[+-]?\d+)?/i.exec(s.slice(i));
    if (num && /[\d.]/.test(c)) {
      out.push({ t: 'num', v: Number(num[0].replace(/,/g, '')) });
      i += num[0].length;
      continue;
    }
    if ('+-*/^%!'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(') { out.push({ t: '(' }); i++; continue; }
    if (c === ')') { out.push({ t: ')' }); i++; continue; }
    if (c === ',') { out.push({ t: ',' }); i++; continue; }
    const id = /^(?:[a-z]+\d?|π)/i.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    return undefined;
  }
  return out;
}

type V = { v: number; pct?: boolean };

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek(): Tok | undefined { return this.toks[this.i]; }
  next(): Tok | undefined { return this.toks[this.i++]; }
  isOp(v: string) { const t = this.peek(); return t?.t === 'op' && t.v === v; }
  isId(v?: string) { const t = this.peek(); return t?.t === 'id' && (v === undefined || t.v === v); }

  // expr := term (('+'|'-') term)*   — "120 + 15%" adds 15% of 120
  expr(): V {
    let a = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as { v: string }).v;
      const b = this.term();
      const r = b.pct ? a.v * b.v : b.v;
      a = { v: op === '+' ? a.v + r : a.v - r };
    }
    return a;
  }
  // term := unary (('*' | '/' | 'of' | nothing before a bracket or name) unary)*
  term(): V {
    let a = this.unary();
    for (;;) {
      if (this.isOp('*')) { this.next(); a = { v: a.v * this.unary().v }; }
      else if (this.isOp('/')) { this.next(); a = { v: a.v / this.unary().v }; }
      else if (this.isId('of')) { this.next(); a = { v: a.v * this.unary().v }; }
      else if (this.peek()?.t === '(' || this.isId()) a = { v: a.v * this.unary().v };
      else return a;
    }
  }
  unary(): V {
    if (this.isOp('-')) { this.next(); const x = this.unary(); return { v: -x.v, pct: x.pct }; }
    if (this.isOp('+')) { this.next(); return this.unary(); }
    return this.power();
  }
  // power := postfix ('^' unary)?   (right-associative)
  power(): V {
    const b = this.postfix();
    if (this.isOp('^')) { this.next(); return { v: Math.pow(b.v, this.unary().v) }; }
    return b;
  }
  postfix(): V {
    let a: V = { v: this.atom() };
    for (;;) {
      if (this.isOp('%')) {
        this.next();
        // "50 % 7" is a remainder when a number follows; otherwise a percentage.
        const t = this.peek();
        if (t && (t.t === 'num' || t.t === '(')) { a = { v: a.v % this.atom() }; continue; }
        a = { v: a.v / 100, pct: true };
        continue;
      }
      if (this.isOp('!')) { this.next(); a = { v: factorial(a.v) }; continue; }
      return a;
    }
  }
  atom(): number {
    const t = this.next();
    if (!t) throw new Error('end');
    if (t.t === 'num') return t.v;
    if (t.t === '(') {
      const v = this.expr().v;
      if (this.next()?.t !== ')') throw new Error('paren');
      return v;
    }
    if (t.t === 'id') {
      if (t.v in CONSTS) return CONSTS[t.v];
      const f = FUNCS[t.v];
      if (!f) throw new Error('unknown');
      if (this.peek()?.t === '(') {
        this.next();
        const args = [this.expr().v];
        while (this.peek()?.t === ',') { this.next(); args.push(this.expr().v); }
        if (this.next()?.t !== ')') throw new Error('paren');
        return f(...args);
      }
      // "sqrt 2"
      return f(this.power().v);
    }
    throw new Error('token');
  }
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

/** Up to 10 significant digits, no trailing zeros, thousands separators. */
export function formatCalc(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v !== 0 && (Math.abs(v) >= 1e15 || Math.abs(v) < 1e-9)) return v.toExponential(6).replace(/\.?0+e/, 'e');
  const n = Number(v.toPrecision(10));
  return n.toLocaleString('en-US', { maximumFractionDigits: 10 });
}

/**
 * The answer to a sum, or undefined when the text is not one. Plain numbers
 * ("2024"), single words and anything with letters that are not functions or
 * constants are not sums, so file names and apps still win.
 */
export function calculate(input: string): CalcResult | undefined {
  const src = input.trim().replace(/^=\s*/, '').replace(/\s*=$/, '');
  if (!src || src.length > 200) return undefined;
  // Needs an operator or a function: "42" alone is not a sum.
  if (!/[+\-*/^%!×÷−]|\b(sqrt|cbrt|abs|round|floor|ceil|sin|cos|tan|asin|acos|atan|ln|log2?|exp|min|max)\b|(pi|tau)\b|π|\bof\b/i.test(src)) return undefined;
  const toks = tokenize(src);
  if (!toks || !toks.some((t) => t.t === 'num' || (t.t === 'id' && t.v in CONSTS))) return undefined;
  if (toks.some((t) => t.t === 'id' && !(t.v in FUNCS) && !(t.v in CONSTS) && t.v !== 'of')) return undefined;
  // A leading "-" alone with a number ("-5") is just a number.
  if (toks.length === 2 && toks[0].t === 'op' && toks[1].t === 'num') return undefined;
  try {
    const p = new Parser(toks);
    const value = p.expr().v;
    if (p.peek()) return undefined;
    if (!Number.isFinite(value)) return undefined;
    return { value, text: formatCalc(value) };
  } catch {
    return undefined;
  }
}
