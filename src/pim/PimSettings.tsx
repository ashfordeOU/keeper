// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Mail & Calendar: accounts, notifications, undo send, the week,
// mail filters, trusted senders, where calendars come from (CalendarSources)
// and the sign-in IDs for Google and Microsoft.

import { useCallback, useEffect, useState } from 'react';
import type { MailRule } from '../../core/pim/mail';
import type { PimPrefsView } from '../../core/pim/prefs';
import type { Account } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Toggle } from '../components/ui';
import { useStore } from '../state';
import { AccountDialog } from './AccountDialog';
import { CalendarSources } from './CalendarSources';
import { usePimChanges } from './Mail';

const KIND: Record<string, string> = { imap: 'Mail (IMAP)', google: 'Google', microsoft: 'Microsoft 365', caldav: 'CalDAV', ics: 'Calendar link' };

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <div><div style={{ fontWeight: 600 }}>{title}</div>{desc ? <div className="small muted">{desc}</div> : null}</div>
      <div className="row" style={{ gap: 8, flex: 'none' }}>{children}</div>
    </div>
  );
}

export function PimSettings() {
  const { toast } = useStore();
  const [accounts, setAccounts] = useState<(Account & { needsSignIn?: boolean; secretIn?: string })[]>([]);
  const [prefs, setPrefs] = useState<PimPrefsView | null>(null);
  const [rules, setRules] = useState<MailRule[]>([]);
  const [adding, setAdding] = useState(false);
  const [pw, setPw] = useState<{ id: string; value: string } | null>(null);
  const load = useCallback(() => {
    void api.pim.accounts().then(setAccounts);
    void api.pim.prefs().then(setPrefs);
    void api.pim.rules().then(setRules);
  }, []);
  useEffect(load, [load]);
  usePimChanges(['accounts'], load);
  const set = async (p: Partial<PimPrefsView>) => setPrefs(await api.pim.setPrefs(p));
  const saveRules = (r: MailRule[]) => { setRules(r); void api.pim.saveRules(r); };
  if (!prefs) return null;

  return (
    <div className="pim-settings">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Accounts</div>
      {accounts.length ? accounts.map((a) => (
        <div key={a.id} className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <i className="dot" style={{ background: a.color ?? 'var(--accent)' }} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis"><b>{a.label}</b> <span className="small muted">{KIND[a.kind] ?? a.kind}</span></div>
            <div className="small muted">{[a.mail ? 'mail' : '', a.calendar ? 'calendars' : '', a.contacts ? 'contacts' : ''].filter(Boolean).join(' · ') || 'nothing switched on'}{a.secretIn === 'memory' ? ' · password kept until Keeper quits (no keychain on this system)' : ''}</div>
            {a.needsSignIn ? <div className="small" style={{ color: 'var(--warn)' }}>Sign in again: the server did not accept the saved password or token.</div> : null}
          </div>
          {a.kind === 'imap' || a.kind === 'caldav' ? (
            pw?.id === a.id
              ? <><input className="input" type="password" autoFocus placeholder="Password" value={pw.value} onChange={(e) => setPw({ id: a.id, value: e.target.value })} style={{ width: 160 }} /><button className="btn sm primary" onClick={async () => { await api.pim.updateAccount(a.id, { password: pw.value } as Partial<Account>); setPw(null); toast('Password saved'); }}>Save</button></>
              : <button className="btn sm ghost" onClick={() => setPw({ id: a.id, value: '' })}>Password…</button>
          ) : a.oauth ? <button className="btn sm ghost" onClick={async () => { try { await api.pim.signIn(a.oauth!, a.email); await api.pim.removeAccount(a.id); } catch (e) { toast(String(e)); } }}>Sign in again</button> : null}
          <button className="btn sm ghost icon" title="Remove account" aria-label="Remove account" onClick={() => { if (window.confirm(`Remove ${a.label} from Keeper? Mail and events stay on the server.`)) void api.pim.removeAccount(a.id); }}><Icon name="trash" size={13} /></button>
        </div>
      )) : <div className="small muted">No accounts yet.</div>}
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setAdding(true)}><Icon name="plus" size={13} /> Add account</button>

      <div style={{ fontWeight: 600, margin: '18px 0 2px' }}>Mail</div>
      <Row title="Notify about new mail" desc="A notification and an Island alert when mail arrives in an inbox."><Toggle on={prefs.notifyMail} onChange={(v) => void set({ notifyMail: v })} /></Row>
      <Row title="Show sender and subject in notifications" desc="Turn off so people near your screen only see “New mail”."><Toggle on={prefs.notifyPreviews} onChange={(v) => void set({ notifyPreviews: v })} /></Row>
      <Row title="Undo send" desc="How long a message waits before it goes, so you can take it back.">
        <select className="input" value={prefs.undoSendSec} onChange={(e) => void set({ undoSendSec: Number(e.target.value) })}>{[0, 5, 10, 20, 30].map((s) => <option key={s} value={s}>{s ? `${s} seconds` : 'Off'}</option>)}</select>
      </Row>
      <Row title="Pictures from these senders load straight away" desc={prefs.trustedSenders.length ? prefs.trustedSenders.join(', ') : 'Nobody yet: remote pictures are held back for everyone.'}>
        {prefs.trustedSenders.length ? <button className="btn sm ghost" onClick={() => void set({ trustedSenders: [] })}>Clear</button> : null}
      </Row>

      <div style={{ fontWeight: 600, margin: '18px 0 2px' }}>Filters for new mail</div>
      <div className="small muted" style={{ marginBottom: 6 }}>Run on this computer for mail arriving in an inbox. The first filter that matches wins.</div>
      {rules.map((r, i) => (
        <div key={r.id} className="row" style={{ gap: 6, padding: '4px 0', flexWrap: 'wrap' }}>
          <input type="checkbox" checked={r.enabled} onChange={(e) => saveRules(rules.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} aria-label="On" />
          <span className="small">If</span>
          <select className="input" value={r.when[0]?.field ?? 'from'} onChange={(e) => saveRules(rules.map((x, j) => (j === i ? { ...x, when: [{ field: e.target.value as MailRule['when'][number]['field'], contains: x.when[0]?.contains ?? '' }] } : x)))}>
            <option value="from">sender</option><option value="to">recipients</option><option value="subject">subject</option><option value="body">text</option><option value="any">anything</option>
          </select>
          <span className="small">contains</span>
          <input className="input" style={{ width: 150 }} value={r.when[0]?.contains ?? ''} onChange={(e) => saveRules(rules.map((x, j) => (j === i ? { ...x, name: e.target.value, when: [{ field: x.when[0]?.field ?? 'from', contains: e.target.value }] } : x)))} />
          <select className="input" value={r.then.action} onChange={(e) => { const a = e.target.value; saveRules(rules.map((x, j) => (j === i ? { ...x, then: a === 'move' ? { action: 'move', folder: 'Archive' } : a === 'label' ? { action: 'label', label: 'Keeper' } : ({ action: a } as MailRule['then']) } : x))); }}>
            <option value="read">mark as read</option><option value="flag">flag</option><option value="move">move to folder</option><option value="label">add a label</option><option value="trash">delete</option>
          </select>
          {r.then.action === 'move' ? <input className="input" style={{ width: 120 }} value={r.then.folder} onChange={(e) => saveRules(rules.map((x, j) => (j === i ? { ...x, then: { action: 'move', folder: e.target.value } } : x)))} aria-label="Folder" /> : null}
          {r.then.action === 'label' ? <input className="input" style={{ width: 120 }} value={r.then.label} onChange={(e) => saveRules(rules.map((x, j) => (j === i ? { ...x, then: { action: 'label', label: e.target.value } } : x)))} aria-label="Label" /> : null}
          <button className="btn sm ghost icon" aria-label="Remove filter" onClick={() => saveRules(rules.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
        </div>
      ))}
      <button className="btn sm ghost" onClick={() => saveRules([...rules, { id: String(Date.now()), name: '', enabled: true, when: [{ field: 'from', contains: '' }], then: { action: 'read' } }])}><Icon name="plus" size={13} /> Add filter</button>

      <div style={{ fontWeight: 600, margin: '18px 0 2px' }} id="settings-calendar">Calendar</div>
      <CalendarSources />
      <Row title="Weeks start on">
        <select className="input" value={prefs.weekStart} onChange={(e) => void set({ weekStart: Number(e.target.value) })}><option value={1}>Monday</option><option value={0}>Sunday</option><option value={6}>Saturday</option></select>
      </Row>
      <Row title="Show week numbers"><Toggle on={prefs.showWeekNumbers} onChange={(v) => void set({ showWeekNumbers: v })} /></Row>
      <Row title="Alert for new events">
        <select className="input" value={prefs.defaultAlertMin} onChange={(e) => void set({ defaultAlertMin: Number(e.target.value) })}>{[0, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m ? `${m} minutes before` : 'At the start'}</option>)}</select>
      </Row>

      <details style={{ marginTop: 14 }}>
        <summary style={{ fontWeight: 600 }}>Google and Microsoft sign-in</summary>
        <div className="small muted" style={{ margin: '6px 0' }}>Signing in with Google or Microsoft needs an app ID registered with them by whoever builds Keeper (see docs/PIM.md). Official builds include them; if yours does not, paste IDs from your own Google Cloud or Microsoft Entra registration here, or use an app password instead.</div>
        <div className="col" style={{ gap: 6, maxWidth: 520 }}>
          <input className="input" placeholder="Google OAuth client ID (Desktop app)" value={prefs.clients?.google ?? ''} onChange={(e) => void set({ clients: { ...prefs.clients, google: e.target.value || undefined } })} />
          <input className="input" placeholder="Google client secret (Desktop apps get one; it is not secret)" value={prefs.clients?.googleSecret ?? ''} onChange={(e) => void set({ clients: { ...prefs.clients, googleSecret: e.target.value || undefined } })} />
          <input className="input" placeholder="Microsoft application (client) ID" value={prefs.clients?.microsoft ?? ''} onChange={(e) => void set({ clients: { ...prefs.clients, microsoft: e.target.value || undefined } })} />
        </div>
      </details>
      {adding ? <AccountDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} /> : null}
    </div>
  );
}
