// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// System Settings+: hundreds of settings that usually need a command or a
// buried switch, searchable, each with the exact command shown before it runs,
// a backup, a change log with undo, and setup profiles to carry to another
// computer.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogEntry, ChangePreview, BackupInfo } from '../../core/api-settingsplus';
import type { ChangeRecord, ProfilePreviewItem, ReadResult } from '../../core/settings-catalog/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/controls.css';
import '../styles/settingsplus.css';
import { Tabs } from '../components/Tabs';

const UNSET = '<unset>';
type Tab = 'all' | 'favourites' | 'changes' | 'backups' | 'profiles';
const PAGE = 60;

function label(e: CatalogEntry, v: string | undefined) {
  if (v === undefined) return '';
  if (e.kind === 'choice') return e.choices?.find((c) => c.value === v)?.label ?? v;
  if (e.kind === 'toggle') return v === e.on ? 'On' : v === e.off ? 'Off' : v;
  return `${v}${e.unit ? ` ${e.unit}` : ''}`;
}

function ValueInput({ e, r, onChange }: { e: CatalogEntry; r?: ReadResult; onChange: (v: string) => void }) {
  const v = r?.value;
  const [draft, setDraft] = useState(v ?? '');
  useEffect(() => setDraft(v ?? ''), [v]);
  if (e.advice) return <span className="qc-how qc-how-guide">Steps</span>;
  if (!r) return <span className="muted small">…</span>;
  if (e.kind === 'toggle') return <Toggle on={v === e.on} onChange={(on) => onChange(on ? e.on! : e.off!)} label={e.title} />;
  if (e.kind === 'choice') {
    const known = e.choices?.some((c) => c.value === v);
    return (
      <select className="input" value={known ? v : ''} onChange={(x) => onChange(x.target.value)} aria-label={e.title}>
        {!known ? <option value="">{v || 'Not set'}</option> : null}
        {e.choices?.map((c) => <option key={c.value} value={c.value}>{c.value === UNSET ? `${c.label} (system default)` : c.label}</option>)}
      </select>
    );
  }
  return (
    <form className="sp-ctl" onSubmit={(x) => { x.preventDefault(); if (draft !== v) onChange(draft); }}>
      <input className="input" type={e.kind === 'number' ? 'number' : 'text'} min={e.min} max={e.max} step="any" value={draft} onChange={(x) => setDraft(x.target.value)} aria-label={e.title} />
      {e.unit ? <span className="muted small">{e.unit}</span> : null}
      <button className="btn sm" disabled={draft === v}>Set</button>
    </form>
  );
}

export function Catalog() {
  const { toast, go, route } = useStore();
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState(route.q ?? '');
  const [cat, setCat] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [values, setValues] = useState<Map<string, ReadResult>>(new Map());
  const [favs, setFavs] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [pending, setPending] = useState<{ e: CatalogEntry; value: string; p: ChangePreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<ChangeRecord[]>([]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ text: string; name: string; items: ProfilePreviewItem[]; pick: Set<string> } | null>(null);

  useEffect(() => {
    void api.catalog.list().then((r) => { setEntries(r.entries); setCounts(r.counts); });
    void api.catalog.favourites().then(setFavs);
  }, []);
  const loadLog = useCallback(() => { void api.catalog.log().then(setLog); void api.catalog.backups().then(setBackups); }, []);
  useEffect(() => { loadLog(); return api.on('catalog-changed', loadLog); }, [loadLog]);
  useEffect(() => { if (route.q !== undefined) setQ(route.q); }, [route.q]);
  // A setting found in the search box (catalog:<title>).
  useEffect(() => { if (route.arg) setQ(route.arg); }, [route.arg]);

  const [hits, setHits] = useState<CatalogEntry[] | null>(null);
  useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    const t = setTimeout(() => void api.catalog.search(q).then(setHits), 120);
    return () => clearTimeout(t);
  }, [q]);

  const list = useMemo(() => {
    let l = hits ?? entries ?? [];
    if (tab === 'favourites') l = l.filter((e) => favs.includes(e.id));
    if (cat) l = l.filter((e) => e.category === cat);
    return l;
  }, [hits, entries, tab, favs, cat]);
  const cats = useMemo(() => [...new Set((entries ?? []).map((e) => e.category))], [entries]);
  const visible = list.slice(0, shown);

  // Only the rows on screen are read, a few at a time.
  const visibleKey = visible.map((e) => e.id).join(',');
  const readVisible = useCallback(async (ids: string[]) => {
    const need = ids.filter((id) => !values.has(id));
    if (!need.length) return;
    const r = await api.catalog.read(need);
    setValues((m) => { const n = new Map(m); for (const x of r) n.set(x.id, x); return n; });
  }, [values]);
  useEffect(() => { if (tab === 'all' || tab === 'favourites') void readVisible(visible.map((e) => e.id)); }, [visibleKey, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const reread = async (id: string) => {
    const [r] = await api.catalog.read([id]);
    if (r) setValues((m) => new Map(m).set(id, r));
  };

  const ask = async (e: CatalogEntry, value: string) => {
    const p = await api.catalog.preview(e.id, value);
    if (p.error) { toast(p.error); return; }
    setPending({ e, value, p });
  };

  const applyPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await api.catalog.apply(pending.e.id, pending.value);
      toast(r.ok ? `${pending.e.title}: ${r.message}` : r.message, r.ok && r.record ? { label: 'Undo', run: () => void api.catalog.undo(r.record!.id).then((u) => { toast(u.message); void reread(pending.e.id); }) } : undefined);
      await reread(pending.e.id);
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const explain = (e: CatalogEntry) => go({ name: 'assistant', arg: `Explain this ${e.os === 'darwin' ? 'macOS' : e.os === 'win32' ? 'Windows' : 'Linux'} setting in plain words: what it does, who would change it, and any risks. Setting: "${e.title}" (${e.technical}). ${e.description}${e.warning ? ` Warning: ${e.warning}` : ''}` });

  const fav = async (id: string) => setFavs(await api.catalog.setFavourite(id, !favs.includes(id)));

  const exportProfile = async () => {
    const text = await api.catalog.exportProfile('My setup', favs.length && tab === 'favourites' ? favs : undefined);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'keeper-setup-profile.json';
    a.click();
    toast('Setup profile saved');
  };
  const importProfile = async (f: File) => {
    try {
      const text = await f.text();
      const p = await api.catalog.previewProfile(text);
      setProfile({ text, name: p.name, items: p.items, pick: new Set(p.items.filter((i) => i.status === 'change').map((i) => i.id)) });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  if (!entries) return <div className="page sp-page"><PageHead title="System Settings+" sub="Loading the catalogue…" /></div>;

  return (
    <div className="page sp-page" data-testid="catalog-page">
      <PageHead title="System Settings+" sub={`${entries.length} settings for this computer (${counts.darwin ?? 0} macOS, ${counts.win32 ?? 0} Windows, ${counts.linux ?? 0} Linux in all). Keeper shows the exact command, backs up first, and every change can be undone.`}>
        <button className="btn sm" onClick={() => void exportProfile()} data-testid="cat-export"><Icon name="down" size={13} /> Export profile</button>
        <label className="btn sm"><Icon name="folder" size={13} /> Import profile…<input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importProfile(e.target.files[0])} /></label>
      </PageHead>

      <Tabs label="Hidden system settings" value={tab} onChange={setTab} items={(['all', 'favourites', 'changes', 'backups'] as Tab[]).map((t) => ({ id: t, testId: `cat-tab-${t}`, label: t === 'all' ? 'All settings' : t === 'favourites' ? 'Favorites' : t === 'changes' ? 'Changes' : 'Backups', badge: t === 'favourites' ? favs.length : t === 'changes' ? log.length : t === 'backups' ? backups.length : undefined }))} />

      {tab === 'all' || tab === 'favourites' ? (
        <>
          <div className="qc-search">
            <Icon name="search" size={14} />
            <input placeholder="Search settings — e.g. hidden files, swappiness, telemetry, key repeat" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} aria-label="Search settings" data-testid="cat-search" autoFocus />
          </div>
          <div className="sp-cats">
            <button className={`chip ${!cat ? 'on' : ''}`} aria-pressed={!cat} onClick={() => setCat(null)}>All</button>
            {cats.map((c) => <button key={c} className={`chip ${cat === c ? 'on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>{c}</button>)}
          </div>
          {!list.length ? <Empty title="No settings match" /> : (
            <div className="card">
              {visible.map((e) => {
                const r = values.get(e.id);
                return (
                  <div key={e.id} className="qc-row" data-testid={`cat-row-${e.id}`} data-value={r?.value ?? ''}>
                    <div className="qc-txt">
                      <div className="qc-label">
                        {e.title}
                        {e.admin ? <span className="qc-how qc-how-admin">Needs password</span> : null}
                        {e.risk !== 'low' ? <span className={`qc-how sp-risk-${e.risk}`}>{e.risk} risk</span> : null}
                        {r && !r.isDefault ? <span className="qc-how qc-how-direct" title="Not the system default">Changed</span> : null}
                        <span className="qc-how">{e.category}</span>
                      </div>
                      <div className="muted qc-desc">{e.description}{e.versions ? ` (${e.versions})` : ''}</div>
                      {open === e.id ? (
                        <div className="qc-desc">
                          <div className="sp-tech">{e.technical}</div>
                          <div>{e.afterText}. System default: {label(e, e.systemDefault) || 'not set'}.</div>
                          {e.warning ? <div style={{ color: 'var(--danger)' }}>{e.warning}</div> : null}
                          {e.steps ? <ol className="sp-steps">{e.steps.map((s) => <li key={s}>{s}</li>)}</ol> : null}
                          {e.advice && r?.raw ? <pre className="sp-cmds">{r.raw.slice(0, 1500)}</pre> : null}
                          <div>Sources: {e.sources.map((s) => <a key={s} href={s} onClick={(x) => { x.preventDefault(); void api.system.openExternal(s); }} style={{ marginRight: 8 }}>{new URL(s).hostname}</a>)}</div>
                        </div>
                      ) : null}
                    </div>
                    <div className="sp-ctl">
                      <ValueInput e={e} r={r} onChange={(v) => void ask(e, v)} />
                      <button className={`btn ghost sm icon sp-fav ${favs.includes(e.id) ? 'on' : ''}`} title={favs.includes(e.id) ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void fav(e.id)} aria-label="Favourite">★</button>
                      <button className="btn ghost sm icon" title="Details, command and sources" onClick={() => setOpen(open === e.id ? null : e.id)} aria-label="Details"><Icon name="info" size={13} /></button>
                      <button className="btn ghost sm icon" title="Ask your AI to explain this setting" onClick={() => explain(e)} aria-label="Explain"><Icon name="sparkle" size={13} /></button>
                      {!e.advice && r && !r.isDefault ? <button className="btn ghost sm icon" title="Put the system default back" onClick={() => void api.catalog.reset(e.id).then((x) => { toast(x.message); void reread(e.id); })} aria-label="Reset"><Icon name="refresh" size={13} /></button> : null}
                    </div>
                  </div>
                );
              })}
              {list.length > shown ? <div className="sp-more"><button className="btn sm" onClick={() => setShown(shown + PAGE)}>Show more ({list.length - shown})</button></div> : null}
            </div>
          )}
        </>
      ) : null}

      {tab === 'changes' ? (
        !log.length ? <Empty icon="history" title="No changes yet">Changes you make here, from a profile or by an AI agent you allowed, are listed with undo.</Empty> : (
          <div className="card" data-testid="cat-log">
            {log.map((l) => (
              <div key={l.id} className={`qc-log-row ${l.undone ? 'undone' : ''}`}>
                <div className="qc-txt">
                  <div className="qc-label">{l.title} <span className="qc-how">{l.by}</span>{l.undone ? <span className="qc-how">undone</span> : null}</div>
                  <div className="muted qc-desc">{new Date(l.at).toLocaleString()} — {l.from ?? 'not set'} → {l.to === UNSET ? 'system default' : l.to}{l.backup ? ' · backed up first' : ''}</div>
                </div>
                {!l.undone && l.by !== 'restore' ? <button className="btn sm" onClick={() => void api.catalog.undo(l.id).then((r) => { toast(r.message); setValues(new Map()); loadLog(); })}>Undo</button> : null}
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === 'backups' ? (
        !backups.length ? <Empty icon="history" title="No backups yet">Before Keeper first changes an area each day (a preferences domain, a registry key, a GNOME schema), it saves a copy here.</Empty> : (
          <div className="card">
            {backups.map((b) => (
              <div key={b.id} className="qc-log-row">
                <div className="qc-txt">
                  <div className="qc-label">{b.target} <span className="qc-how">{b.kind}</span></div>
                  <div className="muted qc-desc">{new Date(b.at).toLocaleString()} — before “{b.title}”</div>
                  <div className="sp-tech">{b.file}</div>
                </div>
                <button className="btn sm" onClick={() => void api.catalog.restoreBackup(b.id).then((r) => { toast(r.message); setValues(new Map()); loadLog(); })}>Restore</button>
              </div>
            ))}
          </div>
        )
      ) : null}

      {pending ? (
        <Modal title={`Change “${pending.e.title}”`} onClose={() => setPending(null)} width={560}>
          <div className="qc-plan" data-testid="cat-preview">
            <p>{label(pending.e, pending.p.from) || 'Not set'} → <b>{pending.value === UNSET ? 'system default' : label(pending.e, pending.value)}</b></p>
            {pending.p.warning ? <div className="qc-warn"><Icon name="warning" size={16} /><p>{pending.p.warning}</p></div> : null}
            <div className="muted small">Keeper will run exactly this{pending.p.admin ? ' (your system will ask for the administrator password once)' : ''}:</div>
            <pre className="sp-cmds" data-testid="cat-commands">{pending.p.commands.join('\n')}</pre>
            {pending.p.backup ? <div className="muted small">First it saves a backup: <code>{pending.p.backup}</code></div> : null}
            <div className="muted small">{pending.p.afterText}. You can undo it from Changes.</div>
            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setPending(null)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={() => void applyPending()} data-testid="cat-apply">{busy ? 'Applying…' : 'Apply'}</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {profile ? (
        <Modal title={`Apply “${profile.name}”`} onClose={() => setProfile(null)} width={600}>
          <div className="qc-plan" data-testid="cat-profile-preview">
            <div className="muted small">Nothing has changed yet. Pick what to apply:</div>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {profile.items.map((i) => (
                <li key={i.id} className="row" style={{ gap: 8 }}>
                  <input type="checkbox" disabled={i.status !== 'change'} checked={profile.pick.has(i.id)} onChange={(x) => { const s = new Set(profile.pick); if (x.target.checked) s.add(i.id); else s.delete(i.id); setProfile({ ...profile, pick: s }); }} />
                  <span className="grow">{i.title} <span className="muted">{i.from ?? '—'} → {i.to}</span></span>
                  <span className="qc-how">{i.status === 'change' ? (i.admin ? 'needs password' : 'will change') : i.status.replace('-', ' ')}</span>
                </li>
              ))}
            </ul>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setProfile(null)}>Cancel</button>
              <button className="btn primary" disabled={!profile.pick.size} onClick={() => void api.catalog.applyProfile(profile.text, [...profile.pick]).then((r) => { toast(`${r.filter((x) => x.ok).length} of ${r.length} applied`); setProfile(null); setValues(new Map()); loadLog(); })}>Apply {profile.pick.size}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
