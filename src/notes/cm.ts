// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The note editor (CodeMirror 6), loaded only when a note is first opened:
// Markdown with live preview (syntax hidden away from the cursor, checkboxes
// you can click), heading folding, [[link]] / #tag / [[Note#heading]]
// completion, / commands, table tidy-up on Tab, hover previews of links,
// the usual shortcuts, optional vim keys and spellcheck.

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, foldGutter, foldKeymap, foldService, HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, StateField, type Extension } from '@codemirror/state';
import { Decoration, drawSelection, EditorView, hoverTooltip, keymap, placeholder, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export interface EditorHost {
  suggest(q: string): Promise<{ path: string; display: string; alias?: string; link: string }[]>;
  headings(target: string): Promise<{ text: string; level: number }[]>;
  blocks(target: string): Promise<{ id: string; text: string }[]>;
  tags(): Promise<string[]>;
  /** HTML preview of a link target (hover) */
  preview(target: string): Promise<string | null>;
  open(target: string, newPane: boolean): void;
  onChange(text: string): void;
  onCursor?(line: number): void;
  slash(): { label: string; detail?: string; apply: string | ((view: EditorView) => void) }[];
}

export interface EditorOptions {
  livePreview: boolean;
  vim: boolean;
  spellcheck: boolean;
  lineNumbers?: boolean;
  readable?: boolean;
}

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.35em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.18em', fontWeight: '650' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '650' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--text-3)' },
  { tag: t.monospace, fontFamily: 'var(--mono, ui-monospace, monospace)', background: 'var(--nt-code-bg)', borderRadius: '4px' },
  { tag: t.quote, color: 'var(--text-3)' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--text-3)' },
  { tag: t.keyword, color: '#c678dd' },
  { tag: t.string, color: '#98c379' },
  { tag: t.comment, color: 'var(--text-3)', fontStyle: 'italic' },
]);

// ---------------------------------------------------------------- live preview

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super(); }
  eq(o: CheckboxWidget) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-nt-check';
    box.checked = this.checked;
    box.onmousedown = (e) => e.preventDefault();
    box.onclick = () => {
      view.dispatch({ changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? ' ' : 'x' } });
    };
    return box;
  }
  ignoreEvent() { return false; }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-nt-bullet'; s.textContent = '•'; return s; }
}

const hide = Decoration.replace({});
const WIKI = /(!?)\[\[([^\]\n]+?)\]\]/g;

function livePreviewDecos(view: EditorView): DecorationSet {
  const b: { from: number; to: number; d: Decoration }[] = [];
  const sel = view.state.selection;
  const activeLines = new Set<number>();
  for (const r of sel.ranges) {
    const a = view.state.doc.lineAt(r.from).number, z = view.state.doc.lineAt(r.to).number;
    for (let i = a; i <= z; i++) activeLines.add(i);
  }
  const onActive = (pos: number) => activeLines.has(view.state.doc.lineAt(pos).number);
  // Frontmatter (properties) shows as the properties panel above, not as text.
  const fm = frontmatterEnd(view.state.doc.toString());
  for (const { from, to } of view.visibleRanges) {
    const wikis: [number, number][] = [];
    {
      const t = view.state.sliceDoc(from, to);
      let w: RegExpExecArray | null;
      WIKI.lastIndex = 0;
      while ((w = WIKI.exec(t))) wikis.push([from + w.index, from + w.index + w[0].length]);
    }
    syntaxTree(view.state).iterate({
      from, to,
      enter: (n) => {
        const name = n.name;
        if (n.to <= fm) return false;
        if (wikis.some(([a, z]) => n.from < z && n.to > a) && name !== 'Document' && name !== 'Paragraph' && !name.startsWith('ATXHeading') && name !== 'ListItem' && name !== 'BulletList' && name !== 'OrderedList' && name !== 'Blockquote' && name !== 'Task') return false;
        if (name === 'FencedCode' || name === 'CodeBlock') return false;
        if (onActive(n.from)) return;
        if (name === 'HeaderMark') {
          const end = Math.min(n.to + 1, view.state.doc.lineAt(n.from).to);
          b.push({ from: n.from, to: end, d: hide });
        } else if (name === 'EmphasisMark' || name === 'StrikethroughMark' || (name === 'CodeMark' && n.node.parent?.name === 'InlineCode')) {
          b.push({ from: n.from, to: n.to, d: hide });
        } else if (name === 'Link' || name === 'Image') {
          // [text](url) → text
          const marks = n.node.getChildren('LinkMark');
          const url = n.node.getChild('URL');
          if (name === 'Link' && marks.length >= 2) {
            b.push({ from: n.from, to: marks[0].to, d: hide });
            b.push({ from: marks[1].from, to: n.to, d: hide });
            b.push({ from: marks[0].to, to: marks[1].from, d: Decoration.mark({ class: 'cm-nt-link', attributes: { 'data-href': url ? view.state.sliceDoc(url.from, url.to) : '' } }) });
          }
          return false;
        } else if (name === 'TaskMarker') {
          const checked = /x/i.test(view.state.sliceDoc(n.from, n.to));
          b.push({ from: n.from, to: n.to, d: Decoration.replace({ widget: new CheckboxWidget(checked, n.from + 1) }) });
        } else if (name === 'ListMark') {
          const line = view.state.doc.lineAt(n.from);
          const isTask = /^\s*[-*+]\s+\[.\]/.test(line.text);
          if (/[-*+]/.test(view.state.sliceDoc(n.from, n.to))) b.push({ from: n.from, to: isTask ? n.to + 1 : n.to, d: isTask ? hide : Decoration.replace({ widget: new BulletWidget() }) });
        } else if (name === 'QuoteMark') {
          b.push({ from: n.from, to: n.to, d: hide });
        }
      },
    });
    // [[wikilinks]] and ==highlights==, which the Markdown grammar does not know.
    const text = view.state.sliceDoc(from, to);
    let m: RegExpExecArray | null;
    WIKI.lastIndex = 0;
    while ((m = WIKI.exec(text))) {
      const s = from + m.index, e = s + m[0].length;
      const inner = m[2];
      const bar = inner.indexOf('|');
      const target = bar >= 0 ? inner.slice(0, bar) : inner;
      if (onActive(s)) {
        b.push({ from: s, to: e, d: Decoration.mark({ class: 'cm-nt-wikilink', attributes: { 'data-target': target } }) });
        continue;
      }
      const showFrom = bar >= 0 ? s + m[1].length + 2 + bar + 1 : s + m[1].length + 2;
      b.push({ from: s, to: showFrom, d: hide });
      b.push({ from: showFrom, to: e - 2, d: Decoration.mark({ class: 'cm-nt-wikilink', attributes: { 'data-target': target } }) });
      b.push({ from: e - 2, to: e, d: hide });
    }
    const hl = /==(?=\S)([^=\n]*?\S)==/g;
    while ((m = hl.exec(text))) {
      const s = from + m.index, e = s + m[0].length;
      b.push({ from: s + 2, to: e - 2, d: Decoration.mark({ class: 'cm-nt-highlight' }) });
      if (!onActive(s)) { b.push({ from: s, to: s + 2, d: hide }); b.push({ from: e - 2, to: e, d: hide }); }
    }
  }
  b.sort((x, y) => x.from - y.from || x.to - y.to);
  const out = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const r of b) {
    if (r.from < last && (r.d as unknown) === hide) continue;
    try { out.add(r.from, r.to, r.d); } catch { /* overlapping replace: skip */ }
    last = Math.max(last, r.to);
  }
  return out.finish();
}

/** End of the properties block at the top of a note (0 when there is none). */
function frontmatterEnd(doc: string): number {
  const m = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(doc);
  return m ? m[0].replace(/\r?\n$/, '').length : 0;
}

/** Hides the properties block in live preview unless the cursor is in it. */
const hideFrontmatter = StateField.define<DecorationSet>({
  create: (st) => fmDecos(st),
  update: (v, tr) => (tr.docChanged || tr.selection ? fmDecos(tr.state) : v),
  provide: (f) => EditorView.decorations.from(f),
});

function fmDecos(st: EditorState): DecorationSet {
  const end = frontmatterEnd(st.doc.toString());
  if (!end || st.selection.main.head <= end) return Decoration.none;
  return Decoration.set([Decoration.replace({ block: true }).range(0, end)]);
}

const livePreviewPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = livePreviewDecos(view); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = livePreviewDecos(u.view);
  }
}, { decorations: (v) => v.decorations });

const livePreview: Extension = [livePreviewPlugin, hideFrontmatter];

// Wikilinks are styled in source mode too.
const wikiMarks = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(view: EditorView) {
    const out = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.sliceDoc(from, to);
      let m: RegExpExecArray | null;
      WIKI.lastIndex = 0;
      while ((m = WIKI.exec(text))) {
        const inner = m[2];
        const bar = inner.indexOf('|');
        out.add(from + m.index, from + m.index + m[0].length, Decoration.mark({ class: 'cm-nt-wikilink', attributes: { 'data-target': bar >= 0 ? inner.slice(0, bar) : inner } }));
      }
    }
    return out.finish();
  }
}, { decorations: (v) => v.decorations });

// ---------------------------------------------------------------- folding by heading

const headingFold = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const m = /^(#{1,6})\s/.exec(line.text);
  if (!m) return null;
  const level = m[1].length;
  let end = line.to;
  let inFence = false;
  for (let i = line.number + 1; i <= state.doc.lines; i++) {
    const l = state.doc.line(i);
    if (/^\s*(```|~~~)/.test(l.text)) inFence = !inFence;
    const h = !inFence && /^(#{1,6})\s/.exec(l.text);
    if (h && h[1].length <= level) break;
    end = l.to;
  }
  return end > line.to ? { from: line.to, to: end } : null;
});

// ---------------------------------------------------------------- completion

function linkCompletions(host: EditorHost) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const before = ctx.matchBefore(/!?\[\[[^\]\n]*$/);
    if (before) {
      const inner = before.text.replace(/^!?\[\[/, '');
      const start = before.from + before.text.indexOf('[[') + 2;
      const hash = inner.indexOf('#');
      if (hash >= 0) {
        const target = inner.slice(0, hash);
        const sub = inner.slice(hash + 1);
        if (sub.startsWith('^')) {
          const blocks = await host.blocks(target);
          return { from: start + hash + 2, options: blocks.map((b) => ({ label: b.id, detail: b.text.slice(0, 60), apply: `${b.id}]]` })), filter: true };
        }
        const hs = await host.headings(target);
        return { from: start + hash + 1, options: hs.map((h) => ({ label: h.text, detail: 'H' + h.level, apply: `${h.text}]]` })), filter: true };
      }
      if (inner.includes('|')) return null;
      const list = await host.suggest(inner);
      const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2);
      const close = after === ']]' ? '' : ']]';
      return {
        from: start,
        filter: false,
        options: list.map((s, i): Completion => ({
          label: s.display,
          detail: s.alias ? `→ ${s.path}` : s.path.includes('/') ? s.path : undefined,
          boost: -i,
          apply: `${s.link}${s.alias ? `|${s.alias}` : ''}${close}`,
        })),
      };
    }
    const tag = ctx.matchBefore(/(^|\s)#[\p{L}\p{N}_/-]*$/u);
    if (tag && (tag.text.trim().length > 1 || ctx.explicit)) {
      const tags = await host.tags();
      const from = tag.from + tag.text.indexOf('#') + 1;
      return { from, options: tags.map((x) => ({ label: x, type: 'keyword' })), validFor: /^[\p{L}\p{N}_/-]*$/u };
    }
    const slash = ctx.matchBefore(/(^|\s)\/[\w ]*$/);
    if (slash) {
      const from = slash.from + slash.text.indexOf('/');
      return {
        from,
        filter: true,
        options: host.slash().map((c) => ({
          label: `/${c.label}`,
          displayLabel: c.label,
          detail: c.detail,
          apply: (view: EditorView, _c: Completion, f: number, to: number) => {
            if (typeof c.apply === 'string') {
              const caret = c.apply.indexOf('$|');
              const text = c.apply.replace('$|', '');
              view.dispatch({ changes: { from: f, to, insert: text }, selection: { anchor: f + (caret >= 0 ? caret : text.length) } });
            } else {
              view.dispatch({ changes: { from: f, to, insert: '' } });
              c.apply(view);
            }
          },
        })),
      };
    }
    return null;
  };
}

// ---------------------------------------------------------------- commands

export function wrap(view: EditorView, mark: string, endMark = mark) {
  view.dispatch(view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    if (text.startsWith(mark) && text.endsWith(endMark) && text.length >= mark.length + endMark.length) {
      const inner = text.slice(mark.length, text.length - endMark.length);
      return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelection.range(r.from, r.from + inner.length) };
    }
    return { changes: [{ from: r.from, insert: mark }, { from: r.to, insert: endMark }], range: EditorSelection.range(r.from + mark.length, r.to + mark.length) };
  }));
  return true;
}

export function toggleTask(view: EditorView) {
  const changes = [];
  for (const r of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(r.head);
    const m = /^(\s*)([-*+]|\d+[.)])\s+\[(.)\]/.exec(line.text);
    if (m) {
      const at = line.from + m[0].length - 2;
      changes.push({ from: at, to: at + 1, insert: m[3] === ' ' ? 'x' : ' ' });
    } else {
      const lm = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line.text);
      if (lm) changes.push({ from: line.from + lm[0].length, insert: '[ ] ' });
      else { const ind = /^\s*/.exec(line.text)![0]; changes.push({ from: line.from + ind.length, insert: '- [ ] ' }); }
    }
  }
  view.dispatch({ changes });
  return true;
}

/** Lines up a Markdown table's pipes (Tab moves to the next cell). */
export function formatTable(lines: string[]): string[] {
  const rows = lines.map((l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim()));
  const cols = Math.max(...rows.map((r) => r.length));
  const isSep = (r: string[]) => r.every((c) => /^:?-+:?$/.test(c));
  const w = Array.from({ length: cols }, (_, i) => Math.max(3, ...rows.filter((r) => !isSep(r)).map((r) => (r[i] ?? '').length)));
  return rows.map((r) => `| ${Array.from({ length: cols }, (_, i) => {
    const c = r[i] ?? '';
    if (isSep(r)) { const left = c.startsWith(':'), right = c.endsWith(':'); return `${left ? ':' : '-'}${'-'.repeat(w[i] - 2)}${right ? ':' : '-'}`; }
    return c.padEnd(w[i]);
  }).join(' | ')} |`);
}

function tableTab(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  if (!/^\s*\|.*\|\s*$/.test(line.text)) return false;
  let a = line.number, z = line.number;
  while (a > 1 && /^\s*\|/.test(state.doc.line(a - 1).text)) a--;
  while (z < state.doc.lines && /^\s*\|/.test(state.doc.line(z + 1).text)) z++;
  const lines: string[] = [];
  for (let i = a; i <= z; i++) lines.push(state.doc.line(i).text);
  const formatted = formatTable(lines);
  const from = state.doc.line(a).from, to = state.doc.line(z).to;
  const col = line.text.slice(0, state.selection.main.head - line.from).split('|').length - 2;
  const rowIdx = line.number - a;
  let r = rowIdx, c = col + dir;
  const ncols = formatted[0].split('|').length - 2;
  if (c >= ncols) { c = 0; r++; }
  if (c < 0) { c = ncols - 1; r--; }
  if (r === 1 && formatted.length > 1 && /^\|\s*:?-/.test(formatted[1])) r += dir;
  let text = formatted.join('\n');
  if (r >= formatted.length) {
    const blank = `| ${Array.from({ length: ncols }, () => '   ').join(' | ')} |`;
    text += `\n${blank}`;
    formatted.push(blank);
    c = 0;
  }
  r = Math.max(0, r);
  const before = formatted.slice(0, r).reduce((s, l) => s + l.length + 1, 0);
  const cells = formatted[r].split('|');
  const offset = cells.slice(0, c + 1).join('|').length + 2;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + before + offset } });
  return true;
}

// ---------------------------------------------------------------- hover previews and link clicks

function linkAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos);
  WIKI.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI.exec(line.text))) {
    const s = line.from + m.index;
    if (pos >= s && pos <= s + m[0].length) {
      const inner = m[2];
      const bar = inner.indexOf('|');
      return bar >= 0 ? inner.slice(0, bar) : inner;
    }
  }
  const md = /\[[^\]\n]*\]\(([^)\s]+)\)/g;
  while ((m = md.exec(line.text))) {
    const s = line.from + m.index;
    if (pos >= s && pos <= s + m[0].length && !/^[a-z]+:/i.test(m[1])) { try { return decodeURI(m[1]); } catch { return m[1]; } }
  }
  return null;
}

function hoverPreview(host: EditorHost) {
  return hoverTooltip(async (view, pos) => {
    const target = linkAt(view, pos);
    if (!target) return null;
    const html = await host.preview(target);
    if (html == null) return null;
    return {
      pos,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'nt-hover markdown-rendered';
        dom.innerHTML = html;
        return { dom };
      },
    };
  }, { hoverTime: 450 });
}

// ---------------------------------------------------------------- setup

export interface NoteEditor {
  view: EditorView;
  setText(text: string): void;
  setOptions(o: EditorOptions): Promise<void>;
  destroy(): void;
}

export async function createEditor(parent: HTMLElement, text: string, host: EditorHost, opts: EditorOptions): Promise<NoteEditor> {
  const preview = new Compartment();
  const vimC = new Compartment();
  const spell = new Compartment();
  const vimExt = async (on: boolean): Promise<Extension> => (on ? (await import('@replit/codemirror-vim')).vim() : []);
  let applying = false;
  let live = opts.livePreview;
  const fmEnd = frontmatterEnd(text);
  const state = EditorState.create({
    doc: text,
    // Start below the properties, so live preview opens with them tucked away.
    selection: { anchor: fmEnd ? Math.min(text.length, fmEnd + 1) : 0 },
    extensions: [
      vimC.of(await vimExt(opts.vim)),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      search({ top: true }),
      markdown({ base: markdownLanguage, addKeymap: true }),
      syntaxHighlighting(highlight),
      headingFold,
      foldGutter({ openText: '▾', closedText: '▸' }),
      EditorView.lineWrapping,
      placeholder('Start writing…  Type / for commands, [[ to link'),
      autocompletion({ override: [linkCompletions(host)], activateOnTyping: true, icons: false }),
      hoverPreview(host),
      wikiMarks,
      preview.of(opts.livePreview ? livePreview : []),
      spell.of(EditorView.contentAttributes.of({ spellcheck: opts.spellcheck ? 'true' : 'false', autocorrect: 'on', autocapitalize: 'sentences' })),
      keymap.of([
        { key: 'Mod-b', run: (v) => wrap(v, '**') },
        { key: 'Mod-i', run: (v) => wrap(v, '*') },
        { key: 'Mod-Shift-h', run: (v) => wrap(v, '==') },
        { key: 'Mod-Shift-x', run: (v) => wrap(v, '~~') },
        { key: 'Mod-`', run: (v) => wrap(v, '`') },
        { key: 'Mod-k', run: (v) => { const r = v.state.selection.main; const s = v.state.sliceDoc(r.from, r.to); v.dispatch({ changes: { from: r.from, to: r.to, insert: `[${s}]()` }, selection: { anchor: r.from + s.length + 3 } }); return true; } },
        { key: 'Mod-l', run: toggleTask },
        { key: 'Mod-Enter', run: toggleTask },
        { key: 'Tab', run: (v) => tableTab(v, 1) },
        { key: 'Shift-Tab', run: (v) => tableTab(v, -1) },
        ...closeBracketsKeymap, ...completionKeymap, ...foldKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !applying) host.onChange(u.state.doc.toString());
        if (u.selectionSet) host.onCursor?.(u.state.doc.lineAt(u.state.selection.main.head).number - 1);
      }),
      EditorView.domEventHandlers({
        mousedown(e, view) {
          const link = (e.target as HTMLElement).closest('.cm-nt-wikilink, .cm-nt-link') as HTMLElement | null;
          if (!link) return false;
          const target = link.getAttribute('data-target') ?? link.getAttribute('data-href');
          if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
          const mod = e.metaKey || e.ctrlKey;
          if (!mod) {
            // Live preview: a click opens the link, unless the cursor is on that line (then it edits).
            if (!live) return false;
            const line = view.state.doc.lineAt(view.posAtDOM(link)).number;
            if (view.state.doc.lineAt(view.state.selection.main.head).number === line) return false;
          }
          e.preventDefault();
          host.open(target, e.shiftKey || (mod && e.altKey));
          return true;
        },
      }),
      EditorView.theme({
        // The page scrolls the note (with its properties above it); the text sits in the
        // same centred column as the properties, the fold arrows just left of it.
        '&': { height: 'auto', fontSize: 'var(--fs-lg)' },
        '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.7', overflow: 'visible' },
        '.cm-content': { padding: '0 var(--nt-pad, 32px) 0 calc(var(--nt-pad, 32px) - var(--nt-fold, 16px))', caretColor: 'var(--accent)' },
        '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--text-3)', minWidth: 'var(--nt-fold, 16px)' },
        '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', opacity: '0.5', width: 'var(--nt-fold, 16px)', textAlign: 'center' },
        '&.cm-focused': { outline: 'none' },
        '.cm-tooltip-autocomplete': { borderRadius: '8px' },
      }),
    ],
  });
  const view = new EditorView({ state, parent });
  return {
    view,
    setText(next: string) {
      if (next === view.state.doc.toString()) return;
      applying = true;
      const head = Math.min(view.state.selection.main.head, next.length);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, selection: { anchor: head } });
      applying = false;
    },
    async setOptions(o: EditorOptions) {
      live = o.livePreview;
      view.dispatch({ effects: [
        preview.reconfigure(o.livePreview ? livePreview : []),
        vimC.reconfigure(await vimExt(o.vim)),
        spell.reconfigure(EditorView.contentAttributes.of({ spellcheck: o.spellcheck ? 'true' : 'false' })),
      ] });
    },
    destroy() { view.destroy(); },
  };
}
