// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The first-run setup: Welcome → Recommended or Choose → Approvals (only what the
// chosen parts need now) → Connect (optional) → Try it. Shown once; "Set up Keeper
// again" (Help menu, command palette) opens it from the second screen with the
// current choices. Nothing is switched on, read or asked before Continue on screen 2.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { SetupContext } from '../../core/api-setup';
import { DEV_BUNDLE, SETUP_GROUPS, type SetupGroupId } from '../../core/feature-tiers';
import { choicePatch, FEATURES, featureStates, type ComputerContext, type FeatureDef } from '../../core/features';
import { formatBytes } from '../../core/format';
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
  return FEATURES.filter((f) => !f.platforms || f.platforms.includes(platform as NodeJS.Platform));
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
  const [mode, setMode] = useState<'recommended' | 'choose'>('recommended');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [also, setAlso] = useState({ login: true, updates: true, usageStats: false });
  const [after, setAfter] = useState<Route | null>(null);
  const [busy, setBusy] = useState(false);
  const comps = useEnsureComponents();

  useEffect(() => { void api.setup?.context().then(setCtx).catch(() => undefined); }, []);
  useEffect(() => { void api.setup?.recommended(declined).then(setRecommended).catch(() => undefined); }, [declined]);
  // Run again: the current choices are where Choose starts, and nothing changes until Continue.
  useEffect(() => {
    if (!again || !settings || picked) return;
    const on = [...featureStates(settings, platform).values()].filter((f) => f.on).map((f) => f.id);
    setPicked(new Set(on));
    setAlso((a) => ({ ...a, usageStats: on.includes('usageStats'), updates: settings.updateCheck !== false }));
  }, [again, settings, platform, picked]);

  const finish = async () => {
    await api.setup?.finish().catch(() => undefined);
    try { localStorage.setItem('coach.tour', '1'); } catch { /* storage unavailable */ }
    onDone();
    if (after) go(after);
  };

  const apply = async (choice: Parameters<NonNullable<typeof api.setup>['apply']>[0]) => {
    setBusy(true);
    try {
      await api.setup?.apply(choice, also);
      await api.usageStats?.setOn(also.usageStats).catch(() => undefined);
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
  const wide = step === 'choose' || step === 'approvals';
  return (
    <div className="tour setup" role="dialog" aria-modal="true" aria-label="Set up Keeper">
      <div className={`tour-card setup-card ${wide ? 'wide' : ''}`} data-step={step}>
        <div className="setup-dots" aria-hidden>{ORDER.map((s, i) => <i key={s} className={i <= n ? 'on' : ''} />)}</div>
        {step === 'welcome' ? <Welcome onNext={() => setStep('how')} skip={skip} ctx={ctx} /> : null}
        {step === 'how' ? (
          <How ctx={ctx} mode={mode} setMode={setMode} declined={declined} setDeclined={setDeclined} recommended={recommended} also={also} setAlso={setAlso} busy={busy}
            onContinue={() => (mode === 'choose' || again ? setStep('choose') : void apply({ preset: 'recommended', declined }))}
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
    </>
  );
}

// ---- 2 How do you want to set up Keeper?

function groupNames(ids: string[]): string[] {
  const on = new Set(ids);
  return SETUP_GROUPS.filter((g) => g.id !== 'general' && FEATURES.some((f) => f.setup === g.id && on.has(f.id) && f.shown !== 'advanced')).map((g) => g.name);
}

function How(p: {
  ctx: SetupContext | null; mode: 'recommended' | 'choose'; setMode: (m: 'recommended' | 'choose') => void;
  declined: NonNullable<ComputerContext['declined']>; setDeclined: (d: NonNullable<ComputerContext['declined']>) => void;
  recommended: string[] | null; also: { login: boolean; updates: boolean; usageStats: boolean }; setAlso: (a: { login: boolean; updates: boolean; usageStats: boolean }) => void;
  busy: boolean; onContinue: () => void; onPreset: (p: 'everything' | 'files') => void; skip: ReactElement; again: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [seeStats, setSeeStats] = useState(false);
  const [stats] = useUsageStats();
  const { ctx, declined } = p;
  const chips: { key: 'dev' | 'notes' | 'ai'; label: string; detail: string }[] = [];
  if (ctx?.devTools?.length) chips.push({ key: 'dev', label: 'Developer tools', detail: ctx.devTools.slice(0, 3).join(', ') + (ctx.docker ? ', Docker' : '') });
  if (ctx?.notesFound) chips.push({ key: 'notes', label: 'Notes', detail: 'an Obsidian vault' });
  if (ctx?.localAI) chips.push({ key: 'ai', label: 'AI', detail: ctx.localAI === 'apple' ? 'the AI built into this Mac' : 'Ollama on this computer' });
  const shown = chips.filter((c) => !declined.includes(c.key));
  const groups = groupNames(p.recommended ?? []);
  const machine = ctx?.model ? `this ${ctx.model}` : 'this computer';
  const check = (k: 'login' | 'updates' | 'usageStats', label: string, extra?: ReactElement) => (
    <label className="setup-check"><input type="checkbox" data-testid={`setup-also-${k}`} checked={p.also[k]} onChange={(e) => p.setAlso({ ...p.also, [k]: e.target.checked })} /> {label}{extra}</label>
  );
  return (
    <>
      <h3>How do you want to set up Keeper?</h3>
      <div className="setup-choices" role="radiogroup" aria-label="How to set up Keeper">
        <button role="radio" aria-checked={p.mode === 'recommended'} className={`setup-choice ${p.mode === 'recommended' ? 'on' : ''}`} data-testid="setup-recommended" onClick={() => p.setMode('recommended')}>
          <b>Recommended</b>
          <span className="small">The essentials, picked for {machine}.{ctx?.battery ? ' Light on battery.' : ''} About a minute.</span>
          {groups.length ? <span className="small muted">Includes: {groups.slice(0, 6).join(' · ')}</span> : null}
        </button>
        {p.mode === 'recommended' && shown.length ? (
          <div className="setup-found small" data-testid="setup-found">
            <Icon name="info" size={13} /> Also on, because we found them on this computer:{' '}
            {shown.map((c) => (
              <span key={c.key} className="setup-chip"><b>{c.label}</b> ({c.detail})<button className="icon-btn" aria-label={`Leave ${c.label} off`} onClick={() => p.setDeclined([...declined, c.key])}><Icon name="close" size={10} /></button></span>
            ))}
          </div>
        ) : null}
        {p.mode === 'recommended' ? (
          <button className="link-like small setup-included" aria-expanded={open} onClick={() => setOpen(!open)}>What’s included {open ? '▾' : '›'}</button>
        ) : null}
        {open && p.mode === 'recommended' ? (
          <ul className="setup-included-list small" data-testid="setup-included">
            {SETUP_GROUPS.filter((g) => groups.includes(g.name)).map((g) => <li key={g.id}><b>{g.name}</b> · {g.line}</li>)}
          </ul>
        ) : null}
        <button role="radio" aria-checked={p.mode === 'choose'} className={`setup-choice ${p.mode === 'choose' ? 'on' : ''}`} data-testid="setup-choose" onClick={() => p.setMode('choose')}>
          <b>Choose what you want</b>
          <span className="small">Pick each part yourself. See its size and what it needs before you turn it on.</span>
        </button>
      </div>
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
        Or start with: <button className="link-like" data-testid="setup-everything" onClick={() => p.onPreset('everything')}>Everything</button> (to try it all) · <button className="link-like" data-testid="setup-files" onClick={() => p.onPreset('files')}>Files only</button> (just a file manager)
        <br />You can change all of this later in Settings → Features. Recommended, Light, Files only and Everything are starting points there; change any part on its own.
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
  return (
    <>
      <h3>You’re set</h3>
      <p className="small">Try one thing: drag over the card below to copy its text.</p>
      <PracticeCapture />
      <p className="small">Shortcuts to remember: <b>{mac ? '⌘⇧Space' : 'Ctrl+Shift+Space'}</b> search from anywhere · <b>{mac ? '⌘⇧2' : 'Ctrl+Shift+2'}</b> copy text from the screen</p>
      <p className="small muted">The sidebar on the left lists the parts that are on; turn one on later and it appears there. Change anything later in <b>Settings</b>. Run this setup again from Help → Set up Keeper again.</p>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" data-testid="setup-done" onClick={onDone}>Start using Keeper</button>
      </div>
    </>
  );
}

/** The practice card: drag over it to copy its text; says the real reason when it does not work. */
export function PracticeCapture() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'none' | 'fail' | 'perm' | 'restart'>('idle');
  const [text, setText] = useState('');
  const go = async () => {
    setState('busy');
    // Screen Recording first: without it the picture holds only the wallpaper.
    const perms = await api.permissions.list().catch(() => null);
    const screen = perms?.items.find((i) => i.id === 'screen' || i.id === 'portal.screencast');
    if (screen?.state === 'allowed' && screen.restartNeeded) { setState('restart'); return; }
    if (perms?.platform === 'darwin' && screen && (screen.state === 'missing' || screen.state === 'denied')) { setState('perm'); return; }
    try {
      const r = await api.capture.text();
      const t = (r?.text || r?.code || '').trim();
      setText(t);
      setState(t ? 'done' : 'none');
    } catch (e) {
      setText(errorText(e));
      setState('fail');
    }
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="tour-practice" aria-label="Practice text">Meeting moved to <b>Thursday 10:30</b> · Room 4B · Code 7291</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" data-testid="setup-try" disabled={state === 'busy'} onClick={() => void go()}>{state === 'busy' ? <span className="spinner" /> : null} Try it</button>
      </div>
      {state === 'done' ? <div className="small tour-got">Copied: “{text.slice(0, 120)}”</div> : null}
      {state === 'none' ? <div className="small muted">Nothing was read. Drag over the card’s text and try again.</div> : null}
      {state === 'fail' ? <div className="small warn-text" data-testid="setup-try-error"><Icon name="warning" size={12} /> {text || 'Copying text from the screen did not work.'}</div> : null}
      {state === 'perm' ? <div className="small" data-testid="setup-try-perm"><Icon name="warning" size={12} /> Needs Screen Recording. <button className="btn sm" onClick={() => void api.permissions.request('screen')}>Allow</button></div> : null}
      {state === 'restart' ? <div className="small" data-testid="setup-try-restart">Restart Keeper to try it. <button className="btn sm" onClick={() => { rememberStep('try'); void api.permissions.restart(); }}>Restart now</button></div> : null}
    </div>
  );
}
