// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The top of Mail's inbox: a greeting and today's date, today's events as
// cards (the running one marked, Join for video meetings), the meeting chip
// for the bar at the top of the window, the filter chips, the column of
// account pictures beside the folders, and "Updated 2 minutes ago".

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgendaItem } from '../../core/pim/agenda';
import { accountLook, chipCount, chipMeeting, chipsFor, eventNote, eventStatus, greeting, nextLine, todayLine, todayStrip, updatedText, type ChipId, type TodayStrip } from '../../core/pim/mail-today';
import type { Account, CalendarInfo, Occurrence } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useStore } from '../state';

export const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** The time now, moving on every `ms` (and when the window comes back into view). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), ms);
    const vis = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', vis); };
  }, [ms]);
  return now;
}

/** Today's events from every visible calendar Keeper reads (this computer's, Google, Microsoft, CalDAV, subscriptions). */
export function useToday(on: boolean): { strip: TodayStrip | null; now: number } {
  const now = useNow();
  const [data, setData] = useState<{ occ: Occurrence[]; cals: CalendarInfo[] } | null>(null);
  const day = new Date(now).toDateString();
  const load = useCallback(() => {
    if (!on || !api.pim) return;
    const from = new Date(day).getTime();
    const to = from + 2 * 86_400_000;
    void Promise.all([api.pim.occurrences(from, to), api.pim.calendars()]).then(([occ, cals]) => setData({ occ, cals }), () => setData(null));
  }, [on, day]);
  useEffect(load, [load]);
  useEffect(() => api.on('pim-changed', ((k: string) => { if (k === 'calendar' || k === 'accounts') load(); }) as never), [load]);
  return { strip: on && data ? todayStrip(data.occ, data.cals, now) : null, now };
}

const join = (url: string) => void api.system.openExternal(url);

function JoinButton({ e }: { e: AgendaItem }) {
  if (!e.join) return null;
  return (
    <button className="btn sm primary today-join" title={e.provider ? `Join on ${e.provider}` : 'Join the meeting'} aria-label={`Join ${e.title}${e.provider ? ` on ${e.provider}` : ''}`} data-testid="mail-today-join"
      onClick={(x) => { x.stopPropagation(); join(e.join!); }}>
      <Icon name="video" size={12} /> Join
    </button>
  );
}

/** The greeting, today's date and today's events. */
export function TodayHeader({ name, strip, now }: { name?: string; strip: TodayStrip | null; now: number }) {
  const row = useRef<HTMLDivElement>(null);
  const items = (strip?.items ?? []).filter((i) => !i.past || i.allDay || now - i.end < 2 * 3_600_000);
  const line = strip ? nextLine(strip, clock) : undefined;
  // Arrow keys move between the cards; the running one is scrolled into view.
  useEffect(() => { row.current?.querySelector<HTMLElement>('.today-card.now, .today-card.next')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [strip?.items.length]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const cards = [...(row.current?.querySelectorAll<HTMLElement>('.today-open') ?? [])];
    const i = cards.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))]?.focus();
  };
  return (
    <header className="mail-today" data-testid="mail-today" aria-label="Today">
      <div className="today-hello">
        <h1 className="today-greeting">{greeting(now, name)}</h1>
        <div className="today-date">{todayLine(now)}</div>
      </div>
      {items.length ? (
        <>
          <div className="today-strip" ref={row} role="list" aria-label="Today’s events" onKeyDown={onKey} data-testid="mail-today-strip">
            {items.map((e) => {
              const st = eventStatus(e, strip!, now);
              return (
                <div key={e.key} role="listitem" className={`today-card ${st}`} style={{ ['--cal' as string]: e.color }} data-testid="mail-today-card">
                  <button className="today-open" title={`${e.title} · ${e.calendarName}${e.location ? ` · ${e.location}` : ''}`} onClick={() => void api.pim.openEvent(e.eventId, e.instance)}>
                    <span className="today-time">{e.allDay ? 'All day' : clock(e.start)}{st === 'next' ? <span className="today-badge">Next</span> : null}</span>
                    <b className="today-title ellipsis">{e.title}</b>
                    <span className={`today-note ellipsis ${st === 'now' ? 'live' : ''}`}>{e.allDay ? e.calendarName : eventNote(e, now, clock)}</span>
                  </button>
                  {st !== 'past' ? <JoinButton e={e} /> : null}
                </div>
              );
            })}
          </div>
          {line ? <div className="today-next" data-testid="mail-today-next"><Icon name="calendar" size={13} /><span className="grow ellipsis">{line}</span>{(strip!.current[0] ?? strip!.next)?.join ? <JoinButton e={(strip!.current[0] ?? strip!.next)!} /> : null}</div> : null}
        </>
      ) : null}
    </header>
  );
}

/** The meeting going on, or starting within 15 minutes, with Join: in the bar at the top of the window while Mail is open. */
export function MeetingChip() {
  const { settings, route } = useStore();
  const on = route.name === 'mail' && settings?.mailToday !== false;
  const { strip, now } = useToday(on);
  const e = strip ? chipMeeting(strip, now) : undefined;
  if (!on || !e) return null;
  const live = e.start <= now;
  return (
    <div className={`meeting-chip ${live ? 'live' : ''}`} role="group" aria-label={`${live ? 'Meeting now' : 'Next meeting'}: ${e.title}`} data-testid="meeting-chip" style={{ ['--cal' as string]: e.color }}>
      <i className="meeting-dot" aria-hidden />
      <button className="meeting-open ellipsis" title={`${e.title} · ${e.calendarName}`} onClick={() => void api.pim.openEvent(e.eventId, e.instance)}>
        <b className="ellipsis">{e.title}</b>
        <span className="muted">{live ? `until ${clock(e.end)}` : `${clock(e.start)} · ${Math.max(1, Math.ceil((e.start - now) / 60_000))} min`}</span>
      </button>
      <JoinButton e={e} />
    </div>
  );
}

/** Inbox (with its unread number), Primary, then icon chips for Updates, Promotions, Security, To Reply, Flagged and Attachments. */
export function MailChips({ split, active, counts, inboxUnread, onPick }: {
  split: boolean;
  active?: ChipId;
  counts?: { all?: number; important?: number; updates?: number; promos?: number };
  inboxUnread: number;
  onPick: (id: ChipId) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  // The chosen chip stays in view when the row is wider than the list.
  useEffect(() => { row.current?.querySelector<HTMLElement>('.mail-chip.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active]);
  return (
    <div className="mail-tabs mail-chips" ref={row} role="tablist" aria-label="Show" data-testid="mail-tabs">
      {chipsFor(split).map((c) => {
        const on = active === c.id;
        const n = chipCount(c.id, counts, inboxUnread);
        const label = `${c.label}${n ? `, ${n} unread` : ''}`;
        return (
          <button key={c.id} role="tab" aria-selected={on} aria-label={label} title={`${c.label}: ${c.hint}`} className={`mail-chip ${on ? 'on' : ''} ${c.text ? 'text' : 'icon-only'}`} data-chip={c.id} onClick={() => onPick(c.id)}>
            <Icon name={c.icon} size={13} />
            {c.text || on ? <span className="chip-label">{c.label}</span> : null}
            {n ? <span className="count">{n}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** An account's picture, or its initials on its colour. */
export function AccountAvatar({ a, size = 32 }: { a: Account; size?: number }) {
  if (a.picture) return <img className="rail-pic" src={a.picture} alt="" style={{ width: size, height: size }} />;
  const look = accountLook(a);
  return <span className="rail-initials" aria-hidden style={{ width: size, height: size, background: look.color, fontSize: Math.round(size * 0.38) }}>{look.letters}</span>;
}

/** The column of accounts beside the folders: every inbox, each account (⌘1…⌘9) with its unread number, and Add. */
export function AccountRail({ accounts, unread, totalUnread, current, mac, onAll, onAccount, onAdd }: {
  accounts: Account[];
  unread: Record<string, number>;
  totalUnread: number;
  current?: string | 'all';
  mac: boolean;
  onAll: () => void;
  onAccount: (a: Account) => void;
  onAdd: () => void;
}) {
  const badge = (n: number) => (n ? <span className="rail-badge" aria-hidden>{n > 99 ? '99+' : n}</span> : null);
  const key = (i: number) => (i < 9 ? ` (${mac ? '⌘' : 'Ctrl+'}${i + 1})` : '');
  return (
    <nav className="mail-rail" aria-label="Mail accounts" data-testid="mail-rail">
      <button className={`rail-item ${current === 'all' ? 'on' : ''}`} aria-current={current === 'all' ? 'true' : undefined} title={`All inboxes (${mac ? '⌘' : 'Ctrl+'}0)`} aria-label={`All inboxes${totalUnread ? `, ${totalUnread} unread` : ''}`} onClick={onAll}>
        <span className="rail-initials all" aria-hidden><Icon name="inbox" size={15} /></span>{badge(totalUnread)}
      </button>
      {accounts.map((a, i) => (
        <button key={a.id} className={`rail-item ${current === a.id ? 'on' : ''}`} aria-current={current === a.id ? 'true' : undefined} title={`${a.label}${a.email && a.email !== a.label ? ` · ${a.email}` : ''}${key(i)}`} aria-label={`${a.label}${unread[a.id] ? `, ${unread[a.id]} unread` : ''}`} onClick={() => onAccount(a)} data-testid="mail-rail-account">
          <AccountAvatar a={a} />{badge(unread[a.id] ?? 0)}
        </button>
      ))}
      <button className="rail-item add" title="Add an account" aria-label="Add an account" onClick={onAdd}><span className="rail-initials plus" aria-hidden><Icon name="plus" size={15} /></span></button>
    </nav>
  );
}

/** "Updated 2 minutes ago": click to check now. */
export function UpdatedFooter({ at, now, busy, onSync }: { at?: number; now: number; busy: boolean; onSync: () => void }) {
  return (
    <div className="mail-foot">
      <button className="mail-updated" onClick={onSync} disabled={busy} title="Check for new mail now" data-testid="mail-updated">
        {busy ? <div className="spinner" /> : <Icon name="refresh" size={12} />}
        <span>{busy ? 'Checking for new mail…' : updatedText(at, now)}</span>
      </button>
    </div>
  );
}
