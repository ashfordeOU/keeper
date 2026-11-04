// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Writing mail: address suggestions, rich text (bold, italic, lists, sizes,
// links; Markdown typed as text still works), attachments by button or drag,
// the signature of the address you send from (optional on replies and
// removable here), send-from aliases, templates, AI help (⌘J tones, or your
// own instruction streamed into the message, with what the AI remembers about
// you), drafts kept with the window and mirrored to the server's Drafts
// folder, send later, remind if no reply, and a few seconds to undo.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Outbox } from '../../core/api-pim';
import { fillTemplate, htmlToText, textToEditorHtml } from '../../core/pim/compose-rich';
import { pickSignature, sanitizeSignature, signaturesOf, styleCss } from '../../core/pim/signatures';
import { formatAddress, parseAddressList, type Draft } from '../../core/pim/mail';
import { TONES } from '../../core/pim/mail-ai';
import type { PimPrefsView } from '../../core/pim/prefs';
import { sendLaterChoices } from '../../core/pim/triage';
import type { Account, Address } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, type MenuItem } from '../components/ui';
import { useStore } from '../state';
import { remindMenu } from './mail-parts';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

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

/** Does the editor hold formatting, or only text (where Markdown typed by hand is honoured)? */
const formatted = (html: string) => /<(b|strong|i|em|u|s|ul|ol|li|a|h[1-6]|blockquote)\b|font-size/i.test(html);
const markdownish = (t: string) => /\*\*[^*]+\*\*|(^|\s)\*[^*\s][^*]*\*|^\s*[-*] |\[[^\]]+\]\(https?:/m.test(t);

export type ComposeDraft = Draft & { account?: string; html?: string; key?: string; noSignature?: boolean; /** a signature picked in this window ('' = none) */ signatureId?: string; /** the message being answered (for the AI) */ replyOf?: string };

export function Compose({ draft, accounts, onClose, onSent }: { draft: ComposeDraft; accounts: Account[]; onClose: () => void; onSent: (o: Outbox) => void }) {
  const { toast, setDraft, info } = useStore();
  const mac = info?.platform === 'darwin';
  const ids = useMemo(() => accounts.flatMap((a) => (a.identities.length ? a.identities : [{ name: '', email: a.email ?? '' }]).map((i) => ({ account: a.id, ...i }))), [accounts]);
  const [from, setFrom] = useState(() => ids.find((i) => i.account === draft.account && (!draft.from || i.email === draft.from)) ?? ids.find((i) => i.account === draft.account) ?? ids[0]);
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [showCc, setShowCc] = useState(!!(draft.cc.length || draft.bcc.length));
  const [subject, setSubject] = useState(draft.subject);
  const [html, setHtml] = useState(() => draft.html ?? textToEditorHtml(draft.body));
  const [quoted, setQuoted] = useState(draft.quoted ?? '');
  const [showQuote, setShowQuote] = useState(false);
  const [files, setFiles] = useState<string[]>((draft.attachments ?? []).map((a) => a.path));
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [drag, setDrag] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiBar, setAiBar] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [undoHtml, setUndoHtml] = useState<string | null>(null);
  const [noSig, setNoSig] = useState(!!draft.noSignature);
  /** undefined: the address's default for this kind of message; '': none; else a signature's id */
  const [sigChoice, setSigChoice] = useState<string | undefined>(draft.signatureId);
  const [remindAt, setRemindAt] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<PimPrefsView | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const key = useMemo(() => draft.key ?? Math.random().toString(36).slice(2, 12), []);
  const editor = useRef<HTMLDivElement>(null);
  const aiInput = useRef<HTMLInputElement>(null);
  const acct = accounts.find((a) => a.id === from?.account);
  const ident = acct?.identities.find((i) => i.email === from?.email);
  const reply = !!(draft.inReplyTo || draft.forwardOf);
  const sigs = signaturesOf(ident);
  const autoSig = pickSignature(ident, draft.forwardOf ? 'forward' : reply ? 'reply' : 'new', acct?.signatureOnReplies !== false);
  const signature = noSig || sigChoice === '' ? undefined : sigChoice ? sigs.find((x) => x.id === sigChoice) ?? autoSig : autoSig;
  const editorStyle = useMemo(() => Object.fromEntries(styleCss(acct?.compose).split(';').filter(Boolean).map((d) => { const [k, ...v] = d.split(':'); return [k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()), v.join(':')]; })), [acct?.compose]);

  useEffect(() => { void api.pim.prefs().then(setPrefs); }, []);
  // The editor's content is set once (and after AI or a template); typing updates the state, not the other way round.
  useEffect(() => { if (editor.current && editor.current.innerHTML !== html) editor.current.innerHTML = html; }, [html]);
  useEffect(() => { if (draft.to.length) editor.current?.focus(); }, [draft.to.length]);
  const readEditor = () => editor.current?.innerHTML ?? html;

  const build = (): Draft & { account: string; html?: string; key: string; noSignature?: boolean; signatureId?: string } => {
    const h = readEditor();
    const text = htmlToText(h);
    // Markdown typed as text (**bold**, - lists, [links](…)) still becomes formatting.
    const md = !formatted(h) && markdownish(text);
    return { account: from.account, from: from.email, to, cc, bcc, subject, body: text, html: md ? undefined : h, quoted: quoted || undefined, inReplyTo: draft.inReplyTo, references: draft.references, attachments: files.map((p) => ({ path: p })), forwardOf: draft.forwardOf, key, noSignature: noSig || undefined, signatureId: noSig ? '' : sigChoice };
  };

  // Kept with the window at once (a crash never loses what was typed), and in the server's Drafts after a pause.
  const [edits, setEdits] = useState(0);
  useEffect(() => {
    const d = build();
    setDraft('mail.compose', JSON.stringify({ ...d }));
    if (!edits) return;
    const h = setTimeout(() => {
      if (!d.body.trim() && !d.subject.trim()) return;
      void api.pim.saveDraft(d).then(() => setSaved(Date.now()), () => undefined);
    }, 4000);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, cc, bcc, subject, edits, quoted, files, noSig, sigChoice]);

  // AI writing streams into the message.
  const streamReq = useRef<string | null>(null);
  const streamBase = useRef<{ html: string; mode: 'replace' | 'append' }>({ html: '', mode: 'replace' });
  useEffect(() => api.on('pim-ai-stream', (p: { req: string; text: string }) => {
    if (p.req !== streamReq.current || !editor.current) return;
    const add = textToEditorHtml(p.text);
    editor.current.innerHTML = streamBase.current.mode === 'append' && streamBase.current.html ? `${streamBase.current.html}<div><br></div>${add}` : add;
  }), []);
  const runAi = async (o: { tone?: string; instruction?: string }, label: string) => {
    const before = readEditor();
    const text = htmlToText(before);
    if (o.tone && !text.trim()) { toast('Write something first'); return; }
    const req = Math.random().toString(36).slice(2);
    streamReq.current = req;
    streamBase.current = { html: before, mode: o.instruction && text.trim() && !/rewrite|shorter|longer|tone|formal|friendl|translate/i.test(o.instruction) ? 'append' : 'replace' };
    setAiBusy(label);
    try {
      const out = await api.pim.aiCompose({ req, draft: text, tone: o.tone, instruction: o.instruction, replyTo: draft.replyOf });
      if (o.instruction && /^\s*remember\b/i.test(o.instruction)) { toast('Added to what the AI remembers (Settings → Mail & Calendar)'); if (editor.current) editor.current.innerHTML = before; return; }
      setUndoHtml(before);
      const next = streamBase.current.mode === 'append' && before.trim() ? `${before}<div><br></div>${textToEditorHtml(out)}` : textToEditorHtml(out);
      setHtml(next);
      if (editor.current) editor.current.innerHTML = next;
      setEdits((x) => x + 1);
    } catch (e) {
      if (editor.current) editor.current.innerHTML = before;
      toast(errText(e));
    } finally {
      streamReq.current = null;
      setAiBusy(null);
    }
  };
  const toneMenu = (x: number, y: number) => setMenu({ x, y, items: [
    ...TONES.map((t) => ({ label: t.label, icon: 'sparkle', run: () => void runAi({ tone: t.id }, t.label) })),
    { sep: true, label: '' },
    { label: 'Your own instruction…', icon: 'rename', run: () => { setAiBar(true); setTimeout(() => aiInput.current?.focus(), 0); } },
  ] });

  const templateMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const list = prefs?.templates ?? [];
    setMenu({ x: r.left, y: r.top - 40 - Math.max(1, list.length) * 30, items: list.length ? list.map((t) => ({ label: t.name, icon: 'document', run: () => {
      const v = { to: to[0], me: { name: from.name, address: from.email } };
      if (t.subject && !subject.trim()) setSubject(fillTemplate(t.subject, v));
      const add = textToEditorHtml(fillTemplate(t.body, v));
      const cur = readEditor();
      const next = htmlToText(cur).trim() ? `${cur}${add}` : add;
      setHtml(next);
      if (editor.current) editor.current.innerHTML = next;
      setEdits((x) => x + 1);
    } })) : [{ label: 'No templates yet: add them in Settings → Mail & Calendar', icon: 'info', run: () => undefined }] });
  };

  const exec = (cmd: string, arg?: string) => { editor.current?.focus(); document.execCommand(cmd, false, arg); setEdits((x) => x + 1); };
  const link = () => {
    const url = window.prompt('Link to', 'https://');
    if (url && /^(https?:|mailto:)/i.test(url)) exec('createLink', url);
  };

  const send = async (sendAt?: number) => {
    if (!to.length && !cc.length && !bcc.length) { toast('Add someone to send it to'); return; }
    if (!subject.trim() && !window.confirm('Send without a subject?')) return;
    setSending(true);
    try {
      const d = build();
      onSent(await api.pim.send({ ...d, sendAt, markdown: true, remindAt: remindAt ?? undefined }));
    } catch (e) {
      toast(errText(e));
      setSending(false);
    }
  };

  const later = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const choices = sendLaterChoices(Date.now());
    setMenu({ x: r.left, y: r.top - 40 - (choices.length + 7) * 30, items: [
      ...choices.map((c) => ({ label: `Send ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)}`, icon: 'clock', run: () => void send(c.at) })),
      { label: 'Send at…', icon: 'calendar', run: () => {
        const v = window.prompt('Send at (YYYY-MM-DD HH:MM)', new Date(Date.now() + 86_400_000).toISOString().slice(0, 16).replace('T', ' '));
        const t = v ? new Date(v.replace(' ', 'T')).getTime() : NaN;
        if (Number.isFinite(t) && t > Date.now()) void send(t); else if (v) toast('That time is not in the future');
      } },
      { sep: true, label: '' },
      ...remindMenu(Date.now(), (at) => { setRemindAt(at); if (at) toast(`If nobody answers by ${new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, Keeper reminds you`); }, remindAt ?? undefined),
      { sep: true, label: '' },
      { label: 'Save as draft', icon: 'rename', run: () => void api.pim.saveDraft(build()).then(() => { toast('Saved to Drafts'); onClose(); }, (x) => toast(errText(x))) },
    ] });
  };

  const discard = () => { void api.pim.dropDraft(key); onClose(); };

  return (
    <div className="compose-back" onMouseDown={onClose}>
      <div className={`compose ${drag ? 'drag' : ''}`} role="dialog" aria-label="New message" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey;
          if (mod && e.key === 'Enter') { e.preventDefault(); void send(); }
          else if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); const r = editor.current?.getBoundingClientRect(); toneMenu((r?.left ?? 200) + 20, (r?.top ?? 200) + 20); }
          else if (mod && e.key.toLowerCase() === 'k' && document.activeElement === editor.current) { e.preventDefault(); link(); }
          else if (e.key === 'Escape' && !menu) onClose();
        }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const p = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? '').filter(Boolean); if (p.length) setFiles([...files, ...p]); }}>
        <header className="compose-head">
          <b className="grow">{subject || (draft.inReplyTo ? 'Reply' : 'New message')}</b>
          {saved ? <span className="compose-saved" data-testid="compose-saved">Saved to Drafts {new Date(saved).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span> : null}
          <button className="btn sm ghost icon" title="Discard (also from Drafts)" aria-label="Discard" onClick={discard}><Icon name="trash" size={13} /></button>
          <button className="btn sm ghost icon" title="Close (Esc); the draft is kept" aria-label="Close (Esc)" onClick={onClose}><Icon name="close" size={13} /></button>
        </header>
        {ids.length > 1 ? (
          <div className="compose-field"><span className="compose-label">From</span>
            <select className="input" aria-label="From" value={`${from.account}|${from.email}`} onChange={(e) => setFrom(ids.find((i) => `${i.account}|${i.email}` === e.target.value)!)}>
              {ids.map((i) => <option key={`${i.account}|${i.email}`} value={`${i.account}|${i.email}`}>{formatAddress({ name: i.name || undefined, address: i.email })}{i.replyTo ? ` (replies to ${i.replyTo})` : ''}</option>)}
            </select>
          </div>
        ) : null}
        <AddressField label="To" value={to} onChange={setTo} autoFocus={!draft.to.length} />
        {showCc ? <><AddressField label="Cc" value={cc} onChange={setCc} /><AddressField label="Bcc" value={bcc} onChange={setBcc} /></> : <button className="link-like small" style={{ alignSelf: 'flex-end', margin: '-26px 12px 4px 0' }} onClick={() => setShowCc(true)}>Cc / Bcc</button>}
        <div className="compose-field"><span className="compose-label">Subject</span><input className="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" /></div>
        <div className="compose-toolbar" role="toolbar" aria-label="Formatting">
          <button className="btn sm ghost" title={`Bold (${mac ? '⌘' : 'Ctrl+'}B)`} aria-label="Bold" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }}><b>B</b></button>
          <button className="btn sm ghost" title={`Italic (${mac ? '⌘' : 'Ctrl+'}I)`} aria-label="Italic" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }}><i>I</i></button>
          <button className="btn sm ghost" title="Underline" aria-label="Underline" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }}><u>U</u></button>
          <button className="btn sm ghost" title="Bulleted list" aria-label="Bulleted list" onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }}><Icon name="list" size={13} /></button>
          <button className="btn sm ghost" title="Numbered list" aria-label="Numbered list" onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }}>1.</button>
          <select className="input sm" aria-label="Text size" defaultValue="3" onChange={(e) => { exec('fontSize', e.target.value); e.target.value = '3'; }}><option value="2">Small</option><option value="3">Normal</option><option value="5">Large</option><option value="6">Huge</option></select>
          <button className="btn sm ghost" title={`Link (${mac ? '⌘' : 'Ctrl+'}K)`} aria-label="Link" onMouseDown={(e) => { e.preventDefault(); link(); }}><Icon name="link" size={13} /></button>
          <button className="btn sm ghost" title="Clear formatting" aria-label="Clear formatting" onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }}><Icon name="close" size={12} /></button>
        </div>
        <div className="compose-body">
          <div ref={editor} className="compose-editor" style={editorStyle} contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label="Message" data-testid="compose-editor"
            data-placeholder={`Write your message. ${mac ? '⌘' : 'Ctrl+'}J for AI help.`} onInput={() => setEdits((x) => x + 1)}
            onPaste={(e) => {
              // Pasted pages bring their own styles: keep the text, or simple formatting.
              const h = e.clipboardData.getData('text/html');
              if (!h) return;
              e.preventDefault();
              document.execCommand('insertHTML', false, textToEditorHtml(htmlToText(h)));
            }} />
          {signature ? <div className="compose-signature small" title="Your signature for this address (Settings → Mail & Calendar)" data-testid="compose-signature"><span className="muted">-- </span><div dangerouslySetInnerHTML={{ __html: sanitizeSignature(signature.html) }} /></div> : null}
          {sigs.length ? (
            <div className="compose-sig-pick small muted">
              <label className="row" style={{ gap: 6 }}>Signature
                <select className="input xs" aria-label="Signature" data-testid="compose-sig-pick" value={noSig ? '' : sigChoice ?? 'auto'} onChange={(e) => { setNoSig(false); setSigChoice(e.target.value === 'auto' ? undefined : e.target.value); }}>
                  <option value="auto">{autoSig ? `${autoSig.name} (usual)` : 'None (usual)'}</option>
                  <option value="">None</option>
                  {sigs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            </div>
          ) : null}
          {quoted ? (
            <div className="compose-quote">
              <button className="link-like small" onClick={() => setShowQuote(!showQuote)}>{showQuote ? 'Hide' : 'Show'} quoted text</button>
              {showQuote ? <textarea value={quoted} onChange={(e) => setQuoted(e.target.value)} aria-label="Quoted text" /> : null}
            </div>
          ) : null}
        </div>
        {aiBar ? (
          <div className="compose-ai-bar">
            <Icon name="sparkle" size={13} />
            <input ref={aiInput} className="input" placeholder="Tell the AI what to write or change (“decline politely”, “remember that I sign as Ana”)" value={instruction} aria-label="AI instruction"
              onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && instruction.trim()) { e.preventDefault(); void runAi({ instruction }, 'Writing'); setInstruction(''); } if (e.key === 'Escape') { e.stopPropagation(); setAiBar(false); } }} />
            <button className="btn sm primary" disabled={!instruction.trim() || !!aiBusy} onClick={() => { void runAi({ instruction }, 'Writing'); setInstruction(''); }}>Write</button>
            <button className="btn sm ghost icon" aria-label="Close" onClick={() => setAiBar(false)}><Icon name="close" size={12} /></button>
          </div>
        ) : null}
        {files.length ? (
          <div className="compose-files">
            {files.map((f) => <span key={f} className="addr-chip"><Icon name="paperclip" size={11} /> {f.split(/[\\/]/).pop()}<button aria-label="Remove attachment" onClick={() => setFiles(files.filter((x) => x !== f))}><Icon name="close" size={10} /></button></span>)}
          </div>
        ) : null}
        <footer className="compose-foot">
          <div className="btn-split">
            <button className="btn primary" disabled={sending} onClick={() => void send()}><Icon name="send" size={14} /> Send</button>
            <button className="btn primary icon" title="Send later, remind me if no reply, or save as draft" aria-label="Send later, remind me if no reply, or save as draft" onClick={later}><Icon name="chevronDown" size={13} /></button>
          </div>
          <button className="btn ghost sm" onClick={async () => { const p = await api.pim.pickFiles(); if (p.length) setFiles([...files, ...p]); }}><Icon name="paperclip" size={14} /> Attach</button>
          <button className="btn ghost sm" onClick={templateMenu}><Icon name="document" size={14} /> Template</button>
          <button className="btn ghost sm" disabled={!!aiBusy} onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); toneMenu(r.left, r.top - 330); }} title={`Tones and your own instruction (${mac ? '⌘' : 'Ctrl+'}J)`} data-testid="compose-ai">{aiBusy ? <><div className="spinner" /> {aiBusy}…</> : <><Icon name="sparkle" size={14} /> AI</>}</button>
          {undoHtml !== null ? <button className="btn ghost sm" onClick={() => { setHtml(undoHtml); if (editor.current) editor.current.innerHTML = undoHtml; setUndoHtml(null); }}><Icon name="undo" size={13} /> Undo AI</button> : null}
          {remindAt ? <span className="pill" title="Remind me if no reply">Remind {new Date(remindAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span> : null}
          <span className="grow" />
          <span className="small muted">{mac ? '⌘↩' : 'Ctrl+↩'} to send</span>
        </footer>
        {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      </div>
    </div>
  );
}
