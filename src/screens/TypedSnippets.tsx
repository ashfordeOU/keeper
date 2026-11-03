// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Typed Snippets: abbreviations you type in any app that become your saved
// text. One list with Dictation's spoken snippets: each snippet can be typed,
// said, or both. The list is the page: a calm head with one status pill and
// one main button, a search, and each snippet as a row with its abbreviation,
// a preview and how often it was used. New and changed snippets open in a
// sheet with a live preview and placeholder chips. Import, export and the
// apps where it never expands live under More; the listener's state and how
// to fix it, behind the pill.

import { useEffect, useMemo, useRef, useState } from 'react';
import { findSnippets, insertPlaceholder, STARTER_SNIPPETS, validAbbr, type SnippetSort } from '../../core/typing/expand';
import type { DeepPartial, Snippet, VoiceSettings } from '../../core/voice/types';
import { api } from '../api';
import { useFeature } from '../features';
import { Icon } from '../components/Icon';
import { ContextMenu, Modal, PageHead, type MenuItem } from '../components/ui';
import { mod, useStore } from '../state';
import '../styles/launcher.css';
import '../voice/voice.css';

const uid = () => Math.random().toString(36).slice(2, 10);
/** The placeholders offered as chips under the text (all of them are in docs/LAUNCHER.md). */
const CHIPS: { token: string; label: string; hint: string }[] = [
  { token: '{date}', label: 'Date', hint: 'Today’s date' },
  { token: '{time}', label: 'Time', hint: 'The time now' },
  { token: '{weekday}', label: 'Weekday', hint: 'The day of the week' },
  { token: '{date +7d}', label: 'In a week', hint: 'The date a week from today' },
  { token: '{clipboard}', label: 'Clipboard', hint: 'What you copied last' },
  { token: '{cursor}', label: 'Cursor', hint: 'Where the cursor ends up' },
];

type Status = { on: boolean; how?: string; note?: string; wanted: boolean; platform: string };
type Tone = 'ok' | 'warn' | 'off';
type Starter = (typeof STARTER_SNIPPETS)[number];

export function TypedSnippets() {
  const { settings, updateSettings, toast, go } = useStore();
  const dictationOn = useFeature('dictation');
  const [cfg, setCfg] = useState<VoiceSettings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  /** the snippet in the editor sheet: a new one has no id yet */
  const [editing, setEditing] = useState<Partial<Snippet> | null>(null);
  const [sheet, setSheet] = useState<'status' | 'apps' | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SnippetSort>('used');
  const search = useRef<HTMLInputElement>(null);

  const loadStatus = () => void api.snippets.status().then(setStatus).catch(() => undefined);
  useEffect(() => {
    void api.voice.settings().then(setCfg);
    loadStatus();
    const off = api.on('voice-settings', (s) => { setCfg(s); setTimeout(loadStatus, 400); });
    return () => off();
  }, []);

  const save = async (patch: DeepPartial<VoiceSettings>) => { setCfg(await api.voice.setSettings(patch)); setTimeout(loadStatus, 600); };
  const all = cfg?.snippets ?? [];
  const shown = useMemo(() => findSnippets(all, q, sort), [all, q, sort]);
  const exclude = settings?.typing.excludeApps ?? [];
  const busy = !!editing || !!sheet || !!menu;

  // Keyboard: N for a new snippet, / to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (busy || e.metaKey || e.ctrlKey || e.altKey || t.closest?.('input, textarea, select, [contenteditable="true"], .modal, .menu')) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setEditing({}); }
      else if (e.key === '/' && all.length) { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const remove = (s: Snippet) => {
    const before = all;
    void save({ snippets: all.filter((x) => x.id !== s.id) }).then(() => toast(`Removed ${s.abbr ?? s.trigger}`, { label: 'Undo', run: () => void save({ snippets: before }) }));
  };
  const addStarter = (st: Starter) => {
    if (all.some((s) => s.abbr === st.abbr)) return;
    void save({ snippets: [...all, { id: uid(), abbr: st.abbr, text: st.text, trigger: '' }] }).then(() => toast(`Type ${st.abbr} anywhere`));
  };
  const importCsv = () => void api.snippets.importCsv().then((r) => { if (r) toast(`Added ${r.added} snippet${r.added === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} skipped` : ''}`); });
  const exportCsv = () => void api.snippets.exportCsv().then((r) => { if (r) toast(`Saved ${r.saved} snippet${r.saved === 1 ? '' : 's'}`); });

  const typedCount = all.filter((s) => s.abbr).length;
  const tone: Tone | null = !status || !typedCount ? null : status.on ? 'ok' : status.wanted ? 'warn' : 'off';
  const moreItems: MenuItem[] = [
    { label: 'Import from CSV…', icon: 'down', run: importCsv },
    ...(typedCount ? [{ label: 'Export to CSV…', icon: 'arrowUp', run: exportCsv }] : []),
    { label: '', sep: true },
    { label: `Apps left out (${exclude.length})…`, icon: 'block', run: () => setSheet('apps') },
  ];

  return (
    <div className="page snip-page" data-testid="snippets-page">
      <PageHead title="Typed Snippets" sub="Type a short code in any app and it becomes your text.">
        {tone ? (
          <button className={`snip-pill ${tone}`} data-testid="snippets-status" aria-haspopup="dialog" onClick={() => setSheet('status')} title="How typed snippets listen on this computer">
            <span className="snip-dot" aria-hidden />
            {tone === 'ok' ? 'Listening' : tone === 'warn' ? <>Not listening <span className="snip-pill-fix">Fix</span></> : 'Off'}
          </button>
        ) : null}
        <button className="btn" data-testid="snippets-more" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}>
          More <Icon name="chevronDown" size={12} />
        </button>
        <button className="btn primary" data-testid="snippet-new" onClick={() => setEditing({})} title="New snippet (N)">
          <Icon name="plus" size={14} /> New snippet
        </button>
      </PageHead>

      {!cfg ? null : all.length ? (
        <>
          <div className="snip-tools">
            <label className="snip-search">
              <Icon name="search" size={14} />
              <input ref={search} className="snip-search-input" type="search" placeholder="Find a snippet" aria-label="Find a snippet" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } else if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector<HTMLElement>('.snip-row')?.focus(); } }} data-testid="snippets-search" />
              <kbd aria-hidden>/</kbd>
            </label>
            <div className="snip-seg" role="radiogroup" aria-label="Order">
              {(['used', 'name'] as const).map((k) => (
                <button key={k} role="radio" aria-checked={sort === k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{k === 'used' ? 'Most used' : 'A to Z'}</button>
              ))}
            </div>
            <span className="grow" />
            <span className="small muted">{q ? `${shown.length} of ${all.length}` : `${all.length} snippet${all.length === 1 ? '' : 's'}`}</span>
          </div>

          {shown.length ? (
            <ul className="snip-list" data-testid="snippets-table" aria-label="Your snippets" onKeyDown={(e) => {
              const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.snip-row')];
              const i = rows.indexOf(document.activeElement as HTMLElement);
              if (i < 0) return;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
              else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(shown[i]); }
            }}>
              {shown.map((s) => <SnippetRow key={s.id} s={s} said={dictationOn} onOpen={() => setEditing(s)} />)}
            </ul>
          ) : (
            <div className="snip-none" role="status">
              <Icon name="search" size={28} stroke={1.4} />
              <div className="empty-title">No snippet matches “{q.trim()}”</div>
              <div className="btn-row">
                <button className="btn sm" onClick={() => setQ('')}>Clear search</button>
                <button className="btn sm primary" onClick={() => setEditing({ abbr: /\s/.test(q.trim()) ? '' : q.trim() })}>New snippet</button>
              </div>
            </div>
          )}
          <div className="snip-foot small muted">
            <span>On this computer · Keys still reach your apps · Nothing you type is kept</span>
            <span><kbd>N</kbd> new · <kbd>/</kbd> search · <kbd>Delete</kbd> remove</span>
          </div>
        </>
      ) : (
        <EmptySnippets onNew={() => setEditing({})} onImport={importCsv} onAdd={addStarter} />
      )}

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={moreItems} label="More" onClose={() => setMenu(null)} /> : null}
      {editing ? <Editor key={editing.id ?? 'new'} start={editing} all={all} said={dictationOn} onClose={() => setEditing(null)} onSave={(s, isNew) => void save({ snippets: isNew ? [...all, s] : all.map((x) => (x.id === s.id ? s : x)) }).then(() => toast(isNew ? `Type ${s.abbr ?? s.trigger} anywhere` : 'Snippet saved'))} onRemove={remove} /> : null}
      {sheet === 'status' && status ? <StatusSheet status={status} tone={tone ?? 'off'} onClose={() => setSheet(null)} onRetry={() => void api.snippets.restart().then(loadStatus)} onSettings={() => { setSheet(null); go({ name: 'settings', arg: 'features' }); }} /> : null}
      {sheet === 'apps' ? <AppsSheet list={exclude} onChange={(list) => void updateSettings({ typing: { ...(settings?.typing ?? { excludeApps: [] }), excludeApps: list } })} onClose={() => setSheet(null)} onDictation={() => { setSheet(null); go({ name: 'dictation', arg: 'apps' }); }} /> : null}
    </div>
  );
}

/** One snippet: its abbreviation, the start of its text, what to say and how often it was used. */
function SnippetRow({ s, said, onOpen }: { s: Snippet; said: boolean; onOpen: () => void }) {
  const lines = s.text.split('\n').filter((l) => l.trim());
  const first = lines[0] ?? s.text;
  const rest = lines.length > 1 ? lines.slice(1).join(' · ') : '';
  const uses = s.uses ?? 0;
  return (
    <li>
      <button className="snip-row" onClick={onOpen} aria-label={`${s.abbr ?? s.trigger}: ${first}. ${uses ? `Used ${uses} times.` : 'Not used yet.'} Press Enter to edit.`} data-testid="snippet-row">
        <span className="snip-abbr">{s.abbr ? <code>{s.abbr}</code> : <span className="snip-said"><Icon name="mic" size={12} /> said</span>}</span>
        <span className="snip-body">
          <span className="snip-first"><Tokens text={first} /></span>
          {rest || (said && s.trigger) ? (
            <span className="snip-second small muted">
              {rest ? <span className="snip-rest"><Tokens text={rest} /></span> : null}
              {said && s.trigger ? <span className="snip-say"><Icon name="mic" size={11} /> “{s.trigger}”</span> : null}
            </span>
          ) : null}
        </span>
        <span className="snip-uses small" title={uses ? `Typed ${uses} times` : 'Not typed yet'}>{uses ? <><b>{uses}</b> {uses === 1 ? 'use' : 'uses'}</> : <span className="muted">New</span>}</span>
        <span className="snip-edit small" aria-hidden><Icon name="rename" size={12} /> Edit</span>
      </button>
    </li>
  );
}

/** Text with its {placeholders} drawn as small chips. */
function Tokens({ text }: { text: string }) {
  const parts = text.split(/(\{[^{}]+\})/g);
  return <>{parts.map((p, i) => (/^\{[^{}]+\}$/.test(p) ? <span key={i} className="snip-token">{p.slice(1, -1)}</span> : p))}</>;
}

/** The first run: a picture, one line, three snippets to add in one click, and Import. */
function EmptySnippets({ onNew, onImport, onAdd }: { onNew: () => void; onImport: () => void; onAdd: (s: Starter) => void }) {
  return (
    <section className="snip-empty" data-testid="snippets-empty" aria-labelledby="snip-empty-title">
      <SnippetArt />
      <h2 id="snip-empty-title">Type less, write <em>more</em></h2>
      <p className="muted">Pick a short code like <code>;thx</code>. Type it anywhere and it turns into your text.</p>
      <ul className="snip-starters" aria-label="Snippets to start with">
        {STARTER_SNIPPETS.map((st) => (
          <li key={st.abbr} className="snip-starter">
            <code>{st.abbr}</code>
            <div className="snip-starter-label">{st.label}</div>
            <div className="small muted snip-starter-text"><Tokens text={st.text} /></div>
            <button className="btn sm" onClick={() => onAdd(st)} data-testid="snippet-starter" aria-label={`Add ${st.abbr}: ${st.label}`}><Icon name="plus" size={12} /> Add</button>
          </li>
        ))}
      </ul>
      <div className="btn-row snip-empty-actions">
        <button className="btn ghost" onClick={onNew}><Icon name="rename" size={13} /> Write your own</button>
        <button className="btn ghost" onClick={onImport}><Icon name="down" size={13} /> Import from CSV…</button>
      </div>
    </section>
  );
}

/** A key with a short code turning into a card of text, in the theme's own colours. */
function SnippetArt() {
  return (
    <svg className="snip-art" viewBox="0 0 220 92" role="img" aria-label="A short code turning into a full sentence">
      <rect x="6" y="24" width="64" height="52" rx="12" className="art-key" />
      <rect x="6" y="18" width="64" height="52" rx="12" className="art-keytop" />
      <text x="38" y="49" textAnchor="middle" className="art-code">;thx</text>
      <path d="M82 46 h26" className="art-arrow" />
      <path d="M102 40 l7 6 l-7 6" className="art-arrow" />
      <rect x="120" y="10" width="94" height="72" rx="12" className="art-card" />
      <rect x="133" y="25" width="58" height="7" rx="3.5" className="art-line strong" />
      <rect x="133" y="40" width="68" height="7" rx="3.5" className="art-line" />
      <rect x="133" y="55" width="40" height="7" rx="3.5" className="art-line" />
      <rect x="178" y="53" width="2" height="11" rx="1" className="art-caret" />
    </svg>
  );
}

/** The editor sheet: what to type, what it becomes (with placeholder chips and a live preview), and what to say. */
function Editor({ start, all, said, onClose, onSave, onRemove }: { start: Partial<Snippet>; all: Snippet[]; said: boolean; onClose: () => void; onSave: (s: Snippet, isNew: boolean) => void; onRemove: (s: Snippet) => void }) {
  const isNew = !start.id;
  const [abbr, setAbbr] = useState(start.abbr ?? '');
  const [text, setText] = useState(start.text ?? '');
  const [say, setSay] = useState(start.trigger ?? '');
  const [preview, setPreview] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = setTimeout(() => void api.snippets.preview(text).then(setPreview).catch(() => setPreview(text)), 150);
    return () => clearTimeout(t);
  }, [text]);

  const a = abbr.trim();
  const taken = !!a && all.some((s) => s.abbr === a && s.id !== start.id);
  const bad = !!a && !validAbbr(a);
  const canSave = !!text && ((validAbbr(a) && !taken) || (!a && !!say.trim()));
  const help = taken ? 'Another snippet already uses this.' : bad ? 'Use 2 to 32 characters, no spaces.' : 'Start with ; or / so it never fires inside a word.';
  const submit = () => {
    if (!canSave) return;
    onSave({ ...(start as Snippet), id: start.id ?? uid(), abbr: a || undefined, text, trigger: say.trim() }, isNew);
    onClose();
  };
  const insert = (token: string) => {
    const el = box.current;
    const r = insertPlaceholder(text, el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length, token);
    setText(r.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.at, r.at); });
  };

  return (
    <Modal sheet title={isNew ? 'New snippet' : 'Edit snippet'} onClose={onClose} testId="snippet-form">
      <form className="snip-editor" onSubmit={(e) => { e.preventDefault(); submit(); }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}>
        <div className="snip-field">
          <label htmlFor="snip-abbr">Type</label>
          <input id="snip-abbr" className="input snip-abbr-input" autoFocus placeholder=";addr" value={abbr} onChange={(e) => setAbbr(e.target.value.replace(/\s/g, ''))} aria-describedby="snip-abbr-help" aria-invalid={taken || bad} data-testid="snippet-abbr" spellCheck={false} />
          <div id="snip-abbr-help" className={`small ${taken || bad ? 'snip-bad' : 'muted'}`}>{help}</div>
        </div>
        <div className="snip-field">
          <label htmlFor="snip-text">Becomes</label>
          <textarea id="snip-text" ref={box} className="input" placeholder={'12 High Street\nLondon'} value={text} onChange={(e) => setText(e.target.value)} data-testid="snippet-text" />
          <div className="snip-chips" role="group" aria-label="Add a placeholder">
            {CHIPS.map((c) => <button type="button" key={c.token} className="snip-chip" title={`${c.hint}: ${c.token}`} onClick={() => insert(c.token)}><Icon name="plus" size={10} /> {c.label}</button>)}
          </div>
        </div>
        <div className="snip-field">
          <span className="snip-label" id="snip-preview-label">Preview</span>
          <div className="snip-preview" aria-live="polite" aria-labelledby="snip-preview-label" data-testid="snippet-preview">{text ? preview || ' ' : <span className="muted">Your text shows here, with the date and clipboard filled in.</span>}</div>
          {text.includes('{cursor}') ? <div className="small muted">After typing, the cursor waits at the Cursor mark.</div> : null}
        </div>
        {said ? (
          <div className="snip-field">
            <label htmlFor="snip-say">Or say <span className="muted">(optional)</span></label>
            <input id="snip-say" className="input" placeholder="my address" value={say} onChange={(e) => setSay(e.target.value)} />
            <div className="small muted">Dictation types it when you say this.</div>
          </div>
        ) : null}
        <div className="snip-editor-foot">
          {!isNew ? <button type="button" className="btn ghost snip-remove" onClick={() => { onRemove(start as Snippet); onClose(); }}><Icon name="trash" size={13} /> Remove</button> : null}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!canSave} data-testid="snippet-save" title={`Save (${mod}Enter)`}>{isNew ? 'Add snippet' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Behind the pill: is it listening, and the steps to let it when not. */
function StatusSheet({ status, tone, onClose, onRetry, onSettings }: { status: Status; tone: Tone; onClose: () => void; onRetry: () => void; onSettings: () => void }) {
  const mac = status.platform === 'darwin';
  const steps = mac
    ? ['Open Input Monitoring in System Settings.', 'Switch on Keeper.', 'Come back and press Try again.']
    : status.platform === 'win32'
      ? [status.note ?? 'Close other keyboard tools that may block it.', 'Press Try again.']
      : [status.note ?? 'Install xinput, or join the “input” group.', 'Sign out and back in.', 'Come back and press Try again.'];
  return (
    <Modal sheet title={tone === 'ok' ? 'Listening' : tone === 'warn' ? 'Not listening yet' : 'Typed snippets are off'} onClose={onClose} testId="snippets-status-sheet">
      <div className="snip-status-sheet">
        <div className={`snip-state ${tone}`} role="status">
          <Icon name={tone === 'ok' ? 'check' : tone === 'warn' ? 'warning' : 'info'} size={16} />
          <span>{tone === 'ok' ? `Ready in every app (${status.how}).` : tone === 'warn' ? 'Keeper can’t read the keyboard on this computer yet.' : 'Switch it on in Settings → Features.'}</span>
        </div>
        {tone === 'warn' ? (
          <section>
            <h3 className="snip-kicker">How to fix it</h3>
            <ol className="snip-steps">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
            <div className="btn-row">
              {mac ? <button className="btn" onClick={() => void api.permissions.openSettings('input')}>Open Input Monitoring</button> : null}
              <button className="btn primary" onClick={onRetry} data-testid="snippets-retry"><Icon name="refresh" size={13} /> Try again</button>
            </div>
          </section>
        ) : tone === 'off' ? <div className="btn-row"><button className="btn primary" onClick={onSettings}>Open Features</button></div> : null}
        <section>
          <h3 className="snip-kicker">Your privacy</h3>
          <p className="small">Keys still reach your apps · Nothing you type is kept · Password fields are skipped{mac ? ' (macOS hides them too)' : ''}</p>
          <p className="small muted">Works on macOS, Windows and Linux. On Linux with Wayland, join the “input” group.</p>
        </section>
      </div>
    </Modal>
  );
}

/** Under More: apps where snippets never expand. */
function AppsSheet({ list, onChange, onClose, onDictation }: { list: string[]; onChange: (l: string[]) => void; onClose: () => void; onDictation: () => void }) {
  const [name, setName] = useState('');
  const add = () => { const n = name.trim(); if (n && !list.includes(n)) onChange([...list, n]); setName(''); };
  return (
    <Modal sheet title="Apps left out" onClose={onClose} testId="snippets-exclude">
      <div className="snip-apps">
        <p className="small muted">Snippets never expand in these apps.</p>
        <form className="snip-apps-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input className="input" autoFocus placeholder="App name, like Terminal" aria-label="App to leave out" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" type="submit" disabled={!name.trim()}>Leave out</button>
        </form>
        {list.length ? (
          <ul className="snip-apps-list">
            {list.map((a) => (
              <li key={a}><span className="grow">{a}</span><button className="btn icon sm ghost" aria-label={`Remove ${a}`} title={`Remove ${a}`} onClick={() => onChange(list.filter((x) => x !== a))}><Icon name="close" size={12} /></button></li>
            ))}
          </ul>
        ) : <div className="small muted snip-apps-none">No apps left out.</div>}
        <button className="btn ghost sm snip-apps-link" onClick={onDictation}>Apps Dictation leaves out are skipped too <Icon name="chevronRight" size={11} /></button>
      </div>
    </Modal>
  );
}
