// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quick Search: the small panel that opens from any app with a global shortcut.
// As a launcher first (core/launcher): the answer to a sum or conversion, then
// apps, Keeper's actions, saved links and your own commands, ranked with what
// you open most; then files, cues, mail, events, tasks, contacts, notes,
// Keeper's features and system settings, as one list for the arrow keys.

import { useEffect, useRef, useState } from 'react';
import { formatBytes, relativeTime } from '../../core/format';
import type { FileEntry, ParsedQuery } from '../../core/types';
import type { Cue } from '../../core/cues/model';
import { describeAnchor } from '../../core/cues/model';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Thumb } from '../components/ui';
import { EVERYTHING_LABEL as EVERY_LABEL_ALL } from '../../core/search-everything';

/** Each launcher row says what it is: "App", "Saved link"… */
const EVERY_LABEL: Record<string, string> = { ...EVERY_LABEL_ALL, app: 'App', action: 'Keeper', link: 'Saved link', command: 'Your command' };
import { isMac } from '../state';
import { hitLine, HitIcon } from '../components/Everything';
import { LAUNCH_KINDS, topLaunchHits, type EverythingHit, type EverythingResult } from '../../core/search-everything';
import '../styles/screens-a.css';
import '../styles/launcher.css';

/** Everything for these words, launcher rows included; empty while nothing is typed. */
function useQuickEverything(q: string, delay: number): EverythingResult | null {
  const [r, setR] = useState<EverythingResult | null>(null);
  useEffect(() => {
    if (!api.search) { setR(null); return; }
    let alive = true;
    // Nothing typed: what you ran last, to do again with Enter ("Do again").
    if (!q.trim()) { void api.search.everything('', { launch: true, recent: true }).then((x) => { if (alive) setR(x); }, () => undefined); return () => { alive = false; }; }
    const t = setTimeout(() => void api.search.everything(q, { limit: 5, launch: true }).then((x) => { if (alive) setR(x); }, () => undefined), delay);
    return () => { alive = false; clearTimeout(t); };
  }, [q, delay]);
  return r;
}

/** A launcher row's picture: the app's own, or an icon. */
function LaunchIcon({ h }: { h: EverythingHit }) {
  if (h.image) return <img className="ql-img" src={h.image} alt="" aria-hidden />;
  return <div className={`ev-icon ql-icon ql-${h.kind}`} aria-hidden><Icon name={h.icon ?? 'app'} size={16} /></div>;
}

export function QuickSearch() {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  // Cues matching the words (they are found by search too).
  const [cues, setCues] = useState<Cue[]>([]);
  const [index, setIndex] = useState(0);
  // "ask" turns Enter into a question for Keeper's assistant; Tab switches.
  const [mode, setMode] = useState<'find' | 'ask'>('find');
  const everything = useQuickEverything(mode === 'find' ? text : '', 90);
  // The launcher's rows on top (answer, apps, actions, links, commands, best first)…
  const launch: EverythingHit[] = topLaunchHits(everything?.groups.flatMap((g) => g.hits) ?? [], 8);
  // …and the rest below the files, in their groups.
  const elsewhere = everything ? { ...everything, groups: everything.groups.filter((g) => !LAUNCH_KINDS.includes(g.kind)) } : null;
  const hits: EverythingHit[] = elsewhere?.groups.flatMap((g) => g.hits) ?? [];
  const [note, setNote] = useState('');
  // One list for the arrow keys: launcher rows, files, then everything else.
  const L = mode === 'find' ? launch.length : 0;
  const total = L + files.length + hits.length;
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // The window is reused: refocus and reset whenever it is shown again.
  useEffect(() => {
    const onFocus = () => { input.current?.focus(); input.current?.select(); };
    window.addEventListener('focus', onFocus);
    const off = api.on('quick-mode' as 'navigate', ((m: unknown, q: unknown) => {
      setMode(m === 'ask' ? 'ask' : 'find');
      if (typeof q === 'string') setText(q);
    }) as never);
    return () => { window.removeEventListener('focus', onFocus); off(); };
  }, []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!text.trim()) {
        void api.library.recent(8).then((r) => { if (alive) { setFiles(r); setParsed(null); } });
        setCues([]);
      } else {
        void api.library.search(text, 30).then((r) => { if (alive) { setFiles(r.hits.map((h) => h.file)); setParsed(r.parsed); } });
        void api.cues?.list({ q: text }).then((r) => { if (alive) setCues(r.slice(0, 3)); }).catch(() => undefined);
      }
    }, text ? 80 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [text]);

  useEffect(() => setIndex(0), [files, text, launch.length]);
  useEffect(() => setNote(''), [text]);
  useEffect(() => { list.current?.querySelector('.q-row.on')?.scrollIntoView({ block: 'nearest' }); }, [index]);

  const openHit = (h: EverythingHit) => { void api.search.open(h.route); window.close(); };
  /** Enter on a launcher row: copy an answer, fill in a keyword, or open it (⌘/Ctrl: show an app in its folder). */
  const runLaunch = (h: EverythingHit, e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => {
    if (h.fill) { setText(h.fill); input.current?.focus(); return; }
    if (h.kind === 'answer') {
      if (h.copy) { void api.files.copyText(h.copy); window.close(); }
      else if (h.route) openHit(h);
      return;
    }
    const how = h.kind === 'app' && (e.metaKey || e.ctrlKey || e.altKey) ? 'reveal' : 'open';
    void api.search.launch(h.kind, h.id, h.query ?? '', how).then((r) => {
      if (r.ok) window.close();
      else if (r.message && r.message !== 'Not run') setNote(r.message);
    });
    // Commands ask first in a window of their own: Quick Search steps aside.
    if (h.kind !== 'command') window.close();
  };
  const act = (i: number, e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => {
    if (i < L) { runLaunch(launch[i], e); return; }
    const f = files[i - L];
    if (!f) { const h = hits[i - L - files.length]; if (h) openHit(h); return; }
    if (e.altKey) void api.files.reveal(f.path);
    else if (e.metaKey || e.ctrlKey) void api.system.openExternal(`keeper://open?path=${encodeURIComponent(f.path)}`);
    else void api.files.open(f.path);
    window.close();
  };

  const cmd = isMac ? '⌘' : 'Ctrl';
  const alt = isMac ? '⌥' : 'Alt';

  return (
    <div className="quick" role="dialog" aria-label="Quick Search">
      <div className="q-input">
        <Icon name={mode === 'ask' ? 'sparkle' : 'search'} size={20} />
        <input
          ref={input}
          autoFocus
          value={text}
          role="combobox"
          aria-label={mode === 'ask' ? 'Ask about your files (Tab switches to finding files)' : 'Find any file (Tab switches to asking)'}
          aria-expanded="true"
          aria-controls="quick-results"
          aria-activedescendant={mode === 'find' && index < total ? `quick-opt-${index}` : undefined}
          placeholder={mode === 'ask' ? 'Ask about your files…' : 'Open apps, do sums, find files, mail, notes…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { if (text) setText(''); else if (mode === 'ask') setMode('find'); else window.close(); }
            else if (e.key === 'Tab') { e.preventDefault(); setMode(mode === 'ask' ? 'find' : 'ask'); }
            else if (e.key === 'Enter' && mode === 'ask' && text.trim()) { void api.platform.ask(text.trim()); window.close(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(total - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') act(index, e);
          }}
        />
      </div>
      {parsed?.chips.length ? (
        <div className="chips" style={{ padding: '8px 14px 0' }}>
          {parsed.chips.map((c, i) => <span key={i} className="chip" style={{ paddingRight: 10 }}>{c.label}</span>)}
        </div>
      ) : null}
      <div className="q-results" ref={list} id="quick-results" role="listbox" aria-label={mode === 'ask' ? 'Ask' : 'Files'}>
        {mode === 'ask' ? (
          <div className="q-row on" role="option" aria-selected="true" onClick={() => { if (text.trim()) { void api.platform.ask(text.trim()); window.close(); } }}>
            <Icon name="sparkle" size={18} />
            <div className="grow ellipsis" style={{ fontWeight: 550 }}>{text.trim() ? `Ask Keeper: “${text.trim()}”` : 'Type a question, for example “when does my passport expire?”'}</div>
          </div>
        ) : null}
        {mode === 'find' && L ? (
          <div role="group" aria-label={text ? 'Top results' : 'Do again'} data-testid="quick-launch">
            {!text ? <div className="small muted" role="presentation" style={{ padding: '4px 10px' }}>Do again</div> : null}
            {launch.map((h, i) => (
              <div key={`${h.kind}:${h.id}`} id={`quick-opt-${i}`} role="option" aria-selected={i === index} data-kind={h.kind} data-testid={`quick-launch-${h.kind}`} className={`q-row ql-row ${h.kind === 'answer' ? 'ql-answer' : ''} ${i === index ? 'on' : ''}`} onMouseMove={() => { if (i !== index) setIndex(i); }} onClick={(e) => runLaunch(h, e)}>
                <LaunchIcon h={h} />
                <div className="grow">
                  <div className="ellipsis ql-title">{h.title}</div>
                  <div className="small muted ellipsis">{[h.kind === 'answer' ? '' : EVERY_LABEL[h.kind], h.detail].filter(Boolean).join(' · ')}</div>
                </div>
                {i === index ? <span className="ql-enter small" aria-hidden>{h.kind === 'answer' && h.copy ? 'Copy' : h.fill ? 'Type more' : h.kind === 'command' ? 'Run' : 'Open'} ↩</span> : null}
              </div>
            ))}
            {note ? <div className="small ql-note" role="status">{note}</div> : null}
          </div>
        ) : null}
        {mode === 'find' && files.length ? <div className="small muted" role="presentation" style={{ padding: '4px 10px' }}>{text ? 'Files' : 'Recent'}</div> : null}
        {files.map((f, k) => {
          const i = L + k;
          return (
          <div key={f.path} id={`quick-opt-${i}`} role="option" aria-selected={mode === 'find' && i === index} className={`q-row ${mode === 'find' && i === index ? 'on' : ''}`} onMouseMove={() => { if (i !== index) setIndex(i); }} onClick={(e) => act(i, e)}
            draggable onDragStart={(e) => { e.preventDefault(); api.files.startDrag([f.path]); }}>
            <div style={{ width: 30, height: 30, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-sunk)', display: 'grid', placeItems: 'center', flex: 'none' }}><Thumb file={f} size={64} /></div>
            <div className="grow">
              <div className="ellipsis" style={{ fontWeight: 550 }}>{f.name}</div>
              <div className="small muted ellipsis">{formatBytes(f.size)} · {relativeTime(f.mtime)}{f.source ? ` · ${f.source.name}` : ''} · {f.path}</div>
            </div>
          </div>
          );
        })}
        {mode === 'find' && cues.length ? (
          <>
            <div className="small muted" role="presentation" style={{ padding: '4px 10px' }}>Cues</div>
            {cues.map((c) => (
              <div key={c.id} className="q-row" role="option" aria-selected="false" data-testid="quick-cue" onClick={() => { void api.cues.openPage(c.id); window.close(); }}>
                <div style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--bg-sunk)', display: 'grid', placeItems: 'center', flex: 'none', color: '#ff9f0a' }}><Icon name="pin" size={16} /></div>
                <div className="grow">
                  <div className="ellipsis" style={{ fontWeight: 550 }}>{c.title}</div>
                  <div className="small muted ellipsis">{c.anchors.map(describeAnchor).join(' · ') || c.body.split('\n')[0] || 'Cue'}</div>
                </div>
              </div>
            ))}
          </>
        ) : null}
        {mode === 'find' ? elsewhere?.groups.map((g) => {
          const start = L + files.length + hits.indexOf(g.hits[0]);
          return (
            <div key={g.kind} role="group" aria-label={g.label} data-testid={`quick-${g.kind}`}>
              <div className="small muted" role="presentation" style={{ padding: '4px 10px' }}>{g.label}</div>
              {g.hits.map((h, j) => {
                const i = start + j;
                return (
                  <div key={`${h.kind}:${h.id}`} id={`quick-opt-${i}`} role="option" aria-selected={i === index} className={`q-row ${i === index ? 'on' : ''}`} onMouseMove={() => { if (i !== index) setIndex(i); }} onClick={() => openHit(h)}>
                    <HitIcon h={h} />
                    <div className="grow">
                      <div className="ellipsis" style={{ fontWeight: 550 }}>{h.title}</div>
                      <div className="small muted ellipsis">{hitLine(h)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }) : null}
        {text && !total && !cues.length ? <div className="empty small" role="status">No matches</div> : null}
        {note && !L ? <div className="small ql-note" role="status">{note}</div> : null}
      </div>
      <div className="q-foot">{mode === 'ask' ? <span>↩ ask</span> : null}<span>⇥ {mode === 'ask' ? 'find files' : 'ask instead'}</span>{mode === 'find' ? <span>↩ open</span> : null}<span>{cmd}↩ show in Keeper</span><span>{alt}↩ show in folder</span><span>esc close</span></div>
    </div>
  );
}
