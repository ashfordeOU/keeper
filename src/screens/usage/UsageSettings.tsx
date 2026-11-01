// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings for the AI usage tracker: what the menu-bar label shows, when a
// limit counts as running out, which warnings to send and how often to look.
// Shown in Settings → Menu Bar and on the Usage page.

import { useEffect, useState } from 'react';
import { renderLabel } from '../../../core/usage-tracker/label';
import type { LabelMode, TrackerSettings } from '../../../core/usage-tracker/model';
import { api } from '../../api';
import { Toggle } from '../../components/ui';
import { useFeature } from '../../features';
import { Row } from '../IslandSettings';
import { useUsage } from './parts';

const MODES: [LabelMode, string, string][] = [
  ['icon', 'Icon only', 'A ring, coloured when something runs low.'],
  ['urgent', 'Most urgent', 'The share left of the one to three limits closest to running out, e.g. “CC 69%”.'],
  ['countdown', 'Reset countdowns', 'When the most urgent limits come back, e.g. “Reset 1d 6h”.'],
  ['busy', 'Busy day', 'Always the lowest limits, even when nothing is running out yet.'],
];

export function UsageSettings() {
  const { o } = useUsage();
  const [s, setS] = useState<TrackerSettings | null>(null);
  const menuBarOn = useFeature('usageMenuBar');
  useEffect(() => { if (o && !s) setS(o.settings); }, [o, s]);
  if (!s || !o) return null;
  const save = (patch: Partial<TrackerSettings>) => {
    const next = { ...s, ...patch, thresholds: { ...s.thresholds, ...patch.thresholds }, menuBar: { ...s.menuBar, ...patch.menuBar }, notify: { ...s.notify, ...patch.notify } };
    setS(next);
    void api.aiUsage.setSettings(patch).then(setS);
  };
  const preview = renderLabel(o.items, s.menuBar, Date.now());
  return (
    <div className="card settings-section" data-testid="usage-settings">
      <Row title="AI usage in the menu bar" desc={o.accounts.length ? 'A ring with the most urgent limits; click it for every account.' : 'Shows once you add an AI account on the Usage page.'}>
        <Toggle label="AI usage in the menu bar" on={menuBarOn} onChange={(v) => void api.features.set('usageMenuBar', v)} />
      </Row>
      <Row title="The label shows" desc={MODES.find((m) => m[0] === s.menuBar.mode)?.[2]}>
        <select className="input" aria-label="The label shows" value={s.menuBar.mode} onChange={(e) => save({ menuBar: { ...s.menuBar, mode: e.target.value as LabelMode } })}>
          {MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </Row>
      {s.menuBar.mode !== 'icon' ? (
        <Row title="How many" desc="Limits shown side by side; “+N” counts the rest.">
          <div className="seg">{([1, 2, 3] as const).map((n) => <button key={n} className={s.menuBar.count === n ? 'on' : ''} onClick={() => save({ menuBar: { ...s.menuBar, count: n } })}>{n}</button>)}</div>
        </Row>
      ) : null}
      <Row title="Show “+N” for the rest"><Toggle label="Show +N" on={s.menuBar.overflow} onChange={(v) => save({ menuBar: { ...s.menuBar, overflow: v } })} /></Row>
      <Row title="Service letters before each number"><Toggle label="Service letters" on={s.menuBar.glyph} onChange={(v) => save({ menuBar: { ...s.menuBar, glyph: v } })} /></Row>
      <Row title="Nothing in the menu bar when all is clear" desc="The item appears only while something is running out or used up."><Toggle label="Hide when all clear" on={s.menuBar.hideWhenClear} onChange={(v) => save({ menuBar: { ...s.menuBar, hideWhenClear: v } })} /></Row>
      <Row title="Preview"><span className="ulabel-preview" data-testid="usage-label-preview">{preview.visible ? preview.text || '◯' : '(hidden)'}</span></Row>

      <h3 style={{ margin: '16px 0 4px', fontSize: 14 }}>Running out</h3>
      <Row title="Running out at" desc="A limit counts as running out with this much left or less.">
        <input className="input" type="number" min={1} max={90} style={{ width: 70 }} aria-label="Percent left" value={s.thresholds.lowLeft} onChange={(e) => save({ thresholds: { ...s.thresholds, lowLeft: Number(e.target.value) || 30 } })} /> % left
      </Row>
      <Row title="Used up at" desc="A limit counts as used up (greyed, waiting for its reset) at this share used or more.">
        <input className="input" type="number" min={80} max={100} step={0.5} style={{ width: 70 }} aria-label="Percent used" value={s.thresholds.usedUp} onChange={(e) => save({ thresholds: { ...s.thresholds, usedUp: Number(e.target.value) || 99.5 } })} /> % used
      </Row>
      <Row title="Also when the pace says so" desc="Running out before the reset at the current rate of use counts too."><Toggle label="Forecast" on={s.thresholds.predict} onChange={(v) => save({ thresholds: { ...s.thresholds, predict: v } })} /></Row>
      <Row title="Use it before it resets" desc="Flag a weekly or monthly allowance with this much unused that resets within this many hours.">
        <input className="input" type="number" min={1} max={100} style={{ width: 64 }} aria-label="Percent unused" value={s.thresholds.expiringLeft} onChange={(e) => save({ thresholds: { ...s.thresholds, expiringLeft: Number(e.target.value) || 40 } })} /> % within{' '}
        <input className="input" type="number" min={1} max={168} style={{ width: 64 }} aria-label="Hours" value={s.thresholds.expiringHours} onChange={(e) => save({ thresholds: { ...s.thresholds, expiringHours: Number(e.target.value) || 24 } })} /> h
      </Row>
      <Row title="Only for windows of at least" desc="Short windows (5-hour, daily) reset too often to be worth flagging.">
        <input className="input" type="number" min={1} max={744} style={{ width: 70 }} aria-label="Window hours" value={s.thresholds.expiringMinWindowHours} onChange={(e) => save({ thresholds: { ...s.thresholds, expiringMinWindowHours: Number(e.target.value) || 48 } })} /> h
      </Row>

      <h3 style={{ margin: '16px 0 4px', fontSize: 14 }}>Notifications</h3>
      <Row title="When a limit runs low or is used up"><Toggle label="Threshold notifications" on={s.notify.thresholds} onChange={(v) => save({ notify: { ...s.notify, thresholds: v } })} /></Row>
      <Row title="When a limit resets" desc="“Codex weekly reset: 100% available”."><Toggle label="Reset notifications" on={s.notify.resets} onChange={(v) => save({ notify: { ...s.notify, resets: v } })} /></Row>
      <Row title="Unused allowance about to reset" desc="“Use it before it resets” as a notification too (off by default; it always shows in the pop-over)."><Toggle label="Expiring notifications" on={s.notify.expiring} onChange={(v) => save({ notify: { ...s.notify, expiring: v } })} /></Row>
      <Row title="Subscriptions renewing and trials ending"><Toggle label="Renewal reminders" on={s.notify.renewals} onChange={(v) => save({ notify: { ...s.notify, renewals: v } })} /></Row>

      <h3 style={{ margin: '16px 0 4px', fontSize: 14 }}>How often</h3>
      <Row title="Files on this computer" desc="Coding tools’ session files. Slower while you are away; never while the screen is locked.">
        every <input className="input" type="number" min={1} max={60} style={{ width: 60 }} aria-label="Minutes for files" value={s.localEveryMin} onChange={(e) => save({ localEveryMin: Number(e.target.value) || 2 })} /> min
      </Row>
      <Row title="Services" desc="Usage and balance endpoints, with your keys. Waits longer after errors.">
        every <input className="input" type="number" min={5} max={120} style={{ width: 60 }} aria-label="Minutes for services" value={s.apiEveryMin} onChange={(e) => save({ apiEveryMin: Number(e.target.value) || 10 })} /> min
      </Row>
      <Row title="Pause tracking" desc="Nothing is read until you resume."><Toggle label="Pause tracking" on={s.paused} onChange={(v) => save({ paused: v })} /></Row>
    </div>
  );
}
