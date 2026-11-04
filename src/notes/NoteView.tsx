// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One note in a tab: its properties, then the editor (live preview or
// source) or the reading view, and a status line with the word count.
// Typing is saved half a second after you stop; pictures pasted or dropped
// in go to the vault's attachment folder.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { parseNote, readProps, writeProps } from '../../core/notes/parse';
import type { YamlValue } from '../../core/notes/yaml';
import { formatDate } from '../../core/notes/templates';
import type { EditorHost, NoteEditor } from './cm';
import { useNotes } from './ctx';
import { Reading } from './Reading';
import { MindMap } from './MindMap';
import { isMindmapNote } from '../../core/notes/mindmap';

export type ViewMode = 'live' | 'source' | 'reading' | 'map';

const SLASH: { label: string; detail?: string; apply: string }[] = [
  { label: 'Heading 1', apply: '# $|' },
  { label: 'Heading 2', apply: '## $|' },
  { label: 'Heading 3', apply: '### $|' },
  { label: 'Task', apply: '- [ ] $|' },
  { label: 'Bulleted list', apply: '- $|' },
  { label: 'Numbered list', apply: '1. $|' },
  { label: 'Quote', apply: '> $|' },
  { label: 'Callout', detail: 'note, tip, warning…', apply: '> [!note] $|\n> ' },
  { label: 'Table', apply: '| Column | Column |\n| --- | --- |\n| $| |  |' },
  { label: 'Code block', apply: '```\n$|\n```' },
  { label: 'Math block', apply: '$$\n$|\n$$' },
  { label: 'Mermaid diagram', apply: '```mermaid\ngraph TD\n  A --> B$|\n```' },
  { label: 'Divider', apply: '\n---\n$|' },
  { label: 'Link to note', apply: '[[$|]]' },
  { label: 'Embed note', apply: '![[$|]]' },
  { label: 'Footnote', apply: '[^1]$|\n\n[^1]: ' },
  { label: 'Highlight', apply: '==$|==' },
  { label: 'Comment', apply: '%% $| %%' },
];

function propType(key: string, v: YamlValue, types: Record<string, string>): string {
  if (types[key]) return types[key];
  if (key === 'tags' || key === 'tag') return 'tags';
  if (key === 'aliases' || key === 'alias') return 'aliases';
  if (Array.isArray(v)) return 'multitext';
  if (typeof v === 'boolean') return 'checkbox';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return 'datetime';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
  return 'text';
}

const TYPE_ICON: Record<string, string> = { text: 'text', multitext: 'list', tags: 'tag', aliases: 'link', number: 'grid', checkbox: 'check', date: 'calendar', datetime: 'clock' };

export function Properties({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  const n = useNotes();
  const { props, error } = useMemo(() => readProps(text), [text]);
  const [newKey, setNewKey] = useState('');
  const keys = Object.keys(props);
  if (error) return <div className="nt-col nt-props nt-props-error" role="alert"><Icon name="warning" size={13} /> Properties could not be read: {error}</div>;
  const set = (k: string, v: YamlValue | undefined) => {
    const next = { ...props };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onChange(writeProps(text, next));
  };
  if (!keys.length && !newKey) return null;
  return (
    <div className="nt-col nt-props" role="group" aria-label="Properties">
      {keys.map((k) => {
        const v = props[k];
        const type = propType(k, v, n.vault.config.types);
        return (
          <div className="nt-prop" key={k}>
            <span className="nt-prop-key" title={type}><Icon name={TYPE_ICON[type] ?? 'text'} size={12} />{k}</span>
            <span className="nt-prop-val">
              {type === 'checkbox' ? <input type="checkbox" checked={v === true} onChange={(e) => set(k, e.target.checked)} />
                : type === 'number' ? <input type="number" defaultValue={v == null ? '' : String(v)} onBlur={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))} />
                : type === 'date' ? <input type="date" defaultValue={typeof v === 'string' ? v : ''} onChange={(e) => set(k, e.target.value || null)} />
                : type === 'datetime' ? <input type="datetime-local" defaultValue={typeof v === 'string' ? v.slice(0, 16) : ''} onChange={(e) => set(k, e.target.value || null)} />
                : ['multitext', 'tags', 'aliases'].includes(type) ? <Chips values={Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]} onChange={(list) => set(k, list)} tag={type === 'tags'} />
                : <input defaultValue={v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)} key={String(v)} onBlur={(e) => e.target.value !== String(v ?? '') && set(k, e.target.value)} />}
            </span>
            <button className="nt-icon-btn" title="Remove property" aria-label="Remove property" onClick={() => set(k, undefined)}><Icon name="close" size={11} /></button>
          </div>
        );
      })}
      <form className="nt-prop-add" onSubmit={(e) => { e.preventDefault(); if (newKey.trim()) { set(newKey.trim(), null); setNewKey(''); } }}>
        <Icon name="plus" size={12} />
        <input className="nt-prop-new" placeholder="Add property" aria-label="Add property" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
      </form>
    </div>
  );
}

function Chips({ values, onChange, tag }: { values: string[]; onChange: (v: string[]) => void; tag?: boolean }) {
  const [draft, setDraft] = useState('');
  return (
    <span className="nt-chips">
      {values.map((v, i) => (
        <span className={`nt-chip ${tag ? 'is-tag' : ''}`} key={`${v}${i}`}>{v}<button onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label={`Remove ${v}`}>×</button></span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add…" onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ',') && draft.trim()) { e.preventDefault(); onChange([...values, draft.trim().replace(/^#/, '')]); setDraft(''); }
        if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
      }} />
    </span>
  );
}

/** What the page header can ask of an open note. */
export interface NoteHandle { flush(): Promise<void>; record(): void; stopRecording(): void }

export function NoteView({ path, mode, subpath, active, onEditor, onHandle, onRecording, onWantsMap }: { path: string; mode: ViewMode; subpath?: string; active: boolean; onEditor?: (e: NoteEditor | null) => void; onHandle?: (h: NoteHandle | null) => void; onRecording?: (on: boolean) => void; /** the note asks to be shown as a mind map (it has view: mindmap) */ onWantsMap?: () => void }) {
  const n = useNotes();
  const [text, setText] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ vim?: boolean; spellcheck?: boolean }>({});
  const editorBox = useRef<HTMLDivElement>(null);
  const editor = useRef<NoteEditor | null>(null);
  const saved = useRef('');
  const pending = useRef<string | null>(null);
  const timer = useRef<number>(0);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [cursorLine, setCursorLine] = useState(0);
  const textRef = useRef<string>('');

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const t = pending.current;
    if (t == null || t === saved.current) return;
    pending.current = null;
    saved.current = t;
    await api.notes.write(n.vault.id, path, t);
  }, [n.vault.id, path]);

  const change = useCallback((t: string) => {
    textRef.current = t;
    setText(t);
    pending.current = t;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 500);
  }, [flush]);

  // Load, and reload when the file changes on disk (unless there are unsaved edits).
  useEffect(() => {
    let alive = true;
    void api.notes.read(n.vault.id, path).then((t) => {
      if (!alive) return;
      if (pending.current != null && pending.current !== saved.current) return;
      if (t === saved.current && text != null) return;
      saved.current = t;
      textRef.current = t;
      setText(t);
      editor.current?.setText(t);
      if (onWantsMap && isMindmapNote(readProps(t).props)) onWantsMap();
    }).catch(() => alive && setText(''));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.vault.id, path, n.rev]);

  useEffect(() => () => { void flush(); }, [flush]);
  useEffect(() => { void api.notes.settings().then((s) => setSettings({ vim: s.vim, spellcheck: s.spellcheck })); }, []);

  const host = useMemo<EditorHost>(() => ({
    suggest: (q) => api.notes.suggest(n.vault.id, q),
    headings: async (target) => {
      const p = target ? await api.notes.resolve(n.vault.id, target, path) : path;
      if (!p) return [];
      return parseNote(p === path ? textRef.current : await api.notes.read(n.vault.id, p)).headings.map((h) => ({ text: h.text, level: h.level }));
    },
    blocks: async (target) => {
      const p = target ? await api.notes.resolve(n.vault.id, target, path) : path;
      if (!p) return [];
      const t = p === path ? textRef.current : await api.notes.read(n.vault.id, p);
      const lines = t.split('\n');
      return parseNote(t).blocks.map((b) => ({ id: b.id, text: lines[b.line] ?? '' }));
    },
    tags: async () => (await api.notes.tags(n.vault.id)).map((t) => t.tag),
    preview: async (target) => (await api.notes.preview(n.vault.id, target, path))?.html ?? null,
    open: (target, newPane) => n.openLink(target, path, { split: newPane }),
    onChange: change,
    onCursor: setCursorLine,
    slash: () => [
      ...SLASH,
      { label: 'Date', detail: formatDate(new Date(), n.vault.config.templates.dateFormat), apply: formatDate(new Date(), n.vault.config.templates.dateFormat) },
      { label: 'Time', apply: formatDate(new Date(), n.vault.config.templates.timeFormat) },
    ],
  }), [n, path, change]);

  const editing = (mode === 'live' || mode === 'source') && text != null;
  // Create the editor (CodeMirror loads on first use).
  useEffect(() => {
    if (!editing || !editorBox.current) return;
    let alive = true;
    let ed: NoteEditor | null = null;
    void import('./cm').then(async ({ createEditor }) => {
      if (!alive || !editorBox.current) return;
      ed = await createEditor(editorBox.current, textRef.current, host, { livePreview: mode === 'live', vim: !!settings.vim || n.vault.config.vimMode, spellcheck: settings.spellcheck ?? n.vault.config.spellcheck, readable: n.vault.config.readableLineLength });
      if (!alive) { ed.destroy(); return; }
      editor.current = ed;
      onEditor?.(ed);
      if (subpath) jumpTo(ed, subpath);
      // Take the keyboard only if nothing else has it (a rename box, for one).
      if (active && (!document.activeElement || document.activeElement === document.body)) ed.view.focus();
    });
    return () => { alive = false; ed?.destroy(); editor.current = null; onEditor?.(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, host]);

  useEffect(() => {
    void editor.current?.setOptions({ livePreview: mode === 'live', vim: !!settings.vim || n.vault.config.vimMode, spellcheck: settings.spellcheck ?? n.vault.config.spellcheck });
  }, [mode, settings, n.vault.config]);
  useEffect(() => { if (active) onEditor?.(editor.current); }, [active, onEditor]);
  useEffect(() => { if (editor.current && subpath) jumpTo(editor.current, subpath); }, [subpath]);

  useEffect(() => { onRecording?.(!!recording); }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onHandle?.({ flush, record: () => void record(), stopRecording: () => recording?.stop() });
  });
  useEffect(() => () => onHandle?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    if (text == null) return null;
    const p = parseNote(text);
    return { words: p.words, chars: p.chars, backlinks: 0 };
  }, [text]);

  const attach = async (files: FileList | File[]) => {
    const out: string[] = [];
    for (const f of Array.from(files)) {
      const p = await api.notes.saveAttachment(n.vault.id, path, f.name || `Pasted image ${formatDate(new Date(), 'YYYYMMDDHHmmss')}.png`, new Uint8Array(await f.arrayBuffer()));
      out.push(`![[${p.split('/').pop()}]]`);
    }
    const ed = editor.current;
    if (ed) {
      const at = ed.view.state.selection.main.head;
      ed.view.dispatch({ changes: { from: at, insert: out.join('\n') } });
    } else change(`${textRef.current}\n${out.join('\n')}\n`);
    await n.refresh();
  };

  const record = async () => {
    if (recording) { recording.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        const file = new File(chunks, `Recording ${formatDate(new Date(), 'YYYYMMDDHHmmss')}.webm`, { type: 'audio/webm' });
        void attach([file]);
      };
      rec.start();
      setRecording(rec);
    } catch (e) {
      n.toast(`Could not record: ${(e as Error).message}`);
    }
  };

  if (text == null) return <div className="nt-loading" role="status">Opening…</div>;
  const crumbs = path.split('/').slice(0, -1);
  const toggleTaskLine = (line: number) => {
    const lines = text.split('\n');
    lines[line] = lines[line].replace(/\[(.)\]/, (_m, c: string) => (c === ' ' ? '[x]' : '[ ]'));
    change(lines.join('\n'));
  };

  return (
    <div className={`nt-note mode-${mode} ${n.vault.config.readableLineLength === false ? 'is-wide' : ''}`} onPasteCapture={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void attach(e.clipboardData.files); } }} onDropCapture={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); void attach(e.dataTransfer.files); } }}>
      <div className="nt-note-body">
        {mode === 'map' ? <MindMap path={path} text={text} onChange={change} toast={n.toast} /> : (
        <div className="nt-scroll">
          {crumbs.length ? <nav className="nt-col nt-crumbs" aria-label="Folder">{crumbs.map((c, i) => <span key={i}>{c}</span>)}</nav> : null}
          {mode === 'reading' ? (
            <><Properties text={text} onChange={change} /><Reading path={path} text={text} onToggleTask={toggleTaskLine} /></>
          ) : (
            <>
              <Properties text={text} onChange={(t) => { change(t); editor.current?.setText(t); }} />
              <div className="nt-editor" ref={editorBox} data-testid="note-editor" />
            </>
          )}
        </div>
        )}
      </div>
      {mode === 'map' ? null : <div className="nt-status" aria-label="Note size">
        {stats ? <span>{stats.words.toLocaleString()} words · {stats.chars.toLocaleString()} characters{mode !== 'reading' ? ` · Line ${cursorLine + 1}` : ''}</span> : null}
      </div>}
    </div>
  );
}

function jumpTo(ed: NoteEditor, subpath: string) {
  const doc = ed.view.state.doc.toString();
  const p = parseNote(doc);
  let line = -1;
  if (subpath.startsWith('^')) line = p.blocks.find((b) => b.id === subpath.slice(1))?.line ?? -1;
  else line = p.headings.find((h) => h.text.toLowerCase() === subpath.toLowerCase())?.line ?? -1;
  if (line < 0) return;
  const pos = ed.view.state.doc.line(line + 1).from;
  ed.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
}
