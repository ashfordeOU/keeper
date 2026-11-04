// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Mail & Calendar, the parts for Mail's second round: rules (run
// here as mail arrives, and on the server where it can), send-from addresses
// with their own signature and Reply-To, account colour and picture, the
// reading view, templates, saved searches, AI memory, the notch and the Dock
// badge, privacy (the connections Mail makes) and adding Keeper to AI apps.

import { useEffect, useState } from 'react';
import type { MailTemplate } from '../../core/pim/compose-rich';
import { describeRule, type Rule, type RuleAction, type RuleCondition, type RuleField } from '../../core/pim/rules';
import type { PimPrefsView, SmartMailbox } from '../../core/pim/prefs';
import { MAIL_CONNECTIONS, MAIL_NEVER } from '../../core/pim/privacy';
import type { Account, Identity, MailFolder } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal, Toggle } from '../components/ui';
import { useStore } from '../state';
import { sanitizeSignature } from '../../core/pim/signatures';
import { AddressSignatures, AliasServer } from './SignatureEditor';

const FIELDS: { id: RuleField | 'attachment'; label: string }[] = [
  { id: 'from', label: 'Sender' }, { id: 'to', label: 'Recipients' }, { id: 'subject', label: 'Subject' }, { id: 'body', label: 'Text' },
  { id: 'list', label: 'Mailing list' }, { id: 'attachment', label: 'Attachments' }, { id: 'any', label: 'Anything' },
];
const ACTIONS: { id: RuleAction['action']; label: string }[] = [
  { id: 'move', label: 'Move to folder' }, { id: 'archive', label: 'Archive' }, { id: 'read', label: 'Mark as read' }, { id: 'flag', label: 'Flag' },
  { id: 'label', label: 'Add a label' }, { id: 'trash', label: 'Delete' },
];
const uid = () => Math.random().toString(36).slice(2, 10);

function actionOf(id: string, prev?: RuleAction): RuleAction {
  if (id === 'move') return { action: 'move', folder: prev && 'folder' in prev ? prev.folder : '' };
  if (id === 'label') return { action: 'label', label: prev && 'label' in prev ? prev.label : '' };
  return { action: id } as RuleAction;
}

function ActionPicker({ value, onChange, folders, onRemove }: { value: RuleAction; onChange: (a: RuleAction) => void; folders: string[]; onRemove?: () => void }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <select className="input" aria-label="Action" value={value.action} onChange={(e) => onChange(actionOf(e.target.value, value))}>{ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
      {value.action === 'move' ? (
        <>
          <input className="input" style={{ width: 140 }} list="rule-folders" aria-label="Folder" placeholder="Folder" value={value.folder} onChange={(e) => onChange({ action: 'move', folder: e.target.value })} />
          <datalist id="rule-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
        </>
      ) : null}
      {value.action === 'label' ? <input className="input" style={{ width: 120 }} aria-label="Label" placeholder="Label" value={value.label} onChange={(e) => onChange({ action: 'label', label: e.target.value })} /> : null}
      {onRemove ? <button className="btn sm ghost icon" aria-label="Remove action" title="Remove action" onClick={onRemove}><Icon name="close" size={11} /></button> : null}
    </span>
  );
}

/** One rule, edited in place: conditions (all or any), actions, account, and "also on the server". */
function RuleRow({ r, set, remove, accounts, folders }: { r: Rule; set: (r: Rule) => void; remove: () => void; accounts: Account[]; folders: string[] }) {
  const cond = (i: number, c: RuleCondition) => set({ ...r, when: r.when.map((x, j) => (j === i ? c : x)) });
  return (
    <div className="rule-row" data-testid="mail-rule">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Toggle on={r.enabled} onChange={(v) => set({ ...r, enabled: v })} />
        <input className="input" style={{ width: 180 }} placeholder="Name (optional)" aria-label="Rule name" value={r.name} onChange={(e) => set({ ...r, name: e.target.value })} />
        <select className="input" aria-label="Account" value={r.account ?? ''} onChange={(e) => set({ ...r, account: e.target.value || undefined })}>
          <option value="">Every account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <label className="row small" style={{ gap: 6 }} title="Also written to the mail server (Sieve) or to Gmail's filters, so it works while Keeper is closed"><input type="checkbox" checked={!!r.server} onChange={(e) => set({ ...r, server: e.target.checked })} /> Also on the server</label>
        <span className="grow" />
        <button className="btn sm ghost icon" aria-label="Remove rule" title="Remove rule" onClick={remove}><Icon name="trash" size={12} /></button>
      </div>
      <div className="col" style={{ gap: 4, marginTop: 6 }}>
        {r.when.map((c, i) => (
          <div key={i} className="row small" style={{ gap: 6 }}>
            <span style={{ width: 36 }}>{i === 0 ? 'If' : r.match === 'any' ? 'or' : 'and'}</span>
            <select className="input" aria-label="Condition" value={c.field} onChange={(e) => cond(i, e.target.value === 'attachment' ? { field: 'attachment', has: true } : { field: e.target.value as RuleField, contains: 'contains' in c ? c.contains : '' })}>
              {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            {c.field === 'attachment'
              ? <select className="input" aria-label="Has attachments" value={c.has ? 'yes' : 'no'} onChange={(e) => cond(i, { field: 'attachment', has: e.target.value === 'yes' })}><option value="yes">are there</option><option value="no">are not there</option></select>
              : <><span>contains</span><input className="input" style={{ width: 180 }} aria-label="Text" value={c.contains} onChange={(e) => cond(i, { field: c.field, contains: e.target.value })} /></>}
            {r.when.length > 1 ? <button className="btn sm ghost icon" aria-label="Remove condition" onClick={() => set({ ...r, when: r.when.filter((_, j) => j !== i) })}><Icon name="close" size={11} /></button> : null}
          </div>
        ))}
        <div className="row small" style={{ gap: 6 }}>
          <button className="link-like small" onClick={() => set({ ...r, when: [...r.when, { field: 'subject', contains: '' }] })}>+ condition</button>
          {r.when.length > 1 ? <select className="input" aria-label="Match" value={r.match ?? 'all'} onChange={(e) => set({ ...r, match: e.target.value as 'all' | 'any' })}><option value="all">all must match</option><option value="any">any may match</option></select> : null}
        </div>
        <div className="row small" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span style={{ width: 36 }}>Then</span>
          <ActionPicker value={r.then} folders={folders} onChange={(a) => set({ ...r, then: a })} />
          {(r.also ?? []).map((a, i) => <ActionPicker key={i} value={a} folders={folders} onChange={(x) => set({ ...r, also: (r.also ?? []).map((y, j) => (j === i ? x : y)) })} onRemove={() => set({ ...r, also: (r.also ?? []).filter((_, j) => j !== i) })} />)}
          <button className="link-like small" onClick={() => set({ ...r, also: [...(r.also ?? []), { action: 'read' }] })}>+ action</button>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={r.stop !== false} onChange={(e) => set({ ...r, stop: e.target.checked ? undefined : false })} /> stop here</label>
        </div>
        <div className="small muted">{describeRule(r)}</div>
      </div>
    </div>
  );
}

export function RulesEditor({ rules, setRules, accounts }: { rules: Rule[]; setRules: (r: Rule[]) => void; accounts: Account[] }) {
  const { toast } = useStore();
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [status, setStatus] = useState<{ label: string; ok: boolean; message: string }[] | null>(null);
  useEffect(() => { void api.pim.folders().then(setFolders); }, []);
  const names = [...new Set(folders.map((f) => f.path))];
  return (
    <div className="col" style={{ gap: 8 }}>
      {rules.map((r, i) => <RuleRow key={r.id} r={r} accounts={accounts.filter((a) => a.mail)} folders={names} set={(x) => setRules(rules.map((y, j) => (j === i ? x : y)))} remove={() => setRules(rules.filter((_, j) => j !== i))} />)}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm ghost" data-testid="mail-rule-add" onClick={() => setRules([...rules, { id: uid(), name: '', enabled: true, when: [{ field: 'from', contains: '' }], then: { action: 'archive' } }])}><Icon name="plus" size={13} /> Add rule</button>
        {rules.some((r) => r.server) ? <button className="btn sm ghost" onClick={async () => { try { setStatus(await api.pim.syncServerRules()); } catch (e) { toast(String(e)); } }}><Icon name="refresh" size={12} /> Write to the servers now</button> : null}
      </div>
      {status ? status.map((s) => <div key={s.label} className="small" style={{ color: s.ok ? 'var(--ok, inherit)' : 'var(--warn)' }}>{s.label}: {s.message}</div>) : null}
    </div>
  );
}

/** Addresses an account sends as: the first is its own; aliases can have their own signature and Reply-To. */
export function IdentitiesEditor({ a }: { a: Account }) {
  const { toast } = useStore();
  const [list, setList] = useState<Identity[]>(a.identities.length ? a.identities : [{ name: '', email: a.email ?? '' }]);
  const [dirty, setDirty] = useState(false);
  const set = (i: number, p: Partial<Identity>) => { setList(list.map((x, j) => (j === i ? { ...x, ...p } : x))); setDirty(true); };
  const save = async () => {
    const clean = list.filter((x) => x.email.trim()).map((x) => ({ ...x, email: x.email.trim(), signature: x.signatures?.length ? undefined : x.signature?.trim() || undefined, signatures: x.signatures?.map((sg) => ({ ...sg, html: sanitizeSignature(sg.html) })), replyTo: x.replyTo?.trim() || undefined, smtp: x.smtp?.host ? x.smtp : undefined }));
    await api.pim.updateAccount(a.id, { identities: clean });
    setDirty(false);
    toast('Saved');
  };
  return (
    <div className="col identities" style={{ gap: 8, width: '100%' }} data-testid="mail-identities">
      {list.map((x, i) => (
        <div key={i} className="identity-row">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 150 }} placeholder="Name" aria-label="Name" value={x.name} onChange={(e) => set(i, { name: e.target.value })} />
            <input className="input" style={{ width: 200 }} placeholder="Address" aria-label="Address" value={x.email} readOnly={i === 0 && !!a.email} onChange={(e) => set(i, { email: e.target.value })} />
            <input className="input" style={{ width: 200 }} placeholder="Reply-To (optional)" aria-label="Reply-To" value={x.replyTo ?? ''} onChange={(e) => set(i, { replyTo: e.target.value })} />
            {i > 0 ? <button className="btn sm ghost icon" aria-label="Remove address" onClick={() => { setList(list.filter((_, j) => j !== i)); setDirty(true); }}><Icon name="close" size={11} /></button> : <span className="small muted">main address</span>}
          </div>
          <AddressSignatures account={a} ident={x} onChange={(p) => set(i, p)} />
          {i > 0 ? <AliasServer account={a} ident={x} onChange={(p) => set(i, p)} /> : null}
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm ghost" onClick={() => { setList([...list, { name: list[0]?.name ?? '', email: '' }]); setDirty(true); }}><Icon name="plus" size={12} /> Add a send-from address</button>
        {dirty ? <button className="btn sm primary" data-testid="mail-identities-save" onClick={() => void save()}>Save addresses</button> : null}
      </div>
      <div className="small muted">Your provider must allow sending as an alias (Gmail: “Send mail as”; Fastmail and iCloud: aliases). Replies go out from the address the mail was written to.</div>
    </div>
  );
}

const SWATCHES = ['#0a84ff', '#ff375f', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff', '#ffd60a', '#ac8e68'];

/** Colour, picture and the reading view of one account. */
export function AccountLook({ a }: { a: Account }) {
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => {
        // Kept small: 96 px square.
        const c = document.createElement('canvas');
        c.width = c.height = 96;
        const g = c.getContext('2d')!;
        const s = Math.min(img.width, img.height);
        g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96);
        void api.pim.updateAccount(a.id, { picture: c.toDataURL('image/png') });
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(f);
    };
    input.click();
  };
  return (
    <div className="row small" style={{ gap: 10, flexWrap: 'wrap' }}>
      <span>Colour</span>
      <span className="row" style={{ gap: 4 }}>{SWATCHES.map((c) => <button key={c} className={`swatch ${a.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => void api.pim.updateAccount(a.id, { color: c })} />)}</span>
      <span>Picture</span>
      {a.picture ? <img src={a.picture} alt="" className="acct-pic" /> : null}
      <button className="btn sm ghost" onClick={pick}>{a.picture ? 'Change…' : 'Choose…'}</button>
      {a.picture ? <button className="btn sm ghost" onClick={() => void api.pim.updateAccount(a.id, { picture: undefined })}>Remove</button> : null}
      <span>Conversations</span>
      <div className="seg"><button className={(a.readingView ?? 'classic') === 'classic' ? 'on' : ''} onClick={() => void api.pim.updateAccount(a.id, { readingView: 'classic' })}>Classic</button><button className={a.readingView === 'chat' ? 'on' : ''} onClick={() => void api.pim.updateAccount(a.id, { readingView: 'chat' })}>Chat</button></div>
      <label className="row" style={{ gap: 6 }}><Toggle on={a.notch !== false} onChange={(v) => void api.pim.updateAccount(a.id, { notch: v })} /> In the notch</label>
    </div>
  );
}

export function TemplatesEditor({ prefs, set }: { prefs: PimPrefsView; set: (p: Partial<PimPrefsView>) => void }) {
  const list = prefs.templates ?? [];
  const put = (l: MailTemplate[]) => set({ templates: l });
  return (
    <div className="col" style={{ gap: 6 }}>
      {list.map((t, i) => (
        <div key={t.id} className="col" style={{ gap: 4, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
          <div className="row" style={{ gap: 6 }}>
            <input className="input" style={{ width: 180 }} placeholder="Name" aria-label="Template name" value={t.name} onChange={(e) => put(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="input grow" placeholder="Subject (optional)" aria-label="Template subject" value={t.subject ?? ''} onChange={(e) => put(list.map((x, j) => (j === i ? { ...x, subject: e.target.value || undefined } : x)))} />
            <button className="btn sm ghost icon" aria-label="Remove template" onClick={() => put(list.filter((_, j) => j !== i))}><Icon name="trash" size={12} /></button>
          </div>
          <textarea className="input" rows={3} aria-label="Template text" value={t.body} onChange={(e) => put(list.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
        </div>
      ))}
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => put([...list, { id: uid(), name: 'New template', body: 'Hi {first_name},\n\n' }])}><Icon name="plus" size={12} /> Add template</button>
      <div className="small muted">{'{first_name}'}, {'{name}'}, {'{email}'}, {'{my_name}'}, {'{date}'} and {'{day}'} are filled in when you use one (the template menu in a new message).</div>
    </div>
  );
}

export function SmartMailboxesEditor({ prefs, set }: { prefs: PimPrefsView; set: (p: Partial<PimPrefsView>) => void }) {
  const list = prefs.smartMailboxes ?? [];
  const put = (l: SmartMailbox[]) => set({ smartMailboxes: l });
  return (
    <div className="col" style={{ gap: 6 }}>
      {list.map((s, i) => (
        <div key={s.id} className="row" style={{ gap: 6 }}>
          <input className="input" style={{ width: 160 }} aria-label="Mailbox name" value={s.name} onChange={(e) => put(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input className="input grow" aria-label="Search" value={s.query} onChange={(e) => put(list.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)))} />
          <button className="btn sm ghost icon" aria-label="Remove mailbox" onClick={() => put(list.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
        </div>
      ))}
      <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => put([...list, { id: uid(), name: 'Unread with attachments', query: 'is:unread has:attachment' }])}><Icon name="plus" size={12} /> Add smart mailbox</button>
      <div className="small muted">A saved search, listed with the folders. Searches can use from: to: subject: has:attachment is:unread in: label: before: after:. Save one from the search box with Save.</div>
    </div>
  );
}

export function AiMemoryEditor({ prefs, set }: { prefs: PimPrefsView; set: (p: Partial<PimPrefsView>) => void }) {
  const [draft, setDraft] = useState('');
  const list = prefs.aiMemory ?? [];
  return (
    <div className="col" style={{ gap: 6 }} data-testid="mail-ai-memory">
      {list.length ? list.map((m, i) => (
        <div key={i} className="row" style={{ gap: 6 }}>
          <input className="input grow" aria-label="Memory" value={m} onChange={(e) => set({ aiMemory: list.map((x, j) => (j === i ? e.target.value : x)) })} />
          <button className="btn sm ghost icon" aria-label="Forget" title="Forget" onClick={() => set({ aiMemory: list.filter((_, j) => j !== i) })}><Icon name="close" size={12} /></button>
        </div>
      )) : <div className="small muted">Nothing yet. Add things the AI should keep in mind when it writes for you (how you sign, your role, people’s names). Typing “remember that …” as an instruction in a message adds a line too.</div>}
      <div className="row" style={{ gap: 6 }}>
        <input className="input grow" placeholder="e.g. I sign as Ana; my team is the design team" aria-label="Add to memory" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { set({ aiMemory: [...list, draft.trim()] }); setDraft(''); } }} />
        <button className="btn sm" disabled={!draft.trim()} onClick={() => { set({ aiMemory: [...list, draft.trim()] }); setDraft(''); }}>Add</button>
      </div>
      <div className="small muted">Kept on this computer and sent with AI writing requests only. Lines that look like passwords or keys are not kept.</div>
    </div>
  );
}

export function ConnectionsNote() {
  return (
    <details className="connections-note" data-testid="mail-connections">
      <summary className="small" style={{ fontWeight: 600 }}>Connections Mail makes</summary>
      <table className="small"><tbody>{MAIL_CONNECTIONS.map((c) => <tr key={c.to}><td><b>{c.to}</b></td><td>{c.why}</td><td className="muted">{c.when}</td></tr>)}</tbody></table>
      <ul className="small muted">{MAIL_NEVER.map((x) => <li key={x}>{x}</li>)}</ul>
    </details>
  );
}

const MCP_SHOWN = ['claude-desktop', 'claude-code', 'cursor', 'codex'];

/** Adds Keeper (and so Mail's tools) to AI apps' MCP settings, after asking; the old file is kept as a backup. */
export function McpConnect() {
  const { toast } = useStore();
  const [apps, setApps] = useState<{ id: string; label: string; file: string; installed: boolean; connected: boolean }[]>([]);
  const [confirm, setConfirm] = useState<{ id: string; label: string; file: string } | null>(null);
  const load = () => void api.brain.apps().then((l) => setApps(l.filter((a) => MCP_SHOWN.includes(a.id))));
  useEffect(load, []);
  return (
    <div className="col" style={{ gap: 6 }} data-testid="mail-mcp-connect">
      {apps.map((a) => (
        <div key={a.id} className="row small" style={{ gap: 8 }}>
          <span className="grow">{a.label}{a.connected ? <span className="pill" style={{ marginLeft: 6 }}>added</span> : !a.installed ? <span className="muted"> · not found on this computer</span> : null}</span>
          {a.connected ? <button className="btn sm ghost" onClick={async () => { const r = await api.brain.setAppConnected(a.id, false); toast(r.message); load(); }}>Remove</button>
            : <button className="btn sm" onClick={() => setConfirm(a)}>Add to {a.label}</button>}
        </div>
      ))}
      {confirm ? (
        <Modal title={`Add Keeper to ${confirm.label}?`} onClose={() => setConfirm(null)}>
          <p className="muted">Keeper writes itself into <code>{confirm.file}</code>. The file as it is now is kept beside it as a backup first. {confirm.label} can then search and read the mail of accounts you share (Share with coding assistants), write drafts, ask you before tidying, and prepare messages that only go when you press Send in Keeper.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => { const r = await api.brain.setAppConnected(confirm.id, true); toast(r.message); setConfirm(null); load(); }}>Add</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function useMailSettings() {
  const [prefs, setPrefs] = useState<PimPrefsView | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rules, setRulesState] = useState<Rule[]>([]);
  useEffect(() => {
    void api.pim.prefs().then(setPrefs);
    void api.pim.accounts().then(setAccounts);
    void api.pim.rules().then((r) => setRulesState(r as Rule[]));
    return api.on('pim-changed', (k: string) => { if (k === 'accounts') void api.pim.accounts().then(setAccounts); });
  }, []);
  const set = (p: Partial<PimPrefsView>) => { setPrefs((x) => (x ? { ...x, ...p } : x)); void api.pim.setPrefs(p).then(setPrefs); };
  const setRules = (r: Rule[]) => { setRulesState(r); void api.pim.saveRules(r); };
  return { prefs, accounts, rules, set, setRules };
}

function Line({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <div><div style={{ fontWeight: 600 }}>{title}</div>{desc ? <div className="small muted">{desc}</div> : null}</div>
      <div className="row" style={{ gap: 8, flex: 'none' }}>{children}</div>
    </div>
  );
}

/** The Mail rows of Settings → Mail & Calendar (core/settings-schema.ts names them). */
export function MailPanel({ part }: { part: 'reading' | 'rules' | 'templates' | 'smart' | 'ai' | 'notch' | 'privacy' | 'apps' }) {
  const { prefs, accounts, rules, set, setRules } = useMailSettings();
  if (!prefs) return null;
  const mail = accounts.filter((a) => a.mail);
  if (part === 'rules') return <RulesEditor rules={rules} setRules={setRules} accounts={mail} />;
  if (part === 'templates') return <TemplatesEditor prefs={prefs} set={set} />;
  if (part === 'smart') return <SmartMailboxesEditor prefs={prefs} set={set} />;
  if (part === 'ai') return <AiMemoryEditor prefs={prefs} set={set} />;
  if (part === 'apps') return <McpConnect />;
  if (part === 'privacy') {
    return (
      <div className="col" style={{ gap: 4 }} data-testid="mail-privacy">
        <Line title="Pictures from these senders load straight away" desc={prefs.trustedSenders.length ? prefs.trustedSenders.join(', ') : 'Nobody yet: pictures from the internet are held back for everyone (Load images, ⇧⌘I).'}>
          {prefs.trustedSenders.length ? <button className="btn sm ghost" onClick={() => set({ trustedSenders: [] })}>Clear</button> : null}
        </Line>
        <Line title="Blocked senders" desc={(prefs.blockedSenders ?? []).length ? (prefs.blockedSenders ?? []).join(', ') : 'Nobody. Block a sender from a message; their mail goes to Junk.'}>
          {(prefs.blockedSenders ?? []).length ? <button className="btn sm ghost" onClick={() => set({ blockedSenders: [] })}>Unblock all</button> : null}
        </Line>
        <Line title="Copy and Open for sign-in mail" desc="A sign-in code gets Copy and a sign-in link gets Open, in the notification and the Island.">
          <Toggle on={prefs.codeActions !== false} onChange={(v) => set({ codeActions: v })} />
        </Line>
        <div className="small muted" style={{ margin: '6px 0' }}>Keeper never sends read receipts. Tracking pixels are removed and tracking parts of links are taken off before a link opens.</div>
        <ConnectionsNote />
      </div>
    );
  }
  if (part === 'notch') {
    return (
      <div className="col" style={{ gap: 4 }}>
        <Line title="Number on the app icon" desc="Unread mail in your inboxes, only Important mail, or nothing.">
          <select className="input" aria-label="Number on the app icon" value={prefs.dockBadge ?? 'all'} onChange={(e) => set({ dockBadge: e.target.value as PimPrefsView['dockBadge'] })}><option value="all">All unread</option><option value="important">Important only</option><option value="off">None</option></select>
        </Line>
        <Line title="Only these senders in the notch" desc="Addresses or @domains, separated by commas. Empty: everyone (as chosen above). Sign-in codes always show.">
          <input className="input" style={{ width: 260 }} aria-label="Senders shown in the notch" defaultValue={(prefs.notchSenders ?? []).join(', ')} onBlur={(e) => set({ notchSenders: e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean) })} />
        </Line>
        <div className="small muted">Each account can be left out of the notch under Accounts.</div>
      </div>
    );
  }
  // Reading
  return (
    <div className="col" style={{ gap: 4 }}>
      <Line title="Designed mail in dark mode" desc="Newsletters and receipts with their own colours: on a light card as they were made, or darkened like the rest.">
        <select className="input" aria-label="Designed mail in dark mode" value={prefs.darkMail ?? 'card'} onChange={(e) => set({ darkMail: e.target.value as 'card' | 'dark' })}><option value="card">Light card</option><option value="dark">Darken</option></select>
      </Line>
      <Line title="Text size" desc="⌘+ and ⌘− while reading change it too.">
        <select className="input" aria-label="Text size" value={prefs.mailTextSize ?? 14} onChange={(e) => set({ mailTextSize: Number(e.target.value) })}>{[12, 13, 14, 15, 16, 18, 20, 22].map((s) => <option key={s} value={s}>{s} px</option>)}</select>
      </Line>
      <Line title="List density" desc="How close together the messages in the list are.">
        <div className="seg">{(['compact', 'comfortable', 'roomy'] as const).map((d) => <button key={d} className={(prefs.mailDensity ?? 'comfortable') === d ? 'on' : ''} onClick={() => set({ mailDensity: d })}>{d[0].toUpperCase() + d.slice(1)}</button>)}</div>
      </Line>
    </div>
  );
}
