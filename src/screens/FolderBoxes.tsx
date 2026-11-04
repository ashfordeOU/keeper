// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Folder boxes on the Widgets page: a box's own options (folder, name, order,
// which kind, and an Automation that sends new desktop files of a kind into it),
// and "Tidy my desktop into boxes" with a look at what moves before anything does.

import { useEffect, useState, type ReactNode } from 'react';
import type { BoxesStatus } from '../../core/api-boxes';
import { BOX_GROUPS, baseName, boxRule, ruleForBox, type BoxGroup, type BoxSort, type TidyPlan } from '../../core/folder-boxes';
import type { WidgetConfig } from '../../core/widgets';
import { api } from '../api';
import { useFeature } from '../features';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';
import { useStore } from '../state';
import '../styles/desk.css';

type Opt = (patch: Partial<WidgetConfig['options']>) => void;
type RowFn = (label: string, el: ReactNode) => ReactNode;

function useBoxesStatus(): BoxesStatus | null {
  const [st, setSt] = useState<BoxesStatus | null>(null);
  useEffect(() => { void api.boxes.status().then(setSt).catch(() => undefined); }, []);
  return st;
}

export function BoxEditor({ w, opt, row }: { w: WidgetConfig; opt: Opt; row: RowFn }) {
  const { settings, updateSettings, go } = useStore();
  const st = useBoxesStatus();
  const rulesOn = useFeature('rules');
  const folder = w.options.folder;
  const rule = folder && settings ? ruleForBox(settings.rules, folder) : undefined;
  const ruleGroup = rule ? BOX_GROUPS.find((g) => rule.conditions.some((c) => c.type === 'kind' && g.kinds.every((k) => c.kinds.includes(k))))?.id ?? (rule.conditions.some((c) => c.type === 'ext') ? 'apps' : '') : '';
  const setRule = (g: BoxGroup | '') => {
    if (!settings || !folder || !st) return;
    const rest = settings.rules.filter((r) => r !== rule);
    void updateSettings({ rules: g ? [...rest, boxRule(g, folder, st.desktop)] : rest });
  };
  return (
    <>
      {row('Folder', <button className="btn sm" data-testid="box-folder" onClick={() => void api.settings.pickFolder().then((f) => f && opt({ folder: f }))}><Icon name="folder" size={12} /> {folder ? baseName(folder) : 'Choose…'}</button>)}
      {row('Name', <input className="input" value={w.options.title ?? ''} placeholder={folder ? baseName(folder) : 'Folder box'} onChange={(e) => opt({ title: e.target.value })} />)}
      {row('Order', <div className="seg">{(['name', 'kind', 'date', 'size'] as BoxSort[]).map((s) => <button key={s} className={(w.options.sort ?? 'kind') === s ? 'on' : ''} onClick={() => opt({ sort: s })}>{s === 'date' ? 'Newest' : s === 'size' ? 'Largest' : s[0].toUpperCase() + s.slice(1)}</button>)}</div>)}
      {row('Show', (
        <select className="input" value={w.options.show ?? 'all'} onChange={(e) => opt({ show: e.target.value as BoxGroup | 'all' })}>
          <option value="all">Everything</option>
          {BOX_GROUPS.map((g) => <option key={g.id} value={g.id}>Only {g.name.toLowerCase()}</option>)}
        </select>
      ))}
      {folder ? row('New desktop files here', (
        <span className="row">
          <select className="input" value={ruleGroup} aria-label="Send new desktop files of this kind into the box" data-testid="box-rule" onChange={(e) => setRule(e.target.value as BoxGroup | '')}>
            <option value="">None</option>
            {BOX_GROUPS.filter((g) => g.id !== 'other').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {ruleGroup && !rulesOn ? <button className="link-like small" onClick={() => go({ name: 'rules' })}>Turn on Automations</button> : null}
        </span>
      )) : null}
    </>
  );
}

export function TidyBoxes() {
  const { toast } = useStore();
  const st = useBoxesStatus();
  const [plan, setPlan] = useState<TidyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const look = async () => {
    try { setPlan(await api.boxes.planTidy()); } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };
  const tidy = async () => {
    setBusy(true);
    try {
      const r = await api.boxes.tidy();
      setPlan(null);
      toast(`Moved ${r.moved} file${r.moved === 1 ? '' : 's'} into ${r.boxes} box${r.boxes === 1 ? '' : 'es'}`, r.journalId ? { label: 'Undo', run: () => void api.history.undo(r.journalId!) } : undefined);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="section" data-testid="boxes-tidy">
      <div className="card desk-tidy">
        <span className="desk-tidy-icon" aria-hidden><Icon name="folder" size={20} /></span>
        <div className="grow">
          <b>Tidy the desktop into boxes</b>
          <div className="small muted">Loose files go into one folder per kind, each with its own box. Undo puts them back.</div>
          {st?.floats ? <div className="small muted">On Wayland, boxes are ordinary windows, so they may sit over other apps.</div> : null}
        </div>
        <button className="btn" data-testid="boxes-tidy-look" onClick={() => void look()}>Tidy my desktop…</button>
      </div>
      {plan ? (
        <Modal title="Tidy the desktop" onClose={() => setPlan(null)} width={460} testId="boxes-plan">
          {plan.moves.length ? (
            <>
              <p className="small muted">{plan.moves.length} file{plan.moves.length === 1 ? '' : 's'} move into {plan.boxes.length} folder{plan.boxes.length === 1 ? '' : 's'} on the desktop, each shown in a box. {plan.kept ? 'Folders and hidden files stay where they are.' : ''}</p>
              <ul className="desk-list" aria-label="Boxes">
                {plan.boxes.map((b) => (
                  <li key={b.group} className="desk-row">
                    <Icon name={BOX_GROUPS.find((g) => g.id === b.group)?.icon ?? 'folder'} size={16} />
                    <span className="grow">{b.name}{b.create ? '' : <span className="muted small"> · folder already there</span>}</span>
                    <span className="muted small">{b.count} file{b.count === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ul>
              <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn" onClick={() => setPlan(null)}>Cancel</button>
                <button className="btn primary" disabled={busy} data-testid="boxes-tidy-go" onClick={() => void tidy()}>Tidy into {plan.boxes.length} box{plan.boxes.length === 1 ? '' : 'es'}</button>
              </div>
            </>
          ) : (
            <>
              <p className="small">Your desktop is already tidy: there are no loose files to move.</p>
              <div className="btn-row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => setPlan(null)}>Close</button></div>
            </>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
