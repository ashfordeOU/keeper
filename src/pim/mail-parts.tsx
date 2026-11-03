// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Pieces of the Mail page: sender pictures (contacts on this computer, a known
// brand's colour, or initials), the warning banner for mail pretending to be
// someone else, the sign-in code banner, Quick Look for attachments, the
// conversation as chat bubbles with a reply box, search filter chips, and
// answers with their sources linked.

import { useEffect, useRef, useState } from 'react';
import type { OpenMessage } from '../../core/api-pim';
import { citationParts } from '../../core/pim/mail-ai';
import { describeQuery, hasFilters, parseMailQuery } from '../../core/pim/search';
import { bubbleText, remindChoices, senderLook } from '../../core/pim/smart';
import type { Account, Address, MessageSummary } from '../../core/pim/types';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';
import { useStore } from '../state';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

// ---------------------------------------------------------------- sender pictures

const photoCache = new Map<string, string | null>();
const waiting = new Set<string>();
let batch: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Contact photos, asked for in small batches; null once known to have none. */
function wantPhoto(address: string) {
  const a = address.toLowerCase();
  if (photoCache.has(a) || waiting.has(a)) return;
  waiting.add(a);
  batch ??= new Promise<void>((r) => setTimeout(r, 60)).then(async () => {
    const list = [...waiting];
    waiting.clear();
    batch = null;
    const got = await api.pim.senderPhotos(list).catch(() => ({} as Record<string, string>));
    for (const x of list) photoCache.set(x, got[x] ?? null);
    for (const l of listeners) l();
  });
}

export function SenderAvatar({ from, size = 34 }: { from?: Address; size?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((x) => x + 1);
    listeners.add(l);
    if (from?.address) wantPhoto(from.address);
    return () => { listeners.delete(l); };
  }, [from?.address]);
  const photos: Record<string, string> = {};
  const p = from?.address ? photoCache.get(from.address.toLowerCase()) : undefined;
  if (p && from) photos[from.address.toLowerCase()] = p;
  const look = senderLook(from, photos);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (look.kind === 'photo') return <img className="avatar photo" src={look.src} alt="" style={style} />;
  if (look.kind === 'brand') return <div className="avatar" title={look.name} style={{ ...style, background: look.color }}>{look.letter}</div>;
  return <div className="avatar" style={{ ...style, background: `hsl(${look.hue} 55% 52%)` }}>{look.letter}</div>;
}

/** An account's picture, or its colour as a dot. */
export function AccountMark({ a, size = 14 }: { a?: Account; size?: number }) {
  if (a?.picture) return <img className="acct-pic" src={a.picture} alt="" style={{ width: size, height: size }} />;
  return <i className="acct-dot" style={{ background: a?.color ?? 'var(--accent)', width: size * 0.55, height: size * 0.55 }} />;
}

// ---------------------------------------------------------------- warnings and codes

export function PhishBanner({ msg, onDone }: { msg: OpenMessage; onDone: () => void }) {
  const { toast } = useStore();
  const w = msg.warnings ?? [];
  if (!w.length) return null;
  const sender = msg.summary.from?.address;
  return (
    <div className={`banner ${w.some((x) => x.level === 2) ? 'danger' : 'warn'} phish-banner`} role="alert" data-testid="mail-phish">
      <Icon name="shield" size={15} />
      <div className="grow">
        <b>Be careful with this message.</b>
        <ul>{w.map((x) => <li key={x.kind}>{x.message}</li>)}</ul>
        <div className="small muted">Don’t open its links or attachments, or reply with personal details, unless you are sure who sent it.</div>
      </div>
      <div className="col" style={{ gap: 4 }}>
        <button className="btn sm danger" onClick={() => void api.pim.reportSpam([msg.summary.id]).then(() => { toast('Reported as spam and blocked'); onDone(); }, (e) => toast(errText(e)))}>Report spam</button>
        {sender ? <button className="btn sm ghost" onClick={() => void api.pim.block(sender, true).then(() => { toast(`Blocked ${sender}`); onDone(); }, (e) => toast(errText(e)))}>Block sender</button> : null}
      </div>
    </div>
  );
}

export function CodeBanner({ msg }: { msg: OpenMessage }) {
  const { toast } = useStore();
  if (!msg.code && !msg.signInLink) return null;
  return (
    <div className="banner subtle code-banner" data-testid="mail-code">
      <Icon name="key" size={14} />
      {msg.code ? <><span className="grow">Sign-in code <b className="num code">{msg.code}</b></span><button className="btn sm primary" onClick={() => { void navigator.clipboard.writeText(msg.code!); toast('Code copied'); }}>Copy code</button></>
        : <><span className="grow ellipsis">Sign-in link from {new URL(msg.signInLink!).hostname}</span><button className="btn sm primary" onClick={() => void api.system.openExternal(msg.signInLink!)}>Open link</button></>}
    </div>
  );
}

// ---------------------------------------------------------------- Quick Look

export function QuickLook({ id, att, onClose }: { id: string; att: string; onClose: () => void }) {
  const [p, setP] = useState<Awaited<ReturnType<typeof api.pim.previewAttachment>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void api.pim.previewAttachment(id, att).then(setP, (e) => setErr(errText(e))); }, [id, att]);
  const url = p?.data ? `data:${/pdf/i.test(p.contentType) || /\.pdf$/i.test(p.filename) ? 'application/pdf' : p.contentType};base64,${p.data}` : undefined;
  return (
    <Modal title={p?.filename ?? 'Attachment'} onClose={onClose} width={860}>
      <div className="quicklook" data-testid="mail-quicklook" onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); onClose(); } }}>
        {err ? <div className="banner warn">{err}</div> : !p ? <div className="spinner" />
          : url && /^image\//.test(p.contentType) ? <img src={url} alt={p.filename} />
            : url ? <iframe title={p.filename} src={url} sandbox="" />
              : p.text !== undefined ? <pre>{p.text}</pre>
                : <div className="muted">No preview for this kind of file ({formatBytes(p.size)}). Open it with its app instead.</div>}
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => void api.pim.openAttachment(id, att)}><Icon name="external" size={13} /> Open</button>
        <button className="btn primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- chat view

/** The conversation as bubbles (your messages on the right), with a reply box under it. */
export function ChatThread({ msgs, mine, onSent, onFull }: { msgs: MessageSummary[]; mine: Set<string>; onSent: () => void; onFull: (id: string, body: string) => void }) {
  const { toast } = useStore();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const m of msgs.slice(-30)) {
        const o = await api.pim.open(m.id, { markRead: m === msgs[msgs.length - 1] }).catch(() => null);
        if (!alive) return;
        setTexts((t) => ({ ...t, [m.id]: bubbleText(o?.text ?? m.snippet) || m.snippet }));
      }
    })();
    return () => { alive = false; };
  }, [msgs.map((m) => m.id).join()]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [texts]);
  const last = msgs[msgs.length - 1];
  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      const d = await api.pim.draftFor(last.id, 'reply');
      await api.pim.send({ ...d, account: last.account, body: reply, markdown: true });
      setReply('');
      onSent();
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="chat-thread" data-testid="mail-chat">
      {msgs.map((m) => {
        const me = !!m.from && mine.has(m.from.address.toLowerCase());
        return (
          <div key={m.id} className={`bubble-row ${me ? 'me' : ''}`}>
            {!me ? <SenderAvatar from={m.from} size={28} /> : null}
            <div className={`bubble ${me ? 'me' : ''}`}>
              {!me ? <div className="bubble-from">{m.from?.name || m.from?.address}</div> : null}
              <div className="bubble-text">{texts[m.id] ?? m.snippet}</div>
              <div className="bubble-time">{new Date(m.date).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}{m.hasAttachments ? ' · attachment' : ''}</div>
            </div>
          </div>
        );
      })}
      <div ref={end} />
      <div className="chat-reply">
        <textarea className="input" rows={2} placeholder={`Reply to ${last.from?.name || last.from?.address || ''}…`} value={reply} aria-label="Reply" onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }} />
        <div className="col" style={{ gap: 4 }}>
          <button className="btn sm primary" disabled={busy || !reply.trim()} onClick={() => void send()} data-testid="mail-chat-send"><Icon name="send" size={12} /> Send</button>
          <button className="btn sm ghost" title="Open in the full editor" onClick={() => onFull(last.id, reply)}><Icon name="external" size={12} /></button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- search chips and answers

export function SearchChips({ query, onSave }: { query: string; onSave: () => void }) {
  const q = parseMailQuery(query);
  if (!hasFilters(q)) return null;
  return (
    <div className="search-chips" data-testid="mail-search-chips">
      {describeQuery(q).map((c) => <span key={c} className="label-chip">{c}</span>)}
      <button className="btn sm ghost" title="Keep this search as a smart mailbox" onClick={onSave}><Icon name="pin" size={12} /> Save</button>
    </div>
  );
}

export function CitedAnswer({ answer, sources, onOpen }: { answer: string; sources: MessageSummary[]; onOpen: (id: string) => void }) {
  return (
    <div className="ai-text">
      {citationParts(answer, sources.length).map((p, i) => ('text' in p ? <span key={i}>{p.text}</span>
        : <button key={i} className="cite" title={sources[p.cite - 1]?.subject} onClick={() => onOpen(sources[p.cite - 1].id)} data-testid="mail-cite">{p.cite}</button>))}
    </div>
  );
}

/** "Remind me if no reply": 1 day, 3 days, a week, or a date. */
export function remindMenu(now: number, run: (at: number | null) => void, current?: number) {
  return [
    ...remindChoices(now).map((c) => ({ label: `Remind me ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)} if no reply`, icon: 'alarm', run: () => run(c.at) })),
    { label: 'Remind me on a date…', icon: 'calendar', run: () => {
      const v = window.prompt('Remind me if there is no reply by (YYYY-MM-DD)', new Date(now + 5 * 86_400_000).toISOString().slice(0, 10));
      const t = v ? new Date(`${v}T09:00`).getTime() : NaN;
      if (Number.isFinite(t) && t > now) run(t);
    } },
    ...(current ? [{ label: 'Cancel the reminder', icon: 'close', run: () => run(null) }] : []),
  ];
}
