// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Mail on the desktop: the unread count, the newest inbox messages (medium
// and large), and each account with its unread mail (small and medium).
// Clicking opens Mail in Keeper; nothing here changes mail.

import { useEffect, useState } from 'react';
import type { WidgetConfig } from '../../core/widgets';
import type { Account, MessageSummary } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';

function useMail(kind: 'counts' | 'inbox' | 'accounts', limit = 6) {
  const [counts, setCounts] = useState<{ byAccount: Record<string, number>; all: number; important: number } | null>(null);
  const [list, setList] = useState<MessageSummary[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    if (!api.pim?.unreadCounts) return undefined;
    const load = () => {
      void api.pim.unreadCounts().then(setCounts).catch(() => undefined);
      if (kind === 'inbox') void api.pim.messages({ folder: 'unified', tab: 'important' }).then((r) => setList(r.messages.slice(0, limit))).catch(() => undefined);
      if (kind === 'accounts') void api.pim.accounts().then((a) => setAccounts(a.filter((x) => x.mail))).catch(() => undefined);
    };
    load();
    const t = setInterval(load, 120_000);
    const off = api.on('pim-changed', ((k: string) => { if (k === 'mail' || k === 'accounts') load(); }) as never);
    return () => { clearInterval(t); off(); };
  }, [kind, limit]);
  return { counts, list, accounts };
}

const open = (route = 'mail') => void api.islandx.showPage(route).catch(() => undefined);

export function MailUnreadWidget() {
  const { counts } = useMail('counts');
  return (
    <button className="wg-mail wg-plain" onClick={() => open()} data-testid="widget-mail-unread">
      <div className="wg-title"><Icon name="mail" size={13} /> Mail</div>
      <div className="wg-big num">{counts?.all ?? '–'}</div>
      <div className="wg-dim">{counts ? `unread · ${counts.important} important` : 'unread'}</div>
    </button>
  );
}

export function MailInboxWidget({ w }: { w: WidgetConfig }) {
  const rows = w.bounds.height > 300 ? 8 : 4;
  const { counts, list } = useMail('inbox', rows);
  return (
    <div className="wg-mail" data-testid="widget-mail-inbox">
      <div className="wg-title"><Icon name="inbox" size={13} /> Important{counts ? ` · ${counts.important} unread` : ''}</div>
      {list.length ? list.map((m) => (
        <button key={m.id} className={`wg-mail-row ${m.seen ? '' : 'unread'}`} onClick={() => open(`mail:${m.id}`)}>
          <b className="ellipsis">{m.from?.name || m.from?.address}</b>
          <span className="ellipsis">{m.subject}</span>
        </button>
      )) : <div className="wg-dim">Nothing waiting</div>}
    </div>
  );
}

export function MailAccountsWidget({ w }: { w: WidgetConfig }) {
  const { counts, accounts } = useMail('accounts');
  const small = w.bounds.width < 230;
  return (
    <div className="wg-mail" data-testid="widget-mail-accounts">
      <div className="wg-title"><Icon name="mail" size={13} /> Accounts</div>
      {accounts.slice(0, small ? 3 : 6).map((a) => (
        <button key={a.id} className="wg-mail-row acct" onClick={() => open('mail')}>
          {a.picture ? <img src={a.picture} alt="" className="acct-pic" /> : <i style={{ background: a.color ?? 'var(--accent)' }} />}
          <span className="ellipsis grow">{small ? a.label.split(/[@\s]/)[0] : a.label}</span>
          <b className="num">{counts?.byAccount[a.id] ?? 0}</b>
        </button>
      ))}
      {!accounts.length ? <div className="wg-dim">No mail accounts</div> : null}
    </div>
  );
}
