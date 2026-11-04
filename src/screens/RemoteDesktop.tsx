// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktops: your other computers by any protocol. Saved connections in
// folders with tags, colours and favourites; a quick-connect bar; several open
// at once, each in its own Keeper tab (VNC, Remote Desktop and web consoles drawn
// here, SSH and friends in terminal tabs); Wake-on-LAN; import and
// export; this computer's own remote desktop server; and the programs Keeper
// can use.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LinkDevice } from '../../core/api-link';
import type { RdcState } from '../../core/rdc/api';
import type { EngineInfo } from '../../core/rdc/engines';
import type { Format } from '../../core/rdc/formats';
import type { HostStatus } from '../../core/rdc/hosting';
import type { RdcPlaces, TrayEntry } from '../../core/rdc/places';
import { COLORS, filterConnections, foldersOf, sortConnections, tagsOf } from '../../core/rdc/list';
import { defaultPort, PROTOCOLS, type ConnectResult, type Connection, type Gateway, type Online, type PortForward, type Protocol, type RdcSession } from '../../core/rdc/types';
import { toUri } from '../../core/rdc/uri';
import { relativeTime } from '../../core/format';
import { api, isDemo } from '../api';
import { Icon } from '../components/Icon';
import { useFeature } from '../features';
import { ContextMenu, Empty, Modal, PageHead, Toggle, type MenuItem } from '../components/ui';
import { useStore } from '../state';
import { VncView, WebConsole } from './RemoteDesktopSession';
import { RdpView } from './RemoteDesktopRdp';
import { splitUser, tabLimits } from '../../core/rdc/rdp-tab';
import '../styles/rdc.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const SHORT: Record<Protocol, string> = { rdp: 'RDP', vnc: 'VNC', ssh: 'SSH', mosh: 'Mosh', telnet: 'Telnet', serial: 'Serial', spice: 'SPICE', x2go: 'X2Go', winrm: 'PowerShell', web: 'Web', keeper: 'Keeper' };

export function RemoteDesktops() {
  const { route } = useStore();
  if (route.arg === 'vnc' && route.q) return <VncView sid={route.q} />;
  if (route.arg === 'rdp' && route.q) return <RdpView key={route.q} sid={route.q} />;
  if (route.arg === 'web' && route.q) return <WebConsole sid={route.q} />;
  return <RdcPage />;
}

function useRdc(): [RdcState | null, () => void] {
  const [s, setS] = useState<RdcState | null>(null);
  const load = useCallback(() => void api.rdc.state().then(setS).catch(() => undefined), []);
  useEffect(() => {
    load();
    return api.on('rdc-changed', load);
  }, [load]);
  return [s, load];
}

/** Status dots: Keeper knocks on each computer only while this page is open. */
function useStatus(): Record<string, Online> {
  const [st, setSt] = useState<Record<string, Online>>({});
  useEffect(() => {
    void api.rdc.watch(true).then((s) => setSt(s ?? {})).catch(() => undefined);
    const off = api.on('rdc-status', setSt);
    return () => { off(); void api.rdc.watch(false).catch(() => undefined); };
  }, []);
  return st;
}

type Opts = { password?: string; user?: string; external?: boolean; trustKey?: string; trustCert?: string; background?: boolean };
type Ask =
  | { kind: 'password'; conn: Connection; o: Opts; again?: boolean; needUser?: boolean }
  | { kind: 'hostkey'; conn: Connection; key: NonNullable<ConnectResult['hostKey']>; o: Opts }
  | { kind: 'cert'; conn: Connection; cert: NonNullable<ConnectResult['cert']>; o: Opts };

/** Opening connections, with the questions that can come up on the way (password, a new host key). */
function useOpener(s: RdcState | null, reload: () => void) {
  const { tabs, toast } = useStore();
  const [ask, setAsk] = useState<Ask | null>(null);
  const open = useCallback(async (conn: Connection, o: Opts = {}) => {
    if (isDemo) { toast(`${conn.name}: connections do not open in the demo`); return; }
    try {
      const r = await api.rdc.connect(conn.id.startsWith('tmp-') ? conn : conn.id, { password: o.password, user: o.user, external: o.external, trustKey: o.trustKey, trustCert: o.trustCert });
      if (r.hostKey) { setAsk({ kind: 'hostkey', conn, key: r.hostKey, o }); return; }
      if (r.cert) { setAsk({ kind: 'cert', conn, cert: r.cert, o }); return; }
      if (r.needPassword) { setAsk({ kind: 'password', conn, o, needUser: r.needUser, again: o.password !== undefined && !r.needUser }); return; }
      if (r.session?.state === 'error') { toast(`${conn.name}: ${r.session.error ?? 'did not connect'}`); return; }
      if (r.route) {
        if ((await api.rdc.places().catch(() => null))?.sessions === 'window') await api.rdc.openRoute(r.route);
        else tabs.open(r.route as never, { background: o.background });
      }
      if (r.message) toast(r.message);
      else if (r.session?.kind === 'external') toast(`${conn.name} opened in ${r.session.program ?? 'its own window'}`);
    } catch (e) {
      toast(`${conn.name}: ${clean(e)}`);
    } finally {
      reload();
    }
  }, [tabs, toast, reload]);
  const dialog = ask ? (
    ask.kind === 'password' ? (
      <PasswordDialog conn={ask.conn} again={!!ask.again} needUser={!!ask.needUser} keychain={!!s?.keychain} onClose={() => setAsk(null)} onDone={async (pw, remember, user) => {
        setAsk(null);
        if (!ask.conn.id.startsWith('tmp-')) {
          // A name typed here is kept with the connection; a password only when asked to.
          const su = user ? splitUser(user) : null;
          if (su && su.user !== ask.conn.user) await api.rdc.save({ ...ask.conn, user: su.user, domain: su.domain ?? ask.conn.domain }).catch(() => undefined);
          if (remember) await api.rdc.setPassword(ask.conn.id, pw).catch(() => false);
        }
        void open(ask.conn, { ...ask.o, password: pw, user: user || ask.o.user });
      }} />
    ) : ask.kind === 'cert' ? (
      <Modal title={ask.cert.changed ? 'This computer’s certificate changed' : `First connection to ${ask.cert.host ?? ask.conn.host}`} onClose={() => setAsk(null)} width={560}>
        <div className="col rdc-certq" style={{ gap: 10 }} data-testid="rdc-certq">
          {ask.cert.changed
            ? <div className="rdc-warn"><Icon name="warning" size={16} /> It shows a different certificate from the one you trusted. Windows renews its own every few months; if nobody did that, someone may be pretending to be it.</div>
            : <div className="small muted">Compare it with the computer’s own. On Windows: <code>Get-ChildItem 'Cert:\LocalMachine\Remote Desktop'</code> shows its thumbprint (SHA-1).</div>}
          <div className="rdc-fp mono" data-testid="rdc-cert-fingerprint">
            {ask.cert.subject ? <><b>Name</b><span>{ask.cert.subject}</span></> : null}
            <b>SHA-1</b><span>{ask.cert.sha1}</span>
            <b>SHA-256</b><span>{ask.cert.sha256}</span>
          </div>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setAsk(null)}>Cancel</button>
            <button className="btn primary" onClick={() => { const a = ask; setAsk(null); void open(a.conn, { ...a.o, trustCert: a.cert.fingerprint }); }}>{ask.cert.changed ? 'Trust the New One' : 'Trust and Connect'}</button>
          </div>
        </div>
      </Modal>
    ) : (
      <Modal title={ask.key.changed ? 'This computer’s key changed' : `First connection to ${ask.key.host}`} onClose={() => setAsk(null)} width={520}>
        <div className="col" style={{ gap: 10 }}>
          {ask.key.changed
            ? <div className="rdc-warn"><Icon name="warning" size={16} /> The key {ask.key.host} shows now is not the one recorded before. Someone may be pretending to be it. If the computer was reinstalled, remove its old line from ~/.ssh/known_hosts first.</div>
            : <div className="small muted">Check that this fingerprint matches the one the computer shows (on it: <code>ssh-keygen -lf /etc/ssh/ssh_host_{ask.key.type.replace(/^ssh-|-sha2-nistp\d+$/g, '').replace('ecdsa', 'ecdsa')}_key.pub</code>).</div>}
          <div className="rdc-fp mono" data-testid="rdc-fingerprint">{ask.key.type} {ask.key.fingerprint}</div>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setAsk(null)}>Cancel</button>
            {!ask.key.changed ? <button className="btn primary" onClick={() => { const a = ask; setAsk(null); void open(a.conn, { ...a.o, trustKey: a.key.fingerprint }); }}>Trust and Connect</button> : null}
          </div>
        </div>
      </Modal>
    )
  ) : null;
  return { open, dialog, askPassword: (conn: Connection, external?: boolean) => setAsk({ kind: 'password', conn, o: { external } }) };
}

function PasswordDialog({ conn, again, needUser, keychain, onClose, onDone }: { conn: Connection; again: boolean; needUser?: boolean; keychain: boolean; onClose: () => void; onDone: (pw: string, remember: boolean, user?: string) => void }) {
  const [pw, setPw] = useState('');
  const [user, setUser] = useState(conn.user ?? '');
  const [remember, setRemember] = useState(false);
  const saved = !conn.id.startsWith('tmp-');
  return (
    <Modal title={`Sign in to ${conn.name}`} onClose={onClose} width={420}>
      <form className="col" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (needUser && !user.trim()) return; onDone(pw, remember, needUser ? user.trim() : undefined); }}>
        {again ? <div className="rdc-warn small"><Icon name="warning" size={14} /> That did not work. Try again.</div> : null}
        {needUser ? <label className="col small">User name<input className="input" autoFocus value={user} placeholder={conn.domain ? `${conn.domain}\\name or name` : 'name, or DOMAIN\\name'} onChange={(e) => setUser(e.target.value)} data-testid="rdc-user" /></label> : null}
        <label className="col small">Password{conn.user && !needUser ? ` for ${conn.user}` : ''}<input className="input" type="password" autoFocus={!needUser} value={pw} onChange={(e) => setPw(e.target.value)} data-testid="rdc-password" /></label>
        {saved && keychain && !conn.askEveryTime ? <label className="row small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember it in the system keychain</label> : null}
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Connect</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- the page

function RdcPage() {
  const { route, go, toast } = useStore();
  const [s, reload] = useRdc();
  const tab = route.arg === 'host' ? 'host' : route.arg === 'programs' ? 'programs' : route.arg === 'places' ? 'places' : 'list';
  return (
    <div className="rdc-page">
      <PageHead title="Remote Desktops" sub="Your other computers, by Remote Desktop, VNC, SSH or anything else. Open several at once: each one opens in its own tab.">
        {tab === 'list' ? <ImportExport s={s} reload={reload} toast={toast} /> : null}
      </PageHead>
      <div className="seg rdc-tabs">
        <button className={tab === 'list' ? 'on' : ''} onClick={() => go({ name: 'rdc' })}>Connections</button>
        <button className={tab === 'host' ? 'on' : ''} onClick={() => go({ name: 'rdc', arg: 'host' })}>This computer</button>
        <button className={tab === 'places' ? 'on' : ''} onClick={() => go({ name: 'rdc', arg: 'places' })}>Where it appears</button>
        <button className={tab === 'programs' ? 'on' : ''} onClick={() => go({ name: 'rdc', arg: 'programs' })}>Programs</button>
      </div>
      {!s ? <div className="spinner" /> : tab === 'list' ? <Connections s={s} reload={reload} /> : tab === 'host' ? <HostPanel /> : tab === 'places' ? <PlacesPanel /> : <Programs />}
    </div>
  );
}

function ImportExport({ s, reload, toast }: { s: RdcState | null; reload: () => void; toast: (t: string) => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const doImport = async () => {
    try {
      const r = await api.rdc.importFile();
      if (!r) return;
      toast(`Imported ${r.added.length} connection${r.added.length === 1 ? '' : 's'}${r.secrets ? `, ${r.secrets} password${r.secrets === 1 ? '' : 's'} into the keychain` : ''}${r.skipped ? ` (${r.skipped} already here)` : ''}`);
      reload();
    } catch (e) { toast(clean(e)); }
  };
  const doExport = async (f: Format) => {
    try {
      const p = await api.rdc.exportTo([], f);
      if (p) toast(`Saved ${p}`);
    } catch (e) { toast(clean(e)); }
  };
  return (
    <>
      <button className="btn" onClick={() => void doImport()} title="Import .rdp, .vnc, ~/.ssh/config or Keeper JSON"><Icon name="down" size={14} /> Import</button>
      <button className="btn" disabled={!s?.connections.length} onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}><Icon name="share" size={14} /> Export</button>
      {menu ? <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
        { label: 'All, as Keeper JSON', icon: 'document', run: () => void doExport('json') },
        { label: 'SSH ones, as ssh config', icon: 'terminal', run: () => void doExport('ssh') },
      ]} /> : null}
    </>
  );
}

const blank = (protocol: Protocol = 'rdp'): Connection => ({ id: '', name: '', protocol, host: '', created: 0 });

function Connections({ s, reload }: { s: RdcState; reload: () => void }) {
  const { toast, tabs } = useStore();
  const status = useStatus();
  const { open, dialog } = useOpener(s, reload);
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [favs, setFavs] = useState(false);
  const [edit, setEdit] = useState<Connection | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [devices, setDevices] = useState<LinkDevice[]>([]);
  useEffect(() => { void api.link?.state().then((l) => setDevices(l.devices.filter((d) => d.os !== 'ios' && d.os !== 'android'))).catch(() => undefined); }, []);
  const list = useMemo(() => sortConnections(filterConnections(s.connections, { q, folder, tag, favourites: favs })), [s.connections, q, folder, tag, favs]);
  const folders = useMemo(() => foldersOf(s.connections), [s.connections]);
  const tags = useMemo(() => tagsOf(s.connections), [s.connections]);
  const live = s.sessions.filter((x) => x.state === 'connecting' || x.state === 'connected');
  // Arrived from the tray, the palette, the quick-connect window or a .rdp/.vnc file: connect (or edit) it here.
  const { route } = useStore();
  const handled = useRef('');
  useEffect(() => {
    const q = route.q ?? '';
    if (!q || handled.current === q) return;
    const m = /^(connect|edit):(.+)$/.exec(q);
    const c = m && s.connections.find((x) => x.id === m[2]);
    if (!m || !c) return;
    handled.current = q;
    if (m[1] === 'edit') setEdit(c);
    else void open(c);
  }, [route.q, s.connections, open]);

  const openMany = async () => {
    const chosen = s.connections.filter((c) => picked.has(c.id));
    // Each in its own tab; the last one comes to the front.
    for (let i = 0; i < chosen.length; i++) await open(chosen[i], { background: i < chosen.length - 1 });
    setPicked(new Set());
  };

  const cardMenu = (c: Connection, x: number, y: number) => setMenu({ x, y, items: [
    { label: 'Connect', icon: 'play', run: () => void open(c) },
    ...(c.protocol === 'vnc' ? [{ label: 'Open in an Outside Viewer', icon: 'external', run: () => void open(c, { external: true }) }] : []),
    ...(c.protocol === 'rdp' ? [{ label: 'Open in the Outside App', icon: 'external', run: () => void open(c, { external: true }) }] : []),
    { label: 'Edit…', icon: 'rename', run: () => setEdit(c) },
    { label: 'Duplicate', icon: 'copy', run: () => void api.rdc.duplicate(c.id).then(reload) },
    { label: c.favourite ? 'Remove from Favourites' : 'Add to Favourites', icon: 'star', run: () => void api.rdc.save({ ...c, favourite: !c.favourite }).then(reload) },
    ...(c.mac ? [{ label: 'Wake Up', icon: 'power', run: () => void api.rdc.wake(c.id).then((r) => toast(`Sent the wake-up signal (${r.sent} packets)`)).catch((e) => toast(clean(e))) }] : []),
    { label: 'Copy Link', icon: 'link', run: () => void api.files.copyText(toUri(c)).then(() => toast('Copied')) },
    { label: 'Copy Command', icon: 'terminal', run: () => void api.rdc.command(c.id).then((r) => { if ('error' in r) toast(r.error); else void api.files.copyText([r.file, ...r.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')).then(() => toast('Copied the command (no password in it)')); }) },
    ...(c.protocol === 'rdp' || c.protocol === 'vnc' ? [{ label: `Export as .${c.protocol}`, icon: 'share', run: () => void api.rdc.exportTo([c.id], c.protocol as Format).then((p) => p && toast(`Saved ${p}`)) }] : []),
    { sep: true, label: '' },
    { label: 'Delete', icon: 'trash', danger: true, run: () => { if (confirm(`Delete “${c.name}”? Its saved password goes too.`)) void api.rdc.remove([c.id]).then(reload); } },
  ] });

  return (
    <div className="col" style={{ gap: 14 }}>
      <QuickConnect onOpen={(c) => void open(c)} onSave={(c) => setEdit({ ...c, id: '' })} />

      {live.length ? (
        <div className="card pad rdc-live">
          <div className="small muted" style={{ marginBottom: 6 }}>Open now</div>
          {live.map((x) => <SessionRow key={x.id} x={x} onShow={() => tabs.open(x.kind === 'terminal' ? { name: 'terminal', q: `session:${x.terminal}` } : { name: 'rdc', arg: x.kind === 'web' ? 'web' : x.protocol === 'rdp' ? 'rdp' : 'vnc', q: x.id })} onClose={() => void api.rdc.disconnect(x.id).then(reload)} />)}
        </div>
      ) : null}

      <div className="rdc-toolbar">
        <div className="searchbox rdc-search"><Icon name="search" size={14} /><input placeholder="Search connections" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input" value={folder ?? ''} onChange={(e) => setFolder(e.target.value || undefined)} title="Folder">
          <option value="">All folders</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button className={`btn ${favs ? 'primary' : ''}`} onClick={() => setFavs(!favs)} title="Favourites only" aria-label="Favourites only"><Icon name="star" size={14} /></button>
        <div className="grow" />
        {picked.size ? <button className="btn primary" onClick={() => void openMany()}>Open {picked.size} in Tabs</button> : null}
        <button className="btn primary" onClick={() => setEdit(blank())} data-testid="rdc-new"><Icon name="plus" size={14} /> New Connection</button>
      </div>
      {tags.length ? (
        <div className="rdc-tags">
          {tags.map((t) => <button key={t} className={`chip sm ${tag === t ? 'on' : ''}`} onClick={() => setTag(tag === t ? undefined : t)}>#{t}</button>)}
        </div>
      ) : null}

      {!s.connections.length ? (
        <Empty icon="laptop" title="No saved connections yet">
          Type an address above to connect now, press New Connection, or Import your .rdp files, .vnc files or ~/.ssh/config.
        </Empty>
      ) : !list.length ? <Empty icon="search" title="Nothing matches" /> : (
        <div className="rdc-grid">
          {list.map((c) => (
            <div key={c.id} className={`card rdc-card ${picked.has(c.id) ? 'picked' : ''}`} data-testid="rdc-card" onDoubleClick={() => void open(c)} onContextMenu={(e) => { e.preventDefault(); cardMenu(c, e.clientX, e.clientY); }} style={{ ['--rdc-color' as string]: c.color ?? 'var(--line)' }}>
              <div className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(c.id); else n.delete(c.id); setPicked(n); }} title="Pick to open several at once" />
                <span className={`rdc-dot ${status[c.id] ?? 'unknown'}`} title={status[c.id] === 'online' ? 'Answers now' : status[c.id] === 'offline' ? 'Does not answer' : 'Not checked'} />
                <b className="grow ellipsis" title={c.name}>{c.name}</b>
                {c.favourite ? <Icon name="star" size={13} /> : null}
                <span className={`badge rdc-proto ${c.protocol}`}>{SHORT[c.protocol]}</span>
              </div>
              <div className="small muted ellipsis mono">{c.protocol === 'web' ? (c.web?.url ?? c.host) : `${c.user ? `${c.user}@` : ''}${c.host}${c.port && c.port !== defaultPort(c.protocol) ? `:${c.port}` : ''}`}</div>
              <div className="row small muted" style={{ gap: 6, flexWrap: 'wrap', minHeight: 18 }}>
                {c.folder ? <span><Icon name="folder" size={11} /> {c.folder}</span> : null}
                {c.gateway && c.gateway.kind !== 'none' ? <span className="badge">{gatewayLabel(c.gateway, devices)}</span> : null}
                {(c.tags ?? []).map((t) => <span key={t} className="chip sm">#{t}</span>)}
                {c.lastUsed ? <span className="grow" style={{ textAlign: 'right' }}>{relativeTime(c.lastUsed)}</span> : null}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm primary" onClick={() => void open(c)} data-testid="rdc-connect">Connect</button>
                {c.mac ? <button className="btn sm ghost" title="Wake it up (Wake-on-LAN)" aria-label="Wake it up (Wake-on-LAN)" onClick={() => void api.rdc.wake(c.id).then((r) => toast(`Sent the wake-up signal (${r.sent} packets)`)).catch((e) => toast(clean(e)))}><Icon name="power" size={13} /></button> : null}
                <div className="grow" />
                <button className="btn sm ghost icon" title="Edit" aria-label="Edit" onClick={() => setEdit(c)}><Icon name="rename" size={13} /></button>
                <button className="btn sm ghost icon" title="More" aria-label="More" onClick={(e) => cardMenu(c, e.clientX, e.clientY)}><Icon name="chevronDown" size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {devices.length ? (
        <div className="col" style={{ gap: 8 }}>
          <h3 style={{ margin: '6px 0 0' }}>Keeper devices</h3>
          <div className="small muted">Your paired computers: see and control their screens through Keeper, with nothing else to install.</div>
          <div className="rdc-grid">
            {devices.map((d) => (
              <div key={d.id} className="card rdc-card" data-testid="rdc-device">
                <div className="row" style={{ gap: 8 }}>
                  <span className={`rdc-dot ${d.online ? 'online' : 'offline'}`} />
                  <b className="grow ellipsis">{d.name}</b>
                  <span className="badge rdc-proto keeper">Keeper</span>
                </div>
                <div className="small muted">{d.online ? 'Reachable now' : 'Not reachable'}</div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm primary" disabled={!d.online} onClick={() => void api.screen.view(d.id, { control: true }).catch((e) => toast(clean(e)))}>Connect</button>
                  <button className="btn sm ghost" title="Wake it up" aria-label="Wake it up" onClick={() => void api.screen.wake(d.id).then((r) => toast(r.sent ? 'Sent the wake-up signal' : 'Keeper does not know its network card yet')).catch((e) => toast(clean(e)))}><Icon name="power" size={13} /></button>
                  <button className="btn sm ghost" title="Add a Remote Desktop or VNC connection that goes through this device" onClick={() => setEdit({ ...blank('rdp'), name: d.name, host: 'localhost', gateway: { kind: 'link', device: d.id } })}>Add RDP/VNC via Link</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      {edit ? <Editor conn={edit} s={s} devices={devices} onClose={() => setEdit(null)} onSaved={(c, connect) => { setEdit(null); reload(); if (connect) void open(c); }} /> : null}
      {dialog}
    </div>
  );
}

function gatewayLabel(g: Gateway, devices: LinkDevice[]): string {
  if (g.kind === 'link') return `via ${devices.find((d) => d.id === g.device)?.name ?? 'Keeper Link'}`;
  if (g.kind === 'ssh') return `via SSH ${g.host}`;
  if (g.kind === 'proxy') return `via ${g.type === 'http' ? 'HTTP' : 'SOCKS'} proxy`;
  if (g.kind === 'mesh') return 'via mesh';
  return '';
}

function SessionRow({ x, onShow, onClose }: { x: RdcSession; onShow: () => void; onClose: () => void }) {
  return (
    <div className="row rdc-session" data-testid="rdc-session">
      <span className={`rdc-dot ${x.state === 'connected' ? 'online' : 'unknown'}`} />
      <b className="ellipsis">{x.name}</b>
      <span className="badge">{SHORT[x.protocol]}</span>
      <span className="small muted grow ellipsis">{x.kind === 'external' ? `in ${x.program ?? 'its own window'}` : x.kind === 'terminal' ? 'in a terminal tab' : x.width ? `${x.width}×${x.height}` : ''}{x.via ? ` · ${x.via}` : ''}</span>
      {x.kind !== 'external' ? <button className="btn sm" onClick={onShow}>Show</button> : null}
      <button className="btn sm ghost" onClick={onClose}>Disconnect</button>
    </div>
  );
}

function QuickConnect({ onOpen, onSave }: { onOpen: (c: Connection) => void; onSave: (c: Connection) => void }) {
  const { toast } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Connection | null>(null);
  const go = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setFound(null);
    try {
      const r = await api.rdc.quick(text);
      if (!r.conn) { toast(r.message ?? 'Keeper could not tell how to connect'); return; }
      setFound(r.conn);
      onOpen(r.conn);
    } catch (e) { toast(clean(e)); } finally { setBusy(false); }
  };
  return (
    <form className="card pad rdc-quick" onSubmit={(e) => { e.preventDefault(); void go(); }}>
      <Icon name="bolt" size={16} />
      <input className="input grow" placeholder="rdp://host, vnc://host:5901, ssh user@host or a name" value={text} onChange={(e) => setText(e.target.value)} data-testid="rdc-quick" spellCheck={false} />
      <button className="btn primary" disabled={busy || !text.trim()}>{busy ? 'Looking…' : 'Connect'}</button>
      {found ? <button type="button" className="btn ghost" onClick={() => onSave(found)} title="Save it to the list">Save</button> : null}
    </form>
  );
}

// ---------------------------------------------------------------- the editor

const fwdText = (f: PortForward[] = []) => f.map((x) => (x.kind === 'D' ? `D ${x.bind ? `${x.bind}:` : ''}${x.listen}` : `${x.kind} ${x.bind ? `${x.bind}:` : ''}${x.listen}:${x.host}:${x.port}`)).join('\n');
function parseFwd(t: string): PortForward[] {
  const out: PortForward[] = [];
  for (const line of t.split('\n')) {
    const m = /^\s*([LRD])\s+(?:([\w.-]+):)?(\d+)(?::([\w.:[\]-]+):(\d+))?\s*$/i.exec(line);
    if (!m) continue;
    const kind = m[1].toUpperCase() as PortForward['kind'];
    if (kind !== 'D' && !m[4]) continue;
    out.push({ kind, bind: m[2], listen: Number(m[3]), host: m[4]?.replace(/^\[|\]$/g, ''), port: m[5] ? Number(m[5]) : undefined });
  }
  return out;
}

function Editor({ conn, s, devices, onClose, onSaved }: { conn: Connection; s: RdcState; devices: LinkDevice[]; onClose: () => void; onSaved: (c: Connection, connect: boolean) => void }) {
  const { toast } = useStore();
  const [c, setC] = useState<Connection>(structuredClone(conn));
  const [pw, setPw] = useState('');
  const [fwd, setFwd] = useState(fwdText(conn.ssh?.forwards));
  const [cmd, setCmd] = useState<string | null>(null);
  const set = (p: Partial<Connection>) => setC((x) => ({ ...x, ...p }));
  const p = c.protocol;
  const g = c.gateway ?? { kind: 'none' };
  const save = async (connect: boolean) => {
    if (!c.host.trim()) { toast(p === 'serial' ? 'Enter the serial device (/dev/ttyUSB0, COM3)' : 'Enter a computer name or address'); return; }
    try {
      const out = await api.rdc.save({ ...c, id: c.id || undefined, name: c.name.trim() || c.host.trim(), host: c.host.trim(), ssh: p === 'ssh' || p === 'mosh' ? { ...c.ssh, forwards: parseFwd(fwd) } : c.ssh } as never);
      if (pw) {
        const ok = await api.rdc.setPassword(out.id, pw);
        if (!ok) toast('There is no system keychain here, so Keeper will ask for the password each time');
      }
      onSaved(out, connect);
    } catch (e) { toast(clean(e)); }
  };
  const showCmd = async () => {
    const r = await api.rdc.command({ ...c, id: c.id || 'tmp-preview' });
    setCmd('error' in r ? r.error : `${[r.file, ...r.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}${r.stdin ? '\n(the password goes to its input, not the command line)' : ''}${r.note ? `\n${r.note}` : ''}`);
  };
  const external = ['rdp', 'spice', 'x2go'].includes(p) || (p === 'vnc' && c.vnc?.external);
  const limits = p === 'rdp' ? tabLimits(c) : [];
  return (
    <Modal title={conn.id ? `Edit ${conn.name}` : 'New connection'} onClose={onClose} width={640}>
      <div className="rdc-form">
        <label>Name<input className="input" value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="Office PC" data-testid="rdc-name" /></label>
        <label>Protocol
          <select className="input" value={p} onChange={(e) => set({ protocol: e.target.value as Protocol, port: undefined })} data-testid="rdc-protocol">
            {PROTOCOLS.filter((x) => x.id !== 'keeper').map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <label className="wide">{p === 'serial' ? 'Serial device' : p === 'web' ? 'Address (host)' : 'Computer'}<input className="input mono" value={c.host} onChange={(e) => set({ host: e.target.value })} placeholder={p === 'serial' ? '/dev/ttyUSB0 or COM3' : 'office-pc.local or 192.168.1.20'} data-testid="rdc-host" /></label>
        {p !== 'serial' ? <label>Port<input className="input mono" inputMode="numeric" value={c.port ?? ''} placeholder={String(defaultPort(p) ?? '')} onChange={(e) => set({ port: e.target.value ? Number(e.target.value) || undefined : undefined })} /></label> : null}
        {p !== 'serial' && p !== 'web' && p !== 'telnet' ? <label>User<input className="input" value={c.user ?? ''} onChange={(e) => set({ user: e.target.value || undefined })} /></label> : null}
        {p === 'rdp' || p === 'winrm' ? <label>Domain<input className="input" value={c.domain ?? ''} onChange={(e) => set({ domain: e.target.value || undefined })} /></label> : null}

        {p === 'serial' ? (
          <>
            <label>Speed (baud)<select className="input" value={c.serial?.baud ?? 9600} onChange={(e) => set({ serial: { ...(c.serial ?? { baud: 9600 }), baud: Number(e.target.value) } })}>{[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
            <label>Parity<select className="input" value={c.serial?.parity ?? 'none'} onChange={(e) => set({ serial: { ...(c.serial ?? { baud: 9600 }), parity: e.target.value as 'none' } })}><option value="none">None</option><option value="even">Even</option><option value="odd">Odd</option></select></label>
          </>
        ) : null}
        {p === 'web' ? (
          <>
            <label className="wide">Page<input className="input mono" value={c.web?.url ?? ''} placeholder={`https://${c.host || 'idrac.local'}/`} onChange={(e) => set({ web: { ...c.web, url: e.target.value || undefined } })} /></label>
            <label className="wide">Trusted certificate (fingerprint)<input className="input mono" value={c.web?.pin ?? ''} placeholder="Filled in when you trust its certificate" onChange={(e) => set({ web: { ...c.web, pin: e.target.value || undefined } })} /></label>
          </>
        ) : null}

        {p !== 'serial' && p !== 'web' && p !== 'telnet' ? (
          <div className="wide rdc-sub">
            <div className="small muted">Sign-in</div>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {p === 'ssh' || p === 'mosh' ? (
                <select className="input" value={c.auth ?? 'agent'} onChange={(e) => set({ auth: e.target.value as Connection['auth'] })}>
                  <option value="agent">SSH agent or default keys</option>
                  <option value="key">A key file</option>
                  <option value="password">Password</option>
                  <option value="interactive">Questions from the server</option>
                </select>
              ) : null}
              {(p === 'ssh' || p === 'mosh' || p === 'x2go') && c.auth === 'key' ? <input className="input mono grow" value={c.keyFile ?? ''} placeholder="~/.ssh/id_ed25519" onChange={(e) => set({ keyFile: e.target.value || undefined })} /> : null}
              {p !== 'winrm' && (!(p === 'ssh' || p === 'mosh') || c.auth === 'password' || c.auth === 'interactive') ? (
                <>
                  <input className="input grow" type="password" value={pw} disabled={c.askEveryTime} placeholder={c.hasPassword ? 'Stored in the keychain (type to change)' : s.keychain ? 'Password (kept in the system keychain)' : 'No keychain here: asked each time'} onChange={(e) => setPw(e.target.value)} />
                  <label className="row small"><input type="checkbox" checked={!!c.askEveryTime} onChange={(e) => set({ askEveryTime: e.target.checked })} /> Ask every time</label>
                  {c.hasPassword && c.id ? <button className="btn sm ghost" onClick={() => void api.rdc.setPassword(c.id, null).then(() => { set({ hasPassword: false }); toast('Forgot the password'); })}>Forget</button> : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {p !== 'serial' && p !== 'web' ? (
          <div className="wide rdc-sub">
            <div className="small muted">Reach it</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <select className="input" value={g.kind} onChange={(e) => {
                const k = e.target.value as Gateway['kind'];
                set({ gateway: k === 'none' ? undefined : k === 'ssh' ? { kind: 'ssh', host: '' } : k === 'proxy' ? { kind: 'proxy', type: 'socks5', host: '', port: 1080 } : k === 'link' ? { kind: 'link', device: devices[0]?.id ?? '' } : { kind: 'mesh', address: '' } });
              }} data-testid="rdc-gateway">
                <option value="none">Directly</option>
                <option value="ssh">{p === 'ssh' || p === 'mosh' ? 'Through a jump host (SSH)' : 'Through an SSH tunnel'}</option>
                <option value="proxy">Through an HTTP or SOCKS proxy</option>
                <option value="link">Through Keeper Link (a paired device)</option>
                <option value="mesh">Over the mesh (another address)</option>
              </select>
              {g.kind === 'ssh' ? <><input className="input" placeholder="user" value={g.user ?? ''} onChange={(e) => set({ gateway: { ...g, user: e.target.value || undefined } })} style={{ width: 110 }} /><input className="input mono grow" placeholder="gateway.example.com" value={g.host} onChange={(e) => set({ gateway: { ...g, host: e.target.value } })} /><input className="input mono" style={{ width: 70 }} placeholder="22" value={g.port ?? ''} onChange={(e) => set({ gateway: { ...g, port: Number(e.target.value) || undefined } })} /></> : null}
              {g.kind === 'proxy' ? <><select className="input" value={g.type} onChange={(e) => set({ gateway: { ...g, type: e.target.value as 'http' } })}><option value="socks5">SOCKS5</option><option value="http">HTTP</option></select><input className="input mono grow" placeholder="proxy.example.com" value={g.host} onChange={(e) => set({ gateway: { ...g, host: e.target.value } })} /><input className="input mono" style={{ width: 70 }} value={g.port} onChange={(e) => set({ gateway: { ...g, port: Number(e.target.value) || 1080 } })} /></> : null}
              {g.kind === 'link' ? (devices.length ? <select className="input grow" value={g.device} onChange={(e) => set({ gateway: { kind: 'link', device: e.target.value } })}>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select> : <span className="small muted">Pair a device in Devices first.</span>) : null}
              {g.kind === 'mesh' ? <input className="input mono grow" placeholder="100.64.0.12" value={g.address} onChange={(e) => set({ gateway: { kind: 'mesh', address: e.target.value } })} /> : null}
            </div>
            {g.kind === 'link' ? <div className="small muted">The device opens the connection for you; nothing is opened to the internet. Use <b>localhost</b> to reach the device itself (it must allow “Reach ports on this computer”).</div> : null}
            {p === 'ssh' || p === 'mosh' ? <input className="input mono" style={{ marginTop: 6 }} placeholder="More jump hosts: user@a:22, b" value={(c.jump ?? []).join(', ')} onChange={(e) => set({ jump: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /> : null}
          </div>
        ) : null}

        {p === 'rdp' ? (
          <div className="wide rdc-sub rdc-opts">
            <div className="small muted">Remote Desktop</div>
            <div className="wide row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <span className="small">Opens in</span>
              <div className="seg" role="group" aria-label="Opens in" data-testid="rdc-rdp-where">
                <button type="button" className={c.rdp?.where !== 'outside' ? 'on' : ''} aria-pressed={c.rdp?.where !== 'outside'} onClick={() => set({ rdp: { ...c.rdp, where: undefined } })}>A Keeper tab</button>
                <button type="button" className={c.rdp?.where === 'outside' ? 'on' : ''} aria-pressed={c.rdp?.where === 'outside'} onClick={() => set({ rdp: { ...c.rdp, where: 'outside' } })}>The outside app</button>
              </div>
              {c.rdp?.where !== 'outside' && limits.length ? <span className="small muted" data-testid="rdc-rdp-limits">{limits.join(' ')}</span> : null}
            </div>
            <label className="row small"><input type="checkbox" checked={c.rdp?.fullscreen ?? false} onChange={(e) => set({ rdp: { ...c.rdp, fullscreen: e.target.checked } })} /> Full screen</label>
            <label className="row small"><input type="checkbox" checked={!!c.rdp?.multimon} onChange={(e) => set({ rdp: { ...c.rdp, multimon: e.target.checked } })} /> All monitors</label>
            <label className="row small"><input type="checkbox" checked={!!c.rdp?.dynamicResolution} onChange={(e) => set({ rdp: { ...c.rdp, dynamicResolution: e.target.checked } })} /> Resize with the window</label>
            <label className="row small"><input type="checkbox" checked={c.rdp?.clipboard !== false} onChange={(e) => set({ rdp: { ...c.rdp, clipboard: e.target.checked } })} /> Shared clipboard</label>
            <label className="row small"><input type="checkbox" checked={!!c.rdp?.drives} onChange={(e) => set({ rdp: { ...c.rdp, drives: e.target.checked } })} /> Share my home folder</label>
            <label className="row small"><input type="checkbox" checked={c.rdp?.nla !== false} onChange={(e) => set({ rdp: { ...c.rdp, nla: e.target.checked } })} /> Network Level Authentication</label>
            <label className="row small"><input type="checkbox" checked={!!c.rdp?.admin} onChange={(e) => set({ rdp: { ...c.rdp, admin: e.target.checked } })} /> Admin (console) session</label>
            <label className="row small"><input type="checkbox" checked={!!c.rdp?.ignoreCert} onChange={(e) => set({ rdp: { ...c.rdp, ignoreCert: e.target.checked } })} /> Accept any certificate</label>
            <label className="small">Size<select className="input" value={c.rdp?.width ? `${c.rdp.width}x${c.rdp.height}` : ''} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); set({ rdp: { ...c.rdp, width: w || undefined, height: h || undefined } }); }}><option value="">Automatic</option>{['1280x720', '1366x768', '1600x900', '1920x1080', '2560x1440'].map((x) => <option key={x} value={x}>{x.replace('x', '×')}</option>)}</select></label>
            <label className="small">Sound<select className="input" value={c.rdp?.audio ?? 'local'} onChange={(e) => set({ rdp: { ...c.rdp, audio: e.target.value as 'local' } })}><option value="local">On this computer</option><option value="remote">On the remote one</option><option value="off">Off</option></select></label>
            <label className="small">Keys in a tab<select className="input" value={c.rdp?.keyboard ?? 'keys'} onChange={(e) => set({ rdp: { ...c.rdp, keyboard: e.target.value === 'letters' ? 'letters' : undefined } })}><option value="keys">The remote keyboard layout</option><option value="letters">Letters as typed here</option></select></label>
            <label className="small wide">Remote Desktop Gateway<input className="input mono" placeholder="rdg.example.com" value={c.rdp?.gateway ?? ''} onChange={(e) => set({ rdp: { ...c.rdp, gateway: e.target.value || undefined } })} /></label>
            {c.rdp?.pin ? <div className="small wide row" style={{ gap: 8 }}><span className="muted">Trusted certificate</span><code className="ellipsis grow">{c.rdp.pin}</code><button type="button" className="btn sm ghost" onClick={() => set({ rdp: { ...c.rdp, pin: undefined } })}>Forget</button></div> : null}
          </div>
        ) : null}
        {p === 'vnc' ? (
          <div className="wide rdc-sub rdc-opts">
            <div className="small muted">VNC</div>
            <label className="row small"><input type="checkbox" checked={!!c.vnc?.viewOnly} onChange={(e) => set({ vnc: { ...c.vnc, viewOnly: e.target.checked } })} /> View only</label>
            <label className="row small"><input type="checkbox" checked={c.vnc?.scale !== 'none'} onChange={(e) => set({ vnc: { ...c.vnc, scale: e.target.checked ? 'fit' : 'none' } })} /> Fit to the tab</label>
            <label className="row small"><input type="checkbox" checked={c.vnc?.shared !== false} onChange={(e) => set({ vnc: { ...c.vnc, shared: e.target.checked } })} /> Let others stay connected</label>
            <label className="row small"><input type="checkbox" checked={!!c.vnc?.external} onChange={(e) => set({ vnc: { ...c.vnc, external: e.target.checked } })} /> Open in an outside viewer</label>
          </div>
        ) : null}
        {p === 'ssh' || p === 'mosh' ? (
          <div className="wide rdc-sub rdc-opts">
            <div className="small muted">SSH</div>
            <label className="row small"><input type="checkbox" checked={!!c.ssh?.x11} onChange={(e) => set({ ssh: { ...c.ssh, x11: e.target.checked } })} /> X11 forwarding (show remote windows here)</label>
            <label className="row small"><input type="checkbox" checked={!!c.ssh?.agent} onChange={(e) => set({ ssh: { ...c.ssh, agent: e.target.checked } })} /> Agent forwarding</label>
            <label className="small wide">Port forwards (one per line: L 8080:localhost:80, R 9000:localhost:9000, D 1080)<textarea className="input mono" rows={2} value={fwd} onChange={(e) => setFwd(e.target.value)} /></label>
            <label className="small wide">Run instead of a shell<input className="input mono" value={c.ssh?.command ?? ''} placeholder="htop" onChange={(e) => set({ ssh: { ...c.ssh, command: e.target.value || undefined } })} /></label>
          </div>
        ) : null}
        {p === 'winrm' ? <label className="row small wide"><input type="checkbox" checked={!!c.winrm?.ssl} onChange={(e) => set({ winrm: { ...c.winrm, ssl: e.target.checked } })} /> HTTPS (port 5986)</label> : null}
        {p === 'spice' ? <label className="row small wide"><input type="checkbox" checked={!!c.spice?.tls} onChange={(e) => set({ spice: { tls: e.target.checked } })} /> TLS port</label> : null}
        {p === 'x2go' ? <label className="wide">Desktop<select className="input" value={c.x2go?.command ?? 'XFCE'} onChange={(e) => set({ x2go: { command: e.target.value } })}>{['XFCE', 'MATE', 'LXDE', 'LXQt', 'KDE', 'GNOME', 'CINNAMON'].map((x) => <option key={x}>{x}</option>)}</select></label> : null}

        <div className="wide rdc-sub">
          <div className="small muted">Organise</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 160 }} list="rdc-folders" placeholder="Folder (Home/Lab)" value={c.folder ?? ''} onChange={(e) => set({ folder: e.target.value || undefined })} />
            <datalist id="rdc-folders">{foldersOf(s.connections).map((f) => <option key={f} value={f} />)}</datalist>
            <input className="input grow" placeholder="Tags, with commas" value={(c.tags ?? []).join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            <div className="rdc-colors">{COLORS.map((col) => <button key={col} className={c.color === col ? 'on' : ''} style={{ background: col }} onClick={() => set({ color: c.color === col ? undefined : col })} title="Colour" />)}</div>
            <label className="row small"><input type="checkbox" checked={!!c.favourite} onChange={(e) => set({ favourite: e.target.checked })} /> Favourite</label>
          </div>
          {p !== 'serial' && p !== 'web' ? <input className="input mono" style={{ marginTop: 6 }} placeholder="Network card address for Wake-on-LAN (aa:bb:cc:dd:ee:ff)" value={c.mac ?? ''} onChange={(e) => set({ mac: e.target.value || undefined })} /> : null}
          <textarea className="input" style={{ marginTop: 6 }} rows={2} placeholder="Notes" value={c.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
        </div>
        {cmd ? <pre className="wide rdc-cmd mono" data-testid="rdc-command">{cmd}</pre> : null}
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        {external || ['ssh', 'mosh', 'telnet', 'serial', 'winrm'].includes(p) ? <button className="btn ghost" onClick={() => void showCmd()}>Show Command</button> : null}
        <div className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => void save(false)} data-testid="rdc-save">Save</button>
        <button className="btn primary" onClick={() => void save(true)}>Save and Connect</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- this computer

function HostPanel() {
  const { toast } = useStore();
  const on = useFeature('rdcHosting');
  const [st, setSt] = useState<HostStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [pw, setPw] = useState('');
  const [localOnly, setLocalOnly] = useState(true);
  const [devices, setDevices] = useState<LinkDevice[]>([]);
  const load = useCallback(() => void api.rdc.hostStatus().then(setSt).catch((e) => toast(clean(e))), [toast]);
  useEffect(() => { if (on) load(); }, [on, load]);
  useEffect(() => { void api.link?.state().then((l) => setDevices(l.devices)).catch(() => undefined); }, [st]);
  if (!on) {
    return (
      <div className="card pad col" style={{ gap: 10, maxWidth: 640 }}>
        <h3 style={{ margin: 0 }}>Let others reach this computer</h3>
        <div className="small muted">Turn on this computer’s own Remote Desktop or VNC server, reach it from your other devices through Keeper Link without opening ports to the internet, and check it is set up safely. Off until you want it.</div>
        <div><button className="btn primary" onClick={() => void api.features.set('rdcHosting', true)}>Turn On</button></div>
      </div>
    );
  }
  if (!st) return <div className="spinner" />;
  const run = async (key: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(key);
    try {
      const r = await fn();
      toast(r.message);
    } catch (e) { toast(clean(e)); } finally { setBusy(''); load(); }
  };
  return (
    <div className="col" style={{ gap: 14, maxWidth: 820 }}>
      <div className="card pad col" style={{ gap: 4 }}>
        <h3 style={{ margin: 0 }}>Servers on this computer</h3>
        {!st.items.length ? <div className="small muted">Keeper found no remote desktop server it can switch here. See Programs for x11vnc, wayvnc or GNOME Remote Desktop.</div> : null}
        {st.items.map((i) => (
          <div key={i.id} className="rdc-host-row" data-testid="rdc-host-item">
            <div className="grow col" style={{ gap: 2 }}>
              <b>{i.name} <span className="badge">{i.protocol.toUpperCase()} · port {i.port}</span></b>
              <span className="small muted">{!i.available ? i.reason : i.listening === 'all' ? 'Answers on every network' : i.listening === 'local' ? 'Answers on this computer only' : i.on ? 'On' : 'Off'}{i.needsAdmin ? ' · needs your administrator password' : ''}</span>
              {i.manual && i.on ? <ul className="small muted rdc-steps">{i.manual.map((m) => <li key={m}>{m}</li>)}</ul> : null}
              {(i.id === 'x11vnc' || i.id === 'wayvnc') && i.available && !i.on ? (
                <div className="row" style={{ gap: 8, marginTop: 4 }}>
                  {i.id === 'x11vnc' ? <input className="input" type="password" placeholder="Password (up to 8 characters)" value={pw} maxLength={8} onChange={(e) => setPw(e.target.value)} /> : null}
                  <label className="row small"><input type="checkbox" checked={localOnly} onChange={(e) => setLocalOnly(e.target.checked)} /> This computer only (reach it through Keeper Link)</label>
                </div>
              ) : null}
            </div>
            {i.settingsLink ? <button className="btn sm ghost" onClick={() => void api.system.openExternal(i.settingsLink!)}>Settings</button> : null}
            <Toggle on={!!i.on} onChange={(v) => void run(i.id, () => api.rdc.hostSet(i.id, v, { password: pw || undefined, localOnly }))} />
            {busy === i.id ? <span className="small muted">…</span> : null}
          </div>
        ))}
      </div>

      <div className="card pad col" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Reach it through Keeper Link</h3>
        <div className="small muted">Let a paired device reach this computer’s Remote Desktop and VNC ports through Keeper Link: nothing is opened to the internet, and only devices you pair can use it.</div>
        {!devices.length ? <div className="small muted">Pair a device in Devices first.</div> : devices.map((d) => {
          const allowed = st.viaLink.some((v) => v.device === d.id);
          return (
            <div key={d.id} className="rdc-host-row">
              <b className="grow">{d.name}</b>
              <span className="small muted">{allowed ? 'May reach ports here' : 'Cannot reach ports here'}</span>
              <Toggle on={allowed} onChange={(v) => void run(`link-${d.id}`, () => api.rdc.hostViaLink(d.id, v))} />
            </div>
          );
        })}
      </div>

      <div className="card pad col" style={{ gap: 6 }}>
        <h3 style={{ margin: 0 }}>Safety checklist</h3>
        {st.checks.map((c) => (
          <div key={c.id} className="rdc-check" data-testid="rdc-check">
            <span className={`rdc-check-icon ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'info'}`}><Icon name={c.ok === true ? 'check' : c.ok === false ? 'warning' : 'info'} size={14} /></span>
            <div className="grow col" style={{ gap: 2 }}><b>{c.title}</b><span className="small muted">{c.detail}</span></div>
            {c.fix ? <button className="btn sm" onClick={() => void run(c.id, () => api.rdc.hostFix(c.fix as 'nla'))}>Fix</button> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- programs

function Programs() {
  const { toast } = useStore();
  const [list, setList] = useState<EngineInfo[] | null>(null);
  const load = (refresh = false) => void api.rdc.engines(refresh).then(setList).catch(() => setList([]));
  useEffect(() => load(), []);
  if (!list) return <div className="spinner" />;
  const row = (e: EngineInfo) => (
    <div key={e.id} className="rdc-engine" data-testid="rdc-engine">
      <span style={{ color: e.found ? 'var(--ok)' : 'var(--text-3)' }}>{e.found ? '●' : '○'}</span>
      <div className="grow col" style={{ gap: 2 }}>
        <div><b>{e.name}</b> <span className="small muted">{e.for} · {e.license}</span></div>
        {e.found ? <span className="small muted mono ellipsis">{e.path}</span> : e.hint ? <span className="small mono rdc-hint">{e.hint}</span> : null}
      </div>
      {e.found ? <span className="small muted">installed</span> : e.na ? null : (
        <>
          {e.hint && /^(sudo |brew |winget )/.test(e.hint) ? <button className="btn sm ghost" onClick={() => void api.files.copyText(e.hint!.split('   ')[0]).then(() => toast('Copied'))}>Copy</button> : null}
          <button className="btn sm ghost" onClick={() => void api.system.openExternal(e.url)}>Get it</button>
        </>
      )}
    </div>
  );
  const connect = list.filter((e) => !e.hosting && !e.na);
  const host = list.filter((e) => e.hosting && !e.na);
  return (
    <div className="col" style={{ gap: 14, maxWidth: 860 }}>
      <div className="card pad col" style={{ gap: 4 }}>
        <div className="row"><h3 className="grow" style={{ margin: 0 }}>Programs Keeper can use</h3><button className="btn sm ghost" onClick={() => load(true)}><Icon name="refresh" size={13} /> Look again</button></div>
        <div className="small muted">Keeper shows VNC, Remote Desktop and web consoles itself. For the rest, and when you choose the outside app, it starts one of these free programs.</div>
        {connect.map(row)}
      </div>
      {host.length ? <div className="card pad col" style={{ gap: 4 }}><h3 style={{ margin: 0 }}>For letting others reach this computer</h3>{host.map(row)}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- where it appears

function TrayPreview({ entries }: { entries: TrayEntry[] }) {
  const sub = entries[0] && 'submenu' in entries[0] ? entries[0].submenu ?? [] : [];
  if (!entries.length) return <div className="small muted">Not in the tray menu.</div>;
  return (
    <div className="rdc-tray-preview" data-testid="rdc-tray-preview">
      <div><b>{'label' in entries[0] ? entries[0].label : ''}</b> ▸</div>
      {sub.map((e, i) => ('separator' in e ? <hr key={i} /> : <div key={i} className={e.enabled === false ? 'head' : ''}>{e.label}{e.submenu ? ' ▸' : ''}</div>))}
    </div>
  );
}

function PlacesPanel() {
  const { toast } = useStore();
  const [p, setP] = useState<RdcPlaces | null>(null);
  const [tray, setTray] = useState<TrayEntry[]>([]);
  const [acc, setAcc] = useState('');
  const load = useCallback(() => {
    void api.rdc.places().then((x) => { setP(x); setAcc(x.accelerator); });
    void api.rdc.trayPreview().then(setTray);
  }, []);
  useEffect(load, [load]);
  if (!p) return <div className="spinner" />;
  const set = async (patch: Partial<RdcPlaces>) => {
    try { setP(await api.rdc.setPlaces(patch)); void api.rdc.trayPreview().then(setTray); } catch (e) { toast(clean(e)); }
  };
  const nice = (a: string) => a.replace('CommandOrControl', navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl').replace(/\+/g, ' + ');
  return (
    <div className="col" style={{ gap: 14, maxWidth: 820 }}>
      <div className="card pad col" style={{ gap: 2 }}>
        <h3 style={{ margin: 0 }}>Where Remote Desktops appear</h3>
        <div className="small muted">Reach your computers from anywhere on this one, not only from this page. Switch off what you do not want.</div>
        <div className="rdc-places-row" data-testid="rdc-place-shortcut">
          <div className="grow col" style={{ gap: 2 }}><b>Quick connect from anywhere</b><span className="small muted">A small box opens with {nice(p.accelerator)}: type an address or pick a favourite.</span></div>
          <input className="input mono" style={{ width: 210 }} value={acc} onChange={(e) => setAcc(e.target.value)} onBlur={() => acc !== p.accelerator && void set({ accelerator: acc })} title="For example CommandOrControl+Alt+E" />
          <button className="btn sm" onClick={() => void api.rdc.showQuick()}>Try It</button>
          <Toggle on={p.shortcut} onChange={(v) => void set({ shortcut: v })} />
        </div>
        <div className="rdc-places-row" data-testid="rdc-place-palette">
          <div className="grow col" style={{ gap: 2 }}><b>Command palette</b><span className="small muted">“Quick Connect” and “Connect to …” for each saved connection.</span></div>
          <Toggle on={p.palette} onChange={(v) => void set({ palette: v })} />
        </div>
        <div className="rdc-places-row" data-testid="rdc-place-tray">
          <div className="grow col" style={{ gap: 2 }}><b>Tray menu</b><span className="small muted">Favourites, recent connections and what is open now, with Disconnect.</span></div>
          <Toggle on={p.tray} onChange={(v) => void set({ tray: v })} />
        </div>
        {p.tray ? <TrayPreview entries={tray} /> : null}
        <div className="rdc-places-row" data-testid="rdc-place-files">
          <div className="grow col" style={{ gap: 2 }}><b>.rdp and .vnc files</b><span className="small muted">Double-click opens them in Keeper; “Connect with Keeper” in the file manager’s right-click menu.</span></div>
          <Toggle on={p.files} onChange={(v) => void set({ files: v })} />
        </div>
        <div className="rdc-places-row" data-testid="rdc-place-rdp">
          <div className="grow col" style={{ gap: 2 }}><b>Remote Desktop in a Keeper tab</b><span className="small muted">Keeper downloads its engine once (about 2 MB). Off: the outside app opens.</span></div>
          <Toggle on={p.rdpInTab} onChange={(v) => { void set({ rdpInTab: v }); if (v) void api.components.download('ironrdp').catch(() => undefined); }} />
        </div>
        <div className="rdc-places-row" data-testid="rdc-place-sessions">
          <div className="grow col" style={{ gap: 2 }}><b>Open VNC, Remote Desktop and web consoles</b><span className="small muted">In a Keeper tab, or in a window of their own. A tab can always move to its own window.</span></div>
          <div className="seg">
            <button className={p.sessions === 'tab' ? 'on' : ''} onClick={() => void set({ sessions: 'tab' })}>As tabs</button>
            <button className={p.sessions === 'window' ? 'on' : ''} onClick={() => void set({ sessions: 'window' })}>In their own windows</button>
          </div>
        </div>
      </div>
      <div className="small muted">Terminal connections (SSH, Mosh, Telnet, serial, PowerShell) open as terminal tabs; SPICE, X2Go and Remote Desktop set to the outside app open in their own program’s window.</div>
    </div>
  );
}
