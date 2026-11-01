// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Text, code, Markdown, JSON, HTML, notebooks, logs and subtitles.

import hljs from 'highlight.js';
import { marked } from 'marked';
import { useMemo, useState } from 'react';
import { parseSubtitles } from '../../../core/docparse';
import { formatBytes } from '../../../core/format';
import { codeLanguage } from '../../../core/previewKind';
import { api } from '../../api';
import { Bar, BarButton, Loaded, useLoad, type ViewerProps } from '../Preview';
import { isDark, onLinkClick, sandboxDoc, sanitize } from '../util';
import 'highlight.js/styles/github.css';
import './hl-dark.css';

const HIGHLIGHT_LIMIT = 400 * 1024;

function useText(path: string, max = 2 * 1024 * 1024) {
  return useLoad(() => api.preview.text(path, max), [path, max]);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Highlighted code with line numbers. Very large files are shown plain. */
export function CodeBlock({ code, language, wrap = false, inline = false }: { code: string; language?: string; wrap?: boolean; inline?: boolean }) {
  const html = useMemo(() => {
    const src = inline ? code.split('\n').slice(0, 80).join('\n') : code;
    if (src.length > HIGHLIGHT_LIMIT) return escapeHtml(src);
    try {
      if (language && hljs.getLanguage(language)) return hljs.highlight(src, { language, ignoreIllegals: true }).value;
      if (!language && src.length < 60_000) return hljs.highlightAuto(src).value;
    } catch {
      /* fall back to plain text */
    }
    return escapeHtml(src);
  }, [code, language, inline]);
  const lines = useMemo(() => (inline ? Math.min(80, code.split('\n').length) : code.split('\n').length), [code, inline]);
  return (
    <div className={`pv-code hljs ${wrap ? 'wrap' : ''}`}>
      <pre className="pv-gutter" aria-hidden>{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
      <pre className="pv-src"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}

function TextHeader({ t, extra }: { t: { encoding: string; truncated: boolean; size: number }; extra?: React.ReactNode }) {
  return (
    <>
      {extra}
      <span className="grow" />
      <span className="small muted">{t.encoding}{t.truncated ? ` · showing the first 2 MB of ${formatBytes(t.size)}` : ''}</span>
    </>
  );
}

export function CodeViewer({ info, mode }: ViewerProps) {
  const [wrap, setWrap] = useState(info.kind === 'text');
  const state = useText(info.path);
  const lang = codeLanguage(info.name, info.ext) ?? (info.kind === 'xml' ? 'xml' : info.kind === 'text' ? 'plaintext' : undefined);
  return (
    <Loaded state={state}>
      {(t) => (
        <div className="pv-col">
          {mode === 'full' ? (
            <Bar>
              {lang && lang !== 'plaintext' ? <span className="badge">{lang}</span> : null}
              <BarButton label="Wrap lines" icon="list" on={wrap} onClick={() => setWrap((w) => !w)} />
              <BarButton label="Copy all" icon="copy" onClick={() => void api.files.copyText(t.text)} />
              <TextHeader t={t} />
            </Bar>
          ) : null}
          <CodeBlock code={t.text} language={lang} wrap={wrap} inline={mode === 'inline'} />
        </div>
      )}
    </Loaded>
  );
}

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(md: string): { html: string; blockedRemote: number } {
  const raw = marked.parse(md, { async: false }) as string;
  const clean = sanitize(raw);
  // Highlight fenced code after sanitising (the highlighter only adds spans).
  const doc = new DOMParser().parseFromString(`<div>${clean.html}</div>`, 'text/html');
  doc.querySelectorAll('pre code').forEach((el) => {
    const lang = [...el.classList].find((c) => c.startsWith('language-'))?.slice(9);
    try {
      el.innerHTML = lang && hljs.getLanguage(lang) ? hljs.highlight(el.textContent ?? '', { language: lang }).value : escapeHtml(el.textContent ?? '');
      el.classList.add('hljs');
    } catch {
      /* leave plain */
    }
  });
  doc.querySelectorAll('input[type=checkbox]').forEach((el) => el.setAttribute('disabled', ''));
  return { html: doc.body.firstElementChild!.innerHTML, blockedRemote: clean.blockedRemote };
}

export function MarkdownViewer({ info, mode }: ViewerProps) {
  const [source, setSource] = useState(false);
  const state = useText(info.path);
  return (
    <Loaded state={state}>
      {(t) => {
        const r = renderMarkdown(t.text);
        return (
          <div className="pv-col">
            {mode === 'full' ? (
              <Bar>
                <div className="seg">
                  <button className={!source ? 'on' : ''} onClick={() => setSource(false)}>Rendered</button>
                  <button className={source ? 'on' : ''} onClick={() => setSource(true)}>Source</button>
                </div>
                <TextHeader t={t} extra={r.blockedRemote ? <span className="small muted">{r.blockedRemote} remote image{r.blockedRemote === 1 ? '' : 's'} hidden for privacy</span> : null} />
              </Bar>
            ) : null}
            {source ? <CodeBlock code={t.text} language="markdown" wrap /> : <article className="pv-doc pv-markdown" onClick={onLinkClick} dangerouslySetInnerHTML={{ __html: r.html }} />}
          </div>
        );
      }}
    </Loaded>
  );
}

// ------------------------------------------------------------------ JSON

function JsonNode({ k, v, depth, last }: { k?: string; v: unknown; depth: number; last: boolean }) {
  const [open, setOpen] = useState(depth < 2);
  const comma = last ? '' : ',';
  const key = k !== undefined ? <span className="j-key">{JSON.stringify(k)}</span> : null;
  if (v === null || typeof v !== 'object') {
    const cls = v === null ? 'j-null' : typeof v === 'string' ? 'j-str' : typeof v === 'number' ? 'j-num' : 'j-bool';
    const text = typeof v === 'string' && v.length > 2000 ? JSON.stringify(v.slice(0, 2000)) + '…' : JSON.stringify(v);
    return <div className="j-row">{key}{key ? ': ' : ''}<span className={cls}>{text}</span>{comma}</div>;
  }
  const arr = Array.isArray(v);
  const entries = arr ? (v as unknown[]).map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, unknown>);
  const [o, c] = arr ? ['[', ']'] : ['{', '}'];
  if (!entries.length) return <div className="j-row">{key}{key ? ': ' : ''}{o}{c}{comma}</div>;
  return (
    <div className="j-node">
      <div className="j-row j-toggle" onClick={() => setOpen((x) => !x)}>
        <span className="j-caret">{open ? '▾' : '▸'}</span>{key}{key ? ': ' : ''}{o}
        {!open ? <span className="j-more"> {entries.length} {arr ? 'items' : 'keys'} </span> : null}
        {!open ? <>{c}{comma}</> : null}
      </div>
      {open ? (
        <div className="j-children">
          {entries.slice(0, 1000).map(([ck, cv], i) => <JsonNode key={ck} k={arr ? undefined : ck} v={cv} depth={depth + 1} last={i === Math.min(entries.length, 1000) - 1} />)}
          {entries.length > 1000 ? <div className="j-row muted">…{entries.length - 1000} more</div> : null}
        </div>
      ) : null}
      {open ? <div className="j-row">{c}{comma}</div> : null}
    </div>
  );
}

export function JsonViewer({ info, mode }: ViewerProps) {
  const [raw, setRaw] = useState(false);
  const state = useText(info.path, 20 * 1024 * 1024);
  return (
    <Loaded state={state}>
      {(t) => {
        let parsed: unknown;
        let err: string | null = null;
        try {
          parsed = JSON.parse(t.text.replace(/^﻿/, ''));
        } catch (e) {
          // JSON Lines: one object per line.
          const lines = t.text.split(/\r?\n/).filter((l) => l.trim());
          try {
            parsed = lines.map((l) => JSON.parse(l));
          } catch {
            err = e instanceof Error ? e.message : String(e);
          }
        }
        return (
          <div className="pv-col">
            {mode === 'full' ? (
              <Bar>
                <div className="seg">
                  <button className={!raw && !err ? 'on' : ''} onClick={() => setRaw(false)} disabled={!!err}>Tree</button>
                  <button className={raw || err ? 'on' : ''} onClick={() => setRaw(true)}>Source</button>
                </div>
                {err ? <span className="badge danger" title={err}>Not valid JSON</span> : null}
                <BarButton label="Copy formatted" icon="copy" onClick={() => void api.files.copyText(err ? t.text : JSON.stringify(parsed, null, 2))} />
                <TextHeader t={t} />
              </Bar>
            ) : null}
            {raw || err ? <CodeBlock code={t.text} language="json" inline={mode === 'inline'} /> : <div className="pv-json mono"><JsonNode v={parsed} depth={0} last /></div>}
          </div>
        );
      }}
    </Loaded>
  );
}

// ------------------------------------------------------------------ HTML

/** Web pages render in a sandbox with scripts and network access switched off. */
export function HtmlViewer({ info, mode }: ViewerProps) {
  const [source, setSource] = useState(false);
  const state = useText(info.path, 8 * 1024 * 1024);
  return (
    <Loaded state={state}>
      {(t) => {
        const clean = sanitize(t.text.replace(/<head[\s\S]*?<\/head>/i, ''));
        return (
          <div className="pv-col">
            {mode === 'full' ? (
              <Bar>
                <div className="seg">
                  <button className={!source ? 'on' : ''} onClick={() => setSource(false)}>Page</button>
                  <button className={source ? 'on' : ''} onClick={() => setSource(true)}>Source</button>
                </div>
                <span className="small muted">Scripts and remote content are switched off.</span>
                <TextHeader t={t} />
              </Bar>
            ) : null}
            {source ? <CodeBlock code={t.text} language="xml" inline={mode === 'inline'} /> : (
              <iframe className="pv-frame" sandbox="" referrerPolicy="no-referrer" title={info.name} srcDoc={sandboxDoc(clean.html, isDark())} />
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

// ------------------------------------------------------------------ notebooks

interface NbCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  execution_count?: number | null;
  outputs?: { output_type: string; text?: string | string[]; name?: string; data?: Record<string, string | string[]>; ename?: string; evalue?: string; traceback?: string[] }[];
}

const joinSrc = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join('') : s ?? '');

export function NotebookViewer({ info, mode }: ViewerProps) {
  const state = useText(info.path, 30 * 1024 * 1024);
  return (
    <Loaded state={state}>
      {(t) => {
        const nb = JSON.parse(t.text) as { cells?: NbCell[]; metadata?: { kernelspec?: { display_name?: string; language?: string }; language_info?: { name?: string } } };
        const lang = nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? 'python';
        const cells = (nb.cells ?? []).slice(0, mode === 'inline' ? 6 : 2000);
        return (
          <div className="pv-col">
            {mode === 'full' ? <Bar><span className="badge">{nb.metadata?.kernelspec?.display_name ?? lang}</span><span className="small muted">{nb.cells?.length ?? 0} cells</span></Bar> : null}
            <div className="pv-notebook" onClick={onLinkClick}>
              {cells.map((c, i) => (
                <div key={i} className={`nb-cell nb-${c.cell_type}`}>
                  {c.cell_type === 'markdown' ? (
                    <div className="pv-doc pv-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(joinSrc(c.source)).html }} />
                  ) : (
                    <>
                      <div className="nb-prompt mono">In [{c.execution_count ?? ' '}]</div>
                      <CodeBlock code={joinSrc(c.source)} language={c.cell_type === 'code' ? lang : 'plaintext'} wrap />
                      {(c.outputs ?? []).map((o, j) => <NbOutput key={j} o={o} />)}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

function NbOutput({ o }: { o: NonNullable<NbCell['outputs']>[number] }) {
  if (o.output_type === 'stream') return <pre className={`nb-out ${o.name === 'stderr' ? 'err' : ''}`}>{joinSrc(o.text)}</pre>;
  if (o.output_type === 'error') return <pre className="nb-out err">{`${o.ename}: ${o.evalue}`}</pre>;
  const d = o.data ?? {};
  for (const t of ['image/png', 'image/jpeg', 'image/gif']) if (d[t]) return <img className="nb-img" src={`data:${t};base64,${joinSrc(d[t]).replace(/\s/g, '')}`} alt="" />;
  if (d['image/svg+xml']) return <img className="nb-img" src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(joinSrc(d['image/svg+xml']))))}`} alt="" />;
  if (d['text/html']) return <div className="nb-out html" dangerouslySetInnerHTML={{ __html: sanitize(joinSrc(d['text/html'])).html }} />;
  if (d['text/markdown']) return <div className="nb-out pv-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(joinSrc(d['text/markdown'])).html }} />;
  if (d['text/plain']) return <pre className="nb-out">{joinSrc(d['text/plain'])}</pre>;
  return null;
}

// ------------------------------------------------------------------ logs

const LEVEL = /\b(FATAL|CRITICAL|ERROR|ERR|SEVERE|WARN(?:ING)?|INFO|NOTICE|DEBUG|TRACE|VERBOSE)\b/i;
const TIME = /^(\[?\d{4}-\d{2}-\d{2}[T ][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?\]?|\[?\w{3} \d{1,2} [\d:]+\]?|\[?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]?)/;

function levelOf(line: string): 'error' | 'warn' | 'info' | 'debug' | '' {
  const m = line.match(LEVEL)?.[1]?.toUpperCase();
  if (!m) return '';
  if (/FATAL|CRIT|ERR|SEVERE/.test(m)) return 'error';
  if (/WARN/.test(m)) return 'warn';
  if (/DEBUG|TRACE|VERBOSE/.test(m)) return 'debug';
  return 'info';
}

export function LogViewer({ info, mode }: ViewerProps) {
  const [filter, setFilter] = useState('');
  const [levels, setLevels] = useState({ error: true, warn: true, info: true, debug: true, '': true });
  const state = useLoad(async () => {
    // The end of a log is usually the interesting part.
    const t = await api.preview.text(info.path, 4 * 1024 * 1024);
    return t;
  }, [info.path]);
  return (
    <Loaded state={state}>
      {(t) => {
        const all = t.text.split(/\r?\n/);
        const lines = all.map((l, i) => ({ l, i, lv: levelOf(l) })).filter((x) => levels[x.lv] && (!filter || x.l.toLowerCase().includes(filter.toLowerCase())));
        const counts = all.reduce((acc, l) => { const lv = levelOf(l); acc[lv] = (acc[lv] ?? 0) + 1; return acc; }, {} as Record<string, number>);
        const shown = mode === 'inline' ? lines.slice(-60) : lines.slice(-20000);
        return (
          <div className="pv-col">
            {mode === 'full' ? (
              <Bar>
                <input className="input pv-filter" placeholder="Filter lines" value={filter} onChange={(e) => setFilter(e.target.value)} />
                {(['error', 'warn', 'info', 'debug'] as const).map((lv) => (
                  <button key={lv} className={`pv-btn lv-${lv} ${levels[lv] ? 'on' : ''}`} onClick={() => setLevels((s) => ({ ...s, [lv]: !s[lv] }))}>
                    {lv === 'warn' ? 'Warnings' : lv === 'error' ? 'Errors' : lv === 'info' ? 'Info' : 'Debug'} <span className="num muted">{counts[lv] ?? 0}</span>
                  </button>
                ))}
                <TextHeader t={t} />
              </Bar>
            ) : null}
            <div className="pv-log mono">
              {shown.map(({ l, i, lv }) => {
                const ts = l.match(TIME)?.[0];
                return (
                  <div key={i} className={`log-line lv-${lv}`}>
                    <span className="log-n">{i + 1}</span>
                    {ts ? <span className="log-ts">{ts}</span> : null}
                    <span>{ts ? l.slice(ts.length) : l}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

export function SubtitleViewer({ info, mode }: ViewerProps) {
  const state = useText(info.path);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  return (
    <Loaded state={state}>
      {(t) => {
        const cues = parseSubtitles(t.text);
        if (!cues.length) return <CodeBlock code={t.text} wrap inline={mode === 'inline'} />;
        return (
          <div className="pv-col">
            {mode === 'full' ? <Bar><span className="small muted">{cues.length} lines · {fmt(cues[cues.length - 1].end)} long</span></Bar> : null}
            <div className="pv-cues">
              {(mode === 'inline' ? cues.slice(0, 40) : cues).map((c, i) => (
                <div key={i} className="cue"><span className="mono muted">{fmt(c.start)}</span><span>{c.text}</span></div>
              ))}
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}
