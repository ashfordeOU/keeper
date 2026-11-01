// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where calendars come from: this computer's own (macOS Calendar, Windows
// Calendar or Outlook, the Linux desktop's), accounts connected directly
// (Google, Microsoft 365, iCloud and other CalDAV), subscribed links,
// imported files, holidays and birthdays; and, for each calendar, whether it
// shows, its colour and whether it appears in the Island.

import { useCallback, useEffect, useState } from 'react';
import { HOLIDAY_COUNTRIES } from '../../core/pim/holidays';
import type { PimPrefsView } from '../../core/pim/prefs';
import type { SystemAccess } from '../../core/pim/syscal';
import type { CalendarInfo } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Toggle } from '../components/ui';
import { useStore } from '../state';
import { AccountDialog } from './AccountDialog';
import { usePimChanges } from './Mail';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const SETTINGS_URL: Record<string, string> = {
  eventkit: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars',
};

/** The card that asks for (or explains) access to this computer's calendars. */
export function CalendarAccessCard({ access, onChange, compact }: { access: SystemAccess | null; onChange: (a: SystemAccess) => void; compact?: boolean }) {
  if (!access || access.state === 'granted') return null;
  if (compact && access.state === 'unavailable') return null;
  const settingsUrl = access.via ? SETTINGS_URL[access.via] : undefined;
  return (
    <div className="cal-access-card" role="note" data-testid="calendar-access-card">
      <Icon name="calendar" size={18} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{access.state === 'notDetermined' ? 'See your calendars from this computer' : access.state === 'unavailable' ? 'This computer’s calendars' : 'Calendar access is off'}</div>
        <div className="small muted">{access.message}</div>
      </div>
      {access.canRequest ? <button className="btn sm primary" onClick={() => void api.pim.systemAccess(true).then(onChange)}>Allow calendar access</button> : null}
      {!access.canRequest && settingsUrl && access.state !== 'unavailable' ? <button className="btn sm" onClick={() => void api.system.openExternal(settingsUrl)}>Open System Settings</button> : null}
    </div>
  );
}

export function useSystemAccess() {
  const [access, setAccess] = useState<SystemAccess | null>(null);
  const load = useCallback(() => { void api.pim.systemAccess().then(setAccess).catch(() => undefined); }, []);
  useEffect(load, [load]);
  usePimChanges(['calendar'], load);
  return [access, setAccess] as const;
}

export function CalendarSources() {
  const { toast } = useStore();
  const [cals, setCals] = useState<CalendarInfo[]>([]);
  const [prefs, setPrefs] = useState<PimPrefsView | null>(null);
  const [oauth, setOauth] = useState<{ google: boolean; microsoft: boolean }>({ google: false, microsoft: false });
  const [access, setAccess] = useSystemAccess();
  const [adding, setAdding] = useState<'caldav' | 'ics' | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    void api.pim.calendars().then(setCals);
    void api.pim.prefs().then(setPrefs);
  }, []);
  useEffect(load, [load]);
  useEffect(() => { void api.pim.oauthReady().then(setOauth).catch(() => undefined); }, []);
  usePimChanges(['calendar', 'accounts'], load);
  const set = async (p: Partial<PimPrefsView>) => { setPrefs(await api.pim.setPrefs(p)); load(); };
  const connect = async (p: 'google' | 'microsoft') => {
    setBusy(p);
    try {
      await api.pim.signIn(p, undefined, { calendarOnly: true });
      toast('Connected. Its calendars appear in a moment.');
    } catch (e) {
      toast(clean(e));
    } finally {
      setBusy('');
    }
  };
  const subscribe = async () => {
    if (!link.trim()) return;
    setBusy('link');
    try {
      const c = await api.pim.subscribe(link.trim());
      toast(`Subscribed to “${c.name}”`);
      setLink('');
    } catch (e) {
      toast(clean(e));
    } finally {
      setBusy('');
    }
  };
  if (!prefs) return null;
  const groups = new Map<string, CalendarInfo[]>();
  for (const c of cals.filter((x) => !x.tasks)) {
    const g = c.source === 'system' ? `This computer${c.group ? ` · ${c.group}` : ''}` : c.source ? 'Holidays and birthdays' : c.account === 'local' ? 'Keeper' : 'Connected';
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  return (
    <div className="cal-sources" data-testid="calendar-sources">
      <div className="row" style={{ justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
        <div><div style={{ fontWeight: 600 }}>This computer’s calendars</div><div className="small muted">{access?.state === 'granted' ? access.message : 'The accounts already set up in your system’s Calendar (iCloud, Google, Exchange, Outlook…), read live.'}</div></div>
        <Toggle on={prefs.systemCalendars !== false} onChange={(v) => void set({ systemCalendars: v })} />
      </div>
      {prefs.systemCalendars !== false ? <CalendarAccessCard access={access} onChange={(a) => { setAccess(a); load(); }} /> : null}

      <div style={{ fontWeight: 600, margin: '14px 0 6px' }}>Connect a calendar</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={!oauth.google || !!busy} title={oauth.google ? 'Google Calendar only; no mail access is asked for' : 'This copy of Keeper has no Google sign-in set up (Settings → Mail & Calendar → Google and Microsoft sign-in)'} onClick={() => void connect('google')}>{busy === 'google' ? <div className="spinner" /> : <Icon name="globe" size={13} />} Google Calendar</button>
        <button className="btn sm" disabled={!oauth.microsoft || !!busy} title={oauth.microsoft ? 'Microsoft 365 or Outlook.com calendars through Microsoft Graph' : 'This copy of Keeper has no Microsoft sign-in set up'} onClick={() => void connect('microsoft')}>{busy === 'microsoft' ? <div className="spinner" /> : <Icon name="globe" size={13} />} Microsoft 365 / Outlook</button>
        <button className="btn sm" onClick={() => setAdding('caldav')}><Icon name="plus" size={13} /> iCloud, Fastmail, Nextcloud, CalDAV…</button>
        <button className="btn sm" onClick={async () => { const n = await api.pim.importIcs().catch((e) => { toast(clean(e)); return 0; }); if (n) toast(`Imported ${n} event${n === 1 ? '' : 's'}`); }}><Icon name="down" size={13} /> Import .ics</button>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <input className="input grow" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void subscribe()} placeholder="Subscribe to a calendar link (https://… or webcal://…)" aria-label="Calendar link to subscribe to" />
        <button className="btn sm" disabled={!link.trim() || busy === 'link'} onClick={() => void subscribe()}>Subscribe</button>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)', marginTop: 8 }}>
        <div><div style={{ fontWeight: 600 }}>Holidays</div><div className="small muted">Nationwide public holidays, worked out on this computer.</div></div>
        <select className="input" aria-label="Holidays of" value={prefs.holidayCountry ?? ''} onChange={(e) => void set({ holidayCountry: e.target.value })}>
          <option value="">None</option>
          {Object.entries(HOLIDAY_COUNTRIES).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([cc, c]) => <option key={cc} value={cc}>{c.name}</option>)}
        </select>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
        <div><div style={{ fontWeight: 600 }}>Birthdays</div><div className="small muted">From the birthdays in your contacts.</div></div>
        <Toggle on={prefs.birthdays !== false} onChange={(v) => void set({ birthdays: v })} />
      </div>

      <div style={{ fontWeight: 600, margin: '14px 0 2px' }}>Calendars</div>
      <div className="small muted" style={{ marginBottom: 4 }}>Tick to show; the colour dot changes its colour; “Island” puts its events in the Island’s countdown and Calendar tab.</div>
      {[...groups].map(([g, list]) => (
        <div key={g} className="cal-src-group">
          <div className="small muted" style={{ fontWeight: 600, margin: '8px 0 2px' }}>{g}</div>
          {list.map((c) => (
            <div key={c.id} className="row cal-src-row" style={{ gap: 8, padding: '4px 0' }}>
              <input type="checkbox" checked={c.visible} aria-label={`Show ${c.name}`} onChange={(e) => void api.pim.setCalendar(c.id, { visible: e.target.checked })} style={{ accentColor: c.color }} />
              <input type="color" className="cal-color" value={/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#8e8e93'} aria-label={`Colour of ${c.name}`} onChange={(e) => void api.pim.setCalendar(c.id, { color: e.target.value })} />
              <span className="grow ellipsis">{c.name}{c.readOnly ? <span className="small muted"> · read only</span> : null}</span>
              <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={c.island !== false} disabled={!c.visible} onChange={(e) => void api.pim.setCalendar(c.id, { island: e.target.checked })} /> Island</label>
            </div>
          ))}
        </div>
      ))}
      {adding ? <AccountDialog initialTab={adding} onClose={() => setAdding(null)} onAdded={() => { setAdding(null); void api.pim.syncCalendars().then(load); }} /> : null}
    </div>
  );
}
