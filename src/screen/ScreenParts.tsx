// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote screens in the main window: the "X wants to see this screen" prompt
// (on any page), the screen card on a device's page, phones on this screen
// (Android mirroring, iPhone through AirPlay), and the "Send to Device" sheet.

import { useCallback, useEffect, useState } from 'react';
import type { AndroidDevice, AndroidStatus, ControlStatus, ScreenState } from '../../core/api-screen';
import type { LinkDevice } from '../../core/api-link';
import { relativeTime } from '../../core/format';
import type { AirPlayPlan } from '../../core/screen/mirror';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { osIcon, useLink, viaLabel } from '../components/LinkParts';
import { Modal, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/screen.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function useScreen(): [ScreenState | null, () => void] {
  const [s, setS] = useState<ScreenState | null>(null);
  const load = useCallback(() => void api.screen.state().then(setS).catch(() => undefined), []);
  useEffect(() => {
    load();
    return api.on('screen-state', setS);
  }, [load]);
  return [s, load];
}

/** Opens the Send to Device sheet from anywhere (file menus, the shelf). */
export function sendToDevice(paths: string[]) {
  window.dispatchEvent(new CustomEvent('keeper-send-to', { detail: paths }));
}

// ---------------------------------------------------------------- prompts on any page

export function ScreenPrompts() {
  const [asks, setAsks] = useState<{ id: string; name: string; control: boolean }[]>([]);
  const [sending, setSending] = useState<string[] | null>(null);
  const [invite, setInvite] = useState<{ id: string; from: string; hostName: string } | null>(null);
  const [cmd, setCmd] = useState<{ id: string; deviceName: string; command: string } | null>(null);
  const { tabs } = useStore();
  useEffect(() => {
    const offInv = api.on('screen-invite' as never, ((i: { id: string; from: string; hostName: string }) => setInvite(i)) as never);
    const offCmd = api.on('access-command' as never, ((c: { id: string; deviceName: string; command: string }) => setCmd(c)) as never);
    void api.access?.pendingCommands?.().then((l) => l[0] && setCmd(l[0])).catch(() => undefined);
    return () => { offInv(); offCmd(); };
  }, []);
  useEffect(() => {
    const off = api.on('screen-ask', (a) => setAsks((x) => [...x.filter((y) => y.id !== a.id), a]));
    const open = (e: Event) => setSending((e as CustomEvent<string[]>).detail);
    window.addEventListener('keeper-send-to', open);
    return () => {
      off();
      window.removeEventListener('keeper-send-to', open);
    };
  }, []);
  const a = asks[0];
  const answer = (ok: boolean, control: boolean) => {
    if (!a) return;
    void api.screen.answer(a.id, ok, control);
    setAsks((x) => x.slice(1));
  };
  return (
    <>
      {a ? (
        <Modal title={`${a.name} wants to ${a.control ? 'control' : 'see'} this screen`} onClose={() => answer(false, false)}>
          <div className="screen-ask" data-testid="screen-ask">
            <div className="screen-ask-who">
              <div className="screen-ask-icon"><Icon name="eye" size={22} /></div>
              <div className="small">
                {a.control
                  ? <>{a.name} will see everything on this screen and can use the mouse and keyboard.</>
                  : <>{a.name} will see everything on this screen, but cannot click or type.</>}
                {' '}A banner stays at the top of the screen while it watches, with one click to stop.
              </div>
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => answer(false, false)}>Don’t Allow</button>
              {a.control ? <button className="btn" onClick={() => answer(true, false)}>Allow Viewing Only</button> : null}
              <button className="btn primary" onClick={() => answer(true, a.control)}>{a.control ? 'Allow Control' : 'Allow'}</button>
            </div>
          </div>
        </Modal>
      ) : null}
      {sending ? <SendSheet paths={sending} onClose={() => setSending(null)} /> : null}
      {invite ? (
        <Modal title={`${invite.from} invites you to watch ${invite.hostName}`} onClose={() => setInvite(null)} width={440}>
          <p style={{ marginTop: 0 }} className="small">You will see {invite.hostName}’s screen, view only, for as long as their session lasts.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setInvite(null)}>No Thanks</button>
            <button className="btn" onClick={() => { void api.screen.joinInvite(invite.id, true).then((sid) => tabs.open({ name: 'devices', arg: `screen:${sid}` })); setInvite(null); }}>Watch in a Tab</button>
            <button className="btn primary" data-testid="invite-watch" onClick={() => { void api.screen.joinInvite(invite.id); setInvite(null); }}>Watch</button>
          </div>
        </Modal>
      ) : null}
      {cmd ? (
        <Modal title={`${cmd.deviceName} wants to run a command here`} onClose={() => { void api.access.answerCommand(cmd.id, false); setCmd(null); }} width={520}>
          <p style={{ marginTop: 0 }} className="small">It runs as you. You see each new command once; the same command later runs without asking.</p>
          <pre className="remote-output" data-testid="command-ask">{cmd.command}</pre>
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn" onClick={() => { void api.access.answerCommand(cmd.id, false); setCmd(null); }}>Don’t Allow</button>
            <button className="btn primary" data-testid="command-allow" onClick={() => { void api.access.answerCommand(cmd.id, true); setCmd(null); }}>Allow</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function SendSheet({ paths, onClose }: { paths: string[]; onClose: () => void }) {
  const { toast } = useStore();
  const [s] = useLink();
  const [phones, setPhones] = useState<AndroidDevice[]>([]);
  useEffect(() => void api.screen.androidDevices().then((d) => setPhones(d.filter((x) => x.state === 'device'))).catch(() => undefined), []);
  const name = paths.length === 1 ? paths[0].split(/[\\/]/).pop() : `${paths.length} items`;
  const toDevice = (d: LinkDevice) => {
    onClose();
    toast(`Sending ${name} to ${d.name}…`);
    void api.link.sendFiles(d.id, paths).then(() => toast(`Sent ${name} to ${d.name}`), (e) => toast(clean(e)));
  };
  const toPhone = (p: AndroidDevice) => {
    onClose();
    void api.screen.androidDrop(p.serial, paths).then((r) => toast(r.every((x) => x.ok) ? `Sent to ${p.model ?? 'the phone'}` : r.find((x) => !x.ok)?.error ?? 'Could not send'), (e) => toast(clean(e)));
  };
  return (
    <Modal title={`Send ${name}`} onClose={onClose} width={420}>
      <div className="send-sheet">
        {s?.devices.map((d) => (
          <button key={d.id} className="send-sheet-row" onClick={() => toDevice(d)} title={d.online ? viaLabel(d.via) : 'Not reachable now; Keeper will try anyway'}>
            <Icon name={osIcon(d.os)} size={18} />
            <span className="grow">{d.name}<span className="small muted"> · {d.online ? viaLabel(d.via) || 'nearby' : 'not reachable now'}</span></span>
            <Icon name="send" size={14} />
          </button>
        ))}
        {phones.map((p) => (
          <button key={p.serial} className="send-sheet-row" onClick={() => toPhone(p)}>
            <Icon name="phone" size={18} />
            <span className="grow">{p.model ?? p.serial}<span className="small muted"> · Android{p.wifi ? ', Wi-Fi' : ', USB'}</span></span>
            <Icon name="send" size={14} />
          </button>
        ))}
        {!s?.devices.length && !phones.length ? <div className="small muted">No devices yet. Pair one under Devices &amp; Remote, or connect an Android phone under Devices → Phone.</div> : null}
        <div className="small muted">Phones without Keeper: open Devices → Phone and scan the code; files you send from the phone arrive here.</div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- a paired device's page

export function DeviceScreenCard({ d }: { d: LinkDevice }) {
  const { toast, tabs } = useStore();
  const [s] = useScreen();
  const [ctl, setCtl] = useState<ControlStatus | null>(null);
  useEffect(() => void api.screen.control().then(setCtl).catch(() => undefined), []);
  const live = s?.sessions.filter((x) => x.peer === d.id && x.state !== 'ended') ?? [];
  const unattended = !!s?.policy.unattended[d.id];
  const view = (control: boolean) => void api.screen.view(d.id, { control }).catch((e) => toast(clean(e)));
  const canBeControlled = !!d.permissions.screenView && !!d.permissions.screenControl;
  return (
    <div className="card pad screen-panel" data-testid="device-screen">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Screen</h3>
        <div className="btn-row">
          <button className="btn" onClick={() => view(false)}><Icon name="eye" size={14} /> View Screen</button>
          <button className="btn primary" onClick={() => view(true)}><Icon name="laptop" size={14} /> Control</button>
          <button className="btn ghost" title="Open in a Keeper tab (several screens side by side in tabs)" onClick={() => void api.screen.view(d.id, { control: true, tab: true }).then((sid) => tabs.open({ name: 'devices', arg: `screen:${sid}` }), (e) => toast(clean(e)))}><Icon name="plus" size={14} /> In a Tab</button>
          {!d.online && s?.wake[d.id] ? <button className="btn" onClick={() => void api.screen.wake(d.id).then((r) => toast(`Wake signal sent${r.via.length ? ` (also through ${r.via.join(', ')})` : ''}`), (e) => toast(clean(e)))}><Icon name="power" size={14} /> Wake</button> : null}
        </div>
      </div>
      <div className="small muted">
        Watch {d.name}’s screen here, and use its mouse and keyboard if it allows. It is asked each time unless it lets this device in without asking.
        {' '}The picture goes directly between the two devices when it can, and through Keeper Link otherwise; both are end-to-end encrypted.
      </div>
      {live.length ? <div className="small"><span className="badge ok">Live</span> {live.map((x) => `${x.role === 'host' ? `${d.name} is ${x.control ? 'controlling' : 'viewing'} this screen` : `Viewing ${d.name}`}`).join(' · ')}</div> : null}
      <div className="link-perm-row">
        <div className="grow">
          <div style={{ fontWeight: 550 }}>Let {d.name} in without asking</div>
          <div className="small muted">For your own computers. Needs “See this screen” and “Control this computer” above. The banner still shows while it is connected.</div>
        </div>
        <Toggle on={unattended && canBeControlled} onChange={(v) => (canBeControlled ? void api.screen.setPolicy({ unattended: { [d.id]: v } }).catch((e) => toast(clean(e))) : toast(`Turn on “See this screen” and “Control this computer” for ${d.name} first`))} />
      </div>
      {ctl && !ctl.available ? <div className="small muted">This computer can be watched but not controlled: {ctl.reason}</div> : null}
      {ctl?.needs?.length ? <button className="btn sm" onClick={() => void api.screen.requestPermissions()}>Open macOS permissions</button> : null}
      {!s?.wake[d.id] ? <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => void api.screen.learn(d.id).then((ok) => toast(ok ? `Keeper can now wake ${d.name} from sleep` : `${d.name} reported no wired or Wi-Fi card`), (e) => toast(clean(e)))}>Learn how to wake {d.name}</button> : null}
    </div>
  );
}

/** Session history on the Remote Access tab. */
export function ScreenLog() {
  const [s] = useScreen();
  if (!s?.log.length) return null;
  return (
    <div className="card pad">
      <h3 style={{ margin: '0 0 8px' }}>Screen sessions</h3>
      <div className="screen-log" data-testid="screen-log">{s.log.map((l, i) => <div key={i}><span>{l.title}</span><span className="muted">{relativeTime(l.at)}</span></div>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- phones on this screen

export function PhoneMirrorCard() {
  const { toast, info } = useStore();
  const [st, setSt] = useState<AndroidStatus | null>(null);
  const [phones, setPhones] = useState<AndroidDevice[]>([]);
  const [prog, setProg] = useState(0);
  const [pair, setPair] = useState({ addr: '', code: '', connect: '' });
  const [opts, setOpts] = useState({ viewOnly: false, record: false, screenOff: false });
  const [over, setOver] = useState<string | null>(null);
  const [ap, setAp] = useState<(AirPlayPlan & { running?: boolean }) | null>(null);
  const refresh = useCallback(() => {
    void api.screen.android().then(setSt).catch(() => undefined);
    void api.screen.androidDevices().then(setPhones).catch(() => undefined);
    void api.screen.airplay().then(setAp).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const off = api.on('screen-android-progress', setProg);
    const t = window.setInterval(() => void api.screen.androidDevices().then(setPhones).catch(() => undefined), 5000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [refresh]);
  const install = () => void api.screen.androidInstall().then(refresh, (e) => toast(clean(e)));
  const mirror = (p: AndroidDevice) => void api.screen.androidMirror({
    serial: p.serial, title: p.model ?? 'Phone', viewOnly: opts.viewOnly, screenOff: opts.screenOff, stayAwake: true, bitrateMbps: 8,
    record: opts.record ? `${p.model ?? 'Phone'} ${new Date().toISOString().slice(0, 16).replace(':', '.')}.mp4` : undefined,
  }).catch((e) => toast(clean(e)));
  const drop = (p: AndroidDevice, files: FileList) => {
    const paths = [...files].map((f) => api.files.pathOf?.(f) ?? '').filter(Boolean);
    if (!paths.length) return;
    toast(`Sending ${paths.length} file${paths.length === 1 ? '' : 's'} to ${p.model ?? 'the phone'}…`);
    void api.screen.androidDrop(p.serial, paths).then((r) => toast(r.every((x) => x.ok) ? 'Done: apps installed, files in Download' : r.find((x) => !x.ok)?.error ?? 'Some files did not go'), (e) => toast(clean(e)));
  };
  return (
    <>
      <div className="card pad screen-panel" data-testid="android-card">
        <h3 style={{ margin: 0 }}>Android on this screen</h3>
        <div className="small muted">See and use your Android phone or tablet here: over USB, or over Wi-Fi with wireless debugging. Drop files on it to send them (apps are installed). Uses scrcpy, which Keeper downloads once and checks before running.</div>
        {!st ? null : !st.ready ? (
          <div className="screen-panel-row">
            {st.canDownload
              ? <button className="btn primary" disabled={st.downloading} onClick={install}><Icon name="down" size={14} /> {st.downloading ? `Downloading… ${Math.round(prog * 100)}%` : `Set Up (scrcpy ${st.version})`}</button>
              : <span className="small">Install scrcpy with: <code>{st.hint}</code></span>}
          </div>
        ) : (
          <>
            <div className="small">On the phone: Settings → About phone → tap Build number 7 times, then Developer options → USB debugging (and Wireless debugging for Wi-Fi). Accept the prompt on the phone the first time.</div>
            <div className="phone-list">
              {phones.length ? phones.map((p) => (
                <div key={p.serial} className={`phone-row ${over === p.serial ? 'drop' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(p.serial); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); drop(p, e.dataTransfer.files); }}>
                  <Icon name="phone" size={16} />
                  <div className="grow">{p.model ?? p.serial} <span className="small muted">{p.wifi ? 'Wi-Fi' : 'USB'}{p.state !== 'device' ? ` · ${p.state === 'unauthorized' ? 'accept the prompt on the phone' : p.state}` : ''}</span></div>
                  <button className="btn sm primary" disabled={p.state !== 'device'} onClick={() => mirror(p)}>Show Phone</button>
                  <button className="btn sm ghost" onClick={() => void api.screen.androidStop(p.serial)}>Stop</button>
                </div>
              )) : <div className="small muted">No phone connected yet.</div>}
            </div>
            <div className="screen-panel-row small">
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={opts.viewOnly} onChange={(e) => setOpts({ ...opts, viewOnly: e.target.checked })} /> View only</label>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={opts.screenOff} onChange={(e) => setOpts({ ...opts, screenOff: e.target.checked })} /> Turn the phone’s own screen off</label>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={opts.record} onChange={(e) => setOpts({ ...opts, record: e.target.checked })} /> Record to a video</label>
            </div>
            <div className="screen-panel-row">
              <input className="input" style={{ width: 190 }} placeholder="Pair: 192.168.1.20:37123" value={pair.addr} onChange={(e) => setPair({ ...pair, addr: e.target.value })} />
              <input className="input" style={{ width: 110 }} placeholder="6-digit code" value={pair.code} onChange={(e) => setPair({ ...pair, code: e.target.value })} />
              <button className="btn sm" onClick={() => void api.screen.androidPair(pair.addr.trim(), pair.code.trim()).then(() => toast('Paired. Now connect with the address under Wireless debugging.'), (e) => toast(clean(e)))}>Pair over Wi-Fi</button>
              <input className="input" style={{ width: 190 }} placeholder="Connect: 192.168.1.20:41235" value={pair.connect} onChange={(e) => setPair({ ...pair, connect: e.target.value })} />
              <button className="btn sm" onClick={() => void api.screen.androidConnect(pair.connect.trim()).then(refresh, (e) => toast(clean(e)))}>Connect</button>
            </div>
          </>
        )}
      </div>
      <div className="card pad screen-panel" data-testid="airplay-card">
        <h3 style={{ margin: 0 }}>iPhone and iPad on this screen</h3>
        <div className="small muted">iOS lets a computer show its screen through AirPlay, but never lets it be controlled from elsewhere. {ap?.detail}</div>
        {ap ? (
          <div className="screen-panel-row">
            {ap.how === 'system' ? <button className="btn primary" onClick={() => void api.screen.airplayStart(info?.home ?? 'Keeper')}>Open AirPlay Receiver Settings</button> : null}
            {ap.how === 'uxplay' ? (ap.running
              ? <button className="btn" onClick={() => void api.screen.airplayStop().then(refresh)}>Stop Receiving</button>
              : <button className="btn primary" onClick={() => void api.screen.airplayStart('Keeper').then(refresh, (e) => toast(clean(e)))}>Start Receiving</button>) : null}
            {ap.how === 'install' && ap.command ? <span className="small">Install once: <code>{ap.command}</code> <button className="btn ghost sm" onClick={refresh}>Check Again</button></span> : null}
            {ap.how === 'manual' && ap.open ? <button className="btn" onClick={() => void api.system.openExternal(ap.open!)}>How to Install</button> : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
