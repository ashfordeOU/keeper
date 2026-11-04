// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Making or changing a combined mailbox: tick the accounts' inboxes or any
// folders to see as one list, and give it a name.

import { useState } from 'react';
import { suggestName, type UnifiedSource, type UnifiedView } from '../../core/pim/unified';
import type { Account, MailFolder } from '../../core/pim/types';
import { Check, Modal } from '../components/ui';
import { AccountMark } from './mail-parts';

export function CombineDialog({ accounts, folders, view, onSave, onRemove, onClose }: { accounts: Account[]; folders: MailFolder[]; view?: UnifiedView; onSave: (v: UnifiedView) => void; onRemove?: () => void; onClose: () => void }) {
  const [sources, setSources] = useState<UnifiedSource[]>(view?.sources ?? accounts.map((a) => ({ account: a.id, folder: 'inbox' })));
  const [name, setName] = useState(view?.name ?? '');
  const [more, setMore] = useState<string | null>(null);
  const has = (s: UnifiedSource) => sources.some((x) => x.account === s.account && x.folder === s.folder);
  const toggle = (s: UnifiedSource, on: boolean) => setSources((l) => (on ? [...l.filter((x) => !(x.account === s.account && x.folder === s.folder)), s] : l.filter((x) => !(x.account === s.account && x.folder === s.folder))));
  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? id;
  const shownName = name.trim() || suggestName(sources, label);

  return (
    <Modal title={view ? 'Change combined mailbox' : 'Combine mailboxes'} onClose={onClose} width={520} testId="combine-dialog">
      <div className="col" style={{ gap: 12 }}>
        <p className="small muted" style={{ margin: 0 }}>Pick the inboxes or folders to read as one list.</p>
        {accounts.map((a) => {
          const own = folders.filter((f) => f.account === a.id && f.special !== 'inbox');
          return (
            <div key={a.id} className="combine-account">
              <div className="row" style={{ gap: 8 }}>
                <Check on={has({ account: a.id, folder: 'inbox' })} onChange={(v) => toggle({ account: a.id, folder: 'inbox' }, v)} label={`${a.label} inbox`} />
                <AccountMark a={a} /><b className="grow ellipsis">{a.label}</b><span className="small muted">Inbox</span>
                {own.length ? <button className="link-like small" aria-expanded={more === a.id} onClick={() => setMore(more === a.id ? null : a.id)}>{more === a.id ? 'Fewer' : 'Other folders'}</button> : null}
              </div>
              {more === a.id ? (
                <div className="combine-folders">
                  {own.map((f) => (
                    <label key={f.path} className="row small" style={{ gap: 8 }}>
                      <Check on={has({ account: a.id, folder: f.path })} onChange={(v) => toggle({ account: a.id, folder: f.path }, v)} label={`${a.label} ${f.name}`} />
                      <span className="ellipsis">{f.path}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <label className="field"><span>Name</span><input className="input" value={name} placeholder={suggestName(sources, label)} onChange={(e) => setName(e.target.value)} data-testid="combine-name" /></label>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          {onRemove ? <button className="btn ghost danger" onClick={onRemove}>Remove</button> : null}
          <span className="grow" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!sources.length} onClick={() => onSave({ id: view?.id ?? `v${Date.now().toString(36)}`, name: shownName, sources })} data-testid="combine-save">{view ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </Modal>
  );
}
