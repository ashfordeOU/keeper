// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keep Awake: turn it on for a while, until a time or while something is true;
// choose what a session allows; triggers that start sessions by themselves;
// who keeps this computer awake; statistics; the menu-bar item.

import { useEffect, useMemo, useState } from 'react';
import type { AwakeStatus, TriggerTest } from '../../core/api-awake';
import {
  describeRule, describeWhile, fmtDuration, fmtRemaining, ICON_STYLES,
  type AwakeRule, type AwakeSettings, type AwakeStats, type Blocker, type SessionOptions, type SessionRecord, type SessionSpec, type TriggerCondition, type TriggerKind, type WhileCondition, type WhileKind,
} from '../../core/awake-engine';
import { svgFor } from '../../core/awake-icons';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import { Row } from './IslandSettings';
import '../styles/awake.css';

const WHILE_KINDS: { kind: WhileKind; label: string; value?: string; threshold?: string }[] = [
  { kind: 'app', label: 'An app is running', value: 'App name' },
  { kind: 'appFront', label: 'An app is in front', value: 'App name' },
  { kind: 'file', label: 'A file is downloading', value: 'File path' },
  { kind: 'folder', label: 'A folder keeps changing', value: 'Folder path' },
  { kind: 'cpu', label: 'The processor is busy', value: 'Process (optional)', threshold: 'Percent' },
  { kind: 'audio', label: 'Sound is playing' },
  { kind: 'network', label: 'The network is busy', threshold: 'Bytes per second' },
  { kind: 'display', label: 'An external display is connected' },
  { kind: 'power', label: 'Plugged into power' },
  { kind: 'drive', label: 'A drive is connected', value: 'Drive name' },
  { kind: 'usb', label: 'A USB device is connected', value: 'Device name' },
  { kind: 'bluetooth', label: 'A Bluetooth device is connected', value: 'Device name' },
  { kind: 'wifi', label: 'On a Wi-Fi network', value: 'Network name' },
  { kind: 'vpn', label: 'A VPN is connected' },
  { kind: 'agent', label: 'An AI agent or terminal runs' },
  { kind: 'job', label: 'Keeper is busy (sync, backup, download)', value: 'Job (optional)' },
];

const TRIGGER_KINDS: { kind: TriggerKind; label: string; value?: string; threshold?: string }[] = [
  { kind: 'schedule', label: 'Days and times' },
  ...WHILE_KINDS,
  { kind: 'battery', label: 'Battery level', threshold: 'At least %' },
  { kind: 'mirroring', label: 'Mirroring a display' },
  { kind: 'ip', label: 'IP address', value: '10.0.0.0/8, 192.168.1.*' },
  { kind: 'dns', label: 'DNS server', value: '1.1.1.1' },
  { kind: 'audioOutput', label: 'Sound output', value: 'Headphones (optional)' },
  { kind: 'idle', label: 'Nobody at the computer', threshold: 'Minutes' },
  { kind: 'calendar', label: 'In a calendar event' },
  { kind: 'downloads', label: 'A download is in progress' },
];

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ICON_NAME: Record<string, string> = { owl: 'Keeper’s owl', cup: 'Cup', eye: 'Eye', bolt: 'Bolt', moon: 'Moon' };

export function KeepAwake() {
  const { toast } = useStore();
  const [st, setSt] = useState<AwakeStatus | null>(null);
  const [cfg, setCfg] = useState<AwakeSettings | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void api.awake.status().then(setSt);
    void api.awake.settings().then(setCfg);
    const off = api.on('awake-changed', (s) => setSt(s));
    const off2 = api.on('settings-changed', () => void api.awake.settings().then(setCfg));
    return () => { off(); off2(); };
  }, []);
  // A second-by-second countdown only while a timed session runs and this page is open.
  useEffect(() => {
    if (!st?.session?.endsAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [st?.session?.endsAt]);

  if (!st || !cfg) return <div className="page"><PageHead title="Keep Awake" /></div>;
  const save = async (patch: Partial<AwakeSettings>) => setCfg(await api.awake.setSettings(patch));
  const start = async (spec: SessionSpec) => {
    try {
      setSt(await api.awake.start(spec));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page awake-page">
      <PageHead title="Keep Awake" sub="Stop this computer from sleeping for a while, until a time, or while something is going on." />
      <Hero st={st} now={now} quick={cfg.quick} onStart={start} />
      <StartBuilder cfg={cfg} onStart={start} />
      <Options cfg={cfg} st={st} save={save} onStatus={setSt} />
      <Triggers cfg={cfg} st={st} setCfg={setCfg} />
      <Blockers on={st.on} />
      <Stats enabled={cfg.stats} save={save} />
      <Appearance cfg={cfg} save={save} />
    </div>
  );
}

function Hero({ st, now, quick, onStart }: { st: AwakeStatus; now: number; quick: number[]; onStart: (s: SessionSpec) => void }) {
  const s = st.session;
  const left = s?.endsAt ? s.endsAt - now : undefined;
  return (
    <div className={`card awake-hero${st.on ? ' on' : ''}`} data-testid="awake-hero">
      <button className={`awake-switch${st.on ? ' on' : ''}`} aria-pressed={st.on} aria-label={st.on ? 'Turn Keep Awake off' : 'Turn Keep Awake on'} data-testid="awake-toggle"
        onClick={() => (st.on ? void api.awake.stop() : onStart({}))}>
        <span style={{ display: 'inline-flex', width: 30, height: 30 }} dangerouslySetInnerHTML={{ __html: svgFor('owl', st.on, 'currentColor', { id: 'awake-hero' }).replace('width="22" height="22"', 'width="30" height="30"') }} />
      </button>
      <div className="awake-hero-txt">
        <div className="awake-state">{st.on ? 'Keeping this computer awake' : 'Your computer can sleep as usual'}</div>
        {s ? (
          <div className="muted">
            {s.reason}
            {left !== undefined ? <> · <b data-testid="awake-remaining">{fmtRemaining(left)}</b> left</> : null}
            {s.options.display === 'allow-sleep' || st.displayAllowed ? ' · the screen may sleep' : ' · the screen stays on'}
            {st.closedDisplay ? ' · lid may be closed' : ''}
          </div>
        ) : st.matching.length ? <div className="muted">Triggers matching now: {st.matching.join(' · ')}</div> : <div className="muted">Click the cup, or pick how long.</div>}
        {st.notice ? <div className="awake-notice"><Icon name="info" size={12} /> {st.notice}</div> : null}
        {st.on ? <div className="muted small">Held by {st.holds.join(', ') || '…'}</div> : null}
      </div>
      <div className="awake-hero-ctl">
        {st.on ? (
          <>
            {[15, 30, 60].map((m) => <button key={m} className="btn sm" onClick={() => void api.awake.extend(m)}>+{m} min</button>)}
            <button className="btn sm" data-testid="awake-stop" onClick={() => void api.awake.stop()}>Turn off</button>
          </>
        ) : quick.slice(0, 6).map((m) => <button key={m} className="btn sm" data-testid={`awake-quick-${m}`} onClick={() => onStart({ minutes: m })}>{fmtDuration(m * 60_000)}</button>)}
      </div>
    </div>
  );
}

function StartBuilder({ cfg, onStart }: { cfg: AwakeSettings; onStart: (s: SessionSpec) => void }) {
  const [text, setText] = useState('');
  const [whileList, setWhile] = useState<WhileCondition[]>([]);
  const [display, setDisplay] = useState<SessionOptions['display']>(cfg.defaults.display);
  const [closed, setClosed] = useState(false);
  const [apps, setApps] = useState<string[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => { void api.awake.apps().then(setApps).catch(() => undefined); }, []);
  const go = async () => {
    const d = text.trim() ? await api.awake.parse(text) : {};
    if (!d) { setErr('Try 30m, 1h30m, 2 hours, 18:30 or “until 6:30 pm”.'); return; }
    setErr('');
    onStart({ ...d, while: whileList, options: { display, closedDisplay: closed } });
  };
  return (
    <>
      <h2 className="awake-h">Start a session</h2>
      <div className="card settings-section">
        <Row title="How long" desc={err || 'Empty means until you turn it off. Also “until 18:30”.'}>
          <input className="input" style={{ width: 200 }} placeholder="e.g. 1h30m or 18:30" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} data-testid="awake-duration" />
        </Row>
        <Row title="While" desc={whileList.length ? whileList.map(describeWhile).join(', ') : 'Optional: end the session when one of these stops being true.'}>
          <button className="btn sm" onClick={() => setWhile([...whileList, { kind: 'app', value: '' }])}><Icon name="plus" size={12} /> Add</button>
        </Row>
        {whileList.map((c, i) => (
          <CondEditor key={i} kinds={WHILE_KINDS} c={c} apps={apps} onChange={(n) => setWhile(whileList.map((x, j) => (j === i ? (n as WhileCondition) : x)))} onRemove={() => setWhile(whileList.filter((_, j) => j !== i))} />
        ))}
        <Row title="Screen" desc="Keep the display on, or let it sleep while the computer keeps working.">
          <div className="seg"><button className={display === 'keep-on' ? 'on' : ''} onClick={() => setDisplay('keep-on')}>Keep on</button><button className={display === 'allow-sleep' ? 'on' : ''} onClick={() => setDisplay('allow-sleep')}>May sleep</button></div>
        </Row>
        <Row title="With the lid closed" desc="Laptops: keep running with the lid shut, even without an external display. Ends by itself on low battery or heat."><Toggle on={closed} onChange={setClosed} /></Row>
        <Row title=""><button className="btn primary" data-testid="awake-start" onClick={() => void go()}><Icon name="coffee" size={13} /> Start</button></Row>
      </div>
    </>
  );
}

function CondEditor({ kinds, c, apps, onChange, onRemove }: { kinds: { kind: string; label: string; value?: string; threshold?: string }[]; c: TriggerCondition; apps?: string[]; onChange: (c: TriggerCondition) => void; onRemove: () => void }) {
  const k = kinds.find((x) => x.kind === c.kind) ?? kinds[0];
  const listId = useMemo(() => `apps-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div className="setting awake-cond">
      <div className="txt" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {'not' in c || kinds !== WHILE_KINDS ? (
          <select className="input" value={c.not ? 'not' : 'is'} onChange={(e) => onChange({ ...c, not: e.target.value === 'not' })} aria-label="is or is not">
            <option value="is">When</option><option value="not">When not</option>
          </select>
        ) : null}
        <select className="input" value={c.kind} onChange={(e) => onChange({ kind: e.target.value as TriggerKind, not: c.not })} aria-label="Condition">
          {kinds.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
        </select>
        {k.value ? (
          <>
            <input className="input" style={{ width: 200 }} placeholder={k.value} value={c.value ?? ''} list={c.kind === 'app' || c.kind === 'appFront' ? listId : undefined} onChange={(e) => onChange({ ...c, value: e.target.value })} />
            {apps?.length ? <datalist id={listId}>{apps.map((a) => <option key={a} value={a} />)}</datalist> : null}
          </>
        ) : null}
        {k.threshold ? <input className="input" style={{ width: 110 }} type="number" placeholder={k.threshold} value={c.threshold ?? ''} onChange={(e) => onChange({ ...c, threshold: e.target.value === '' ? undefined : Number(e.target.value) })} /> : null}
        {c.kind === 'schedule' ? (
          <>
            <span className="awake-days">{DAYS.map((d, i) => {
              const on = (c.days ?? [0, 1, 2, 3, 4, 5, 6]).includes(i);
              return <button key={i} className={`chip${on ? ' on' : ''}`} onClick={() => { const cur = c.days ?? [0, 1, 2, 3, 4, 5, 6]; onChange({ ...c, days: on ? cur.filter((x) => x !== i) : [...cur, i].sort() }); }}>{d}</button>;
            })}</span>
            <input className="input" type="time" value={c.from ?? '09:00'} onChange={(e) => onChange({ ...c, from: e.target.value })} aria-label="From" />
            <input className="input" type="time" value={c.to ?? '17:00'} onChange={(e) => onChange({ ...c, to: e.target.value })} aria-label="To" />
          </>
        ) : null}
        {c.kind === 'battery' ? (
          <select className="input" value={c.power === undefined ? '' : c.power ? 'ac' : 'bat'} onChange={(e) => onChange({ ...c, power: e.target.value === '' ? undefined : e.target.value === 'ac' })}>
            <option value="">On any power</option><option value="ac">And plugged in</option><option value="bat">And on battery</option>
          </select>
        ) : null}
      </div>
      <div className="ctl"><button className="btn sm ghost" aria-label="Remove condition" onClick={onRemove}><Icon name="close" size={12} /></button></div>
    </div>
  );
}

function Options({ cfg, st, save, onStatus }: { cfg: AwakeSettings; st: AwakeStatus; save: (p: Partial<AwakeSettings>) => void; onStatus: (s: AwakeStatus) => void }) {
  const d = cfg.defaults;
  // Mac only: the sudoers rule is missing (older Keeper versions only knew the "agreed" setting).
  const lidSetup = st.platform === 'darwin' && st.supports.closedDisplay && !(st.closedLidReady ?? cfg.closedDisplayAgreed);
  const set = (p: Partial<SessionOptions>) => save({ defaults: { ...d, ...p } });
  const [setupMsg, setSetupMsg] = useState('');
  const num = (v: string) => Math.max(0, Number(v) || 0);
  return (
    <>
      <h2 className="awake-h">What every session does</h2>
      <div className="card settings-section">
        <Row title="Let the screen sleep" desc="The computer keeps working; only the display turns off."><Toggle on={d.display === 'allow-sleep'} onChange={(v) => set({ display: v ? 'allow-sleep' : 'keep-on' })} /></Row>
        <Row title="Allow the screen saver after" desc="Minutes without input; 0 keeps the screen on the whole session.">
          <input className="input" type="number" min={0} style={{ width: 80 }} value={d.screenSaverAfterMin} onChange={(e) => set({ screenSaverAfterMin: num(e.target.value) })} />
        </Row>
        <Row title="Keep running with the lid closed" desc={
          st.supports.closedDisplay
            ? `${st.platform === 'darwin' ? 'Needs your administrator password once. ' : st.platform === 'win32' ? 'Sets the lid action to “Do nothing” and puts it back afterwards. ' : 'Holds the lid switch through systemd-inhibit. '}Ends by itself ${cfg.closedLidOnlyOnPower ? 'when unplugged, ' : ''}below ${cfg.closedDisplayMinBattery}% battery, in Low Power Mode or when the computer gets hot; if Keeper quits or crashes, the setting is put back.`
            : 'Not available on this computer.'}>
          {lidSetup ? null : <Toggle on={d.closedDisplay} onChange={(v) => { if (v && !cfg.closedDisplayAgreed) void api.awake.setupClosedDisplay(); set({ closedDisplay: v }); }} />}
        </Row>
        {lidSetup ? (
          <Row title="" desc={setupMsg || undefined}>
            <button className="btn sm" data-testid="awake-lid-setup" onClick={async () => { const r = await api.awake.setupClosedDisplay(); setSetupMsg(r.ok ? 'Ready.' : r.message ?? 'Did not finish.'); void api.awake.status().then(onStatus); }}>Set up closed-lid mode (asks for your password once)</button>
          </Row>
        ) : setupMsg ? <Row title="" desc={setupMsg}>{null}</Row> : null}
        {st.supports.closedDisplay ? (
          <Row title="Closed-lid mode only while plugged in" desc="When you unplug, the lid part turns off and Keep Awake goes on.">
            <Toggle on={cfg.closedLidOnlyOnPower} onChange={(v) => save({ closedLidOnlyOnPower: v })} />
          </Row>
        ) : null}
        <Row title="End below battery" desc="While on battery. 0 = never.">
          <select className="input" value={d.endBelowBattery} onChange={(e) => set({ endBelowBattery: Number(e.target.value) })}>
            {[0, 5, 10, 15, 20, 30, 50].map((n) => <option key={n} value={n}>{n ? `${n}%` : 'Never'}</option>)}
          </select>
        </Row>
        <Row title="End in Low Power Mode or when hot"><Toggle on={d.endOnLowPowerOrHeat} onChange={(v) => set({ endOnLowPowerOrHeat: v })} /></Row>
        <Row title="End when I put the computer to sleep"><Toggle on={d.endOnManualSleep} onChange={(v) => set({ endOnManualSleep: v })} /></Row>
        <Row title="Only while plugged in"><Toggle on={d.onlyOnPower} onChange={(v) => set({ onlyOnPower: v })} /></Row>
        <Row title="Keep drives spinning" desc={d.driveAlive.length ? d.driveAlive.join(', ') : 'Writes a tiny hidden file so external drives do not fall asleep mid-work.'}>
          <button className="btn sm" onClick={() => void api.settings.pickFolder().then((p) => p && set({ driveAlive: [...new Set([...d.driveAlive, p])] }))}>Add drive…</button>
          {d.driveAlive.length ? <button className="btn sm" onClick={() => set({ driveAlive: [] })}>Clear</button> : null}
        </Row>
        <Row title="Nudge the pointer" desc={st.supports.cursor ? 'Seconds; moves the pointer by one point for apps that mark you away. 0 = never.' : 'Not possible on this desktop (Wayland).'}>
          <input className="input" type="number" min={0} style={{ width: 80 }} value={d.cursorEverySec} disabled={!st.supports.cursor} onChange={(e) => set({ cursorEverySec: num(e.target.value) })} />
        </Row>
        <Row title="Do Not Disturb during a session" desc={st.supports.focus === 'shortcuts' ? 'macOS turns Focus on and off through two Shortcuts you name below.' : st.supports.focus === 'gnome' ? 'Hides notification banners while the session runs.' : 'This system does not let apps switch Do Not Disturb.'}>
          <Toggle on={d.focus} onChange={(v) => set({ focus: v })} />
        </Row>
        {st.supports.focus === 'shortcuts' && d.focus ? (
          <Row title="Shortcuts for Focus" desc="Names of Shortcuts that turn Focus on and off.">
            <input className="input" style={{ width: 140 }} placeholder="Focus on" defaultValue={cfg.focusOnShortcut} onBlur={(e) => save({ focusOnShortcut: e.target.value.trim() })} />
            <input className="input" style={{ width: 140 }} placeholder="Focus off" defaultValue={cfg.focusOffShortcut} onBlur={(e) => save({ focusOffShortcut: e.target.value.trim() })} />
          </Row>
        ) : null}
        <Row title="Tell me when it starts"><Toggle on={d.notifyStart} onChange={(v) => set({ notifyStart: v })} /></Row>
        <Row title="Tell me when it ends"><Toggle on={d.notifyEnd} onChange={(v) => set({ notifyEnd: v })} /></Row>
        <Row title="Remind me before the end" desc="Minutes; 0 = no reminder.">
          <input className="input" type="number" min={0} style={{ width: 80 }} value={d.remindBeforeMin} onChange={(e) => set({ remindBeforeMin: num(e.target.value) })} />
        </Row>
        <Row title="Sound">
          <select className="input" value={d.sound} onChange={(e) => set({ sound: e.target.value as SessionOptions['sound'] })}>
            <option value="none">None</option><option value="soft">Soft</option><option value="chime">Chime</option><option value="pop">Pop</option>
          </select>
        </Row>
        <Row title="Lock the screen when a session ends"><Toggle on={d.lockAtEnd} onChange={(v) => set({ lockAtEnd: v })} /></Row>
      </div>
    </>
  );
}

function newRule(n: number): AwakeRule {
  return { id: `t${Date.now().toString(36)}`, name: `Trigger ${n}`, enabled: true, match: 'all', conditions: [{ kind: 'app', value: '' }], priority: n, reactivateAfterMin: 0 };
}

function Triggers({ cfg, st, setCfg }: { cfg: AwakeSettings; st: AwakeStatus; setCfg: (c: AwakeSettings) => void }) {
  const [editing, setEditing] = useState<AwakeRule | null>(null);
  const [tests, setTests] = useState<Record<string, TriggerTest>>({});
  const list = [...cfg.triggers].sort((a, b) => a.priority - b.priority);
  const move = async (i: number, d: number) => {
    const ids = list.map((r) => r.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setCfg(await api.awake.reorderTriggers(ids));
  };
  return (
    <>
      <h2 className="awake-h">Triggers</h2>
      <div className="card settings-section" data-testid="awake-triggers">
        <Row title="Start by itself" desc="A trigger starts a session when its conditions are true and ends it when they stop. The highest one in the list decides the session’s options.">
          <button className="btn sm" data-testid="awake-add-trigger" onClick={() => setEditing(newRule(list.length))}><Icon name="plus" size={12} /> Add trigger</button>
        </Row>
        {list.map((r, i) => (
          <div key={r.id} className="setting">
            <div className="txt">
              <div style={{ fontWeight: 550 }}>{r.name} {st.matching.includes(r.name) ? <span className="badge">matching now</span> : null}</div>
              <div className="d">{describeRule(r) || 'No conditions yet'}</div>
              {tests[r.id] ? <div className="d">{tests[r.id].matches ? 'Would start a session now.' : 'Would not start now: '}{tests[r.id].conditions.filter((c) => !c.holds).map((c) => c.label).join(', ')}</div> : null}
            </div>
            <div className="ctl">
              <button className="btn sm ghost" aria-label="Move up" onClick={() => void move(i, -1)} disabled={i === 0}><Icon name="arrowUp" size={12} /></button>
              <button className="btn sm" onClick={() => void api.awake.testTrigger(r).then((t) => setTests({ ...tests, [r.id]: t }))}>Test</button>
              <button className="btn sm" onClick={() => setEditing(r)}>Edit</button>
              <Toggle on={r.enabled} onChange={(v) => void api.awake.saveTrigger({ ...r, enabled: v }).then(setCfg)} />
            </div>
          </div>
        ))}
        {editing ? <TriggerEditor rule={editing} onCancel={() => setEditing(null)} onSave={async (r) => { setCfg(await api.awake.saveTrigger(r)); setEditing(null); }} onRemove={async () => { setCfg(await api.awake.removeTrigger(editing.id)); setEditing(null); }} /> : null}
      </div>
    </>
  );
}

function TriggerEditor({ rule, onCancel, onSave, onRemove }: { rule: AwakeRule; onCancel: () => void; onSave: (r: AwakeRule) => void; onRemove: () => void }) {
  const [r, setR] = useState(rule);
  const [test, setTest] = useState<TriggerTest | null>(null);
  return (
    <div className="awake-editor" data-testid="awake-trigger-editor">
      <Row title="Name"><input className="input" style={{ width: 240 }} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} data-testid="awake-trigger-name" /></Row>
      <Row title="Match">
        <div className="seg"><button className={r.match === 'all' ? 'on' : ''} onClick={() => setR({ ...r, match: 'all' })}>All conditions</button><button className={r.match === 'any' ? 'on' : ''} onClick={() => setR({ ...r, match: 'any' })}>Any condition</button></div>
        <button className="btn sm" onClick={() => setR({ ...r, conditions: [...r.conditions, { kind: 'power' }] })}><Icon name="plus" size={12} /> Condition</button>
      </Row>
      {r.conditions.map((c, i) => (
        <CondEditor key={i} kinds={TRIGGER_KINDS} c={c} onChange={(n) => setR({ ...r, conditions: r.conditions.map((x, j) => (j === i ? n : x)) })} onRemove={() => setR({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })} />
      ))}
      <Row title="Screen during its sessions">
        <div className="seg"><button className={r.options?.display !== 'allow-sleep' ? 'on' : ''} onClick={() => setR({ ...r, options: { ...r.options, display: 'keep-on' } })}>Keep on</button><button className={r.options?.display === 'allow-sleep' ? 'on' : ''} onClick={() => setR({ ...r, options: { ...r.options, display: 'allow-sleep' } })}>May sleep</button></div>
      </Row>
      <Row title="With the lid closed"><Toggle on={!!r.options?.closedDisplay} onChange={(v) => setR({ ...r, options: { ...r.options, closedDisplay: v } })} /></Row>
      <Row title="After I turn its session off" desc="Wait this many minutes before it may start again; 0 = until its conditions change.">
        <input className="input" type="number" min={0} style={{ width: 80 }} value={r.reactivateAfterMin} onChange={(e) => setR({ ...r, reactivateAfterMin: Math.max(0, Number(e.target.value) || 0) })} />
      </Row>
      {test ? <div className="awake-test">{test.conditions.map((c, i) => <div key={i}><Icon name={c.holds ? 'check' : 'close'} size={12} /> {c.label}</div>)}<b>{test.matches ? 'Would match now' : 'Would not match now'}</b></div> : null}
      <Row title="">
        <button className="btn sm" onClick={() => void api.awake.testTrigger(r).then(setTest)} data-testid="awake-trigger-test">Would it match now?</button>
        <button className="btn sm" onClick={onRemove}>Remove</button>
        <button className="btn sm" onClick={onCancel}>Cancel</button>
        <button className="btn sm primary" onClick={() => onSave(r)} data-testid="awake-trigger-save">Save</button>
      </Row>
    </div>
  );
}

function Blockers({ on }: { on: boolean }) {
  const [b, setB] = useState<{ list: Blocker[]; source: string; error?: string } | null>(null);
  const load = () => void api.awake.blockers().then(setB);
  useEffect(load, [on]);
  return (
    <>
      <h2 className="awake-h">What keeps this computer awake</h2>
      <div className="card settings-section" data-testid="awake-blockers">
        <Row title={b ? (b.list.length ? `${b.list.length} hold${b.list.length > 1 ? 's' : ''} right now` : 'Nothing is holding it awake') : 'Looking…'} desc={b ? `${b.error ? b.error + ' ' : ''}From ${b.source}.` : undefined}>
          <button className="btn sm" onClick={load}><Icon name="refresh" size={12} /> Refresh</button>
        </Row>
        {b?.list.map((x, i) => <div key={i} className="setting"><div className="txt"><div style={{ fontWeight: 550 }}>{x.who}</div><div className="d">{x.what}{x.why ? ` · ${x.why}` : ''}</div></div></div>)}
      </div>
    </>
  );
}

function Stats({ enabled, save }: { enabled: boolean; save: (p: Partial<AwakeSettings>) => void }) {
  const [s, setS] = useState<(AwakeStats & { recent: SessionRecord[] }) | null>(null);
  useEffect(() => { void api.awake.stats().then(setS); }, []);
  const max = Math.max(1, ...(s?.week ?? [1]));
  const day = (i: number) => new Date(Date.now() - (6 - i) * 86_400_000).toLocaleDateString([], { weekday: 'short' });
  return (
    <>
      <h2 className="awake-h">Statistics</h2>
      <div className="card settings-section">
        <Row title="Keep statistics" desc="Stored on this computer only."><Toggle on={enabled} onChange={(v) => save({ stats: v })} /></Row>
        {s && enabled ? (
          <>
            <div className="awake-stats">
              <div><b>{s.sessions}</b><span>sessions</span></div>
              <div><b>{fmtDuration(s.totalMs)}</b><span>awake in total</span></div>
              <div><b>{fmtDuration(s.longestMs)}</b><span>longest</span></div>
              <div><b>{fmtDuration(s.averageMs)}</b><span>on average</span></div>
              <div><b>{s.batteryUsed}%</b><span>battery used on battery</span></div>
            </div>
            <div className="awake-week" aria-label="Last 7 days">
              {s.week.map((ms, i) => <div key={i} title={`${day(i)}: ${fmtDuration(ms)}`}><i style={{ height: `${Math.round((ms / max) * 100)}%` }} /><span>{day(i)}</span></div>)}
            </div>
            {s.recent.slice(0, 8).map((r, i) => (
              <div key={i} className="setting"><div className="txt"><div>{r.reason}</div><div className="d">{new Date(r.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {fmtDuration(r.end - r.start)} · {r.why}</div></div></div>
            ))}
            <Row title=""><button className="btn sm" onClick={() => void api.awake.resetStats().then(() => api.awake.stats().then(setS))}>Reset statistics</button></Row>
          </>
        ) : null}
      </div>
    </>
  );
}

function Appearance({ cfg, save }: { cfg: AwakeSettings; save: (p: Partial<AwakeSettings>) => void }) {
  const [quick, setQuick] = useState(cfg.quick.join(', '));
  return (
    <>
      <h2 className="awake-h">Menu bar and shortcuts</h2>
      <div className="card settings-section">
        <Row title="Show separately in the menu bar" desc="Off by default: Keep Awake shows in the Island and in the owl’s glance. On: an icon of its own (click to turn Keep Awake on or off; right-click for durations, triggers and options)."><Toggle on={cfg.menuItem} onChange={(v) => save({ menuItem: v })} /></Row>
        <Row title="Icon">
          <div className="seg">{ICON_STYLES.map((s) => <button key={s} className={cfg.iconStyle === s ? 'on' : ''} onClick={() => save({ iconStyle: s })} aria-label={ICON_NAME[s]} title={ICON_NAME[s]}>
            {/* The real menu-bar picture, drawn from the same code (static markup, no user text). */}
            <span style={{ display: 'inline-flex', width: 16, height: 16 }} dangerouslySetInnerHTML={{ __html: svgFor(s, true, 'currentColor', { id: `awake-pick-${s}` }).replace('width="22" height="22"', 'width="16" height="16"') }} />
          </button>)}</div>
        </Row>
        <Row title="Show the time left next to the icon" desc="macOS menu bar."><Toggle on={cfg.showRemaining} onChange={(v) => save({ showRemaining: v })} /></Row>
        <Row title="Quick durations" desc="Minutes, shown in the menu, the Island and here.">
          <input className="input" style={{ width: 220 }} value={quick} onChange={(e) => setQuick(e.target.value)} onBlur={() => save({ quick: quick.split(/[,\s]+/).map(Number).filter((n) => n > 0) })} />
        </Row>
        <Row title="From anywhere" desc="The Keep Awake shortcut (change it in Island settings), the command palette, keeper://awake?for=30m links, Shortcuts/Siri, and the command line: keeper awake on --for 2h." >
          <span className="muted small">keeper awake on | off | toggle | status</span>
        </Row>
      </div>
    </>
  );
}
