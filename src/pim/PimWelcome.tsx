// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The first screens of Mail, Calendar and Reminders when nothing is there
// yet: a small drawing in Keeper's line style, one clear way in, an import
// for what you already have, and one line about privacy.

import { useState } from 'react';
import type { GuideId } from '../../core/pim/provider-guides';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useAsync, useStore } from '../state';
import { AccountDialog } from './AccountDialog';
import '../styles/pim-import.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Keeper's drawing for the three parts: a letter, a calendar page and a tick, in the icon line style. */
export function PimArt({ kind }: { kind: 'mail' | 'calendar' | 'reminders' }) {
  return (
    <svg className="pim-art" width="168" height="112" viewBox="0 0 168 112" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle className="soft" cx="84" cy="58" r="50" />
      {kind === 'mail' ? (
        <g>
          <rect className="paper" x="44" y="34" width="80" height="54" rx="9" />
          <path d="M46 38 84 64l38-26" stroke="currentColor" />
          <path className="line" d="M58 78h22M58 84h14" />
          <circle className="glow" cx="122" cy="36" r="7" />
        </g>
      ) : kind === 'calendar' ? (
        <g>
          <rect className="paper" x="48" y="28" width="72" height="64" rx="9" />
          <path d="M48 44h72M66 22v12M102 22v12" stroke="currentColor" />
          <path className="line" d="M60 58h8M80 58h8M100 58h8M60 72h8M80 72h8" />
          <rect x="98" y="68" width="12" height="10" rx="3" fill="currentColor" stroke="none" />
        </g>
      ) : (
        <g>
          <rect className="paper" x="46" y="26" width="76" height="68" rx="9" />
          <path d="m58 44 5 5 9-10M58 62l5 5 9-10" stroke="currentColor" />
          <rect x="58" y="76" width="10" height="10" rx="3" stroke="currentColor" />
          <path className="line" d="M80 46h30M80 64h24M80 81h28" />
          <circle className="glow" cx="120" cy="28" r="7" />
        </g>
      )}
    </svg>
  );
}

/** The providers with their own button; each starts its own flow. */
const PROVIDERS: { id: GuideId; name: string; mono: string; tint: string }[] = [
  { id: 'gmail', name: 'Gmail', mono: 'G', tint: 'var(--accent)' },
  { id: 'outlook', name: 'Outlook', mono: 'O', tint: '#3a7bd5' },
  { id: 'icloud', name: 'iCloud', mono: 'i', tint: '#5a6b7d' },
  { id: 'yahoo', name: 'Yahoo', mono: 'Y', tint: '#7a54c7' },
  { id: 'fastmail', name: 'Fastmail', mono: 'F', tint: '#2f7d6b' },
  { id: 'imap', name: 'Other', mono: '@', tint: '#8a8a94' },
];

export function MailWelcome({ onAdded, onImport }: { onAdded: () => void; onImport: () => void }) {
  const { toast } = useStore();
  const oauth = useAsync(() => api.pim.oauthReady(), []);
  const [dialog, setDialog] = useState<GuideId | null>(null);
  const [busy, setBusy] = useState<GuideId | null>(null);

  const start = async (id: GuideId) => {
    // Gmail and Outlook sign in straight away when this copy of Keeper can.
    const p = id === 'gmail' ? 'google' : id === 'outlook' ? 'microsoft' : null;
    if (p && oauth.data?.[p]) {
      setBusy(id);
      try {
        await api.pim.signIn(p);
        onAdded();
      } catch (e) {
        if (!/cancel/i.test(clean(e))) toast(clean(e));
      } finally {
        setBusy(null);
      }
      return;
    }
    setDialog(id);
  };

  return (
    <div className="pim-welcome" data-testid="mail-welcome">
      <div className="pim-welcome-card">
        <PimArt kind="mail" />
        <span className="pim-kicker">Mail</span>
        <h2>Bring your <em>mail</em> home</h2>
        <p>Pick your provider to sign in. Keeper finds the servers for you.</p>
        <div className="pim-providers" role="group" aria-label="Add a mail account">
          {PROVIDERS.map((p) => (
            <button key={p.id} className="pim-provider" onClick={() => void start(p.id)} disabled={!!busy} data-testid={`provider-${p.id}`}>
              <span className="pim-mono" style={{ background: p.tint }} aria-hidden>{busy === p.id ? <span className="spinner" /> : p.mono}</span>
              {p.name}
            </button>
          ))}
        </div>
        <div className="pim-welcome-actions">
          <button className="btn ghost" onClick={onImport} data-testid="mail-import"><Icon name="down" size={14} /> Import mail from another app</button>
        </div>
        <span className="pim-trust"><Icon name="lock" size={12} /> Your mail goes straight between this computer and your provider · Passwords in your keychain</span>
      </div>
      {dialog ? <AccountDialog provider={dialog} onClose={() => setDialog(null)} onAdded={() => { setDialog(null); onAdded(); }} /> : null}
    </div>
  );
}

export function CalendarWelcome({ onConnect, onImport }: { onConnect: () => void; onImport: () => void }) {
  return (
    <div className="pim-welcome" data-testid="calendar-welcome">
      <div className="pim-welcome-card">
        <PimArt kind="calendar" />
        <span className="pim-kicker">Calendar</span>
        <h2>Your days, in <em>one</em> place</h2>
        <p>Connect the calendars you use, or type an event above to start one here.</p>
        <div className="pim-welcome-actions">
          <button className="btn primary" onClick={onConnect} data-testid="calendar-connect"><Icon name="plus" size={14} /> Connect a calendar</button>
          <button className="btn ghost" onClick={onImport}><Icon name="down" size={14} /> Import a calendar file</button>
        </div>
        <span className="pim-trust"><Icon name="lock" size={12} /> On this computer · Your system’s calendars are read, never sent anywhere</span>
      </div>
    </div>
  );
}

export function RemindersWelcome({ onNew, onImport }: { onNew: () => void; onImport: () => void }) {
  return (
    <div className="pim-welcome" data-testid="reminders-welcome">
      <div className="pim-welcome-card">
        <PimArt kind="reminders" />
        <span className="pim-kicker">Reminders</span>
        <h2>A clear head, <em>one</em> list</h2>
        <p>Write what’s on your mind. “Call the bank tomorrow 10am” sets the time.</p>
        <div className="pim-welcome-actions">
          <button className="btn primary" onClick={onNew} data-testid="reminders-new"><Icon name="plus" size={14} /> New reminder</button>
          <button className="btn ghost" onClick={onImport} data-testid="reminders-import"><Icon name="down" size={14} /> Import from another app</button>
        </div>
        <span className="pim-trust"><Icon name="lock" size={12} /> On this computer · Undo anytime</span>
      </div>
    </div>
  );
}
