// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sync & Backup: folders kept the same on your devices, encrypted backups to
// drives and cloud services, mirrors to cloud folders, and older versions.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BackupJobStatus, ConflictInfo, MirrorJobStatus, SnapshotSummary, StoreChoice, StoreTarget, SyncFolderStatus, SyncOverview, VersionInfo, VersionPolicy } from '../../core/api-sync';
import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Loading, Modal, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/sync.css';

type Tab = 'folders' | 'backups' | 'mirrors' | 'versions';

const MODE_LABEL: Record<SyncFolderStatus['mode'], string> = { 'two-way': 'Two-way', 'send-only': 'Send only', 'receive-only': 'Receive only' };
const MODE_HELP: Record<SyncFolderStatus['mode'], string> = {
  'two-way': 'Changes on any device reach the others.',
  'send-only': 'This device sends its changes; changes made elsewhere are not applied here.',
  'receive-only': 'This device takes changes from the others; its own edits stay here.',
};
const SCHEDULE_LABEL: Record<BackupJobStatus['schedule'], string> = { manual: 'When I start it', hourly: 'Every hour', daily: 'Every day', idle: 'Once a day, when the computer is idle', drive: 'When the drive is plugged in' };
const VIA_LABEL: Record<string, string> = { lan: 'same network', direct: 'internet, direct', relay: 'through your relay', tunnel: 'through your tunnel', loopback: 'test link' };

function useOverview() {
  const [ov, setOv] = useState<SyncOverview | null>(null);
  const load = useCallback(() => void api.sync.overview().then(setOv).catch(() => undefined), []);
  useEffect(() => {
    load();
    const off = api.on('sync-changed' as 'navigate', load as never);
    const t = setInterval(load, 4000);
    return () => { off(); clearInterval(t); };
  }, [load]);
  return [ov, setOv, load] as const;
}

export function Sync() {
  const { route } = useStore();
  const [tab, setTab] = useState<Tab>((['folders', 'backups', 'mirrors', 'versions'] as Tab[]).includes(route.arg as Tab) ? (route.arg as Tab) : 'folders');
  const [ov, setOv, reload] = useOverview();
  if (!ov) return <Loading />;
  return (
    <div className="sync-page">
      <PageHead
        title="Sync & Backup"
        sub={<>This device: <b>{ov.deviceName}</b>{ov.transport === 'none' ? ' · no other devices paired yet' : ` · ${ov.peers.filter((p) => p.online).length} of ${ov.peers.length} devices online`}{ov.waitingFor ? ` · ${ov.waitingFor}` : ''}</>}
      >
        <button className={`btn ${ov.paused ? 'primary' : ''}`} onClick={() => void api.sync.setPaused(!ov.paused).then(setOv)}>
          <Icon name={ov.paused ? 'play' : 'pause'} size={14} /> {ov.paused ? 'Resume' : 'Pause all'}
        </button>
      </PageHead>

      <Check321 ov={ov} onAdd={() => setTab('backups')} />

      <div className="seg sync-tabs">
        {(['folders', 'backups', 'mirrors', 'versions'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'folders' ? `Synced folders (${ov.folders.length})` : t === 'backups' ? `Backups (${ov.backups.length})` : t === 'mirrors' ? `Cloud mirrors (${ov.mirrors.length})` : 'Versions'}
          </button>
        ))}
      </div>

      {tab === 'folders' ? <Folders ov={ov} onChange={setOv} reload={reload} /> : null}
      {tab === 'backups' ? <Backups ov={ov} onChange={setOv} reload={reload} /> : null}
      {tab === 'mirrors' ? <Mirrors ov={ov} onChange={setOv} /> : null}
      {tab === 'versions' ? <Versions ov={ov} /> : null}

      <Options ov={ov} onChange={setOv} />
    </div>
  );
}

function Check321({ ov, onAdd }: { ov: SyncOverview; onAdd: () => void }) {
  const c = ov.check321;
  return (
    <div className={`card sync-321 ${c.ok ? 'ok' : ''}`}>
      <div className="sync-321-dots">
        {[0, 1, 2].map((i) => <span key={i} className={i < c.copies ? 'on' : ''} />)}
      </div>
      <div className="grow">
        <div className="sync-321-title">{c.ok ? 'Your files are well protected' : `${c.copies} ${c.copies === 1 ? 'copy' : 'copies'} of your files`}</div>
        <div className="small muted">
          {c.ok ? 'Three copies, on two kinds of storage, one of them away from here.' : c.advice[0]}
        </div>
      </div>
      <div className="sync-321-facts small">
        <span className={c.copies >= 3 ? 'yes' : ''}><Icon name={c.copies >= 3 ? 'check' : 'minus'} size={12} /> 3 copies</span>
        <span className={c.kinds >= 2 ? 'yes' : ''}><Icon name={c.kinds >= 2 ? 'check' : 'minus'} size={12} /> 2 kinds of storage</span>
        <span className={c.offsite ? 'yes' : ''}><Icon name={c.offsite ? 'check' : 'minus'} size={12} /> 1 away from here</span>
      </div>
      {!c.ok ? <button className="btn sm" onClick={onAdd}>Add a backup</button> : null}
    </div>
  );
}

// ---------------------------------------------------------------- folders

function Folders({ ov, onChange, reload }: { ov: SyncOverview; onChange: (o: SyncOverview) => void; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SyncFolderStatus | null>(null);
  const [conflicts, setConflicts] = useState<SyncFolderStatus | null>(null);
  const [accepting, setAccepting] = useState<SyncOverview['offers'][number] | null>(null);
  return (
    <div className="col" style={{ gap: 12 }}>
      {ov.offers.map((o) => (
        <div key={o.id} className="card sync-note sync-offer">
          <Icon name="refresh" size={18} />
          <div className="grow small"><b>{o.peerName}</b> wants to sync “{o.label}” with this computer.</div>
          <button className="btn sm primary" onClick={() => setAccepting(o)}>Choose a folder…</button>
          <button className="btn sm ghost" onClick={() => void api.sync.ignoreOffer(o.id).then(onChange)}>Not now</button>
        </div>
      ))}
      {ov.transport === 'none' ? (
        <div className="card sync-note">
          <Icon name="laptop" size={18} />
          <div className="grow small">{ov.transportMessage ?? 'Pair another device to sync folders with it.'} Folders sync directly between your devices, end-to-end encrypted, with no cloud in between.</div>
        </div>
      ) : null}
      {ov.folders.length ? ov.folders.map((f) => (
        <div key={f.id} className="card sync-folder">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div className={`sync-icon state-${f.state}`}><Icon name="folder" size={20} /></div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <b className="ellipsis">{f.label}</b>
                <span className="badge">{MODE_LABEL[f.mode]}</span>
                <StateBadge state={f.state} />
                {f.conflicts ? <button className="badge warn" onClick={() => setConflicts(f)}>{f.conflicts} conflict{f.conflicts > 1 ? 's' : ''}</button> : null}
              </div>
              <div className="small muted ellipsis">{f.path}</div>
              <div className="small muted">{f.files.toLocaleString()} file{f.files === 1 ? '' : 's'} · {formatBytes(f.bytes)}{f.lastScan ? ` · looked ${relativeTime(f.lastScan)}` : ''}{f.message ? ` · ${f.message}` : ''}</div>
              {f.progress ? (
                <div className="sync-progress">
                  <div className="progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(f.progress.total ? Math.round((f.progress.done / f.progress.total) * 100) : 0) || 0)}><i style={{ width: `${f.progress.total ? Math.round((f.progress.done / f.progress.total) * 100) : 0}%` }} /></div>
                  <span className="small muted ellipsis">{f.progress.file} · {f.progress.queued} more</span>
                </div>
              ) : null}
              <div className="sync-peers">
                {f.peers.map((p) => (
                  <span key={p.id} className={`sync-peer ${p.online ? 'online' : ''} ${p.state}`} title={p.message ?? (p.online ? `Connected (${VIA_LABEL[p.via ?? ''] ?? p.via ?? ''})` : 'Offline')}>
                    <i />{p.name}{p.lastSync ? <span className="muted"> · {relativeTime(p.lastSync)}</span> : null}
                  </span>
                ))}
                {!f.peers.length ? <span className="small muted">Not shared with any device yet</span> : null}
              </div>
            </div>
            <div className="btn-row">
              <button className="btn sm ghost icon" title="Look for changes now" aria-label="Look for changes now" onClick={() => void api.sync.rescan(f.id).then(reload)}><Icon name="refresh" size={14} /></button>
              <button className="btn sm ghost icon" title={f.paused ? 'Resume' : 'Pause'} aria-label={f.paused ? 'Resume' : 'Pause'} onClick={() => void api.sync.updateFolder(f.id, { paused: !f.paused }).then(onChange)}><Icon name={f.paused ? 'play' : 'pause'} size={14} /></button>
              <button className="btn sm ghost icon" title="Settings" aria-label="Settings" onClick={() => setEditing(f)}><Icon name="settings" size={14} /></button>
            </div>
          </div>
        </div>
      )) : (
        <Empty icon="refresh" title="No synced folders yet">Choose a folder and the devices to keep it the same on. Older versions are kept, and conflicting edits are never lost.</Empty>
      )}
      <div><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Sync a folder</button></div>
      {adding ? <FolderDialog ov={ov} onClose={() => setAdding(false)} onSaved={onChange} /> : null}
      {accepting ? <FolderDialog ov={ov} offer={accepting} onClose={() => setAccepting(null)} onSaved={onChange} /> : null}
      {editing ? <FolderDialog ov={ov} folder={editing} onClose={() => setEditing(null)} onSaved={onChange} /> : null}
      {conflicts ? <ConflictsDialog folder={conflicts} onClose={() => { setConflicts(null); reload(); }} /> : null}
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, [string, string]> = {
    idle: ['Up to date', 'ok'], scanning: ['Looking for changes', ''], syncing: ['Syncing', 'accent'], paused: ['Paused', ''], error: ['Problem', 'danger'], waiting: ['Waiting', ''], running: ['Running', 'accent'],
  };
  const [label, tone] = map[state] ?? [state, ''];
  return <span className={`badge ${tone}`}>{label}</span>;
}

const POLICIES: { label: string; value: VersionPolicy }[] = [
  { label: 'Keep a version an hour, then one a day, then one a week (up to a year)', value: { type: 'staggered', maxDays: 365 } },
  { label: 'Keep everything replaced or deleted for 30 days', value: { type: 'trashcan', days: 30 } },
  { label: 'Keep the last 10 versions of each file', value: { type: 'simple', keep: 10 } },
  { label: 'Keep no older versions', value: { type: 'none' } },
];

function FolderDialog({ ov, folder, offer, onClose, onSaved }: { ov: SyncOverview; folder?: SyncFolderStatus; offer?: SyncOverview['offers'][number]; onClose: () => void; onSaved: (o: SyncOverview) => void }) {
  const { toast } = useStore();
  const [p, setP] = useState(folder?.path ?? '');
  const [label, setLabel] = useState(folder?.label ?? offer?.label ?? '');
  const [mode, setMode] = useState<SyncFolderStatus['mode']>(folder?.mode ?? 'two-way');
  const [devices, setDevices] = useState<string[]>(folder?.devices ?? (offer ? [offer.peer] : []));
  const [ignore, setIgnore] = useState((folder?.ignore ?? []).join('\n'));
  const [policy, setPolicy] = useState(JSON.stringify(folder?.versioning ?? POLICIES[0].value));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const patch = { label: label || p.split(/[\\/]/).pop() || 'Folder', mode, devices, ignore: ignore.split('\n').map((s) => s.trim()).filter(Boolean), versioning: JSON.parse(policy) as VersionPolicy };
      onSaved(folder ? await api.sync.updateFolder(folder.id, patch) : await api.sync.addFolder({ id: offer?.id, path: p, ...patch }));
      toast(folder ? 'Saved' : `Syncing ${patch.label}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={folder ? `${folder.label} settings` : offer ? `Sync “${offer.label}” from ${offer.peerName}` : 'Sync a folder'} onClose={onClose} width={560}>
      <div className="col" style={{ gap: 12 }}>
        {!folder ? (
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" value={p} placeholder="Folder on this computer" onChange={(e) => setP(e.target.value)} />
            <button className="btn" onClick={() => void api.settings.pickFolder().then((x) => { if (x) { setP(x); if (!label) setLabel(x.split(/[\\/]/).pop() ?? ''); } })}><Icon name="folder" size={14} /> Choose…</button>
          </div>
        ) : <div className="small muted">{folder.path}</div>}
        <input className="input" value={label} placeholder="Name" onChange={(e) => setLabel(e.target.value)} />
        <div>
          <div className="field-label">Devices</div>
          {ov.peers.length ? ov.peers.map((d) => (
            <label key={d.id} className="row small sync-check">
              <input type="checkbox" checked={devices.includes(d.id)} onChange={(e) => setDevices(e.target.checked ? [...devices, d.id] : devices.filter((x) => x !== d.id))} />
              <span className={`sync-dot ${d.online ? 'online' : ''}`} />{d.name}
            </label>
          )) : <div className="small muted">No devices paired yet. The folder is watched now and starts syncing once you pair a device and add it here.</div>}
        </div>
        <div>
          <div className="field-label">How</div>
          <div className="seg">
            {(['two-way', 'send-only', 'receive-only'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>)}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>{MODE_HELP[mode]}</div>
        </div>
        <div>
          <div className="field-label">Older versions</div>
          <select className="input" value={policy} onChange={(e) => setPolicy(e.target.value)}>
            {POLICIES.map((x) => <option key={x.label} value={JSON.stringify(x.value)}>{x.label}</option>)}
          </select>
        </div>
        <div>
          <div className="field-label">Leave out (one pattern a line, like a .gitignore)</div>
          <textarea className="input mono" rows={3} value={ignore} placeholder={'*.tmp\nnode_modules/\nCache/'} onChange={(e) => setIgnore(e.target.value)} />
        </div>
        {err ? <div className="small" style={{ color: 'var(--danger)' }}>{err}</div> : null}
        <div className="btn-row" style={{ justifyContent: 'space-between' }}>
          {folder ? <button className="btn ghost danger" onClick={() => void api.sync.removeFolder(folder.id).then((o) => { onSaved(o); onClose(); toast('Stopped syncing. Your files stay where they are.'); })}>Stop syncing</button> : <span />}
          <div className="btn-row">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || (!folder && !p)} onClick={() => void save()}>{folder ? 'Save' : 'Start syncing'}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ConflictsDialog({ folder, onClose }: { folder: SyncFolderStatus; onClose: () => void }) {
  const [list, setList] = useState<ConflictInfo[] | null>(null);
  const load = () => void api.sync.conflicts(folder.id).then(setList);
  useEffect(load, [folder.id]);
  const resolve = async (c: ConflictInfo, keep: 'mine' | 'theirs' | 'both') => {
    await api.sync.resolveConflict(folder.id, c.copy, keep);
    load();
  };
  return (
    <Modal title={`Conflicts in ${folder.label}`} onClose={onClose} width={640}>
      <p className="small muted" style={{ marginTop: 0 }}>The same file was changed on two devices before they could talk. Both versions were kept. Choose what to keep; the other one becomes an older version you can still restore.</p>
      {!list ? <Loading /> : !list.length ? <Empty icon="check" title="No conflicts left" /> : list.map((c) => (
        <div key={c.copy} className="sync-conflict">
          <div className="sync-conflict-files">
            <button className="sync-conflict-file" onClick={() => void api.files.reveal(`${folder.path}/${c.path}`)}>
              <b className="ellipsis">{c.path}</b>
              <span className="small muted">{formatBytes(c.size)} · changed {relativeTime(c.mtime)}</span>
            </button>
            <button className="sync-conflict-file" onClick={() => void api.files.reveal(`${folder.path}/${c.copy}`)}>
              <b className="ellipsis">{c.copy}</b>
              <span className="small muted">{formatBytes(c.copySize)} · changed {relativeTime(c.copyMtime)}</span>
            </button>
          </div>
          <div className="btn-row">
            <button className="btn sm" onClick={() => void resolve(c, 'mine')}>Keep the first</button>
            <button className="btn sm" onClick={() => void resolve(c, 'theirs')}>Keep the second</button>
            <button className="btn sm ghost" onClick={() => void resolve(c, 'both')}>Keep both</button>
          </div>
        </div>
      ))}
    </Modal>
  );
}

// ---------------------------------------------------------------- backups

function Backups({ ov, onChange, reload }: { ov: SyncOverview; onChange: (o: SyncOverview) => void; reload: () => void }) {
  const { toast } = useStore();
  const [adding, setAdding] = useState(false);
  const [restoring, setRestoring] = useState<BackupJobStatus | null>(null);
  const [asking, setAsking] = useState<{ job: BackupJobStatus; then: (pw: string) => void } | null>(null);
  const withPassword = (job: BackupJobStatus, fn: (pw?: string) => void) => (job.needsPassword ? setAsking({ job, then: fn }) : fn());
  const verify = (b: BackupJobStatus) => withPassword(b, async (pw) => {
    toast('Checking the backup…');
    const r = await api.sync.verifyBackup(b.id, false, pw).catch((e: Error) => ({ ok: false, problems: [e.message], checked: 0 }));
    toast(r.ok ? `The backup is fine (${r.checked} pieces checked)` : `Problem: ${r.problems[0]}`);
    reload();
  });
  return (
    <div className="col" style={{ gap: 12 }}>
      {ov.backups.length ? ov.backups.map((b) => (
        <div key={b.id} className="card sync-folder">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div className={`sync-icon state-${b.state}`}><Icon name={b.dest.kind === 'connection' ? 'cloud' : 'disk'} size={20} /></div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <b className="ellipsis">{b.name}</b>
                <span className="badge"><Icon name="lock" size={10} /> Encrypted</span>
                <StateBadge state={b.state === 'idle' && b.lastOk === false ? 'error' : b.state} />
                {b.testDue ? <button className="badge warn" title="Check that this backup can be restored" onClick={() => verify(b)}>Test due</button> : null}
              </div>
              <div className="small muted ellipsis">{b.sources.map((s) => s.name).join(', ')} → {b.destLabel}</div>
              <div className="small muted">
                {SCHEDULE_LABEL[b.schedule]}
                {b.lastRun ? ` · last ${relativeTime(b.lastRun)}${b.lastMessage ? `: ${b.lastMessage}` : ''}` : ' · not run yet'}
                {b.nextRun ? ` · next ${relativeTime(b.nextRun)}` : ''}
                {b.snapshots !== undefined ? ` · ${b.snapshots} backups kept` : ''}
              </div>
              {b.progress ? (
                <div className="sync-progress">
                  <div className="progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(b.progress.totalBytes ? Math.min(100, Math.round((b.progress.bytes / b.progress.totalBytes) * 100)) : 30) || 0)}><i style={{ width: `${b.progress.totalBytes ? Math.min(100, Math.round((b.progress.bytes / b.progress.totalBytes) * 100)) : 30}%` }} /></div>
                  <span className="small muted ellipsis">{b.progress.files.toLocaleString()} files · {formatBytes(b.progress.bytes)}{b.progress.file ? ` · ${b.progress.file}` : ''}</span>
                </div>
              ) : null}
            </div>
            <div className="btn-row">
              {b.state === 'running' ? (
                <button className="btn sm" onClick={() => void api.sync.cancelBackup(b.id).then(reload)}><Icon name="close" size={13} /> Stop</button>
              ) : (
                <button className="btn sm primary" onClick={() => withPassword(b, (pw) => void api.sync.runBackup(b.id, pw).then(onChange))}><Icon name="arrowUp" size={13} /> Back up now</button>
              )}
              <button className="btn sm" onClick={() => withPassword(b, () => setRestoring(b))}><Icon name="undo" size={13} /> Restore…</button>
              <button className="btn sm ghost icon" title="Check the backup" aria-label="Check the backup" onClick={() => verify(b)}><Icon name="shield" size={14} /></button>
              <button className="btn sm ghost icon" title="Remove (the backup itself stays where it is)" aria-label="Remove (the backup itself stays where it is)" onClick={() => void api.sync.removeBackup(b.id).then(onChange)}><Icon name="trash" size={14} /></button>
            </div>
          </div>
        </div>
      )) : (
        <Empty icon="shield" title="No backups yet">Back up folders to a drive, a NAS or a cloud service. Everything is encrypted on this computer first, and each backup only adds what changed.</Empty>
      )}
      <div><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> New backup</button></div>
      {adding ? <BackupWizard onClose={() => setAdding(false)} onSaved={onChange} /> : null}
      {restoring ? <RestoreDialog job={restoring} onClose={() => setRestoring(null)} /> : null}
      {asking ? <PasswordDialog job={asking.job} onClose={() => setAsking(null)} onOk={(pw) => { const t = asking.then; setAsking(null); t(pw); }} /> : null}
    </div>
  );
}

function PasswordDialog({ job, onClose, onOk }: { job: BackupJobStatus; onClose: () => void; onOk: (pw: string) => void }) {
  const [pw, setPw] = useState('');
  return (
    <Modal title={`Password for ${job.name}`} onClose={onClose} width={420}>
      <p className="small muted" style={{ marginTop: 0 }}>This computer does not remember this backup’s password. Enter it, or the recovery key.</p>
      <input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pw && onOk(pw)} />
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!pw} onClick={() => onOk(pw)}>Continue</button>
      </div>
    </Modal>
  );
}

function useDestinations() {
  const [list, setList] = useState<StoreChoice[] | null>(null);
  useEffect(() => void api.sync.destinations().then(setList).catch(() => setList([])), []);
  return list;
}

function DestinationPicker({ value, onChange }: { value: StoreTarget | null; onChange: (t: StoreTarget) => void }) {
  const dests = useDestinations();
  const [sub, setSub] = useState('Keeper Backup');
  const key = (t: StoreTarget | null) => (!t ? '' : t.kind === 'folder' ? `f:${t.path}` : `c:${t.connectionId}`);
  return (
    <div className="sync-dests">
      {(dests ?? []).map((d) => {
        const t: StoreTarget = d.kind === 'folder' ? { kind: 'folder', path: `${d.path}/${sub}` } : { kind: 'connection', connectionId: d.id!, path: `/${sub}`, label: d.label };
        const on = value && (value.kind === 'folder' ? d.kind === 'folder' && value.path.startsWith(d.path ?? '\0') : d.kind === 'connection' && value.connectionId === d.id);
        return (
          <button key={key(t)} className={`sync-dest ${on ? 'on' : ''}`} disabled={d.online === false} onClick={() => onChange(t)}>
            <Icon name={d.detail === 'drive' ? 'usb' : d.detail === 'nas' ? 'server' : d.kind === 'connection' || d.detail.includes('cloud') ? 'cloud' : 'folder'} size={18} />
            <span><b>{d.label}</b><span className="small muted">{d.online === false ? 'not reachable now' : d.detail}</span></span>
          </button>
        );
      })}
      <button className={`sync-dest ${value?.kind === 'folder' && !(dests ?? []).some((d) => d.path && value.path.startsWith(d.path)) ? 'on' : ''}`} onClick={() => void api.settings.pickFolder().then((p) => p && onChange({ kind: 'folder', path: p }))}>
        <Icon name="folder" size={18} />
        <span><b>Another folder…</b><span className="small muted">a drive, a NAS share, anywhere</span></span>
      </button>
      {dests === null ? <Loading /> : null}
      {value ? <div className="small muted" style={{ gridColumn: '1 / -1' }}>Saved in <b>{value.kind === 'folder' ? value.path : `${value.label ?? 'connection'} › ${value.path}`}</b> <input className="input sm" style={{ width: 160, marginLeft: 6 }} value={sub} onChange={(e) => setSub(e.target.value)} title="Folder name there" /></div> : null}
    </div>
  );
}

function BackupWizard({ onClose, onSaved }: { onClose: () => void; onSaved: (o: SyncOverview) => void }) {
  const { info, toast } = useStore();
  const home = info?.home ?? '';
  const sep = info?.sep ?? '/';
  const presets = [
    { name: 'Documents', path: `${home}${sep}Documents` },
    { name: 'Pictures', path: `${home}${sep}Pictures` },
    { name: 'Desktop', path: `${home}${sep}Desktop` },
    { name: 'Movies', path: `${home}${sep}${info?.platform === 'win32' ? 'Videos' : 'Movies'}` },
    { name: 'Music', path: `${home}${sep}Music` },
  ];
  const [step, setStep] = useState(0);
  const [name, setName] = useState('My backup');
  const [sources, setSources] = useState(presets.slice(0, 3));
  const [dest, setDest] = useState<StoreTarget | null>(null);
  const [schedule, setSchedule] = useState<BackupJobStatus['schedule']>('daily');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.sync.addBackup({ name, sources, dest: dest!, schedule, password: pw, remember });
      onSaved(r.overview);
      if (r.recovery) setRecovery(r.recovery);
      else { toast('Joined the backup that was already there'); onClose(); }
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (recovery) {
    return (
      <Modal title="Save your recovery key" onClose={() => saved && onClose()} width={520}>
        <p className="small" style={{ marginTop: 0 }}>If you forget the password, this key is the only other way to open the backup. Keeper cannot recover it for you. Write it down or save it somewhere safe, away from this computer.</p>
        <div className="sync-recovery mono">{recovery}</div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => void navigator.clipboard.writeText(recovery)}><Icon name="copy" size={13} /> Copy</button>
        </div>
        <label className="row small" style={{ gap: 6, marginTop: 12 }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved the recovery key</label>
        <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn primary" disabled={!saved} onClick={() => { onClose(); toast('Backup set up. The first one starts on its schedule, or press Back up now.'); }}>Done</button>
        </div>
      </Modal>
    );
  }
  const steps = ['What', 'Where', 'When', 'Password'];
  const can = [sources.length > 0 && !!name.trim(), !!dest, true, pw.length >= 8 && pw === pw2];
  return (
    <Modal title="New backup" onClose={onClose} width={620}>
      <div className="sync-steps">{steps.map((s, i) => <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{i + 1}. {s}</span>)}</div>
      {step === 0 ? (
        <div className="col" style={{ gap: 10 }}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <div className="field-label">Folders to back up</div>
          {presets.map((p) => (
            <label key={p.name} className="row small sync-check"><input type="checkbox" checked={sources.some((s) => s.path === p.path)} onChange={(e) => setSources(e.target.checked ? [...sources, p] : sources.filter((s) => s.path !== p.path))} />{p.name}<span className="muted ellipsis">{p.path}</span></label>
          ))}
          {sources.filter((s) => !presets.some((p) => p.path === s.path)).map((s) => (
            <label key={s.path} className="row small sync-check"><input type="checkbox" checked onChange={() => setSources(sources.filter((x) => x.path !== s.path))} />{s.name}<span className="muted ellipsis">{s.path}</span></label>
          ))}
          <div><button className="btn sm" onClick={() => void api.settings.pickFolder().then((p) => p && !sources.some((s) => s.path === p) && setSources([...sources, { name: p.split(/[\\/]/).pop() || 'Folder', path: p }]))}><Icon name="plus" size={12} /> Add a folder…</button></div>
        </div>
      ) : step === 1 ? (
        <DestinationPicker value={dest} onChange={setDest} />
      ) : step === 2 ? (
        <div className="col" style={{ gap: 6 }}>
          {(Object.keys(SCHEDULE_LABEL) as BackupJobStatus['schedule'][]).filter((s) => s !== 'drive' || dest?.kind === 'folder').map((s) => (
            <label key={s} className={`update-mode ${schedule === s ? 'on' : ''}`}><input type="radio" checked={schedule === s} onChange={() => setSchedule(s)} /><div>{SCHEDULE_LABEL[s]}</div></label>
          ))}
          <div className="small muted">Keeper keeps the last 3 backups, one a day for a week, one a week for a month, one a month for a year and one a year for 3 years. Unchanged files take no extra space.</div>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <p className="small muted" style={{ margin: 0 }}>Your files are encrypted on this computer with this password before they leave it. Where they are stored only ever sees scrambled data.</p>
          <input className="input" type="password" placeholder="Password (8 characters or more)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <input className="input" type="password" placeholder="The same password again" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {pw2 && pw !== pw2 ? <div className="small" style={{ color: 'var(--danger)' }}>The passwords are not the same.</div> : null}
          <label className="row small" style={{ gap: 6 }}><Toggle on={remember} onChange={setRemember} /> Remember it on this computer (in the system keychain), so scheduled backups can run</label>
        </div>
      )}
      {err ? <div className="small" style={{ color: 'var(--danger)', marginTop: 10 }}>{err}</div> : null}
      <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
        <button className="btn" onClick={() => (step ? setStep(step - 1) : onClose())}>{step ? 'Back' : 'Cancel'}</button>
        {step < 3 ? <button className="btn primary" disabled={!can[step]} onClick={() => setStep(step + 1)}>Next</button> : <button className="btn primary" disabled={!can[3] || busy} onClick={() => void create()}>{busy ? 'Setting up…' : 'Create backup'}</button>}
      </div>
    </Modal>
  );
}

function RestoreDialog({ job, onClose }: { job: BackupJobStatus; onClose: () => void }) {
  const { toast } = useStore();
  const [snaps, setSnaps] = useState<SnapshotSummary[] | null>(null);
  const [snap, setSnap] = useState<SnapshotSummary | null>(null);
  const [files, setFiles] = useState<{ path: string; size: number; mtime: number }[] | null>(null);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => void api.sync.snapshots(job.id).then((s) => { setSnaps(s); setSnap(s[0] ?? null); }).catch((e: Error) => setErr(e.message)), [job.id]);
  useEffect(() => { if (snap) { setFiles(null); void api.sync.snapshotFiles(job.id, snap.name).then(setFiles); } }, [job.id, snap]);
  const shown = useMemo(() => (files ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 400), [files, filter]);
  const go = async () => {
    if (!snap) return;
    setBusy(true);
    try {
      const r = await api.sync.restore(job.id, snap.name, { include: picked.size ? [...picked] : undefined, target: target || undefined });
      toast(`Restored ${r.files.toLocaleString()} files to ${r.target}`);
      void api.files.reveal(r.target);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Restore from ${job.name}`} onClose={onClose} width={720}>
      {!snaps ? (err ? <div className="small" style={{ color: 'var(--danger)' }}>{err}</div> : <Loading label="Opening the backup…" />) : !snaps.length ? <Empty icon="shield" title="No backups yet" /> : (
        <div className="sync-restore">
          <div className="sync-snaps">
            {snaps.map((s) => (
              <button key={s.name} className={snap?.name === s.name ? 'on' : ''} onClick={() => setSnap(s)}>
                <b>{new Date(s.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</b>
                <span className="small muted">{s.stats.files.toLocaleString()} files · {formatBytes(s.stats.bytes)}</span>
              </button>
            ))}
          </div>
          <div className="col grow" style={{ gap: 8, minWidth: 0 }}>
            <input className="input" placeholder="Find a file in this backup…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="sync-files">
              {!files ? <Loading /> : shown.map((f) => (
                <label key={f.path} className="row small sync-check">
                  <input type="checkbox" checked={picked.has(f.path)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(f.path); else n.delete(f.path); setPicked(n); }} />
                  <span className="ellipsis grow">{f.path}</span><span className="muted">{formatBytes(f.size)}</span>
                </label>
              ))}
            </div>
            <div className="small muted">{picked.size ? `${picked.size} chosen` : 'Nothing chosen: everything in this backup is restored.'} Existing files are never overwritten.</div>
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow" placeholder="Restore into ~/Restored/…" value={target} onChange={(e) => setTarget(e.target.value)} />
              <button className="btn" onClick={() => void api.settings.pickFolder().then((p) => p && setTarget(p))}>Choose…</button>
            </div>
            {err ? <div className="small" style={{ color: 'var(--danger)' }}>{err}</div> : null}
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={busy || !snap} onClick={() => void go()}>{busy ? 'Restoring…' : 'Restore'}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- mirrors

function Mirrors({ ov, onChange }: { ov: SyncOverview; onChange: (o: SyncOverview) => void }) {
  const [adding, setAdding] = useState(false);
  const dir = (m: MirrorJobStatus) => (m.direction === 'up' ? 'This computer → there' : m.direction === 'down' ? 'There → this computer' : 'Both ways');
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="small muted">Mirrors keep ordinary files in a cloud folder, so you also see them in the service’s own app and web page (unlike backups, which are encrypted).</div>
      {ov.mirrors.length ? ov.mirrors.map((m) => (
        <div key={m.id} className="card sync-folder">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <div className={`sync-icon state-${m.state}`}><Icon name="cloud" size={20} /></div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}><b className="ellipsis">{m.name}</b><span className="badge">{dir(m)}</span><StateBadge state={m.state} /></div>
              <div className="small muted ellipsis">{m.local} ↔ {m.destLabel}</div>
              <div className="small muted">{m.schedule === 'live' ? 'As soon as something changes' : m.schedule === 'hourly' ? 'Every hour' : 'When I start it'}{m.lastRun ? ` · last ${relativeTime(m.lastRun)}${m.lastMessage ? `: ${m.lastMessage}` : ''}` : ''}</div>
              {m.progress ? <div className="sync-progress"><div className="progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(Math.round((m.progress.done / Math.max(1, m.progress.total)) * 100)) || 0)}><i style={{ width: `${Math.round((m.progress.done / Math.max(1, m.progress.total)) * 100)}%` }} /></div><span className="small muted ellipsis">{m.progress.file}</span></div> : null}
            </div>
            <div className="btn-row">
              <button className="btn sm" onClick={() => void api.sync.runMirror(m.id).then(onChange)}><Icon name="refresh" size={13} /> Run now</button>
              <button className="btn sm ghost icon" title="Remove (files stay on both sides)" aria-label="Remove (files stay on both sides)" onClick={() => void api.sync.removeMirror(m.id).then(onChange)}><Icon name="trash" size={14} /></button>
            </div>
          </div>
        </div>
      )) : <Empty icon="cloud" title="No mirrors yet">For example, keep Screenshots copied to OneDrive, or a Scans folder the same here and in iCloud Drive.</Empty>}
      <div><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> New mirror</button></div>
      {adding ? <MirrorDialog onClose={() => setAdding(false)} onSaved={onChange} /> : null}
    </div>
  );
}

function MirrorDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (o: SyncOverview) => void }) {
  const [local, setLocal] = useState('');
  const [dest, setDest] = useState<StoreTarget | null>(null);
  const [direction, setDirection] = useState<MirrorJobStatus['direction']>('up');
  const [schedule, setSchedule] = useState<MirrorJobStatus['schedule']>('hourly');
  return (
    <Modal title="New mirror" onClose={onClose} width={620}>
      <div className="col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" placeholder="Folder on this computer" value={local} onChange={(e) => setLocal(e.target.value)} />
          <button className="btn" onClick={() => void api.settings.pickFolder().then((p) => p && setLocal(p))}><Icon name="folder" size={14} /> Choose…</button>
        </div>
        <DestinationPicker value={dest} onChange={setDest} />
        <div className="seg">
          {(['up', 'down', 'both'] as const).map((d) => <button key={d} className={direction === d ? 'on' : ''} onClick={() => setDirection(d)}>{d === 'up' ? 'Copy there' : d === 'down' ? 'Copy here' : 'Both ways'}</button>)}
        </div>
        <div className="small muted">{direction === 'both' ? 'Changes on either side reach the other; if both change a file, both are kept.' : 'Files only on the other side are left alone. Deleting a file deletes the copy (it goes to the service’s trash, or to older versions here).'}</div>
        <select className="input" value={schedule} onChange={(e) => setSchedule(e.target.value as MirrorJobStatus['schedule'])}>
          <option value="live">As soon as something changes here (and every hour)</option>
          <option value="hourly">Every hour</option>
          <option value="manual">When I start it</option>
        </select>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!local || !dest} onClick={() => void api.sync.addMirror({ name: `${local.split(/[\\/]/).pop()}`, local, dest: dest!, direction, schedule }).then((o) => { onSaved(o); onClose(); })}>Start</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- versions

function Versions({ ov }: { ov: SyncOverview }) {
  const { toast } = useStore();
  const [folder, setFolder] = useState(ov.folders[0]?.id ?? '');
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(() => { if (folder) void api.sync.versions(folder).then(setList); }, [folder]);
  useEffect(load, [load]);
  if (!ov.folders.length) return <Empty icon="history" title="No synced folders">Older versions are kept for synced folders. Sync a folder to start keeping them.</Empty>;
  const shown = (list ?? []).filter((v) => !q || v.rel.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8 }}>
        <select className="input" value={folder} onChange={(e) => setFolder(e.target.value)} style={{ maxWidth: 260 }}>
          {ov.folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <input className="input grow" placeholder="Find a file…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!list ? <Loading /> : !shown.length ? <Empty icon="history" title="No older versions" /> : (
        <div className="card sync-versions">
          {shown.slice(0, 500).map((v) => (
            <div key={v.vrel} className="row sync-version">
              <Icon name="history" size={14} />
              <span className="grow ellipsis">{v.rel}</span>
              <span className="small muted">{new Date(v.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {formatBytes(v.size)}</span>
              <button className="btn sm" onClick={() => void api.sync.restoreVersion(folder, v.vrel).then((to) => { toast(`Restored ${to}`); load(); })}>Restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- options

function Options({ ov, onChange }: { ov: SyncOverview; onChange: (o: SyncOverview) => void }) {
  const [kb, setKb] = useState(String(ov.bandwidthKBps || ''));
  return (
    <details className="card sync-options">
      <summary>Options</summary>
      <div className="col" style={{ gap: 10, marginTop: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><b>Pause on battery</b><div className="small muted">Sync and backups wait until the computer is plugged in.</div></div>
          <Toggle on={ov.pauseOnBattery} onChange={(v) => void api.sync.setOptions({ pauseOnBattery: v }).then(onChange)} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><b>Photos and videos from phones</b><div className="small muted">Phones paired through Devices can send their camera roll here, sorted by phone and month. Files already here are skipped.<br />{ov.phoneUploads.folder}</div></div>
          <div className="btn-row">
            <button className="btn sm ghost" onClick={() => void api.settings.pickFolder().then((p) => p && void api.sync.setOptions({ phoneUploads: { ...ov.phoneUploads, folder: p } }).then(onChange))}>Change…</button>
            <Toggle on={ov.phoneUploads.enabled} onChange={(v) => void api.sync.setOptions({ phoneUploads: { ...ov.phoneUploads, enabled: v } }).then(onChange)} />
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><b>Speed limit between devices</b><div className="small muted">KB per second; empty for no limit.</div></div>
          <input className="input" style={{ width: 120 }} value={kb} placeholder="No limit" onChange={(e) => setKb(e.target.value.replace(/\D/g, ''))} onBlur={() => void api.sync.setOptions({ bandwidthKBps: Number(kb) || 0 }).then(onChange)} />
        </div>
      </div>
    </details>
  );
}

/** Older versions of a file in a synced folder, for the Inspector. */
export function FileVersions({ path: p }: { path: string }) {
  const { toast } = useStore();
  const [v, setV] = useState<Awaited<ReturnType<typeof api.sync.versionsFor>> | undefined>(undefined);
  useEffect(() => void api.sync.versionsFor(p).then(setV).catch(() => setV(null)), [p]);
  if (!v || !v.versions.length) return null;
  return (
    <div className="col">
      <h3>Older versions</h3>
      {v.versions.slice(0, 8).map((x) => (
        <div key={x.vrel || x.time} className="row small" style={{ gap: 6, padding: '3px 0' }}>
          <span className="grow">{relativeTime(x.time)}</span>
          <span className="muted">{formatBytes(x.size)}</span>
          <button className="btn sm ghost" onClick={() => void api.sync.restoreVersion(v.folderId, x.vrel).then(() => toast('Restored; the current file is kept as a version'))}>Restore</button>
        </div>
      ))}
    </div>
  );
}
