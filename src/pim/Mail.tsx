// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail: every inbox together (sorted into Important and Other, security
// alerts always Important) or one folder at a time, conversations, a safe
// reading pane (remote pictures held back, links that show where they go),
// sent mail waiting for an answer, newsletter cleanup, search across accounts
// (this computer first, then the servers), snooze, send later, undo send,
// two layouts, keyboard-shortcut sets and AI help.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MailView, OpenMessage, Outbox } from '../../core/api-pim';
import type { Draft } from '../../core/pim/mail';
import { formatAddress } from '../../core/pim/mail';
import type { PimPrefsView } from '../../core/pim/prefs';
import { bindings, comboOf, makeResolver, type MailAction } from '../../core/pim/shortcuts';
import { outboxPhase, snoozeChoices } from '../../core/pim/triage';
import type { Account, MailFolder, MessageSummary, Thread } from '../../core/pim/types';
import { formatBytes } from '../../core/format';
import { mailLink, notesFromMessage } from '../../core/pim/mail-link';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, Empty, Modal, type MenuItem } from '../components/ui';
import { useStore } from '../state';
import { Compose } from './Compose';
import { AccountDialog } from './AccountDialog';
import { AskCard, CleanupView, ScheduledView, WaitingView } from './mail-views';
import { AccountMark, ChatThread, CodeBanner, PhishBanner, QuickLook, remindMenu, SearchChips, SenderAvatar } from './mail-parts';
import { accountForDigit, nextTextSize, type InboxTab } from '../../core/pim/smart';
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

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/** The views beside the folders that are not a list of messages. */
type Side = 'waiting' | 'cleanup' | 'scheduled' | null;

/** A folder's depth in its account ("Clients/Acme" is one level in). */
function depth(f: MailFolder): number {
  if (!f.delimiter || f.special) return 0;
  return Math.min(4, f.path.replace(/^\[Gmail\]./, '').split(f.delimiter).length - 1);
}

function langName(): string {
  const code = (navigator.language || 'en').split('-')[0];
  try { return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? 'English'; } catch { return 'English'; }
}

export function Mail() {
  const { toast, go, route, draft, setDraft, info } = useStore();
  const mac = info?.platform === 'darwin';
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [prefs, setPrefs] = useState<PimPrefsView | null>(null);
  const [view, setView] = useState<MailView>({ folder: 'unified', threaded: true, filter: 'all', tab: 'important' });
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [narrowBack, setNarrowBack] = useState(0);
  const [side, setSide] = useState<Side>(null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<{ messages: MessageSummary[]; threads?: Thread[]; counts?: { important: number; other: number; all?: number; updates?: number; promos?: number } }>({ messages: [] });
  const [server, setServer] = useState<{ q: string; busy: boolean; messages: MessageSummary[] } | null>(null);
  const [ask, setAsk] = useState<{ busy: boolean; answer?: string; sources?: MessageSummary[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [waitingCount, setWaitingCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
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
  const layout = prefs?.mailLayout ?? 'split';
  const splitOn = prefs?.splitInbox !== false;
  const searching = !!query.trim();
  const inboxView = !searching && !side && (view.folder === 'unified' || view.folder.toUpperCase() === 'INBOX');

  const loadAccounts = useCallback(() => {
    void api.pim.accounts().then(setAccounts);
    void api.pim.folders().then(setFolders);
    void api.pim.prefs().then(setPrefs);
  }, []);
  const loadList = useCallback(() => {
    const q = query.trim();
    // Searching looks in every account and folder kept on this computer first.
    const v: MailView = q ? { ...view, folder: 'search', account: undefined, split: undefined, tab: undefined, query: q } : { ...view, split: undefined, tab: splitOn ? view.tab : undefined };
    void api.pim.messages(v).then(setList);
    void api.pim.unreadCounts().then((u) => setUnread(u.byAccount));
    void api.pim.waiting().then((w) => setWaitingCount(w.filter((x) => x.overdue).length));
  }, [view, query, splitOn]);
  const loadOutbox = useCallback(() => void api.pim.outbox().then(setOutbox), []);

  useEffect(loadAccounts, [loadAccounts]);
  // "New Mail Message" from the command palette or a keeper:// link; a message id from the Island's drop-down.
  useEffect(() => {
    if (route.arg === 'compose') setCompose({ to: [], cc: [], bcc: [], subject: '', body: '' });
    // A message an app prepared (over MCP): it opens here and goes only if the person presses Send.
    else if (route.arg === 'staged') void api.pim.stagedCompose().then((d) => { if (d) setCompose(d); });
    // Files dropped on the notch: a new message with them attached.
    else if (route.arg?.startsWith('attach:')) { try { setCompose({ to: [], cc: [], bcc: [], subject: '', body: '', attachments: (JSON.parse(decodeURIComponent(route.arg.slice(7))) as string[]).map((path) => ({ path })) }); } catch { /* a bad link */ } }
    // A contact from the search box: the mail from them.
    else if (route.arg?.startsWith('search:')) { setSide(null); setQuery(route.arg.slice(7)); }
    else if (route.arg && route.arg.split(':').length > 2) { setSide(null); setQuery(''); setView((v) => ({ ...v, folder: 'unified', account: undefined, split: undefined, tab: 'all' })); setSelected(route.arg); }
  }, [route.arg]);
  useEffect(loadList, [loadList]);
  useEffect(loadOutbox, [loadOutbox]);
  usePimChanges(['accounts'], loadAccounts);
  usePimChanges(['mail'], () => { loadList(); void api.pim.folders().then(setFolders); setReloadKey((k) => k + 1); });
  usePimChanges(['outbox'], loadOutbox);
  usePimChanges(['staged'], () => void api.pim.stagedCompose().then((d) => { if (d) setCompose(d); }));

  // Then the servers, for older mail not kept here.
  useEffect(() => {
    const q = query.trim();
    setAsk(null);
    if (q.length < 3) { setServer(null); return; }
    const h = setTimeout(() => {
      setServer({ q, busy: true, messages: [] });
      void api.pim.search(q, { server: true }).then((r) => setServer((s) => (s?.q === q ? { q, busy: false, messages: r.messages.slice(r.local) } : s)), () => setServer((s) => (s?.q === q ? { q, busy: false, messages: [] } : s)));
    }, 700);
    return () => clearTimeout(h);
  }, [query]);

  // The undo window counts down while a message waits to go.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!outbox.some((o) => !o.scheduled && o.sendAt > Date.now())) return;
    const h = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(h);
  }, [outbox]);

  const shownMessages = useMemo(() => {
    if (!searching || !server?.messages.length) return list.messages;
    const seen = new Set(list.messages.map((m) => m.messageId ?? m.id));
    return [...list.messages, ...server.messages.filter((m) => !seen.has(m.messageId ?? m.id))];
  }, [list.messages, server, searching]);
  const localCount = list.messages.length;

  const rows = useMemo(() => {
    if (view.threaded && list.threads && !searching) {
      return list.threads.map((t) => {
        const inView = t.messages.filter((m) => list.messages.some((x) => x.id === m.id));
        const last = (inView.length ? inView : t.messages)[(inView.length ? inView : t.messages).length - 1];
        return { key: t.id, last, count: t.messages.length, unread: t.unread, thread: t };
      }).filter((r) => r.last);
    }
    return shownMessages.map((m) => ({ key: m.id, last: m, count: 1, unread: m.seen ? 0 : 1, thread: undefined as Thread | undefined }));
  }, [list, view.threaded, shownMessages, searching]);

  const current = rows.find((r) => r.last.id === selected || r.thread?.messages.some((m) => m.id === selected));
  const ids = checked.size ? [...checked] : current ? (current.thread ? current.thread.messages.filter((m) => list.messages.some((x) => x.id === m.id)).map((m) => m.id) : [current.last.id]) : [];

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(/^(Archived|Moved|Moved to Trash|Moved to Junk)/.test(done) ? `${done} · ${mac ? '⌘Z' : 'Ctrl+Z'} to undo` : done);
      setChecked(new Set());
    } catch (e) {
      toast(errText(e));
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
    setCompose({ ...d, body: body ?? d.body, account: id.split(':')[0], replyOf: id } as Draft & { account?: string });
  }, [current]);

  const snoozeMenu = (x: number, y: number, target: string[]) => setMenu({ x, y, items: snoozeChoices(Date.now()).map((s) => ({ label: s.label, icon: 'clock', run: () => void act(() => api.pim.snooze(target, s.at), `Snoozed until ${new Date(s.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`) })) });
  const showTab = (tab: InboxTab) => { setSide(null); setQuery(''); setView({ ...view, tab, split: undefined }); setSelected(null); };
  const showSplit = (split: 'important' | 'other' | undefined) => showTab(split === 'important' ? 'important' : split === 'other' ? 'updates' : 'all');
  const undoLast = () => void api.pim.undo().then((what) => toast(what ? `Undone: ${what}` : 'Nothing to undo'), (e) => toast(errText(e)));
  const mailAccountsOrdered = accounts.filter((a) => a.mail);
  const textSize = prefs?.mailTextSize ?? 14;

  // Keyboard shortcuts: the chosen set, with the person's own changes.
  const resolve = useMemo(() => makeResolver(bindings(prefs?.shortcutScheme ?? 'gmail', prefs?.shortcutOverrides as Partial<Record<MailAction, string>>)), [prefs?.shortcutScheme, prefs?.shortcutOverrides]);
  useEffect(() => {
    const run: Record<MailAction, () => void> = {
      next: () => move(1), prev: () => move(-1), reply: () => void reply('reply'), replyAll: () => void reply('replyAll'), forward: () => void reply('forward'),
      compose: () => setCompose({ to: [], cc: [], bcc: [], subject: '', body: '' }),
      archive: () => { if (ids.length) void act(() => api.pim.archive(ids), 'Archived'); },
      trash: () => { if (ids.length) void act(() => api.pim.trash(ids), 'Moved to Trash'); },
      flag: () => { if (current) void act(() => api.pim.setFlagged(ids, !current.last.flagged)); },
      unread: () => { if (current) void act(() => api.pim.setRead(ids, false)); },
      read: () => { if (current) void act(() => api.pim.setRead(ids, true)); },
      snooze: () => { if (ids.length) snoozeMenu(window.innerWidth / 2 - 100, 140, ids); },
      search: () => searchRef.current?.focus(),
      select: () => { if (current) { const n = new Set(checked); if (n.has(current.last.id)) n.delete(current.last.id); else n.add(current.last.id); setChecked(n); } },
      back: () => { if (checked.size) setChecked(new Set()); else { setSelected(null); setNarrowBack((x) => x + 1); } },
      important: () => showSplit('important'), other: () => showSplit('other'),
      followUp: () => { if (current) void api.pim.followUp(current.last.id).then(setCompose, (e) => toast(errText(e))); },
    };
    const onKey = (e: KeyboardEvent) => {
      const mod = mac ? e.metaKey : e.ctrlKey;
      if (mod && !compose && !document.querySelector('.modal, .palette')) {
        // ⌘1…⌘9 one account's inbox, ⌘0 every inbox; ⌘K search; ⌘Z undo; ⌘+ / ⌘− text size.
        if (/^[0-9]$/.test(e.key) && !e.shiftKey && !e.altKey) {
          const t = accountForDigit(Number(e.key), mailAccountsOrdered);
          if (t) { e.preventDefault(); if (t === 'all') openView({ folder: 'unified', account: undefined, tab: splitOn ? 'important' : undefined }); else openView({ account: t.id, folder: 'INBOX', tab: splitOn ? 'important' : undefined }); }
          return;
        }
        if (e.key.toLowerCase() === 'k' && !e.shiftKey) { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
        if (e.key.toLowerCase() === 'z' && !e.shiftKey && !typing(e)) { e.preventDefault(); undoLast(); return; }
        if ((e.key === '=' || e.key === '+' || e.key === '-') && !typing(e)) { e.preventDefault(); void api.pim.setPrefs({ mailTextSize: nextTextSize(textSize, e.key === '-' ? -1 : 1) }).then(setPrefs); return; }
        if (e.key.toLowerCase() === 'i' && e.shiftKey && !typing(e)) { e.preventDefault(); window.dispatchEvent(new CustomEvent('mail-load-images')); return; }
      }
      if (typing(e) || compose || document.querySelector('.modal, .menu, .palette')) return;
      const a = resolve(comboOf(e, mac));
      if (!a) return;
      e.preventDefault();
      if (a !== 'wait') run[a]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const refresh = async () => {
    setRefreshing(true);
    await act(() => api.pim.refresh(view.account, view.folder === 'unified:sent' || view.folder === 'snoozed' ? undefined : view.folder));
    setRefreshing(false);
  };

  const askMail = async () => {
    const q = query.trim();
    if (!q) return;
    setAsk({ busy: true });
    try { setAsk({ busy: false, ...(await api.pim.askMail(q)) }); } catch (e) { setAsk(null); toast(errText(e)); }
  };

  // Your own addresses are left out of a conversation's names.
  const mine = new Set(accounts.flatMap((a) => [a.email, ...a.identities.map((i) => i.email)]).filter(Boolean).map((x) => x!.toLowerCase()));
  const others = (list: { name?: string; address: string }[]) => list.filter((p) => !mine.has(p.address.toLowerCase()));
  const pending = outbox.filter((o) => outboxPhase(o, Date.now()).phase === 'undo');
  const scheduled = outbox.filter((o) => o.scheduled && !o.error);
  const failed = outbox.filter((o) => o.error);
  const mailAccounts = accounts.filter((a) => a.mail);
  const totalUnread = folders.filter((f) => f.special === 'inbox').reduce((n, f) => n + f.unread, 0);
  const openSide = (s: Side) => { setSide(s); setSelected(null); setQuery(''); };
  const openView = (v: Partial<MailView>) => { setSide(null); setQuery(''); setView({ ...view, ...v }); setSelected(null); };
  const isOn = (folder: string, account?: string) => !side && !searching && view.folder === folder && view.account === account;

  if (!mailAccounts.length) {
    return (
      <div className="pim-empty">
        <Empty icon="mail" title="Add a mail account">
          Gmail, iCloud, Yahoo, AOL, Fastmail, Zoho, or any mail service that offers IMAP (Outlook.com and Microsoft 365 need Sign in with Microsoft). Keeper talks to your provider directly; your mail stays on its servers and on this computer.
        </Empty>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add account</button>
        </div>
        {adding ? <AccountDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); loadAccounts(); void refresh(); }} /> : null}
      </div>
    );
  }

  const rowMenu = (e: React.MouseEvent, m: MessageSummary) => {
    e.preventDefault();
    setSelected(m.id);
    const sender = m.from?.address;
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Reply', icon: 'reply', run: () => void reply('reply', m.id) },
      { label: 'Reply All', icon: 'replyAll', run: () => void reply('replyAll', m.id) },
      { label: 'Forward', icon: 'forward', run: () => void reply('forward', m.id) },
      { sep: true, label: '' },
      { label: m.seen ? 'Mark as Unread' : 'Mark as Read', icon: 'mail', run: () => void act(() => api.pim.setRead([m.id], !m.seen)) },
      { label: m.flagged ? 'Unflag' : 'Flag', icon: 'flag', run: () => void act(() => api.pim.setFlagged([m.id], !m.flagged)) },
      m.snoozedUntil && m.snoozedUntil > Date.now()
        ? { label: 'Unsnooze', icon: 'clock', run: () => void act(() => api.pim.unsnooze([m.id]), 'Back in the inbox') }
        : { label: 'Snooze…', icon: 'clock', run: () => snoozeMenu(e.clientX, e.clientY, [m.id]) },
      ...(sender && !m.security ? [m.category === 'other'
        ? { label: 'Always Important from this sender', icon: 'star', run: () => void act(() => api.pim.setCategory(sender, 'important'), 'Mail from this sender goes to Important') }
        : { label: 'Move this sender to Other', icon: 'inbox', run: () => void act(() => api.pim.setCategory(sender, 'other'), 'Mail from this sender goes to Other') }] : []),
      { sep: true, label: '' },
      { label: 'Add to Tasks', icon: 'listCheck', run: () => void act(() => addToTasks([m]), 'Added to Tasks') },
      { label: 'Mute conversation', icon: 'eyeOff', run: () => void act(() => api.pim.mute([m.id], true), 'Muted: new mail in it skips the inbox') },
      ...(sender ? [{ label: `Block ${sender}`, icon: 'lock', run: () => void act(() => api.pim.block(sender, true), `Blocked ${sender}`) }] : []),
      ...(m.from && mine.has(m.from.address.toLowerCase()) ? remindMenu(Date.now(), (at) => void act(() => api.pim.remindNoReply(m.id, at), at ? `I’ll remind you ${new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} if nobody answers` : 'Reminder cancelled')).slice(0, 1) : []),
      { label: 'Archive', icon: 'archive', run: () => void act(() => api.pim.archive([m.id]), 'Archived') },
      { label: 'Report spam', icon: 'warning', run: () => void act(() => api.pim.reportSpam([m.id]), 'Moved to Junk; the sender is blocked') },
      { label: 'Delete', icon: 'trash', danger: true, run: () => void act(() => api.pim.trash([m.id]), 'Moved to Trash') },
    ] });
  };

  const toggleCheck = (id: string) => { const next = new Set(checked); if (next.has(id)) next.delete(id); else next.add(id); setChecked(next); };
  const acctColor = (id: string) => accounts.find((a) => a.id === id)?.color ?? 'var(--accent)';
  const cross = view.folder === 'unified' || view.folder === 'unified:sent' || view.folder === 'snoozed' || searching;

  const rowsEl = (
    <div className={`mail-rows ${layout === 'wide' ? 'wide' : ''} density-${prefs?.mailDensity ?? 'comfortable'}`} role="listbox" aria-label="Messages" aria-multiselectable>
      {ask ? (ask.busy ? <div className="ai-card"><div className="row" style={{ gap: 8 }}><div className="spinner" /> Reading your mail…</div></div> : <AskCard answer={ask.answer ?? ''} sources={ask.sources ?? []} onOpen={(id) => setSelected(id)} onClose={() => setAsk(null)} />) : null}
      {searching ? <SearchChips query={query} onSave={() => { const name = window.prompt('Name for this smart mailbox', query.trim()); if (name) void api.pim.setPrefs({ smartMailboxes: [...(prefs?.smartMailboxes ?? []), { id: Math.random().toString(36).slice(2, 10), name, query: query.trim() }] }).then((p) => { setPrefs(p); toast('Saved as a smart mailbox'); }); }} /> : null}
      {searching && localCount ? <div className="mail-section">On this computer · {localCount}</div> : null}
      {rows.length ? rows.map((r, i) => {
        const m = r.last;
        const on = current === r;
        const people = r.thread && others(r.thread.participants).length > 1 ? others(r.thread.participants).slice(0, 3).map((p) => (p.name ?? p.address).split(' ')[0]).join(', ') : (m.from && mine.has(m.from.address.toLowerCase()) ? `To ${m.to.map((a) => a.name || a.address).join(', ')}` : m.from?.name || m.from?.address || '(unknown)');
        return (
          <div key={r.key}>
            {searching && i === localCount && server?.messages.length ? <div className="mail-section">On the server · {rows.length - localCount}</div> : null}
            <div role="option" aria-selected={on} className={`mail-row ${on ? 'on' : ''} ${r.unread ? 'unread' : ''} ${checked.has(m.id) ? 'checked' : ''}`} onClick={(e) => {
              if (e.metaKey || e.ctrlKey) { toggleCheck(m.id); return; }
              setSelected(m.id);
            }}
              draggable onDragStart={(e) => e.dataTransfer.setData('text/keeper-mail', JSON.stringify(r.thread ? r.thread.messages.map((x) => x.id) : [m.id]))}
              onContextMenu={(e) => rowMenu(e, m)}>
              <span className={`check ${checked.has(m.id) ? 'on' : ''}`} role="checkbox" aria-checked={checked.has(m.id)} aria-label="Select" onClick={(e) => { e.stopPropagation(); toggleCheck(m.id); }}>{checked.has(m.id) ? <Icon name="check" size={11} /> : null}</span>
              {layout !== 'wide' && prefs?.mailDensity !== 'compact' ? <SenderAvatar from={m.from && mine.has(m.from.address.toLowerCase()) ? m.to[0] : m.from} size={30} /> : null}
              {layout === 'wide' ? (
                <>
                  <span className="mail-from ellipsis">{people}{r.count > 1 ? <span className="mail-count">{r.count}</span> : null}</span>
                  <span className="mail-line ellipsis">
                    {m.security ? <span className="pill danger"><Icon name="shield" size={10} /> Security</span> : null}
                    {m.flagged ? <Icon name="flag" size={11} className="flag" /> : null}
                    <b className="mail-subject-inline">{m.subject}</b><span className="muted"> — {m.snippet}</span>
                  </span>
                  <span className="mail-labels">{(m.labels ?? []).slice(0, 2).map((l) => <span key={l} className="label-chip">{l}</span>)}{m.hasAttachments ? <Icon name="paperclip" size={11} /> : null}</span>
                  <span className="mail-date">{m.snoozedUntil && m.snoozedUntil > Date.now() ? `until ${when(m.snoozedUntil)}` : when(m.date)}</span>
                </>
              ) : (
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="mail-row-top">
                    <span className="mail-from ellipsis">{people}</span>
                    {r.count > 1 ? <span className="mail-count">{r.count}</span> : null}
                    <span className="mail-date">{m.snoozedUntil && m.snoozedUntil > Date.now() ? `until ${when(m.snoozedUntil)}` : when(m.date)}</span>
                  </div>
                  <div className="mail-subject ellipsis">{m.security ? <span className="pill danger" title="Sign-in alert, code or password reset: always Important"><Icon name="shield" size={10} /> Security</span> : null}{m.flagged ? <Icon name="flag" size={11} className="flag" /> : null}{m.subject}</div>
                  <div className="mail-snippet ellipsis">{m.hasAttachments ? <Icon name="paperclip" size={11} /> : null}{(m.labels ?? []).slice(0, 2).map((l) => <span key={l} className="label-chip">{l}</span>)}{searching ? <span className="label-chip">{m.folder.toUpperCase() === 'INBOX' ? 'Inbox' : m.folder.split(/[/.]/).pop()}</span> : null}{m.snippet}</div>
                </div>
              )}
              {cross ? <i className="mail-acc-dot" style={{ background: acctColor(m.account) }} /> : null}
            </div>
          </div>
        );
      }) : <div className="empty small muted" style={{ padding: 30 }}>{searching ? (server?.busy ? 'Nothing on this computer; asking the servers…' : 'No messages match') : view.folder === 'toreply' ? 'Nobody is waiting for an answer from you.' : view.tab === 'important' ? 'Nothing important waiting. Nice.' : 'Nothing here'}</div>}
      {searching && server?.busy && rows.length ? <div className="mail-section"><div className="spinner" /> Searching the servers…</div> : null}
      {!searching && view.account && !cross && rows.length >= 100 ? <button className="btn ghost sm" style={{ margin: 12 }} onClick={() => void api.pim.older(view.account!, view.folder)}>Load older messages</button> : null}
    </div>
  );

  const reader = current ? <Conversation key={current.key} row={current} accounts={accounts} mine={mine} prefs={prefs} onReply={(m, id, body) => void reply(m, id, body)} act={act} onBack={() => setSelected(null)} wide={layout === 'wide'} onSnooze={(x, y) => snoozeMenu(x, y, ids)} onMenu={(x, y, items) => setMenu({ x, y, items })} /> : null;
  const sideView = side === 'waiting' ? <WaitingView reloadKey={reloadKey} onOpen={(id) => { setSide(null); setView({ ...view, folder: 'unified:sent', account: undefined, split: undefined }); setSelected(id); }} onCompose={(d) => setCompose(d)} />
    : side === 'cleanup' ? <CleanupView reloadKey={reloadKey} />
      : side === 'scheduled' ? <ScheduledView outbox={outbox} onEdit={(d) => setCompose(d)} /> : null;

  return (
    <div className={`mail layout-${layout} ${side ? 'with-side' : ''} ${current ? 'reading' : ''}`} data-narrow-back={narrowBack} style={{ ['--mail-text' as string]: `${textSize}px` }}>
      <aside className="mail-folders">
        <button className="btn primary compose-btn" onClick={() => setCompose({ to: [], cc: [], bcc: [], subject: '', body: '' })}><Icon name="rename" size={14} /> New message</button>
        <button className={`mail-folder ${isOn('unified') ? 'on' : ''}`} onClick={() => openView({ folder: 'unified', account: undefined, split: splitOn ? 'important' : undefined })}>
          <Icon name="inbox" size={15} /><span className="grow ellipsis">All inboxes</span>{totalUnread ? <span className="count">{totalUnread}</span> : null}
        </button>
        <button className={`mail-folder ${isOn('toreply') ? 'on' : ''}`} onClick={() => openView({ folder: 'toreply', account: undefined, split: undefined, tab: undefined })} data-testid="mail-nav-toreply"><Icon name="reply" size={15} /><span className="grow ellipsis">To Reply</span></button>
        <button className={`mail-folder ${side === 'waiting' ? 'on' : ''}`} onClick={() => openSide('waiting')} data-testid="mail-nav-waiting">
          <Icon name="history" size={15} /><span className="grow ellipsis">Waiting for reply</span>{waitingCount ? <span className="count warn">{waitingCount}</span> : null}
        </button>
        <button className={`mail-folder ${isOn('snoozed') ? 'on' : ''}`} onClick={() => openView({ folder: 'snoozed', account: undefined, split: undefined })}><Icon name="clock" size={15} /><span className="grow ellipsis">Snoozed</span></button>
        {scheduled.length ? <button className={`mail-folder ${side === 'scheduled' ? 'on' : ''}`} onClick={() => openSide('scheduled')}><Icon name="send" size={15} /><span className="grow ellipsis">Scheduled</span><span className="count">{scheduled.length}</span></button> : null}
        <button className={`mail-folder ${isOn('unified:sent') ? 'on' : ''}`} onClick={() => openView({ folder: 'unified:sent', account: undefined, split: undefined })}><Icon name="send" size={15} /><span className="grow ellipsis">All sent</span></button>
        <button className={`mail-folder ${side === 'cleanup' ? 'on' : ''}`} onClick={() => openSide('cleanup')} data-testid="mail-nav-cleanup"><Icon name="broom" size={15} /><span className="grow ellipsis">Subscriptions</span></button>
        {(prefs?.smartMailboxes ?? []).length ? (
          <div className="mail-account">
            <div className="mail-account-name">Smart mailboxes</div>
            {(prefs?.smartMailboxes ?? []).map((sm) => <button key={sm.id} className={`mail-folder ${isOn(`smart:${sm.id}`) ? 'on' : ''}`} title={sm.query} onClick={() => openView({ folder: `smart:${sm.id}`, account: undefined, split: undefined, tab: undefined })}><Icon name="search" size={15} /><span className="grow ellipsis">{sm.name}</span></button>)}
          </div>
        ) : null}
        {mailAccounts.map((a, ai) => (
          <div key={a.id} className="mail-account">
            <div className="mail-account-name" title={`${a.email ?? ''}${ai < 9 ? ` · ${mac ? '⌘' : 'Ctrl+'}${ai + 1}` : ''}`}><AccountMark a={a} />{a.label}{unread[a.id] ? <span className="acct-unread" data-testid="mail-account-unread">{unread[a.id]}</span> : null}{(a as Account & { needsSignIn?: boolean }).needsSignIn ? <span className="badge warn" title="Sign in again">!</span> : (a as Account & { lastError?: string }).lastError ? <span className="badge warn" title={`Couldn’t check it: ${(a as Account & { lastError?: string }).lastError}. Settings → Mail & Calendar has Retry.`}>!</span> : null}</div>
            {folders.filter((f) => f.account === a.id).map((f) => (
              <button key={f.path} className={`mail-folder ${isOn(f.path, a.id) ? 'on' : ''}`} style={{ paddingLeft: 8 + depth(f) * 14 }} title={f.path} onClick={() => openView({ account: a.id, folder: f.path, split: f.special === 'inbox' && splitOn ? 'important' : undefined })}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const raw = e.dataTransfer.getData('text/keeper-mail'); if (raw) void act(() => api.pim.move(JSON.parse(raw), f.path), `Moved to ${f.name}`); }}>
                <Icon name={FOLDER_ICON[f.special ?? ''] ?? 'folder'} size={15} />
                <span className="grow ellipsis">{f.name}</span>
                {f.unread && f.special !== 'sent' && f.special !== 'trash' && f.special !== 'junk' ? <span className="count">{f.unread}</span> : null}
              </button>
            ))}
          </div>
        ))}
        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setAdding(true)}><Icon name="plus" size={13} /> Add account</button>
        <button className="btn ghost sm" onClick={() => go({ name: 'settings', arg: 'pim' })}><Icon name="settings" size={13} /> Mail settings</button>
      </aside>

      {side ? <section className="mail-side">{sideView}</section> : (
        <section className="mail-list">
          <div className="mail-list-head">
            <div className="input-wrap grow">
              <Icon name="search" size={14} />
              <input ref={searchRef} className="input" placeholder={`Search all mail or ask (${mac ? '⌘K' : 'Ctrl+K'})`} title="Filters: from: to: subject: has:attachment is:unread in: label: before: after:" value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); else if (e.key === 'Enter' && /\?\s*$/.test(query)) void askMail(); }} aria-label="Search mail" />
            </div>
            {searching ? <button className="btn sm ghost" title="Ask your mail (answers from the messages that fit, with sources)" onClick={() => void askMail()} data-testid="mail-ask-btn"><Icon name="sparkle" size={13} /> Ask</button> : null}
            <button className="btn icon sm" title="Check for new mail" aria-label="Check for new mail" onClick={() => void refresh()}>{refreshing ? <div className="spinner" /> : <Icon name="refresh" size={14} />}</button>
            <button className="btn icon sm" title={layout === 'wide' ? 'List beside the message' : 'Wide list with bulk actions'} aria-label="Change layout" onClick={() => void api.pim.setPrefs({ mailLayout: layout === 'wide' ? 'split' : 'wide' }).then(setPrefs)}><Icon name={layout === 'wide' ? 'columns' : 'list'} size={14} /></button>
          </div>
          {inboxView && splitOn ? (
            <div className="mail-tabs" role="tablist" data-testid="mail-tabs">
              {([['all', 'All', list.counts?.all], ['important', 'Primary', list.counts?.important], ['updates', 'Updates', list.counts?.updates], ['promos', 'Promos', list.counts?.promos]] as const).map(([t, label, n]) => (
                <button key={t} role="tab" aria-selected={(view.tab ?? 'all') === t} className={(view.tab ?? 'all') === t ? 'on' : ''} onClick={() => showTab(t)}>{label}{n ? <span className="count">{n}</span> : null}</button>
              ))}
              <span className="grow" />
              <button className={`btn sm ghost ${view.filter === 'unread' ? 'on' : ''}`} aria-pressed={view.filter === 'unread'} title="Only unread" data-testid="mail-unread-only" onClick={() => setView({ ...view, filter: view.filter === 'unread' ? 'all' : 'unread' })}><Icon name="mail" size={12} /> Unread</button>
            </div>
          ) : null}
          {!searching ? (
            <div className="mail-list-filters">
              <div className="seg">
                {(['all', 'unread', 'flagged', 'attachments'] as const).map((f) => <button key={f} className={view.filter === f ? 'on' : ''} onClick={() => setView({ ...view, filter: f })}>{f === 'all' ? 'All' : f === 'unread' ? 'Unread' : f === 'flagged' ? 'Flagged' : 'Attachments'}</button>)}
              </div>
              <button className={`btn sm ghost ${view.threaded ? 'on' : ''}`} title="Group into conversations" onClick={() => setView({ ...view, threaded: !view.threaded })}><Icon name="list" size={13} /> {view.threaded ? 'Conversations' : 'Messages'}</button>
            </div>
          ) : null}
          {checked.size || layout === 'wide' ? (
            <div className="mail-bulk">
              <button className="btn sm ghost" onClick={() => setChecked(checked.size === rows.length ? new Set() : new Set(rows.map((r) => r.last.id)))}>{checked.size === rows.length && rows.length ? 'Select none' : 'Select all'}</button>
              <span className="grow small">{checked.size ? `${checked.size} selected` : ''}</span>
              {checked.size ? (
                <>
                  <button className="btn sm ghost" onClick={() => void act(() => api.pim.setRead([...checked], true))}>Mark read</button>
                  <button className="btn sm ghost" onClick={() => void act(() => api.pim.setRead([...checked], false))}>Unread</button>
                  <button className="btn sm ghost" onClick={(e) => snoozeMenu(e.clientX, e.clientY + 10, [...checked])}>Snooze</button>
                  <button className="btn sm ghost" onClick={() => void act(() => addToTasks(rows.map((r) => r.last).filter((m) => checked.has(m.id))), checked.size === 1 ? 'Added to Tasks' : `Added ${checked.size} tasks`)}>Add to Tasks</button>
                  <button className="btn sm ghost" onClick={() => void act(() => api.pim.archive([...checked]), 'Archived')}>Archive</button>
                  <button className="btn sm ghost" onClick={() => void act(() => api.pim.trash([...checked]), 'Moved to Trash')}>Delete</button>
                  <button aria-label="Clear selection" title="Clear selection" className="btn sm ghost icon" onClick={() => setChecked(new Set())}><Icon name="close" size={13} /></button>
                </>
              ) : null}
            </div>
          ) : null}
          {layout === 'wide' && current ? <div className="mail-reader wide-reader">{reader}</div> : rowsEl}
        </section>
      )}

      {layout === 'split' && !side ? (
        <section className="mail-reader">
          {reader ?? <div className="mail-reader-empty"><Icon name="mail" size={44} stroke={1.2} /><div className="muted">Select a message</div><div className="small muted">{prefs?.shortcutScheme === 'apple' ? '↑ / ↓ to move · ⌘R reply · ⌫ delete · ⌘N new message' : prefs?.shortcutScheme === 'superhuman' ? 'j / k to move · e done · h snooze · r reply · c new message' : 'j / k to move · r reply · e archive · b snooze · # delete · c new message'}</div></div>}
        </section>
      ) : null}

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

      {compose ? <Compose draft={compose} accounts={mailAccounts} onClose={() => setCompose(null)} onSent={(o) => { setCompose(null); toast(o.scheduled ? `Will send ${new Date(o.sendAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Sending…'); loadOutbox(); }} /> : null}
      {adding ? <AccountDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); loadAccounts(); }} /> : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

/** "Add to Tasks": one task per message, titled with its subject, linking back to it. */
async function addToTasks(ms: MessageSummary[]) {
  for (const m of ms) await api.pim.saveReminder({ id: '', list: '', title: m.subject || '(no subject)', notes: notesFromMessage(m), url: mailLink(m.id), done: false });
}

function Conversation({ row, accounts, mine, prefs, onReply, act, onBack, wide, onSnooze, onMenu }: {
  row: { last: MessageSummary; thread?: Thread };
  accounts: Account[];
  mine: Set<string>;
  prefs: PimPrefsView | null;
  onReply: (mode: 'reply' | 'replyAll' | 'forward', id: string, body?: string) => void;
  act: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
  onBack: () => void;
  wide: boolean;
  onSnooze: (x: number, y: number) => void;
  onMenu: (x: number, y: number, items: MenuItem[]) => void;
}) {
  const { toast } = useStore();
  const msgs = row.thread ? row.thread.messages : [row.last];
  const [open, setOpen] = useState<Set<string>>(new Set([msgs[msgs.length - 1].id]));
  const [ai, setAi] = useState<{ task: string; text: string; options?: string[]; events?: { title: string; start: number; end: number; allDay: boolean }[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const last = msgs[msgs.length - 1];
  const ids = msgs.map((m) => m.id);
  const acct = accounts.find((a) => a.id === last.account);
  const [chat, setChat] = useState(acct?.readingView === 'chat');
  const sentByMe = !!last.from && mine.has(last.from.address.toLowerCase());
  const [remindAt, setRemindAt] = useState<number | undefined>();
  useEffect(() => { if (sentByMe) void api.pim.noReplyReminders().then((l) => setRemindAt(l.find((r) => r.messageId === last.messageId)?.at)); }, [last.id, sentByMe]);

  const runAi = async (task: 'summarize' | 'replies' | 'extract' | 'translate') => {
    setBusy(task);
    try {
      const r = await api.pim.ai(last.id, task, task === 'translate' ? { lang: langName() } : undefined);
      setAi({ task, ...r });
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const aiBtn = (task: 'summarize' | 'replies' | 'extract' | 'translate', icon: string, label: string) => <button className="btn sm ghost" disabled={!!busy} onClick={() => void runAi(task)}>{busy === task ? <div className="spinner" /> : <Icon name={icon} size={13} />} {label}</button>;
  const more = (e: React.MouseEvent) => onMenu(e.clientX - 180, e.clientY + 12, [
    { label: chat ? 'Show as messages' : 'Show as chat', icon: 'list', run: () => setChat(!chat) },
    { label: 'Print…', icon: 'document', run: () => void printMessage(last.id).catch((x) => toast(errText(x))) },
    { label: 'Save as PDF…', icon: 'down', run: () => void api.pim.savePdf(last.id).then((p) => p && toast(`Saved ${p.split(/[\\/]/).pop()}`), (x) => toast(errText(x))) },
    { sep: true, label: '' },
    { label: 'Mute conversation', icon: 'eyeOff', run: () => void act(() => api.pim.mute(ids, true), 'Muted: new mail in it skips the inbox') },
    ...(last.from && !sentByMe ? [{ label: `Block ${last.from.address}`, icon: 'lock', run: () => void act(() => api.pim.block(last.from!.address, true), `Blocked ${last.from!.address}`) }] : []),
    { label: 'Report spam', icon: 'warning', danger: true, run: () => void act(() => api.pim.reportSpam([last.id]), 'Moved to Junk; the sender is blocked') },
  ]);

  return (
    <div className="conversation">
      <div className="reader-toolbar">
        <button className={`btn sm ghost back-btn ${wide ? 'always' : ''}`} title="Back to the list (Esc)" data-testid="mail-back" onClick={onBack}><Icon name="chevronLeft" size={14} /> Back</button>
        <button className="btn sm ghost" title="Reply" onClick={() => onReply('reply', last.id)}><Icon name="reply" size={14} /> Reply</button>
        <button className="btn sm ghost" title="Reply all" aria-label="Reply all" onClick={() => onReply('replyAll', last.id)}><Icon name="replyAll" size={14} /></button>
        <button className="btn sm ghost" title="Forward" aria-label="Forward" onClick={() => onReply('forward', last.id)}><Icon name="forward" size={14} /></button>
        <span className="sep" />
        <button className="btn sm ghost" title="Archive" aria-label="Archive" onClick={() => void act(() => api.pim.archive(ids), 'Archived')}><Icon name="archive" size={14} /></button>
        <button className="btn sm ghost" title="Delete" aria-label="Delete" onClick={() => void act(() => api.pim.trash(ids), 'Moved to Trash')}><Icon name="trash" size={14} /></button>
        <button className="btn sm ghost" title="Snooze" aria-label="Snooze" onClick={(e) => onSnooze(e.clientX, e.clientY + 10)}><Icon name="clock" size={14} /></button>
        <button className="btn sm ghost" title="Flag" aria-label="Flag" onClick={() => void act(() => api.pim.setFlagged([last.id], !last.flagged))}><Icon name="flag" size={14} style={last.flagged ? { color: 'var(--warn)' } : undefined} /></button>
        <button className="btn sm ghost" title="Mark as unread" aria-label="Mark as unread" onClick={() => void act(() => api.pim.setRead([last.id], false))}><Icon name="mail" size={14} /></button>
        <button className="btn sm ghost" title="Add to Tasks (the task links back to this email)" aria-label="Add to Tasks" data-testid="mail-add-task" onClick={() => void act(() => addToTasks([last]), 'Added to Tasks')}><Icon name="listCheck" size={14} /></button>
        {sentByMe ? <button className={`btn sm ghost ${remindAt ? 'on' : ''}`} title={remindAt ? `Reminder ${new Date(remindAt).toLocaleString()} if no reply` : 'Remind me if no reply'} aria-label="Remind me if no reply" data-testid="mail-remind" onClick={(e) => onMenu(e.clientX, e.clientY + 12, remindMenu(Date.now(), (at) => void act(async () => { await api.pim.remindNoReply(last.id, at); setRemindAt(at ?? undefined); }, at ? `I’ll remind you ${new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} if nobody answers` : 'Reminder cancelled'), remindAt))}><Icon name="alarm" size={14} /></button> : null}
        <button className="btn sm ghost" title="More" aria-label="More" data-testid="mail-more" onClick={more}><Icon name="chevronDown" size={14} /></button>
        <span className="grow" />
        {aiBtn('summarize', 'sparkle', 'Summarize')}
        {aiBtn('replies', 'sparkle', 'Reply ideas')}
        {aiBtn('translate', 'globe', 'Translate')}
        {aiBtn('extract', 'calendar', 'Find dates')}
      </div>
      <h2 className="reader-subject">{last.security ? <span className="pill danger" style={{ marginRight: 8 }}><Icon name="shield" size={11} /> Security</span> : null}{last.subject}</h2>
      {ai ? (
        <div className="ai-card" data-testid="mail-ai-card">
          <div className="row" style={{ gap: 6 }}><Icon name="sparkle" size={13} /><b>{ai.task === 'summarize' ? 'Summary' : ai.task === 'replies' ? 'Reply ideas, in your voice' : ai.task === 'translate' ? `In ${langName()}` : ai.task === 'reply' ? 'Suggested reply' : 'Dates found'}</b><span className="grow" /><button aria-label="Close" title="Close" className="btn sm ghost icon" onClick={() => setAi(null)}><Icon name="close" size={12} /></button></div>
          {ai.task === 'extract' && ai.events ? (
            ai.events.length ? ai.events.map((e, i) => (
              <div key={i} className="row" style={{ gap: 8, marginTop: 6 }}>
                <span className="grow">{e.title} · {new Date(e.start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: e.allDay ? undefined : 'numeric', minute: e.allDay ? undefined : '2-digit' })}</span>
                <button className="btn sm" onClick={() => void act(() => api.pim.saveEvent({ id: '', uid: '', calendar: '', title: e.title, start: e.start, end: e.end, allDay: e.allDay, description: notesFromMessage(last), url: mailLink(last.id) }), 'Added to your calendar')}>Add to calendar</button>
              </div>
            )) : <div className="small muted">No dates in this conversation.</div>
          ) : ai.task === 'replies' && ai.options?.length ? (
            <div className="reply-options">
              {ai.options.map((o, i) => (
                <button key={i} className="reply-option" onClick={() => onReply('reply', last.id, o)} title="Use this reply">
                  <span className="small muted">{['Yes', 'Ask or suggest', 'Not now'][i] ?? `Option ${i + 1}`}</span>
                  <span className="reply-option-text">{o}</span>
                </button>
              ))}
            </div>
          ) : <div className="ai-text">{ai.text}</div>}
          {ai.task === 'reply' ? <button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => onReply('reply', last.id, ai.text)}>Use this reply</button> : null}
        </div>
      ) : null}
      {chat ? <ChatThread msgs={msgs} mine={mine} onSent={() => toast('Sending…')} onFull={(id, body) => onReply('reply', id, body)} /> : msgs.map((m) => open.has(m.id)
        ? <MessageCard key={m.id} summary={m} accounts={accounts} prefs={prefs} onCollapse={msgs.length > 1 ? () => setOpen(new Set([...open].filter((x) => x !== m.id))) : undefined} act={act} onGone={onBack} />
        : (
          <button key={m.id} className="message-collapsed" onClick={() => setOpen(new Set([...open, m.id]))}>
            <b>{m.from?.name || m.from?.address}</b><span className="grow ellipsis muted">{m.snippet}</span><span className="small muted">{when(m.date)}</span>
          </button>
        ))}
    </div>
  );
}

/** Prints the message (the system's print window; Save as PDF is there too on a Mac). */
async function printMessage(id: string) {
  const html = await api.pim.printable(id);
  const f = document.createElement('iframe');
  f.style.position = 'fixed';
  f.style.width = '0';
  f.style.height = '0';
  f.style.border = '0';
  f.setAttribute('sandbox', 'allow-modals allow-same-origin');
  f.srcdoc = html;
  document.body.appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  f.contentWindow?.print();
  setTimeout(() => f.remove(), 1000);
}

function iframeDoc(html: string, o: { allowRemote: boolean; dark: boolean; plain: boolean; size: number; darken: boolean }): string {
  const { allowRemote, dark, plain, size } = o;
  const csp = `default-src 'none'; img-src data: cid:${allowRemote ? ' https: http:' : ''}; style-src 'unsafe-inline'${allowRemote ? ' https:' : ''}; font-src data:${allowRemote ? ' https:' : ''}; media-src 'none'; form-action 'none'`;
  // Plain mail follows Keeper's theme; designed mail keeps its white page (a light card), or is darkened when chosen.
  const base = plain
    ? `body{margin:0;padding:4px 2px;font:${size}px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:${dark ? '#e8e8ea' : '#1c1c1e'};background:transparent}a{color:${dark ? '#7ab8ff' : '#0a66d0'}}`
    : `body{margin:0;padding:12px;font:${size}px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#1c1c1e;background:#fff;border-radius:10px}img{max-width:100%;height:auto}img[data-blocked-src]{display:inline-block;min-width:60px;min-height:40px;background:#eee repeating-linear-gradient(45deg,#e8e8e8 0 8px,#f2f2f2 8px 16px);border-radius:6px}blockquote{border-left:3px solid #ccc;margin:0 0 0 4px;padding-left:10px;color:#555}pre{white-space:pre-wrap}table{max-width:100%}${o.darken ? 'html{filter:invert(.9) hue-rotate(180deg)}img,video,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}' : ''}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${base}</style></head><body>${html}</body></html>`;
}

function MessageCard({ summary, accounts, prefs, onCollapse, act, onGone }: { summary: MessageSummary; accounts: Account[]; prefs: PimPrefsView | null; onCollapse?: () => void; act: (fn: () => Promise<unknown>, done?: string) => Promise<void>; onGone: () => void }) {
  const { toast, info } = useStore();
  const [msg, setMsg] = useState<OpenMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  const [height, setHeight] = useState(240);
  const [look, setLook] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // The appearance Keeper resolved (Light, Dark, or the system's), not only the system's.
  const dark = document.documentElement.dataset.theme === 'dark';

  useEffect(() => {
    let alive = true;
    setError(null);
    api.pim.open(summary.id, { allowRemote: remote }).then((m) => alive && setMsg(m)).catch((e) => alive && setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)));
    return () => { alive = false; };
  }, [summary.id, remote]);
  // ⇧⌘I: Load images.
  useEffect(() => {
    const on = () => setRemote(true);
    window.addEventListener('mail-load-images', on);
    return () => window.removeEventListener('mail-load-images', on);
  }, []);

  // The frame cannot run scripts, so its height is estimated from the content and adjusted on load.
  const size = prefs?.mailTextSize ?? 14;
  useEffect(() => {
    if (!msg) return;
    const text = msg.html.replace(/<[^>]+>/g, ' ');
    const est = Math.min(4000, Math.max(160, Math.ceil(text.length / 90) * Math.round(size * 1.6) + (msg.html.match(/<img/g)?.length ?? 0) * 180 + 60));
    setHeight(est);
  }, [msg, size]);

  const plain = !!msg && !/<(table|div|p|img|h\d|span)\b/i.test(msg.html.replace(/^<div style="white-space:pre-wrap[^>]*>/, ''));
  const acct = accounts.find((a) => a.id === summary.account);
  const darken = dark && !plain && prefs?.darkMail === 'dark';

  return (
    <article className={`message-card ${dark && !plain && !darken && msg?.designed ? 'light-card' : ''}`}>
      <header className="message-head" onClick={onCollapse}>
        <SenderAvatar from={summary.from} />
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
          <PhishBanner msg={msg} onDone={onGone} />
          <CodeBanner msg={msg} />
          {msg.invite ? <InviteCard msg={msg} act={act} /> : null}
          {msg.blocked > 0 || msg.trackers > 0 || msg.cleanedLinks ? (
            <div className="banner" data-testid="mail-privacy-banner">
              <Icon name="eyeOff" size={14} />
              <span className="grow">{[msg.blocked ? `${msg.blocked} picture${msg.blocked === 1 ? '' : 's'} from the internet held back.` : '', msg.trackers ? `${msg.trackers} tracking pixel${msg.trackers === 1 ? '' : 's'} removed.` : '', msg.cleanedLinks ? `Tracking taken off ${msg.cleanedLinks} link${msg.cleanedLinks === 1 ? '' : 's'}.` : ''].filter(Boolean).join(' ')}</span>
              {msg.blocked ? <button className="btn sm" title={info?.platform === 'darwin' ? '⇧⌘I' : 'Ctrl+Shift+I'} onClick={() => setRemote(true)}>Load images</button> : null}
              {msg.blocked && summary.from ? <button className="btn sm ghost" onClick={() => { void api.pim.trustSender(summary.from!.address); setRemote(true); }}>Always from this sender</button> : null}
            </div>
          ) : null}
          {msg.receiptAsked ? <div className="banner subtle small"><Icon name="info" size={13} /> The sender asked to be told when you read this. Keeper never tells them.</div> : null}
          {msg.unsubscribe ? (
            <div className="banner subtle">
              <Icon name="mail" size={14} /><span className="grow">This is from a mailing list.</span>
              <button className="btn sm ghost" onClick={async () => { const r = await api.pim.unsubscribe(summary.id); toast(r.how); }}>Unsubscribe</button>
            </div>
          ) : null}
          <iframe ref={frame} className="message-frame" title={`Message: ${summary.subject}`} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={iframeDoc(msg.html, { allowRemote: remote, dark, plain, size, darken })} style={{ height }} />
          {msg.attachments.filter((a) => !a.inline).length ? (
            <div className="attachments">
              {msg.attachments.filter((a) => !a.inline).map((a) => (
                <div key={a.id} className="attachment" title={a.filename}>
                  <Icon name={/pdf|text|word|sheet|presentation/.test(a.contentType) ? 'document' : /image/.test(a.contentType) ? 'image' : /calendar/.test(a.contentType) ? 'calendar' : 'paperclip'} size={18} />
                  <div className="grow" style={{ minWidth: 0 }}><div className="ellipsis">{a.filename}</div><div className="small muted">{formatBytes(a.size)}</div></div>
                  <button className="btn sm ghost icon" title="Quick Look" aria-label="Quick Look" data-testid="mail-quicklook-btn" onClick={() => setLook(a.id)}><Icon name="eye" size={13} /></button>
                  <button className="btn sm ghost icon" title="Open" aria-label="Open" onClick={() => void act(() => api.pim.openAttachment(summary.id, a.id))}><Icon name="external" size={13} /></button>
                  <button className="btn sm ghost icon" title={`Save to ${info?.platform === 'win32' ? 'a folder' : 'Downloads'}`} aria-label={`Save to ${info?.platform === 'win32' ? 'a folder' : 'Downloads'}`} onClick={async () => { const p = await api.pim.saveAttachment(summary.id, a.id); if (p) toast(`Saved ${p.split(/[\\/]/).pop()}`); }}><Icon name="down" size={13} /></button>
                </div>
              ))}
            </div>
          ) : null}
          {look ? <QuickLook id={summary.id} att={look} onClose={() => setLook(null)} /> : null}
        </>
      ) : null}
    </article>
  );
}

function InviteCard({ msg, act }: { msg: OpenMessage; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const { toast } = useStore();
  const e = msg.invite!.event;
  const [mine, setMine] = useState(msg.invite!.mine);
  const answer = (s: 'accepted' | 'declined' | 'tentative') => void act(async () => { const r = await api.pim.respond(msg.summary.id, s); setMine(s); if (r && !r.sent) toast('Saved in your calendar. No reply was sent: this account has no outgoing mail server, so the organiser does not know.'); });
  if (msg.invite!.method === 'CANCEL') return <div className="banner warn"><Icon name="calendar" size={14} /> This event was cancelled: {e.title}</div>;
  if (msg.invite!.method === 'REPLY') return <div className="banner subtle"><Icon name="calendar" size={14} /> {e.attendees?.[0]?.name ?? e.attendees?.[0]?.email} answered {e.attendees?.[0]?.status ?? ''} for {e.title}</div>;
  return (
    <div className="invite-card" data-testid="mail-invite">
      <div className="invite-date"><div className="small">{new Date(e.start).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</div><div className="big">{new Date(e.start).getDate()}</div></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <b>{e.title}</b>
        <div className="small muted">{new Date(e.start).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })} – {new Date(e.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{e.location ? ` · ${e.location}` : ''}</div>
        {e.organizer ? <div className="small muted">From {e.organizer.name ?? e.organizer.email}{e.attendees?.length ? ` · ${e.attendees.length} invited` : ''}</div> : null}
      </div>
      <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
        <div className="seg">
          <button className={mine === 'accepted' ? 'on' : ''} onClick={() => answer('accepted')}>Accept</button>
          <button className={mine === 'tentative' ? 'on' : ''} onClick={() => answer('tentative')}>Maybe</button>
          <button className={mine === 'declined' ? 'on' : ''} onClick={() => answer('declined')}>Decline</button>
        </div>
        <button className="link-like small" data-testid="mail-invite-add" title="Into your calendar without answering the organiser" onClick={() => void act(() => api.pim.saveEvent({ ...e, id: '', calendar: '', description: [e.description, notesFromMessage(msg.summary)].filter(Boolean).join('\n\n'), url: e.url ?? mailLink(msg.summary.id) }), 'Added to your calendar; no answer was sent')}>Add to Calendar</button>
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
