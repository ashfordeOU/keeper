// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small Markdown-to-HTML step for the website: headings, paragraphs, lists (two levels),
// fenced code, block quotes, tables, and inline code, bold, italics and links. Everything
// else is escaped, so raw HTML in the source shows as text.

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function slug(s) {
  return String(s).toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Inline Markdown in one line of text. `link(href)` may rewrite link targets. */
export function inline(text, link = (h) => h) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${escapeHtml(link(href.replace(/&amp;/g, '&')))}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(“"])\*([^*\s][^*]*?)\*(?=[\s).,;:!?”"]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
}

/**
 * Markdown to HTML. Options: `link(href)` rewrites link targets, `headingShift` adds to every
 * heading level, `heading(level, text)` may return the HTML for a heading itself.
 */
export function markdown(src, opts = {}) {
  const link = opts.link ?? ((h) => h);
  const shift = opts.headingShift ?? 0;
  const lines = String(src).replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), link)}</p>`); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      flush();
      const body = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const level = Math.min(6, h[1].length + shift);
      const custom = opts.heading?.(level, h[2]);
      out.push(custom ?? `<h${level} id="${slug(h[2])}">${inline(h[2], link)}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flush();
      const items = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        const top = l.match(/^[-*]\s+(.*)$/);
        const sub = l.match(/^\s{2,}[-*]\s+(.*)$/);
        if (top) items.push({ text: top[1], sub: [] });
        else if (sub && items.length) items[items.length - 1].sub.push(sub[1]);
        else if (/^\s+\S/.test(l) && items.length) {
          const last = items[items.length - 1];
          if (last.sub.length) last.sub[last.sub.length - 1] += ` ${l.trim()}`; else last.text += ` ${l.trim()}`;
        } else { i--; break; }
      }
      out.push(`<ul>${items.map((it) => `<li>${inline(it.text, link)}${it.sub.length ? `<ul>${it.sub.map((s) => `<li>${inline(s, link)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flush();
      const items = [];
      for (; i < lines.length && /^\s*\d+\.\s+|^\s{2,}\S/.test(lines[i]); i++) {
        const m = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (m) items.push(m[1]); else items[items.length - 1] += ` ${lines[i].trim()}`;
      }
      i--;
      out.push(`<ol>${items.map((t) => `<li>${inline(t, link)}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const body = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''));
      i--;
      out.push(`<blockquote>${markdown(body.join('\n'), opts)}</blockquote>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      flush();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const head = cells(line);
      i += 2;
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c, link)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, link)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}
