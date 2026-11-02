// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where Studio keeps projects (Videos › Keeper Studio, one folder each), its
// recording options, and reading and writing a project's files. A project's
// files are only ever read or written inside its own folder.

import { app, shell } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { isInside } from '../../../core/safety';
import { normalizeEvents, normalizeProject, PROJECT_EXT, type EventLog, type ProjectSummary, type StudioProject } from '../../../core/studio/types';
import type { StudioOptions } from '../../../core/studio/api';
import { defaultStudioOptions, normalizeStudioOptions } from '../../../core/studio/api';

const optionsFile = () => path.join(app.getPath('userData'), 'studio.json');
let opts: StudioOptions | null = null;

export async function studioOptions(): Promise<StudioOptions> {
  if (opts) return opts;
  try { opts = normalizeStudioOptions(JSON.parse(await fsp.readFile(optionsFile(), 'utf8'))); } catch { opts = defaultStudioOptions(); }
  return opts;
}

export async function setStudioOptions(patch: Partial<StudioOptions>): Promise<StudioOptions> {
  opts = normalizeStudioOptions({ ...(await studioOptions()), ...patch });
  await fsp.writeFile(optionsFile(), JSON.stringify(opts, null, 2));
  return opts;
}

/** The folder new projects go in. */
export async function projectsRoot(): Promise<string> {
  const o = await studioOptions();
  const dir = o.folder || path.join(app.getPath('videos'), 'Keeper Studio');
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/** Every folder a project may be in: the projects folder and folders opened before. */
async function roots(): Promise<string[]> {
  const o = await studioOptions();
  return [await projectsRoot(), ...o.recent.map((r) => path.dirname(r))];
}

/** A project folder Keeper may read and write: inside a known root, with a project file. */
export async function checkedDir(dir: string): Promise<string> {
  const d = path.resolve(dir);
  if (!d.endsWith(PROJECT_EXT) || !(await roots()).some((r) => isInside(d, r) || path.dirname(d) === path.resolve(r))) throw new Error('That is not a Studio project Keeper knows.');
  return d;
}

/** A file named by a project, kept inside its folder. */
export function inProject(dir: string, name: string): string {
  const p = path.resolve(dir, name);
  if (path.dirname(p) !== path.resolve(dir) && !isInside(p, dir)) throw new Error('A project can only name files inside its own folder.');
  return p;
}

export async function newProjectDir(name: string): Promise<string> {
  const root = await projectsRoot();
  const base = name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Recording';
  for (let i = 1; ; i++) {
    const d = path.join(root, `${base}${i > 1 ? ` ${i}` : ''}${PROJECT_EXT}`);
    if (!existsSync(d)) { await fsp.mkdir(d, { recursive: true }); return d; }
  }
}

export async function readProject(dir: string): Promise<StudioProject> {
  const p = normalizeProject(JSON.parse(await fsp.readFile(path.join(dir, 'project.json'), 'utf8')));
  if (!p) throw new Error('This project’s file is damaged.');
  return p;
}

export async function readEvents(dir: string): Promise<EventLog> {
  try { return normalizeEvents(JSON.parse(await fsp.readFile(path.join(dir, 'events.json'), 'utf8'))); } catch { return normalizeEvents({}); }
}

/** Saves through a temporary file, so a crash never leaves half a project file. */
export async function writeJson(file: string, value: unknown) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(value));
  await fsp.rename(tmp, file);
}

export async function saveProject(dir: string, p: StudioProject) {
  await writeJson(path.join(dir, 'project.json'), { ...p, updatedAt: Date.now() });
  await remember(dir);
}

export async function remember(dir: string) {
  const o = await studioOptions();
  const recent = [path.resolve(dir), ...o.recent.filter((r) => path.resolve(r) !== path.resolve(dir))].slice(0, 40);
  await setStudioOptions({ recent });
}

/** Projects in the projects folder and opened before, newest first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const root = await projectsRoot();
  const dirs = new Set<string>();
  for (const e of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && e.name.endsWith(PROJECT_EXT)) dirs.add(path.join(root, e.name));
  for (const r of (await studioOptions()).recent) if (existsSync(r)) dirs.add(path.resolve(r));
  const out: ProjectSummary[] = [];
  for (const dir of dirs) {
    try {
      const p = await readProject(dir);
      const thumb = path.join(dir, 'thumb.jpg');
      out.push({ dir, id: p.id, name: p.name, duration: p.meta.duration, createdAt: p.meta.createdAt, updatedAt: p.updatedAt, width: p.meta.width, height: p.meta.height, thumb: existsSync(thumb) ? thumb : undefined });
    } catch { /* not a project (or damaged): left out */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function removeProject(dir: string) {
  const d = await checkedDir(dir);
  // to the Trash when the system has one, so a slip can be undone
  await shell.trashItem(d).catch(() => fsp.rm(d, { recursive: true, force: true }));
  const o = await studioOptions();
  await setStudioOptions({ recent: o.recent.filter((r) => path.resolve(r) !== d) });
}
