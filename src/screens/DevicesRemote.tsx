// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote access on the Devices page: your devices as a fleet (search, groups,
// tags, notes, last seen), remote actions and a system snapshot, a terminal
// on another device, help mode, unattended access, where remote access shows
// up around the system, and the audit log.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { AuditEntry, HelpStatusView, SysInfo, UnattendedStatus } from '../../core/api-access';
import type { LinkDevice, LinkState } from '../../core/api-link';
import { sysInfoLines } from '../../core/link/actions';
import { groupDevices, lastSeenLabel, searchDevices } from '../../core/link/fleet';
import { formatCode, parseHelpLink } from '../../core/link/help-web';
import { PERMISSIONS } from '../../core/link/perms';
import { SURFACE_ITEMS, SURFACE_LABELS, surfaceOn, toggleSurface, type Surface } from '../../core/link/surfaces';
import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { DeviceDot, osIcon, viaLabel } from '../components/LinkParts';
import { Modal, Toggle } from '../components/ui';
import { useFeature } from '../features';
import { useStore } from '../state';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---------------------------------------------------------------- the fleet

export function DeviceGrid({ s }: { s: LinkState }) {
  const { go, toast } = useStore();
  const fleet = useFeature('remoteFleet');
  const [q, setQ] = useState('');
  const rows = useMemo(() => searchDevices(s.devices, fleet ? q : ''), [s.devices, q, fleet]);
  const groups = fleet ? groupDevices(rows) : [{ group: '', devices: rows }];
  const now = Date.now();
  return (
    <div className="col" style={{ gap: 10 }}>
      {fleet && s.devices.length > 1 ? (
        <div className="row" style={{ gap: 8 }}>
          <div className="search-box grow" style={{ position: 'relative' }}>
            <input className="input" style={{ width: '100%' }} placeholder="Search devices: name, tag:office, group:family, online…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="device-search" />
          </div>
          <span className="small muted">{s.devices.filter((d) => d.online).length} of {s.devices.length} online</span>
        </div>
      ) : null}
      {groups.map((g) => (
        <div key={g.group || '-'} className="col" style={{ gap: 6 }}>
          {fleet && groups.length > 1 ? <div className="small muted" style={{ fontWeight: 600 }}>{g.group || 'No group'}</div> : null}
          <div className="link-grid">
            {g.devices.map((d) => (
              <button key={d.id} className="card link-device" onClick={() => go({ name: 'devices', arg: d.id })} data-testid="device-card">
                <div className="row" style={{ gap: 10 }}>
                  <div className="link-dev-icon"><Icon name={osIcon(d.os)} size={20} /><DeviceDot d={d} /></div>
                  <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                    <div className="ellipsis" style={{ fontWeight: 600 }}>{d.name}</div>
                    <div className="small muted ellipsis">{d.online ? `${viaLabel(d.via) || 'Nearby'}${d.rtt !== undefined ? ` · ${d.rtt} ms` : ''}` : lastSeenLabel(now, false, d.lastSeen)}</div>
                  </div>
                </div>
                {d.meta?.tags.length ? <div className="link-perms">{d.meta.tags.map((t) => <span key={t} className="chip sm">#{t}</span>)}</div> : null}
                <div className="link-perms">{PERMISSIONS.filter((p) => d.permissions[p.id]).map((p) => <span key={p.id} className="chip sm">{p.label.replace(/ to this device| on this computer| on this device| here/g, '')}</span>)}</div>
                <div className="btn-row" onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm" onClick={() => void api.link.sendFiles(d.id).catch((e) => toast(clean(e)))}><Icon name="send" size={13} /> Send Files</button>
                  <button className="btn sm ghost" onClick={() => void api.link.check(d.id).then((r) => toast(r.ok ? `${d.name}: ${viaLabel(r.via)}, ${r.rtt} ms` : r.error ?? 'Not reachable'))}><Icon name="refresh" size={13} /> Check</button>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {!rows.length ? <div className="small muted">No device matches “{q}”.</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- one device: carriers, notes, actions, snapshot, log

export function DeviceManage({ d }: { d: LinkDevice }) {
  const { toast } = useStore();
  const fleet = useFeature('remoteFleet');
  const cmdsOn = useFeature('remoteCommands');
  const termOn = useFeature('remoteTerminal');
  const [info, setInfo] = useState<SysInfo | null>(null);
  const [confirm, setConfirm] = useState<'restart' | 'sleep' | null>(null);
  const [term, setTerm] = useState(false);
  const [cmd, setCmd] = useState('');
  const [out, setOut] = useState<{ command: string; text: string; code: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = d.meta ?? { tags: [], commands: [] };
  const [notes, setNotes] = useState(meta.notes ?? '');
  useEffect(() => setNotes(d.meta?.notes ?? ''), [d.id]);
  const save = (m: Partial<typeof meta>) => void api.access.setMeta(d.id, m).catch((e) => toast(clean(e)));
  const run = async (command: string) => {
    setBusy(true);
    try {
      const r = await api.access.exec(d.id, command);
      setOut({ command, text: (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim() || '(no output)', code: r.code });
    } catch (e) {
      setOut({ command, text: clean(e), code: null });
    } finally {
      setBusy(false);
    }
  };
  const power = (a: 'lock' | 'sleep' | 'restart') => void api.access.power(d.id, a).then(() => toast(a === 'lock' ? `Locked ${d.name}` : a === 'sleep' ? `${d.name} is going to sleep` : `${d.name} is restarting`), (e) => toast(clean(e)));
  const direct = d.paths?.find((p) => p.kind === 'direct');
  return (
    <>
      {d.paths?.length ? (
        <div className="card pad" data-testid="device-paths">
          <h3 style={{ margin: '0 0 6px' }}>Connection</h3>
          <div className="link-list">
            {d.paths.map((p, i) => (
              <div key={i} className="link-row">
                <Icon name={p.kind === 'direct' ? 'bolt' : p.kind === 'relay' ? 'cloud' : 'link'} size={15} />
                <div className="grow"><b>{viaLabel(p.kind)}</b> <span className="small muted">{p.where ?? ''}</span></div>
                <span className="small muted">{formatBytes(p.bytesOut + p.bytesIn)} moved</span>
                {p.active ? <span className="badge ok">In use</span> : <span className="badge">Standby</span>}
              </div>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>{direct ? 'Files, ports and screens go straight between the two devices. If the direct path stops, everything moves back without dropping.' : 'Keeper looks for a direct path when a device is reached through a relay or tunnel.'}</div>
        </div>
      ) : null}

      {fleet ? (
        <div className="card pad">
          <h3 style={{ margin: '0 0 8px' }}>Notes and tags</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 180 }} placeholder="Group (e.g. Office)" defaultValue={meta.group ?? ''} onBlur={(e) => e.target.value !== (meta.group ?? '') && save({ group: e.target.value })} data-testid="device-group" />
            <input className="input grow" placeholder="Tags, separated by commas" defaultValue={meta.tags.join(', ')} onBlur={(e) => save({ tags: e.target.value.split(',') })} data-testid="device-tags" />
          </div>
          <textarea className="input" style={{ width: '100%', minHeight: 60, marginTop: 8 }} placeholder={`Notes about ${d.name} (only on this device)`} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (meta.notes ?? '') && save({ notes })} />
        </div>
      ) : null}

      <div className="card pad" data-testid="device-actions">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Actions</h3>
          <div className="btn-row">
            <button className="btn sm" disabled={!d.online} onClick={() => power('lock')}><Icon name="lock" size={13} /> Lock</button>
            <button className="btn sm" disabled={!d.online} onClick={() => setConfirm('sleep')}><Icon name="moon" size={13} /> Sleep</button>
            <button className="btn sm" disabled={!d.online} onClick={() => setConfirm('restart')}><Icon name="power" size={13} /> Restart</button>
            {termOn ? <button className="btn sm" disabled={!d.online} onClick={() => setTerm(true)} data-testid="open-remote-terminal"><Icon name="terminal" size={13} /> Terminal</button> : null}
            <button className="btn sm" disabled={!d.online} onClick={() => void api.access.print(d.id).then(() => undefined, (e) => toast(clean(e)))}><Icon name="document" size={13} /> Print There…</button>
            <button className="btn sm" disabled={!d.online} onClick={() => void api.access.info(d.id).then(setInfo, (e) => toast(clean(e)))}><Icon name="info" size={13} /> System Details</button>
          </div>
        </div>
        <div className="small muted">Lock, sleep, restart and printing need “Control this computer” on {d.name}; the terminal needs “Terminal on this device”.</div>
        {cmdsOn ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 550 }}>Run a command</div>
            <div className="small muted">{d.name} must allow “Run commands”. The first time it sees a command, it shows it to its owner before running it.</div>
            {meta.commands.length ? (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {meta.commands.map((c) => (
                  <span key={c.id} className="chip">
                    <button className="btn ghost sm" disabled={busy || !d.online} onClick={() => void run(c.command)} title={c.command}>{c.name}</button>
                    <button className="btn ghost sm icon" title="Remove" onClick={() => save({ commands: meta.commands.filter((x) => x.id !== c.id) })}><Icon name="close" size={10} /></button>
                  </span>
                ))}
              </div>
            ) : null}
            <form className="row" style={{ gap: 6, marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); if (cmd.trim()) void run(cmd.trim()); }}>
              <input className="input grow mono small" placeholder="e.g. uptime" value={cmd} onChange={(e) => setCmd(e.target.value)} data-testid="remote-command" />
              <button className="btn sm primary" disabled={busy || !cmd.trim() || !d.online}>{busy ? 'Running…' : 'Run'}</button>
              <button type="button" className="btn sm" disabled={!cmd.trim()} onClick={() => { save({ commands: [...meta.commands, { id: '', name: cmd.trim().slice(0, 40), command: cmd.trim() }] }); toast('Saved'); }}>Save</button>
            </form>
            {out ? <pre className="remote-output" data-testid="remote-output"><span className="muted">$ {out.command}{out.code !== null ? `   (exit ${out.code})` : ''}</span>{'\n'}{out.text}</pre> : null}
          </div>
        ) : null}
        {info ? (
          <div className="link-list" style={{ marginTop: 10 }} data-testid="sysinfo">
            {sysInfoLines(info).map(([k, v]) => <div key={k} className="link-row"><span className="small muted" style={{ width: 120 }}>{k}</span><span className="grow">{v}</span></div>)}
          </div>
        ) : null}
      </div>

      <AuditCard device={d.id} title={`Log for ${d.name}`} />

      {confirm ? (
        <Modal title={confirm === 'restart' ? `Restart ${d.name}?` : `Put ${d.name} to sleep?`} onClose={() => setConfirm(null)} width={420}>
          <p style={{ marginTop: 0 }}>{confirm === 'restart' ? 'Anything unsaved there may be lost. With unattended access on, you can reach it again before anyone logs in.' : 'It will not be reachable until it wakes (Wake works if it supports Wake-on-LAN).'}</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn danger" onClick={() => { power(confirm); setConfirm(null); }}>{confirm === 'restart' ? 'Restart' : 'Sleep'}</button>
          </div>
        </Modal>
      ) : null}
      {term ? <RemoteTerminal device={d} onClose={() => setTerm(false)} /> : null}
    </>
  );
}

/** A terminal on another device, through Keeper Link. */
export function RemoteTerminal({ device, onClose }: { device: Pick<LinkDevice, 'id' | 'name'>; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Connecting…');
  useEffect(() => {
    const t = new Terminal({ fontSize: 13, cursorBlink: true, theme: { background: '#111214' }, fontFamily: 'ui-monospace, Menlo, Consolas, monospace' });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(host.current!);
    fit.fit();
    let id: string | null = null;
    let alive = true;
    const offs = [
      api.on('access-term' as never, ((tid: string, text: string) => tid === id && t.write(text)) as never),
      api.on('access-term-exit' as never, ((tid: string, reason: string) => {
        if (tid !== id) return;
        setStatus(reason);
        t.write(`\r\n\x1b[2m[${reason}]\x1b[0m\r\n`);
      }) as never),
    ];
    void api.access.termOpen(device.id, t.cols, t.rows).then((x) => {
      if (!alive) return void api.access.termClose(x);
      id = x;
      setStatus('');
      t.focus();
    }, (e) => setStatus(clean(e)));
    const d = t.onData((s) => id && void api.access.termWrite(id, s));
    const r = t.onResize(({ cols, rows }) => id && void api.access.termResize(id, cols, rows));
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(host.current!);
    return () => {
      alive = false;
      offs.forEach((o) => o());
      d.dispose();
      r.dispose();
      ro.disconnect();
      if (id) void api.access.termClose(id);
      t.dispose();
    };
  }, [device.id]);
  return (
    <Modal title={`Terminal on ${device.name}`} onClose={onClose} width={860}>
      {status ? <div className="small muted" style={{ marginBottom: 6 }} data-testid="remote-term-status">{status}</div> : null}
      <div ref={host} className="remote-term" data-testid="remote-term" />
    </Modal>
  );
}

// ---------------------------------------------------------------- help mode

export function HelpCard({ prefill }: { prefill?: string }) {
  const { toast, tabs } = useStore();
  const on = useFeature('remoteHelp');
  const [st, setSt] = useState<HelpStatusView | null>(null);
  const pre = prefill ? parseHelpLink(`keeper://help?code=${prefill.split('.')[0]}${prefill.includes('.') ? `&pw=${prefill.split('.')[1]}` : ''}`) : null;
  const [code, setCode] = useState(pre?.code ? formatCode(pre.code) : '');
  const [pw, setPw] = useState(pre?.password ?? '');
  const [inTab, setInTab] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => void api.access.helpStatus().then(setSt).catch(() => undefined);
    load();
    const off = api.on('access-help' as never, load as never);
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { off(); clearInterval(t); };
  }, []);
  if (!on) {
    return (
      <div className="card pad">
        <h3 style={{ marginTop: 0 }}>Help mode</h3>
        <div className="small muted">One-time support sessions with someone who is not paired: they read you a code, you see their screen, and they decide whether you may control it. Turn on “Help mode” in Settings → Features to use it.</div>
      </div>
    );
  }
  const offer = st?.offer;
  const join = async () => {
    const link = parseHelpLink(code.trim());
    setBusy(true);
    setErr(null);
    try {
      const r = await api.access.helpJoin(link?.code ?? code, link?.password ?? pw, { tab: inTab });
      if (inTab) tabs.open({ name: 'devices', arg: `screen:${r.sid}` });
      toast(`Connected to ${r.name}. View only until they let you control.`);
    } catch (e) {
      setErr(clean(e));
    } finally {
      setBusy(false);
    }
  };
  const left = offer ? Math.max(0, Math.round((offer.expires - now) / 1000)) : 0;
  return (
    <div className="card pad" data-testid="help-card">
      <h3 style={{ marginTop: 0 }}>Help mode</h3>
      <div className="help-cols">
        <div className="col" style={{ gap: 8 }}>
          <b>Get help</b>
          <div className="small muted">Someone you trust can see your screen once. You decide if they may also use the mouse and keyboard, and you can stop at any time. Nothing is remembered afterwards.</div>
          {offer ? (
            <div className="help-offer">
              <div className="small muted">Read these to your helper:</div>
              <div className="link-code" data-testid="help-code">{formatCode(offer.code)}</div>
              <div>Password <b className="mono help-pw" data-testid="help-password">{offer.password}</b></div>
              <div className="small muted">Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more · reachable {offer.reach.map((r) => (r === 'lan' ? 'on this network' : r === 'relay' ? 'through the relay' : 'through the tunnel')).join(', ')}</div>
              <div className="btn-row">
                <button className="btn sm" onClick={() => void navigator.clipboard.writeText(offer.link).then(() => toast('“Ask for help” link copied'))}><Icon name="copy" size={13} /> Copy “Ask for help” Link</button>
                {offer.webUrl ? <button className="btn sm ghost" title={offer.webUrl} onClick={() => void navigator.clipboard.writeText(offer.webUrl!).then(() => toast('Web viewer address copied: the helper can use a browser'))}>Helper Uses a Browser</button> : null}
                <button className="btn sm danger" onClick={() => void api.access.helpStop()}>Stop</button>
              </div>
            </div>
          ) : (
            <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => void api.access.helpStart().then(() => undefined, (e) => toast(clean(e)))} data-testid="help-start">Get Help</button>
          )}
        </div>
        <form className="col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void join(); }}>
          <b>Help someone</b>
          <div className="small muted">Type the 9-digit code and the password they read out (or paste their keeper://help link).</div>
          <input className="input link-code-input" placeholder="123 456 789" value={code} onChange={(e) => setCode(e.target.value)} data-testid="help-join-code" />
          {!code.startsWith('keeper://') ? <input className="input mono" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value.toUpperCase())} data-testid="help-join-password" /> : null}
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={inTab} onChange={(e) => setInTab(e.target.checked)} /> Open in a Keeper tab</label>
          {err ? <div className="small danger-text">{err}</div> : null}
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy || !code.trim()} data-testid="help-join">{busy ? 'Connecting…' : 'Connect'}</button>
        </form>
      </div>
      {st?.guests.length ? (
        <div className="link-list" style={{ marginTop: 10 }}>
          {st.guests.map((g) => (
            <div key={g.id} className="link-row" data-testid="help-guest">
              <Icon name="laptop" size={15} />
              <div className="grow">{g.role === 'host' ? <><b>{g.name}</b> is helping you</> : <>You are helping <b>{g.name}</b></>} <span className="small muted">since {relativeTime(g.since)} · {viaLabel(g.via)}</span></div>
              <button className="btn sm danger" onClick={() => void api.access.helpStop()}>End</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- unattended access

export function UnattendedCard({ s }: { s: LinkState }) {
  const { toast } = useStore();
  const on = useFeature('unattendedAccess');
  const [u, setU] = useState<UnattendedStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => void api.access.unattended().then(setU).catch(() => undefined), [s.devices.length]);
  if (!u?.supported) return null;
  const flip = async (v: boolean) => {
    setBusy(true);
    try {
      setU(await api.access.setUnattended(v));
      toast(v ? 'Unattended access is on' : 'Unattended access is off');
    } catch (e) {
      toast(clean(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`card pad ${on ? '' : 'link-dim'}`} data-testid="unattended-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0 }}>Unattended access</h3>
          <div className="small muted">Keep this computer reachable by your own devices after a restart and before anyone logs in. Installs a small system service (asks for an administrator once).</div>
        </div>
        <Toggle on={u.installed} onChange={(v) => (on ? void flip(v) : toast('Turn on “Unattended access” in Settings → Features first'))} />
      </div>
      {!u.can.ok && !u.installed ? <div className="small muted" style={{ marginTop: 6 }}>{u.can.reason}</div> : null}
      <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{u.limits.map((l) => <li key={l}>{l}</li>)}</ul>
      {busy ? <div className="small">Waiting for the administrator prompt…</div> : null}
      {u.preview ? <button className="btn ghost sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'} what gets installed</button> : null}
      {show ? <pre className="remote-output" data-testid="unattended-preview">{u.preview}</pre> : null}
    </div>
  );
}

// ---------------------------------------------------------------- where it shows up

export function SurfacesCard({ s, reload }: { s: LinkState; reload: () => void }) {
  const { toast } = useStore();
  const set = (item: (typeof SURFACE_ITEMS)[number]['id'], place: Surface, v: boolean) => void api.link.setSettings({ surfaces: toggleSurface(s.settings.surfaces, item, place, v) }).then(reload, (e) => toast(clean(e)));
  return (
    <div className="card pad" data-testid="surfaces-card">
      <h3 style={{ marginTop: 0 }}>Where it shows up</h3>
      <div className="small muted" style={{ marginBottom: 8 }}>Reach your devices without opening this page. Choose where each part appears.</div>
      <table className="surfaces-table">
        <thead><tr><th /> {(['tray', 'island', 'palette', 'contextMenu'] as Surface[]).map((p) => <th key={p} className="small muted">{SURFACE_LABELS[p]}</th>)}</tr></thead>
        <tbody>
          {SURFACE_ITEMS.map((i) => (
            <tr key={i.id}>
              <td><div style={{ fontWeight: 550 }}>{i.label}</div><div className="small muted">{i.detail}</div></td>
              {(['tray', 'island', 'palette', 'contextMenu'] as Surface[]).map((p) => (
                <td key={p} style={{ textAlign: 'center' }}>{i.places.includes(p) ? <input type="checkbox" aria-label={`${i.label} in ${SURFACE_LABELS[p]}`} checked={surfaceOn(s.settings.surfaces, i.id, p)} onChange={(e) => set(i.id, p, e.target.checked)} /> : <span className="muted">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- the audit log

const KIND_LABEL: Record<string, string> = { screen: 'Screen', help: 'Help', transfer: 'File', command: 'Command', terminal: 'Terminal', power: 'Power', print: 'Print', forward: 'Port', unattended: 'Service', permission: 'Permission', location: 'Location' };

export function AuditCard({ device, title = 'Remote access log' }: { device?: string; title?: string }) {
  const { toast } = useStore();
  const [list, setList] = useState<AuditEntry[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    const load = () => void api.access.audit({ device, q: q || undefined }).then(setList).catch(() => setList([]));
    load();
    const offs = [api.on('link-changed', load), api.on('screen-state', load as never)];
    return () => offs.forEach((o) => o());
  }, [device, q]);
  const exp = (f: 'csv' | 'json') => void api.access.exportAudit(f, device).then((p) => p && toast(`Saved ${p.split(/[\\/]/).pop()}`), (e) => toast(clean(e)));
  return (
    <div className="card pad" data-testid="audit-card">
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="btn-row">
          <input className="input sm" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 140 }} />
          <button className="btn sm" onClick={() => exp('csv')}>Export CSV</button>
          <button className="btn sm ghost" onClick={() => exp('json')}>JSON</button>
        </div>
      </div>
      <div className="small muted">Every screen session, help session, file, command, terminal and restart, in and out. Kept on this device only.</div>
      {list === null ? <div className="spinner" /> : list.length ? (
        <div className="link-list audit-list" style={{ marginTop: 8 }}>
          {list.slice(0, 60).map((e) => (
            <div key={e.id} className="link-row" data-testid="audit-row">
              <span className={`chip sm ${e.ok ? '' : 'warn'}`}>{KIND_LABEL[e.kind] ?? e.kind}</span>
              <Icon name={e.direction === 'in' ? 'down' : 'arrowUp'} size={12} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis">{e.title}</div>
                {e.detail ? <div className="small muted ellipsis mono">{e.detail}</div> : null}
              </div>
              <span className="small muted">{relativeTime(e.at)}</span>
            </div>
          ))}
        </div>
      ) : <div className="small muted" style={{ marginTop: 8 }}>Nothing yet.</div>}
    </div>
  );
}
