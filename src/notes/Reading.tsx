// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading view: the note as a page. Links open notes, tasks can be ticked,
// code is coloured, diagrams drawn, PDFs and other files shown inline, and
// hovering a link with Ctrl/Cmd shows what it points at.

import DOMPurify from 'dompurify';
import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { api } from '../api';
import { FilePreview } from '../preview/Preview';
import { Ctx, useNotes, type NotesCtx } from './ctx';
import { BaseView } from './BaseView';
import 'katex/dist/katex.min.css';

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;
let hljsReady: Promise<typeof import('highlight.js').default> | null = null;
let mermaidN = 0;

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe', 'details', 'summary', 'mark', 'audio', 'video', 'semantics', 'annotation', 'math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mtext', 'mspace', 'mover', 'munder', 'mtable', 'mtr', 'mtd'],
    ADD_ATTR: ['data-href', 'data-tag', 'data-tex', 'data-src', 'data-callout', 'data-task', 'data-path', 'data-page', 'data-heading', 'data-lang', 'controls', 'open', 'encoding'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|keeper-file):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}

/** Colours code, draws diagrams and fills in file embeds inside rendered HTML. */
export async function enhance(root: HTMLElement, vaultPath: string, roots: Root[], ctx?: NotesCtx) {
  const dark = document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches;
  const code = root.querySelectorAll<HTMLElement>('pre code[data-lang]:not([data-done])');
  if (code.length) {
    hljsReady ??= import('highlight.js').then((m) => m.default);
    const hljs = await hljsReady;
    code.forEach((el) => {
      el.dataset.done = '1';
      const lang = el.dataset.lang;
      try {
        el.innerHTML = lang && hljs.getLanguage(lang) ? hljs.highlight(el.textContent ?? '', { language: lang }).value : hljs.highlightAuto(el.textContent ?? '').value;
      } catch { /* leave plain */ }
    });
  }
  const diagrams = root.querySelectorAll<HTMLElement>('.nt-mermaid:not([data-done])');
  if (diagrams.length) {
    mermaidReady ??= import('mermaid').then((m) => { m.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' }); return m.default; });
    const mermaid = await mermaidReady;
    for (const el of diagrams) {
      el.dataset.done = '1';
      try {
        const { svg } = await mermaid.render(`nt-mmd-${++mermaidN}`, decodeURIComponent(el.dataset.src ?? ''));
        el.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      } catch (e) {
        el.innerHTML = `<pre class="nt-error">${(e as Error).message.replace(/</g, '&lt;')}</pre>`;
      }
    }
  }
  // ```base blocks: a live view of the vault inside the note.
  if (ctx) root.querySelectorAll<HTMLElement>('.nt-codeblock-base:not([data-done])').forEach((el) => {
    el.dataset.done = '1';
    const box = document.createElement('div');
    box.className = 'nt-inline-base';
    el.replaceWith(box);
    const r = createRoot(box);
    roots.push(r);
    r.render(<Ctx.Provider value={ctx}><BaseView source={decodeURIComponent(el.dataset.src ?? '')} /></Ctx.Provider>);
  });
  root.querySelectorAll<HTMLIFrameElement>('iframe.nt-pdf').forEach((f) => {
    const href = decodeURIComponent((f.getAttribute('src') ?? '').replace(/^keeper-file:\/\//, '').split('#')[0]);
    const box = document.createElement('div');
    box.className = 'nt-pdf-box';
    f.replaceWith(box);
    const r = createRoot(box);
    roots.push(r);
    r.render(<FilePreview path={href.startsWith('/') || /^[a-z]:/i.test(href) ? href : `${vaultPath}/${href}`} />);
  });
}

export function Reading({ path, text, onToggleTask }: { path: string; text: string; onToggleTask?: (line: number) => void }) {
  const n = useNotes();
  const [html, setHtml] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; html: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => void api.notes.render(n.vault.id, path, { text }).then((h) => alive && setHtml(sanitize(h))), 60);
    return () => { alive = false; clearTimeout(t); };
  }, [n.vault.id, path, text, n.rev]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const roots: Root[] = [];
    void enhance(el, n.vault.path, roots, n);
    return () => { roots.forEach((r) => setTimeout(() => r.unmount())); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, n.vault.path]);

  const onClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const a = el.closest('a') as HTMLAnchorElement | null;
    if (el instanceof HTMLInputElement && el.classList.contains('task-list-item-checkbox')) {
      e.preventDefault();
      const items = [...(box.current?.querySelectorAll('.task-list-item-checkbox') ?? [])];
      const idx = items.indexOf(el);
      // The nth task in the rendered note is the nth task line in the text.
      const lines = text.split('\n');
      let seen = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s/.test(lines[i]) && ++seen === idx) { onToggleTask?.(i); break; }
      }
      return;
    }
    if (!a) return;
    if (a.classList.contains('tag')) { e.preventDefault(); n.search(`tag:#${a.dataset.tag}`); return; }
    if (a.classList.contains('internal-link')) {
      e.preventDefault();
      const target = a.dataset.href;
      const hash = decodeURIComponent((a.getAttribute('href') ?? '').split('#').slice(-1)[0] ?? '');
      if (!target) {
        // A heading in this note.
        box.current?.querySelector(`[data-heading="${CSS.escape(hash)}"], [id="${CSS.escape(hash)}"]`)?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (a.classList.contains('is-unresolved')) n.openLink(target, path, { newTab: e.metaKey || e.ctrlKey });
      else n.open(target, { newTab: e.metaKey || e.ctrlKey, split: e.shiftKey, subpath: hash && hash !== target ? hash : undefined });
    } else if (a.classList.contains('external-link')) {
      e.preventDefault();
      void api.system.openExternal(a.href);
    }
  };

  const onOver = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a.internal-link') as HTMLAnchorElement | null;
    if (!a || !(e.metaKey || e.ctrlKey) || !a.dataset.href) return;
    const r = a.getBoundingClientRect();
    void api.notes.preview(n.vault.id, a.dataset.href, path).then((p) => p && setHover({ x: r.left, y: r.bottom + 6, html: sanitize(p.html) }));
  };

  return (
    <div className="nt-reading-wrap" onMouseLeave={() => setHover(null)}>
      <div ref={box} className="nt-reading markdown-rendered" onClick={onClick} onMouseOver={onOver} dangerouslySetInnerHTML={{ __html: html }} />
      {hover ? <div className="nt-hover markdown-rendered" style={{ left: Math.min(hover.x, innerWidth - 440), top: Math.min(hover.y, innerHeight - 320) }} onMouseLeave={() => setHover(null)} dangerouslySetInnerHTML={{ __html: hover.html }} /> : null}
    </div>
  );
}
