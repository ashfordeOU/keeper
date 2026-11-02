// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Copy, Cut and Paste between folders, Move to… and Copy to…, and dropping
// files onto folders, the way Finder and File Explorer do it: a name already
// there asks to replace, keep both or skip; long jobs show their progress;
// a move can be undone from the toast (and from History).

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ConflictChoice, TransferProgress } from '../core/fileops';
import type { CleanResult } from '../core/types';
import { api } from './api';
import { Icon } from './components/Icon';
import { Modal } from './components/ui';
import { useStore } from './state';
import './styles/fileops.css';

// ------------------------------------------------------------------ the file clipboard

export interface FileClip { op: 'copy' | 'cut'; paths: string[] }
let clip: FileClip | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Copy (or Cut) files to paste into another folder. Copy also puts them on the system clipboard. */
export function setFileClip(op: 'copy' | 'cut', paths: string[]) {
  if (!paths.length) return;
  clip = { op, paths: [...paths] };
  emit();
  void api.files.copyPaths(paths).catch(() => undefined);
}
export function fileClip(): FileClip | null { return clip; }
export function useFileClip(): FileClip | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => clip);
}

/** Pastes into dir: what was copied or cut in Keeper, else files copied in the system file manager. */
export async function pasteInto(dir: string) {
  let c = clip;
  if (!c) {
    const sys = await api.files.clipboardPaths?.().catch(() => []) ?? [];
    if (sys.length) c = { op: 'copy', paths: sys };
  }
  if (!c) { window.dispatchEvent(new CustomEvent('keeper-fileops-toast', { detail: 'Nothing to paste. Copy or cut files first.' })); return; }
  if (c.op === 'cut') { clip = null; emit(); }
  transfer(c.op === 'cut' ? 'move' : 'copy', c.paths, dir);
}

// ------------------------------------------------------------------ requests to the host

interface TransferRequest { op: 'copy' | 'move'; paths: string[]; dir: string }
/** Copies or moves files into dir; the host asks about clashing names and shows progress. */
export function transfer(op: 'copy' | 'move', paths: string[], dir: string) {
  if (!paths.length || !dir) return;
  window.dispatchEvent(new CustomEvent<TransferRequest>('keeper-transfer', { detail: { op, paths, dir } }));
}
/** "Move to…" or "Copy to…": the host asks where. */
export function chooseDestination(op: 'copy' | 'move', paths: string[]) {
  if (!paths.length) return;
  window.dispatchEvent(new CustomEvent<Omit<TransferRequest, 'dir'>>('keeper-transfer-pick', { detail: { op, paths } }));
}

// ------------------------------------------------------------------ dropping onto folders

/** Keeper's own drags also carry their paths in this type (and tests use it). */
export const DRAG_TYPE = 'application/x-keeper-paths';

/** The paths a drop carries: Keeper's own list, else the real paths of files from the system. */
export function droppedPaths(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  try {
    const own = dt.getData(DRAG_TYPE);
    if (own) { const list = JSON.parse(own); if (Array.isArray(list)) return list.filter((p): p is string => typeof p === 'string'); }
  } catch { /* not ours */ }
  return [...dt.files].map((f) => api.files.pathOf?.(f) ?? (f as File & { path?: string }).path ?? '').filter(Boolean);
}

const carriesFiles = (dt: DataTransfer | null) => !!dt && (dt.types.includes('Files') || dt.types.includes(DRAG_TYPE));
/** ⌥ on a Mac or Ctrl elsewhere copies; a plain drop moves. */
const wantsCopy = (e: { altKey: boolean; ctrlKey: boolean }) => e.altKey || e.ctrlKey;

/**
 * Props that make an element a drop target for a folder: a plain drop moves
 * into it, ⌥ (Mac) or Ctrl (Windows, Linux) copies. `onTrash` instead sends
 * what is dropped to the Trash.
 */
export function folderDrop(dir: string | undefined, opts: { onTrash?: (paths: string[]) => void } = {}) {
  if (!dir && !opts.onTrash) return {};
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = opts.onTrash ? 'move' : wantsCopy(e) ? 'copy' : 'move';
      e.currentTarget.classList.add('drop-over');
    },
    onDragLeave: (e: React.DragEvent) => e.currentTarget.classList.remove('drop-over'),
    onDrop: (e: React.DragEvent) => {
      e.currentTarget.classList.remove('drop-over');
      const paths = droppedPaths(e.dataTransfer);
      if (!paths.length) return;
      e.preventDefault();
      e.stopPropagation();
      if (opts.onTrash) opts.onTrash(paths);
      else if (dir) transfer(wantsCopy(e) ? 'copy' : 'move', paths.filter((p) => p !== dir), dir);
    },
  };
}

// ------------------------------------------------------------------ the host

const RECENT_KEY = 'keeper.fileops.recent';
function recentDests(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : []; } catch { return []; }
}
function rememberDest(dir: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([dir, ...recentDests().filter((d) => d !== dir)].slice(0, 6))); } catch { /* not kept */ }
}
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

interface Ask { req: TransferRequest; names: string[] }

/** Asks about clashing names, shows progress and reports the result with Undo. Mounted once per window. */
export function FileOpsHost() {
  const { toast, refresh, settings, info } = useStore();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [pick, setPick] = useState<Omit<TransferRequest, 'dir'> | null>(null);
  const [jobs, setJobs] = useState<Map<string, TransferProgress>>(new Map());

  const run = async (req: TransferRequest, conflict?: ConflictChoice) => {
    const job = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    // Shown only when it takes a moment.
    const shown = setTimeout(() => setJobs((m) => new Map(m).set(job, { job, op: req.op, done: 0, total: req.paths.length, name: baseName(req.paths[0]) })), 400);
    let r: CleanResult;
    try {
      r = await (req.op === 'move' ? api.files.move : api.files.copy)(req.paths, req.dir, { conflict, job });
    } catch (e) {
      toast(`Couldn’t ${req.op} to “${baseName(req.dir)}”: ${e instanceof Error ? e.message : String(e)}`);
      return;
    } finally {
      clearTimeout(shown);
      setJobs((m) => { const n = new Map(m); n.delete(job); return n; });
    }
    rememberDest(req.dir);
    refresh();
    const verb = req.op === 'move' ? 'Moved' : 'Copied';
    const where = baseName(req.dir);
    const n = r.removed;
    const byChoice = (s: string) => s.endsWith(': skipped, one is already there');
    const problems = r.skipped.filter((s) => !byChoice(s) && !s.startsWith('Already in '));
    const skippedByChoice = r.skipped.filter(byChoice).length;
    if (problems.length) {
      const head = n ? `${verb} ${n} item${n === 1 ? '' : 's'} to “${where}”. ` : '';
      toast(`${head}Couldn’t ${req.op} ${problems.length === 1 ? problems[0] : `${problems.length} items (${problems[0]}…)`}`, r.journalId ? { label: 'Undo', run: () => void undo(r.journalId!) } : undefined);
    } else if (n) {
      toast(`${verb} ${n === 1 ? `“${baseName(req.paths[0])}”` : `${n} items`} to “${where}”${skippedByChoice > 0 ? ` · skipped ${skippedByChoice}` : ''}`, r.journalId ? { label: 'Undo', run: () => void undo(r.journalId!) } : undefined);
    } else if (skippedByChoice > 0) toast(`Skipped ${skippedByChoice} item${skippedByChoice === 1 ? '' : 's'}; nothing was ${req.op === 'move' ? 'moved' : 'copied'}`);
  };
  const undo = async (id: string) => {
    const u = await api.history.undo(id).catch((e: Error) => ({ restored: 0, failed: [e.message] }));
    refresh();
    toast(u.failed.length ? `Put back ${u.restored}; ${u.failed.length} couldn’t be: ${u.failed[0]}` : `Put back ${u.restored} item${u.restored === 1 ? '' : 's'}`);
  };

  const start = async (req: TransferRequest) => {
    const names = await api.files.conflicts(req.paths, req.dir, req.op).catch(() => [] as string[]);
    if (names.length) setAsk({ req, names });
    else void run(req);
  };

  useEffect(() => {
    const onTransfer = (e: Event) => void start((e as CustomEvent<TransferRequest>).detail);
    const onPick = (e: Event) => setPick((e as CustomEvent<Omit<TransferRequest, 'dir'>>).detail);
    const onToast = (e: Event) => toast(String((e as CustomEvent).detail));
    window.addEventListener('keeper-transfer', onTransfer);
    window.addEventListener('keeper-transfer-pick', onPick);
    window.addEventListener('keeper-fileops-toast', onToast);
    const off = api.on('files-progress', (x) => {
      if (!x.job) return;
      setJobs((m) => (m.has(x.job!) ? new Map(m).set(x.job!, x) : m));
    });
    return () => { window.removeEventListener('keeper-transfer', onTransfer); window.removeEventListener('keeper-transfer-pick', onPick); window.removeEventListener('keeper-fileops-toast', onToast); off(); };
  });

  const choose = (c: ConflictChoice | null) => {
    const a = ask;
    setAsk(null);
    if (a && c) void run(a.req, c);
  };

  const places = [...new Set([...(recentDests()), info?.home ?? '', ...(settings?.pinned ?? [])].filter(Boolean))];
  const pickDir = async (dir: string | null) => {
    const p = pick;
    setPick(null);
    if (p && dir) void start({ ...p, dir });
  };

  return (
    <>
      {ask ? (
        <Modal title={ask.names.length === 1 ? `“${ask.names[0]}” is already in “${baseName(ask.req.dir)}”` : `${ask.names.length} items with these names are already in “${baseName(ask.req.dir)}”`} onClose={() => choose(null)} width={480}>
          <div className="col fileops-ask">
            {ask.names.length > 1 ? <ul className="small muted fileops-names">{ask.names.slice(0, 8).map((n) => <li key={n}>{n}</li>)}{ask.names.length > 8 ? <li>and {ask.names.length - 8} more</li> : null}</ul> : null}
            <p className="small muted">Replace puts the one already there in the {info?.platform === 'win32' ? 'Recycle Bin' : 'Trash'}. Keep Both adds a number to the new name.</p>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => choose(null)}>Stop</button>
              <button className="btn" data-choice="skip" onClick={() => choose('skip')}>Skip</button>
              <button className="btn" data-choice="keep" onClick={() => choose('keep')}>Keep Both</button>
              <button className="btn primary" data-choice="replace" onClick={() => choose('replace')}>Replace</button>
            </div>
          </div>
        </Modal>
      ) : null}
      {pick ? (
        <Modal title={`${pick.op === 'move' ? 'Move' : 'Copy'} ${pick.paths.length === 1 ? `“${baseName(pick.paths[0])}”` : `${pick.paths.length} items`} to…`} onClose={() => setPick(null)} width={460}>
          <div className="col fileops-pick" role="list">
            {places.map((d) => (
              <button key={d} role="listitem" className="btn ghost fileops-dest" title={d} onClick={() => void pickDir(d)}>
                <Icon name={d === info?.home ? 'home' : 'folder'} size={14} /><span className="ellipsis grow">{baseName(d)}</span><span className="small muted ellipsis">{d}</span>
              </button>
            ))}
            <button className="btn" style={{ marginTop: 8 }} onClick={() => void api.settings.pickFolder().then(pickDir)}><Icon name="folder" size={13} /> Choose Another Folder…</button>
          </div>
        </Modal>
      ) : null}
      {jobs.size ? (
        <div className="fileops-progress" role="status" aria-live="polite">
          {[...jobs.values()].map((j) => (
            <div key={j.job} className="fileops-job">
              <div className="small ellipsis">{j.op === 'move' ? 'Moving' : 'Copying'} {j.total > 1 ? `${Math.min(j.done + 1, j.total)} of ${j.total}` : ''} {j.name ? `· ${j.name}` : ''}</div>
              <div className="fileops-bar"><i style={{ width: `${Math.round((j.done / Math.max(1, j.total)) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
