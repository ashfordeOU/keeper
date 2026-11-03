// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// HTML (and Evernote's ENML) to Markdown and back. Notes apps store rich text
// in many flavours; this keeps headings, lists, checklists, links, emphasis,
// code, quotes and simple tables. Anything fancier (colours, fonts, drawings)
// is simplified, and the interface says so.

// ---------------------------------------------------------------- a small HTML reader

export interface HNode {
  name: string; // '#text' for text
  attrs: Record<string, string>;
  children: HNode[];
  text?: string;
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'en-media', 'en-todo', 'col', 'area', 'base', 'wbr', 'source']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'object']);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·', euro: '€', pound: '£', yen: '¥', deg: '°', times: '×', divide: '÷' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** Parses HTML leniently into a tree (unclosed tags close at their parent's end). */
export function parseHtml(html: string, opts: { xml?: boolean } = {}): HNode {
  const root: HNode = { name: '#root', attrs: {}, children: [] };
  const stack: HNode[] = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  const text = (t: string) => { if (t) top().children.push({ name: '#text', attrs: {}, children: [], text: decodeEntities(t) }); };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { text(html.slice(i)); break; }
    text(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? html.length : e + 3; continue; }
    if (html.startsWith('<![CDATA[', lt)) {
      const e = html.indexOf(']]>', lt);
      const raw = html.slice(lt + 9, e < 0 ? html.length : e);
      top().children.push({ name: '#text', attrs: {}, children: [], text: raw });
      i = e < 0 ? html.length : e + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const e = html.indexOf('>', lt); i = e < 0 ? html.length : e + 1; continue; }
    const m = /^<\s*(\/)?\s*([a-zA-Z][\w:-]*)([^>]*?)(\/)?\s*>/.exec(html.slice(lt, lt + 4000));
    if (!m) { text('<'); i = lt + 1; continue; }
    i = lt + m[0].length;
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((n) => n.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    if (!opts.xml && SKIP.has(name) && !m[4]) {
      const e = html.toLowerCase().indexOf(`</${name}`, i);
      i = e < 0 ? html.length : html.indexOf('>', e) + 1 || html.length;
      continue;
    }
    // A new list item or paragraph closes the open one.
    if (!opts.xml && ((name === 'li' && top().name === 'li') || (name === 'p' && top().name === 'p'))) stack.pop();
    const node: HNode = { name, attrs: parseAttrs(m[3]), children: [] };
    top().children.push(node);
    if (!m[4] && (opts.xml || !VOID.has(name))) stack.push(node);
  }
  return root;
}

export function textContent(n: HNode): string {
  if (n.name === '#text') return n.text ?? '';
  if (n.name === 'br') return '\n';
  return n.children.map(textContent).join('');
}

// ---------------------------------------------------------------- HTML → Markdown

export interface ToMdOptions {
  /** how to write an embedded file (Evernote <en-media hash=…>) */
  media?(attrs: Record<string, string>): string;
}

const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'pre', 'blockquote', 'table', 'hr', 'en-note', 'body', 'html', 'section', 'article', 'header', 'footer', 'figure']);

function mdEscapeInline(s: string): string {
  return s.replace(/ /g, ' ').replace(/([*_`\\])/g, '\\$1');
}

function inline(n: HNode, o: ToMdOptions): string {
  if (n.name === '#text') return mdEscapeInline((n.text ?? '').replace(/[\t\n\r ]+/g, ' '));
  const inner = () => n.children.map((c) => inline(c, o)).join('');
  switch (n.name) {
    case 'br': return '\n';
    case 'b': case 'strong': { const t = inner(); return t.trim() ? `**${t.trim()}**` : t; }
    case 'i': case 'em': { const t = inner(); return t.trim() ? `*${t.trim()}*` : t; }
    case 's': case 'strike': case 'del': { const t = inner(); return t.trim() ? `~~${t.trim()}~~` : t; }
    case 'code': return '`' + textContent(n).replace(/`/g, '\\`') + '`';
    case 'a': {
      const t = inner().trim();
      const href = n.attrs.href ?? '';
      if (!href) return t;
      return !t || t === href ? `<${href}>` : `[${t}](${href.replace(/ /g, '%20')})`;
    }
    case 'img': return `![${n.attrs.alt ?? ''}](${(n.attrs.src ?? '').replace(/ /g, '%20')})`;
    case 'en-media': return o.media ? o.media(n.attrs) : '';
    case 'en-todo': return n.attrs.checked === 'true' ? '[x] ' : '[ ] ';
    case 'input': return n.attrs.type === 'checkbox' ? ('checked' in n.attrs ? '[x] ' : '[ ] ') : '';
    default: return block(n, o, 0);
  }
}

function listItems(n: HNode, o: ToMdOptions, depth: number): string {
  const ordered = n.name === 'ol';
  const checklist = /checklist|todo|task/.test(n.attrs.class ?? '') || n.attrs['data-type'] === 'taskList';
  let k = Number(n.attrs.start) || 1;
  const lines: string[] = [];
  for (const li of n.children) {
    if (li.name === '#text' && !(li.text ?? '').trim()) continue;
    if (li.name !== 'li') { lines.push(block(li, o, depth)); continue; }
    const nested = li.children.filter((c) => c.name === 'ul' || c.name === 'ol');
    const rest: HNode = { ...li, children: li.children.filter((c) => !nested.includes(c)) };
    let text = block(rest, o, depth + 1).trim().replace(/\n+/g, ' ');
    let box = '';
    const checked = /checked|done/.test(li.attrs.class ?? '') || li.attrs['data-checked'] === 'true';
    if (/^\[[ x]\] /.test(text)) { box = text.slice(0, 4); text = text.slice(4).trimStart(); }
    else if (checklist) box = checked ? '[x] ' : '[ ] ';
    const pad = '  '.repeat(depth);
    lines.push(`${pad}${ordered ? `${k++}.` : '-'} ${box}${text}`);
    for (const sub of nested) lines.push(listItems(sub, o, depth + 1));
  }
  return lines.filter(Boolean).join('\n');
}

function table(n: HNode, o: ToMdOptions): string {
  const rows: string[][] = [];
  const walk = (x: HNode) => {
    if (x.name === 'tr') rows.push(x.children.filter((c) => c.name === 'td' || c.name === 'th').map((c) => block(c, o, 0).trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
    else x.children.forEach(walk);
  };
  walk(n);
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), `| ${Array(w).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

function block(n: HNode, o: ToMdOptions, depth: number): string {
  let out = '';
  for (const c of n.children) {
    if (c.name === '#text' && /\n/.test(c.text ?? '') && !(c.text ?? '').trim()) continue;
    if (c.name === '#text' || (!BLOCK.has(c.name) && c.name !== 'div' && c.name !== 'li' && !/^h\d$/.test(c.name))) { out += inline(c, o); continue; }
    switch (c.name) {
      case 'div': {
        if (out && !out.endsWith('\n')) out += '\n';
        // A line that starts with a checkbox (Evernote's <en-todo>, an <input>) is a checklist item.
        const line = block(c, o, depth);
        out += `${/^\[[ x]\] /.test(line) ? `- ${line}` : line}\n`;
        break;
      }
      case 'p': out += `\n\n${block(c, o, depth).trim()}\n\n`; break;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        out += `\n\n${'#'.repeat(Number(c.name[1]))} ${block(c, o, depth).trim().replace(/\n+/g, ' ')}\n\n`;
        break;
      case 'ul': case 'ol': out += `\n\n${listItems(c, o, depth)}\n\n`; break;
      case 'pre': {
        const lang = /language-(\w+)/.exec(c.children.find((x) => x.name === 'code')?.attrs.class ?? c.attrs.class ?? '')?.[1] ?? '';
        out += `\n\n\`\`\`${lang}\n${textContent(c).replace(/\n$/, '')}\n\`\`\`\n\n`;
        break;
      }
      case 'blockquote': out += `\n\n${block(c, o, depth).trim().split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')}\n\n`; break;
      case 'hr': out += '\n\n---\n\n'; break;
      case 'table': out += `\n\n${table(c, o)}\n\n`; break;
      default: out += block(c, o, depth);
    }
  }
  return out;
}

/** HTML or ENML to Markdown. */
export function htmlToMarkdown(html: string, o: ToMdOptions = {}): string {
  const tree = parseHtml(html);
  const md = block(tree, o, 0)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n (?=[^ ])/g, '\n')
    .replace(/^ (?=[^ ])/, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
  return md;
}

// ---------------------------------------------------------------- Markdown → HTML

export interface ToHtmlOptions {
  /** 'apple': one <div> per line as Apple Notes writes; 'enml': Evernote's subset; 'html': plain */
  flavour?: 'html' | 'apple' | 'enml';
  /** how to write ![alt](src) (e.g. an <en-media> for an attachment) */
  image?(alt: string, src: string): string | undefined;
}

export function inlineMd(s: string, o: ToHtmlOptions = {}): string {
  const codes: string[] = [];
  let t = s.replace(/`([^`]+)`/g, (_, c: string) => { codes.push(`<code>${escapeHtml(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  t = escapeHtml(t);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt: string, src: string) => o.image?.(alt, src) ?? `<img src="${src}" alt="${alt}"/>`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>');
  t = t.replace(/(^|[^*\\])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/(^|[^\w\\])_([^_\s][^_]*)_(?!\w)/g, '$1<i>$2</i>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  t = t.replace(/\\([*_`\\])/g, '$1');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}

interface ListLine { indent: number; ordered: boolean; box?: boolean; text: string }

function renderList(lines: ListLine[], o: ToHtmlOptions): string {
  const out: string[] = [];
  let i = 0;
  const walk = (indent: number): string => {
    const ordered = lines[i].ordered;
    const tag = ordered ? 'ol' : 'ul';
    const parts: string[] = [];
    while (i < lines.length && lines[i].indent >= indent) {
      const l = lines[i];
      if (l.indent > indent) { const sub = walk(l.indent); if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(/<\/li>$/, `${sub}</li>`); else parts.push(`<li>${sub}</li>`); continue; }
      i++;
      const box = l.box === undefined ? '' : o.flavour === 'enml' ? `<en-todo checked="${l.box}"/>` : `<input type="checkbox"${l.box ? ' checked="checked"' : ''}/> `;
      parts.push(`<li>${box}${inlineMd(l.text, o)}</li>`);
    }
    return `<${tag}>${parts.join('')}</${tag}>`;
  };
  while (i < lines.length) out.push(walk(lines[i].indent));
  return out.join('');
}

/** Markdown to HTML (XHTML-safe, so it also works as ENML inside <en-note>). */
export function markdownToHtml(md: string, o: ToHtmlOptions = {}): string {
  const src = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const apple = o.flavour === 'apple';
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    if (apple) out.push(...para.map((l) => `<div>${inlineMd(l, o) || '<br/>'}</div>`));
    else out.push(`<p>${para.map((l) => inlineMd(l, o)).join('<br/>')}</p>`);
    para = [];
  };
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    const fence = /^\s*(```|~~~)\s*(\w*)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < src.length && !src[i].trim().startsWith(fence[1]); i++) code.push(src[i]);
      out.push(`<pre><code${fence[2] && o.flavour !== 'enml' ? ` class="language-${fence[2]}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push(`<h${h[1].length}>${inlineMd(h[2].replace(/\s+#+\s*$/, ''), o)}</h${h[1].length}>`); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push('<hr/>'); continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const q: string[] = [];
      for (; i < src.length && /^\s*>/.test(src[i]); i++) q.push(src[i].replace(/^\s*> ?/, ''));
      i--;
      out.push(`<blockquote>${markdownToHtml(q.join('\n'), { ...o, flavour: o.flavour === 'apple' ? 'html' : o.flavour })}</blockquote>`);
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const items: ListLine[] = [];
      for (; i < src.length; i++) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(src[i]);
        if (!m) break;
        const box = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
        items.push({ indent: m[1].replace(/\t/g, '  ').length, ordered: /\d/.test(m[2]), box: box ? box[1] !== ' ' : undefined, text: box ? box[2] : m[3] });
      }
      i--;
      out.push(renderList(items, o));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{3,}/.test(src[i + 1] ?? '')) {
      flush();
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inlineMd(c.trim().replace(/\\\|/g, '|'), o));
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < src.length && /^\s*\|.*\|\s*$/.test(src[i]); i++) rows.push(cells(src[i]));
      i--;
      out.push(`<table><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    if (!line.trim()) { flush(); if (apple) out.push('<div><br/></div>'); continue; }
    para.push(line);
  }
  flush();
  if (apple) while (out[out.length - 1] === '<div><br/></div>') out.pop();
  return out.join(apple ? '' : '\n');
}

/** Plain text of Markdown, for previews and search snippets. */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/[*_`~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
