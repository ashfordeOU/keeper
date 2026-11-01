// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Guided fixes in the window: the panel that walks through a fix, simple
// drawings of a settings window, hints on Keeper's pages, coach marks, the
// first-run tour and the small window that stays on top while the person is in
// System Settings.

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { GuideList } from '../core/api-guide';
import { progress, startFlow, stepFlow, type FlowState } from '../core/guide/flow';
import { fillTerms, gt, guideLang, osTerm, type GuideLang } from '../core/guide/strings';
import type { Area, AutoFixPreview, DiagramId, FindingView, GuideStep, Severity } from '../core/guide/types';
import { formatBytes } from '../core/format';
import { api } from './api';
import { Icon } from './components/Icon';
import { resolveLanguage } from './i18n';
import { useStore, type Route } from './state';
import { TourUsageStats } from './components/UsageStatsPanel';
import { openPermissions, PermissionsPanel, takeReopen } from './components/PermissionsPanel';
import './styles/guide.css';

// ---------------------------------------------------------------- shared state: which guide is open

let openId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Opens the guide panel for a finding (or a flow, as flow:<id>). */
export function openGuide(id: string | null) {
  openId = id;
  try {
    if (id) localStorage.setItem('guide.last', id);
  } catch {
    /* storage unavailable */
  }
  emit();
}

function useOpenId(): string | null {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => openId);
}

export function useGuideLang(): GuideLang {
  const { settings } = useStore();
  return guideLang(resolveLanguage(settings?.language));
}

/** The To do list, kept fresh by the main process. */
export function useGuideList(): [GuideList | null, () => void] {
  const [list, setList] = useState<GuideList | null>(null);
  const load = () => void api.guide?.list().then(setList).catch(() => undefined);
  useEffect(() => {
    load();
    const off = api.on('guide-changed', () => load());
    // Coming back to Keeper after doing a step in System Settings: check again.
    const focus = () => api.guide?.focus?.();
    window.addEventListener('focus', focus);
    return () => { off(); window.removeEventListener('focus', focus); };
  }, []);
  return [list, load];
}

export const AREA_LABEL: Record<Area, string> = { space: 'Space', storage: 'Storage', security: 'Security', privacy: 'Privacy', performance: 'Speed', network: 'Network', backup: 'Backups', updates: 'Updates' };
export const AREA_ICON: Record<Area, string> = { space: 'broom', storage: 'disk', security: 'shield', privacy: 'eye', performance: 'bolt', network: 'globe', backup: 'cloud', updates: 'refresh' };
export const SEV_CLASS: Record<Severity, string> = { critical: 'danger', high: 'danger', medium: 'warn', low: '', info: '' };

// ---------------------------------------------------------------- drawings of a settings window

/** A simple, generic drawing — never a copy of the real window — with the thing to press highlighted. */
export function GuideDiagram({ kind, label, platform }: { kind: DiagramId; label?: string; platform: string }) {
  const mac = platform === 'darwin';
  const rows = ['', '', label ?? '', '', ''];
  return (
    <svg className="guide-diagram" viewBox="0 0 280 150" role="img" aria-label={label ? `Look for “${label}”` : 'Settings window'}>
      <rect x="1" y="1" width="278" height="148" rx="10" className="gd-win" />
      {mac ? <g>{[14, 26, 38].map((x, i) => <circle key={i} cx={x} cy="12" r="4" className="gd-dot" />)}</g> : <rect x="1" y="1" width="278" height="20" rx="10" className="gd-bar" />}
      <rect x="8" y="26" width="72" height="116" rx="6" className="gd-side" />
      {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x="14" y={34 + i * 17} width={i === 2 ? 58 : 44} height="8" rx="4" className={i === 2 ? 'gd-hl-soft' : 'gd-line'} />)}
      {rows.map((_r, i) => {
        const y = 32 + i * 22;
        const hl = i === 2;
        return (
          <g key={i}>
            <rect x="88" y={y} width="184" height="18" rx="5" className={hl ? 'gd-row-hl' : 'gd-row'} />
            {hl && label ? <text x="96" y={y + 12.5} className="gd-text">{label.length > 24 ? label.slice(0, 23) + '…' : label}</text> : <rect x="96" y={y + 6} width={60 + (i * 13) % 40} height="6" rx="3" className="gd-line" />}
            {kind === 'settings-toggle' ? <g><rect x="244" y={y + 4} width="20" height="10" rx="5" className={hl ? 'gd-toggle-on' : 'gd-toggle'} /><circle cx={hl ? 259 : 249} cy={y + 9} r="3.6" className="gd-knob" /></g> : null}
            {kind === 'settings-button' && hl ? <rect x="222" y={y + 3} width="44" height="12" rx="6" className="gd-button" /> : null}
          </g>
        );
      })}
      {kind !== 'settings-list' ? null : <path d="M262 85 l-8 -5 v10 z" className="gd-arrow" />}
    </svg>
  );
}

// ---------------------------------------------------------------- the guide panel

function StepView({ step, lang, platform, index, state }: { step: GuideStep; lang: GuideLang; platform: string; index: number; state: FlowState }) {
  const text = fillTerms(step.text, lang);
  const status = state.steps[index];
  return (
    <li className={`guide-step ${index === state.index ? 'on' : ''} ${status}`}>
      <span className="guide-num">{status === 'done' ? <Icon name="check" size={12} /> : index + 1}</span>
      <div className="grow">
        <div>{text}</div>
        {index === state.index && step.diagram ? <GuideDiagram kind={step.diagram} label={step.term ? osTerm(step.term, lang) : undefined} platform={platform} /> : null}
      </div>
    </li>
  );
}

function stepsOf(f: FindingView): GuideStep[] {
  return f.fix.kind === 'auto' ? [] : f.fix.steps ?? [];
}

/** Walks through one fix: why, what to do, and the check afterwards. */
export function GuideBody({ id, compact, onClose }: { id: string; compact?: boolean; onClose?: () => void }) {
  const lang = useGuideLang();
  const { go, toast } = useStore();
  const [f, setF] = useState<FindingView | null | undefined>(undefined);
  const [platform, setPlatform] = useState('linux');
  const [flow, setFlow] = useState<FlowState>(startFlow([]));
  const [preview, setPreview] = useState<AutoFixPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; undoable?: boolean } | null>(null);
  const [ai, setAi] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setResult(null); setPreview(null); setAi(null);
    void api.guide.get(id).then((x) => {
      if (!alive) return;
      setF(x);
      if (x) setFlow(startFlow(stepsOf(x)));
      if (x?.fix.kind === 'auto') void api.guide.preview(id).then((p) => alive && setPreview(p)).catch((e: Error) => alive && setResult({ ok: false, message: e.message }));
    });
    void api.guide.list().then((l) => alive && setPlatform(l.platform));
    return () => { alive = false; };
  }, [id]);

  if (f === undefined) return <div className="guide-body muted small">{gt('checking', lang)}</div>;
  if (!f) return <div className="guide-body"><p className="muted">{gt('allGood', lang)}</p></div>;
  const steps = stepsOf(f);
  const fix = f.fix;

  const check = async () => {
    setFlow((s) => stepFlow(s, { type: 'check' }));
    const r = await api.guide.verify(id);
    setFlow((s) => stepFlow(s, { type: 'checked', result: r }));
    if (r === 'done') toast(`${gt('done', lang)}: ${f.title}`);
  };

  return (
    <div className={`guide-body ${compact ? 'compact' : ''}`}>
      <div className="guide-head">
        <span className={`badge ${SEV_CLASS[f.severity]}`}>{AREA_LABEL[f.area]}</span>
        <h3 className="grow">{f.title}</h3>
        {onClose ? <button className="btn sm ghost icon" title="Close" aria-label="Close" onClick={onClose}><Icon name="close" size={13} /></button> : null}
      </div>
      {!compact ? <p className="small"><b>{gt('why', lang)}:</b> {f.why}</p> : null}
      {f.impact ? <div className="guide-impact small">{f.impact}</div> : null}

      {fix.kind === 'auto' ? (
        <div className="guide-auto">
          <div className="small" style={{ fontWeight: 600 }}>{gt('whatChanges', lang)}</div>
          {preview ? (
            <>
              <p className="small">{preview.summary}</p>
              {preview.items.length ? <ul className="guide-preview">{preview.items.slice(0, compact ? 5 : 20).map((it, i) => <li key={i}><span className="ellipsis">{it.label}</span>{it.detail ? <span className="muted"> · {it.detail}</span> : null}</li>)}</ul> : null}
              {preview.warning ? <p className="small warn-text">{preview.warning}</p> : null}
              {!preview.undoable ? <p className="small muted">{gt('cantUndo', lang)}</p> : null}
              {preview.needsAdmin || fix.needsAdmin ? <p className="small muted">{gt('needsAdmin', lang)}</p> : null}
            </>
          ) : <p className="small muted">{gt('checking', lang)}</p>}
          {result ? <p className={`small ${result.ok ? 'ok-text' : 'warn-text'}`} role="status">{result.message}</p> : null}
          <div className="btn-row">
            {!result?.ok ? <button className="btn primary" disabled={busy || !preview} onClick={async () => { setBusy(true); try { setResult(await api.guide.apply(id)); } catch (e) { setResult({ ok: false, message: (e as Error).message }); } setBusy(false); }}>{busy ? <div className="spinner" /> : <Icon name="check" size={13} />} {fix.label || gt('doIt', lang)}</button> : null}
            {result?.ok && result.undoable ? <button className="btn" onClick={async () => setResult(await api.guide.undo(id))}><Icon name="undo" size={13} /> {gt('undo', lang)}</button> : null}
          </div>
        </div>
      ) : null}

      {fix.kind === 'page' ? (
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={() => { go(fix.route as Route); if (compact) void api.guide.mini(null); }}><Icon name="external" size={13} /> {fix.label || gt('openForMe', lang)}</button>
        </div>
      ) : null}

      {fix.kind === 'open' ? (
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={async () => {
            const r = await api.guide.open({ id });
            if (!r.ok) toast(r.message ?? 'Could not open it');
            else if (!compact) void api.guide.mini(id);
          }}><Icon name="external" size={13} /> {fix.label || gt('openForMe', lang)}</button>
          {!compact ? <button className="btn ghost sm" title={gt('keepOnTop', lang)} aria-label={gt('keepOnTop', lang)} onClick={() => void api.guide.mini(id)}><Icon name="pin" size={12} /></button> : null}
        </div>
      ) : null}

      {steps.length ? (
        <>
          <div className="guide-progress" aria-label={gt('stepOf', lang, { n: flow.index + 1, total: steps.length })}><i style={{ width: `${Math.round(progress(flow) * 100)}%` }} /></div>
          <div className="small muted">{gt('stepOf', lang, { n: flow.index + 1, total: steps.length })}</div>
          <ol className="guide-steps">{steps.map((s, i) => <StepView key={i} step={s} lang={lang} platform={platform} index={i} state={flow} />)}</ol>
          <div className="btn-row">
            <button className="btn sm ghost" disabled={flow.index === 0} onClick={() => setFlow((s) => stepFlow(s, { type: 'back' }))}>{gt('back', lang)}</button>
            {flow.index < steps.length - 1 ? (
              <>
                <button className="btn sm ghost" onClick={() => setFlow((s) => stepFlow(s, { type: 'skip' }))}>{gt('skip', lang)}</button>
                <button className="btn sm" onClick={() => setFlow((s) => stepFlow(s, { type: 'next' }))}>{gt('next', lang)}</button>
              </>
            ) : fix.kind !== 'page' || !id.startsWith('flow:') ? (
              <button className="btn sm primary" disabled={flow.verified === 'checking'} onClick={() => void check()}>{flow.verified === 'checking' ? <div className="spinner" /> : <Icon name="check" size={12} />} {gt('didIt', lang)}</button>
            ) : null}
          </div>
          {flow.verified === 'done' ? <p className="small ok-text" role="status"><Icon name="check" size={12} /> {gt('done', lang)}</p> : flow.verified === 'still-needed' ? <p className="small warn-text" role="status">{gt('stillNeeded', lang)}</p> : null}
        </>
      ) : null}

      {!compact ? (
        <div className="guide-foot">
          {!id.startsWith('flow:') ? (
            <>
              <button className="link-like small" onClick={() => void api.guide.setState(id, { snoozedUntil: Date.now() + 7 * 864e5 }).then(onClose)}>{gt('snooze', lang)}</button>
              <button className="link-like small" onClick={() => void api.guide.setState(id, { ignored: true }).then(onClose)}>{gt('ignore', lang)}</button>
            </>
          ) : null}
          <span className="grow" />
          <button className="link-like small" onClick={async () => setAi((await api.guide.explain(id, 'explain')).text)}>{gt('explain', lang)}</button>
          {steps.length ? <button className="link-like small" onClick={async () => setAi((await api.guide.explain(id, 'walk')).text)}>{gt('walkMe', lang)}</button> : null}
        </div>
      ) : null}
      {ai ? <div className="guide-ai small">{ai}</div> : null}
    </div>
  );
}

/** The side panel, shown over any page. */
export function GuideHost() {
  const id = useOpenId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && openId) openGuide(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!id) return null;
  return (
    <aside className="guide-panel" role="complementary" aria-label="Guide">
      <GuideBody id={id} onClose={() => openGuide(null)} />
    </aside>
  );
}

/** The small always-on-top window (view=guide-mini). */
export function GuideMini() {
  const [id, setId] = useState(() => new URLSearchParams(location.search).get('id') ?? '');
  useEffect(() => api.on('guide-mini', (x: string) => setId(x)), []);
  useEffect(() => { document.documentElement.dataset.view = 'guide-mini'; }, []);
  return (
    <div className="guide-mini">
      <div className="guide-mini-bar"><Icon name="sparkle" size={13} /><span className="grow">Keeper</span><button className="btn sm ghost icon" title="Close" aria-label="Close" onClick={() => void api.guide.mini(null)}><Icon name="close" size={12} /></button></div>
      {id ? <GuideBody id={id} compact /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- findings on Keeper's own pages

/** Which areas each page cares about. */
const ROUTE_AREAS: Record<string, Area[]> = {
  cleanup: ['space', 'storage'], space: ['space', 'storage'], large: ['space', 'storage'], duplicates: ['space'],
  protection: ['security', 'privacy'], health: ['performance'], startup: ['performance'],
  sync: ['backup'], vpn: ['network', 'privacy'], netactivity: ['network', 'privacy'],
  // Home has its own Attention card (src/screens/Home.tsx).
};

export function FindingCard({ f, compact }: { f: FindingView; compact?: boolean }) {
  return (
    <div className={`finding ${compact ? 'compact' : ''}`}>
      <Icon name={AREA_ICON[f.area]} size={16} />
      <div className="grow">
        <div className="finding-title">{f.title}{f.impact ? <span className="muted small"> · {f.impact}</span> : null}</div>
        {!compact ? <div className="small muted">{f.why}</div> : null}
      </div>
      <span className={`badge ${SEV_CLASS[f.severity]}`}>{f.severity === 'critical' ? 'urgent' : f.severity}</span>
      <button className="btn sm primary" onClick={() => openGuide(f.id)}>{f.fix.kind === 'auto' ? f.fix.label : 'Fix'}</button>
    </div>
  );
}

/** A short list of what needs doing on this page, above the page itself. */
export function RouteHints({ route }: { route: Route }) {
  const [list] = useGuideList();
  const areas = ROUTE_AREAS[route.name];
  if (!areas || !list) return null;
  const open = list.findings.filter((f) => f.status === 'open' && areas.includes(f.area)).slice(0, route.name === 'home' ? 2 : 3);
  if (!open.length) return null;
  return (
    <div className="route-hints">
      {open.map((f) => <FindingCard key={f.id} f={f} compact />)}
    </div>
  );
}

// ---------------------------------------------------------------- coach marks and the first-run tour

const COACH: Record<string, { title: string; text: string }> = {
  cleanup: { title: 'Two ways to clean', text: 'The simple view picks only what is safe. Switch on Advanced to choose single files inside each group — your own files always go to the Trash first.' },
  devices: { title: 'Pairing a device', text: 'Open Keeper on both devices, press Pair, and check that both screens show the same six digits before you accept.' },
  sync: { title: 'Backups in three steps', text: 'Pick what to keep, pick where (a drive, a NAS or a cloud you connected), and save the recovery key somewhere safe.' },
  terminal: { title: 'Agents in the terminal', text: 'AI agents can open and use terminals only as far as you allow in Agents → Permissions; every command they run is logged.' },
  vpn: { title: 'Is everything going through the VPN?', text: 'The verdict at the top checks IPv4, IPv6 and DNS. Press “Check again” after changing your VPN app’s settings.' },
};

function seen(key: string): boolean {
  try {
    if (key === 'tour' && new URLSearchParams(location.search).get('notour') === '1') return true;
    return localStorage.getItem(`coach.${key}`) === '1';
  } catch {
    return true;
  }
}
function markSeen(key: string) {
  try {
    localStorage.setItem(`coach.${key}`, '1');
  } catch {
    /* ignore */
  }
}

/** A one-time tip on complex pages (dismissed for good). */
export function CoachHost({ route }: { route: Route }) {
  const tip = COACH[route.name];
  const [, force] = useState(0);
  if (!tip || seen(route.name) || !seen('tour')) return null;
  return (
    <div className="coach" role="note">
      <Icon name="sparkle" size={14} />
      <div className="grow"><b>{tip.title}</b><div className="small">{tip.text}</div></div>
      <button className="btn sm ghost" onClick={() => { markSeen(route.name); force((n) => n + 1); }}>Got it</button>
    </div>
  );
}

const TOUR: { title: string; text: string; route?: Route; practice?: boolean; stats?: boolean; permissions?: boolean; island?: boolean }[] = [
  { title: 'Welcome to Keeper', text: 'Your files, your computer’s health and your privacy in one place. Here is a 30-second look around.' },
  { title: 'Anonymous usage stats', text: 'Keeper sends a small anonymous report once a day to help us improve it: its version, the kind of computer, which features and pages you use, and crash counts. Never your files, searches or names. Switch it off here or any time in Settings → Privacy.', stats: true },
  { title: 'Permissions', text: 'Some features need your OK in the system’s settings: seeing the screen, the microphone, typing for you and so on. Set them up now, in one go, and nothing interrupts you later. You can change this any time in Settings → Permissions.', permissions: true },
  { title: 'Find anything', text: 'Type what you remember in the search bar — “pdfs from gmail last month”, “screenshots with wifi password”.' },
  { title: 'Your To do list', text: 'Keeper checks space, security, privacy, backups and updates, and lists what is worth doing — each with “Fix” that does it or walks you through it.', route: { name: 'todo' as Route['name'] } },
  { title: 'The Island', text: 'The bar at the top of the screen (under the notch on a Mac) holds what is going on: music, timers, calls and reminders that are due, with Snooze and Done. Point at it to open it: drop files on the shelf, check off today’s tasks, plan the week, take notes or start a focus session. Ctrl+Alt+N (⌘⌥N) adds a task from anywhere.', island: true },
  { title: 'Ask how', text: 'Press ⌘K / Ctrl+K and type “How do I…” — free up space, stop apps watching my camera, encrypt my disk, back up my photos.' },
  { title: 'Try it: copy text from the screen', text: 'Text in pictures, videos and shared screens can be copied too. Press “Try it”, then drag a box over the card below; its text lands on your clipboard.', practice: true },
];

/** The practice step: a card with text to capture, and what came back. */
function PracticeCapture() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'none'>('idle');
  const [text, setText] = useState('');
  const shortcut = navigator.platform.startsWith('Mac') ? '⌘⇧2' : 'Ctrl+Shift+2';
  const go = async () => {
    setState('busy');
    try {
      const r = await api.capture.text();
      const t = (r?.text || r?.code || '').trim();
      setText(t);
      setState(t ? 'done' : 'none');
    } catch {
      setState('none');
    }
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="tour-practice" aria-label="Practice text">Meeting moved to <b>Thursday 10:30</b> · Room 4B · Code 7291</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" disabled={state === 'busy'} onClick={() => void go()}>{state === 'busy' ? <span className="spinner" /> : null} Try it</button>
        <span className="small muted">Later, use the capture shortcut ({shortcut}, or your own in Settings).</span>
      </div>
      {state === 'done' ? <div className="small tour-got">Copied: “{text.slice(0, 120)}”</div> : null}
      {state === 'none' ? <div className="small muted">Nothing was read. Drag over the card’s text and try again.</div> : null}
    </div>
  );
}

/** The tour's Permissions step: the choice, then the whole screen for "Set up everything now". */
function TourPermissions({ step }: { step: number }) {
  const { settings, updateSettings } = useStore();
  const choice = settings?.permissionsSetup ?? '';
  if (choice === 'all') return <PermissionsPanel inTour tourStep={step} />;
  return (
    <div className="col" style={{ gap: 8 }} data-testid="tour-permissions">
      <div className="perm-choice" role="radiogroup" aria-label="How to set up permissions">
        <button role="radio" aria-checked={false} data-testid="tour-perm-all" onClick={() => void updateSettings({ permissionsSetup: 'all' })}><b>Set up everything now</b><span className="small muted">Recommended</span></button>
        <button role="radio" aria-checked={choice === 'onDemand'} className={choice === 'onDemand' ? 'on' : ''} data-testid="tour-perm-later" onClick={() => void updateSettings({ permissionsSetup: 'onDemand' })}><b>Only what I turn on</b><span className="small muted">Each feature asks when you first use it</span></button>
      </div>
      {choice === 'onDemand' ? <p className="small muted">Fine. Features ask when you turn them on; everything is in Settings → Permissions.</p> : null}
    </div>
  );
}

export function TourHost() {
  const { go, settings } = useStore();
  const [i, setI] = useState<number | null>(() => {
    // Back from "Restart Keeper now" in the tour: the Permissions step again.
    const back = takeReopen();
    if (back && back.tourStep !== null && !seen('tour')) return back.tourStep;
    if (back) setTimeout(() => openPermissions(), 300);
    return seen('tour') ? null : 0;
  });
  if (i === null) return null;
  const step = TOUR[i];
  const end = () => { markSeen('tour'); setI(null); };
  const wide = step.permissions && settings?.permissionsSetup === 'all';
  return (
    <div className="tour" role="dialog" aria-label="Welcome tour">
      <div className={`tour-card ${wide ? 'wide' : ''}`}>
        <div className="small muted">{i + 1} / {TOUR.length}</div>
        <h3>{step.title}</h3>
        <p className="small">{step.text}</p>
        {step.practice ? <PracticeCapture /> : null}
        {step.stats ? <TourUsageStats /> : null}
        {step.permissions ? <TourPermissions step={i} /> : null}
        {step.island && settings?.island?.enabled !== false ? <div className="btn-row"><button className="btn sm" data-testid="tour-island" onClick={() => void api.island.openTab?.('reminders:new')}><Icon name="island" size={12} /> Show me</button></div> : null}
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          {step.permissions ? <button className="btn sm ghost" data-testid="tour-perm-skip" onClick={() => setI(i + 1)}>Skip this step</button> : null}
          <button className="btn sm ghost" onClick={end}>Skip tour</button>
          {i < TOUR.length - 1 ? <button className="btn sm primary" onClick={() => { const n = i + 1; if (TOUR[n].route) go(TOUR[n].route!); setI(n); }}>Next</button> : <button className="btn sm primary" onClick={end}>Start</button>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the badge

/** Open items on the To do list, for the sidebar. */
export function useTodoCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = () => void api.guide?.summary().then((s) => setN(s.open)).catch(() => undefined);
    load();
    return api.on('guide-changed', (s) => setN(s.open));
  }, []);
  return n;
}

export function bytes(n?: number): ReactNode {
  return n ? formatBytes(n) : null;
}

export function useHowTo(query: string) {
  const [r, setR] = useState<{ id: string; title: string; area: string }[]>([]);
  useEffect(() => { void api.guide?.howTo(query).then(setR).catch(() => setR([])); }, [query]);
  return useMemo(() => r, [r]);
}

/** "To do" in the person's language. */
export function gtTodo(lang: GuideLang): string {
  return gt('todo', lang);
}
