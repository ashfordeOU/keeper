// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The first-run setup: Welcome → What do you want Keeper for? (up to three goals
// on top of the essentials, or Choose each part) → Approvals (only what the
// chosen parts need now) → Connect (optional) → one shortcut to remember. Shown once; "Set up Keeper
// again" (Help menu, command palette) opens it from the second screen with the
// current choices. Nothing is switched on, read or asked before Continue on screen 2.

import { RestoreSheet } from '../components/KeeperBackup';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { SetupContext } from '../../core/api-setup';
import { DEV_BUNDLE, SETUP_GROUPS, type SetupGroupId } from '../../core/feature-tiers';
import { choicePatch, FEATURES, featureOffered, featureStates, type ComputerContext, type FeatureDef } from '../../core/features';
import { formatBytes } from '../../core/format';
import { MODES, modeDef, modeOf, suggestMode, type ModeId } from '../../core/modes';
import { cleanGoals, GOALS, goalParts, goalsLine, MAX_GOALS, normalizeTips, toggleGoal, type GoalId } from '../../core/goals';
import { approvalsFor, approvalsLine, type PermPlatform, type SetupApprovals } from '../../core/permissions';
import { errorText } from '../../core/ipc-error';
import { api } from '../api';
import { useEnsureComponents } from '../components/ComponentsPanel';
import { Icon, type IconName } from '../components/Icon';
import { UsageStatsViewer, useUsageStats } from '../components/UsageStatsPanel';
import { AccountDialog } from '../pim/AccountDialog';
import { useStore, type Route } from '../state';
import './setup.css';

type Step = 'welcome' | 'how' | 'choose' | 'approvals' | 'connect' | 'try';
const ORDER: Step[] = ['welcome', 'how', 'approvals', 'connect', 'try'];

const STEP_KEY = 'setup.step';
/** Where setup was when Keeper restarted for an approval: it comes back there. */
export function rememberStep(step: Step) {
  try { localStorage.setItem(STEP_KEY, step); } catch { /* storage unavailable */ }
}
function takeStep(): Step | null {
  try {
    const v = localStorage.getItem(STEP_KEY) as Step | null;
    localStorage.removeItem(STEP_KEY);
    return v;
  } catch {
    return null;
  }
}

const isMacUi = () => navigator.platform.startsWith('Mac');

/** Parts this system can run, shown in setup. */
function partsFor(platform: string): FeatureDef[] {
  return FEATURES.filter((f) => featureOffered(f, platform));
}

// ---------------------------------------------------------------- the host

/** Opens setup again from its second screen (Help → Set up Keeper again, the palette). */
export function openSetupAgain() {
  window.dispatchEvent(new CustomEvent('keeper-setup-again'));
}

export function FirstRunHost({ firstRun }: { firstRun: boolean }) {
  const [step, setStep] = useState<Step | null>(() => {
    const back = takeStep();
    if (back) return back;
    return firstRun ? 'welcome' : null;
  });
  const [again, setAgain] = useState(false);
  useEffect(() => {
    const open = () => { setAgain(true); setStep('how'); };
    window.addEventListener('keeper-setup-again', open);
    const off = api.on('setup-again', open);
    return () => { window.removeEventListener('keeper-setup-again', open); off?.(); };
  }, []);
  if (!step) return null;
  return <FirstRun step={step} setStep={setStep} again={again} onDone={() => setStep(null)} />;
}

// ---------------------------------------------------------------- the screens

function FirstRun({ step, setStep, again, onDone }: { step: Step; setStep: (s: Step) => void; again: boolean; onDone: () => void }) {
  const store = useStore();
  const { settings, info, go } = store;
  const platform = info?.platform ?? (isMacUi() ? 'darwin' : '');
  const [ctx, setCtx] = useState<SetupContext | null>(null);
  const [declined, setDeclined] = useState<NonNullable<ComputerContext['declined']>>([]);
  const [recommended, setRecommended] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [also, setAlso] = useState({ login: true, updates: true, usageStats: false });
  const [goals, setGoals] = useState<GoalId[]>(() => cleanGoals(settings?.setupGoals));
  // The mode comes first (Standard unless chosen); the goals add their parts on top of it (core/modes.ts).
  const [mode, setMode] = useState<ModeId>(() => modeOf(settings ?? ({} as never)).base);
  const [after, setAfter] = useState<Route | null>(null);
  const [busy, setBusy] = useState(false);
  const comps = useEnsureComponents();

  useEffect(() => { void api.setup?.context().then(setCtx).catch(() => undefined); }, []);
  useEffect(() => { void api.setup?.recommended(declined).then(setRecommended).catch(() => undefined); }, [declined]);
  // Run again: the current choices are where Choose starts, and nothing changes until Continue.
  useEffect(() => {
    if (!again || !settings || picked) return;
    const on = [...featureStates(settings, platform).values()].filter((f) => f.on).map((f) => f.id);
    setPicked(new Set(goalParts(on, goals, platform)));
    setAlso((a) => ({ ...a, usageStats: on.includes('usageStats'), updates: settings.updateCheck !== false }));
  }, [again, settings, platform, picked]);

  const finish = async () => {
    await api.setup?.finish().catch(() => undefined);
    try { localStorage.setItem('coach.tour', '1'); } catch { /* storage unavailable */ }
    onDone();
    if (after) go(after);
  };

  // The parts on once the mode is set (the goals add to these).
  let modeParts: string[] | null = null;
  const withMode = async (next: () => unknown) => {
    const cur = modeOf(settings ?? ({} as never));
    if (mode !== cur.base || mode !== 'standard') {
      setBusy(true);
      try {
        if (mode !== cur.base) await api.modes.switch({ base: mode, addons: cur.addons });
        const rows = await api.features.list();
        modeParts = rows.filter((r) => r.wanted).map((r) => r.id);
      } catch (e) {
        store.toast(errorText(e));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    await next();
  };

  const apply = async (choice: Parameters<NonNullable<typeof api.setup>['apply']>[0]) => {
    setBusy(true);
    try {
      await api.setup?.apply(choice, also);
      await api.usageStats?.setOn(also.usageStats).catch(() => undefined);
      // The goals are kept (for Run again and the week of tips), and the tips start now.
      await store.updateSettings({ setupGoals: goals, tips: { ...normalizeTips(settings?.tips), start: normalizeTips(settings?.tips).start || Date.now() } }).catch(() => undefined);
      setStep('approvals');
    } catch (e) {
      store.toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const skip = again
    ? <button className="btn sm ghost" data-testid="setup-close" onClick={onDone}>Cancel</button>
    : <button className="btn sm ghost" data-testid="setup-skip" onClick={() => void finish()}>Skip setup</button>;
  const n = ORDER.indexOf(step === 'choose' ? 'how' : step);
  const wide = step === 'choose' || step === 'approvals' || step === 'how';
  return (
    <div className="tour setup" role="dialog" aria-modal="true" aria-label="Set up Keeper">
      <div className={`tour-card setup-card ${wide ? 'wide' : ''}`} data-step={step}>
        <div className="setup-dots" aria-hidden>{ORDER.map((s, i) => <i key={s} className={i <= n ? 'on' : ''} />)}</div>
        {step === 'welcome' ? <Welcome onNext={() => setStep('how')} skip={skip} ctx={ctx} /> : null}
        {step === 'how' ? (
          <How ctx={ctx} declined={declined} setDeclined={setDeclined} recommended={recommended} also={also} setAlso={setAlso} busy={busy}
            goals={goals} setGoals={setGoals} onChoose={() => setStep('choose')}
            mode={mode} setMode={setMode}
            onContinue={() => void withMode(() => (again ? (setPicked(null), setStep('choose')) : goals.length || mode !== 'standard' ? apply({ parts: goalParts(modeParts ?? recommended ?? [], goals, platform) }) : apply({ preset: 'recommended', declined })))}
            onPreset={(p) => void apply({ preset: p })} skip={skip} again={again} />
        ) : null}
        {step === 'choose' ? (
          <Choose platform={platform} picked={picked ?? new Set(recommended ?? [])} setPicked={setPicked} busy={busy}
            onBack={() => setStep('how')} onContinue={(ids) => void apply({ parts: ids })} sizes={comps} />
        ) : null}
        {step === 'approvals' ? <Approvals platform={platform} onNext={() => setStep('connect')} /> : null}
        {step === 'connect' ? <Connect ctx={ctx} after={after} setAfter={setAfter} onNext={() => setStep('try')} /> : null}
        {step === 'try' ? <TryIt onDone={() => void finish()} /> : null}
        {comps.busy && comps.progress !== undefined ? (
          <div className="setup-downloads small muted" role="status" data-testid="setup-downloads">
            <span className="progress"><i style={{ width: `${Math.round(comps.progress * 100)}%` }} /></span> Getting {downloadingName(comps.list)} ready · {Math.round(comps.progress * 100)}%
          </div>
        ) : null}
      </div>
    </div>
  );
}

function downloadingName(list: { state: string; name: string }[] | undefined | null): string {
  const d = (list ?? []).filter((c) => c.state === 'downloading' || c.state === 'verifying');
  return d.length === 1 ? d[0].name.toLowerCase() : `${d.length} parts`;
}

// ---- 1 Welcome

function Welcome({ onNext, skip, ctx }: { onNext: () => void; skip: ReactElement; ctx: SetupContext | null }) {
  const pillars: [IconName, string, string][] = [
    ['folder', 'Your files', 'Find anything, clean up, convert, back up.'],
    ['shield', 'Your computer', 'Health, privacy and security, with fixes.'],
    ['island', 'The Island', ctx?.notch ? 'A small bar under the notch for music, timers and what’s next.' : 'A small bar at the top of the screen for music, timers and what’s next.'],
    ['plus', 'More when you want it', 'Mail, notes, AI, your other devices, screen recording.'],
  ];
  const [moving, setMoving] = useState(false);
  return (
    <>
      <h3>Welcome to Keeper</h3>
      <p className="small">One app for your files and your computer. It all runs on this computer, and you choose what’s on.</p>
      <ul className="setup-pillars">
        {pillars.map(([icon, title, text]) => <li key={title}><Icon name={icon} size={16} /><span><b>{title}</b> · {text}</span></li>)}
      </ul>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        {skip}
        <button className="btn primary" autoFocus data-testid="setup-start" onClick={onNext}>Get started</button>
      </div>
      <p className="setup-moving small muted">Moving from another computer? <button className="link-like" data-testid="setup-moving" onClick={() => setMoving(true)}>Restore a Keeper backup</button></p>
      {moving ? <RestoreSheet onClose={() => setMoving(false)} /> : null}
    </>
  );
}

// ---- 2 How do you want to set up Keeper?

function groupNames(ids: string[]): string[] {
  const on = new Set(ids);
  return SETUP_GROUPS.filter((g) => g.id !== 'general' && FEATURES.some((f) => f.setup === g.id && on.has(f.id) && f.shown !== 'advanced')).map((g) => g.name);
}

function How(p: {
  ctx: SetupContext | null;
  declined: NonNullable<ComputerContext['declined']>; setDeclined: (d: NonNullable<ComputerContext['declined']>) => void;
  recommended: string[] | null; also: { login: boolean; updates: boolean; usageStats: boolean }; setAlso: (a: { login: boolean; updates: boolean; usageStats: boolean }) => void;
  busy: boolean; onContinue: () => void; onPreset: (p: 'everything' | 'files') => void; skip: ReactElement; again: boolean;
  goals: GoalId[]; setGoals: (g: GoalId[]) => void; onChoose: () => void;
  mode: ModeId; setMode: (m: ModeId) => void;
}) {
  const [seeStats, setSeeStats] = useState(false);
  const [stats] = useUsageStats();
  const { ctx, declined } = p;
  const chips: { key: 'dev' | 'notes' | 'ai'; label: string; detail: string }[] = [];
  if (ctx?.devTools?.length) chips.push({ key: 'dev', label: 'Developer tools', detail: ctx.devTools.slice(0, 3).join(', ') + (ctx.docker ? ', Docker' : '') });
  if (ctx?.notesFound) chips.push({ key: 'notes', label: 'Notes', detail: 'an Obsidian vault' });
  if (ctx?.localAI) chips.push({ key: 'ai', label: 'AI', detail: ctx.localAI === 'apple' ? 'the AI built into this Mac' : 'Ollama on this computer' });
  const shown = chips.filter((c) => !declined.includes(c.key));
  const groups = groupNames([...(p.recommended ?? []), ...p.goals.flatMap((g) => GOALS.find((x) => x.id === g)?.parts ?? [])]);
  const machine = ctx?.model ? `this ${ctx.model}` : 'this computer';
  const hint = suggestMode(p.goals);
  const check = (k: 'login' | 'updates' | 'usageStats', label: string, extra?: ReactElement) => (
    <label className="setup-check"><input type="checkbox" data-testid={`setup-also-${k}`} checked={p.also[k]} onChange={(e) => p.setAlso({ ...p.also, [k]: e.target.checked })} /> {label}{extra}</label>
  );
  return (
    <>
      <div className="setup-mode" data-testid="setup-mode">
        <div className="small muted">Who is it for?</div>
        <div className="seg setup-mode-seg" role="radiogroup" aria-label="Who is Keeper for? Pick a mode">
          {MODES.map((m) => <button key={m.id} role="radio" aria-checked={p.mode === m.id} className={p.mode === m.id ? 'on' : ''} data-testid={`setup-mode-${m.id}`} title={`${m.who}: ${m.line}`} onClick={() => p.setMode(m.id)}>{m.name}</button>)}
        </div>
        <div className="small muted" data-testid="setup-mode-line">{modeDef(p.mode)!.line}{hint !== p.mode && hint !== 'standard' ? <> · <button className="link-like" data-testid="setup-mode-hint" onClick={() => p.setMode(hint)}>{modeDef(hint)!.name} suits these goals</button></> : null}</div>
      </div>
      <h3 className="setup-hero">What do you want Keeper for?</h3>
      <p className="small muted">Pick up to three. Keeper adds what they need to {p.mode === 'standard' ? `the essentials for ${machine}` : `${modeDef(p.mode)!.name}`}.</p>
      <div className="setup-goals" role="group" aria-label="What do you want Keeper for? Pick up to three">
        {GOALS.map((g) => {
          const on = p.goals.includes(g.id);
          const full = !on && p.goals.length >= MAX_GOALS;
          return (
            <button key={g.id} className={`setup-goal ${on ? 'on' : ''}`} aria-pressed={on} disabled={full} data-testid={`setup-goal-${g.id}`} onClick={() => p.setGoals(toggleGoal(p.goals, g.id))}>
              <span className="setup-goal-art" aria-hidden><Icon name={g.icon as IconName} size={22} /></span>
              <b>{g.title}</b>
              <span className="small muted">{g.line}</span>
              {on ? <span className="setup-goal-tick" aria-hidden><Icon name="check" size={12} /></span> : null}
            </button>
          );
        })}
      </div>
      <div className="small muted setup-goals-line" data-testid="setup-goals-line">{goalsLine(p.goals)}{groups.length ? ` · ${groups.slice(0, 5).join(' · ')}` : ''}</div>
      {shown.length ? (
        <div className="setup-found small" data-testid="setup-found">
          <Icon name="info" size={13} /> Also on, because we found them here:{' '}
          {shown.map((c) => (
            <span key={c.key} className="setup-chip"><b>{c.label}</b> ({c.detail})<button className="icon-btn" aria-label={`Leave ${c.label} off`} onClick={() => p.setDeclined([...declined, c.key])}><Icon name="close" size={10} /></button></span>
          ))}
        </div>
      ) : null}
      <div className="setup-also">
        <div className="small muted">Also:</div>
        {check('login', 'Open Keeper when I log in')}
        {check('updates', 'Check for updates automatically')}
        {check('usageStats', 'Send anonymous usage stats', <> · <button className="link-like" data-testid="setup-see-stats" onClick={(e) => { e.preventDefault(); setSeeStats(!seeStats); }}>See what’s sent</button></>)}
        {seeStats && stats ? <div className="tour-ustats-scroll"><UsageStatsViewer s={stats} /></div> : null}
        {seeStats ? <div className="small muted">Once a day. Never your files, searches or names.</div> : null}
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        {p.skip}
        <button className="btn primary" data-testid="setup-continue" disabled={p.busy} onClick={p.onContinue}>{p.busy ? <span className="spinner" /> : null} Continue</button>
      </div>
      <div className="small muted setup-foot">
        <button className="link-like" data-testid="setup-choose" onClick={p.onChoose}>Choose each part yourself</button> · Or start with <button className="link-like" data-testid="setup-everything" onClick={() => p.onPreset('everything')}>Everything</button> or <button className="link-like" data-testid="setup-files" onClick={() => p.onPreset('files')}>Files only</button>
        <br />Change any of it later in Settings → Features.
      </div>
    </>
  );
}

// ---- 2b Choose what you want

function Choose({ platform, picked, setPicked, busy, onBack, onContinue, sizes }: {
  platform: string; picked: Set<string>; setPicked: (s: Set<string>) => void; busy: boolean; onBack: () => void; onContinue: (ids: string[]) => void;
  sizes: ReturnType<typeof useEnsureComponents>;
}) {
  const { settings } = useStore();
  const [open, setOpen] = useState<SetupGroupId | 'dev' | null>(null);
  const [more, setMore] = useState<Set<string>>(new Set());
  useEffect(() => { void api.components?.sizes?.().catch(() => undefined); }, []);
  const parts = useMemo(() => partsFor(platform), [platform]);
  // What would be on, with what the picked parts need.
  const onNow = useMemo(() => {
    if (!settings) return [...picked];
    const s = { ...settings, ...choicePatch(settings, picked) };
    return [...featureStates(s, platform).values()].filter((f) => f.on).map((f) => f.id);
  }, [settings, picked, platform]);
  const pending = sizes.pending(onNow);
  const bytes = pending.reduce((n, c) => n + (c.downloadSize || 0), 0);
  const estimate = pending.some((c) => c.estimate);
  const approvals = approvalsFor((['darwin', 'win32', 'linux'].includes(platform) ? platform : 'linux') as PermPlatform, onNow);
  const setOne = (id: string, on: boolean) => { const n = new Set(picked); if (on) n.add(id); else n.delete(id); setPicked(n); };
  const groupParts = (g: SetupGroupId) => parts.filter((f) => f.setup === g);
  const groupOn = (ids: string[]) => ids.some((id) => picked.has(id));
  const switchGroup = (ids: FeatureDef[], on: boolean) => {
    const n = new Set(picked);
    const rec = ids.filter((f) => f.tier === 'recommended' && f.shown !== 'advanced');
    for (const f of on ? (rec.length ? rec : ids.filter((x) => x.shown !== 'advanced').slice(0, 1)) : ids) if (!f.always) { if (on) n.add(f.id); else n.delete(f.id); }
    setPicked(n);
  };
  const partSize = (id: string) => { const c = sizes.pending([id]); const b = c.reduce((x, y) => x + y.downloadSize, 0); return b ? `${c.some((y) => y.estimate) ? 'about ' : ''}${formatBytes(b)}` : ''; };
  const row = (f: FeatureDef) => (
    <label key={f.id} className="setup-part" data-testid={`setup-part-${f.id}`}>
      <input type="checkbox" checked={f.always || picked.has(f.id)} disabled={f.always} onChange={(e) => setOne(f.id, e.target.checked)} />
      <span className="grow"><b>{f.plain ?? f.name}</b>{f.shown === 'advanced' ? <span className="badge sm">Advanced</span> : null}<span className="small muted"> {f.description}</span></span>
      {partSize(f.id) ? <span className="small muted">{partSize(f.id)}</span> : null}
    </label>
  );
  const card = (key: SetupGroupId | 'dev', name: string, line: string, members: FeatureDef[], needs?: string) => {
    const basic = members.filter((f) => f.shown !== 'advanced');
    const adv = members.filter((f) => f.shown === 'advanced');
    const always = members.some((f) => f.always);
    const on = always || groupOn(members.map((f) => f.id));
    const count = members.filter((f) => picked.has(f.id) || f.always).length;
    const size = sizes.pending(members.map((f) => f.id).filter((id) => picked.has(id))).reduce((n, c) => n + c.downloadSize, 0);
    return (
      <div key={key} className={`setup-group ${on ? 'on' : ''}`} data-testid={`setup-group-${key}`}>
        <div className="setup-group-head">
          <input type="checkbox" aria-label={name} checked={on} disabled={always} onChange={(e) => switchGroup(members, e.target.checked)} />
          <div className="grow"><b>{name}</b><div className="small muted">{line}</div></div>
          {always ? <span className="small muted">Always on</span> : null}
        </div>
        <button className="link-like small setup-group-more" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
          {open === key ? '▾' : '▸'} {count} of {members.length} parts{size ? ` · ${formatBytes(size)} to download` : ''}{needs ? ` · Needs: ${needs}` : ''}
        </button>
        {open === key ? (
          <div className="setup-parts">
            {basic.map(row)}
            {adv.length && !more.has(key) ? <button className="link-like small" onClick={() => setMore(new Set([...more, key]))}>Show more parts ({adv.length})</button> : null}
            {more.has(key) ? adv.map(row) : null}
          </div>
        ) : null}
      </div>
    );
  };
  const devParts = parts.filter((f) => DEV_BUNDLE.includes(f.id) || f.id === 'containers');
  return (
    <>
      <h3>Choose what you want</h3>
      <p className="small muted">Turn on a group for its main parts, or open it to pick each one.</p>
      <div className="setup-groups">
        {SETUP_GROUPS.map((g) => {
          const m = groupParts(g.id);
          return m.length ? card(g.id, g.name, g.line, m, isMacUi() ? g.needs : undefined) : null;
        })}
        {card('dev', 'For developers', 'Terminals, local servers and ports, containers, coding assistants.', devParts)}
      </div>
      <div className="setup-footer" data-testid="setup-footer">
        <span className="small"><b data-testid="setup-count">{onNow.length}</b> parts on{bytes ? <> · {estimate ? 'about ' : ''}{formatBytes(bytes)} to download</> : null} · <span data-testid="setup-approvals-count">{approvals.now.length}</span> {approvals.now.length === 1 ? 'approval' : 'approvals'}</span>
        <span className="grow" />
        <button className="btn sm ghost" onClick={onBack}>Back</button>
        <button className="btn primary" data-testid="setup-choose-continue" disabled={busy} onClick={() => onContinue([...picked])}>{busy ? <span className="spinner" /> : null} Continue</button>
      </div>
    </>
  );
}

// ---- 3 Approvals

const NOW_WHY: Record<string, string> = {
  screen: 'for screenshots and copying text from the screen.',
  fullDisk: 'so search can see where Mail and Safari downloads came from, and macOS asks once instead of for each folder.',
  accessibility: 'so dictation can type and Stage can tidy windows.',
  input: 'for hold-to-talk and showing your keys on Stage.',
};

function Approvals({ platform, onNext }: { platform: string; onNext: () => void }) {
  const { updateSettings } = useStore();
  const [a, setA] = useState<SetupApprovals | null>(null);
  const [states, setStates] = useState<Record<string, { state: string; restart?: boolean }>>({});
  const [started, setStarted] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { void api.setup?.approvals().then(setA).catch(() => setA({ now: [], onUse: [], restarts: 0 })); }, []);
  // Live states while this screen is open (System Settings answers arrive while Keeper is in the background).
  useEffect(() => {
    if (!started) return;
    const read = () => void api.permissions.list().then((r) => setStates(Object.fromEntries(r.items.map((i) => [i.id, { state: i.state, restart: i.restartNeeded }])))).catch(() => undefined);
    read();
    const t = setInterval(read, 1500);
    return () => clearInterval(t);
  }, [started]);
  if (!a) return <div className="spinner" />;
  const now = a.now;
  const allowed = (id: string) => states[id]?.state === 'allowed';
  const restart = now.some((d) => states[d.id]?.restart);
  const ask = async (id: string) => {
    const r = await api.permissions.request(id).catch((e) => ({ ok: false, message: errorText(e) }));
    if (r.message) setMsg(r.message);
  };
  const start = async () => {
    setStarted(true);
    await updateSettings({ permissionsSetup: 'all' });
    const first = now.find((d) => !allowed(d.id) && !d.optional) ?? now.find((d) => !allowed(d.id));
    if (first) await ask(first.id);
  };
  const later = async () => {
    await updateSettings({ permissionsSetup: 'onDemand' });
    onNext();
  };
  const restartNow = () => {
    rememberStep('connect');
    void api.permissions.restart();
  };
  return (
    <>
      <h3>A few approvals</h3>
      {now.length ? (
        <>
          <p className="small">The parts you chose work better with your OK in {platform === 'darwin' ? 'System Settings' : 'Settings'}. We’ll open each one for you.</p>
          <div className="small"><b>Now</b> · <span data-testid="setup-now-line">{approvalsLine(a)}</span></div>
          <ul className="setup-approvals" data-testid="setup-now">
            {now.map((d) => (
              <li key={d.id} data-testid={`setup-now-${d.id}`} data-state={states[d.id]?.state ?? ''}>
                {allowed(d.id) ? <Icon name="check" size={14} /> : <span className="setup-ring" aria-hidden />}
                <span className="grow"><b>{d.name}{d.optional ? ' (optional)' : ''}</b>: {NOW_WHY[d.id] ?? d.why}{d.restart ? <i> Restart needed.</i> : null}</span>
                {started && !allowed(d.id) ? <button className="btn sm" onClick={() => void ask(d.id)}>{platform === 'darwin' ? 'Open System Settings' : 'Allow'}</button> : null}
              </li>
            ))}
          </ul>
        </>
      ) : <p className="small" data-testid="setup-nothing-now">Nothing to approve now.</p>}
      {a.onUse.length ? (
        <div className="small"><b>When you first use it</b> (nothing to do now)<div className="muted" data-testid="setup-on-use">{a.onUse.map((d) => d.name).join(' · ')}</div></div>
      ) : null}
      {msg ? <div className="small muted" role="status">{msg}</div> : null}
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        {now.length && !started ? (
          <>
            <button className="btn sm ghost" data-testid="setup-later" onClick={() => void later()}>Do this later</button>
            <button className="btn primary" data-testid="setup-approve-start" onClick={() => void start()}>Start</button>
          </>
        ) : (
          <>
            {restart ? <button className="btn" data-testid="setup-restart" onClick={restartNow}>Restart Keeper now</button> : null}
            <button className="btn primary" data-testid="setup-approvals-next" onClick={onNext}>{restart ? 'Restart later' : 'Next'}</button>
          </>
        )}
      </div>
    </>
  );
}

// ---- 4 Connect

function Connect({ ctx, after, setAfter, onNext }: { ctx: SetupContext | null; after: Route | null; setAfter: (r: Route | null) => void; onNext: () => void }) {
  const { toast } = useStore();
  const [adding, setAdding] = useState(false);
  const [mailWasOn, setMailWasOn] = useState(true);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const openMail = async () => {
    const rows = await api.features.list();
    const was = rows.find((r) => r.id === 'mail')?.on ?? false;
    setMailWasOn(was);
    if (!was) await api.features.set('mail', true);
    setAdding(true);
  };
  const ai = ctx?.localAI;
  const useAI = async () => {
    const ok = await api.setup?.useAI(ai).catch(() => false);
    setDone({ ...done, ai: !!ok });
    if (!ok) toast('Keeper could not use that AI. Choose one later in Settings → AI.');
  };
  const later = (key: string, feature: string, route: Route) => async () => {
    await api.features.set(feature, true).catch(() => undefined);
    setAfter(route);
    setDone({ ...done, [key]: true });
  };
  return (
    <>
      <h3>Connect your accounts <span className="small muted">(optional)</span></h3>
      <div className="setup-connect">
        <div className="setup-conn" data-testid="setup-conn-mail"><Icon name="mail" size={16} /><span className="grow"><b>Mail</b> · Add Gmail, Outlook, iCloud or any mail account.</span>
          {done.mail ? <span className="small ok"><Icon name="check" size={12} /> Added</span> : <button className="btn sm" onClick={() => void openMail()}>Add account</button>}</div>
        <div className="setup-conn" data-testid="setup-conn-ai"><Icon name="sparkle" size={16} />
          {ai ? <span className="grow"><b>AI</b> · We found {ai === 'apple' ? 'the AI built into this Mac' : 'Ollama on this computer'}.</span> : <span className="grow"><b>AI</b> · Choose an AI: one on this computer (free) or an online one with your key. <button className="link-like" onClick={() => void api.system.openExternal('https://console.anthropic.com/settings/keys')}>Get a key <Icon name="external" size={10} /></button></span>}
          {ai ? (done.ai ? <span className="small ok"><Icon name="check" size={12} /> In use</span> : <button className="btn sm" data-testid="setup-use-ai" onClick={() => void useAI()}>Use it</button>) : (
            done.ai ? <span className="small ok">Opens when you finish</span> : <button className="btn sm" onClick={() => { setAfter({ name: 'settings', arg: 'brain' } as Route); setDone({ ...done, ai: true }); }}>Choose</button>
          )}</div>
        <div className="setup-conn" data-testid="setup-conn-devices"><Icon name="phone" size={16} /><span className="grow"><b>Your devices</b> · Pair a phone or another computer.</span>
          {done.devices ? <span className="small ok">Opens when you finish</span> : <button className="btn sm" onClick={() => void later('devices', 'link', { name: 'devices' } as Route)()}>Pair</button>}</div>
        <div className="setup-conn" data-testid="setup-conn-cloud"><Icon name="cloud" size={16} /><span className="grow"><b>Cloud</b> · Add Google Drive, Dropbox, OneDrive or a server.</span>
          {done.cloud ? <span className="small ok">Opens when you finish</span> : <button className="btn sm" onClick={() => void later('cloud', 'remote', { name: 'network' } as Route)()}>Add</button>}</div>
      </div>
      {after ? <div className="small muted">Keeper opens that page when you finish setup.</div> : null}
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm ghost" data-testid="setup-connect-skip" onClick={onNext}>Skip for now</button>
        <button className="btn primary" data-testid="setup-connect-next" onClick={onNext}>Next</button>
      </div>
      {adding ? <AccountDialog onClose={() => { setAdding(false); if (!mailWasOn && !done.mail) void api.features.set('mail', false); }} onAdded={() => { setDone({ ...done, mail: true }); setAdding(false); }} /> : null}
    </>
  );
}

// ---- 5 You're set + Try it

function TryIt({ onDone }: { onDone: () => void }) {
  const mac = isMacUi();
  const { settings } = useStore();
  const key = (settings?.quickSearchShortcut ?? 'CommandOrControl+Shift+Space').replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace(/Shift/g, mac ? '⇧' : 'Shift').replace(/Alt/g, mac ? '⌥' : 'Alt').replace(/\+/g, mac ? '' : '+');
  return (
    <>
      <h3 className="setup-hero">You’re set</h3>
      <p className="small">One shortcut to remember. Press it in any app and type what you’re looking for:</p>
      <div className="setup-shortcut" data-testid="setup-shortcut"><kbd>{key}</kbd><span className="small muted">Search from anywhere</span></div>
      <p className="small muted">Everything else is one click away. Each page has a <b>?</b> that explains it, and for your first week Home shows one short tip a day.</p>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" data-testid="setup-done" autoFocus onClick={onDone}>Start using Keeper</button>
      </div>
    </>
  );
}

