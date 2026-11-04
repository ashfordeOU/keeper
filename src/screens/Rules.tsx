// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Automations: tidy-up rules that run on their own once switched on.

import { useState } from 'react';
import { KIND_LABEL } from '../../core/classify';
import { friendlyPath, friendlyPathsIn, MB, relativeTime } from '../../core/format';
import type { FileKind, Rule, RuleAction, RuleCondition, RulePlanItem } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, Modal, PageHead, Toggle } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-b.css';

// core/rules.ts uses Node's path module, so the describers live here too.
function describeCondition(c: RuleCondition): string {
  switch (c.type) {
    case 'kind': return c.kinds.map((k) => KIND_LABEL[k].toLowerCase()).join(' or ');
    case 'ext': return c.exts.map((e) => '.' + e.replace(/^\./, '')).join(', ');
    case 'screenshot': return 'is a screenshot';
    case 'olderThanDays': return `${c.field === 'opened' ? 'not opened for' : 'older than'} ${c.days} day${c.days === 1 ? '' : 's'}`;
    case 'largerThan': return `larger than ${Math.round(c.bytes / MB)} MB`;
    case 'inFolder': return `in ${c.folder}`;
    case 'source': return `downloaded from ${c.sources.join(' or ')}`;
    case 'nameMatches': return `name matches ${c.pattern}`;
    case 'query': return `matches “${c.text}”`;
  }
}

function describeAction(a: RuleAction): string {
  if (a.type === 'trash') return 'Move to Trash';
  if (a.type === 'tag') return `Tag #${a.tag}`;
  return `Move to ${a.to}`;
}

export function Rules() {
  const { toast, info } = useStore();
  const first = useAsync(() => api.rules.list(), []);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [preview, setPreview] = useState<{ rule: Rule; plan: RulePlanItem[] | null } | null>(null);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const list = rules ?? first.data;
  const short = (p: string) => friendlyPath(p, info?.home);

  const save = async (r: Rule) => setRules(await api.rules.save(r));

  const showPlan = async (rule: Rule) => {
    setPreview({ rule, plan: null });
    setPreview({ rule, plan: await api.rules.plan(rule.id) });
  };

  const run = async (rule: Rule) => {
    setRunning(rule.id);
    try {
      const r = await api.rules.run(rule.id);
      toast(r.removed ? `${rule.name}: ${r.removed} file${r.removed === 1 ? '' : 's'} tidied` : `${rule.name}: nothing to do`);
      setPreview(null);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div>
      <PageHead title="Automations" sub="Rules that tidy up for you. They are off until you switch them on, only move files or send them to the Trash, and every run can be undone in History.">
        <button className="btn primary" onClick={() => setEditing({ id: `rule-${Date.now().toString(36)}`, name: '', enabled: false, conditions: [{ type: 'olderThanDays', days: 30 }], action: { type: 'trash' }, scope: info ? [`${info.home}${info.sep}Downloads`] : [] })}>
          <Icon name="plus" size={14} /> New rule
        </button>
      </PageHead>
      {first.loading && !list ? <Loading /> : null}
      {list && !list.length ? <Empty icon="rules" title="No rules yet">Create one to keep Downloads and your Desktop tidy automatically.</Empty> : null}
      <div className="col" style={{ gap: 10 }}>
        {(list ?? []).map((r) => (
          <div key={r.id} className="card group-card">
            <div className="head">
              <div className="icon-wrap"><Icon name={r.action.type === 'trash' ? 'trash' : 'folder'} size={17} /></div>
              <div className="grow">
                <h3>{r.name || 'Untitled rule'}</h3>
                <div className="small muted">When a file in {r.scope.map(short).join(', ') || 'any folder'} is {r.conditions.map(describeCondition).join(' and ')} → {friendlyPathsIn(describeAction(r.action), info?.home)}</div>
                {r.lastRun ? <div className="small muted">Last ran {relativeTime(r.lastRun)}</div> : null}
              </div>
              <button className="btn ghost sm" onClick={() => void showPlan(r)}><Icon name="eye" size={13} /> Preview</button>
              <button className="btn ghost sm" onClick={() => void run(r)} disabled={running === r.id}>{running === r.id ? <div className="spinner" /> : <Icon name="play" size={12} />} Run now</button>
              <button className="btn ghost sm icon" title="Edit" aria-label="Edit" onClick={() => setEditing(structuredClone(r))}><Icon name="rename" size={13} /></button>
              <Toggle on={r.enabled} onChange={(v) => void save({ ...r, enabled: v })} label={`Turn ${r.name} on`} />
            </div>
          </div>
        ))}
      </div>

      {preview ? (
        <Modal title={`Preview: ${preview.rule.name}`} onClose={() => setPreview(null)}>
          {!preview.plan ? <Loading /> : preview.plan.length === 0 ? <Empty icon="check" title="Nothing to do right now" /> : (
            <>
              <p className="small muted">{preview.plan.length} file{preview.plan.length === 1 ? '' : 's'} would be affected:</p>
              <div className="card" style={{ maxHeight: 320, overflow: 'auto' }}>
                {preview.plan.map((p) => (
                  <div key={p.file.path} className="item-row">
                    <Icon name={p.action.type === 'trash' ? 'trash' : 'folder'} size={13} />
                    <span className="grow ellipsis" title={p.file.path}>{p.file.name}</span>
                    {p.to ? <span className="small muted ellipsis" style={{ maxWidth: 300 }} title={p.to}>→ {short(p.to)}</span> : <span className="small muted">→ Trash</span>}
                  </div>
                ))}
              </div>
              <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                <button className="btn" onClick={() => setPreview(null)}>Close</button>
                <button className="btn primary" onClick={() => void run(preview.rule)}>Run now</button>
              </div>
            </>
          )}
        </Modal>
      ) : null}

      {editing ? (
        <RuleEditor
          rule={editing}
          isNew={!(list ?? []).some((r) => r.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={async (r) => { await save(r); setEditing(null); toast('Rule saved'); }}
          onDelete={async () => { setRules(await api.rules.remove(editing.id)); setEditing(null); }}
        />
      ) : null}
    </div>
  );
}

const KINDS: FileKind[] = ['image', 'video', 'audio', 'document', 'archive', 'installer', 'app', 'code', 'other'];
type CondType = RuleCondition['type'];

function blank(type: CondType): RuleCondition {
  switch (type) {
    case 'kind': return { type, kinds: ['installer'] };
    case 'ext': return { type, exts: ['zip'] };
    case 'screenshot': return { type };
    case 'olderThanDays': return { type, days: 30 };
    case 'largerThan': return { type, bytes: 100 * MB };
    case 'inFolder': return { type, folder: '' };
    case 'source': return { type, sources: ['gmail'] };
    case 'nameMatches': return { type, pattern: '*.part' };
    case 'query': return { type, text: 'pdfs from gmail' };
  }
}

function RuleEditor({ rule, isNew, onClose, onSave, onDelete }: { rule: Rule; isNew: boolean; onClose: () => void; onSave: (r: Rule) => void; onDelete: () => void }) {
  const { info } = useStore();
  const [r, setR] = useState<Rule>(rule);
  const setCond = (i: number, c: RuleCondition) => setR({ ...r, conditions: r.conditions.map((x, j) => (j === i ? c : x)) });

  return (
    <Modal title={isNew ? 'New rule' : 'Edit rule'} onClose={onClose} width={660}>
      <div className="col" style={{ gap: 12 }}>
        <label className="col"><span className="small muted">Name</span><input className="input" value={r.name} autoFocus placeholder="e.g. Clear old zips from Downloads" onChange={(e) => setR({ ...r, name: e.target.value })} /></label>

        <div className="col">
          <span className="small muted">Look in</span>
          <div className="list-box">
            {r.scope.map((s) => (
              <div key={s} className="li"><Icon name="folder" size={13} /><span className="grow ellipsis" title={s}>{friendlyPath(s, info?.home)}</span><button aria-label="Remove folder" title="Remove folder" className="btn ghost sm icon" onClick={() => setR({ ...r, scope: r.scope.filter((x) => x !== s) })}><Icon name="close" size={12} /></button></div>
            ))}
          </div>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={async () => { const p = await api.settings.pickFolder(); if (p && !r.scope.includes(p)) setR({ ...r, scope: [...r.scope, p] }); }}><Icon name="plus" size={12} /> Add folder</button>
          <span className="small muted">Rules look at the top of each folder only, never into sub-folders.</span>
        </div>

        <div className="col">
          <span className="small muted">When a file…</span>
          {r.conditions.map((c, i) => (
            <div key={i} className="row">
              <select className="input" value={c.type} onChange={(e) => setCond(i, blank(e.target.value as CondType))} style={{ width: 190 }}>
                <option value="kind">is a kind of file</option>
                <option value="ext">has extension</option>
                <option value="screenshot">is a screenshot</option>
                <option value="olderThanDays">is older than</option>
                <option value="largerThan">is larger than</option>
                <option value="nameMatches">name matches</option>
                <option value="query">matches a search</option>
              </select>
              {c.type === 'kind' ? (
                <select className="input grow" value={c.kinds[0]} onChange={(e) => setCond(i, { type: 'kind', kinds: [e.target.value as FileKind] })}>
                  {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              ) : c.type === 'ext' ? (
                <input className="input grow" value={c.exts.join(', ')} placeholder="zip, dmg, exe" onChange={(e) => setCond(i, { type: 'ext', exts: e.target.value.split(/[,\s]+/).filter(Boolean) })} />
              ) : c.type === 'olderThanDays' ? (
                <><input className="input" type="number" min={1} value={c.days} style={{ width: 90 }} onChange={(e) => setCond(i, { ...c, days: Math.max(1, Number(e.target.value)) })} /><span className="small">days</span></>
              ) : c.type === 'largerThan' ? (
                <><input className="input" type="number" min={1} value={Math.round(c.bytes / MB)} style={{ width: 90 }} onChange={(e) => setCond(i, { type: 'largerThan', bytes: Math.max(1, Number(e.target.value)) * MB })} /><span className="small">MB</span></>
              ) : c.type === 'nameMatches' ? (
                <input className="input grow" value={c.pattern} placeholder="*.part|report-*" onChange={(e) => setCond(i, { type: 'nameMatches', pattern: e.target.value })} />
              ) : c.type === 'query' ? (
                <input className="input grow" value={c.text} placeholder="screenshots older than a month" onChange={(e) => setCond(i, { type: 'query', text: e.target.value })} />
              ) : <span className="grow" />}
              {r.conditions.length > 1 ? <button aria-label="Remove condition" title="Remove condition" className="btn ghost sm icon" onClick={() => setR({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })}><Icon name="minus" size={12} /></button> : null}
            </div>
          ))}
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setR({ ...r, conditions: [...r.conditions, blank('olderThanDays')] })}><Icon name="plus" size={12} /> And…</button>
        </div>

        <div className="col">
          <span className="small muted">Then</span>
          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            <button className={r.action.type === 'trash' ? 'on' : ''} onClick={() => setR({ ...r, action: { type: 'trash' } })}>Move to Trash</button>
            <button className={r.action.type === 'move' ? 'on' : ''} onClick={() => setR({ ...r, action: { type: 'move', to: r.scope[0] ? `${r.scope[0]}/{yyyy}-{MM}` : '' } })}>Move to folder</button>
          </div>
          {r.action.type === 'move' ? (
            <>
              <div className="row">
                <input className="input grow" value={r.action.to} onChange={(e) => setR({ ...r, action: { type: 'move', to: e.target.value } })} />
                <button className="btn sm" onClick={async () => { const p = await api.settings.pickFolder(); if (p) setR({ ...r, action: { type: 'move', to: p } }); }}>Choose…</button>
              </div>
              <span className="small muted">Placeholders: {'{yyyy}'} year, {'{MM}'} month, {'{dd}'} day, {'{kind}'} Images/Videos…, {'{ext}'} extension, {'{source}'} where it was downloaded from.</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
        {!isNew ? <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={onDelete}>Delete rule</button> : <span />}
        <div className="btn-row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!r.name.trim() || !r.conditions.length || (r.action.type === 'move' && !r.action.to)} onClick={() => onSave(r)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
