// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail's own views beside the folders: sent mail waiting for an answer (with
// a one-click follow-up), newsletters to clean up (unsubscribe, archive
// everything from a sender), messages scheduled with Send later, and answers
// to questions asked of your mail.

import { useCallback, useEffect, useState } from 'react';
import type { Outbox, SubscriptionItem, WaitingItem } from '../../core/api-pim';
import type { Draft } from '../../core/pim/mail';
import type { MessageSummary } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty } from '../components/ui';
import { useStore } from '../state';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
const names = (list: { name?: string; address: string }[]) => list.map((a) => a.name || a.address).join(', ');

function ago(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

export function WaitingView({ onOpen, onCompose, reloadKey }: { onOpen: (id: string) => void; onCompose: (d: Draft & { account: string }) => void; reloadKey: number }) {
  const { toast } = useStore();
  const [items, setItems] = useState<WaitingItem[] | null>(null);
  const load = useCallback(() => void api.pim.waiting().then(setItems), []);
  useEffect(load, [load, reloadKey]);
  if (!items) return <div className="message-loading"><div className="spinner" /></div>;
  if (!items.length) return <div className="mail-view-empty"><Empty icon="send" title="Nobody owes you an answer">Sent mail that has had no reply in the last six weeks shows here, so nothing slips.</Empty></div>;
  const overdue = items.filter((i) => i.overdue).length;
  return (
    <div className="mail-view" data-testid="mail-waiting">
      <div className="mail-view-head">
        <h2>Waiting for reply</h2>
        <span className="muted small">{items.length} sent message{items.length === 1 ? '' : 's'} without an answer{overdue ? ` · ${overdue} waiting a while` : ''}</span>
      </div>
      {items.map((w) => (
        <div key={w.message.id} className={`waiting-row ${w.overdue ? 'late' : ''}`} onClick={() => onOpen(w.message.id)}>
          <div className="avatar sm" style={{ background: `hsl(${[...(w.to[0]?.address ?? '?')].reduce((h, c) => h + c.charCodeAt(0), 0) % 360} 55% 55%)` }}>{(w.to[0]?.name || w.to[0]?.address || '?').slice(0, 1).toUpperCase()}</div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}><b className="ellipsis">{names(w.to)}</b>{w.count > 1 ? <span className="mail-count">{w.count}</span> : null}</div>
            <div className="ellipsis">{w.message.subject}</div>
            <div className="small muted ellipsis">{w.message.snippet}</div>
          </div>
          <span className={`waiting-age ${w.overdue ? 'warn' : ''}`}>Sent {ago(w.days)}</span>
          <button className="btn sm primary" onClick={async (e) => { e.stopPropagation(); try { onCompose(await api.pim.followUp(w.message.id)); } catch (err) { toast(errText(err)); } }}><Icon name="reply" size={13} /> Follow up</button>
          <button className="btn sm ghost" title="Not waiting any more" onClick={(e) => { e.stopPropagation(); void api.pim.dismissWaiting(w.message.id).then(load); }}><Icon name="check" size={13} /> Done</button>
        </div>
      ))}
    </div>
  );
}

export function CleanupView({ reloadKey }: { reloadKey: number }) {
  const { toast } = useStore();
  const [items, setItems] = useState<SubscriptionItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => void api.pim.subscriptions().then(setItems), []);
  useEffect(load, [load, reloadKey]);
  const run = async (s: SubscriptionItem, action: 'unsubscribe' | 'archive' | 'both' | 'trash') => {
    setBusy(s.key);
    try {
      const r = await api.pim.cleanup(s.key, action);
      toast(`${s.name}: ${r.how || 'done'}`);
      load();
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
    }
  };
  if (!items) return <div className="message-loading"><div className="spinner" /></div>;
  if (!items.length) return <div className="mail-view-empty"><Empty icon="broom" title="No subscriptions found">Newsletters and other mailing-list mail you receive will be listed here with how often you open them.</Empty></div>;
  const never = items.filter((i) => i.neverOpened);
  return (
    <div className="mail-view" data-testid="mail-cleanup">
      <div className="mail-view-head">
        <h2>Subscriptions</h2>
        <span className="muted small">{items.length} sender{items.length === 1 ? '' : 's'}{never.length ? ` · ${never.length} you never open` : ''}</span>
        <span className="grow" />
        {never.length ? <button className="btn sm" disabled={!!busy} onClick={async () => { for (const s of never) await run(s, s.canUnsubscribe ? 'both' : 'archive'); }}><Icon name="broom" size={13} /> Clean up all never opened</button> : null}
      </div>
      <div className="small muted" style={{ margin: '0 0 10px' }}>Unsubscribing asks the sender directly (one-click where they offer it). Archiving moves everything from them out of your inbox; their future mail goes to Other.</div>
      {items.map((s) => (
        <div key={s.key} className="sub-row">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}><b className="ellipsis">{s.name}</b>{s.neverOpened ? <span className="pill warn">never opened</span> : null}</div>
            <div className="small muted ellipsis">{s.address}</div>
          </div>
          <div className="sub-stats">
            <div className="sub-bar" title={`${s.opened} of ${s.count} opened`}><i style={{ width: `${Math.round((s.opened / s.count) * 100)}%` }} /></div>
            <span className="small muted">{s.opened}/{s.count} opened</span>
          </div>
          {busy === s.key ? <div className="spinner" /> : null}
          {s.canUnsubscribe ? <button className="btn sm" disabled={!!busy} onClick={() => void run(s, 'both')}>Unsubscribe &amp; archive</button> : null}
          <button className="btn sm ghost" disabled={!!busy} onClick={() => void run(s, 'archive')}>Archive all</button>
          {s.canUnsubscribe ? <button className="btn sm ghost" disabled={!!busy} onClick={() => void run(s, 'unsubscribe')}>Unsubscribe</button> : null}
          <button className="btn sm ghost icon" title="Delete all from this sender" aria-label="Delete all from this sender" disabled={!!busy} onClick={() => { if (window.confirm(`Move all ${s.count} messages from ${s.name} to Trash?`)) void run(s, 'trash'); }}><Icon name="trash" size={13} /></button>
        </div>
      ))}
    </div>
  );
}

export function ScheduledView({ outbox, onEdit }: { outbox: Outbox[]; onEdit: (d: Draft & { account?: string }) => void }) {
  const list = outbox.filter((o) => o.scheduled && !o.error).sort((a, b) => a.sendAt - b.sendAt);
  if (!list.length) return <div className="mail-view-empty"><Empty icon="clock" title="Nothing scheduled">Choose Send later in a new message to have it go at a better time. It goes from this computer, so Keeper needs to be running then.</Empty></div>;
  return (
    <div className="mail-view">
      <div className="mail-view-head"><h2>Scheduled</h2><span className="muted small">Sent from this computer at the time shown</span></div>
      {list.map((o) => (
        <div key={o.id} className="sub-row">
          <Icon name="clock" size={16} />
          <div className="grow ellipsis"><b>{o.subject || '(no subject)'}</b></div>
          <span className="small muted">{new Date(o.sendAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          <button className="btn sm" onClick={async () => { const d = await api.pim.undoSend(o.id); if (d) onEdit(d as Draft & { account?: string }); }}>Edit or cancel</button>
        </div>
      ))}
    </div>
  );
}

export function AskCard({ answer, sources, onOpen, onClose }: { answer: string; sources: MessageSummary[]; onOpen: (id: string) => void; onClose: () => void }) {
  return (
    <div className="ai-card ask-card" data-testid="mail-ask">
      <div className="row" style={{ gap: 6 }}><Icon name="sparkle" size={13} /><b>From your mail</b><span className="grow" /><button aria-label="Close" title="Close" className="btn sm ghost icon" onClick={onClose}><Icon name="close" size={12} /></button></div>
      <div className="ai-text">{answer}</div>
      {sources.length ? (
        <div className="ask-sources">
          {sources.map((m, i) => <button key={m.id} className="link-like small" onClick={() => onOpen(m.id)}>[{i + 1}] {m.subject}</button>)}
        </div>
      ) : null}
    </div>
  );
}
