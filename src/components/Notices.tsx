// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The notification center: a bell in the top bar with how many notices are
// open, and a sheet listing every notice from Keeper grouped by part, with
// Mark all done, Snooze all 1 h and the way back to each one's page. What is
// shown when, and what waits for the next batch, is decided in the main
// process (core/notices.ts, electron/services/notices.ts).

import { useCallback, useEffect, useState } from 'react';
import type { NoticesView } from '../../core/api-notices';
import { relativeTime } from '../../core/format';
import { DELIVERY_CHOICES, deliveryOf, groupByPart, holdLine, normalizeNoticeSettings, NOTICE_PARTS, type Delivery, type Notice } from '../../core/notices';
import { api } from '../api';
import { useFeature, useFeatureStates } from '../features';
import { useStore, type RouteName } from '../state';
import { Icon } from './Icon';
import { Modal, Toggle } from './ui';
import '../styles/attention.css';

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Opens the notification center from anywhere (the palette, a batch summary). */
export function openNotices() {
  window.dispatchEvent(new CustomEvent('keeper-notices'));
}

function useNotices(open: boolean): [NoticesView | null, (v: NoticesView) => void, () => void] {
  const [v, setV] = useState<NoticesView | null>(null);
  const reload = useCallback(() => void api.notices?.list().then(setV).catch(() => undefined), []);
  useEffect(() => {
    reload();
    const off = api.on('notices-changed', reload);
    return () => off?.();
  }, [reload, open]);
  return [v, setV, reload];
}

/** The bell in the top bar, and the sheet it opens. */
export function NoticesButton() {
  const on = useFeature('notices');
  const [open, setOpen] = useState(false);
  const [v] = useNotices(open);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('keeper-notices', show);
    const off = api.on('notices-open', show);
    return () => { window.removeEventListener('keeper-notices', show); off?.(); };
  }, []);
  if (!on) return null;
  const n = v?.open ?? 0;
  const label = n ? `Notifications: ${n} new` : 'Notifications';
  return (
    <>
      <button className={`btn ghost icon notices-bell ${n ? 'has' : ''}`} data-testid="notices-bell" title={label} aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="bell" size={16} />
        {n ? <span className="notices-count" aria-hidden>{n > 99 ? '99+' : n}</span> : null}
      </button>
      {open ? <NoticesSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NoticesSheet({ onClose }: { onClose: () => void }) {
  const { go, settings } = useStore();
  const [v, setV] = useNotices(true);
  const s = normalizeNoticeSettings(settings?.notices);
  const groups = v ? groupByPart(v.items) : [];
  const hold = v?.hold ? holdLine(v.hold, s, { now: new Date(), snoozedUntil: v.snoozedUntil }, clock) : null;
  const open = (n: Notice) => {
    void api.notices.done(n.id).then(setV);
    if (n.route) {
      go({ name: n.route.name as RouteName, arg: n.route.arg });
      onClose();
    }
  };
  return (
    <Modal sheet title="Notifications" onClose={onClose} testId="notices-sheet">
      <div className="notices-status small muted" data-testid="notices-status">
        {hold ?? (v?.nextRelease ? `Next batch at ${clock(v.nextRelease)}` : 'Shown as they come, by your choices')}
      </div>
      <div className="notices-actions">
        <button className="btn sm primary" data-testid="notices-done-all" disabled={!v?.open} onClick={() => void api.notices.doneAll().then(setV)}><Icon name="check" size={13} /> Mark all done</button>
        {v?.snoozedUntil ? (
          <button className="btn sm ghost" data-testid="notices-unsnooze" onClick={() => void api.notices.snoozeAll(0).then(setV)}>Stop snoozing</button>
        ) : (
          <button className="btn sm ghost" data-testid="notices-snooze" onClick={() => void api.notices.snoozeAll(3600_000).then(setV)}><Icon name="clock" size={13} /> Snooze all 1 h</button>
        )}
        <span className="grow" />
        <button className="btn sm ghost icon" title="Notification settings" aria-label="Notification settings" data-testid="notices-settings" onClick={() => { go({ name: 'settings', arg: 'general' }); onClose(); }}><Icon name="settings" size={14} /></button>
      </div>
      <div className="notices-list" role="list" aria-label="Notices">
        {!v ? null : groups.length ? groups.map((g) => (
          <section key={g.part.id} className="notices-group" aria-label={g.part.label} data-testid={`notices-group-${g.part.id}`}>
            <h3 className="notices-kicker">{g.part.label}<span className="muted"> · {deliveryWord(deliveryOf(g.part.id, s))}</span></h3>
            {g.items.map((n) => (
              <div key={n.id} className="notices-row" role="listitem" data-testid="notice">
                <button className="notices-open" onClick={() => open(n)} title={n.route ? 'Open' : undefined}>
                  <span className="notices-title">{n.title}{n.count && n.count > 1 ? <span className="muted"> ×{n.count}</span> : null}</span>
                  {n.detail ? <span className="small muted notices-detail">{n.detail}</span> : null}
                  <span className="small muted">{relativeTime(n.at)}{n.held ? ' · waiting for the next batch' : ''}</span>
                </button>
                <button className="btn sm ghost icon" title="Done" aria-label={`Done: ${n.title}`} data-testid="notice-done" onClick={() => void api.notices.done(n.id).then(setV)}><Icon name="check" size={13} /></button>
              </div>
            ))}
          </section>
        )) : (
          <div className="notices-empty" data-testid="notices-empty">
            <BellArt />
            <h3>All caught up</h3>
            <p className="small muted">Notices from Mail, monitors and the Fix-it List gather here.</p>
            {v.items.some((n) => n.done) ? <button className="btn sm ghost" onClick={() => void api.notices.clearDone().then(setV)}>Clear done</button> : null}
          </div>
        )}
      </div>
    </Modal>
  );
}

const deliveryWord = (d: string) => (d === 'now' ? 'now' : d === 'batched' ? 'batched' : 'silent');

/** Keeper's small drawing for a quiet list: a bell resting, with soft rings. */
function BellArt() {
  return (
    <svg className="attn-art" width="120" height="84" viewBox="0 0 120 84" aria-hidden>
      <circle cx="60" cy="42" r="36" className="attn-art-ring" />
      <circle cx="60" cy="42" r="24" className="attn-art-ring" />
      <path d="M48 50 V40 a12 12 0 0 1 24 0 V50 l4 4 H44 Z" className="attn-art-shape" />
      <circle cx="60" cy="59" r="3.5" className="attn-art-shape" />
      <path d="M86 20 l3 -3 M92 26 l4 -1 M34 20 l-3 -3 M28 26 l-4 -1" className="attn-art-spark" />
    </svg>
  );
}

// ---------------------------------------------------------------- Settings → General → Notifications

/** Now, Batched or Silent for each part that is on. */
export function NoticePartsPanel() {
  const { settings, updateSettings } = useStore();
  const s = normalizeNoticeSettings(settings?.notices);
  const states = useFeatureStates();
  const parts = NOTICE_PARTS.filter((p) => !p.feature || states?.get(p.feature)?.on !== false);
  const set = (id: string, d: Delivery) => void updateSettings({ notices: { ...s, delivery: { ...s.delivery, [id]: d } } });
  return (
    <div className="notice-parts" data-testid="notice-parts">
      {parts.map((p) => (
        <div key={p.id} className="notice-part">
          <span>{p.label}</span>
          <div className="seg" role="radiogroup" aria-label={`${p.label}: how it tells you`}>
            {DELIVERY_CHOICES.map((c) => {
              const on = deliveryOf(p.id, s) === c.value;
              return <button key={c.value} role="radio" aria-checked={on} className={on ? 'on' : ''} title={c.line} data-testid={`notice-part-${p.id}-${c.value}`} onClick={() => set(p.id, c.value)}>{c.label}</button>;
            })}
          </div>
        </div>
      ))}
      <div><button className="btn sm ghost" data-testid="notices-test" onClick={() => void api.notices.test()}>Send a test notice</button></div>
    </div>
  );
}

/** Quiet hours: on, from, to. */
export function QuietHoursPanel() {
  const { settings, updateSettings } = useStore();
  const s = normalizeNoticeSettings(settings?.notices);
  const save = (q: Partial<typeof s.quiet>) => void updateSettings({ notices: { ...s, quiet: { ...s.quiet, ...q } } });
  return (
    <div className="quiet-hours" data-testid="quiet-hours">
      <Toggle on={s.quiet.on} onChange={(on) => save({ on })} label="Quiet hours" />
      <label className="small muted" htmlFor="quiet-from">From</label>
      <input id="quiet-from" className="input" type="time" value={s.quiet.from} disabled={!s.quiet.on} onChange={(e) => e.target.value && save({ from: e.target.value })} />
      <label className="small muted" htmlFor="quiet-to">to</label>
      <input id="quiet-to" className="input" type="time" value={s.quiet.to} disabled={!s.quiet.on} onChange={(e) => e.target.value && save({ to: e.target.value })} />
    </div>
  );
}
