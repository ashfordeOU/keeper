// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Island: notifications per system, calls, volume and brightness,
// coding agents and their hooks, the usage ring, low disk, looks and breaks.
// Each part says plainly how it works here and what it cannot do.

import { useEffect, useState } from 'react';
import type { IslandSettings } from '../../core/api';
import { plusSetting, type IslandPlusStatus } from '../../core/island-plus';
import { api } from '../api';
import { useFeatureStates } from '../features';
import { Toggle } from '../components/ui';
import { Row } from '../screens/IslandSettings';
import { useStore } from '../state';

const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

export function PlusSettings({ isl, set }: { isl: IslandSettings; set: (p: Partial<IslandSettings>) => void }) {
  const { toast, go } = useStore();
  const features = useFeatureStates();
  const [st, setSt] = useState<IslandPlusStatus | null>(null);
  const reload = () => void api.islandx?.status().then(setSt).catch(() => undefined);
  useEffect(reload, [isl.notifyMirror]);
  const feat = (id: string) => features?.get(id)?.on !== false;
  const setFeature = (id: string, on: boolean) => void api.features.set(id, on).then(reload);
  const sys = st?.platform === 'darwin' ? 'macOS' : st?.platform === 'win32' ? 'Windows' : 'Linux';
  return (
    <div data-testid="island-plus-settings">
      {isl.notifyMirror && st ? (
        <div className="card settings-section" style={{ marginTop: 8 }}>
          <Row title={`Notifications on ${sys}`} desc={<>{st.notify.how}{st.notify.problem ? <><br /><b>Right now:</b> {st.notify.problem}</> : null}</>}>
            <span className="badge">{st.notify.mode === 'off' ? 'starting' : st.notify.mode}</span>
          </Row>
          {st.platform === 'darwin' ? <Row title="Accessibility permission" desc="Keeper reads the banners the way VoiceOver does."><button className="btn sm" onClick={() => void api.islandx.openNotifyPermission()}>Open System Settings</button></Row> : null}
          {st.notify.canDismiss ? <Row title="Close the system banner" desc="After Keeper shows a notification, its macOS banner is closed so it appears once."><Toggle on={plusSetting(isl, 'notifyDismiss')} onChange={(v) => set({ notifyDismiss: v })} /></Row> : null}
          <Row title="Never from" desc="Comma-separated app names."><input className="input" style={{ width: 280 }} defaultValue={(isl.notifyBlock ?? []).join(', ')} onBlur={(e) => set({ notifyBlock: list(e.target.value) })} /></Row>
          <Row title="Try it"><button className="btn sm" onClick={() => void api.islandx.testNotification()}>Show a test</button></Row>
        </div>
      ) : null}

      <h2 style={{ margin: '18px 0 8px' }}>Alerts</h2>
      <div className="card settings-section">
        <Row title="Alerts" desc="In the notch (or the pill), an alert shows as an icon and a few words for a moment; hover or click for the details. As a banner, it drops down below for a few seconds.">
          <select className="input" data-testid="island-alert-style" value={isl.alertStyle ?? 'notch'} onChange={(e) => set({ alertStyle: e.target.value as 'notch' | 'banner' })}>
            <option value="notch">In the notch (default)</option>
            <option value="banner">As a banner below it</option>
          </select>
        </Row>
        <Row title="Also show tips and findings" desc="Things like “Nothing is backed up” wait on the To do page and in the tray. Downloads, calls, timers, agents that need you and recordings always show."><Toggle on={!!isl.alertsInfo} onChange={(v) => set({ alertsInfo: v })} /></Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Calls, volume and brightness</h2>
      <div className="card settings-section">
        <Row title="Calls in the Island" desc={st ? `${st.calls.how} A timer and a mute button appear while a call app or a browser call uses the microphone.` : 'A timer and a mute button during calls.'}><Toggle on={feat('islandCalls')} onChange={(v) => setFeature('islandCalls', v)} /></Row>
        <Row title="Mute button mutes" desc="The system microphone works for every app. The app’s own shortcut keeps its mute button in step (Zoom, Teams, Meet, Discord, Slack, Webex…), but brings the app forward for a moment.">
          <select className="input" value={plusSetting(isl, 'callMute')} onChange={(e) => set({ callMute: e.target.value as 'system' | 'app' })}>
            <option value="system">The system microphone</option>
            <option value="app">The call app’s own button</option>
          </select>
        </Row>
        <Row title="Volume and brightness levels" desc={st ? `${st.hud.why} ${st.hud.on ? st.hud.how : ''}` : 'Keeper’s level beside the system’s pop-up.'}><Toggle on={feat('islandHud')} onChange={(v) => setFeature('islandHud', v)} /></Row>
        {st?.platform === 'darwin' && feat('islandHud') ? <Row title="Hear the brightness keys" desc="Needs the Input Monitoring permission. Apple silicon Macs keep the built-in display’s brightness private, so the level is an estimate there."><Toggle on={plusSetting(isl, 'hudBrightnessKeys')} onChange={(v) => set({ hudBrightnessKeys: v })} /></Row> : null}
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Coding agents and AI usage</h2>
      <div className="card settings-section">
        <Row title="Agents shown" desc={<>Claude Code and Codex from their transcripts; Gemini CLI, Qwen Code and OpenCode from their session files; any other agent or editor that runs Keeper’s status hook, which writes to <code>{st?.agents.statusDir ?? '~/.keeper/agents'}</code>.</>}><span /></Row>
        {st?.agents.hooks.map((h) => (
          <Row key={h.id} title={`${h.name} agent status`} desc={h.available ? `Adds Keeper’s status hook to ${h.file}, next to your own hooks.` : `${h.name} is not set up on this computer.`}>
            {h.installed
              ? <button className="btn sm" onClick={() => void api.islandx.removeAgentHooks(h.id).then((r) => { toast(r.message); reload(); })}>Remove</button>
              : <button className="btn sm" disabled={!h.available} onClick={() => void api.islandx.installAgentHooks(h.id).then((r) => { toast(r.message); reload(); })}>Set up</button>}
          </Row>
        ))}
        <Row title="Usage ring beside the Island" desc="The AI allowance closest to its limit, as a small ring next to the pill."><Toggle on={plusSetting(isl, 'usagePin')} onChange={(v) => set({ usagePin: v })} /></Row>
        <Row title="Tool launcher" desc="The grid button in the Island opens Keeper’s tool launcher.">{feat('toolLauncher') ? <span className="badge">On</span> : <button className="btn sm" onClick={() => go({ name: 'settings', arg: 'features' })}>Turn on</button>}</Row>
      </div>

      <h2 style={{ margin: '18px 0 8px' }}>Looks, music and breaks</h2>
      <div className="card settings-section">
        <Row title="Corner roundness"><span><input type="range" min={0} max={40} value={plusSetting(isl, 'cornerRadius')} onChange={(e) => set({ cornerRadius: Number(e.target.value) })} /> {plusSetting(isl, 'cornerRadius')}</span></Row>
        <Row title="Shadow"><Toggle on={plusSetting(isl, 'shadow')} onChange={(v) => set({ shadow: v })} /></Row>
        <Row title="Glow while music plays" desc="In the colour of the album art."><Toggle on={plusSetting(isl, 'glow')} onChange={(v) => set({ glow: v })} /></Row>
        <Row title="No lyrics for" desc="Comma-separated players, e.g. a browser you watch videos in."><input className="input" style={{ width: 280 }} defaultValue={(isl.lyricsOffApps ?? []).join(', ')} onBlur={(e) => set({ lyricsOffApps: list(e.target.value) })} /></Row>
        <Row title="Long break" desc="After this many focus rounds, a longer break."><span><input className="input" type="number" min={0} max={12} style={{ width: 64 }} value={plusSetting(isl, 'longBreakEvery')} onChange={(e) => set({ longBreakEvery: Number(e.target.value) })} /> rounds · <input className="input" type="number" min={5} max={60} style={{ width: 64 }} value={plusSetting(isl, 'longBreakMin')} onChange={(e) => set({ longBreakMin: Number(e.target.value) })} /> min</span></Row>
        <Row title="Alt/Option-click hides for"><span><input className="input" type="number" min={1} max={60} style={{ width: 64 }} value={plusSetting(isl, 'altHideMinutes')} onChange={(e) => set({ altHideMinutes: Number(e.target.value) })} /> min</span></Row>
        <Row title="Warn when disk space is low" desc="Once, when the start-up disk drops below this; again after it recovers. 0 turns it off."><span><input className="input" type="number" min={0} max={500} style={{ width: 72 }} value={plusSetting(isl, 'lowDiskGb')} onChange={(e) => set({ lowDiskGb: Number(e.target.value) })} /> GB</span></Row>
      </div>
    </div>
  );
}
