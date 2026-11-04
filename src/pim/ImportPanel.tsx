// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Mail & Calendar → Import and export: the same Import flow as
// the Mail, Calendar and Reminders pages (and the only one for contacts), the
// exports, and past imports with Undo.

import { useEffect, useState } from 'react';
import type { ImportArea, ImportResult } from '../../core/pim/import-flow';
import type { CalendarInfo } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useStore } from '../state';
import { ImportDialog } from './ImportDialog';
import '../styles/pim-import.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const AREAS: { area: ImportArea; title: string; desc: string; icon: string }[] = [
  { area: 'mail', title: 'Mail', desc: 'Mailbox files, message files, Apple Mail, Thunderbird or an Outlook archive.', icon: 'mail' },
  { area: 'calendar', title: 'Calendars', desc: 'A calendar file from any app becomes a calendar of its own.', icon: 'calendar' },
  { area: 'reminders', title: 'Tasks', desc: 'Apple Reminders, Google Tasks, Microsoft To Do, Todoist or a spreadsheet.', icon: 'listCheck' },
  { area: 'contacts', title: 'Contacts', desc: 'Contact cards (.vcf) or a spreadsheet of names and addresses.', icon: 'person' },
];

export function ImportPanel() {
  const { toast } = useStore();
  const [open, setOpen] = useState<ImportArea | null>(null);
  const [history, setHistory] = useState<ImportResult[]>([]);
  const [cals, setCals] = useState<CalendarInfo[]>([]);
  const reload = () => {
    void api.pim.importHistory().then(setHistory);
    void api.pim.calendars().then((c) => setCals(c.filter((x) => !x.tasks && !x.source)));
  };
  useEffect(reload, []);
  const saved = (r: { path: string; count: number } | null, noun: string) => r && toast(`Saved ${r.count.toLocaleString()} ${noun}${r.count === 1 ? '' : 's'}`);

  return (
    <div className="col" style={{ gap: 12 }} data-testid="import-panel">
      <div className="imp-grid">
        {AREAS.map((a) => (
          <button key={a.area} className="imp-card" onClick={() => setOpen(a.area)} data-testid={`import-area-${a.area}`}>
            <span className="imp-card-icon"><Icon name={a.icon} size={18} /></span>
            <span className="imp-card-text"><b>Import {a.title.toLowerCase()}</b><small>{a.desc}</small></span>
          </button>
        ))}
      </div>
      <h4 className="imp-kicker">Export</h4>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => void api.pim.exportTasks('csv').then((r) => saved(r, 'task'), (e) => toast(clean(e)))}><Icon name="table" size={13} /> Tasks as .csv</button>
        <button className="btn sm" onClick={() => void api.pim.exportTasks('ics').then((r) => saved(r, 'task'), (e) => toast(clean(e)))}><Icon name="calendar" size={13} /> Tasks as .ics</button>
        <button className="btn sm" onClick={() => void api.pim.exportContacts('vcf').then((r) => saved(r, 'contact'), (e) => toast(clean(e)))}><Icon name="person" size={13} /> Contacts as .vcf</button>
        <button className="btn sm" onClick={() => void api.pim.exportContacts('csv').then((r) => saved(r, 'contact'), (e) => toast(clean(e)))}><Icon name="table" size={13} /> Contacts as .csv</button>
        {cals.length ? (
          <select className="input sm" aria-label="Export a calendar" value="" onChange={(e) => e.target.value && void api.pim.exportIcs(e.target.value).then((p) => p && toast(`Saved ${p.split(/[\\/]/).pop()}`), (x) => toast(clean(x)))}>
            <option value="">A calendar as .ics…</option>
            {cals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : null}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Mail: right-click a folder or an account in Mail to save it as .mbox or .eml files.</p>
      {history.length ? (
        <>
          <h4 className="imp-kicker">Past imports</h4>
          <div className="imp-history"><ul>
            {history.slice(0, 8).map((h) => (
              <li key={h.id}>
                <span className="grow"><b>{h.label}</b> <span className="muted small">{h.summary} · {new Date(h.at).toLocaleDateString()}</span></span>
                {h.undone ? <span className="muted small">Taken back</span> : <button className="btn xs ghost" onClick={() => void api.pim.undoImport(h.id).then(() => { toast('Import taken back'); reload(); }, (e) => toast(clean(e)))}><Icon name="undo" size={12} /> Undo</button>}
              </li>
            ))}
          </ul></div>
        </>
      ) : null}
      {open ? <ImportDialog area={open} onClose={() => { setOpen(null); reload(); }} /> : null}
    </div>
  );
}
