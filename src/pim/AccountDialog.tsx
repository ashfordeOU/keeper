// SPDX-License-Identifier: AGPL-3.0-or-later
// Adding a mail or calendar account: type your address and Keeper finds the
// servers; sign in with Google or Microsoft, or use an (app) password; or add
// a CalDAV calendar or a calendar link.

import { useState } from 'react';
import type { NewAccount } from '../../core/api-pim';
import type { MailConfig } from '../../core/pim/autoconfig';
import type { ServerSettings } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';
import { useAsync } from '../state';

type Tab = 'mail' | 'caldav' | 'ics';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function ServerRow({ label, value, onChange }: { label: string; value?: ServerSettings & { user?: string }; onChange: (v: ServerSettings & { user: string }) => void }) {
  const v = { host: '', port: 993, security: 'tls' as const, user: '', ...value };
  return (
    <div className="server-row">
      <span className="small muted" style={{ width: 70 }}>{label}</span>
      <input className="input" placeholder="host" value={v.host} onChange={(e) => onChange({ ...v, host: e.target.value })} aria-label={`${label} server`} />
      <input className="input" style={{ width: 70 }} type="number" value={v.port} onChange={(e) => onChange({ ...v, port: Number(e.target.value) })} aria-label={`${label} port`} />
      <select className="input" style={{ width: 110 }} value={v.security} onChange={(e) => onChange({ ...v, security: e.target.value as ServerSettings['security'] })} aria-label={`${label} security`}>
        <option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option><option value="none">None</option>
      </select>
      <input className="input" placeholder="user name" value={v.user} onChange={(e) => onChange({ ...v, user: e.target.value })} aria-label={`${label} user name`} />
    </div>
  );
}

export function AccountDialog({ onClose, onAdded, initialTab = 'mail' }: { onClose: () => void; onAdded: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [cfg, setCfg] = useState<MailConfig | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [url, setUrl] = useState('');
  const [davUser, setDavUser] = useState('');
  const [label, setLabel] = useState('');
  const [insecure, setInsecure] = useState(false);
  const oauth = useAsync(() => api.pim.oauthReady(), []);

  const find = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setMsg({ ok: false, text: 'Type your whole email address' }); return; }
    setBusy('find');
    setMsg(null);
    try {
      setCfg(await api.pim.discover(email.trim()));
    } catch (e) {
      setMsg({ ok: false, text: clean(e) });
    } finally {
      setBusy(null);
    }
  };

  const draft = (): NewAccount => {
    if (tab === 'ics') return { kind: 'ics', caldav: url.trim(), label: label || undefined };
    if (tab === 'caldav') return { kind: 'caldav', caldav: url.trim(), email: davUser.includes('@') ? davUser : undefined, davUser, password, label: label || undefined, insecureTls: insecure, calendar: true, contacts: true };
    return { kind: 'imap', email: email.trim(), name: name || undefined, password, imap: cfg?.imap, smtp: cfg?.smtp, caldav: cfg?.caldav, carddav: cfg?.carddav, insecureTls: insecure };
  };

  const test = async () => {
    setBusy('test');
    setMsg(null);
    const r = await api.pim.testAccount(draft()).catch((e) => ({ ok: false, message: clean(e) }));
    setMsg({ ok: r.ok, text: r.message });
    setBusy(null);
    return r.ok;
  };

  const add = async () => {
    if (tab !== 'ics' && !(await test())) return;
    setBusy('add');
    try {
      if (tab === 'ics') await api.pim.subscribe(url.trim(), label || undefined);
      else await api.pim.addAccount(draft());
      onAdded();
    } catch (e) {
      setMsg({ ok: false, text: clean(e) });
    } finally {
      setBusy(null);
    }
  };

  const signIn = async (p: 'google' | 'microsoft') => {
    setBusy(p);
    setMsg({ ok: true, text: 'Finish signing in in your browser…' });
    try {
      await api.pim.signIn(p, email.trim() || undefined);
      onAdded();
    } catch (e) {
      setMsg({ ok: false, text: clean(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Add an account" onClose={() => { void api.pim.cancelSignIn(); onClose(); }} width={600}>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={tab === 'mail' ? 'on' : ''} onClick={() => setTab('mail')}><Icon name="mail" size={13} /> Mail (and calendar)</button>
        <button className={tab === 'caldav' ? 'on' : ''} onClick={() => setTab('caldav')}><Icon name="calendar" size={13} /> CalDAV calendar</button>
        <button className={tab === 'ics' ? 'on' : ''} onClick={() => setTab('ics')}><Icon name="link" size={13} /> Calendar link</button>
      </div>

      {tab === 'mail' ? (
        <div className="col" style={{ gap: 10 }}>
          <div className="btn-row">
            <button className="btn" disabled={!oauth.data?.google || !!busy} title={oauth.data?.google ? '' : 'This copy of Keeper has no Google sign-in set up; use an app password below'} onClick={() => void signIn('google')}>{busy === 'google' ? <div className="spinner" /> : <Icon name="globe" size={14} />} Sign in with Google</button>
            <button className="btn" disabled={!oauth.data?.microsoft || !!busy} title={oauth.data?.microsoft ? '' : 'This copy of Keeper has no Microsoft sign-in set up; use an app password below'} onClick={() => void signIn('microsoft')}>{busy === 'microsoft' ? <div className="spinner" /> : <Icon name="globe" size={14} />} Sign in with Microsoft</button>
          </div>
          {!oauth.data?.google || !oauth.data?.microsoft ? <div className="small muted">Google and Microsoft sign-in need IDs registered for this copy of Keeper (Settings → Mail &amp; Calendar). Without them, use an app password from your provider.</div> : null}
          <label className="field"><span>Email address</span><input className="input" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setCfg(null); }} onKeyDown={(e) => e.key === 'Enter' && !cfg && void find()} placeholder="you@example.com" /></label>
          {!cfg ? <div className="btn-row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={!!busy} onClick={() => void find()}>{busy === 'find' ? <div className="spinner" /> : null} Continue</button></div> : (
            <>
              <div className="discovered">
                <Icon name="check" size={14} /> <span className="grow">{cfg.provider ? `${cfg.provider}: ` : ''}{cfg.imap ? `${cfg.imap.host}` : 'no mail server found'}{cfg.caldav ? ' · calendars' : ''}{cfg.carddav ? ' · contacts' : ''}</span>
                <button className="link-like small" onClick={() => setAdvanced(!advanced)}>{advanced ? 'Hide' : 'Change'} servers</button>
              </div>
              {cfg.note ? <div className="small muted">{cfg.note}</div> : null}
              <label className="field"><span>Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="As people will see it" /></label>
              <label className="field"><span>Password or app password</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} /></label>
              {advanced ? (
                <div className="col" style={{ gap: 6 }}>
                  <ServerRow label="Incoming" value={cfg.imap} onChange={(v) => setCfg({ ...cfg, imap: v })} />
                  <ServerRow label="Outgoing" value={cfg.smtp} onChange={(v) => setCfg({ ...cfg, smtp: v })} />
                  <label className="field"><span>CalDAV (calendars, optional)</span><input className="input" value={cfg.caldav ?? ''} onChange={(e) => setCfg({ ...cfg, caldav: e.target.value || undefined })} placeholder="https://…" /></label>
                  <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={insecure} onChange={(e) => setInsecure(e.target.checked)} /> Accept a self-signed certificate (home servers only)</label>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : tab === 'caldav' ? (
        <div className="col" style={{ gap: 10 }}>
          <div className="small muted">Nextcloud, ownCloud, Radicale, Baïkal, Synology, iCloud (app-specific password), Fastmail and any CalDAV server. Contacts (CardDAV) come along when the server has them.</div>
          <label className="field"><span>Server address</span><input className="input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cloud.example.com/remote.php/dav" /></label>
          <label className="field"><span>User name</span><input className="input" value={davUser} onChange={(e) => setDavUser(e.target.value)} /></label>
          <label className="field"><span>Password</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label className="field"><span>Name in Keeper (optional)</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={insecure} onChange={(e) => setInsecure(e.target.checked)} /> Accept a self-signed certificate (home servers only)</label>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <div className="small muted">A calendar someone shares as a link (.ics or webcal://): holidays, sports fixtures, a team’s schedule. Read-only; Keeper checks it every 15 minutes.</div>
          <label className="field"><span>Calendar address</span><input className="input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webcal://example.com/calendar.ics" /></label>
          <label className="field"><span>Name (optional)</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        </div>
      )}

      {msg ? <div className={`banner ${msg.ok ? 'ok' : 'warn'}`} style={{ marginTop: 12 }}><Icon name={msg.ok ? 'check' : 'warning'} size={14} /> {msg.text}</div> : null}
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        {tab !== 'ics' && (tab !== 'mail' || cfg) ? <button className="btn" disabled={!!busy} onClick={() => void test()}>{busy === 'test' ? <div className="spinner" /> : null} Test</button> : null}
        {tab !== 'mail' || cfg ? <button className="btn primary" disabled={!!busy || (tab === 'mail' ? !password : !url)} onClick={() => void add()}>{busy === 'add' ? <div className="spinner" /> : null} Add</button> : null}
      </div>
    </Modal>
  );
}
