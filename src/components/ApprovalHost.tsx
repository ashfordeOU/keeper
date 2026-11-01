// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// When an agent asks to do something that needs the person's yes (move files,
// send to the Trash, quit a program…), Keeper shows who wants to do what.
// Nothing happens until they answer; no answer within two minutes means no.

import { useEffect, useState } from 'react';
import type { ApprovalRequest } from '../../core/api-agents';
import { api } from '../api';
import { Icon } from './Icon';

export function ApprovalHost() {
  const [list, setList] = useState<ApprovalRequest[]>([]);
  useEffect(() => {
    void api.agents.pending().then(setList).catch(() => undefined);
    const offs = [
      api.on('agent-approval', (a) => setList((l) => (l.some((x) => x.id === a.id) ? l : [...l, a]))),
      api.on('agent-approval-done', (id) => setList((l) => l.filter((x) => x.id !== id))),
    ];
    return () => offs.forEach((o) => o());
  }, []);
  const a = list[0];
  if (!a) return null;
  const decide = (d: 'once' | 'always' | 'deny') => {
    setList((l) => l.filter((x) => x.id !== a.id));
    void api.agents.decide(a.id, d);
  };
  return (
    <div className="approval-back" role="dialog" aria-modal="true" aria-label="An agent asks for permission">
      <div className={`approval card ${a.destructive ? 'destructive' : ''}`}>
        <div className="row" style={{ gap: 10 }}>
          <span className="approval-icon"><Icon name="agent" size={20} /></span>
          <div className="grow">
            <div className="small muted">An agent asks</div>
            <div className="approval-text"><b>{a.client}</b> wants to {a.description}.</div>
          </div>
        </div>
        {a.action === 'computer' ? (
          <div className="small approval-warn"><Icon name="warning" size={13} /> It will act as you in whatever is on screen. Password managers, keychains and terminals stay off limits, passwords are never typed, and the Island shows it while it works.</div>
        ) : a.action === 'terminal' && a.destructive ? <div className="small approval-warn"><Icon name="warning" size={13} /> A terminal command runs as you; what it deletes or changes does not go to the Trash and cannot be undone by Keeper.</div>
        : a.destructive ? <div className="small approval-warn"><Icon name="warning" size={13} /> This can lose work. Files only go to the Trash, but a program that quits loses what it had not saved.</div> : null}
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn" onClick={() => decide('deny')} autoFocus>Don't allow</button>
          <button className="btn" onClick={() => decide('always')} title="Allow this kind of action from now on (change it under Agents → What agents may do)">Always allow</button>
          <button className="btn primary" onClick={() => decide('once')}>Allow once</button>
        </div>
        {list.length > 1 ? <div className="small muted" style={{ marginTop: 8 }}>{list.length - 1} more waiting</div> : null}
      </div>
    </div>
  );
}
