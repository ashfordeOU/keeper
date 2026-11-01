// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small, forgiving XML reader for GPX, KML, TCX and Apple Health files.
// Namespace prefixes are dropped (gpxtpx:hr → hr), so readers ask for local
// names. No DTDs, no entities beyond the five standard ones and numeric ones:
// nothing in a file can make it fetch or expand anything.

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const local = (n: string) => {
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
};

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[local(m[1])] = decodeEntities(m[3] ?? m[4] ?? '');
  return out;
}

export function parseXml(src: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      top.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      top.text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      // <?xml …?> and <!DOCTYPE …>: skipped (a DOCTYPE's internal subset is skipped whole).
      let e = src.indexOf('>', lt);
      const bracket = src.indexOf('[', lt);
      if (src[lt + 1] === '!' && bracket >= 0 && bracket < e) e = src.indexOf(']>', bracket) + 1;
      i = e <= 0 ? n : e + 1;
      continue;
    }
    // Find the end of the tag, skipping '>' inside quoted attribute values.
    let j = lt + 1;
    let q = '';
    for (; j < n; j++) {
      const c = src[j];
      if (q) { if (c === q) q = ''; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '>') break;
    }
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body.startsWith('/')) {
      const name = local(body.slice(1).trim());
      // Close up to the matching element (tolerates a missing close tag).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) { stack.length = k; break; }
      }
      continue;
    }
    const selfClose = body.endsWith('/');
    const inner = selfClose ? body.slice(0, -1) : body;
    const sp = inner.search(/\s/);
    const name = local(sp < 0 ? inner : inner.slice(0, sp));
    const node: XNode = { name, attrs: sp < 0 ? {} : parseAttrs(inner.slice(sp)), children: [], text: '' };
    top.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

export const child = (n: XNode | undefined, name: string): XNode | undefined => n?.children.find((c) => c.name === name);
export const children = (n: XNode | undefined, name: string): XNode[] => n?.children.filter((c) => c.name === name) ?? [];
export const text = (n: XNode | undefined, name?: string): string | undefined => {
  const t = name ? child(n, name) : n;
  const s = t?.text.trim();
  return s ? s : undefined;
};

/** Every descendant with this local name, in document order. */
export function all(n: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of n.children) {
    if (c.name === name) out.push(c);
    all(c, name, out);
  }
  return out;
}

export function firstDeep(n: XNode, name: string): XNode | undefined {
  for (const c of n.children) {
    if (c.name === name) return c;
    const f = firstDeep(c, name);
    if (f) return f;
  }
  return undefined;
}

export const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
