// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Features → Keeper suite: Keeper, the parts that run in processes of
// their own (the Island, desktop widgets) and the background services, each with
// its switch, whether it is running, what it uses, its restarts and last crash,
// and Restart (docs/SUITE.md).

import { useEffect, useState } from 'react';
import type { SuitePart } from '../../core/api-suite';
import type { KeeperProcess } from '../../core/api-session';
import { featureDef } from '../../core/features';
import { separateByDefault } from '../../core/suite';
import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { useFeatureStates } from '../features';
import { useStore } from '../state';
import { Toggle } from './ui';
import '../styles/processes.css';

/**
 * Downloadable components (ffmpeg, models…), when this build has them (window.keeper.components):
 * a part shows what its features still need to download, and the progress.
 */
interface ComponentRow { id: string; name: string; state: string; progress?: number; error?: string; neededBy: string[] }
const componentsApi = () => (api as unknown as { components?: { list(): Promise<ComponentRow[]> } }).components;
const ready = (c: ComponentRow) => c.state === 'bundled' || c.state === 'installed' || c.state === 'dev';

function downloads(list: ComponentRow[], features: string[]): string | null {
  const mine = list.filter((c) => !ready(c) && c.neededBy.some((f) => features.includes(f)));
  if (!mine.length) return null;
  return mine.map((c) => (c.state === 'downloading' ? `${c.name}: downloading${c.progress != null ? ` ${Math.round(c.progress * 100)}%` : ''}` : c.error ? `${c.name}: ${c.error}` : `${c.name}: to download`)).join(' · ');
}

const STATE: Record<SuitePart['state'], string> = {
  off: 'Off', starting: 'Starting', running: 'Running', stopping: 'Stopping', waiting: 'Starting again after a crash', failed: 'Stopped after repeated crashes', shared: 'Running inside Keeper',
};

export function SuitePanel() {
  const { settings, updateSettings, toast } = useStore();
  const states = useFeatureStates();
  const [parts, setParts] = useState<SuitePart[] | null>(null);
  const [services, setServices] = useState<KeeperProcess[]>([]);
  const [main, setMain] = useState<{ memory: number; cpu: number; processes: number; startedAt: number } | null>(null);
  const [separate, setSeparate] = useState<{ now: boolean; next: boolean; env: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [components, setComponents] = useState<ComponentRow[]>([]);

  useEffect(() => {
    if (!api.suite) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      void api.suite?.parts().then((p) => alive && setParts(p)).catch(() => undefined);
      void api.suite?.app().then((m) => alive && setMain(m)).catch(() => undefined);
      void componentsApi()?.list().then((l) => alive && setComponents(l)).catch(() => undefined);
      void api.svc.list().then((l) => alive && setServices(l.filter((p) => p.kind === 'service' && !p.id.startsWith('part:')))).catch(() => undefined);
    };
    load();
    void api.suite.separate().then((s) => alive && setSeparate(s)).catch(() => undefined);
    const t = window.setInterval(load, 3000);
    return () => { alive = false; window.clearInterval(t); };
  }, [settings?.suiteSeparate, settings?.resourceMode]);
  if (!api.suite || !settings) return null;

  const restart = async (id: SuitePart['id']) => {
    setBusy(id);
    try {
      setParts(await api.suite!.restart(id));
    } finally {
      setBusy(null);
    }
  };
  const restartService = async (id: string) => {
    setBusy(id);
    try {
      await api.svc.restart(id);
    } finally {
      setBusy(null);
    }
  };
  const usage = (memory: number, cpu: number, running: boolean) => (running ? `${formatBytes(memory)} of its own · ${cpu.toFixed(1)}% of a core` : 'Uses nothing while off');
  const changePending = separate && separate.next !== separate.now && !separate.env;

  return (
    <div className="feature-group suite" data-testid="suite-panel">
      <div className="feature-group-title">Keeper suite</div>
      <div className="small muted suite-intro">One install, one version and one Settings, with parts that run on their own: if one stops, the others carry on and it starts again. Switching a part off ends its process and gives its memory back.</div>
      {main ? (
        <div className="feature-row suite-row" data-testid="suite-row-app">
          <span className="kproc-dot running" title="Running" />
          <div className="grow">
            <div className="feature-name">Keeper</div>
            <div className="small muted">The main window, the menu-bar owl, the library and the services behind every part.</div>
            <div className="feature-cost small">{usage(main.memory, main.cpu, true)} in {main.processes} processes · started {relativeTime(main.startedAt)}</div>
          </div>
          <span className="badge">Always on</span>
        </div>
      ) : null}
      {(parts ?? []).map((p) => {
        const running = p.state === 'running' || p.state === 'shared';
        const features = p.features ?? [p.feature];
        const wanted = features.some((f) => states?.get(f)?.wanted ?? p.on);
        const pending = downloads(components, features);
        return (
          <div key={p.id} className={`feature-row suite-row ${p.on ? '' : 'off'}`} data-testid={`suite-row-${p.id}`}>
            <span className={`kproc-dot ${p.state === 'running' || p.state === 'shared' ? 'running' : p.state === 'waiting' || p.state === 'failed' ? 'crashed' : 'stopped'}`} title={STATE[p.state]} />
            <div className="grow">
              <div className="feature-name">{p.name} <span className="kproc-kind">{STATE[p.state]}</span>{p.restarts ? <span className="kproc-kind warn">restarted {p.restarts}×</span> : null}</div>
              <div className="small muted">{p.description}</div>
              <div className="feature-cost small">
                {p.state === 'shared' ? 'Counted with Keeper' : usage(p.memory, p.cpu, running)}
                {p.state === 'running' && p.processes > 1 ? ` in ${p.processes} processes` : ''}
                {p.lastCrash ? ` · last stopped ${relativeTime(p.lastCrash.at)}: ${p.lastCrash.reason}` : ''}
                {p.on && !p.wanted && p.state === 'off' && p.separate ? ' · nothing to show, so not running' : ''}
              </div>
              {pending ? <div className="small muted" data-testid={`suite-downloads-${p.id}`}>{pending}</div> : null}
            </div>
            {p.separate && p.wanted ? <button className="btn sm" disabled={busy === p.id} onClick={() => void restart(p.id)}>{p.state === 'failed' ? 'Try again' : 'Restart'}</button> : null}
            <Toggle label={p.name} on={wanted} onChange={(v) => void (async () => { for (const f of features) await api.features.set(f, v); toast(`${p.name} ${v ? 'on' : 'off'}`); })()} />
          </div>
        );
      })}
      {services.map((s) => (
        <div key={s.id} className="feature-row suite-row" data-testid={`suite-row-${s.id}`}>
          <span className={`kproc-dot ${s.state}`} title={s.state} />
          <div className="grow">
            <div className="feature-name">{s.label} <span className="kproc-kind">Service</span>{s.restarts ? <span className="kproc-kind warn">restarted {s.restarts}×</span> : null}</div>
            <div className="small muted">{s.detail}</div>
            <div className="feature-cost small">
              {s.pid ? `${formatBytes(s.memory)} · ${s.cpu.toFixed(1)}% of a core` : null}
              {s.lastCrash ? ` · last stopped ${relativeTime(s.lastCrash.at)}: ${s.lastCrash.reason}` : ''}
            </div>
            {s.feature && downloads(components, [s.feature]) ? <div className="small muted">{downloads(components, [s.feature])}</div> : null}
          </div>
          {s.canRestart ? <button className="btn sm" disabled={busy === s.id} onClick={() => void restartService(s.id)}>Restart</button> : null}
          {s.feature && featureDef(s.feature) ? <Toggle label={s.label} on={states?.get(s.feature)?.wanted ?? true} onChange={(v) => void api.features.set(s.feature!, v)} /> : null}
        </div>
      ))}
      <div className="feature-row suite-row">
        <div className="grow">
          <div className="feature-name">Run parts in processes of their own</div>
          <div className="small muted">On: the Island, widgets and Mail keep running if the main window stops, at the cost of some memory for each. Off: everything runs in one process, the lightest choice (the default in the Minimal resource mode). Applies when Keeper starts again.</div>
          {separate?.env ? <div className="small warn-text">Set to “{separate.env}” for this run by KEEPER_SUITE.</div> : null}
          {changePending ? (
            <div className="small warn-text">Applies at the next start. <button className="btn sm" onClick={() => void api.session.relaunch(false)}>Restart Keeper now</button></div>
          ) : null}
        </div>
        <Toggle label="Run parts in processes of their own" on={separateByDefault(settings)} onChange={(v) => void updateSettings({ suiteSeparate: v }).then(() => setSeparate((s) => (s ? { ...s, next: v } : s)))} />
      </div>
    </div>
  );
}
