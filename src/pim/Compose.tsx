// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Writing mail: address suggestions, Markdown (bold, lists, links) turned into
// a proper message, attachments by button or drag (also from Browse), send
// later, and a few seconds to undo after pressing Send.

import { marked } from 'marked';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Outbox } from '../../core/api-pim';
import { formatAddress, parseAddressList, type Draft } from '../../core/pim/mail';
import type { Account, Address } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, type MenuItem } from '../components/ui';
import { useStore } from '../state';

function AddressField({ label, value, onChange, autoFocus }: { label: string; value: Address[]; onChange: (a: Address[]) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [hints, setHints] = useState<Address[]>([]);
  const [hi, setHi] = useState(0);
  useEffect(() => {
    if (!text.trim()) { setHints([]); return; }
    let alive = true;
    void api.pim.suggest(text).then((h) => alive && (setHints(h.filter((x) => !value.some((v) => v.address === x.address))), setHi(0)));
    return () => { alive = false; };
  }, [text, value]);
  const commit = (a?: Address) => {
    const add = a ? [a] : parseAddressList(text);
    if (add.length) onChange([...value, ...add]);
    setText('');
    setHints([]);
  };
  return (
    <div className="compose-field">
      <span className="compose-label">{label}</span>
      <div className="compose-chips">
        {value.map((a, i) => (
          <span key={a.address + i} className="addr-chip" title={a.address}>{a.name || a.address}<button aria-label={`Remove ${a.address}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="close" size={10} /></button></span>
        ))}
        <input autoFocus={autoFocus} value={text} onChange={(e) => setText(e.target.value)} aria-label={label}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ',') && (hints.length || text.trim())) { if (text.trim() || hints.length) { e.preventDefault(); commit(hints[hi]); } }
            else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
            else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(hints.length - 1, h + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          }}
          onBlur={() => { if (text.includes('@')) commit(); }} />
      </div>
      {hints.length ? (
        <div className="addr-hints">
          {hints.map((h, i) => <button key={h.address} className={i === hi ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); commit(h); }}>{h.name ? <b>{h.name}</b> : null} <span className="muted">{h.address}</span></button>)}
        </div>
      ) : null}
    </div>
  );
}

export function Compose({ draft, accounts, onClose, onSent }: { draft: Draft & { account?: string }; accounts: Account[]; onClose: () => void; onSent: (o: Outbox) => void }) {
  const { toast, setDraft } = useStore();
  const ids = useMemo(() => accounts.flatMap((a) => (a.identities.length ? a.identities : [{ name: '', email: a.email ?? '' }]).map((i) => ({ account: a.id, ...i }))), [accounts]);
  const [from, setFrom] = useState(() => ids.find((i) => i.account === draft.account && (!draft.from || i.email === draft.from)) ?? ids[0]);
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [showCc, setShowCc] = useState(!!(draft.cc.length || draft.bcc.length));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [quoted, setQuoted] = useState(draft.quoted ?? '');
  const [showQuote, setShowQuote] = useState(false);
  const [preview, setPreview] = useState(false);
  const [files, setFiles] = useState<string[]>((draft.attachments ?? []).map((a) => a.path));
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [drag, setDrag] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (draft.to.length) bodyRef.current?.focus(); }, [draft.to.length]);

  // Kept with the tab (saved within a second), so a crash never loses what was typed.
  useEffect(() => {
    setDraft('mail.compose', JSON.stringify({ account: from?.account, from: from?.email, to, cc, bcc, subject, body, quoted: quoted || undefined, inReplyTo: draft.inReplyTo, references: draft.references, attachments: files.map((p) => ({ path: p })) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, cc, bcc, subject, body, quoted, files]);

  const build = (): Draft & { account: string } => ({ account: from.account, from: from.email, to, cc, bcc, subject, body, quoted: quoted || undefined, inReplyTo: draft.inReplyTo, references: draft.references, attachments: files.map((p) => ({ path: p })) });

  const send = async (sendAt?: number) => {
    if (!to.length && !cc.length && !bcc.length) { toast('Add someone to send it to'); return; }
    if (!subject.trim() && !window.confirm('Send without a subject?')) return;
    setSending(true);
    try {
      onSent(await api.pim.send({ ...build(), sendAt, markdown: true }));
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
      setSending(false);
    }
  };

  const later = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (h: number, add = 0) => { const d = new Date(); d.setDate(d.getDate() + add); d.setHours(h, 0, 0, 0); return d.getTime(); };
    setMenu({ x: r.left, y: r.top - 150, items: [
      { label: 'Tomorrow morning (8:00)', icon: 'clock', run: () => void send(t(8, 1)) },
      { label: 'Tomorrow afternoon (13:00)', icon: 'clock', run: () => void send(t(13, 1)) },
      { label: 'Monday morning', icon: 'calendar', run: () => { const d = new Date(); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); d.setHours(8, 0, 0, 0); void send(d.getTime()); } },
      { label: 'Save as draft', icon: 'rename', run: () => void api.pim.saveDraft(build()).then(() => { toast('Saved to Drafts'); onClose(); }) },
    ] });
  };

  return (
    <div className="compose-back" onMouseDown={onClose}>
      <div className={`compose ${drag ? 'drag' : ''}`} role="dialog" aria-label="New message" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } if (e.key === 'Escape') onClose(); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const p = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? '').filter(Boolean); if (p.length) setFiles([...files, ...p]); }}>
        <header className="compose-head">
          <b className="grow">{subject || (draft.inReplyTo ? 'Reply' : 'New message')}</b>
          <button className="btn sm ghost icon" title="Close (Esc)" onClick={onClose}><Icon name="close" size={13} /></button>
        </header>
        {ids.length > 1 ? (
          <div className="compose-field"><span className="compose-label">From</span>
            <select className="input" value={`${from.account}|${from.email}`} onChange={(e) => setFrom(ids.find((i) => `${i.account}|${i.email}` === e.target.value)!)}>
              {ids.map((i) => <option key={`${i.account}|${i.email}`} value={`${i.account}|${i.email}`}>{formatAddress({ name: i.name || undefined, address: i.email })}</option>)}
            </select>
          </div>
        ) : null}
        <AddressField label="To" value={to} onChange={setTo} autoFocus={!draft.to.length} />
        {showCc ? <><AddressField label="Cc" value={cc} onChange={setCc} /><AddressField label="Bcc" value={bcc} onChange={setBcc} /></> : <button className="link-like small" style={{ alignSelf: 'flex-end', margin: '-26px 12px 4px 0' }} onClick={() => setShowCc(true)}>Cc / Bcc</button>}
        <div className="compose-field"><span className="compose-label">Subject</span><input className="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" /></div>
        <div className="compose-body">
          {preview
            ? <div className="compose-preview" dangerouslySetInnerHTML={{ __html: (marked.parse(body || '*Nothing written yet*', { async: false, gfm: true, breaks: true }) as string).replace(/<(script|iframe|object|embed|style)[\s\S]*?<\/\1>/gi, '').replace(/\son\w+="[^"]*"/gi, '') }} />
            : <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message. **bold**, *italic*, - lists and [links](https://…) work." aria-label="Message" />}
          {quoted ? (
            <div className="compose-quote">
              <button className="link-like small" onClick={() => setShowQuote(!showQuote)}>{showQuote ? 'Hide' : 'Show'} quoted text</button>
              {showQuote ? <textarea value={quoted} onChange={(e) => setQuoted(e.target.value)} aria-label="Quoted text" /> : null}
            </div>
          ) : null}
        </div>
        {files.length ? (
          <div className="compose-files">
            {files.map((f) => <span key={f} className="addr-chip"><Icon name="paperclip" size={11} /> {f.split(/[\\/]/).pop()}<button aria-label="Remove attachment" onClick={() => setFiles(files.filter((x) => x !== f))}><Icon name="close" size={10} /></button></span>)}
          </div>
        ) : null}
        <footer className="compose-foot">
          <div className="btn-split">
            <button className="btn primary" disabled={sending} onClick={() => void send()}><Icon name="send" size={14} /> Send</button>
            <button className="btn primary icon" title="Send later or save as draft" onClick={later}><Icon name="chevronDown" size={13} /></button>
          </div>
          <button className="btn ghost sm" onClick={async () => { const p = await api.pim.pickFiles(); if (p.length) setFiles([...files, ...p]); }}><Icon name="paperclip" size={14} /> Attach</button>
          <button className={`btn ghost sm ${preview ? 'on' : ''}`} onClick={() => setPreview(!preview)}><Icon name="eye" size={14} /> {preview ? 'Edit' : 'Preview'}</button>
          <span className="grow" />
          <span className="small muted">⌘↩ / Ctrl+↩ to send</span>
        </footer>
        {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      </div>
    </div>
  );
}
