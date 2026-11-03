// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Mail & Calendar: accounts (signatures, sharing with coding
// assistants), notifications and the Island, Important / Other, follow-ups,
// layout and keyboard shortcuts, undo send, the week, mail filters, trusted
// senders, where calendars come from (CalendarSources) and the sign-in IDs
// for Google and Microsoft.

import { useCallback, useEffect, useState } from 'react';
import type { MailRule } from '../../core/pim/mail';
import type { PimPrefsView } from '../../core/pim/prefs';
import { ACTION_LABELS, SCHEMES, showCombo, type MailAction, type SchemeId } from '../../core/pim/shortcuts';
import type { Account } from '../../core/pim/types';
import { relativeTime } from '../../core/format';
import { docUrl } from '../../core/brand';
import { errorText } from '../../core/ipc-error';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Toggle } from '../components/ui';
import { useStore } from '../state';
import { AccountDialog } from './AccountDialog';
import { CalendarSources } from './CalendarSources';
import { RulesEditor } from './mail-settings';
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

function AccountMailRow({ a }: { a: Account }) {
  const { toast } = useStore();
  const [sig, setSig] = useState<string | null>(null);
  const id0 = a.identities[0];
  return (
    <div className="pim-account-extra">
      <label className="row small" style={{ gap: 8 }} title="Coding assistants and other apps connected to Keeper over MCP may search and read this account's mail and write drafts. They can never send, delete or move mail, and never see Spam, Trash or security mail such as sign-in codes.">
        <Toggle on={!!a.mcp} onChange={(v) => void api.pim.updateAccount(a.id, { mcp: v }).then(() => toast(v ? 'Coding assistants can now search, read and draft in this account' : 'This account is no longer shared'))} />
        Share with coding assistants (MCP): search, read and draft only
      </label>
      {id0 ? (
        sig === null
          ? <button className="btn sm ghost" onClick={() => setSig(id0.signature ?? '')}><Icon name="rename" size={12} /> {id0.signature ? 'Edit signature' : 'Add a signature'}</button>
          : (
            <div className="col" style={{ gap: 6, width: '100%' }}>
              <textarea className="input" rows={3} autoFocus value={sig} placeholder={`${id0.name}\n…`} onChange={(e) => setSig(e.target.value)} aria-label="Signature" />
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm primary" onClick={() => void api.pim.updateAccount(a.id, { identities: a.identities.map((x, i) => (i === 0 ? { ...x, signature: sig.trim() || undefined } : x)) }).then(() => { setSig(null); toast('Signature saved'); })}>Save</button>
                <button className="btn sm ghost" onClick={() => setSig(null)}>Cancel</button>
              </div>
            </div>
          )
      ) : null}
    </div>
  );
}

function Shortcuts({ prefs, set, mac }: { prefs: PimPrefsView; set: (p: Partial<PimPrefsView>) => void; mac: boolean }) {
  const scheme = (prefs.shortcutScheme ?? 'gmail') as SchemeId;
  const own = prefs.shortcutOverrides ?? {};
  return (
    <details style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <summary className="small">Show and change the keys</summary>
      <div className="shortcut-grid">
        {(Object.keys(ACTION_LABELS) as MailAction[]).map((a) => {
          const keys = own[a] ?? (SCHEMES[scheme].keys[a] ?? []).join(', ');
          return (
            <label key={a} className="row small" style={{ gap: 8 }}>
              <span className="grow">{ACTION_LABELS[a]}</span>
              <span className="muted">{keys ? keys.split(',').map((k) => showCombo(k.trim(), mac)).join(' · ') : 'none'}</span>
              <input className="input" style={{ width: 120 }} value={keys} onChange={(e) => set({ shortcutOverrides: { ...own, [a]: e.target.value } })} aria-label={`Keys for ${ACTION_LABELS[a]}`} />
            </label>
          );
        })}
      </div>
      <div className="small muted">Keys like <code>e</code>, <code>shift+u</code>, <code>mod+r</code> (⌘ on a Mac, Ctrl elsewhere) or two in a row like <code>g i</code>; several separated by commas. {Object.keys(own).length ? <button className="link-like small" onClick={() => set({ shortcutOverrides: {} })}>Back to the set’s keys</button> : null}</div>
    </details>
  );
}

export function PimSettings() {
  const { toast, info } = useStore();
  const [accounts, setAccounts] = useState<(Account & { needsSignIn?: boolean; secretIn?: string; lastChecked?: number; lastError?: string })[]>([]);
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
        <div key={a.id} className="row" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <i className="dot" style={{ background: a.color ?? 'var(--accent)' }} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis"><b>{a.label}</b> <span className="small muted">{KIND[a.kind] ?? a.kind}</span></div>
            <div className="small muted">{[a.mail ? 'mail' : '', a.calendar ? 'calendars' : '', a.contacts ? 'contacts' : ''].filter(Boolean).join(' · ') || 'nothing switched on'}{a.secretIn === 'memory' ? ' · password kept until Keeper quits (no keychain on this system)' : ''}</div>
            {a.needsSignIn ? <div className="small" style={{ color: 'var(--warn)' }}>Sign in again: the server did not accept the saved password or token.</div> : null}
            {a.lastError && !a.needsSignIn ? (
              <div className="small" data-testid="pim-account-error" style={{ color: 'var(--warn)' }}>Couldn’t check it: {a.lastError}{a.lastChecked ? ` · last checked ${relativeTime(a.lastChecked)}` : ''} <button className="btn sm ghost" onClick={() => void api.pim.refresh(a.id).then(() => toast('Checked'), (e: Error) => toast(e.message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ''))).finally(load)}>Retry</button></div>
            ) : a.lastChecked ? <div className="small muted" data-testid="pim-account-checked">Checked {relativeTime(a.lastChecked)}</div> : null}
          </div>
          {a.kind === 'imap' || a.kind === 'caldav' ? (
            pw?.id === a.id
              ? <><input className="input" type="password" autoFocus placeholder="Password" value={pw.value} onChange={(e) => setPw({ id: a.id, value: e.target.value })} style={{ width: 160 }} /><button className="btn sm primary" onClick={async () => { await api.pim.updateAccount(a.id, { password: pw.value } as Partial<Account>); setPw(null); toast('Password saved'); }}>Save</button></>
              : <button className="btn sm ghost" onClick={() => setPw({ id: a.id, value: '' })}>Password…</button>
          ) : a.oauth ? <button className="btn sm ghost" onClick={async () => { try { await api.pim.signIn(a.oauth!, a.email); await api.pim.removeAccount(a.id); } catch (e) { toast(errorText(e)); } }}>Sign in again</button> : null}
          <button className="btn sm ghost icon" title="Remove account" aria-label="Remove account" onClick={() => { if (window.confirm(`Remove ${a.label} from Keeper? Mail and events stay on the server.`)) void api.pim.removeAccount(a.id); }}><Icon name="trash" size={13} /></button>
          {a.mail ? <AccountMailRow a={a} /> : null}
        </div>
      )) : <div className="small muted">No accounts yet.</div>}
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setAdding(true)}><Icon name="plus" size={13} /> Add account</button>

      <div style={{ fontWeight: 600, margin: '18px 0 2px' }}>Mail</div>
      <Row title="Notify about new mail" desc="A notification and an Island alert when mail arrives in an inbox."><Toggle on={prefs.notifyMail} onChange={(v) => void set({ notifyMail: v })} /></Row>
      <Row title="Show sender and subject in notifications" desc="Turn off so people near your screen only see “New mail”."><Toggle on={prefs.notifyPreviews} onChange={(v) => void set({ notifyPreviews: v })} /></Row>
      <Row title="New mail in the Island" desc="Drops down from the notch (or the pill) with Open, Archive and Mark read.">
        <select className="input" value={prefs.islandMail ?? 'important'} onChange={(e) => void set({ islandMail: e.target.value as PimPrefsView['islandMail'] })}><option value="important">Important mail only</option><option value="all">All new mail</option><option value="off">Never</option></select>
      </Row>
      <Row title="Sort inboxes into Important and Other" desc="People you write to and replies to your mail are Important; newsletters, receipts and automatic mail go to Other. Sign-in alerts and codes are always Important.">
        <Toggle on={prefs.splitInbox !== false} onChange={(v) => void set({ splitInbox: v })} />
      </Row>
      <Row title="Follow up after" desc="Sent mail without an answer for this long is called out in Waiting for reply.">
        <select className="input" value={prefs.followUpDays ?? 3} onChange={(e) => void set({ followUpDays: Number(e.target.value) })}>{[1, 2, 3, 5, 7, 14].map((d) => <option key={d} value={d}>{d} day{d === 1 ? '' : 's'}</option>)}</select>
      </Row>
      <Row title="Layout" desc="The list beside the message, or a wide list with bulk actions that opens messages in its place.">
        <div className="seg"><button className={(prefs.mailLayout ?? 'split') === 'split' ? 'on' : ''} onClick={() => void set({ mailLayout: 'split' })}>Split</button><button className={prefs.mailLayout === 'wide' ? 'on' : ''} onClick={() => void set({ mailLayout: 'wide' })}>Wide list</button></div>
      </Row>
      <Row title="Keyboard shortcuts" desc="Pick the set your fingers know; change any key below.">
        <select className="input" value={prefs.shortcutScheme ?? 'gmail'} onChange={(e) => void set({ shortcutScheme: e.target.value as SchemeId, shortcutOverrides: {} })}>{(Object.keys(SCHEMES) as SchemeId[]).map((k) => <option key={k} value={k}>{SCHEMES[k].label}</option>)}</select>
      </Row>
      <Shortcuts prefs={prefs} set={(p) => void set(p)} mac={info?.platform === 'darwin'} />
      <Row title="Keep recent mail for reading offline" desc="The newest inbox messages are kept on this computer, so they open without a connection. Changes made offline go to the server when it is back.">
        <Toggle on={prefs.offlineBodies !== false} onChange={(v) => void set({ offlineBodies: v })} />
      </Row>
      <Row title="Undo send" desc="How long a message waits before it goes, so you can take it back.">
        <select className="input" value={prefs.undoSendSec} onChange={(e) => void set({ undoSendSec: Number(e.target.value) })}>{[0, 5, 10, 20, 30].map((s) => <option key={s} value={s}>{s ? `${s} seconds` : 'Off'}</option>)}</select>
      </Row>
      <Row title="Pictures from these senders load straight away" desc={prefs.trustedSenders.length ? prefs.trustedSenders.join(', ') : 'Nobody yet: remote pictures are held back for everyone.'}>
        {prefs.trustedSenders.length ? <button className="btn sm ghost" onClick={() => void set({ trustedSenders: [] })}>Clear</button> : null}
      </Row>

      <div style={{ fontWeight: 600, margin: '18px 0 2px' }} id="settings-mail-rules">Rules for new mail</div>
      <div className="small muted" style={{ marginBottom: 6 }}>Run on this computer as mail arrives in an inbox, in order; a rule can stop the ones after it. Rules marked “Also on the server” are written to the mail server (Sieve) or to Gmail’s filters, so they work while Keeper is closed.</div>
      <RulesEditor rules={rules} setRules={saveRules} accounts={accounts} />

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
        <summary style={{ fontWeight: 600 }}>Developer options: sign-in client IDs</summary>
        <div className="small muted" style={{ margin: '6px 0' }}>Sign in with Google or Microsoft needs an app registered with them. When this copy of Keeper has none, the sign-in buttons are hidden and Gmail, iCloud, Yahoo, AOL, Fastmail and Zoho work with an app password; Outlook.com and Microsoft 365 need the Microsoft sign-in. If you have your own Google Cloud or Microsoft Entra registration, paste its IDs here. <button className="link-like" onClick={() => void api.system.openExternal(docUrl('PIM'))}>How to register one</button></div>
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
