// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo data for Sync & Backup in the browser demo.

import type { BackupJobStatus, MirrorJobStatus, SyncApi, SyncFolderStatus, SyncOverview } from '../core/api-sync';
import { check321, defaultSyncSettings, type SyncSettings } from '../core/sync/config';

const now = Date.now();
const H = 3600_000;
const D = 24 * H;
const delay = <T,>(v: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(v), ms));

export function mockSync(): { sync: SyncApi } {
  const peers = [
    { id: 'dev-anna-mbp', name: 'Anna’s MacBook Air', online: true, via: 'lan' },
    { id: 'dev-studio-pc', name: 'Studio PC', online: true, via: 'direct' },
    { id: 'dev-pixel', name: 'Pixel 9 (web)', online: false, via: undefined },
  ];
  let paused = false;
  let offerList = [{ peer: 'dev-anna-mbp', peerName: 'Anna’s MacBook Air', id: 'f-recipes', label: 'Recipes' }];
  let folders: SyncFolderStatus[] = [
    {
      id: 'f-docs', path: '/Users/demo/Documents', label: 'Documents', mode: 'two-way', devices: ['dev-anna-mbp', 'dev-studio-pc'], ignore: ['*.tmp', 'node_modules/'],
      versioning: { type: 'staggered', maxDays: 365 }, state: 'idle', files: 4182, bytes: 6.8e9, conflicts: 1, lastScan: now - 4 * 60_000,
      peers: [
        { id: 'dev-anna-mbp', name: 'Anna’s MacBook Air', online: true, via: 'lan', lastSync: now - 60_000, state: 'idle' },
        { id: 'dev-studio-pc', name: 'Studio PC', online: true, via: 'direct', lastSync: now - 3 * 60_000, state: 'idle' },
      ],
    },
    {
      id: 'f-photos', path: '/Users/demo/Pictures/Camera', label: 'Camera', mode: 'two-way', devices: ['dev-studio-pc'], ignore: [],
      versioning: { type: 'trashcan', days: 30 }, state: 'syncing', files: 12840, bytes: 61.2e9, conflicts: 0, lastScan: now - 60_000,
      progress: { file: 'IMG_8812.HEIC', done: 2.1e6, total: 3.4e6, queued: 37 },
      peers: [{ id: 'dev-studio-pc', name: 'Studio PC', online: true, via: 'direct', lastSync: now - 20_000, state: 'syncing' }],
    },
    {
      id: 'f-projects', path: '/Users/demo/Projects', label: 'Projects', mode: 'send-only', devices: ['dev-studio-pc', 'dev-pixel'], ignore: ['node_modules/', 'dist/', '.git/'],
      versioning: { type: 'simple', keep: 10 }, state: 'idle', files: 23310, bytes: 2.3e9, conflicts: 0, lastScan: now - 9 * 60_000,
      peers: [
        { id: 'dev-studio-pc', name: 'Studio PC', online: true, via: 'direct', lastSync: now - 9 * 60_000, state: 'idle' },
        { id: 'dev-pixel', name: 'Pixel 9 (web)', online: false, lastSync: now - 2 * D, state: 'offline' },
      ],
    },
  ];
  let backups: BackupJobStatus[] = [
    {
      id: 'b-drive', name: 'Everything to Backup Drive', sources: [{ name: 'Documents', path: '/Users/demo/Documents' }, { name: 'Pictures', path: '/Users/demo/Pictures' }, { name: 'Desktop', path: '/Users/demo/Desktop' }],
      dest: { kind: 'folder', path: '/Volumes/Backup Drive/Keeper' }, destLabel: '/Volumes/Backup Drive/Keeper', schedule: 'drive', retention: { last: 3, daily: 7, weekly: 4, monthly: 12, yearly: 3 },
      ignore: [], created: now - 120 * D, lastRun: now - 26 * H, lastOk: true, lastMessage: '17,022 files · 412.3 MB new', lastTest: now - 20 * D, state: 'idle', snapshots: 46, nextRun: undefined,
    },
    {
      id: 'b-cloud', name: 'Photos to Google Drive (encrypted)', sources: [{ name: 'Pictures', path: '/Users/demo/Pictures' }],
      dest: { kind: 'connection', connectionId: 'gdrive', path: '/Keeper Backups', label: 'Google Drive' }, destLabel: 'Google Drive › Keeper Backups', schedule: 'daily', retention: { last: 3, daily: 7, weekly: 4, monthly: 12, yearly: 3 },
      ignore: ['*.tmp'], created: now - 60 * D, lastRun: now - 5 * H, lastOk: true, lastMessage: '12,840 files · 38.2 MB new', state: 'running', snapshots: 58, nextRun: now + 19 * H,
      progress: { phase: 'reading', file: 'Pictures/Camera/2026/IMG_8790.HEIC', files: 8211, bytes: 41.2e9, totalBytes: 61.2e9 }, testDue: true,
    },
    {
      id: 'b-nas', name: 'Projects to the NAS', sources: [{ name: 'Projects', path: '/Users/demo/Projects' }],
      dest: { kind: 'connection', connectionId: 'nas', path: '/backups', label: 'Home NAS' }, destLabel: 'Home NAS › backups', schedule: 'hourly', retention: { last: 24, daily: 14, weekly: 8 },
      ignore: ['node_modules/'], created: now - 30 * D, lastRun: now - 50 * 60_000, lastOk: false, lastMessage: 'The NAS did not answer (is it on?)', state: 'error', snapshots: 610, nextRun: now + 10 * 60_000,
    },
  ];
  let mirrors: MirrorJobStatus[] = [
    { id: 'm-onedrive', name: 'Screenshots → OneDrive', local: '/Users/demo/Pictures/Screenshots', dest: { kind: 'connection', connectionId: 'onedrive', path: '/Screenshots', label: 'OneDrive' }, destLabel: 'OneDrive › Screenshots', direction: 'up', ignore: [], schedule: 'live', lastRun: now - 12 * 60_000, lastMessage: '3 up', state: 'idle' },
    { id: 'm-icloud', name: 'Scans ↔ iCloud Drive', local: '/Users/demo/Documents/Scans', dest: { kind: 'folder', path: '/Users/demo/Library/Mobile Documents/com~apple~CloudDocs/Scans' }, destLabel: 'iCloud Drive › Scans', direction: 'both', ignore: [], schedule: 'hourly', lastRun: now - 40 * 60_000, lastMessage: 'Already the same', state: 'idle' },
  ];
  const settingsLike = (): SyncSettings => ({ ...defaultSyncSettings('Demo’s MacBook Pro'), folders, backups, mirrors, paused });
  const ov = async (): Promise<SyncOverview> => ({
    deviceId: 'dev-demo', deviceName: 'Demo’s MacBook Pro', paused, transport: 'link', peers, offers: offerList, bandwidthKBps: 0, pauseOnBattery: true, phoneUploads: { enabled: true, folder: '/Users/demo/Pictures/From phones' },
    folders: folders.map((f) => ({ ...f, state: paused ? 'paused' : f.state })), backups, mirrors,
    check321: check321(settingsLike(), (t) => (t.kind === 'connection' ? 'cloud' : t.path.startsWith('/Volumes') ? 'drive' : 'local')),
  });
  const sync: SyncApi = {
    overview: ov,
    setPaused: async (p) => { paused = p; return ov(); },
    setOptions: async () => ov(),
    addFolder: async (i) => {
      offerList = offerList.filter((o) => o.id !== i.id);
      folders = [...folders, { id: i.id ?? `f-${Date.now()}`, path: i.path, label: i.label || i.path.split('/').pop() || 'Folder', mode: i.mode, devices: i.devices, ignore: i.ignore ?? [], versioning: i.versioning ?? { type: 'staggered', maxDays: 365 }, state: 'scanning', files: 0, bytes: 0, conflicts: 0, peers: i.devices.map((d) => ({ id: d, name: peers.find((p) => p.id === d)?.name ?? d, online: true, state: 'idle' as const })) }];
      return delay(await ov());
    },
    updateFolder: async (id, patch) => { folders = folders.map((f) => (f.id === id ? { ...f, ...patch } : f)); return ov(); },
    removeFolder: async (id) => { folders = folders.filter((f) => f.id !== id); return ov(); },
    ignoreOffer: async (id) => { offerList = offerList.filter((o) => o.id !== id); return ov(); },
    rescan: async () => { await delay(null, 600); },
    conflicts: async (id) => (id === 'f-docs' ? [{ path: 'Budget 2026.xlsx', copy: 'Budget 2026 (conflict, Studio PC, 2026-10-30 18.12).xlsx', size: 48_211, mtime: now - 20 * H, copySize: 49_002, copyMtime: now - 19 * H }] : []),
    resolveConflict: async (id) => { folders = folders.map((f) => (f.id === id ? { ...f, conflicts: 0 } : f)); },
    versions: async () => [
      { rel: 'Budget 2026.xlsx', vrel: 'Budget 2026~20261030-171200.xlsx', time: now - 21 * H, size: 47_900 },
      { rel: 'Letters/To the landlord.docx', vrel: 'Letters/To the landlord~20261029-090500.docx', time: now - 2 * D, size: 21_300 },
      { rel: 'Taxes/2025 return.pdf', vrel: 'Taxes/2025 return~20261012-120000.pdf', time: now - 19 * D, size: 812_000 },
    ],
    restoreVersion: async (_id, vrel) => vrel.replace(/~\d{8}-\d{6}/, ''),
    versionsFor: async (p) => (p.startsWith('/Users/demo/Documents/') ? { folderId: 'f-docs', rel: p.slice('/Users/demo/Documents/'.length), versions: [{ rel: '', vrel: '', time: now - 3 * H, size: 40_000 }, { rel: '', vrel: '', time: now - 2 * D, size: 39_200 }] } : null),
    destinations: async () => [
      { kind: 'folder', label: 'Backup Drive', detail: 'drive', path: '/Volumes/Backup Drive' },
      { kind: 'folder', label: 'iCloud Drive', detail: 'cloud folder', path: '/Users/demo/Library/Mobile Documents/com~apple~CloudDocs' },
      { kind: 'connection', id: 'gdrive', label: 'Google Drive', detail: 'cloud', online: true },
      { kind: 'connection', id: 'onedrive', label: 'OneDrive', detail: 'cloud', online: true },
      { kind: 'connection', id: 'dropbox', label: 'Dropbox', detail: 'cloud', online: true },
      { kind: 'connection', id: 'nas', label: 'Home NAS', detail: 'nas', online: false },
    ],
    addBackup: async (i) => {
      backups = [...backups, { id: `b-${Date.now()}`, name: i.name, sources: i.sources, dest: i.dest, destLabel: i.dest.kind === 'folder' ? i.dest.path : i.dest.label ?? 'Connection', schedule: i.schedule, retention: i.retention ?? { last: 3, daily: 7, weekly: 4, monthly: 12 }, ignore: i.ignore ?? [], created: Date.now(), state: 'idle', snapshots: 0 }];
      return delay({ overview: await ov(), recovery: '7F3K-QW9P-2M4X-HC8D-VN5T-R1JB-6ZEA-K0YS' }, 900);
    },
    updateBackup: async (id, patch) => { backups = backups.map((b) => (b.id === id ? { ...b, ...patch } : b)); return ov(); },
    removeBackup: async (id) => { backups = backups.filter((b) => b.id !== id); return ov(); },
    runBackup: async (id) => { backups = backups.map((b) => (b.id === id ? { ...b, state: 'running', progress: { phase: 'reading', files: 120, bytes: 3e8, totalBytes: 2e9 } } : b)); return ov(); },
    cancelBackup: async (id) => { backups = backups.map((b) => (b.id === id ? { ...b, state: 'idle', progress: undefined } : b)); },
    snapshots: async (id) => delay(Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, name: `2026-10-${31 - i}T02-00-00-000Z-s${i}`, time: now - i * D - 10 * H, host: 'Demo’s MacBook Pro', sources: { Documents: '/Users/demo/Documents' }, stats: { files: 17022 - i * 40, bytes: 68.4e9 - i * 1e8, newBytes: i === 0 ? 412e6 : 90e6, storedBytes: 0, seconds: 140 } })).map((s) => ({ ...s, id: `${id}-${s.id}` }))),
    snapshotFiles: async () => delay([
      { path: 'Documents/Budget 2026.xlsx', size: 48_211, mtime: now - 20 * H },
      { path: 'Documents/Letters/To the landlord.docx', size: 21_300, mtime: now - 2 * D },
      { path: 'Pictures/Camera/IMG_8812.HEIC', size: 3.4e6, mtime: now - 3 * D },
      { path: 'Pictures/Camera/IMG_8813.HEIC', size: 3.1e6, mtime: now - 3 * D },
      { path: 'Desktop/Plan.md', size: 3_200, mtime: now - 5 * H },
    ]),
    restore: async (_id, _n, o) => delay({ files: o.include?.length ?? 17022, bytes: 1.2e9, skipped: [], target: o.target ?? '/Users/demo/Restored/Everything 2026-10-31' }, 1200),
    verifyBackup: async (id) => { backups = backups.map((b) => (b.id === id ? { ...b, testDue: false, lastTest: Date.now() } : b)); return delay({ ok: true, problems: [], checked: 200 }, 1200); },
    addMirror: async (i) => { mirrors = [...mirrors, { id: `m-${Date.now()}`, ...i, ignore: i.ignore ?? [], destLabel: i.dest.kind === 'folder' ? i.dest.path : i.dest.label ?? 'Connection', state: 'running' }]; return ov(); },
    updateMirror: async (id, patch) => { mirrors = mirrors.map((m) => (m.id === id ? { ...m, ...patch } : m)); return ov(); },
    removeMirror: async (id) => { mirrors = mirrors.filter((m) => m.id !== id); return ov(); },
    runMirror: async () => ov(),
  };
  return { sync };
}
