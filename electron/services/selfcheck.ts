// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Check Keeper (Settings → About) and the problem report. The check gathers
// plain facts, each with a time limit, and core/selfcheck.ts turns them into
// rows. The report is a zip of Keeper's own notes (the last moments before a
// stop, the last 200 log lines), its settings without keys or folders, and what
// the check said, with names, folders, addresses and tokens taken out. It is
// shown in full first and saved where the person chooses; nothing is sent.

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { constants, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { featureStates } from '../../core/features';
import { aboutText, reportFiles, reportName, selfCheckRows, type CheckRow, type ReportFile, type SelfCheckFacts } from '../../core/selfcheck';
import { exportSettings } from '../../core/settings-schema';
import { keychainStatus, retryKeychain, settings } from '../store';
import * as components from './components';
import { listPermissions } from './permissions';

interface Deps {
  /** the library: files known, reading now, folders chosen */
  index: () => { files: number; indexing: boolean; folders: number } | null;
  rescan: () => void;
}

let deps: Deps | null = null;

const within = <T>(p: Promise<T>, ms = 8000): Promise<T | undefined> => Promise.race([p.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

async function sessionDir() {
  return path.join(app.getPath('userData'), 'session');
}

async function crashesThisWeek(): Promise<number> {
  const dir = await sessionDir();
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  const week = Date.now() - 7 * 86_400_000;
  let n = 0;
  for (const name of names.filter((x) => /^breadcrumbs-.+\.json$/.test(x))) {
    const st = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (st && st.mtimeMs >= week) n++;
  }
  return n;
}

async function facts(): Promise<SelfCheckFacts> {
  const data = app.getPath('userData');
  const writable = await fsp.access(data, constants.W_OK).then(() => true, () => false);
  const free = await within(fsp.statfs(data).then((s) => s.bavail * s.bsize));
  const perms = await within(listPermissions());
  const parts = await within(import('../suite/supervisor').then((m) => m.listParts()));
  const kc = keychainStatus().state;
  return {
    dataWritable: writable,
    dataFreeBytes: free,
    index: deps?.index() ?? undefined,
    permissions: perms?.items.map((p) => ({ id: p.id, name: p.name, state: p.state, usedBy: p.usedBy })),
    parts: parts?.map((p) => ({ id: p.id, name: p.name, wanted: p.wanted, state: p.state })),
    components: components.list().map((c) => ({ id: c.id, name: c.name, state: c.state, error: c.error, neededBy: c.neededBy })),
    keychain: kc === 'ok' ? 'ok' : kc === 'locked' ? 'locked' : 'none',
    crashes7d: await crashesThisWeek(),
  };
}

export async function runSelfCheck(): Promise<{ rows: CheckRow[]; at: number }> {
  return { rows: selfCheckRows(await facts()), at: Date.now() };
}

/** A row's Fix that Keeper does itself (pages are opened by the window). */
export async function fixSelfCheck(action: string): Promise<{ ok: boolean; message: string }> {
  if (action === 'rescan') { deps?.rescan(); return { ok: true, message: 'Reading your folders again.' }; }
  if (action === 'keychain') { const s = await retryKeychain(); return { ok: s.state === 'ok', message: s.state === 'ok' ? 'The keychain opened.' : 'The keychain is still closed.' }; }
  if (action.startsWith('restart:')) {
    const m = await import('../suite/supervisor');
    m.restartPart(action.slice(8) as Parameters<typeof m.restartPart>[0]);
    return { ok: true, message: 'Starting it again.' };
  }
  if (action.startsWith('component:')) {
    await components.download(action.slice(10) as Parameters<typeof components.download>[0]).catch(() => undefined);
    return { ok: true, message: 'Downloading it again.' };
  }
  return { ok: false, message: 'Keeper can’t do that one itself.' };
}

/** Every file of the report, redacted, for the window to show before saving. */
export async function reportPreview(): Promise<ReportFile[]> {
  const { rows } = await runSelfCheck();
  const s = settings();
  const dir = await sessionDir();
  const parts: ReportFile[] = [];
  const partsOn = [...featureStates(s).values()].filter((x) => x.on).map((x) => x.id);
  parts.push({ name: 'about.txt', what: 'Keeper’s version, your system and Check Keeper', text: aboutText({ version: app.getVersion(), platform: process.platform, release: os.release(), arch: process.arch, partsOn, rows, at: new Date() }) });
  parts.push({ name: 'settings.json', what: 'Your settings, without keys, accounts or folders', text: JSON.stringify(exportSettings(s, { settings: true, parts: true, folders: false }, app.getVersion()), null, 2) });
  const now = await fsp.readFile(path.join(dir, 'breadcrumbs.json'), 'utf8').catch(() => '');
  if (now) parts.push({ name: 'last-moments.json', what: 'What Keeper did lately: its last 200 log lines and memory', text: now });
  const old = (await fsp.readdir(dir).catch(() => [] as string[])).filter((x) => /^breadcrumbs-.+\.json$/.test(x)).sort().slice(-3);
  for (const name of old) {
    const text = await fsp.readFile(path.join(dir, name), 'utf8').catch(() => '');
    if (text) parts.push({ name: `before-a-stop-${name.slice(12)}`, what: 'The last moments before Keeper stopped unexpectedly', text });
  }
  return reportFiles(parts, { home: os.homedir(), user: os.userInfo().username, host: os.hostname() });
}

/** Saves the report where the person chooses. Nothing is sent. */
export async function saveReport(win: BrowserWindow | null, target?: string): Promise<{ ok: boolean; path?: string; message: string }> {
  const files = await reportPreview();
  let file = target;
  if (!file) {
    const opts = { defaultPath: path.join(app.getPath('downloads'), reportName(new Date())), filters: [{ name: 'Zip', extensions: ['zip'] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { ok: false, message: 'Not saved.' };
    file = r.filePath;
  }
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.text);
  await fsp.writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { ok: true, path: file, message: 'Saved. Attach it to an e-mail or an issue; nothing was sent.' };
}

export function registerSelfCheck(d: Deps) {
  deps = d;
  ipcMain.handle('selfCheck.run', () => runSelfCheck());
  ipcMain.handle('selfCheck.fix', (_e, action: string) => fixSelfCheck(String(action)));
  ipcMain.handle('selfCheck.reportPreview', () => reportPreview());
  // End-to-end tests save straight to a file (KEEPER_REPORT_TO); people always choose where.
  ipcMain.handle('selfCheck.reportSave', (e) => saveReport(BrowserWindow.fromWebContents(e.sender), process.env.KEEPER_REPORT_TO || undefined));
}
