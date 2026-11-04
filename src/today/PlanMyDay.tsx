// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Plan my day and Wrap up the day: two short sheets over Hello's Today.
// Plan: pick up to three tasks, say about how long each takes, see them laid
// into the free time between your events, nudge them, and Add to calendar.
// Each block is an ordinary event that points back at its task, so the Island
// counts it down and ticking it on Today ticks the task. Wrap up: what is left
// moves to tomorrow, and one line can go in today's Journal entry.

import { useMemo, useState } from 'react';
import { blockEvent, ESTIMATES, freeSlots, guessMinutes, layOut, leftToday, PLAN_PICK, planCandidates, planWindow, shiftBlock, tomorrowOf, wrapUpLine, type Block, type Span } from '../../core/day-plan';
import { entryPath } from '../../core/notes/journal';
import { agendaFor } from '../../core/pim/agenda';
import { inMailToday } from '../../core/pim/mail-today';
import { dayKey, todayTasks, type Task } from '../../core/pim/tasks';
import type { CalendarInfo, Occurrence } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';
import { useFeature } from '../features';
import { clock } from '../pim/mail-today';
import { TaskComposer } from '../pim/tasks-ui';
import { useStore } from '../state';

type Step = 'pick' | 'time' | 'lay';
const STEPS: { id: Step; label: string }[] = [{ id: 'pick', label: 'Pick' }, { id: 'time', label: 'How long' }, { id: 'lay', label: 'Your day' }];
const LOCAL_CAL = 'local:calendar';

function Steps({ at }: { at: Step }) {
  const i = STEPS.findIndex((s) => s.id === at);
  return (
    <ol className="pd-steps" aria-label="Steps">
      {STEPS.map((s, n) => <li key={s.id} className={n === i ? 'on' : n < i ? 'done' : ''} aria-current={n === i ? 'step' : undefined}><span>{n + 1}</span>{s.label}</li>)}
    </ol>
  );
}

export function PlanMyDay({ tasks, occ, cals, onClose, onDone }: { tasks: Task[]; occ: Occurrence[]; cals: CalendarInfo[]; onClose: () => void; onDone: () => void }) {
  const { settings, toast, go } = useStore();
  const now = Date.now();
  const today = dayKey(now);
  const [step, setStep] = useState<Step>('pick');
  // Today's first three to start with (the list may still be loading when this opens), until the person picks.
  const [chosen, setPicked] = useState<string[] | null>(null);
  const picked = chosen ?? todayTasks(tasks, today).filter((t) => !t.done).slice(0, PLAN_PICK).map((t) => t.id);
  const [mins, setMins] = useState<Record<string, number>>({});
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [unplaced, setUnplaced] = useState<string[]>([]);
  const writable = cals.filter((c) => !c.readOnly && c.visible);
  const [cal, setCal] = useState(() => writable.find((c) => c.id === LOCAL_CAL)?.id ?? writable[0]?.id ?? LOCAL_CAL);
  const [saving, setSaving] = useState(false);
  const candidates = planCandidates(tasks, today);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const t = settings?.today;
  const win: Span = planWindow(now, t?.dayStart ?? 540, t?.dayEnd ?? 1050);
  const busy: Span[] = useMemo(() => agendaFor(occ, cals, now, now, inMailToday).filter((i) => !i.allDay).map((i) => ({ start: i.start, end: i.end })), [occ, cals, now]);
  const events = agendaFor(occ, cals, now, now, inMailToday).filter((i) => !i.allDay && i.end > win.start && i.start < win.end);
  const minutesOf = (id: string) => mins[id] ?? guessMinutes(byId.get(id) ?? {});

  const toggle = (id: string) => setPicked(() => { const p = picked; return p.includes(id) ? p.filter((x) => x !== id) : p.length >= PLAN_PICK ? p : [...p, id]; });
  const lay = () => {
    const items = picked.map((id) => ({ taskId: id, title: byId.get(id)?.title ?? 'Task', minutes: minutesOf(id) }));
    const r = layOut(items, freeSlots(busy, win));
    setBlocks(r.blocks);
    setUnplaced(r.unplaced.map((u) => u.title));
    setStep('lay');
  };
  const save = async () => {
    if (!blocks?.length) return;
    setSaving(true);
    try {
      for (const b of blocks) await api.pim.saveEvent(blockEvent(b, cal));
      // The planned tasks are today's tasks, wherever they were.
      const move = blocks.map((b) => b.taskId).filter((id) => byId.get(id)?.plannedFor !== today);
      if (move.length) await api.pim.moveTasks(move, today);
      toast(`${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'} in your calendar`);
      onDone();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const dayOver = win.end - win.start < 15 * 60_000;
  return (
    <Modal title="Plan my day" onClose={onClose} width={560} testId="plan-day">
      <Steps at={step} />
      {step === 'pick' ? (
        <>
          <p className="pd-lead">Pick up to three things that would make today a good day.</p>
          {candidates.length ? (
            <ul className="pd-pick" aria-label="Tasks">
              {candidates.map((c) => {
                const on = picked.includes(c.id);
                return (
                  <li key={c.id}>
                    <label className={`pd-row ${on ? 'on' : ''}`}>
                      <input type="checkbox" checked={on} disabled={!on && picked.length >= PLAN_PICK} onChange={() => toggle(c.id)} />
                      <span className="ellipsis grow">{c.title}</span>
                      {c.plannedFor || c.due ? null : <span className="pd-tag">Inbox</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : <p className="pd-quiet">No tasks yet. Add one below.</p>}
          <div className="pd-add"><TaskComposer defaults={{ plannedFor: today }} placeholder="Add a task for today" onAdded={(n) => setPicked(picked.length < PLAN_PICK ? [...picked, n.id] : picked)} /></div>
          <div className="pd-foot">
            <span className="pd-quiet">{picked.length} of {PLAN_PICK}</span>
            <span className="grow" />
            <button className="btn primary" data-testid="plan-next" disabled={!picked.length} onClick={() => setStep('time')}>Next</button>
          </div>
        </>
      ) : step === 'time' ? (
        <>
          <p className="pd-lead">About how long will each take? A guess is fine.</p>
          <ul className="pd-times" aria-label="How long">
            {picked.map((id) => (
              <li key={id}>
                <span className="ellipsis grow">{byId.get(id)?.title}</span>
                <div className="seg" role="radiogroup" aria-label={`How long for ${byId.get(id)?.title}`}>
                  {ESTIMATES.map((m) => <button key={m} role="radio" aria-checked={minutesOf(id) === m} className={minutesOf(id) === m ? 'on' : ''} onClick={() => setMins({ ...mins, [id]: m })}>{m < 60 ? `${m}m` : m === 60 ? '1h' : '1½h'}</button>)}
                </div>
              </li>
            ))}
          </ul>
          <div className="pd-foot">
            <button className="btn ghost" onClick={() => setStep('pick')}>Back</button>
            <span className="grow" />
            <button className="btn primary" data-testid="plan-lay" onClick={lay}>Lay out my day</button>
          </div>
        </>
      ) : (
        <>
          {dayOver ? (
            <div className="pd-over">
              <Icon name="moon" size={28} />
              <p className="pd-lead">Your working day is over. Rest, and plan tomorrow in the morning.</p>
              <button className="home-link" onClick={() => { onClose(); go({ name: 'settings', arg: 'general' }); }}>Change working hours</button>
            </div>
          ) : (
            <>
              <p className="pd-lead">Here is your day. Move a block if it does not feel right.</p>
              <ol className="pd-day" aria-label="Your day" data-testid="plan-day-list">
                {[...events.map((e) => ({ kind: 'event' as const, start: e.start, end: e.end, title: e.title, color: e.color, i: -1 })), ...(blocks ?? []).map((b, i) => ({ kind: 'block' as const, start: b.start, end: b.end, title: b.title, color: '', i }))]
                  .sort((a, b) => a.start - b.start)
                  .map((r) => (
                    <li key={`${r.kind}${r.start}${r.i}`} className={`pd-slot ${r.kind}`} style={r.color ? { ['--cal' as string]: r.color } : undefined}>
                      <span className="pd-time">{clock(r.start)}–{clock(r.end)}</span>
                      <span className="ellipsis grow">{r.title}</span>
                      {r.kind === 'block' ? (
                        <span className="pd-move">
                          <button className="btn ghost sm icon" title="15 minutes earlier" aria-label={`Move ${r.title} 15 minutes earlier`} onClick={() => setBlocks((b) => shiftBlock(b!, r.i, -15, busy, win))}><Icon name="arrowUp" size={12} /></button>
                          <button className="btn ghost sm icon" title="15 minutes later" aria-label={`Move ${r.title} 15 minutes later`} onClick={() => setBlocks((b) => shiftBlock(b!, r.i, 15, busy, win))}><Icon name="chevronDown" size={12} /></button>
                        </span>
                      ) : <span className="pd-tag">Event</span>}
                    </li>
                  ))}
              </ol>
              {unplaced.length ? <p className="pd-quiet"><Icon name="info" size={12} /> No room today for {unplaced.join(', ')}. It stays on your list.</p> : null}
              {writable.length > 1 ? (
                <label className="pd-cal"><span>Calendar</span>
                  <select value={cal} onChange={(e) => setCal(e.target.value)}>{writable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                </label>
              ) : null}
            </>
          )}
          <div className="pd-foot">
            <button className="btn ghost" onClick={() => setStep('time')}>Back</button>
            <span className="grow" />
            {!dayOver ? <button className="btn primary" data-testid="plan-save" disabled={!blocks?.length || saving} onClick={() => void save()}>Add to calendar</button> : <button className="btn" onClick={onClose}>Close</button>}
          </div>
        </>
      )}
    </Modal>
  );
}

export function WrapUp({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const { settings, toast } = useStore();
  const journalOn = useFeature('journal');
  const today = dayKey(Date.now());
  const left = leftToday(tasks, today);
  const done = todayTasks(tasks, today, { withDone: true }).filter((t) => t.done).length;
  // Everything left moves unless the person keeps it on today (the list may still be loading when this opens).
  const [kept, setKept] = useState<string[]>([]);
  const move = left.map((t) => t.id).filter((id) => !kept.includes(id));
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const vault = settings?.journal?.vault;
  const finish = async () => {
    setBusy(true);
    try {
      if (move.length) await api.pim.moveTasks(move, tomorrowOf(today));
      if (journalOn && vault && line.trim()) {
        const path = entryPath(settings!.journal.folder, today);
        await api.notes.open(vault).catch(() => undefined);
        const before = await api.notes.read(vault, path).catch(() => '');
        const add = wrapUpLine({ done, moved: move.length, note: line, at: Date.now(), clock });
        await api.notes.write(vault, path, `${before.replace(/\s*$/, '')}${before.trim() ? '\n\n' : ''}${add}\n`);
      }
      toast(move.length ? `${move.length} moved to tomorrow. Well done today.` : 'Well done today.');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Wrap up the day" onClose={onClose} width={520} testId="wrap-up">
      <p className="pd-lead">{done ? `${done} done today.` : 'A new day tomorrow.'} {left.length ? 'What is left moves to tomorrow.' : 'Nothing is left over.'}</p>
      {left.length ? (
        <ul className="pd-pick" aria-label="Left today">
          {left.map((t) => (
            <li key={t.id}>
              <label className={`pd-row ${move.includes(t.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={move.includes(t.id)} onChange={() => setKept((k) => (k.includes(t.id) ? k.filter((x) => x !== t.id) : [...k, t.id]))} />
                <span className="ellipsis grow">{t.title}</span>
                <span className="pd-tag">{move.includes(t.id) ? 'Tomorrow' : 'Stays'}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {journalOn && vault ? (
        <label className="pd-journal">
          <span>One line for your Journal</span>
          <input data-testid="wrap-line" value={line} maxLength={280} placeholder="What went well today?" onChange={(e) => setLine(e.target.value)} />
        </label>
      ) : null}
      <div className="pd-foot">
        <span className="grow" />
        <button className="btn primary" data-testid="wrap-done" disabled={busy} onClick={() => void finish()}>{move.length ? 'Move and finish' : 'Finish the day'}</button>
      </div>
    </Modal>
  );
}
