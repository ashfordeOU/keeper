// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Ashforde apps: Keeper's sister apps. Monorail (macOS) can be
// installed, kept up to date, connected and used together with Keeper here.

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AshfordeOverview, AshfordePrefs, MonorailStatus } from '../../core/api-ashforde';
import { describeState } from '../../core/ashforde/monorail';
import { useFeature } from '../features';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Toggle } from './ui';
import { Row } from '../screens/IslandSettings';
import '../styles/ashforde.css';

export function AshfordeAppsPanel() {
  const [ov, setOv] = useState<AshfordeOverview | null>(null);
  const load = useCallback(() => void api.ashforde.overview().then(setOv).catch(() => undefined), []);
  useEffect(() => {
    load();
    const a = api.on('ashforde-changed', load);
    const b = api.on('features-changed', load);
    return () => { a(); b(); };
  }, [load]);
  if (!ov) return null;
  return (
    <div className="ashforde-apps" data-testid="ashforde-apps">
      <p className="small muted" style={{ marginTop: 0 }}>Other free apps by Ashforde® that work hand in hand with Keeper. Each one is off until you switch it on, and Keeper only installs what you ask for, straight from the app’s own GitHub releases, after checking the download and its signature.</p>
      {ov.apps.map((a) => (a.id === 'monorail' ? <MonorailCard key={a.id} app={a} /> : null))}
    </div>
  );
}

function MonorailCard({ app }: { app: AshfordeOverview['apps'][number] }) {
  const on = useFeature('monorail');
  const { toast } = useStore();
  const [st, setSt] = useState<MonorailStatus | null>(null);
  const [prefs, setPrefsState] = useState<AshfordePrefs | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = useCallback(() => {
    if (!app.offered) return;
    void api.ashforde.monorail().then(setSt).catch(() => undefined);
    void api.ashforde.prefs().then(setPrefsState).catch(() => undefined);
  }, [app.offered]);
  useEffect(() => {
    refresh();
    return api.on('ashforde-changed', refresh);
  }, [refresh, on]);

  const act = async (label: string, fn: () => Promise<MonorailStatus>, done?: string) => {
    setWorking(label);
    try {
      setSt(await fn());
      if (done) toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
      refresh();
    } finally {
      setWorking(null);
    }
  };
  const setPref = (patch: Partial<AshfordePrefs>) => void api.ashforde.setPrefs(patch).then(setPrefsState);

  return (
    <div className="card ashforde-app" style={{ padding: 16, marginBottom: 12 }} data-testid="monorail-card">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div className="ashforde-icon" aria-hidden><Icon name="columns" size={22} /></div>
        <div className="grow">
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <b style={{ fontSize: 15 }}>{app.name}</b>
            <span className="small muted">{app.tagline}</span>
          </div>
          <div className="small" style={{ marginTop: 4 }}>{app.description}</div>
        </div>
        {app.offered ? <Toggle on={on} onChange={(v) => void api.features.set('monorail', v)} /> : null}
      </div>

      {!app.offered ? (
        <div className="ashforde-note small muted" data-testid="monorail-elsewhere"><Icon name="info" size={13} /> {app.elsewhere}</div>
      ) : !on ? (
        <ul className="ashforde-together small muted">
          {app.together.map((t) => <li key={t}>{t}</li>)}
        </ul>
      ) : !st ? null : !st.supported ? (
        <div className="ashforde-note small muted"><Icon name="info" size={13} /> {st.unsupportedReason}</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {st.busy ? (
            <div className="ashforde-busy" role="status">
              <div className="small">{st.busy.step}…</div>
              <div className="ashforde-bar"><i style={{ width: `${Math.round((st.busy.progress ?? 0.05) * 100)}%` }} /></div>
            </div>
          ) : null}
          {st.error && !st.busy ? <div className="ashforde-note small" style={{ color: 'var(--danger, #e5484d)' }}><Icon name="warning" size={13} /> {st.error}</div> : null}

          {!st.installed ? (
            <Row title="Monorail is not installed" desc="Keeper downloads the latest release from GitHub, checks its SHA-256 checksum and code signature, and puts it in Applications.">
              <div className="row" style={{ gap: 6 }}>
                <button className="btn primary" disabled={!!working || !!st.busy} onClick={() => void act('install', () => api.ashforde.install(), 'Monorail is installed')} data-testid="monorail-install"><Icon name="down" size={13} /> Install Monorail</button>
                <button className="btn ghost" onClick={() => void api.system.openExternal(app.homepage)}><Icon name="external" size={13} /> About</button>
              </div>
            </Row>
          ) : (
            <>
              <Row title={`Monorail ${st.version ?? ''}`} desc={<>{st.running ? 'Running' : 'Not running'}{st.path ? ` · ${st.path}` : ''}{st.signature ? <> · <span title={st.signature.reason}>{st.signature.ok ? 'signature checked' : 'signature problem'}</span></> : null}</>}>
                <div className="row" style={{ gap: 6 }}>
                  {st.running
                    ? <button className="btn" disabled={!!working} onClick={() => void act('quit', () => api.ashforde.quit())}>Quit</button>
                    : <button className="btn primary" disabled={!!working} onClick={() => void act('launch', () => api.ashforde.launch())}><Icon name="play" size={12} /> Open</button>}
                  {st.update
                    ? <button className="btn primary" disabled={!!working || !!st.busy} onClick={() => void act('update', () => api.ashforde.update(), `Monorail ${st.update?.version} is installed`)}>Update to {st.update.version}</button>
                    : <button className="btn ghost" disabled={!!working} onClick={() => void act('check', () => api.ashforde.checkUpdate(), 'Checked for updates')}>Check for updates</button>}
                </div>
              </Row>

              {st.running && st.state ? (
                <div className="ashforde-live" data-testid="monorail-live">
                  <Icon name="columns" size={14} /> <b>{describeState(st.state)}</b>
                  {st.state.app ? <span className="muted"> · {st.state.app}</span> : null}
                  <span className="grow" />
                  {Array.from({ length: Math.min(st.state.workspaceCount, 9) }, (_, i) => (
                    <button key={i} className={`btn sm ${st.state?.workspace === i + 1 ? 'primary' : 'ghost'}`} onClick={() => void api.ashforde.action('workspace', i + 1)} title={`Go to workspace ${i + 1}`}>{i + 1}</button>
                  ))}
                  <button className="btn sm ghost" onClick={() => void api.ashforde.action('palette')} title="Monorail’s command palette" aria-label="Monorail’s command palette"><Icon name="search" size={12} /></button>
                  <button className="btn sm ghost" onClick={() => void api.ashforde.action('settings')} title="Monorail’s settings" aria-label="Monorail’s settings"><Icon name="settings" size={12} /></button>
                </div>
              ) : null}

              {!st.connected ? (
                <Row title="Connect Keeper to Monorail" desc="Turns on Monorail’s local API (only reachable from this computer, with a private key) and its state file, so Keeper can show where you are and your AI apps can arrange windows. A copy of Monorail’s settings is kept first.">
                  <button className="btn primary" disabled={!!working} onClick={() => void act('connect', () => api.ashforde.connect(), 'Keeper and Monorail are connected')} data-testid="monorail-connect"><Icon name="link" size={13} /> Connect</button>
                </Row>
              ) : null}

              <Row title="Accessibility access" desc="Monorail moves and resizes windows, which macOS allows only once you switch Monorail on in Privacy & Security → Accessibility. If windows do not move, check it there.">
                <button className="btn" onClick={() => void api.ashforde.openPermission('accessibility').then((r) => r.ok ? toast(`Opened ${r.label ?? 'System Settings'}. Switch on Monorail.`) : toast(r.message ?? 'Could not open System Settings'))}><Icon name="key" size={13} /> Open Accessibility</button>
              </Row>

              {st.clashes.length ? (
                <div className="ashforde-clashes" data-testid="monorail-clashes">
                  <div style={{ fontWeight: 600 }}><Icon name="warning" size={13} /> Shortcuts both apps want</div>
                  {st.clashes.map((c) => (
                    <div key={c.keeper + c.monorail} className="small">
                      {c.label}: Keeper’s {c.keeper} and Monorail’s {c.monorail}.{' '}
                      {c.suggestion && /shortcut/i.test(c.keeper)
                        ? <button className="btn sm" disabled={!!working} data-testid="monorail-clash-fix" onClick={() => void act('shortcut', () => api.ashforde.useShortcut(c.keeper, c.suggestion!), `Keeper now uses ${c.suggestionLabel}`)}>Use {c.suggestionLabel} in Keeper</button>
                        : 'Change one of them so both work.'}
                    </div>
                  ))}
                </div>
              ) : null}

              {prefs ? (
                <div className="ashforde-prefs">
                  <div className="small muted" style={{ margin: '10px 0 2px', fontWeight: 600 }}>Working together</div>
                  <Row title="Workspace in the Island" desc="When you slide to another workspace or slide, the Island says where you are for a moment."><Toggle on={prefs.showInIsland} onChange={(v) => setPref({ showInIsland: v })} /></Row>
                  <Row title="Focus sessions switch Monorail’s focus mode" desc="Starting a Focus session in Keeper dims everything but the window you work in, and Monorail’s focus mode starts and ends Keeper’s session."><Toggle on={prefs.followFocus} onChange={(v) => setPref({ followFocus: v })} /></Row>
                  <Row title="Presentation mode together" desc="Keeper’s presentation mode, and any Stage, switch on Monorail’s, which hides its overlays and notices."><Toggle on={prefs.followPresentation} onChange={(v) => setPref({ followPresentation: v })} /></Row>
                  <Row title="Keeper’s small windows float" desc="Quick Search, Quick Terminal and Capture float above the strip instead of becoming a column. The Island always stays clear of Monorail’s slider bar."><Toggle on={prefs.floatKeeperWindows} onChange={(v) => setPref({ floatKeeperWindows: v })} /></Row>
                  <Row title="Match Keeper’s theme" desc="Monorail takes the theme closest to Keeper’s, and follows the seasons when Keeper does."><Toggle on={prefs.matchTheme} onChange={(v) => setPref({ matchTheme: v })} /></Row>
                  <Row title="AI apps may use Monorail" desc="AI apps connected to Keeper (Settings → AI & Brain) can see and arrange your windows. Looking is always allowed while this is on; with Ask, Keeper asks you before anything moves.">
                    <div className="seg">{(['off', 'ask', 'allow'] as const).map((v) => <button key={v} className={prefs.aiTools === v ? 'on' : ''} onClick={() => setPref({ aiTools: v })}>{v === 'off' ? 'Off' : v === 'ask' ? 'Ask' : 'Allow'}</button>)}</div>
                  </Row>
                  <Row title="Check for Monorail updates" desc={st.updatesBy === 'monorail' ? 'Monorail checks for its own updates, so Keeper does not ask as well. Keeper checks once a day only when Monorail’s own check is off.' : 'Once a day. Updates install only when you click Update.'}><Toggle on={prefs.checkUpdates} onChange={(v) => setPref({ checkUpdates: v })} /></Row>
                </div>
              ) : null}

              <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                {confirmRemove ? (
                  <>
                    <span className="small muted">Move Monorail to the Trash?</span>
                    <button className="btn sm" onClick={() => { setConfirmRemove(false); void act('remove', () => api.ashforde.uninstall(false), 'Monorail is in the Trash; its settings are kept'); }}>Keep its settings</button>
                    <button className="btn sm danger" onClick={() => { setConfirmRemove(false); void act('remove', () => api.ashforde.uninstall(true), 'Monorail and its settings are in the Trash'); }}>Remove settings too</button>
                    <button className="btn sm ghost" onClick={() => setConfirmRemove(false)}>Cancel</button>
                  </>
                ) : <button className="btn sm ghost" disabled={!!working} onClick={() => setConfirmRemove(true)}><Icon name="trash" size={12} /> Uninstall…</button>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
