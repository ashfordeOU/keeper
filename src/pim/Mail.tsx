// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail: every inbox together or one folder at a time, conversations, a safe
// reading pane (remote pictures held back, links that show where they go),
// replies with Markdown, undo send, snooze, invitations and AI help.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MailView, OpenMessage, Outbox } from '../../core/api-pim';
import type { Draft } from '../../core/pim/mail';
import { formatAddress } from '../../core/pim/mail';
import type { Account, MailFolder, MessageSummary, Thread } from '../../core/pim/types';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, Empty, Modal, type MenuItem } from '../components/ui';
import { useStore } from '../state';
import { Compose } from './Compose';
import { AccountDialog } from './AccountDialog';
import '../styles/pim.css';

const FOLDER_ICON: Record<string, string> = { inbox: 'inbox', sent: 'send', drafts: 'rename', trash: 'trash', junk: 'warning', archive: 'archive', all: 'mail', flagged: 'flag' };

export function when(t: number): string {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - t < 6 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function usePimChanges(kinds: string[], fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => api.on('pim-changed', (k: string) => { if (kinds.includes(k)) ref.current(); }), [kinds.join()]);
}

export { usePimChanges };

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT');
};

function snoozeTimes(): { label: string; at: number }[] {
  const now = new Date();
  const later = new Date(now.getTime() + 3 * 3_600_000);
  const tonight = new Date(now);
  tonight.setHours(19, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  monday.setHours(8, 0, 0, 0);
  const out = [{ label: `Later today (${later.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })})`, at: later.getTime() }];
  if (tonight > now) out.push({ label: 'This evening', at: tonight.getTime() });
  out.push({ label: 'Tomorrow morning', at: tomorrow.getTime() }, { label: 'Next week', at: monday.getTime() });
  return out;
}

export function Mail() {
  const { toast, go, route, draft, setDraft } = useStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [view, setView] = useState<MailView>({ folder: 'unified', threaded: true, filter: 'all' });
  const [query, setQuery] = useState('');
  const [list, setList] = useState<{ messages: MessageSummary[]; threads?: Thread[] }>({ messages: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // A message being written comes back after a restart or a crash, with what was typed.
  const [compose, setComposeState] = useState<(Draft & { account?: string }) | null>(() => {
    try { const d = draft('mail.compose'); return d ? (JSON.parse(d) as Draft & { account?: string }) : null; } catch { return null; }
  });
  const setCompose = (d: (Draft & { account?: string }) | null) => { setComposeState(d); if (!d) setDraft('mail.compose', ''); };
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [outbox, setOutbox] = useState<Outbox[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadAccounts = useCallback(() => {
    void api.pim.accounts().then(setAccounts);
    void api.pim.folders().then(setFolders);
  }, []);
  const loadList = useCallback(() => {
    void api.pim.messages({ ...view, query: query.trim() || undefined }).then(setList);
  }, [view, query]);
  const loadOutbox = useCallback(() => void api.pim.outbox().then(setOutbox), []);

  useEffect(loadAccounts, [loadAccounts]);
  // "New Mail Message" from the command palette or a keeper:// link.
  useEffect(() => { if (route.arg === 'compose') setCompose({ to: [], cc: [], bcc: [], subject: '', body: '' }); }, [route.arg]);
  useEffect(loadList, [loadList]);
  useEffect(loadOutbox, [loadOutbox]);
  usePimChanges(['accounts'], loadAccounts);
  usePimChanges(['mail'], () => { loadList(); void api.pim.folders().then(setFolders); });
  usePimChanges(['outbox'], loadOutbox);

  // The undo window counts down while a message waits to go.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!outbox.some((o) => o.sendAt > Date.now())) return;
    const h = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(h);
  }, [outbox]);

  const rows = useMemo(() => {
    if (view.threaded && list.threads) {
      return list.threads.map((t) => {
        const inView = t.messages.filter((m) => list.messages.some((x) => x.id === m.id));
        const last = (inView.length ? inView : t.messages)[(inView.length ? inView : t.messages).length - 1];
        return { key: t.id, last, count: t.messages.length, unread: t.unread, thread: t };
      }).filter((r) => r.last);
    }
    return list.messages.map((m) => ({ key: m.id, last: m, count: 1, unread: m.seen ? 0 : 1, thread: undefined as Thread | undefined }));
  }, [list, view.threaded]);

  const current = rows.find((r) => r.last.id === selected || r.thread?.messages.some((m) => m.id === selected));
  const ids = checked.size ? [...checked] : current ? (current.thread ? current.thread.messages.filter((m) => list.messages.some((x) => x.id === m.id)).map((m) => m.id) : [current.last.id]) : [];

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done);
      setChecked(new Set());
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    }
  };

  const move = (dir: 1 | -1) => {
    const i = rows.findIndex((r) => r === current);
    const next = rows[Math.max(0, Math.min(rows.length - 1, (i < 0 ? -1 : i) + dir))];
    if (next) setSelected(next.last.id);
  };

  const reply = useCallback(async (mode: 'reply' | 'replyAll' | 'forward', id = current?.last.id, body?: string) => {
    if (!id) return;
    const d = await api.pim.draftFor(id, mode);
    setCompose({ ...d, body: body ?? d.body, account: id.split(':')[0] });
  }, [current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || compose) return;
      const k = e.key;
      if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (k === 'r') { e.preventDefault(); void reply('reply'); }
      else if (k === 'a') { e.preventDefault(); void reply('replyAll'); }
      else if (k === 'f') { e.preventDefault(); void reply('forward'); }
      else if (k === 'c') { e.preventDefault(); setCompose({ to: [], cc: [], bcc: [], subject: '', body: '' }); }
      else if (k === 'e' && ids.length) { e.preventDefault(); void act(() => api.pim.archive(ids), 'Archived'); }
      else if ((k === '#' || k === 'Delete' || k === 'Backspace') && ids.length) { e.preventDefault(); void act(() => api.pim.trash(ids), 'Moved to Trash'); }
      else if (k === 's' && current) { e.preventDefault(); void act(() => api.pim.setFlagged(ids, !current.last.flagged)); }
      else if (k === 'u' && current) { e.preventDefault(); void act(() => api.pim.setRead(ids, false)); }
      else if (k === '/') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const refresh = async () => {
    setRefreshing(true);
    await act(() => api.pim.refresh(view.account, view.folder));
    setRefreshing(false);
  };

  // Your own addresses are left out of a conversation's names.
  const mine = new Set(accounts.flatMap((a) => [a.email, ...a.identities.map((i) => i.email)]).filter(Boolean).map((x) => x!.toLowerCase()));
  const others = (list: { name?: string; address: string }[]) => list.filter((p) => !mine.has(p.address.toLowerCase()));
  const pending = outbox.filter((o) => !o.error && o.sendAt > Date.now());
  const failed = outbox.filter((o) => o.error);
  const mailAccounts = accounts.filter((a) => a.mail);
  const totalUnread = folders.filter((f) => f.special === 'inbox').reduce((n, f) => n + f.unread, 0);

  if (!mailAccounts.length) {
    return (
      <div className="pim-empty">
        <Empty icon="mail" title="Add a mail account">
          Gmail, Outlook and Microsoft 365, iCloud, Fastmail, Yahoo, or any mail service that offers IMAP. Your mail stays on your provider’s servers and on this computer.
        </Empty>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add account</button>
        </div>
        {adding ? <AccountDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); loadAccounts(); void refresh(); }} /> : null}
      </div>
    );
  }

  return (
    <div className="mail">
      <aside className="mail-folders">
        <button className="btn primary compose-btn" onClick={() => setCompose({ to: [], cc: [], bcc: [], subject: '', body: '' })}><Icon name="rename" size={14} /> New message</button>
        <button className={`mail-folder ${view.folder === 'unified' && !view.account ? 'on' : ''}`} onClick={() => { setView({ ...view, folder: 'unified', account: undefined }); setSelected(null); }}>
          <Icon name="inbox" size={15} /><span className="grow ellipsis">All inboxes</span>{totalUnread ? <span className="count">{totalUnread}</span> : null}
        </button>
        {mailAccounts.map((a) => (
          <div key={a.id} className="mail-account">
            <div className="mail-account-name" title={a.email}><i style={{ background: a.color ?? 'var(--accent)' }} />{a.label}{(a as Account & { needsSignIn?: boolean }).needsSignIn ? <span className="badge warn" title="Sign in again">!</span> : null}</div>
            {folders.filter((f) => f.account === a.id).map((f) => (
              <button key={f.path} className={`mail-folder ${view.account === a.id && view.folder === f.path ? 'on' : ''}`} onClick={() => { setView({ ...view, account: a.id, folder: f.path }); setSelected(null); }}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const raw = e.dataTransfer.getData('text/keeper-mail'); if (raw) void act(() => api.pim.move(JSON.parse(raw), f.path), `Moved to ${f.name}`); }}>
                <Icon name={FOLDER_ICON[f.special ?? ''] ?? 'folder'} size={15} />
                <span className="grow ellipsis">{f.name}</span>
                {f.unread && f.special !== 'sent' && f.special !== 'trash' ? <span className="count">{f.unread}</span> : null}
              </button>
            ))}
          </div>
        ))}
        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setAdding(true)}><Icon name="plus" size={13} /> Add account</button>
        <button className="btn ghost sm" onClick={() => go({ name: 'settings', arg: 'pim' })}><Icon name="settings" size={13} /> Mail settings</button>
      </aside>

      <section className="mail-list">
        <div className="mail-list-head">
          <div className="input-wrap grow">
            <Icon name="search" size={14} />
            <input ref={searchRef} className="input" placeholder="Search mail (from:, subject:, is:unread)" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
          </div>
          <button className="btn icon sm" title="Check for new mail" onClick={() => void refresh()}>{refreshing ? <div className="spinner" /> : <Icon name="refresh" size={14} />}</button>
        </div>
        <div className="mail-list-filters">
          <div className="seg">
            {(['all', 'unread', 'flagged', 'attachments'] as const).map((f) => <button key={f} className={view.filter === f ? 'on' : ''} onClick={() => setView({ ...view, filter: f })}>{f === 'all' ? 'All' : f === 'unread' ? 'Unread' : f === 'flagged' ? 'Flagged' : 'Attachments'}</button>)}
          </div>
          <button className={`btn sm ghost ${view.threaded ? 'on' : ''}`} title="Group into conversations" onClick={() => setView({ ...view, threaded: !view.threaded })}><Icon name="list" size={13} /> {view.threaded ? 'Conversations' : 'Messages'}</button>
        </div>
        {checked.size ? (
          <div className="mail-bulk">
            <span className="grow">{checked.size} selected</span>
            <button className="btn sm ghost" onClick={() => void act(() => api.pim.setRead([...checked], true))}>Mark read</button>
            <button className="btn sm ghost" onClick={() => void act(() => api.pim.archive([...checked]), 'Archived')}>Archive</button>
            <button className="btn sm ghost" onClick={() => void act(() => api.pim.trash([...checked]), 'Moved to Trash')}>Delete</button>
            <button className="btn sm ghost icon" onClick={() => setChecked(new Set())}><Icon name="close" size={13} /></button>
          </div>
        ) : null}
        <div className="mail-rows" role="listbox" aria-label="Messages">
          {rows.length ? rows.map((r) => {
            const m = r.last;
            const on = current === r;
            return (
              <div key={r.key} role="option" aria-selected={on} className={`mail-row ${on ? 'on' : ''} ${r.unread ? 'unread' : ''}`} onClick={(e) => {
                if (e.metaKey || e.ctrlKey) { const next = new Set(checked); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); setChecked(next); return; }
                setSelected(m.id);
              }}
                draggable onDragStart={(e) => e.dataTransfer.setData('text/keeper-mail', JSON.stringify(r.thread ? r.thread.messages.map((x) => x.id) : [m.id]))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelected(m.id);
                  setMenu({ x: e.clientX, y: e.clientY, items: [
                    { label: 'Reply', icon: 'reply', run: () => void reply('reply', m.id) },
                    { label: 'Reply All', icon: 'replyAll', run: () => void reply('replyAll', m.id) },
                    { label: 'Forward', icon: 'forward', run: () => void reply('forward', m.id) },
                    { sep: true, label: '' },
                    { label: m.seen ? 'Mark as Unread' : 'Mark as Read', icon: 'mail', run: () => void act(() => api.pim.setRead([m.id], !m.seen)) },
                    { label: m.flagged ? 'Unflag' : 'Flag', icon: 'flag', run: () => void act(() => api.pim.setFlagged([m.id], !m.flagged)) },
                    ...snoozeTimes().map((s) => ({ label: `Snooze: ${s.label}`, icon: 'clock', run: () => void act(() => api.pim.snooze([m.id], s.at), `Snoozed until ${new Date(s.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`) })),
                    { sep: true, label: '' },
                    { label: 'Archive', icon: 'archive', run: () => void act(() => api.pim.archive([m.id]), 'Archived') },
                    { label: 'Move to Junk', icon: 'warning', run: () => void act(() => api.pim.junk([m.id]), 'Moved to Junk') },
                    { label: 'Delete', icon: 'trash', danger: true, run: () => void act(() => api.pim.trash([m.id]), 'Moved to Trash') },
                  ] });
                }}>
                <span className={`check ${checked.has(m.id) ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); const next = new Set(checked); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); setChecked(next); }}>{checked.has(m.id) ? <Icon name="check" size={11} /> : null}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="mail-row-top">
                    <span className="mail-from ellipsis">{r.thread && others(r.thread.participants).length > 1 ? others(r.thread.participants).slice(0, 3).map((p) => (p.name ?? p.address).split(' ')[0]).join(', ') : m.from?.name || m.from?.address || '(unknown)'}</span>
                    {r.count > 1 ? <span className="mail-count">{r.count}</span> : null}
                    <span className="mail-date">{when(m.date)}</span>
                  </div>
                  <div className="mail-subject ellipsis">{m.flagged ? <Icon name="flag" size={11} className="flag" /> : null}{m.subject}</div>
                  <div className="mail-snippet ellipsis">{m.hasAttachments ? <Icon name="paperclip" size={11} /> : null}{m.snippet}</div>
                </div>
                {view.folder === 'unified' ? <i className="mail-acc-dot" style={{ background: accounts.find((a) => a.id === m.account)?.color ?? 'var(--accent)' }} /> : null}
              </div>
            );
          }) : <div className="empty small muted" style={{ padding: 30 }}>{query ? 'No messages match' : 'Nothing here'}</div>}
          {view.account && view.folder !== 'unified' && rows.length >= 100 ? <button className="btn ghost sm" style={{ margin: 12 }} onClick={() => void api.pim.older(view.account!, view.folder)}>Load older messages</button> : null}
        </div>
      </section>

      <section className="mail-reader">
        {current ? <Conversation key={current.key} row={current} accounts={accounts} onReply={(m, id, body) => void reply(m, id, body)} act={act} /> : <div className="mail-reader-empty"><Icon name="mail" size={44} stroke={1.2} /><div className="muted">Select a message</div><div className="small muted">j / k to move · r reply · e archive · # delete · c new message</div></div>}
      </section>

      {pending.length || failed.length ? (
        <div className="mail-outbox" role="status">
          {pending.map((o) => (
            <div key={o.id} className="row" style={{ gap: 10 }}>
              <Icon name="send" size={14} />
              <span className="grow ellipsis">Sending “{o.subject}” in {Math.max(1, Math.ceil((o.sendAt - Date.now()) / 1000))} s</span>
              <button className="btn sm" onClick={async () => { const d = await api.pim.undoSend(o.id); if (d) setCompose({ ...(d as Draft), account: (d as Draft & { account?: string }).account }); }}>Undo</button>
            </div>
          ))}
          {failed.map((o) => <div key={o.id} className="row small" style={{ gap: 8, color: 'var(--danger)' }}><Icon name="warning" size={13} /> “{o.subject}” was not sent: {o.error}</div>)}
        </div>
      ) : null}

      {compose ? <Compose draft={compose} accounts={mailAccounts} onClose={() => setCompose(null)} onSent={(o) => { setCompose(null); toast(o.sendAt - Date.now() > 60_000 ? `Will send ${new Date(o.sendAt).toLocaleString()}` : 'Sending…'); loadOutbox(); }} /> : null}
      {adding ? <AccountDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); loadAccounts(); }} /> : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

function Conversation({ row, accounts, onReply, act }: {
  row: { last: MessageSummary; thread?: Thread };
  accounts: Account[];
  onReply: (mode: 'reply' | 'replyAll' | 'forward', id: string, body?: string) => void;
  act: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const { toast } = useStore();
  const msgs = row.thread ? row.thread.messages : [row.last];
  const [open, setOpen] = useState<Set<string>>(new Set([msgs[msgs.length - 1].id]));
  const [ai, setAi] = useState<{ task: string; text: string; events?: { title: string; start: number; end: number; allDay: boolean }[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const last = msgs[msgs.length - 1];
  const ids = msgs.map((m) => m.id);

  const runAi = async (task: 'summarize' | 'reply' | 'extract') => {
    setBusy(task);
    try {
      const r = await api.pim.ai(last.id, task);
      setAi({ task, ...r });
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="conversation">
      <div className="reader-toolbar">
        <button className="btn sm ghost" title="Reply (r)" onClick={() => onReply('reply', last.id)}><Icon name="reply" size={14} /> Reply</button>
        <button className="btn sm ghost" title="Reply all (a)" onClick={() => onReply('replyAll', last.id)}><Icon name="replyAll" size={14} /></button>
        <button className="btn sm ghost" title="Forward (f)" onClick={() => onReply('forward', last.id)}><Icon name="forward" size={14} /></button>
        <span className="sep" />
        <button className="btn sm ghost" title="Archive (e)" onClick={() => void act(() => api.pim.archive(ids), 'Archived')}><Icon name="archive" size={14} /></button>
        <button className="btn sm ghost" title="Delete (#)" onClick={() => void act(() => api.pim.trash(ids), 'Moved to Trash')}><Icon name="trash" size={14} /></button>
        <button className="btn sm ghost" title="Flag (s)" onClick={() => void act(() => api.pim.setFlagged([last.id], !last.flagged))}><Icon name="flag" size={14} style={last.flagged ? { color: 'var(--warn)' } : undefined} /></button>
        <button className="btn sm ghost" title="Mark as unread (u)" onClick={() => void act(() => api.pim.setRead([last.id], false))}><Icon name="mail" size={14} /></button>
        <span className="grow" />
        <button className="btn sm ghost" disabled={!!busy} onClick={() => void runAi('summarize')}>{busy === 'summarize' ? <div className="spinner" /> : <Icon name="sparkle" size={13} />} Summarize</button>
        <button className="btn sm ghost" disabled={!!busy} onClick={() => void runAi('reply')}>{busy === 'reply' ? <div className="spinner" /> : <Icon name="sparkle" size={13} />} Draft reply</button>
        <button className="btn sm ghost" disabled={!!busy} onClick={() => void runAi('extract')}>{busy === 'extract' ? <div className="spinner" /> : <Icon name="calendar" size={13} />} Find dates</button>
      </div>
      <h2 className="reader-subject">{last.subject}</h2>
      {ai ? (
        <div className="ai-card">
          <div className="row" style={{ gap: 6 }}><Icon name="sparkle" size={13} /><b>{ai.task === 'summarize' ? 'Summary' : ai.task === 'reply' ? 'Suggested reply' : 'Dates found'}</b><span className="grow" /><button className="btn sm ghost icon" onClick={() => setAi(null)}><Icon name="close" size={12} /></button></div>
          {ai.task === 'extract' && ai.events ? (
            ai.events.length ? ai.events.map((e, i) => (
              <div key={i} className="row" style={{ gap: 8, marginTop: 6 }}>
                <span className="grow">{e.title} · {new Date(e.start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: e.allDay ? undefined : 'numeric', minute: e.allDay ? undefined : '2-digit' })}</span>
                <button className="btn sm" onClick={() => void act(() => api.pim.saveEvent({ id: '', uid: '', calendar: '', title: e.title, start: e.start, end: e.end, allDay: e.allDay }), 'Added to your calendar')}>Add to calendar</button>
              </div>
            )) : <div className="small muted">No dates in this conversation.</div>
          ) : <div className="ai-text">{ai.text}</div>}
          {ai.task === 'reply' ? <button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => onReply('reply', last.id, ai.text)}>Use this reply</button> : null}
        </div>
      ) : null}
      {msgs.map((m) => open.has(m.id)
        ? <MessageCard key={m.id} summary={m} accounts={accounts} onCollapse={msgs.length > 1 ? () => setOpen(new Set([...open].filter((x) => x !== m.id))) : undefined} act={act} />
        : (
          <button key={m.id} className="message-collapsed" onClick={() => setOpen(new Set([...open, m.id]))}>
            <b>{m.from?.name || m.from?.address}</b><span className="grow ellipsis muted">{m.snippet}</span><span className="small muted">{when(m.date)}</span>
          </button>
        ))}
    </div>
  );
}

function iframeDoc(html: string, allowRemote: boolean, dark: boolean, plain: boolean): string {
  const csp = `default-src 'none'; img-src data: cid:${allowRemote ? ' https: http:' : ''}; style-src 'unsafe-inline'${allowRemote ? ' https:' : ''}; font-src data:${allowRemote ? ' https:' : ''}; media-src 'none'; form-action 'none'`;
  // Plain-text mail follows Keeper's theme; designed HTML mail gets the white page it was made for.
  const base = plain
    ? `body{margin:0;padding:4px 2px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:${dark ? '#e8e8ea' : '#1c1c1e'};background:transparent}a{color:${dark ? '#7ab8ff' : '#0a66d0'}}`
    : 'body{margin:0;padding:12px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#1c1c1e;background:#fff;border-radius:10px}img{max-width:100%;height:auto}img[data-blocked-src]{display:inline-block;min-width:60px;min-height:40px;background:#eee repeating-linear-gradient(45deg,#e8e8e8 0 8px,#f2f2f2 8px 16px);border-radius:6px}blockquote{border-left:3px solid #ccc;margin:0 0 0 4px;padding-left:10px;color:#555}pre{white-space:pre-wrap}table{max-width:100%}';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${base}</style></head><body>${html}</body></html>`;
}

function MessageCard({ summary, accounts, onCollapse, act }: { summary: MessageSummary; accounts: Account[]; onCollapse?: () => void; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const { toast, info } = useStore();
  const [msg, setMsg] = useState<OpenMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  const [height, setHeight] = useState(240);
  const frame = useRef<HTMLIFrameElement>(null);
  const dark = document.documentElement.dataset.appearance === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches;

  useEffect(() => {
    let alive = true;
    setError(null);
    api.pim.open(summary.id, { allowRemote: remote }).then((m) => alive && setMsg(m)).catch((e) => alive && setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)));
    return () => { alive = false; };
  }, [summary.id, remote]);

  // The frame cannot run scripts, so its height is estimated from the content and adjusted on load.
  useEffect(() => {
    if (!msg) return;
    const text = msg.html.replace(/<[^>]+>/g, ' ');
    const est = Math.min(4000, Math.max(160, Math.ceil(text.length / 90) * 22 + (msg.html.match(/<img/g)?.length ?? 0) * 180 + 60));
    setHeight(est);
  }, [msg]);

  const plain = !!msg && !/<(table|div|p|img|h\d|span)\b/i.test(msg.html.replace(/^<div style="white-space:pre-wrap[^>]*>/, ''));
  const acct = accounts.find((a) => a.id === summary.account);

  return (
    <article className="message-card">
      <header className="message-head" onClick={onCollapse}>
        <div className="avatar" style={{ background: `hsl(${[...(summary.from?.address ?? '?')].reduce((h, c) => h + c.charCodeAt(0), 0) % 360} 55% 55%)` }}>{(summary.from?.name || summary.from?.address || '?').slice(0, 1).toUpperCase()}</div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}><b className="ellipsis">{summary.from?.name || summary.from?.address}</b><span className="small muted ellipsis">{summary.from?.name ? summary.from.address : ''}</span></div>
          <div className="small muted ellipsis">To {summary.to.map((a) => a.name || a.address).join(', ')}{summary.cc.length ? ` · Cc ${summary.cc.map((a) => a.name || a.address).join(', ')}` : ''}{acct ? ` · ${acct.label}` : ''}</div>
        </div>
        <div className="small muted">{new Date(summary.date).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
      </header>
      {error ? <div className="banner warn"><Icon name="warning" size={14} /> {error}</div> : null}
      {!msg && !error ? <div className="message-loading"><div className="spinner" /></div> : null}
      {msg ? (
        <>
          {msg.invite ? <InviteCard msg={msg} act={act} /> : null}
          {msg.blocked > 0 || msg.trackers > 0 ? (
            <div className="banner">
              <Icon name="eyeOff" size={14} />
              <span className="grow">{msg.blocked ? `${msg.blocked} picture${msg.blocked === 1 ? '' : 's'} from the internet held back.` : ''}{msg.trackers ? ` ${msg.trackers} tracking pixel${msg.trackers === 1 ? '' : 's'} removed.` : ''}</span>
              {msg.blocked ? <button className="btn sm" onClick={() => setRemote(true)}>Show pictures</button> : null}
              {msg.blocked && summary.from ? <button className="btn sm ghost" onClick={() => { void api.pim.trustSender(summary.from!.address); setRemote(true); }}>Always from this sender</button> : null}
            </div>
          ) : null}
          {msg.unsubscribe ? (
            <div className="banner subtle">
              <Icon name="mail" size={14} /><span className="grow">This is from a mailing list.</span>
              <button className="btn sm ghost" onClick={async () => { const r = await api.pim.unsubscribe(summary.id); toast(r.how); }}>Unsubscribe</button>
            </div>
          ) : null}
          <iframe ref={frame} className="message-frame" title={`Message: ${summary.subject}`} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={iframeDoc(msg.html, remote, dark, plain)} style={{ height }} />
          {msg.attachments.filter((a) => !a.inline).length ? (
            <div className="attachments">
              {msg.attachments.filter((a) => !a.inline).map((a) => (
                <div key={a.id} className="attachment" title={a.filename}>
                  <Icon name={/pdf|text|word|sheet|presentation/.test(a.contentType) ? 'document' : /image/.test(a.contentType) ? 'image' : /calendar/.test(a.contentType) ? 'calendar' : 'paperclip'} size={18} />
                  <div className="grow" style={{ minWidth: 0 }}><div className="ellipsis">{a.filename}</div><div className="small muted">{formatBytes(a.size)}</div></div>
                  <button className="btn sm ghost icon" title="Open" onClick={() => void act(() => api.pim.openAttachment(summary.id, a.id))}><Icon name="external" size={13} /></button>
                  <button className="btn sm ghost icon" title={`Save to ${info?.platform === 'win32' ? 'a folder' : 'Downloads'}`} onClick={async () => { const p = await api.pim.saveAttachment(summary.id, a.id); if (p) toast(`Saved ${p.split(/[\\/]/).pop()}`); }}><Icon name="down" size={13} /></button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

function InviteCard({ msg, act }: { msg: OpenMessage; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const e = msg.invite!.event;
  const [mine, setMine] = useState(msg.invite!.mine);
  const answer = (s: 'accepted' | 'declined' | 'tentative') => void act(async () => { await api.pim.respond(msg.summary.id, s); setMine(s); });
  if (msg.invite!.method === 'CANCEL') return <div className="banner warn"><Icon name="calendar" size={14} /> This event was cancelled: {e.title}</div>;
  if (msg.invite!.method === 'REPLY') return <div className="banner subtle"><Icon name="calendar" size={14} /> {e.attendees?.[0]?.name ?? e.attendees?.[0]?.email} answered {e.attendees?.[0]?.status ?? ''} for {e.title}</div>;
  return (
    <div className="invite-card">
      <div className="invite-date"><div className="small">{new Date(e.start).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</div><div className="big">{new Date(e.start).getDate()}</div></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <b>{e.title}</b>
        <div className="small muted">{new Date(e.start).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })} – {new Date(e.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{e.location ? ` · ${e.location}` : ''}</div>
        {e.organizer ? <div className="small muted">From {e.organizer.name ?? e.organizer.email}{e.attendees?.length ? ` · ${e.attendees.length} invited` : ''}</div> : null}
      </div>
      <div className="seg">
        <button className={mine === 'accepted' ? 'on' : ''} onClick={() => answer('accepted')}>Accept</button>
        <button className={mine === 'tentative' ? 'on' : ''} onClick={() => answer('tentative')}>Maybe</button>
        <button className={mine === 'declined' ? 'on' : ''} onClick={() => answer('declined')}>Decline</button>
      </div>
    </div>
  );
}

export function addressLine(list: { name?: string; address: string }[]): string {
  return list.map(formatAddress).join(', ');
}

export function ConfirmModal({ title, body, onYes, onClose }: { title: string; body: string; onYes: () => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{body}</p>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { onYes(); onClose(); }}>OK</button></div>
    </Modal>
  );
}
