// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Turns a note into HTML for the reading view and for publishing: Markdown
// plus [[wikilinks]], ![[embeds]] (notes, headings, blocks, pictures, PDFs,
// audio, video), callouts, ==highlights==, %%comments%%, #tags, footnotes,
// task lists, $math$ and ```mermaid blocks (left as placeholders that the
// window fills in, or rendered by `math` when given).

import { Marked, type Tokens } from 'marked';
import { blockText, sectionText, splitFrontmatter, splitLinkInner } from './parse';
import { extOf, titleOf } from './vault';

export interface RenderEnv {
  /** link target → vault path, or null when missing */
  resolve(target: string): string | null;
  /** href for a vault path (#subpath appended by the renderer) */
  href(path: string): string;
  /** src for a picture or other file */
  src?(path: string): string;
  /** text of a note to embed (null when it cannot be read) */
  read?(path: string): string | null;
  /** TeX → HTML (KaTeX); when missing, math is left for the window to draw */
  math?(tex: string, display: boolean): string;
  /** how deep embeds may nest */
  depth?: number;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'avif']);
const AUDIO = new Set(['mp3', 'wav', 'm4a', 'ogg', '3gp', 'flac', 'webm']);
const VIDEO = new Set(['mp4', 'ogv', 'mov', 'mkv']);

export const CALLOUT_ICONS: Record<string, string> = {
  note: 'ℹ', abstract: '≡', summary: '≡', tldr: '≡', info: 'ℹ', todo: '☐', tip: '🔥', hint: '🔥', important: '🔥', success: '✓', check: '✓', done: '✓',
  question: '?', help: '?', faq: '?', warning: '⚠', caution: '⚠', attention: '⚠', failure: '✗', fail: '✗', missing: '✗', danger: '⚡', error: '⚡', bug: '🐞', example: '☰', quote: '❝', cite: '❝',
};

function embedHtml(target: string, subpath: string | undefined, alias: string | undefined, env: RenderEnv): string {
  const path = env.resolve(target);
  if (!path) return `<span class="nt-embed nt-missing">${esc(target)}</span>`;
  const ext = extOf(path);
  const src = ext === 'md' ? '' : env.src ? env.src(path) : env.href(path);
  const size = alias && /^\d+(x\d+)?$/.test(alias) ? alias.split('x') : null;
  const dims = size ? ` width="${size[0]}"${size[1] ? ` height="${size[1]}"` : ''}` : '';
  if (IMG.has(ext)) return `<img class="nt-img" src="${esc(src)}" alt="${esc(size ? titleOf(path) : alias ?? titleOf(path))}"${dims}>`;
  if (AUDIO.has(ext)) return `<audio class="nt-audio" controls src="${esc(src)}"></audio>`;
  if (VIDEO.has(ext)) return `<video class="nt-video" controls src="${esc(src)}"${dims}></video>`;
  if (ext === 'pdf') {
    const page = /page=(\d+)/.exec(subpath ?? '')?.[1];
    return `<iframe class="nt-pdf" src="${esc(src)}${page ? `#page=${page}` : ''}" data-page="${page ?? ''}"${dims || ' height="600"'}></iframe>`;
  }
  if (ext === 'md' && env.read && (env.depth ?? 0) < 4) {
    let text = env.read(path);
    if (text == null) return `<span class="nt-embed nt-missing">${esc(target)}</span>`;
    text = splitFrontmatter(text).body;
    if (subpath?.startsWith('^')) text = blockText(text, subpath.slice(1)) ?? `Block ${subpath} not found`;
    else if (subpath) text = sectionText(text, subpath) ?? `Heading “${subpath}” not found`;
    const inner = renderNote(text, { ...env, depth: (env.depth ?? 0) + 1 });
    return `<div class="nt-embed" data-path="${esc(path)}"><div class="nt-embed-title"><a class="internal-link" href="${esc(env.href(path))}${subpath ? `#${esc(encodeURIComponent(subpath))}` : ''}" data-href="${esc(path)}">${esc(titleOf(path))}${subpath ? ` › ${esc(subpath.replace(/^\^/, ''))}` : ''}</a></div>${inner}</div>`;
  }
  return `<a class="internal-link nt-file" href="${esc(env.href(path))}" data-href="${esc(path)}">${esc(alias ?? titleOf(path))}</a>`;
}

/** Renders a note body (frontmatter is skipped) to HTML. */
export function renderNote(text: string, env: RenderEnv): string {
  const body = splitFrontmatter(text).body.replace(/%%[\s\S]*?%%/g, '');
  const m = new Marked({ gfm: true, breaks: false });
  const fns: string[] = [];
  m.use({
    extensions: [
      {
        name: 'wikilink',
        level: 'inline',
        start: (s: string) => { const i = s.search(/!?\[\[/); return i < 0 ? undefined : i; },
        tokenizer(src: string) {
          const mm = /^(!?)\[\[([^\]\n]+?)\]\]/.exec(src);
          if (!mm) return undefined;
          return { type: 'wikilink', raw: mm[0], embed: mm[1] === '!', inner: mm[2] };
        },
        renderer(tok) {
          const t = tok as unknown as { embed: boolean; inner: string };
          const p = splitLinkInner(t.inner);
          if (t.embed) return embedHtml(p.target, p.subpath, p.alias, env);
          const path = p.target ? env.resolve(p.target) : null;
          const label = esc(p.alias ?? (p.target ? `${p.target}${p.subpath ? ` > ${p.subpath.replace(/^\^/, '')}` : ''}` : (p.subpath ?? '').replace(/^\^/, '')));
          const hash = p.subpath ? `#${esc(encodeURIComponent(p.subpath))}` : '';
          if (!p.target) return `<a class="internal-link" href="${hash}">${label}</a>`;
          if (!path) return `<a class="internal-link is-unresolved" data-href="${esc(p.target)}" href="#">${label}</a>`;
          return `<a class="internal-link" data-href="${esc(path)}" href="${esc(env.href(path))}${hash}">${label}</a>`;
        },
      },
      {
        name: 'mathBlock',
        level: 'block',
        start: (s: string) => { const i = s.indexOf('$$'); return i < 0 ? undefined : i; },
        tokenizer(src: string) {
          const mm = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
          return mm ? { type: 'mathBlock', raw: mm[0], tex: mm[1].trim() } : undefined;
        },
        renderer(tok) {
          const tex = (tok as unknown as { tex: string }).tex;
          return env.math ? `<div class="nt-math display">${env.math(tex, true)}</div>` : `<div class="nt-math display" data-tex="${esc(tex)}">${esc(tex)}</div>`;
        },
      },
      {
        name: 'mathInline',
        level: 'inline',
        start: (s: string) => { const i = s.search(/\$(?!\s)/); return i < 0 ? undefined : i; },
        tokenizer(src: string) {
          const mm = /^\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/.exec(src);
          return mm ? { type: 'mathInline', raw: mm[0], tex: mm[1] } : undefined;
        },
        renderer(tok) {
          const tex = (tok as unknown as { tex: string }).tex;
          return env.math ? `<span class="nt-math">${env.math(tex, false)}</span>` : `<span class="nt-math" data-tex="${esc(tex)}">${esc(tex)}</span>`;
        },
      },
      {
        name: 'highlight',
        level: 'inline',
        start: (s: string) => { const i = s.indexOf('=='); return i < 0 ? undefined : i; },
        tokenizer(src: string) {
          const mm = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
          return mm ? { type: 'highlight', raw: mm[0], tokens: this.lexer.inlineTokens(mm[1]) } : undefined;
        },
        renderer(tok) { return `<mark>${this.parser.parseInline((tok as Tokens.Generic).tokens ?? [])}</mark>`; },
      },
      {
        name: 'tag',
        level: 'inline',
        start: (s: string) => { const i = s.search(/(^|\s)#[\p{L}\p{N}_/-]/u); return i < 0 ? undefined : i + (s[i] === '#' ? 0 : 1); },
        tokenizer(src: string) {
          const mm = /^#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u.exec(src);
          return mm ? { type: 'tag', raw: mm[0], tag: mm[1] } : undefined;
        },
        renderer(tok) { const t = (tok as unknown as { tag: string }).tag; return `<a class="tag" href="#" data-tag="${esc(t)}">#${esc(t)}</a>`; },
      },
      {
        name: 'blockId',
        level: 'inline',
        start: (s: string) => { const i = s.search(/ \^[A-Za-z0-9-]+\s*$/m); return i < 0 ? undefined : i; },
        tokenizer(src: string) {
          const mm = /^ \^([A-Za-z0-9-]+)(?=\s*(\n|$))/.exec(src);
          return mm ? { type: 'blockId', raw: mm[0], id: mm[1] } : undefined;
        },
        renderer(tok) { return `<span class="nt-block-id" id="^${esc((tok as unknown as { id: string }).id)}"></span>`; },
      },
      {
        name: 'footnoteRef',
        level: 'inline',
        start: (s: string) => { const i = s.indexOf('[^'); return i < 0 ? undefined : i; },
        tokenizer(src: string) {
          const mm = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
          if (mm) return { type: 'footnoteRef', raw: mm[0], id: mm[1] };
          const inl = /^\^\[([^\]]+)\]/.exec(src);
          return inl ? { type: 'footnoteRef', raw: inl[0], id: `inline-${fns.length + 1}`, text: inl[1] } : undefined;
        },
        renderer(tok) {
          const t = tok as unknown as { id: string; text?: string };
          if (t.text) fns.push(`<li id="fn-${esc(t.id)}">${esc(t.text)}</li>`);
          return `<sup class="footnote-ref"><a href="#fn-${esc(t.id)}" id="fnref-${esc(t.id)}">${esc(t.id.replace(/^inline-/, ''))}</a></sup>`;
        },
      },
      {
        name: 'footnoteDef',
        level: 'block',
        start: (s: string) => { const i = s.search(/^\[\^[^\]]+\]:/m); return i < 0 ? undefined : i; },
        tokenizer(src: string) {
          const mm = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n|$)/.exec(src);
          if (!mm) return undefined;
          fns.push(`<li id="fn-${esc(mm[1])}">${m.parseInline(mm[2].trim()) as string} <a href="#fnref-${esc(mm[1])}" class="footnote-backref">↩</a></li>`);
          return { type: 'footnoteDef', raw: mm[0] };
        },
        renderer() { return ''; },
      },
    ],
    renderer: {
      code(t: Tokens.Code) {
        const lang = (t.lang ?? '').trim().split(/\s/)[0];
        // The source is URI-encoded: sanitisers drop attributes that hold "-->" (common in diagrams).
        if (lang === 'mermaid') return `<div class="nt-mermaid" data-src="${esc(encodeURIComponent(t.text))}"><pre>${esc(t.text)}</pre></div>`;
        if (lang === 'math') return env.math ? `<div class="nt-math display">${env.math(t.text, true)}</div>` : `<div class="nt-math display" data-tex="${esc(t.text)}">${esc(t.text)}</div>`;
        if (lang === 'base' || lang === 'query' || lang === 'dataview') return `<div class="nt-codeblock-${esc(lang)}" data-src="${esc(encodeURIComponent(t.text))}"><pre>${esc(t.text)}</pre></div>`;
        return `<pre><code class="hljs${lang ? ` language-${esc(lang)}` : ''}" data-lang="${esc(lang)}">${esc(t.text)}</code></pre>`;
      },
      blockquote(t: Tokens.Blockquote) {
        const first = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)(?:\n|$)/.exec(t.text);
        if (!first) return `<blockquote>${this.parser.parse(t.tokens)}</blockquote>`;
        const type = first[1].toLowerCase();
        const title = first[3].trim() || type[0].toUpperCase() + type.slice(1);
        const rest = t.text.slice(first[0].length);
        const fold = first[2];
        const head = `<div class="callout-title"><span class="callout-icon">${CALLOUT_ICONS[type] ?? 'ℹ'}</span><span class="callout-title-inner">${esc(title)}</span></div>`;
        const content = rest.trim() ? `<div class="callout-content">${m.parse(rest) as string}</div>` : '';
        if (fold) return `<details class="callout" data-callout="${esc(type)}"${fold === '+' ? ' open' : ''}><summary>${head}</summary>${content}</details>`;
        return `<div class="callout" data-callout="${esc(type)}">${head}${content}</div>`;
      },
      heading(t: Tokens.Heading) {
        const text = this.parser.parseInline(t.tokens);
        const id = t.text.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').toLowerCase();
        return `<h${t.depth} id="${esc(id)}" data-heading="${esc(t.text.trim())}">${text}</h${t.depth}>\n`;
      },
      listitem(item: Tokens.ListItem) {
        let inner = this.parser.parse(item.tokens);
        if (item.task) {
          inner = inner.replace(/^<input [^>]*>\s*/, '');
          const raw = /^\[(.)\]/.exec(item.raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))?.[1] ?? (item.checked ? 'x' : ' ');
          return `<li class="task-list-item${item.checked ? ' is-checked' : ''}" data-task="${esc(raw)}"><input type="checkbox" class="task-list-item-checkbox"${item.checked ? ' checked' : ''}> ${inner}</li>\n`;
        }
        return `<li>${inner}</li>\n`;
      },
      link(t: Tokens.Link) {
        const text = this.parser.parseInline(t.tokens);
        if (/^[a-z][a-z0-9+.-]*:/i.test(t.href)) return `<a class="external-link" href="${esc(t.href)}" target="_blank" rel="noopener">${text}</a>`;
        let href = t.href;
        try { href = decodeURI(href); } catch { /* keep */ }
        const hash = href.indexOf('#');
        const target = hash >= 0 ? href.slice(0, hash) : href;
        const sub = hash >= 0 ? href.slice(hash) : '';
        if (!target) return `<a class="internal-link" href="${esc(sub)}">${text}</a>`;
        const path = env.resolve(target);
        if (!path) return `<a class="internal-link is-unresolved" data-href="${esc(target)}" href="#">${text}</a>`;
        return `<a class="internal-link" data-href="${esc(path)}" href="${esc(env.href(path))}${esc(sub)}">${text}</a>`;
      },
      image(t: Tokens.Image) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(t.href)) return `<img src="${esc(t.href)}" alt="${esc(t.text)}">`;
        let href = t.href;
        try { href = decodeURI(href); } catch { /* keep */ }
        return embedHtml(href.split('#')[0], href.split('#')[1], t.text || undefined, env);
      },
      html(t: Tokens.HTML | Tokens.Tag) {
        // Notes are shown, not run: raw HTML is shown as text unless it is harmless markup.
        return /^<\/?(br|hr|sub|sup|kbd|u|s|b|i|em|strong|mark|small|details|summary|span|div|center|p|img|ins|del|abbr)\b[^>]*>$/i.test(t.text.trim()) && !/\son\w+=|javascript:/i.test(t.text) ? t.text : esc(t.text);
      },
    },
  });
  let html = m.parse(body) as string;
  if (fns.length) html += `<section class="footnotes"><hr><ol>${fns.join('')}</ol></section>`;
  return html;
}

/** Slides from a note: split on lines that are only "---". */
export function splitSlides(text: string): string[] {
  const body = splitFrontmatter(text).body;
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    if (!fence && /^---\s*$/.test(line)) { out.push(cur.join('\n').trim()); cur = []; continue; }
    cur.push(line);
  }
  out.push(cur.join('\n').trim());
  return out.filter((s, i) => s !== '' || (i > 0 && i < out.length - 1));
}
