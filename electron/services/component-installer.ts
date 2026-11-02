// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Downloads, checks and installs components (core/components.ts) for this
// exact Keeper version, from its own release:
//
//   1. components-<platform>-<arch>.json and SHA256SUMS.txt (the file the release's
//      Sigstore signature covers); the manifest must be listed there and match it
//   2. the archive, resumed where a cut-off download stopped, retried a few times
//   3. its SHA-256 must match both the manifest and SHA256SUMS.txt
//   4. unpacked into a hidden folder beside the final one, every file checked against
//      the manifest (name, size, SHA-256, mode; links may not leave the folder)
//   5. on macOS: quarantine removed, signatures checked against the app's (verify hook)
//   6. moved into place in one step (rename), older versions removed
//
// No Electron import (tests drive it with a local server); electron/services/components.ts wires it up.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, lstatSync, promises as fsp, readdirSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  approxSize, componentAsset, COMPONENTS, componentAvailable, componentsFor, manifestAsset, manifestProblem, parseManifest, releaseBase, safeRelative, joinRel,
  type ComponentId, type ComponentInfo, type ComponentManifest, type ManifestEntry,
} from '../../core/components';
import { readTar } from '../../core/tar';
import { checksumFor, CHECKSUMS_FILE } from '../../core/update-verify';
import { componentsRoot, installedVersion, locateComponent, MARKER, type ComponentPathsContext } from '../../core/component-paths';

export interface InstallerDeps {
  ctx: () => ComponentPathsContext;
  fetch?: typeof fetch;
  /** a mirror or a local server: `<feed>/v<version>/<asset>` (default: the GitHub release) */
  feed?: string;
  /** something changed (progress, state): the interface refreshes */
  onChange?: (id?: ComponentId) => void;
  /** macOS: throws unless every given program is signed like the app */
  verifySignatures?: (files: string[]) => Promise<void>;
  /** macOS: removes com.apple.quarantine from a folder */
  stripQuarantine?: (dir: string) => Promise<void>;
  retries?: number;
  retryDelayMs?: number;
  userAgent?: string;
}

interface Job { abort: AbortController; promise: Promise<void>; progress: number; phase: 'downloading' | 'verifying' }

const OFFLINE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|fetch failed|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_ADDRESS_UNREACHABLE|network/i;
/** Whether an error means "no network" (retry when back online) rather than a bad download. */
export function isOfflineError(e: unknown): boolean {
  const err = e as { message?: string; code?: string; cause?: { code?: string; message?: string } };
  return OFFLINE.test(`${err?.code ?? ''} ${err?.message ?? ''} ${err?.cause?.code ?? ''} ${err?.cause?.message ?? ''}`);
}

class Fatal extends Error {}
class Cancelled extends Error { constructor() { super('Cancelled'); } }

export class ComponentInstaller {
  private jobs = new Map<ComponentId, Job>();
  private errors = new Map<ComponentId, { message: string; offline: boolean }>();
  private manifestCache: { key: string; at: number; m: ComponentManifest; sums: string } | undefined;
  private diskCache = new Map<string, number>();
  constructor(private d: InstallerDeps) {}

  private get ctx() { return this.d.ctx(); }
  private get fetch() { return this.d.fetch ?? fetch; }
  private url(asset: string) { return `${releaseBase(this.ctx.version, this.d.feed)}/${asset}`; }
  private changed(id?: ComponentId) { this.d.onChange?.(id); }

  private async get(url: string, signal?: AbortSignal, headers: Record<string, string> = {}) {
    return this.fetch(url, { signal, headers: { 'user-agent': this.d.userAgent ?? 'Keeper', ...headers }, redirect: 'follow' });
  }

  private async text(asset: string, signal?: AbortSignal): Promise<string> {
    const r = await this.get(this.url(asset), signal);
    if (r.status === 404) throw new Fatal(`This Keeper's release has no ${asset}${asset === CHECKSUMS_FILE ? '' : ' (its parts may not be published yet)'}`);
    if (!r.ok) throw new Error(`Downloading ${asset} failed (${r.status})`);
    return r.text();
  }

  /** The release's manifest, checked against its signed SHA256SUMS.txt. Cached for ten minutes. */
  async manifest(signal?: AbortSignal): Promise<{ m: ComponentManifest; sums: string }> {
    const c = this.ctx;
    const key = `${c.version}|${c.platform}|${c.arch}|${this.d.feed ?? ''}`;
    if (this.manifestCache?.key === key && Date.now() - this.manifestCache.at < 10 * 60_000) return this.manifestCache;
    const name = manifestAsset(c.platform, c.arch);
    const [sums, text] = await Promise.all([this.text(CHECKSUMS_FILE, signal), this.text(name, signal)]);
    const want = checksumFor(sums, name);
    if (!want) throw new Fatal(`${name} is not listed in the release's ${CHECKSUMS_FILE}`);
    if (createHash('sha256').update(text).digest('hex') !== want) throw new Fatal(`${name} does not match the release's ${CHECKSUMS_FILE}`);
    const m = parseManifest(text);
    const problem = manifestProblem(m, c.version, c.platform, c.arch);
    if (problem) throw new Fatal(problem);
    this.manifestCache = { key, at: Date.now(), m, sums };
    return this.manifestCache;
  }

  /** The manifest if it was read already (sizes for the interface without asking the network). */
  cachedEntry(id: ComponentId): ManifestEntry | undefined {
    return this.manifestCache?.m.components.find((x) => x.name === id);
  }

  /** Every component's state for the interface. `onFeatures`: features switched on now. */
  infos(onFeatures: string[] = []): ComponentInfo[] {
    const c = this.ctx;
    return COMPONENTS.map((def) => {
      const entry = this.cachedEntry(def.id);
      const approx = approxSize(def.id, c.platform, c.arch);
      const base = {
        id: def.id, name: def.name, description: def.description,
        downloadSize: entry?.size ?? approx.download, estimate: !entry,
        neededBy: onFeatures.filter((f) => componentsFor([f]).includes(def.id)),
        sizeOnDisk: 0,
      };
      if (!componentAvailable(def.id, c.platform, c.arch)) return { ...base, state: 'unavailable' as const };
      const job = this.jobs.get(def.id);
      if (job) return { ...base, state: job.phase, progress: job.progress };
      const here = locateComponent(def.id, c);
      if (here) return { ...base, state: here.source, version: here.source === 'installed' ? c.version : undefined, sizeOnDisk: this.disk(here.source === 'installed' ? path.join(componentsRoot(c), def.id) : here.dir, here.source) };
      const err = this.errors.get(def.id);
      const old = this.olderVersion(def.id);
      if (err) return { ...base, state: 'error' as const, error: err.message, offline: err.offline, version: old, sizeOnDisk: old ? this.disk(path.join(componentsRoot(c), def.id), 'installed') : 0 };
      if (old) return { ...base, state: 'outdated' as const, version: old, sizeOnDisk: this.disk(path.join(componentsRoot(c), def.id), 'installed') };
      return { ...base, state: 'missing' as const };
    });
  }

  /** A version of this component on disk that is not this Keeper's. */
  olderVersion(id: ComponentId): string | undefined {
    const dir = path.join(componentsRoot(this.ctx), id);
    try {
      for (const v of readdirSync(dir)) if (!v.startsWith('.') && v !== this.ctx.version && installedVersion(path.join(dir, v))) return v;
    } catch { /* none */ }
    return undefined;
  }

  private disk(dir: string, source: string): number {
    if (source === 'dev') return 0;
    const cached = this.diskCache.get(dir);
    if (cached !== undefined) return cached;
    let n = 0;
    const walk = (p: string) => {
      const st = lstatSync(p);
      if (st.isDirectory()) for (const c of readdirSync(p)) walk(path.join(p, c));
      else n += st.size;
    };
    try { walk(dir); } catch { /* gone */ }
    this.diskCache.set(dir, n);
    return n;
  }

  busy(id: ComponentId) { return this.jobs.has(id); }
  lastError(id: ComponentId) { return this.errors.get(id); }

  /** Downloads and installs one component (one at a time per component; a second call waits for the first). */
  install(id: ComponentId): Promise<void> {
    const running = this.jobs.get(id);
    if (running) return running.promise;
    if (locateComponent(id, this.ctx)) return Promise.resolve();
    if (!componentAvailable(id, this.ctx.platform, this.ctx.arch)) return Promise.reject(new Error('This part of Keeper is not made for this computer'));
    const job: Job = { abort: new AbortController(), progress: 0, phase: 'downloading', promise: Promise.resolve() };
    this.errors.delete(id);
    job.promise = this.run(id, job).then(
      () => { this.jobs.delete(id); this.diskCache.clear(); this.changed(id); },
      (e) => {
        this.jobs.delete(id);
        this.diskCache.clear();
        if (e instanceof Cancelled || job.abort.signal.aborted) { this.changed(id); throw new Cancelled(); }
        const offline = !(e instanceof Fatal) && isOfflineError(e);
        const message = offline ? 'You seem to be offline. Keeper tries again when the network is back.' : e instanceof Error ? e.message : String(e);
        this.errors.set(id, { message, offline });
        this.changed(id);
        throw Object.assign(new Error(message), { offline });
      },
    );
    this.jobs.set(id, job);
    this.changed(id);
    return job.promise;
  }

  cancel(id: ComponentId) {
    this.jobs.get(id)?.abort.abort();
  }

  /** "Free up space": removes every downloaded version of a component. */
  async remove(id: ComponentId) {
    this.cancel(id);
    await this.jobs.get(id)?.promise.catch(() => undefined);
    await fsp.rm(path.join(componentsRoot(this.ctx), id), { recursive: true, force: true });
    await fsp.rm(path.join(componentsRoot(this.ctx), '.downloads', componentAsset(id, this.ctx.platform, this.ctx.arch) + '.part'), { force: true });
    this.errors.delete(id);
    this.diskCache.clear();
    this.changed(id);
  }

  private async run(id: ComponentId, job: Job) {
    const c = this.ctx;
    const signal = job.abort.signal;
    const { m, sums } = await this.manifest(signal);
    const entry = m.components.find((x) => x.name === id);
    if (!entry) throw new Fatal('This release has no such part for this computer');
    const listed = checksumFor(sums, entry.file);
    if (!listed) throw new Fatal(`${entry.file} is not listed in the release's ${CHECKSUMS_FILE}`);
    if (listed !== entry.sha256) throw new Fatal(`${entry.file}: the component list and ${CHECKSUMS_FILE} disagree`);
    const root = componentsRoot(c);
    const part = path.join(root, '.downloads', `${entry.file}.part`);
    await fsp.mkdir(path.dirname(part), { recursive: true });

    const tries = this.d.retries ?? 3;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.download(this.url(entry.file), part, entry.size, signal, (p) => { job.progress = p; this.changed(id); });
        break;
      } catch (e) {
        if (signal.aborted) throw new Cancelled();
        if (e instanceof Fatal || attempt >= tries) throw e;
        await new Promise((r) => setTimeout(r, (this.d.retryDelayMs ?? 1500) * attempt));
      }
    }
    job.phase = 'verifying';
    this.changed(id);
    const got = await sha256File(part);
    if (got !== entry.sha256) {
      await fsp.rm(part, { force: true });
      throw new Fatal(`The download of ${entry.file} does not match the release's checksum (it is damaged or was changed); nothing was installed`);
    }
    if (signal.aborted) throw new Cancelled();
    await this.unpack(entry, part, c);
    await fsp.rm(part, { force: true });
  }

  /** Downloads to `part`, resuming from what is already there when the server allows it. */
  private async download(url: string, part: string, size: number, signal: AbortSignal, progress: (p: number) => void) {
    let have = 0;
    try { have = (await fsp.stat(part)).size; } catch { /* fresh */ }
    if (have >= size) { if (have === size) return; await fsp.rm(part, { force: true }); have = 0; }
    const r = await this.get(url, signal, have ? { range: `bytes=${have}-` } : {});
    if (r.status === 404) throw new Fatal('This part is not in the release');
    if (!r.ok || !r.body) throw new Error(`Download failed (${r.status})`);
    if (have && r.status !== 206) have = 0; // the server sent the whole file: start again
    const out = createWriteStream(part, { flags: have ? 'a' : 'w' });
    let got = have;
    let last = 0;
    try {
      const reader = (r.body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.byteLength;
        if (got > size) throw new Fatal('The download is larger than the release says');
        if (!out.write(value)) await new Promise<void>((res) => out.once('drain', () => res()));
        if (Date.now() - last > 200) { last = Date.now(); progress(got / size); }
      }
    } finally {
      await new Promise<void>((res) => out.end(res));
    }
    progress(got / size);
    if (got < size) throw new Error('The download was cut short');
  }

  private async unpack(entry: ManifestEntry, archive: string, c: ComponentPathsContext) {
    const dir = path.join(componentsRoot(c), entry.name);
    const final = path.join(dir, c.version);
    const tmp = path.join(dir, `.tmp-${c.version}-${process.pid}-${Date.now()}`);
    await fsp.mkdir(tmp, { recursive: true });
    try {
      const entries = readTar(gunzipSync(await fsp.readFile(archive)));
      const want = new Map(entry.files.map((f) => [f.path, f]));
      const seen = new Set<string>();
      const programs: string[] = [];
      for (const e of entries) {
        if (!safeRelative(e.path)) throw new Fatal(`The archive holds an unsafe path (${e.path})`);
        const dest = path.join(tmp, ...e.path.split('/'));
        if (e.type === 'dir') { await fsp.mkdir(dest, { recursive: true }); continue; }
        const f = want.get(e.path);
        if (!f) throw new Fatal(`The archive holds ${e.path}, which the component list does not`);
        seen.add(e.path);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        if (e.type === 'symlink') {
          if (f.link !== e.link || !e.link || !joinRel(e.path.split('/').slice(0, -1).join('/'), e.link)) throw new Fatal(`The link ${e.path} is not the one listed`);
          await fsp.symlink(e.link, dest);
          continue;
        }
        const data = e.data!;
        if (f.link !== undefined || data.length !== f.size || createHash('sha256').update(data).digest('hex') !== f.sha256) throw new Fatal(`${e.path} in the archive does not match the component list`);
        await fsp.writeFile(dest, data, { mode: f.mode });
        await fsp.chmod(dest, f.mode);
        if (f.mode & 0o111 || /\.(node|dylib|so(\.\d+)*|dll)$/.test(e.path)) programs.push(dest);
      }
      for (const p of want.keys()) if (!seen.has(p)) throw new Fatal(`The archive is missing ${p}`);
      if (c.platform === 'darwin') {
        await this.d.stripQuarantine?.(tmp);
        await this.d.verifySignatures?.(programs);
      }
      await fsp.writeFile(path.join(tmp, MARKER), JSON.stringify({ name: entry.name, version: c.version, sha256: entry.sha256, files: entry.files.length, installedAt: new Date().toISOString() }, null, 2));
      // Into place in one step: an older copy of the same version is moved aside first.
      const aside = `${final}.old-${Date.now()}`;
      if (existsSync(final)) await fsp.rename(final, aside);
      await fsp.rename(tmp, final);
      await fsp.rm(aside, { recursive: true, force: true });
      // Older versions and leftovers of interrupted installs.
      for (const v of await fsp.readdir(dir)) if (v !== c.version) await fsp.rm(path.join(dir, v), { recursive: true, force: true });
    } catch (e) {
      await fsp.rm(tmp, { recursive: true, force: true });
      throw e;
    }
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
