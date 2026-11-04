// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Today, at the top of Hello: the one place that answers "what now?". Cards
// from one list (core/today.ts): Now and next (with Join, and the block you
// planned), your top three tasks, mail waiting for your reply, the Inbox, one
// Fix-it item and Focus. Plan my day is its one strong button. The pieces are
// the ones the Planner, Mail and the Island use (tasks-ui, agenda, focus), so
// a task ticked here is ticked everywhere. Nothing polls: lists follow the
// app's change events, and the clock moves twice a minute.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { currentBlock, plannedBlocks, type PlannedBlock } from '../../core/day-plan';
import { currentPreset } from '../../core/features';
import { attention, SNOOZE_MS } from '../../core/home-layout';
import { sortNudge } from '../../core/inbox';
import { agendaFor, type AgendaItem } from '../../core/pim/agenda';
import { inMailToday } from '../../core/pim/mail-today';
import { dayKey, isOverdue, type Task } from '../../core/pim/tasks';
import type { CalendarInfo, Occurrence } from '../../core/pim/types';
import { cardSpan, nowNext, replyLine, startsIn, timeLeft, todayCards, todayKicker, topTasks, type TodayCardId } from '../../core/today';
import { formatBytes } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, type MenuItem } from '../components/ui';
import { useFeature, useFeatureStates } from '../features';
import { openGuide, useGuideList } from '../guide';
import { clock, useNow } from '../pim/mail-today';
import { setDone, useTasks } from '../pim/tasks-ui';
import { useAsync, useStore } from '../state';
import { PlanMyDay, WrapUp } from './PlanMyDay';
import '../styles/today.css';

const join = (url: string) => void api.system.openExternal(url);
/** Today counts as seen after this long on screen. */
const SEEN_AFTER_MS = 4000;

/** Today's events and planned blocks, from every visible calendar, reloaded when calendars change. */
export function useDayEvents(on: boolean): { occ: Occurrence[]; cals: CalendarInfo[]; loaded: boolean; reload: () => void } {
  const now = useNow();
  const day = new Date(now).toDateString();
  const [data, setData] = useState<{ occ: Occurrence[]; cals: CalendarInfo[] } | null>(null);
  const load = useCallback(() => {
    if (!on || !api.pim) { setData({ occ: [], cals: [] }); return; }
    const from = new Date(day).getTime();
    void Promise.all([api.pim.occurrences(from, from + 86_400_000), api.pim.calendars()]).then(([occ, cals]) => setData({ occ, cals }), () => setData({ occ: [], cals: [] }));
  }, [on, day]);
  useEffect(load, [load]);
  useEffect(() => api.on('pim-changed', ((k: string) => { if (k === 'calendar' || k === 'accounts') load(); }) as never), [load]);
  return { occ: data?.occ ?? [], cals: data?.cals ?? [], loaded: !!data, reload: load };
}

interface Running { id: string; icon: string; label: string; detail: string; route: string }

/** Timers, a focus session, Keep Awake and a recording while they run (they follow their own change events). */
function useRunning(): Running[] {
  const [running, setRunning] = useState<Running[]>([]);
  const load = useCallback(() => {
    void Promise.all([
      api.pim?.alarms().catch(() => null),
      api.island?.state().catch(() => null),
      api.awake?.status().catch(() => null),
      api.studio?.state().catch(() => null),
    ]).then(([alarms, island, awake, studio]) => {
      const out: Running[] = [];
      for (const t of alarms?.timers ?? []) {
        if (t.endsAt) out.push({ id: `timer:${t.id}`, icon: 'timer', label: t.label || 'Timer', detail: `ends ${clock(t.endsAt)}`, route: 'alarms' });
        else if (t.leftMs) out.push({ id: `timer:${t.id}`, icon: 'timer', label: t.label || 'Timer', detail: `paused · ${Math.ceil(t.leftMs / 60_000)} min left`, route: 'alarms' });
      }
      const f = island?.focus;
      if (f && f.mode !== 'idle') out.push({ id: 'focus', icon: 'stopwatch', label: f.mode === 'break' ? 'Break' : 'Focus', detail: f.pausedLeft !== undefined ? 'paused' : f.endsAt ? `until ${clock(f.endsAt)}` : 'counting', route: 'planner' });
      if (awake?.on ?? island?.keepAwake?.on) {
        const until = awake?.session?.endsAt;
        out.push({ id: 'awake', icon: 'coffee', label: 'Keeping awake', detail: until ? `until ${clock(until)}` : 'until you stop it', route: 'awake' });
      }
      const rec = studio && (studio.phase === 'recording' || studio.phase === 'paused') ? studio.since : island?.recording?.since;
      if (rec) out.push({ id: 'rec', icon: 'camera', label: studio?.phase === 'paused' ? 'Recording paused' : 'Recording', detail: `since ${clock(rec)}`, route: 'studio' });
      setRunning(out);
    });
  }, []);
  useEffect(() => {
    load();
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(load, 500); };
    const offs = ['pim-changed', 'awake-changed', 'studio-changed', 'island-changed'].map((ch) => api.on(ch as 'pim-changed', soon as never));
    return () => { clearTimeout(t); offs.forEach((off) => off()); };
  }, [load]);
  return running;
}

/** How many messages wait for an answer (Mail's To Reply), from what is kept on this computer. */
function useReplyCount(on: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  const load = useCallback(() => {
    if (!on || !api.pim) return;
    void api.pim.messages({ folder: 'toreply' }).then((r) => setN(r.messages.length), () => setN(0));
  }, [on]);
  useEffect(load, [load]);
  useEffect(() => (on ? api.on('pim-changed', ((k: string) => { if (k === 'mail' || k === 'accounts') load(); }) as never) : undefined), [on, load]);
  return n;
}

/** How many things wait in the Inbox. */
export function useInboxCount(on: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!on || !api.inbox) return;
    void api.inbox.list().then((l) => setN(l.length), () => setN(0));
    return api.on('inbox-changed', (c: number) => setN(c));
  }, [on]);
  return n;
}

// ---------------------------------------------------------------- the cards

const SpanContext = createContext<TodayCardId[]>([]);

function Card({ id, kicker, children, wide }: { id: TodayCardId; kicker: string; children: React.ReactNode; wide?: boolean }) {
  const cards = useContext(SpanContext);
  return (
    <section className={`td-card${wide ? ' wide' : ''}`} style={{ ['--span' as string]: cardSpan(cards, id) }} data-card={id} data-testid={`today-card-${id}`} aria-label={kicker}>
      <div className="td-card-kicker">{kicker}</div>
      {children}
    </section>
  );
}

function NowCard({ items, blocks, tasks, now }: { items: AgendaItem[]; blocks: PlannedBlock[]; tasks: Task[]; now: number }) {
  const { go } = useStore();
  const nn = nowNext(items.filter((i) => !blocks.some((b) => b.eventId === i.eventId)), now);
  const block = currentBlock(blocks, now);
  const blockTask = block ? tasks.find((t) => t.id === block.taskId) : undefined;
  const head = nn.now ?? nn.next;
  return (
    <Card id="now" kicker={nn.now ? 'Now' : nn.next ? 'Next' : 'Calendar'} wide>
      {head ? (
        <div className="td-event" style={{ ['--cal' as string]: head.color }}>
          <i className="td-event-bar" aria-hidden />
          <button className="td-event-open" title={[head.title, head.location, head.calendarName].filter(Boolean).join(' · ')} onClick={() => void api.pim?.openEvent(head.eventId, head.instance)}>
            <b className="td-big ellipsis">{head.title}</b>
            <span className="td-sub">{nn.now ? `until ${clock(head.end)} · ${timeLeft(head.end, now)}` : `${clock(head.start)} · ${startsIn(head.start, now)}`}</span>
          </button>
          {head.join ? <button className="btn sm primary td-join" data-testid="today-join" title={head.provider ? `Join on ${head.provider}` : 'Join the meeting'} aria-label={`Join ${head.title}`} onClick={() => join(head.join!)}><Icon name="video" size={12} /> Join</button> : null}
        </div>
      ) : (
        <p className="td-quiet">{items.length ? 'Nothing else on the calendar today.' : 'Nothing on the calendar today.'}</p>
      )}
      {nn.now && nn.next ? <button className="td-then ellipsis" onClick={() => void api.pim?.openEvent(nn.next!.eventId, nn.next!.instance)}>Then {nn.next.title} at {clock(nn.next.start)}</button> : null}
      {block ? (
        <div className={`td-block ${blockTask?.done ? 'done' : ''}`} data-testid="today-block">
          <input type="checkbox" checked={!!blockTask?.done} disabled={!blockTask} aria-label={`Done: ${block.title}`} onChange={() => blockTask && void setDone(blockTask)} />
          <span className="ellipsis grow"><span className="td-tag">Planned</span> {block.title}</span>
          <span className="td-sub">{timeLeft(block.end, now)}</span>
        </div>
      ) : null}
      {nn.allDay.length ? <div className="td-allday">{nn.allDay.slice(0, 3).map((a) => <span key={a.key} className="td-chip" style={{ ['--cal' as string]: a.color }} title={a.calendarName}>{a.title}</span>)}</div> : null}
      <div className="td-card-foot">
        <button className="home-link quiet" onClick={() => go({ name: 'calendar' })}>{nn.later ? `${nn.later} more today` : 'Calendar'} <Icon name="chevronRight" size={11} /></button>
      </div>
    </Card>
  );
}

function TasksCard({ tasks, today, now, onPlan, planner }: { tasks: Task[]; today: string; now: number; onPlan?: () => void; planner: boolean }) {
  const { go } = useStore();
  const top = topTasks(tasks, today);
  return (
    <Card id="tasks" kicker="Top three" wide>
      {top.length ? (
        <ul className="td-tasks" aria-label="Top three tasks">
          {top.map((t) => (
            <li key={t.id} className={t.done ? 'done' : ''}>
              <input type="checkbox" checked={t.done} aria-label={`Done: ${t.title}`} onChange={() => void setDone(t)} />
              <button className="td-task ellipsis" title={t.notes ? `${t.title}\n${t.notes}` : t.title} onClick={() => go({ name: planner ? 'planner' : 'reminders', arg: planner ? `task:${t.id}` : undefined })}>{t.title}</button>
              {isOverdue(t, now) ? <span className="td-sub late">overdue</span> : t.due ? <span className="td-sub">{clock(t.due)}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="td-empty-tasks">
          <p className="td-quiet">Nothing planned for today yet.</p>
          {onPlan ? <button className="btn sm" onClick={onPlan}>Pick three tasks</button> : null}
        </div>
      )}
      <div className="td-card-foot">
        <button className="home-link quiet" onClick={() => go({ name: planner ? 'planner' : 'reminders' })}>All tasks <Icon name="chevronRight" size={11} /></button>
      </div>
    </Card>
  );
}

function StatCard({ id, kicker, n, line, zero, action }: { id: TodayCardId; kicker: string; n: number | null; line: string; zero: string; action: { label: string; run: () => void } }) {
  return (
    <Card id={id} kicker={kicker}>
      <button className="td-stat" onClick={action.run} title={action.label} aria-label={`${n ? line : zero}. ${action.label}`}>
        <span className="td-num">{n ?? '–'}</span>
        <span className="td-sub">{n ? line : zero}</span>
      </button>
      <div className="td-card-foot"><button className="home-link quiet" onClick={action.run}>{action.label} <Icon name="chevronRight" size={11} /></button></div>
    </Card>
  );
}

function FixitCard() {
  const { go } = useStore();
  const disks = useAsync(() => api.system.disks(), []);
  const [list, reload] = useGuideList();
  const disk = disks.data?.find((d) => d.system) ?? disks.data?.[0];
  const a = attention({ disk, findings: list?.findings.filter((f) => f.status === 'open') }, formatBytes);
  const act = () => (a?.action.finding ? openGuide(a.action.finding) : go({ name: (a?.action.route ?? 'todo') as 'cleanup' }));
  const later = async () => {
    const d = a?.dismiss;
    if (!d) return;
    if (d.how === 'trust') await api.guide?.trust([d.finding]).catch(() => undefined);
    else await api.guide?.setState(d.finding, { snoozedUntil: Date.now() + SNOOZE_MS }).catch(() => undefined);
    reload();
  };
  return (
    <Card id="fixit" kicker="One thing to fix">
      {a ? (
        <>
          <button className="td-fix ellipsis" title={a.detail || a.title} onClick={act}><Icon name={a.kind === 'space' ? 'broom' : 'shield'} size={13} /> {a.title}</button>
          <div className="td-card-foot">
            <button className="btn sm" data-testid="today-fixit-action" onClick={act}>{a.action.label}</button>
            {a.dismiss ? <button className="home-link quiet" onClick={() => void later()}>{a.dismiss.label}</button> : null}
          </div>
        </>
      ) : (
        <>
          <p className="td-quiet"><Icon name="check" size={13} /> All good on this computer.</p>
          <div className="td-card-foot"><button className="home-link quiet" onClick={() => go({ name: 'todo' })}>Fix-it List <Icon name="chevronRight" size={11} /></button></div>
        </>
      )}
    </Card>
  );
}

function FocusCard({ task, running }: { task?: Task; running?: Running }) {
  return (
    <Card id="focus" kicker="Focus">
      {running ? (
        <>
          <p className="td-big-line"><Icon name="stopwatch" size={14} /> {running.label} · {running.detail}</p>
          <div className="td-card-foot"><button className="btn sm" onClick={() => void api.island.focus('stop')}>Stop</button></div>
        </>
      ) : (
        <>
          <p className="td-quiet ellipsis" title={task?.title}>{task ? `25 minutes on “${task.title}”` : '25 minutes on one thing'}</p>
          <div className="td-card-foot">
            <button className="btn sm" data-testid="today-focus" onClick={() => void api.island.focus('start', 25, task ? { taskId: task.id, taskTitle: task.title } : undefined)}><Icon name="timer" size={12} /> Start focus</button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Today

export function TodaySection({ onHide, onChooseCards }: { onHide: () => void; onChooseCards: () => void }) {
  const { settings, updateSettings, go, route } = useStore();
  const states = useFeatureStates();
  const calendars = useFeature('calendars');
  const planOn = useFeature('dayPlan');
  const planner = useFeature('planner');
  const now = useNow();
  const today = dayKey(now);
  const ev = useDayEvents(calendars);
  const { tasks } = useTasks();
  const running = useRunning();
  const preset = useMemo(() => (settings ? currentPreset(settings) : undefined), [settings]);
  const t = settings?.today;
  const cards = t ? todayCards(t, preset, (f) => states?.get(f)?.on ?? true) : [];
  const reply = useReplyCount(cards.includes('reply'));
  const inbox = useInboxCount(cards.includes('inbox'));
  const [sheet, setSheet] = useState<'plan' | 'wrap' | null>(null);
  // Plan My Day and Wrap Up the Day from the command palette (Hello with plan or wrap).
  useEffect(() => {
    if (route.arg === 'plan' || route.arg === 'wrap') setSheet(route.arg);
  }, [route.arg]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const more = useRef<HTMLButtonElement>(null);

  // Seen today, once it has been on screen for a few seconds: Mail's own Today strip becomes one line (core/today.ts mailStripCompact).
  const seen = t?.seen;
  const latest = useRef(t);
  latest.current = t;
  useEffect(() => {
    if (!latest.current || seen === today) return;
    const timer = setTimeout(() => { if (!document.hidden && latest.current) void updateSettings({ today: { ...latest.current, seen: today } }); }, SEEN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [seen, today, updateSettings]);

  const items = useMemo(() => agendaFor(ev.occ, ev.cals, now, now, inMailToday), [ev.occ, ev.cals, now]);
  const blocks = useMemo(() => plannedBlocks(ev.occ, now), [ev.occ, now]);
  const evening = new Date(now).getHours() >= 16;
  const planned = blocks.length > 0;
  const focusRun = running.find((r) => r.id === 'focus');
  const others = running.filter((r) => r.id !== 'focus' || !cards.includes('focus'));
  const top = topTasks(tasks, today)[0];

  const menuItems: MenuItem[] = [
    ...(planOn ? [{ label: planned ? 'Plan my day again' : 'Plan my day', icon: 'calendar', run: () => setSheet('plan') }, { label: 'Wrap up the day', icon: 'check', run: () => setSheet('wrap') }] : []),
    { label: 'Choose cards…', icon: 'grid', run: onChooseCards },
    { label: 'Hide Today', icon: 'eyeOff', run: onHide },
  ];
  // One strong button: Plan my day in the morning, Wrap up later in the day once a plan exists.
  const main = !planOn ? null : evening && planned ? { label: 'Wrap up the day', run: () => setSheet('wrap'), id: 'today-wrap' } : !planned ? { label: 'Plan my day', run: () => setSheet('plan'), id: 'today-plan' } : null;

  const draw: Record<TodayCardId, () => React.ReactNode> = {
    now: () => <NowCard key="now" items={items} blocks={blocks} tasks={tasks} now={now} />,
    tasks: () => <TasksCard key="tasks" tasks={tasks} today={today} now={now} planner={planner} onPlan={planOn ? () => setSheet('plan') : undefined} />,
    reply: () => <StatCard key="reply" id="reply" kicker="To reply" n={reply} line={replyLine(reply ?? 0)} zero="Nobody is waiting on you" action={{ label: 'Open To Reply', run: () => go({ name: 'mail', arg: 'toreply' }) }} />,
    inbox: () => <StatCard key="inbox" id="inbox" kicker="Inbox" n={inbox} line={sortNudge(inbox ?? 0)} zero="Nothing to sort" action={{ label: inbox ? 'Sort now' : 'Open Inbox', run: () => go({ name: 'inbox' }) }} />,
    fixit: () => <FixitCard key="fixit" />,
    focus: () => <FocusCard key="focus" task={top} running={focusRun} />,
  };

  return (
    <section className="td" aria-labelledby="today-title" data-testid="home-today">
      <div className="td-head">
        <div className="grow">
          <div className="td-kicker">{todayKicker(now)}</div>
          <h2 id="today-title">Today</h2>
        </div>
        {main ? <button className="btn primary" data-testid={main.id} onClick={main.run}>{main.label}</button> : null}
        <button ref={more} className="btn ghost icon" data-testid="today-more" title="More for Today" aria-label="More for Today" aria-haspopup="menu" onClick={() => { const r = more.current!.getBoundingClientRect(); setMenu({ x: r.right - 220, y: r.bottom + 4 }); }}><Icon name="more" size={15} /></button>
      </div>
      {cards.length ? <SpanContext.Provider value={cards}><div className={`td-grid${cards.filter((c) => c !== 'now' && c !== 'tasks').length >= 4 ? ' many' : ''}`}>{cards.map((id) => draw[id]())}</div></SpanContext.Provider> : <p className="td-quiet">Choose what Today shows with More.</p>}
      {others.length ? (
        <ul className="td-running" aria-label="Running now">
          {others.map((r) => <li key={r.id}><button className="td-run" onClick={() => go({ name: r.route as 'awake' })}><Icon name={r.icon} size={12} /> {r.label} <span className="td-sub">{r.detail}</span></button></li>)}
        </ul>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} label="More for Today" /> : null}
      {sheet === 'plan' ? <PlanMyDay tasks={tasks} occ={ev.occ} cals={ev.cals} onClose={() => setSheet(null)} onDone={ev.reload} /> : null}
      {sheet === 'wrap' ? <WrapUp tasks={tasks} onClose={() => setSheet(null)} /> : null}
    </section>
  );
}
