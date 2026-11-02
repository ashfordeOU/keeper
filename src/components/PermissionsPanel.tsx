// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Permissions screen: every system permission Keeper's features can use,
// with why, a live state and Allow. "Allow all" walks through the missing ones
// one after another and moves on by itself when each turns on. It is a step of
// the first-run tour, a section of Settings, and a palette command; features
// that need a permission mid-task point here (openPermissions) instead of
// asking out of the blue.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { allowAllQueue, allowLabel, catalogueFor, nextInQueue, STATE_LABEL, summarize, type PermissionItem, type PermissionsReport, type PermState } from '../../core/permissions';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import '../styles/permissions.css';

// ---------------------------------------------------------------- opening it from anywhere

let highlight: string | null = null;
const listeners = new Set<() => void>();

/** Opens Settings → Permissions, with one row highlighted. */
export function openPermissions(id?: string) {
  highlight = id ?? null;
  listeners.forEach((l) => l());
  window.dispatchEvent(new CustomEvent('keeper-open-permissions', { detail: id ?? null }));
}

function useHighlight(): string | null {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => highlight);
}

/** Set before "Restart Keeper now", so the Permissions step (or the tour step) comes back after the restart. */
export const REOPEN_KEY = 'permissions.reopen';

export function takeReopen(): { tourStep: number | null } | null {
  try {
    const v = localStorage.getItem(REOPEN_KEY);
    if (!v) return null;
    localStorage.removeItem(REOPEN_KEY);
    return JSON.parse(v) as { tourStep: number | null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the live list

/** Asks for the list once a second while `active`, and when the window comes back into focus. */
function usePermissions(active: boolean): [PermissionsReport | null, () => Promise<void>] {
  const [report, setReport] = useState<PermissionsReport | null>(null);
  const busy = useRef(false);
  const load = useCallback(async () => {
    if (busy.current || !api.permissions) return;
    busy.current = true;
    try { setReport(await api.permissions.list()); } catch { /* not available */ }
    busy.current = false;
  }, []);
  useEffect(() => {
    void load();
    if (!active) return;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 1000);
    const focus = () => void load();
    window.addEventListener('focus', focus);
    return () => { window.clearInterval(t); window.removeEventListener('focus', focus); };
  }, [active, load]);
  return [report, load];
}

const STATE_CLASS: Record<PermState, string> = { allowed: 'ok', missing: 'warn', denied: 'danger', notNeeded: '', unknown: '', unavailable: '', info: 'accent' };
const STATE_ICON: Record<PermState, string> = { allowed: 'check', missing: 'clock', denied: 'warning', notNeeded: 'minus', unknown: 'info', unavailable: 'minus', info: 'info' };

const actionLabel = allowLabel;

function Row({ it, platform, onAct, current, lit }: { it: PermissionItem; platform: string; onAct: (it: PermissionItem) => void; current: boolean; lit: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (lit) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [lit]);
  const actionable = it.state !== 'allowed' && it.how !== 'info' && it.state !== 'unavailable';
  return (
    <li ref={ref} className={`perm-row ${lit ? 'lit' : ''} ${current ? 'current' : ''}`} data-testid={`perm-${it.id}`} data-state={it.state}>
      <span className={`perm-state badge ${STATE_CLASS[it.state]}`}><Icon name={STATE_ICON[it.state]} size={11} /> {it.restartNeeded ? 'Restart to finish' : STATE_LABEL[it.state]}</span>
      <div className="grow">
        <div className="perm-name">{it.name}</div>
        <div className="small muted">{it.why}</div>
        {it.usedBy.length ? <div className="small perm-used">Used by {it.usedBy.join(', ')}</div> : null}
        {it.detail ? <div className="small perm-detail">{it.detail}</div> : null}
        {it.how === 'info' && it.state !== 'notNeeded' ? <div className="small perm-detail">{it.steps}</div> : null}
        <details className="small perm-revoke"><summary>How to take it back</summary>{it.revoke}</details>
      </div>
      <div className="perm-act">
        {actionable && it.state !== 'notNeeded' ? <button className={`btn sm ${it.state === 'missing' ? 'primary' : ''}`} onClick={() => onAct(it)}>{actionLabel(it, platform)}</button> : null}
        {it.state === 'notNeeded' && it.how !== 'info' && it.how !== 'test' ? <button className="btn sm ghost" onClick={() => onAct(it)} title="Allow it now, before turning on a feature that uses it">Allow anyway</button> : null}
        {it.how === 'info' && it.settingsUrl ? <button className="btn sm ghost" onClick={() => void api.permissions.openSettings(it.id)}>Open settings</button> : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- the screen

export function PermissionsPanel({ inTour, tourStep, active = true }: { inTour?: boolean; tourStep?: number; active?: boolean }) {
  const { settings, updateSettings, toast, info } = useStore();
  const lit = useHighlight();
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  // In Settings it checks only while it is on screen.
  useEffect(() => {
    const el = box.current;
    if (!el || inTour || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => setVisible(e.some((x) => x.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [inTour]);
  const [report, reload] = usePermissions(active && visible);
  const [run, setRun] = useState<{ queue: string[]; skipped: Set<string>; asked: string | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const platform = report?.platform ?? (info?.platform as string) ?? 'darwin';
  const items = report?.items ?? [];
  const sum = summarize(items);
  const current = run ? nextInQueue(run.queue, items, run.skipped) : null;
  const curItem = items.find((i) => i.id === current);

  const act = async (it: PermissionItem) => {
    setNote(null);
    const r = await api.permissions.request(it.id).catch((e: Error) => ({ ok: false, message: e.message, opened: undefined }));
    if (r.message) setNote(r.message);
    else if (r.opened === 'settings') setNote(`${platform === 'darwin' ? 'System Settings' : 'Settings'} is open: ${it.steps}`);
    void reload();
  };

  // Allow all: ask for the next one as soon as it is its turn.
  useEffect(() => {
    if (!run || !curItem || run.asked === curItem.id) return;
    setRun({ ...run, asked: curItem.id });
    void act(curItem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, curItem?.id]);
  useEffect(() => {
    if (run && report && !current) {
      setRun(null);
      toast(sum.restart ? 'Done. Restart Keeper to finish the ones that need it.' : 'Done: everything Keeper needs is set up.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, current, report]);

  const restart = () => {
    try { localStorage.setItem(REOPEN_KEY, JSON.stringify({ tourStep: inTour ? tourStep ?? null : null })); } catch { /* storage unavailable */ }
    void api.permissions.restart();
  };

  const queue = allowAllQueue(items);
  const needed = items.filter((i) => i.state !== 'notNeeded');
  const notNeeded = items.filter((i) => i.state === 'notNeeded');
  const choice = settings?.permissionsSetup ?? '';

  return (
    <div ref={box} className={`perm-panel ${inTour ? 'in-tour' : ''}`} data-testid="permissions-panel" aria-busy={!report}>
      {!inTour ? (
        <div className="perm-choice" role="radiogroup" aria-label="How to set up permissions">
          <button role="radio" aria-checked={choice === 'all'} className={choice === 'all' ? 'on' : ''} onClick={() => void updateSettings({ permissionsSetup: 'all' })}><b>Set up everything now</b><span className="small muted">Recommended: nothing asks in the middle of a task later.</span></button>
          <button role="radio" aria-checked={choice === 'onDemand'} className={choice === 'onDemand' ? 'on' : ''} onClick={() => void updateSettings({ permissionsSetup: 'onDemand' })}><b>Only what I turn on</b><span className="small muted">Each feature asks the first time you use it.</span></button>
        </div>
      ) : null}

      <div className="perm-head">
        <div className="grow small" role="status" aria-live="polite">
          {report ? <><b>{sum.allowed}</b> allowed · <b>{sum.todo}</b> to do · {sum.notNeeded} not needed now</> : 'Checking…'}
          {report && !report.helper ? <div className="small muted">Keeper’s macOS helper is not in this build, so a few rows cannot be checked.</div> : null}
        </div>
        {sum.restart ? <button className="btn sm" data-testid="perm-restart" onClick={restart}><Icon name="refresh" size={12} /> Restart Keeper now</button> : null}
        {queue.length && !run ? <button className="btn sm primary" data-testid="perm-allow-all" onClick={() => { void updateSettings({ permissionsSetup: 'all' }); setRun({ queue, skipped: new Set(), asked: null }); }}><Icon name="check" size={12} /> Allow all ({queue.length})</button> : null}
      </div>

      {run && curItem ? (
        <div className="perm-runner" role="region" aria-label="Allow all" data-testid="perm-runner">
          <div className="small muted">Step {run.queue.indexOf(curItem.id) + 1} of {run.queue.length}</div>
          <div className="perm-name">{curItem.name}</div>
          <p className="small">{curItem.steps}</p>
          {curItem.restart ? <p className="small muted">This one takes effect after Keeper restarts; you can restart once at the end.</p> : null}
          <div className="btn-row">
            <button className="btn sm" onClick={() => void act(curItem)}>{allowLabel(curItem, platform) === 'Allow' ? 'Ask again' : allowLabel(curItem, platform)}</button>
            <button className="btn sm ghost" onClick={() => setRun({ ...run, skipped: new Set([...run.skipped, curItem.id]) })}>{curItem.state === 'unknown' ? 'Done, next' : 'Skip this one'}</button>
            <button className="btn sm ghost" onClick={() => setRun(null)}>Stop</button>
          </div>
        </div>
      ) : null}
      {note ? <p className="small perm-note" role="status">{note}</p> : null}

      <ul className="perm-list" aria-label="Permissions">
        {needed.map((it) => <Row key={it.id} it={it} platform={platform} onAct={(x) => void act(x)} current={it.id === current} lit={it.id === lit} />)}
      </ul>
      {notNeeded.length ? (
        <details className="perm-more" open={!!lit && notNeeded.some((i) => i.id === lit)}>
          <summary className="small">Not needed now: the features that use them are off ({notNeeded.length})</summary>
          <ul className="perm-list">{notNeeded.map((it) => <Row key={it.id} it={it} platform={platform} onAct={(x) => void act(x)} current={false} lit={it.id === lit} />)}</ul>
        </details>
      ) : null}
      {!report ? null : !items.length ? <p className="small muted">This system needs no extra permissions for Keeper.</p> : null}
      <p className="small muted perm-foot">Nothing here is ever required: Keeper works without any of them, and each feature tells you when it needs one. See docs/PERMISSIONS.md for the full list.</p>
    </div>
  );
}

// ---------------------------------------------------------------- features pointing here

/** A feature needed a permission: a toast that opens the right row (once a minute per permission). */
export function PermissionNudgeHost() {
  const { toast, info } = useStore();
  useEffect(() => {
    const last = new Map<string, number>();
    return api.on('permission-needed', (p) => {
      if (Date.now() - (last.get(p.id) ?? 0) < 60_000) return;
      last.set(p.id, Date.now());
      const name = catalogueFor(info?.platform ?? 'darwin').find((d) => d.id === p.id)?.name ?? 'a permission';
      toast(`Keeper needs ${name} for this.`, { label: 'Open Permissions', run: () => openPermissions(p.id) });
    });
  }, [toast, info]);
  return null;
}
