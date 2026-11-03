// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes Everywhere: every notes app in one place. Search all notes together,
// see where each one lives, copy or move notes between apps, connect apps
// (each says honestly what it can do), look at a dry run before syncing,
// settle conflicts and duplicates, and keep dated backups and exports.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConflictView, ConnectorKind, ConnectorView, DuplicateView, ExportFormat, HistoryEntry, NoteDetail, NoteHit, NotesOverview, SnapshotView, SyncPlanView, TrashedNoteView } from '../../core/api-notesync';
import { relativeTime } from '../../core/format';
import { availableOn, CAPABILITY_HELP, CAPABILITY_LABEL, connectorDef, CONNECTORS, EXPORT_FORMATS } from '../../core/notes-sync/connectors/registry';
import type { ConnectorDef } from '../../core/notes-sync/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/notesync.css';
import { Tabs } from '../components/Tabs';

type Tab = 'notes' | 'apps' | 'review' | 'backups';

const TAB_LABEL: Record<Tab, string> = { notes: 'Notes', apps: 'Apps', review: 'Review', backups: 'Backups' };
const appName = (k: ConnectorKind) => connectorDef(k).name;
const ACTION_LABEL: Record<string, string> = { add: 'Add', update: 'Update', 'update-app': 'Send back', 'add-app': 'Copy over', merge: 'Merge', conflict: 'Conflict', trash: 'To notes trash', 'delete-app': 'Delete in app', unlink: 'Keep, unlink', held: 'Held back', locked: 'Locked' };

function useOverview() {
  const [ov, setOv] = useState<NotesOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => void api.notesync.overview().then((o) => { setOv(o); setErr(null); }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => {
    load();
    return api.on('notesync-changed', load);
  }, [load]);
  return [ov, load, err] as const;
}

export function NotesHub() {
  const { route } = useStore();
  const initial: Tab = route.arg === 'conflicts' || route.arg === 'duplicates' ? 'review' : (['notes', 'apps', 'review', 'backups'] as Tab[]).includes(route.arg as Tab) ? (route.arg as Tab) : 'notes';
  const [tab, setTab] = useState<Tab>(initial);
  const [ov, reload, err] = useOverview();
  if (!ov) return err ? <Empty icon="warning" title="Notes could not be opened">{err}</Empty> : <Loading />;
  const review = ov.conflicts + ov.duplicates;
  return (
    <div className="nh-page">
      <PageHead title="Notes from Other Apps" sub={<>{ov.notes.toLocaleString()} notes from {ov.apps} app{ov.apps === 1 ? '' : 's'} · kept in <span className="mono">{ov.hubFolder}</span></>} />
      <Tabs label="Notes from Other Apps" value={tab} onChange={setTab} items={(Object.keys(TAB_LABEL) as Tab[]).map((t) => ({ id: t, testId: `nh-tab-${t}`, label: TAB_LABEL[t], badge: t === 'apps' ? ov.connectors.length : t === 'review' && review ? review : undefined }))} />
      {tab === 'notes' ? <NotesTab ov={ov} /> : null}
      {tab === 'apps' ? <AppsTab ov={ov} reload={reload} /> : null}
      {tab === 'review' ? <ReviewTab /> : null}
      {tab === 'backups' ? <BackupsTab ov={ov} /> : null}
    </div>
  );
}

function AppBadges({ apps }: { apps: ConnectorKind[] }) {
  if (!apps.length) return <span className="nh-app hub">Only in Keeper</span>;
  return <>{apps.map((a) => <span key={a} className={`nh-app app-${a}`}>{appName(a)}</span>)}</>;
}

function CapBadge({ def }: { def: Pick<ConnectorDef, 'capability'> }) {
  return <span className={`badge nh-cap cap-${def.capability}`} title={CAPABILITY_HELP[def.capability]}>{CAPABILITY_LABEL[def.capability]}</span>;
}

// ---------------------------------------------------------------- notes: search, tags, where it lives

function NotesTab({ ov }: { ov: NotesOverview }) {
  const { toast } = useStore();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | undefined>();
  const [appF, setAppF] = useState<ConnectorKind | ''>('');
  const [hits, setHits] = useState<NoteHit[] | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number; apps: ConnectorKind[] }[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [capture, setCapture] = useState(false);
  const run = useCallback(() => void api.notesync.search(q, { tag, app: appF || undefined }).then(setHits), [q, tag, appF]);
  useEffect(() => { run(); }, [run, ov]);
  useEffect(() => { void api.notesync.tags().then(setTags); }, [ov]);
  const apps = useMemo(() => [...new Set(ov.connectors.map((c) => c.kind))], [ov]);
  return (
    <div className="nh-notes">
      <div className="nh-list">
        <div className="row nh-search">
          <input className="input grow" data-testid="nh-search" placeholder="Search every notes app…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={appF} onChange={(e) => setAppF(e.target.value as ConnectorKind | '')} aria-label="App">
            <option value="">All apps</option>
            {apps.map((a) => <option key={a} value={a}>{appName(a)}</option>)}
          </select>
          <button className="btn primary" data-testid="nh-quick" onClick={() => setCapture(true)}><Icon name="plus" size={14} /> Note</button>
        </div>
        {tags.length ? (
          <div className="chips nh-tags">
            {tags.slice(0, 24).map((t) => (
              <button key={t.tag} className={`chip ${tag === t.tag ? 'on' : ''}`} onClick={() => setTag(tag === t.tag ? undefined : t.tag)} title={t.apps.map(appName).join(', ')}>#{t.tag} <span className="muted">{t.count}</span></button>
            ))}
          </div>
        ) : null}
        {capture ? <QuickNote onDone={(id) => { setCapture(false); if (id) { setSel(id); toast('Saved in Keeper’s notes'); } }} /> : null}
        {!hits ? <Loading /> : hits.length === 0 ? (
          <Empty icon="note" title={q || tag ? 'No notes match' : 'No notes yet'}>{q || tag ? 'Try other words.' : 'Connect an app in Apps to bring its notes here.'}</Empty>
        ) : (
          <div className="nh-hits" data-testid="nh-hits">
            {hits.map((h) => (
              <button key={h.keeperId} className={`nh-hit ${sel === h.keeperId ? 'on' : ''}`} onClick={() => setSel(h.keeperId)}>
                <span className="nh-hit-title">{h.locked ? <Icon name="lock" size={12} /> : null} {h.title}</span>
                <span className="nh-hit-snip muted">{h.snippet}</span>
                <span className="nh-hit-meta"><AppBadges apps={h.apps} />{h.tags.slice(0, 3).map((t) => <span key={t} className="muted">#{t}</span>)}<span className="muted grow-right">{relativeTime(h.modified)}</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="nh-detail">
        {sel ? <NoteView id={sel} ov={ov} onGone={() => setSel(null)} /> : <Empty icon="note" title="Pick a note">See where it lives, its history, and copy or move it to another app.</Empty>}
      </div>
    </div>
  );
}

function QuickNote({ onDone }: { onDone: (id?: string) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <div className="card nh-quicknote">
      <input className="input" data-testid="nh-quick-title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <textarea className="input" data-testid="nh-quick-body" rows={4} placeholder="Write something…" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="row">
        <button className="btn primary" disabled={!title.trim() && !body.trim()} onClick={() => void api.notesync.saveNote(null, { title: title.trim() || body.split('\n')[0].slice(0, 80), body }).then((d) => onDone(d.keeperId))}>Save</button>
        <button className="btn ghost" onClick={() => onDone()}>Cancel</button>
      </div>
    </div>
  );
}

function NoteView({ id, ov, onGone }: { id: string; ov: NotesOverview; onGone: () => void }) {
  const { toast } = useStore();
  const [d, setD] = useState<NoteDetail | null | undefined>(undefined);
  const [edit, setEdit] = useState<{ title: string; body: string; tags: string } | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [askMove, setAskMove] = useState(false);
  useEffect(() => { void api.notesync.note(id).then(setD); }, [id, ov]);
  if (d === undefined) return <Loading />;
  if (d === null) return <Empty icon="note" title="This note is gone"><button className="btn sm" onClick={onGone}>Back</button></Empty>;
  const targets = ov.connectors.filter((c) => !d.where.some((w) => w.connector === c.id) && c.capability !== 'import-only' && c.available);
  const copy = async (move: boolean) => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await api.notesync.copyTo([d.keeperId], target, move);
      toast(r.message);
      setD(await api.notesync.note(id));
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); setAskMove(false); }
  };
  return (
    <div className="nh-note" data-testid="nh-note">
      {edit ? (
        <div className="col nh-edit">
          <input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <textarea className="input mono" rows={14} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
          <input className="input" placeholder="Tags, separated by commas" value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} />
          <div className="row">
            <button className="btn primary" onClick={() => void api.notesync.saveNote(d.keeperId, { title: edit.title, body: edit.body, tags: edit.tags.split(',').map((t) => t.trim()).filter(Boolean) }).then((x) => { setD(x); setEdit(null); toast('Saved. Connected apps get the change on their next sync.'); }).catch((e: Error) => toast(e.message))}>Save</button>
            <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="row nh-note-head">
            <h2 className="grow">{d.locked ? <Icon name="lock" size={16} /> : null} {d.title}</h2>
            {!d.locked ? <button className="btn sm" onClick={() => setEdit({ title: d.title, body: d.body, tags: d.tags.join(', ') })}><Icon name="rename" size={13} /> Edit</button> : null}
          </div>
          {d.tags.length ? <div className="chips">{d.tags.map((t) => <span key={t} className="chip">#{t}</span>)}</div> : null}
          <pre className="nh-body">{d.body}</pre>
        </>
      )}
      <section className="nh-where" data-testid="nh-where">
        <div className="section-head"><b>Where does this note live?</b></div>
        <div className="nh-where-row"><Icon name="folder" size={14} /><span className="grow">Keeper’s notes folder<div className="muted small mono ellipsis">{d.path}</div></span><button className="btn sm ghost" onClick={() => void api.files.reveal(d.path)}>Show</button></div>
        {d.where.length === 0 ? <div className="muted small">Only in Keeper so far.</div> : d.where.map((w) => (
          <div key={w.connector} className="nh-where-row">
            <span className={`nh-app app-${w.app}`}>{w.appName}</span>
            <span className="grow">{w.label}{w.folder ? <span className="muted"> · {w.folder}</span> : null}</span>
            <span className={`badge ${w.inStep ? 'ok' : 'warn'}`}>{w.inStep ? 'In step' : 'Different in the app'}</span>
            {w.synced ? <span className="muted small">{relativeTime(w.synced)}</span> : null}
          </div>
        ))}
      </section>
      {!d.locked ? (
        <section className="nh-copy">
          <div className="section-head"><b>Copy or move to another app</b></div>
          {targets.length ? (
            <div className="row">
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="nh-copy-target">
                <option value="">Choose an app…</option>
                {targets.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.app})</option>)}
              </select>
              <button className="btn" disabled={!target || busy} onClick={() => void copy(false)}>Copy</button>
              <button className="btn ghost" disabled={!target || busy || !d.where.length} onClick={() => setAskMove(true)}>Move…</button>
            </div>
          ) : <div className="muted small">Connect another app that can take notes (two-way) to copy this note there.</div>}
          {askMove ? (
            <div className="card nh-confirm">
              <b>Move “{d.title}”?</b>
              <div className="small">It is copied to the new app first, then deleted from {d.where.map((w) => w.appName).join(' and ')}. Keeper keeps its own copy either way.</div>
              <div className="row"><button className="btn danger" onClick={() => void copy(true)}>Move</button><button className="btn ghost" onClick={() => setAskMove(false)}>Cancel</button></div>
            </div>
          ) : null}
        </section>
      ) : <div className="muted small">Locked notes stay in their own app. Keeper never copies their text.</div>}
      {d.history.length ? (
        <section>
          <div className="section-head"><b>History</b></div>
          <HistoryList items={d.history} />
        </section>
      ) : null}
    </div>
  );
}

function HistoryList({ items }: { items: HistoryEntry[] }) {
  return (
    <div className="nh-history">
      {items.map((h, i) => (
        <div key={i} className="nh-history-row">
          <span className="muted small nh-when">{relativeTime(h.at)}</span>
          <span className="grow"><b>{h.title}</b> {h.action.replace(/-/g, ' ')}{h.app && h.app !== 'hub' ? <> · <span className={`nh-app app-${h.app}`}>{appName(h.app)}</span></> : h.app === 'hub' ? ' · in Keeper' : ''}{h.summary ? <span className="muted"> — {h.summary}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- apps: connectors, dry run, migrate

function AppsTab({ ov, reload }: { ov: NotesOverview; reload: () => void }) {
  const [adding, setAdding] = useState<ConnectorDef | null>(null);
  const [plans, setPlans] = useState<Record<string, SyncPlanView | 'loading'>>({});
  const live = ov.connectors;
  return (
    <div className="col nh-apps">
      {!ov.autoSync ? (
        <div className="card nh-note-bar small"><Icon name="info" size={14} /> Apps sync when you press Sync. To sync on their own every so often, turn on “Keep notes apps in sync” in Settings → Features.</div>
      ) : null}
      {live.length === 0 && !adding ? <Empty icon="note" title="No apps connected yet">Pick an app below. Every connection starts read-only, and shows a dry run before anything is copied.</Empty> : null}
      {live.map((c) => <ConnectorCard key={c.id} c={c} plan={plans[c.id]} setPlan={(p) => setPlans((x) => { const n = { ...x }; if (p) n[c.id] = p; else delete n[c.id]; return n; })} reload={reload} />)}
      {live.length >= 2 ? <Migrate ov={ov} /> : null}
      <section className="card nh-catalog">
        <div className="section-head"><b>Connect an app</b></div>
        {adding ? <ConnectForm def={adding} platform={ov.platform} onDone={() => { setAdding(null); reload(); }} /> : (
          <div className="nh-catalog-grid" data-testid="nh-catalog">
            {CONNECTORS.map((d) => {
              const ok = availableOn(d, ov.platform);
              return (
                <button key={d.kind} className="nh-cat" data-testid={`nh-connect-${d.kind}`} onClick={() => setAdding(d)}>
                  <span className="nh-cat-name">{d.name}</span>
                  <span className="muted small">{d.how}</span>
                  <span className="row nh-cat-badges"><CapBadge def={d} />{!ok ? <span className="badge">{d.platforms?.includes('darwin') ? 'Mac only' : 'Windows only'}</span> : null}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <IphoneHelp />
    </div>
  );
}

function ConnectForm({ def, platform, onDone }: { def: ConnectorDef; platform: string; onDone: () => void }) {
  const { toast } = useStore();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const ok = availableOn(def, platform);
  const missing = def.fields.filter((f) => !f.optional && !(f.type === 'secret' ? secrets[f.key] : fields[f.key])).length > 0;
  const pick = async (key: string, folder: boolean) => {
    const p = folder ? await api.settings.pickFolder() : (await api.settings.pickFiles?.())?.[0];
    if (p) setFields((x) => ({ ...x, [key]: p as string }));
  };
  return (
    <div className="col nh-form" data-testid="nh-form">
      <div className="row"><b className="grow">{def.name}</b><CapBadge def={def} /></div>
      <div className="muted small">{def.how}</div>
      <ul className="nh-limits small">{def.limits.map((l) => <li key={l}>{l}</li>)}</ul>
      {!ok ? <div className="card nh-note-bar small"><Icon name="warning" size={14} /> {def.name} can only be connected on {def.platforms?.includes('darwin') ? 'a Mac' : 'Windows'}. Your notes from it can still reach this computer through the notes folder on your other devices.</div> : null}
      {def.fields.map((f) => (
        <label key={f.key} className="col nh-field">
          <span className="field-label">{f.label}{f.optional ? <span className="muted"> (optional)</span> : null}</span>
          <div className="row">
            <input className="input grow" data-testid={`nh-field-${f.key}`} type={f.type === 'secret' ? 'password' : 'text'} placeholder={f.placeholder}
              value={f.type === 'secret' ? secrets[f.key] ?? '' : fields[f.key] ?? ''}
              onChange={(e) => (f.type === 'secret' ? setSecrets((x) => ({ ...x, [f.key]: e.target.value })) : setFields((x) => ({ ...x, [f.key]: e.target.value })))} />
            {f.type === 'folder' || f.type === 'file' ? <button className="btn" type="button" onClick={() => void pick(f.key, f.type === 'folder')}>Choose…</button> : null}
          </div>
          {f.help ? <span className="muted small">{f.help}</span> : null}
        </label>
      ))}
      <div className="muted small">It starts read-only: Keeper copies notes in, and only writes back after you turn on write-back.</div>
      <div className="row">
        <button className="btn primary" data-testid="nh-connect" disabled={busy || missing || !ok} onClick={async () => {
          setBusy(true);
          try { await api.notesync.addConnector({ kind: def.kind, fields, secrets }); toast(`${def.name} connected. Next: the dry run.`); onDone(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
        }}>Connect</button>
        <button className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function ConnectorCard({ c, plan, setPlan, reload }: { c: ConnectorView; plan?: SyncPlanView | 'loading'; setPlan: (p: SyncPlanView | 'loading' | undefined) => void; reload: () => void }) {
  const { toast } = useStore();
  const def = connectorDef(c.kind);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Set<string>>(new Set());
  const [askRemove, setAskRemove] = useState(false);
  const dryRun = async () => {
    setPlan('loading');
    try { setPlan(await api.notesync.plan(c.id)); } catch (e) { setPlan(undefined); toast((e as Error).message); }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const r = await api.notesync.sync(c.id, { confirmDeletes: [...confirm] });
      toast(r.errors.length ? `${r.summary}. ${r.errors[0]}` : r.summary);
      setPlan(undefined);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); reload(); }
  };
  const p = plan && plan !== 'loading' ? plan : null;
  return (
    <div className={`card nh-conn state-${c.state}`} data-testid={`nh-conn-${c.kind}`}>
      <div className="row nh-conn-head">
        <div className={`nh-conn-icon app-${c.kind}`}><Icon name={c.kind === 'folder' ? 'folder' : 'note'} size={18} /></div>
        <div className="grow col nh-conn-text">
          <div className="row"><b>{c.label}</b>{c.label !== c.app ? <span className="muted small">{c.app}</span> : null}<CapBadge def={def} /></div>
          <div className="muted small">
            {c.state === 'unavailable' ? c.message : <>{c.notes.toLocaleString()} notes{c.locked ? ` · ${c.locked} locked (not copied)` : ''}{c.lastSync ? ` · synced ${relativeTime(c.lastSync)}` : ' · not synced yet'}{c.message ? ` · ${c.message}` : ''}</>}
          </div>
        </div>
        <Toggle on={c.enabled} onChange={(v) => void api.notesync.updateConnector(c.id, { enabled: v })} />
      </div>
      <div className="row nh-conn-opts small">
        <label className="row" title={def.capability === 'import-only' ? CAPABILITY_HELP['import-only'] : 'Send changes made in Keeper back to the app'}>
          <Toggle on={c.writeBack} onChange={(v) => void api.notesync.updateConnector(c.id, { writeBack: v }).catch((e: Error) => toast(e.message))} />
          <span className={def.capability === 'import-only' ? 'muted' : ''}>Write back</span>
        </label>
        {def.capability !== 'import-only' ? (
          <label className="row">Sync on its own
            <select className="input sm" value={c.everyMin} onChange={(e) => void api.notesync.updateConnector(c.id, { everyMin: Number(e.target.value) })}>
              <option value={0}>Never</option><option value={15}>every 15 min</option><option value={30}>every 30 min</option><option value={60}>every hour</option><option value={360}>every 6 hours</option>
            </select>
          </label>
        ) : null}
        <span className="grow" />
        <button className="btn sm" onClick={() => void api.notesync.test(c.id).then((r) => toast(r.message))}>Test</button>
        <button className="btn sm" data-testid="nh-dryrun" disabled={plan === 'loading' || c.state === 'unavailable'} onClick={() => void dryRun()}>Dry run</button>
        <button className="btn sm primary" data-testid="nh-sync" disabled={busy || !c.reviewed || c.state === 'unavailable'} title={c.reviewed ? '' : 'Look at the dry run first'} onClick={() => void sync()}>{busy ? 'Syncing…' : 'Sync now'}</button>
        <button className="btn sm ghost icon" title="Remove this connection" aria-label="Remove this connection" onClick={() => setAskRemove(true)}><Icon name="trash" size={13} /></button>
      </div>
      {askRemove ? (
        <div className="nh-confirm row small">
          <span className="grow">Remove {c.label}? The notes stay in Keeper; nothing is deleted in {c.app}.</span>
          <button className="btn sm danger" onClick={() => void api.notesync.removeConnector(c.id).then(reload)}>Remove</button>
          <button className="btn sm ghost" onClick={() => setAskRemove(false)}>Cancel</button>
        </div>
      ) : null}
      {plan === 'loading' ? <div className="nh-plan muted small">Looking at {c.app}… nothing is changed.</div> : null}
      {p ? (
        <div className="nh-plan" data-testid="nh-plan">
          <div className="row"><b className="grow" data-testid="nh-plan-summary">{p.summary}</b><button className="btn sm ghost" onClick={() => setPlan(undefined)}>Close</button></div>
          {p.message ? <div className="small nh-plan-msg">{p.message}</div> : <div className="muted small">This is a dry run: nothing has changed yet.</div>}
          {p.items.length ? (
            <div className="nh-plan-items">
              {p.items.slice(0, 120).map((i, k) => (
                <div key={k} className={`nh-plan-item act-${i.action}`}>
                  <span className="badge">{ACTION_LABEL[i.action] ?? i.action}</span>
                  <span className="grow ellipsis">{i.title}<span className="muted"> — {i.why}</span>{i.duplicateOf ? <span className="badge warn">looks like a note you have</span> : null}</span>
                  {i.needsConfirm && i.keeperId ? (
                    <label className="row small"><input type="checkbox" checked={confirm.has(i.keeperId)} onChange={(e) => { const s = new Set(confirm); if (e.target.checked) s.add(i.keeperId!); else s.delete(i.keeperId!); setConfirm(s); }} /> Yes, delete</label>
                  ) : null}
                </div>
              ))}
              {p.items.length > 120 ? <div className="muted small">…and {p.items.length - 120} more</div> : null}
            </div>
          ) : null}
          {!p.message ? <div className="row"><button className="btn primary" data-testid="nh-plan-sync" disabled={busy} onClick={() => void sync()}>{busy ? 'Syncing…' : 'Looks right — sync'}</button></div> : null}
        </div>
      ) : null}
    </div>
  );
}

function Migrate({ ov }: { ov: NotesOverview }) {
  const { toast } = useStore();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const targets = ov.connectors.filter((c) => c.id !== from && c.capability !== 'import-only' && c.available);
  return (
    <section className="card nh-migrate">
      <div className="section-head"><b>Move everything from one app to another</b></div>
      <div className="row">
        <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">From…</option>{ov.connectors.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <Icon name="chevronRight" size={14} />
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">To…</option>{targets.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <button className="btn" disabled={!from || !to || busy} onClick={async () => { setBusy(true); try { toast((await api.notesync.migrate(from, to)).message); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }}>Copy all</button>
      </div>
      <div className="muted small">Notes are copied; nothing is deleted from the first app. Formatting may be simplified for some apps.</div>
    </section>
  );
}

function IphoneHelp() {
  const [g, setG] = useState<{ title: string; steps: string[]; note: string } | null>(null);
  return (
    <details className="card nh-iphone" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !g) void api.notesync.shortcutGuide().then(setG); }}>
      <summary>iPhone only, no Mac? Copy Apple Notes with a Shortcut</summary>
      {g ? <><ol className="small">{g.steps.map((s) => <li key={s}>{s}</li>)}</ol><div className="muted small">{g.note}</div></> : <Loading />}
    </details>
  );
}

// ---------------------------------------------------------------- review: conflicts and duplicates

function ReviewTab() {
  const { toast } = useStore();
  const [conflicts, setConflicts] = useState<ConflictView[] | null>(null);
  const [dups, setDups] = useState<DuplicateView[] | null>(null);
  const load = useCallback(() => { void api.notesync.conflicts().then(setConflicts); void api.notesync.duplicates().then(setDups); }, []);
  useEffect(() => { load(); return api.on('notesync-changed', load); }, [load]);
  if (!conflicts || !dups) return <Loading />;
  return (
    <div className="col nh-review">
      <section>
        <div className="section-head"><b>Conflicts</b><span className="muted small"> · changed in two places; both copies are kept until you choose</span></div>
        {conflicts.length === 0 ? <div className="muted small">No conflicts.</div> : conflicts.map((c) => <ConflictCard key={c.id} c={c} onDone={(m) => { toast(m); load(); }} />)}
      </section>
      <section>
        <div className="section-head"><b>Possible duplicates</b><span className="muted small"> · the same note in more than one app</span></div>
        {dups.length === 0 ? <div className="muted small">No duplicates found.</div> : dups.map((g) => (
          <div key={g.id} className="card nh-dup" data-testid="nh-dup">
            <div className="small muted">{Math.round(g.score * 100)}% alike</div>
            <div className="nh-dup-notes">
              {g.notes.map((n) => (
                <div key={n.keeperId} className="nh-dup-note">
                  <b>{n.title}</b>
                  <div className="row"><AppBadges apps={n.apps} /><span className="muted small">{relativeTime(n.modified)}</span></div>
                  <div className="muted small">{n.snippet}</div>
                </div>
              ))}
            </div>
            <div className="row">
              <button className="btn sm primary" onClick={() => void api.notesync.resolveDuplicate(g.id, 'link').then(() => { toast('Linked: one note, kept in step in both apps'); load(); })}>Link as one note</button>
              <button className="btn sm" onClick={() => void api.notesync.resolveDuplicate(g.id, 'merge').then(() => { toast('Merged into one note'); load(); })}>Merge the text</button>
              <button className="btn sm ghost" onClick={() => void api.notesync.resolveDuplicate(g.id, 'ignore').then(load)}>Not the same</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function ConflictCard({ c, onDone }: { c: ConflictView; onDone: (msg: string) => void }) {
  const [merge, setMerge] = useState<string | null>(null);
  const keep = (k: 'mine' | 'theirs' | 'both' | 'merged') => void api.notesync.resolveConflict(c.id, k, k === 'merged' ? merge ?? undefined : undefined).then(() => onDone(k === 'both' ? 'Both kept as separate notes' : 'Conflict settled'));
  return (
    <div className="card nh-conflict" data-testid="nh-conflict">
      <div className="row"><b className="grow">{c.title}</b><span className={`nh-app app-${c.app}`}>{c.appName}</span><span className="muted small">{relativeTime(c.at)}</span></div>
      <div className="nh-compare" role="table" aria-label="Side by side">
        <div className="nh-compare-head" role="row"><span>In Keeper</span><span>In {c.appName}</span></div>
        {c.rows.map((r, i) => (
          <div key={i} className={`nh-compare-row k-${r.kind}`} role="row">
            <span>{r.l ?? ''}</span><span>{r.r ?? ''}</span>
          </div>
        ))}
      </div>
      {merge !== null ? (
        <div className="col">
          <textarea className="input mono" rows={8} value={merge} onChange={(e) => setMerge(e.target.value)} />
          <div className="row"><button className="btn sm primary" onClick={() => keep('merged')}>Save this version</button><button className="btn sm ghost" onClick={() => setMerge(null)}>Cancel</button></div>
        </div>
      ) : (
        <div className="row">
          <button className="btn sm primary" data-testid="nh-keep-mine" onClick={() => keep('mine')}>Keep Keeper’s</button>
          <button className="btn sm" data-testid="nh-keep-theirs" onClick={() => keep('theirs')}>Keep {c.appName}’s</button>
          <button className="btn sm" onClick={() => keep('both')}>Keep both</button>
          <button className="btn sm ghost" onClick={() => setMerge(c.mine)}>Edit a merge…</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- backups, exports, devices, trash

function BackupsTab({ ov }: { ov: NotesOverview }) {
  const { toast, go } = useStore();
  const [snaps, setSnaps] = useState<SnapshotView[] | null>(null);
  const [trash, setTrash] = useState<TrashedNoteView[]>([]);
  const [hist, setHist] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { void api.notesync.snapshots().then(setSnaps); void api.notesync.trash().then(setTrash); void api.notesync.history().then((h) => setHist(h.slice(0, 30))); }, []);
  useEffect(() => { load(); }, [load, ov]);
  const exp = async (f: ExportFormat) => {
    setBusy(f);
    try { const r = await api.notesync.exportAs(f); toast(`Saved ${r.notes} notes to ${r.path}`); } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <div className="col nh-backups">
      <section className="card">
        <div className="row"><b className="grow">Snapshots</b>
          <button className="btn sm primary" data-testid="nh-snapshot" onClick={() => void api.notesync.snapshotNow().then((s) => { toast(s ? 'Snapshot made' : 'Nothing changed since the last snapshot'); load(); })}>Snapshot now</button>
        </div>
        <div className="muted small">Keeper takes one before every sync. Each keeps every note as it was; unchanged notes are stored once.</div>
        {!snaps ? <Loading /> : snaps.length === 0 ? <div className="muted small">No snapshots yet.</div> : (
          <div className="nh-snaps">
            {snaps.slice(0, 20).map((s) => (
              <div key={s.id} className="nh-snap row">
                <span className="grow">{new Date(s.time).toLocaleString()}<span className="muted small"> · {s.label ?? ''} · {s.files} files{s.added || s.changed || s.removed ? ` · +${s.added} ~${s.changed} −${s.removed}` : ''}</span></span>
                <button className="btn sm ghost" onClick={() => void api.notesync.restoreSnapshot(s.id).then((r) => toast(`${r.restored} notes put back (the state before was snapshotted first)`))}>Restore</button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="card">
        <b>Export to put notes back into an app</b>
        <div className="nh-exports">
          {EXPORT_FORMATS.map((f) => (
            <button key={f.id} className="nh-export" disabled={busy === f.id} onClick={() => void exp(f.id)} data-testid={`nh-export-${f.id}`}>
              <b>{f.name}</b><span className="muted small">{f.for}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="row">
          <span className="grow"><b>Copy to my other devices</b><div className="muted small">{ov.devices.on ? `The notes folder syncs with ${ov.devices.peers} device${ov.devices.peers === 1 ? '' : 's'} through Sync & Backup.` : 'Shares the notes folder with your paired devices through Sync & Backup.'}{ov.devices.message ? ` ${ov.devices.message}` : ''}</div></span>
          <Toggle on={ov.devices.on} onChange={(v) => void api.notesync.shareWithDevices(v).catch((e: Error) => toast(e.message))} />
        </div>
        <div className="row small"><span className="muted grow">For an encrypted copy on a drive or cloud, add the notes folder to a backup.</span><button className="btn sm ghost" onClick={() => go({ name: 'sync', arg: 'backups' })}>Open Backups</button></div>
      </section>
      <section className="card">
        <b>Notes trash</b>
        <div className="muted small">Notes deleted in an app land here first. Nothing is deleted in your apps unless you say yes in a dry run.</div>
        {trash.length === 0 ? <div className="muted small">Empty.</div> : trash.slice(0, 50).map((t) => (
          <div key={t.id} className="row nh-trash-row">
            <span className="grow">{t.title}<span className="muted small"> · {t.why} · {relativeTime(t.at)}</span></span>
            <button className="btn sm ghost" onClick={() => void api.notesync.restore(t.id).then(() => { toast('Restored'); load(); })}>Restore</button>
          </div>
        ))}
      </section>
      {hist.length ? <section className="card"><b>Recent changes</b><HistoryList items={hist} /></section> : null}
    </div>
  );
}
