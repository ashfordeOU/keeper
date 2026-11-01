// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small XML reader for WebDAV/CalDAV answers and mail autoconfig files.
// Namespaces are resolved, so `d:href` and `D:href` both become
// `{DAV:}href`; text is unescaped. Not a validating parser.

export interface XmlNode {
  /** `{namespace}local`, or just `local` without a namespace */
  name: string;
  local: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', local: '#root', attrs: {}, children: [], text: '' };
  const stack: { node: XmlNode; ns: Record<string, string> }[] = [{ node: root, ns: { xml: 'http://www.w3.org/XML/1998/namespace' } }];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.node.text += m[1]; continue; }
    if (m[6] !== undefined) { top.node.text += unescapeXml(m[6]); continue; }
    if (!m[3]) continue;
    if (m[2] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    const ns = { ...top.ns };
    for (const a of m[4].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const v = unescapeXml(a[2] ?? a[3] ?? '');
      if (a[1] === 'xmlns') ns[''] = v;
      else if (a[1].startsWith('xmlns:')) ns[a[1].slice(6)] = v;
      else attrs[a[1]] = v;
    }
    const [prefix, local] = m[3].includes(':') ? m[3].split(':', 2) : ['', m[3]];
    const uri = ns[prefix];
    const node: XmlNode = { name: uri ? `{${uri}}${local}` : local, local, attrs, children: [], text: '' };
    top.node.children.push(node);
    if (!m[5]) stack.push({ node, ns });
  }
  return root;
}

/** Every descendant (depth-first) whose name or local name matches. */
export function findAll(n: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (x: XmlNode) => {
    for (const c of x.children) {
      if (c.name === name || c.local === name) out.push(c);
      walk(c);
    }
  };
  walk(n);
  return out;
}

export function find(n: XmlNode, name: string): XmlNode | undefined {
  return findAll(n, name)[0];
}

/** All text inside a node (its own and its children's). */
export function textOf(n: XmlNode | undefined): string {
  if (!n) return '';
  return (n.text + n.children.map(textOf).join('')).trim();
}
