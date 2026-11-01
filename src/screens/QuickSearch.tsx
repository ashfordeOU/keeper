// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quick Search: the small panel that opens from any app with a global shortcut.

import { useEffect, useRef, useState } from 'react';
import { formatBytes, relativeTime } from '../../core/format';
import type { FileEntry, ParsedQuery } from '../../core/types';
import type { Cue } from '../../core/cues/model';
import { describeAnchor } from '../../core/cues/model';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Thumb } from '../components/ui';
import { isMac } from '../state';
import '../styles/screens-a.css';

export function QuickSearch() {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  // Cues matching the words (they are found by search too).
  const [cues, setCues] = useState<Cue[]>([]);
  const [index, setIndex] = useState(0);
  // "ask" turns Enter into a question for Keeper's assistant; Tab switches.
  const [mode, setMode] = useState<'find' | 'ask'>('find');
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

  useEffect(() => setIndex(0), [files]);
  useEffect(() => { list.current?.querySelector('.q-row.on')?.scrollIntoView({ block: 'nearest' }); }, [index]);

  const act = (f: FileEntry | undefined, e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => {
    if (!f) return;
    if (e.altKey) void api.files.reveal(f.path);
    else if (e.metaKey || e.ctrlKey) void api.system.openExternal(`keeper://open?path=${encodeURIComponent(f.path)}`);
    else void api.files.open(f.path);
    window.close();
  };

  const cmd = isMac ? '⌘' : 'Ctrl';
  const alt = isMac ? '⌥' : 'Alt';

  return (
    <div className="quick">
      <div className="q-input">
        <Icon name={mode === 'ask' ? 'sparkle' : 'search'} size={20} />
        <input
          ref={input}
          autoFocus
          value={text}
          placeholder={mode === 'ask' ? 'Ask about your files…' : 'Find any file…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { if (text) setText(''); else if (mode === 'ask') setMode('find'); else window.close(); }
            else if (e.key === 'Tab') { e.preventDefault(); setMode(mode === 'ask' ? 'find' : 'ask'); }
            else if (e.key === 'Enter' && mode === 'ask' && text.trim()) { void api.platform.ask(text.trim()); window.close(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(files.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') act(files[index], e);
          }}
        />
      </div>
      {parsed?.chips.length ? (
        <div className="chips" style={{ padding: '8px 14px 0' }}>
          {parsed.chips.map((c, i) => <span key={i} className="chip" style={{ paddingRight: 10 }}>{c.label}</span>)}
        </div>
      ) : null}
      <div className="q-results" ref={list}>
        {mode === 'ask' ? (
          <div className="q-row on" onClick={() => { if (text.trim()) { void api.platform.ask(text.trim()); window.close(); } }}>
            <Icon name="sparkle" size={18} />
            <div className="grow ellipsis" style={{ fontWeight: 550 }}>{text.trim() ? `Ask Keeper: “${text.trim()}”` : 'Type a question, for example “when does my passport expire?”'}</div>
          </div>
        ) : null}
        {mode === 'find' && cues.length ? (
          <>
            <div className="small muted" style={{ padding: '4px 10px' }}>Cues</div>
            {cues.map((c) => (
              <div key={c.id} className="q-row" data-testid="quick-cue" onClick={() => { void api.cues.openPage(c.id); window.close(); }}>
                <div style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--bg-sunk)', display: 'grid', placeItems: 'center', flex: 'none', color: '#ff9f0a' }}><Icon name="pin" size={16} /></div>
                <div className="grow">
                  <div className="ellipsis" style={{ fontWeight: 550 }}>{c.title}</div>
                  <div className="small muted ellipsis">{c.anchors.map(describeAnchor).join(' · ') || c.body.split('\n')[0] || 'Cue'}</div>
                </div>
              </div>
            ))}
            <div className="small muted" style={{ padding: '4px 10px' }}>Files</div>
          </>
        ) : null}
        {!text ? <div className="small muted" style={{ padding: '4px 10px' }}>Recent</div> : null}
        {files.map((f, i) => (
          <div key={f.path} className={`q-row ${mode === 'find' && i === index ? 'on' : ''}`} onMouseEnter={() => setIndex(i)} onClick={(e) => act(f, e)}
            draggable onDragStart={(e) => { e.preventDefault(); api.files.startDrag([f.path]); }}>
            <div style={{ width: 30, height: 30, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-sunk)', display: 'grid', placeItems: 'center', flex: 'none' }}><Thumb file={f} size={64} /></div>
            <div className="grow">
              <div className="ellipsis" style={{ fontWeight: 550 }}>{f.name}</div>
              <div className="small muted ellipsis">{formatBytes(f.size)} · {relativeTime(f.mtime)}{f.source ? ` · ${f.source.name}` : ''} · {f.path}</div>
            </div>
          </div>
        ))}
        {text && !files.length ? <div className="empty small">No matches</div> : null}
      </div>
      <div className="q-foot">{mode === 'ask' ? <span>↩ ask</span> : null}<span>⇥ {mode === 'ask' ? 'find files' : 'ask instead'}</span>{mode === 'find' ? <span>↩ open</span> : null}<span>{cmd}↩ show in Keeper</span><span>{alt}↩ show in folder</span><span>esc close</span></div>
    </div>
  );
}
