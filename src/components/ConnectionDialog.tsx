// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Add or change a connection: a cloud service (sign in through the browser),
// a server (SFTP, FTP, WebDAV, SMB) or a machine found on the network.

import { useEffect, useMemo, useState } from 'react';
import type { FoundDevice } from '../../core/api-remote';
import { formValues, type FormField, type ProviderInfo } from '../../core/remote/providers';
import type { Connection, ConnectionInput, DeviceKind, RemoteKind } from '../../core/remote/types';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Modal, Toggle } from './ui';
import '../styles/remote.css';

type Tab = 'cloud' | 'server' | 'network';

const DEVICE_ICON: Record<DeviceKind, string> = { cloud: 'cloud', 'home-server': 'server', nas: 'disk', mac: 'laptop', windows: 'laptop', linux: 'terminal', server: 'server', unknown: 'globe' };
export const deviceIcon = (d?: DeviceKind) => DEVICE_ICON[d ?? 'unknown'];

/** Errors from the main process arrive wrapped ("Error invoking remote method …: Error: …"); people see only the message. */
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');

const DEFAULT_PORT: Record<RemoteKind, number | undefined> = { sftp: 22, ftp: 21, webdav: undefined, rclone: undefined, smb: undefined };

interface ServerForm {
  kind: RemoteKind;
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  root: string;
  secure: boolean;
  insecure: boolean;
  keyFile: string;
  device?: DeviceKind;
}

const blankServer = (kind: RemoteKind = 'sftp'): ServerForm => ({ kind, name: '', host: '', port: '', user: '', password: '', root: '', secure: kind === 'webdav', insecure: false, keyFile: '' });

/** "https://cloud.example.org/remote.php/dav/files/ana" → host, port, path, secure. */
function splitUrl(v: string): Partial<ServerForm> | null {
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`);
    return { host: u.hostname, port: u.port, root: decodeURIComponent(u.pathname.replace(/\/+$/, '')), secure: u.protocol === 'https:' || u.protocol === 'davs:' || u.protocol === 'ftps:' };
  } catch {
    return null;
  }
}

export function ConnectionDialog({ edit, initialTab, onClose, onSaved }: { edit?: Connection; initialTab?: Tab; onClose: () => void; onSaved?: (c: Connection) => void }) {
  const { toast } = useStore();
  const [tab, setTab] = useState<Tab>(edit ? (edit.kind === 'rclone' ? 'cloud' : 'server') : initialTab ?? 'cloud');
  return (
    <Modal title={edit ? `Edit “${edit.name}”` : 'Add a connection'} onClose={onClose} width={680}>
      {!edit ? (
        <div className="seg conn-tabs" role="tablist">
          {([['cloud', 'cloud', 'Cloud storage'], ['server', 'server', 'Server'], ['network', 'globe', 'On this network']] as const).map(([id, icon, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon name={icon} size={13} /> {label}</button>
          ))}
        </div>
      ) : null}
      {tab === 'cloud' ? <CloudPane edit={edit} onDone={(c) => { toast(`Connected to ${c.name}`); onSaved?.(c); onClose(); }} /> : null}
      {tab === 'server' ? <ServerPane edit={edit} onDone={(c, remembered) => { toast(remembered ? `Saved ${c.name}` : `Saved ${c.name}. The password is kept until Keeper quits (no keychain on this computer).`); onSaved?.(c); onClose(); }} /> : null}
      {tab === 'network' ? <NetworkPane onPick={(f) => { setPrefill(f); setTab('server'); }} /> : null}
    </Modal>
  );
}

// The network tab hands its choice to the server tab through this.
let prefill: Partial<ServerForm> | null = null;
function setPrefill(f: Partial<ServerForm>) {
  prefill = f;
  window.dispatchEvent(new Event('keeper-conn-prefill'));
}

// ---------------------------------------------------------------- cloud services

function CloudPane({ edit, onDone }: { edit?: Connection; onDone: (c: Connection) => void }) {
  const [list, setList] = useState<ProviderInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<ProviderInfo | null>(null);
  useEffect(() => {
    void api.remote.providers().then((p) => {
      setList(p);
      if (edit?.provider) setPick(p.find((x) => x.id === edit.provider) ?? null);
    }, (e) => setError(errText(e)));
  }, [edit]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list ?? []).filter((p) => !t || `${p.name} ${p.description} ${p.id}`.toLowerCase().includes(t));
  }, [list, q]);
  if (error) return <div className="conn-note warn"><Icon name="warning" size={14} /> {error}</div>;
  if (!list) return <div className="row muted small" style={{ gap: 8, padding: 20 }}><div className="spinner" /> Loading services…</div>;
  if (pick) return <ProviderForm provider={pick} edit={edit} onBack={edit ? undefined : () => setPick(null)} onDone={onDone} />;
  const popular = shown.filter((p) => p.popular < 999);
  const rest = shown.filter((p) => p.popular >= 999);
  return (
    <div>
      <input className="input" autoFocus placeholder={`Search ${list.length} services…`} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      <div className="provider-grid">
        {popular.map((p) => (
          <button key={p.id} className="provider-tile" onClick={() => setPick(p)}>
            <Icon name={p.category === 'object' ? 'disk' : p.category === 'server' ? 'server' : p.category === 'photos' ? 'image' : 'cloud'} size={18} />
            <span className="grow ellipsis">{p.name}</span>
            {p.beta ? <span className="badge warn">Beta</span> : null}
          </button>
        ))}
      </div>
      {rest.length ? (
        <>
          <div className="small muted" style={{ margin: '14px 0 6px' }}>More services</div>
          <div className="provider-list">
            {rest.map((p) => (
              <button key={p.id} className="provider-row" onClick={() => setPick(p)}>
                <span className="grow ellipsis">{p.name}</span>
                <span className="small muted ellipsis">{p.description !== p.name ? p.description : ''}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <p className="small muted" style={{ marginTop: 12 }}>Cloud services connect through rclone, which comes with Keeper. Sign-in tokens are kept encrypted on this computer and are only ever sent to the service itself.</p>
    </div>
  );
}

function ProviderForm({ provider, edit, onBack, onDone }: { provider: ProviderInfo; edit?: Connection; onBack?: () => void; onDone: (c: Connection) => void }) {
  const [name, setName] = useState(edit?.name ?? provider.name);
  const [sub, setSub] = useState<string | undefined>(edit?.options?.provider);
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({ ...(edit?.options ?? {}) });
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<'signin' | 'save' | null>(null);
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [library, setLibrary] = useState(!!edit?.includeInLibrary);
  useEffect(() => {
    void api.remote.providerForm(provider.id, sub).then(setFields);
  }, [provider.id, sub]);
  // OAuth providers do not need their client id fields shown unless asked for.
  const visible = (fields ?? []).filter((f) => advanced || (!f.advanced && !(provider.oauth && /^client_(id|secret)$/.test(f.name))));
  const missing = (fields ?? []).filter((f) => f.required && !values[f.name] && !f.default);

  const signIn = async () => {
    setBusy('signin');
    setMessage('Finish signing in in your browser, then come back here.');
    try {
      const clientId = typeof values.client_id === 'string' ? values.client_id : undefined;
      const clientSecret = typeof values.client_secret === 'string' ? values.client_secret : undefined;
      const r = await api.remote.signIn(provider.id, edit?.id, clientId ? { id: clientId, secret: clientSecret } : undefined);
      setSignedIn(r.id);
      setMessage(null);
    } catch (e) {
      setMessage(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!fields) return;
    setBusy('save');
    setMessage(null);
    try {
      const { plain, secret } = formValues(fields, values as Record<string, string | boolean | undefined>);
      const input: ConnectionInput = { id: edit?.id ?? signedIn ?? undefined, name, kind: 'rclone', provider: provider.id, device: 'cloud', options: plain, secrets: secret, includeInLibrary: library };
      const r = await api.remote.save(input);
      onDone(r.connection);
    } catch (e) {
      setMessage(errText(e));
      setBusy(null);
    }
  };

  const subField = fields?.find((f) => f.name === 'provider');
  return (
    <div className="conn-form">
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        {onBack ? <button className="btn ghost sm icon" onClick={onBack} title="Back"><Icon name="chevronLeft" size={14} /></button> : null}
        <b className="grow">{provider.name}</b>
        {provider.beta ? <span className="badge warn" title="Works, but the service may change how it allows sign-in">Beta</span> : null}
      </div>
      <label className="field"><span>Name in Keeper</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      {subField?.suggestions ? (
        <label className="field"><span>{subField.label}</span>
          <select className="input" value={sub ?? ''} onChange={(e) => { setSub(e.target.value || undefined); setValues((v) => ({ ...v, provider: e.target.value })); }}>
            <option value="">Choose…</option>
            {subField.suggestions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      ) : null}
      {provider.oauth ? (
        <div className={`conn-signin ${signedIn || edit ? 'done' : ''}`}>
          <Icon name={signedIn ? 'check' : 'globe'} size={16} />
          <span className="grow">{signedIn ? 'Signed in.' : edit ? 'Signed in before. Sign in again if Keeper says so.' : `Sign in to ${provider.name} in your browser. Keeper never sees your password.`}</span>
          {busy === 'signin'
            ? <button className="btn sm" onClick={() => { void api.remote.cancelSignIn(); setBusy(null); setMessage(null); }}>Cancel</button>
            : <button className="btn sm primary" onClick={() => void signIn()}>{signedIn || edit ? 'Sign in again' : 'Sign in…'}</button>}
        </div>
      ) : null}
      {visible.filter((f) => f.name !== 'provider').map((f) => (
        <label key={f.name} className={`field ${f.type === 'bool' ? 'inline' : ''}`} title={f.help}>
          <span>{f.label}{f.required ? ' *' : ''}</span>
          {f.type === 'bool' ? (
            <Toggle on={values[f.name] === undefined ? f.default === 'true' : values[f.name] === true || values[f.name] === 'true'} onChange={(v) => setValues((x) => ({ ...x, [f.name]: v }))} />
          ) : f.type === 'select' ? (
            <select className="input" value={String(values[f.name] ?? f.default ?? '')} onChange={(e) => setValues((x) => ({ ...x, [f.name]: e.target.value }))}>
              {f.choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          ) : (
            <>
              <input className="input" type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'} placeholder={f.default ?? ''} value={String(values[f.name] ?? '')} list={f.suggestions ? `sugg-${f.name}` : undefined} onChange={(e) => setValues((x) => ({ ...x, [f.name]: e.target.value }))} />
              {f.suggestions ? <datalist id={`sugg-${f.name}`}>{f.suggestions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</datalist> : null}
            </>
          )}
          {f.help && f.type !== 'bool' ? <small className="muted">{f.help}</small> : null}
        </label>
      ))}
      {(fields ?? []).some((f) => f.advanced) ? <button className="link-like small" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Fewer options' : 'Advanced options'}</button> : null}
      <label className="field inline" style={{ marginTop: 10 }}><span>Include in library search <small className="muted">(names, sizes and dates only)</small></span><Toggle on={library} onChange={setLibrary} /></label>
      {message ? <div className="conn-note"><Icon name="info" size={14} /> {message}</div> : null}
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn primary" disabled={!!busy || !fields || missing.length > 0 || (provider.oauth && !signedIn && !edit)} onClick={() => void save()}>
          {busy === 'save' ? <div className="spinner" /> : <Icon name="check" size={14} />} {edit ? 'Save' : 'Connect'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- servers

function ServerPane({ edit, onDone }: { edit?: Connection; onDone: (c: Connection, remembered: boolean) => void }) {
  const [f, setF] = useState<ServerForm>(() => edit
    ? { kind: edit.kind, name: edit.name, host: edit.host ?? '', port: edit.port ? String(edit.port) : '', user: edit.user ?? '', password: '', root: edit.root ?? '', secure: !!edit.secure, insecure: !!edit.insecure, keyFile: edit.keyFile ?? '', device: edit.device }
    : { ...blankServer(), ...(prefill ?? {}) });
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [library, setLibrary] = useState(!!edit?.includeInLibrary);
  useEffect(() => {
    const on = () => {
      if (prefill) setF((x) => ({ ...x, ...prefill }));
      prefill = null;
    };
    window.addEventListener('keeper-conn-prefill', on);
    prefill = null;
    return () => window.removeEventListener('keeper-conn-prefill', on);
  }, []);
  const set = (patch: Partial<ServerForm>) => {
    setF((x) => ({ ...x, ...patch }));
    setResult(null);
  };
  const input = (): ConnectionInput => ({
    id: edit?.id,
    kind: f.kind,
    name: f.name.trim() || f.host,
    host: f.host.trim(),
    port: f.port ? Number(f.port) : DEFAULT_PORT[f.kind],
    user: f.user.trim() || undefined,
    password: f.password || undefined,
    root: f.root.trim() || undefined,
    secure: f.secure,
    insecure: f.insecure,
    keyFile: f.keyFile.trim() || undefined,
    device: f.device ?? 'server',
    includeInLibrary: library,
  });
  const test = async () => {
    setBusy('test');
    setResult(await api.remote.test(input()));
    setBusy(null);
  };
  const save = async () => {
    setBusy('save');
    try {
      const r = await api.remote.save(input());
      onDone(r.connection, r.remembered);
    } catch (e) {
      setResult({ ok: false, message: errText(e) });
      setBusy(null);
    }
  };
  const kinds: [RemoteKind, string, string][] = [
    ['sftp', 'SFTP', 'Linux machines, Macs with Remote Login, most NAS boxes and home servers'],
    ['smb', 'SMB', 'Windows and Mac file sharing, NAS boxes and home servers (opened by the system)'],
    ['webdav', 'WebDAV', 'Nextcloud, ownCloud and other web file servers'],
    ['ftp', 'FTP / FTPS', 'Older file servers and web hosts'],
  ];
  return (
    <div className="conn-form">
      <div className="kind-row">
        {kinds.map(([k, label, hint]) => (
          <button key={k} className={`kind-chip ${f.kind === k ? 'on' : ''}`} title={hint} disabled={!!edit && edit.kind !== k} onClick={() => set({ kind: k, secure: k === 'webdav' ? true : k === 'ftp' ? f.secure : false })}>{label}</button>
        ))}
      </div>
      <p className="small muted" style={{ margin: '4px 0 10px' }}>{kinds.find((k) => k[0] === f.kind)?.[2]}</p>
      <label className="field"><span>{f.kind === 'webdav' ? 'Address' : 'Server'}</span>
        <input className="input" autoFocus placeholder={f.kind === 'webdav' ? 'https://cloud.example.org/remote.php/dav/files/you' : f.kind === 'smb' ? 'nas.local or 192.168.0.20' : 'server.local or 192.168.0.20'} value={f.kind === 'webdav' && f.root ? `${f.secure ? 'https' : 'http'}://${f.host}${f.port ? `:${f.port}` : ''}${f.root}` : f.host}
          onChange={(e) => {
            const v = e.target.value;
            if (f.kind === 'webdav' && /[/:]/.test(v)) {
              const u = splitUrl(v);
              if (u) return set(u);
            }
            set({ host: v });
          }} />
      </label>
      <div className="row" style={{ gap: 10 }}>
        <label className="field grow"><span>User name</span><input className="input" value={f.user} placeholder={f.kind === 'ftp' ? 'anonymous' : ''} onChange={(e) => set({ user: e.target.value })} autoComplete="off" /></label>
        <label className="field grow"><span>Password</span><input className="input" type="password" value={f.password} placeholder={edit ? '(unchanged)' : f.kind === 'sftp' ? 'or use a key / the SSH agent' : ''} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" /></label>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <label className="field grow"><span>{f.kind === 'smb' ? 'Shared folder' : 'Start in folder'}</span><input className="input" value={f.kind === 'webdav' ? '' : f.root} disabled={f.kind === 'webdav'} placeholder={f.kind === 'smb' ? 'Media' : '/'} onChange={(e) => set({ root: e.target.value })} /></label>
        {f.kind !== 'smb' && f.kind !== 'webdav' ? <label className="field" style={{ width: 110 }}><span>Port</span><input className="input" inputMode="numeric" value={f.port} placeholder={String(DEFAULT_PORT[f.kind] ?? '')} onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} /></label> : null}
      </div>
      {f.kind === 'sftp' ? (
        <label className="field"><span>Key file <small className="muted">(optional)</small></span>
          <div className="row" style={{ gap: 6 }}>
            <input className="input grow" value={f.keyFile} placeholder="~/.ssh/id_ed25519" onChange={(e) => set({ keyFile: e.target.value })} />
            <button className="btn sm" onClick={async () => { const p = await api.tools.pickFiles?.(); if (p?.[0]) set({ keyFile: p[0] }); }}>Choose…</button>
          </div>
        </label>
      ) : null}
      {f.kind === 'ftp' ? <label className="field inline"><span>Encrypt with TLS (FTPS)</span><Toggle on={f.secure} onChange={(v) => set({ secure: v })} /></label> : null}
      {(f.kind === 'webdav' || f.kind === 'ftp') && f.secure ? <label className="field inline"><span>Allow a self-signed certificate <small className="muted">(home servers often have one)</small></span><Toggle on={f.insecure} onChange={(v) => set({ insecure: v })} /></label> : null}
      <label className="field"><span>Name in Keeper</span><input className="input" value={f.name} placeholder={f.host || 'My server'} onChange={(e) => set({ name: e.target.value })} /></label>
      {f.kind !== 'smb' ? <label className="field inline"><span>Include in library search <small className="muted">(names, sizes and dates only)</small></span><Toggle on={library} onChange={setLibrary} /></label> : null}
      {result ? <div className={`conn-note ${result.ok ? 'ok' : 'warn'}`}><Icon name={result.ok ? 'check' : 'warning'} size={14} /> {result.ok ? 'Connected. Everything works.' : result.message}</div> : null}
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        {f.kind !== 'smb' ? <button className="btn" disabled={!f.host || !!busy} onClick={() => void test()}>{busy === 'test' ? <div className="spinner" /> : null} Test</button> : null}
        <button className="btn primary" disabled={!f.host || !!busy} onClick={() => void save()}>{busy === 'save' ? <div className="spinner" /> : <Icon name="check" size={14} />} {edit ? 'Save' : 'Add'}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the local network

function NetworkPane({ onPick }: { onPick: (f: Partial<ServerForm>) => void }) {
  const [devices, setDevices] = useState<FoundDevice[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [shares, setShares] = useState<Record<string, { names: { name: string; comment?: string; external?: boolean }[]; message?: string } | 'loading'>>({});
  const scan = () => {
    setDevices(null);
    void api.remote.scanLan().then(setDevices);
  };
  useEffect(scan, []);
  const showShares = (d: FoundDevice) => {
    setOpen(open === d.host ? null : d.host);
    if (shares[d.host] || !d.protocols.includes('smb')) return;
    setShares((s) => ({ ...s, [d.host]: 'loading' }));
    void api.remote.shares(d.address ?? d.host).then((r) => setShares((s) => ({ ...s, [d.host]: { names: r.shares, message: r.message } })));
  };
  const use = (d: FoundDevice, kind: RemoteKind, root = '') =>
    onPick({ kind, host: d.address ?? d.host, name: root ? `${d.name} – ${root}` : d.name, root, device: d.guess.kind, secure: kind === 'webdav' ? d.protocols.includes('webdavs') : false, port: '' });
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="small muted">Home servers, NAS boxes and computers sharing files nearby.</span>
        <button className="btn sm ghost" onClick={scan} disabled={!devices}><Icon name="refresh" size={13} /> Look again</button>
      </div>
      {!devices ? <div className="row muted small" style={{ gap: 8, padding: 20 }}><div className="spinner" /> Looking on the network…</div> : !devices.length ? (
        <div className="conn-note">No machines answered. Make sure file sharing is on there, or add it by address on the Server tab.</div>
      ) : (
        <div className="lan-list">
          {devices.map((d) => {
            const sh = shares[d.host];
            return (
              <div key={d.host} className="lan-device">
                <div className="lan-head" onClick={() => showShares(d)}>
                  <Icon name={deviceIcon(d.guess.kind)} size={20} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis"><b>{d.name}</b> <span className="badge">{d.guess.detail ?? d.guess.label}</span></div>
                    <div className="small muted ellipsis">{d.address ?? d.host} · {d.protocols.filter((p) => p !== 'http' && p !== 'https').map((p) => p.toUpperCase()).join(', ') || 'web page only'}</div>
                  </div>
                  {d.guess.suggest === 'sftp' || d.guess.suggest === 'webdav' || d.guess.suggest === 'ftp'
                    ? <button className="btn sm primary" onClick={(e) => { e.stopPropagation(); use(d, d.guess.suggest as RemoteKind); }}>Connect</button>
                    : d.protocols.includes('smb') ? <Icon name={open === d.host ? 'chevronDown' : 'chevronRight'} size={14} /> : null}
                </div>
                {d.guess.tip && !d.guess.suggest ? <div className="small muted lan-tip"><Icon name="info" size={12} /> {d.guess.tip}</div> : null}
                {open === d.host ? (
                  <div className="lan-shares">
                    {sh === 'loading' ? <div className="small muted row" style={{ gap: 6 }}><div className="spinner" /> Asking for its shared folders…</div> : sh ? (
                      <>
                        {sh.names.map((s) => (
                          <button key={s.name} className="share-row" onClick={() => use(d, 'smb', s.name)}>
                            <Icon name={s.external ? 'usb' : 'folder'} size={14} />
                            <span className="grow ellipsis">{s.name}{s.external ? <span className="badge" style={{ marginLeft: 6 }}>External drive</span> : null}</span>
                            <span className="small muted ellipsis">{s.comment ?? ''}</span>
                          </button>
                        ))}
                        {sh.message ? <div className="small muted">{sh.message}</div> : null}
                        <button className="share-row" onClick={() => use(d, 'smb')}><Icon name="plus" size={14} /><span className="grow">Another folder, or sign in to see private ones…</span></button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <details className="small muted" style={{ marginTop: 12 }}>
        <summary>Connect another computer</summary>
        <ul className="lan-howto">
          <li><b>Mac:</b> System Settings → General → Sharing → File Sharing (SMB). For SFTP, turn on Remote Login.</li>
          <li><b>Windows:</b> right-click a folder → Properties → Sharing → Share, and turn on network discovery.</li>
          <li><b>Linux:</b> SFTP works wherever the SSH server runs (sudo apt install openssh-server). For SMB, install Samba.</li>
          <li><b>Home servers and NAS boxes:</b> turn on SMB (often called “Samba”, “Windows file sharing” or “network share”) in their settings. External drives plugged into them appear as their own shared folders.</li>
        </ul>
      </details>
    </div>
  );
}
