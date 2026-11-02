// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Downloadable components: manifest, versions, feature mapping, the tar format,
// staging and packing (scripts/components.mjs), the installer against a local
// server (checksums, resume, retries, cancel, free up space), the resolver, and
// the Monorail add-on's release choice and row.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addonRow, addonsFor, backgroundPlan, componentAsset, componentRequirement, componentsFor, featureNeeds, joinRel, manifestAsset, manifestProblem, missingFor,
  offlineTotal, parseManifest, releaseBase, safeRelative, versionMatches, type ComponentInfo, type ComponentManifest,
} from '../core/components';
import { readTar } from '../core/tar';
import { componentCandidates, locateComponent, type ComponentPathsContext } from '../core/component-paths';
import { ComponentInstaller, isOfflineError } from '../electron/services/component-installer';
import { compareVersions, newestRelease, type Release } from '../core/ashforde/monorail';
// @ts-expect-error plain JavaScript module without types
import { packComponents, stageComponents, writeTar } from '../scripts/components.mjs';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const made: string[] = [];
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `keeper-comp-${p}-`)); made.push(d); return d; };
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const VERSION = '9.9.9-beta.1';
const P = process.platform;
const A = process.arch;

function entry(over: Record<string, unknown> = {}) {
  return { name: 'ffmpeg', version: '1.0.0', file: componentAsset('ffmpeg', 'linux', 'x64'), sha256: 'a'.repeat(64), size: 10, unpackedSize: 20, features: ['studio'], files: [{ path: 'ffmpeg', size: 20, sha256: 'b'.repeat(64), mode: 0o755 }], ...over };
}
const manifest = (c: unknown[] = [entry()], over: Record<string, unknown> = {}) => JSON.stringify({ schema: 1, version: '1.0.0', platform: 'linux', arch: 'x64', components: c, ...over });

describe('manifest', () => {
  it('reads a valid manifest', () => {
    const m = parseManifest(manifest());
    expect(m.components[0].name).toBe('ffmpeg');
    expect(manifestProblem(m, '1.0.0', 'linux', 'x64')).toBeNull();
    expect(manifestProblem(m, 'v1.0.0', 'linux', 'x64')).toBeNull();
  });
  it('refuses broken or unsafe manifests', () => {
    expect(() => parseManifest('{')).toThrow(/not valid JSON/);
    expect(() => parseManifest(manifest([], { schema: 2 }))).toThrow(/format 2/);
    expect(() => parseManifest(manifest([entry({ name: 'evil' })]))).toThrow(/unknown component/);
    expect(() => parseManifest(manifest([entry({ version: '0.9.0' })]))).toThrow(/is for Keeper 0.9.0/);
    expect(() => parseManifest(manifest([entry({ sha256: 'xyz' })]))).toThrow(/checksum/);
    expect(() => parseManifest(manifest([entry({ file: 'other.tar.gz' })]))).toThrow(/points at/);
    expect(() => parseManifest(manifest([entry({ files: [{ path: '../x', size: 1, sha256: 'b'.repeat(64), mode: 0o644 }] })]))).toThrow(/unsafe path/);
    expect(() => parseManifest(manifest([entry({ files: [{ path: '/etc/x', size: 1, sha256: 'b'.repeat(64), mode: 0o644 }] })]))).toThrow(/unsafe path/);
    expect(() => parseManifest(manifest([entry({ files: [{ path: 'a/l', size: 0, sha256: '', mode: 0o777, link: '../../out' }] })]))).toThrow(/link that leaves/);
    expect(() => parseManifest(manifest([entry({ size: 0 })]))).toThrow(/size/);
  });
  it('matches versions exactly, and the system', () => {
    const m = parseManifest(manifest());
    expect(manifestProblem(m, '1.0.1', 'linux', 'x64')).toMatch(/for Keeper 1.0.0, but this is Keeper 1.0.1/);
    expect(manifestProblem(m, '1.0.0', 'darwin', 'arm64')).toMatch(/linux-x64/);
    expect(versionMatches('1.0.0-beta.2', '1.0.0-beta.2')).toBe(true);
    expect(versionMatches('1.0.0-beta.2', '1.0.0')).toBe(false);
    expect(versionMatches(undefined, '1.0.0')).toBe(false);
  });
  it('names assets and release folders', () => {
    expect(componentAsset('rclone', 'darwin', 'arm64')).toBe('keeper-component-rclone-darwin-arm64.tar.gz');
    expect(manifestAsset('win32', 'x64')).toBe('components-win32-x64.json');
    expect(releaseBase('1.0.0')).toBe('https://github.com/ashfordeOU/keeper/releases/download/v1.0.0');
    expect(releaseBase('v1.0.0-beta.3', 'http://127.0.0.1:9/')).toBe('http://127.0.0.1:9/v1.0.0-beta.3');
  });
  it('checks relative paths', () => {
    expect(safeRelative('node_modules/a/b.js')).toBe(true);
    for (const bad of ['', '/a', 'a/../b', 'a//b', 'C:/x', 'a\\b', './a']) expect(safeRelative(bad)).toBe(false);
    expect(joinRel('a/b', '../c')).toBe('a/c');
    expect(joinRel('a', '../../c')).toBe('');
  });
});

describe('features → components', () => {
  it('maps features to what they need', () => {
    expect(componentsFor(['studio'])).toEqual(['ffmpeg']);
    expect(componentsFor(['speechModel']).sort()).toEqual(['ffmpeg', 'onnxruntime']);
    expect(componentsFor(['remote'])).toEqual(['rclone']);
    expect(componentsFor(['library', 'tray'])).toEqual([]);
    // Convert works on pictures without either: only when parts count.
    expect(componentsFor(['convert']).sort()).toEqual(['ffmpeg', 'onnxruntime']);
    expect(componentsFor(['convert'], { partly: false })).toEqual([]);
    // No ONNX Runtime for Intel Macs.
    expect(componentsFor(['semantic'], { platform: 'darwin', arch: 'x64' })).toEqual([]);
    expect(featureNeeds('convert').map((n) => n.partly)).toEqual(['video and audio', 'background removal']);
  });
  it('lists what is missing for a feature and for offline use', () => {
    const infos = [
      { id: 'ffmpeg', state: 'installed', downloadSize: 1, sizeOnDisk: 5 },
      { id: 'onnxruntime', state: 'missing', downloadSize: 2, sizeOnDisk: 0 },
      { id: 'rclone', state: 'unavailable', downloadSize: 4, sizeOnDisk: 0 },
    ] as ComponentInfo[];
    expect(missingFor('speechModel', infos).map((c) => c.id)).toEqual(['onnxruntime']);
    expect(missingFor('studio', infos)).toEqual([]);
    expect(offlineTotal(infos)).toEqual({ ids: ['onnxruntime'], bytes: 2 });
  });
  it('downloads by itself only after an update, never on a fresh install', () => {
    const infos = [{ id: 'ffmpeg', state: 'missing' }, { id: 'onnxruntime', state: 'outdated' }, { id: 'rclone', state: 'missing' }] as ComponentInfo[];
    const base = { currentVersion: '1.0.0', onFeatures: ['studio', 'semantic'], infos, platform: 'linux', arch: 'x64' };
    expect(backgroundPlan({ ...base })).toEqual(['onnxruntime']);
    expect(backgroundPlan({ ...base, previousVersion: '1.0.0' })).toEqual(['onnxruntime']);
    expect(backgroundPlan({ ...base, previousVersion: '0.1.0-beta.7' })).toEqual(['ffmpeg', 'onnxruntime']);
    expect(backgroundPlan({ ...base, previousVersion: '0.1.0-beta.7', onFeatures: [] })).toEqual([]);
  });
  it('offers add-on apps only on their systems, never as a component', () => {
    expect(addonsFor(['monorail', 'studio'], 'darwin')).toEqual(['monorail']);
    expect(addonsFor(['monorail'], 'linux')).toEqual([]);
    expect(componentsFor(['monorail'])).toEqual([]);
  });
});

describe('macOS signature requirement for components', () => {
  it('keeps the certificate and drops the identifier', () => {
    expect(componentRequirement('identifier "io.github.ashfordeou.keeper" and certificate leaf = H"abcd"')).toBe('certificate leaf = H"abcd"');
    expect(componentRequirement('identifier "x" and anchor apple generic and certificate leaf[subject.OU] = T123')).toBe('anchor apple generic and certificate leaf[subject.OU] = T123');
    expect(componentRequirement('cdhash H"0123"')).toBeUndefined();
    expect(componentRequirement(undefined)).toBeUndefined();
    expect(componentRequirement('identifier "x"')).toBeUndefined();
  });
});

describe('tar', () => {
  it('round-trips files, folders, links, modes and long names', () => {
    const long = `node_modules/${'a'.repeat(60)}/${'b'.repeat(60)}/${'c'.repeat(80)}.js`;
    const veryLong = `${'d'.repeat(120)}.bin`;
    const tar = writeTar([
      { path: 'bin', type: 'dir', mode: 0o755 },
      { path: 'bin/tool', type: 'file', mode: 0o755, data: Buffer.from('#!/bin/sh\necho hi\n') },
      { path: long, type: 'file', mode: 0o644, data: Buffer.alloc(1000, 7) },
      { path: veryLong, type: 'file', mode: 0o644, data: Buffer.from('x') },
      { path: 'bin/lib.1.dylib', type: 'symlink', mode: 0o777, link: 'lib.1.2.dylib' },
    ]);
    const out = readTar(tar);
    expect(out.map((e) => e.path)).toEqual(['bin', 'bin/tool', long, veryLong, 'bin/lib.1.dylib']);
    expect(out[1].mode).toBe(0o755);
    expect(Buffer.from(out[2].data!).equals(Buffer.alloc(1000, 7))).toBe(true);
    expect(out[4]).toMatchObject({ type: 'symlink', link: 'lib.1.2.dylib' });
  });
  it('refuses a damaged archive', () => {
    const tar = writeTar([{ path: 'a', type: 'file', mode: 0o644, data: Buffer.from('hello') }]);
    tar[10] ^= 0xff;
    expect(() => readTar(tar)).toThrow(/damaged/);
    const cut = writeTar([{ path: 'a', type: 'file', mode: 0o644, data: Buffer.alloc(5000) }]).subarray(0, 1024);
    expect(() => readTar(cut)).toThrow(/cut short/);
  });
});

// ---------------------------------------------------------------- staging, packing and installing

/** A packaged app's resources folder with fake components in the places Keeper's layout names. */
function fakeResources(root: string) {
  const exe = P === 'win32' ? '.exe' : '';
  const u = path.join(root, 'app.asar.unpacked', 'node_modules');
  fs.mkdirSync(path.join(u, 'ffmpeg-static'), { recursive: true });
  fs.writeFileSync(path.join(u, 'ffmpeg-static', `ffmpeg${exe}`), '#!/bin/sh\necho "ffmpeg version test"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(u, 'ffmpeg-static', 'index.js'), 'module.exports = null;');
  fs.writeFileSync(path.join(u, 'ffmpeg-static', 'ffmpeg.LICENSE'), 'GPL');
  const bin = path.join(u, 'onnxruntime-node', 'bin', 'napi-v6', P, A);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'onnxruntime_binding.node'), 'binary');
  fs.writeFileSync(path.join(bin, 'libonnxruntime.1.31.1.dylib'), 'lib');
  fs.symlinkSync('libonnxruntime.1.31.1.dylib', path.join(bin, 'libonnxruntime.1.dylib'));
  fs.writeFileSync(path.join(u, 'onnxruntime-node', 'package.json'), '{"name":"onnxruntime-node","main":"index.js"}');
  fs.writeFileSync(path.join(u, 'onnxruntime-node', 'index.js'), 'module.exports = { fake: true, common: require("onnxruntime-common") };');
  fs.mkdirSync(path.join(root, 'rclone'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rclone', `rclone${exe}`), '#!/bin/sh\necho "rclone v1.0"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'rclone', 'LICENSE.txt'), 'MIT');
}

describe('staging and packing (scripts/components.mjs)', () => {
  it('stages every component, strips them from the app, and packs archives with a manifest', () => {
    const root = tmp('pack');
    const res = path.join(root, 'resources');
    fakeResources(res);
    const mods = path.join(root, 'modules');
    fs.mkdirSync(path.join(mods, 'onnxruntime-common'), { recursive: true });
    fs.writeFileSync(path.join(mods, 'onnxruntime-common', 'package.json'), '{"name":"onnxruntime-common","main":"index.js"}');
    fs.writeFileSync(path.join(mods, 'onnxruntime-common', 'index.js'), 'module.exports = "common";');
    const staged = stageComponents({ resources: res, platform: P, arch: A, out: path.join(root, 'staging'), strip: true, modules: mods, log: () => undefined });
    expect(staged.sort()).toEqual(P === 'darwin' && A === 'x64' ? ['ffmpeg', 'rclone'] : ['ffmpeg', 'onnxruntime', 'rclone']);
    // The core app keeps ffmpeg-static's JavaScript, not its program.
    expect(fs.existsSync(path.join(res, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(res, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg'))).toBe(false);
    expect(fs.existsSync(path.join(res, 'rclone'))).toBe(false);
    const m = packComponents({ staging: path.join(root, 'staging'), platform: P, arch: A, version: VERSION, out: path.join(root, 'out'), log: () => undefined }) as ComponentManifest;
    const parsed = parseManifest(fs.readFileSync(path.join(root, 'out', manifestAsset(P, A)), 'utf8'));
    expect(parsed.components.map((c) => c.name)).toEqual(m.components.map((c) => c.name));
    const onnx = parsed.components.find((c) => c.name === 'onnxruntime');
    if (onnx) expect(onnx.files.find((f) => f.link)).toMatchObject({ link: 'libonnxruntime.1.31.1.dylib' });
    for (const c of parsed.components) expect(sha(fs.readFileSync(path.join(root, 'out', c.file)))).toBe(c.sha256);
    // The same files give the same archive.
    const again = packComponents({ staging: path.join(root, 'staging'), platform: P, arch: A, version: VERSION, out: path.join(root, 'out2'), log: () => undefined }) as ComponentManifest;
    expect(again.components.map((c) => c.sha256)).toEqual(m.components.map((c) => c.sha256));
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('installer', () => {
  let root: string;
  let release: string;
  let server: http.Server;
  let feed: string;
  const hits: { url: string; range?: string }[] = [];
  /** cut the next response for this file after N bytes */
  const cut = new Map<string, number>();
  let rangeOk = true;

  beforeAll(async () => {
    root = tmp('inst');
    const res = path.join(root, 'resources');
    fakeResources(res);
    stageComponents({ resources: res, platform: P, arch: A, out: path.join(root, 'staging'), log: () => undefined });
    release = path.join(root, 'release', `v${VERSION}`);
    packComponents({ staging: path.join(root, 'staging'), platform: P, arch: A, version: VERSION, out: release, log: () => undefined });
    writeSums();
    server = http.createServer((req, rsp) => {
      const name = decodeURIComponent((req.url ?? '').replace(/^\/v[^/]+\//, ''));
      hits.push({ url: name, range: req.headers.range as string | undefined });
      const file = path.join(release, name);
      if (!fs.existsSync(file)) { rsp.writeHead(404).end(); return; }
      let body = fs.readFileSync(file);
      let status = 200;
      const m = /bytes=(\d+)-/.exec(String(req.headers.range ?? ''));
      if (m && rangeOk) { body = body.subarray(Number(m[1])); status = 206; }
      const limit = cut.get(name);
      if (limit !== undefined) {
        cut.delete(name);
        rsp.writeHead(status, { 'content-length': String(body.length) });
        rsp.write(body.subarray(0, limit), () => rsp.destroy());
        return;
      }
      rsp.writeHead(status, { 'content-length': String(body.length) }).end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    feed = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeSums() {
    const lines = fs.readdirSync(release).filter((f) => f !== 'SHA256SUMS.txt').map((f) => `${sha(fs.readFileSync(path.join(release, f)))}  ${f}`);
    fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  }
  const ctx = (userData: string, over: Partial<ComponentPathsContext> = {}): ComponentPathsContext => ({ version: VERSION, userData, platform: P, arch: A, packaged: false, dev: false, ...over });
  const make = (userData: string, over: Partial<ComponentPathsContext> = {}) => new ComponentInstaller({ ctx: () => ctx(userData, over), feed, retries: 3, retryDelayMs: 10 });
  const state = (inst: ComponentInstaller, id: string) => inst.infos().find((i) => i.id === id)!;

  it('downloads, checks and installs a component, then frees it', async () => {
    const ud = tmp('ud');
    const inst = make(ud);
    expect(state(inst, 'ffmpeg').state).toBe('missing');
    expect(state(inst, 'ffmpeg').estimate).toBe(true);
    await inst.install('ffmpeg');
    const info = state(inst, 'ffmpeg');
    expect(info.state).toBe('installed');
    expect(info.estimate).toBe(false);
    expect(info.sizeOnDisk).toBeGreaterThan(0);
    const exe = path.join(ud, 'components', 'ffmpeg', VERSION, P === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    expect(locateComponent('ffmpeg', ctx(ud))?.probe).toBe(exe);
    if (P !== 'win32') expect(fs.statSync(exe).mode & 0o111).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(path.join(ud, 'components', 'ffmpeg', VERSION, 'component.json'), 'utf8')).version).toBe(VERSION);
    await inst.remove('ffmpeg');
    expect(state(inst, 'ffmpeg').state).toBe('missing');
    expect(fs.existsSync(path.join(ud, 'components', 'ffmpeg'))).toBe(false);
  });

  it('keeps links and node modules of ONNX Runtime and loads it from its own folder', async () => {
    if (P === 'darwin' && A === 'x64') return;
    const ud = tmp('ud');
    // onnxruntime-common comes from the project here: the real one.
    await make(ud).install('onnxruntime');
    const dir = path.join(ud, 'components', 'onnxruntime', VERSION);
    expect(fs.lstatSync(path.join(dir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', P, A, 'libonnxruntime.1.dylib')).isSymbolicLink()).toBe(true);
    expect(locateComponent('onnxruntime', ctx(ud))?.source).toBe('installed');
  });

  it('resumes a cut-off download where it stopped', async () => {
    const ud = tmp('ud');
    const file = componentAsset('rclone', P, A);
    const half = Math.floor(fs.statSync(path.join(release, file)).size / 2);
    cut.set(file, half);
    hits.length = 0;
    await make(ud).install('rclone');
    const tries = hits.filter((h) => h.url === file);
    expect(tries.length).toBe(2);
    expect(tries[1].range).toBe(`bytes=${half}-`);
    expect(locateComponent('rclone', ctx(ud))).not.toBeNull();
  });

  it('starts again when the server ignores the range', async () => {
    const ud = tmp('ud');
    const file = componentAsset('rclone', P, A);
    fs.mkdirSync(path.join(ud, 'components', '.downloads'), { recursive: true });
    fs.writeFileSync(path.join(ud, 'components', '.downloads', `${file}.part`), fs.readFileSync(path.join(release, file)).subarray(0, 100));
    rangeOk = false;
    try {
      await make(ud).install('rclone');
    } finally {
      rangeOk = true;
    }
    expect(locateComponent('rclone', ctx(ud))).not.toBeNull();
  });

  it('refuses an archive that does not match its checksum, and installs nothing', async () => {
    const ud = tmp('ud');
    const file = path.join(release, componentAsset('ffmpeg', P, A));
    const good = fs.readFileSync(file);
    const bad = Buffer.from(good);
    bad[bad.length - 10] ^= 0xff;
    fs.writeFileSync(file, bad);
    try {
      const inst = make(ud);
      await expect(inst.install('ffmpeg')).rejects.toThrow(/does not match the release's checksum/);
      expect(state(inst, 'ffmpeg').state).toBe('error');
      expect(state(inst, 'ffmpeg').offline).toBe(false);
      expect(fs.existsSync(path.join(ud, 'components', 'ffmpeg', VERSION))).toBe(false);
      expect(fs.existsSync(path.join(ud, 'components', '.downloads', `${componentAsset('ffmpeg', P, A)}.part`))).toBe(false);
    } finally {
      fs.writeFileSync(file, good);
    }
  });

  it('refuses a manifest that SHA256SUMS.txt does not vouch for', async () => {
    const ud = tmp('ud');
    const sums = path.join(release, 'SHA256SUMS.txt');
    const good = fs.readFileSync(sums, 'utf8');
    fs.writeFileSync(sums, good.split('\n').filter((l) => !l.includes(manifestAsset(P, A))).join('\n'));
    try {
      await expect(make(ud).install('ffmpeg')).rejects.toThrow(/not listed in the release's SHA256SUMS.txt/);
    } finally {
      fs.writeFileSync(sums, good);
    }
  });

  it('refuses components made for another Keeper version', async () => {
    const ud = tmp('ud');
    const other = path.join(root, 'release', 'v9.9.8');
    fs.cpSync(release, other, { recursive: true });
    await expect(new ComponentInstaller({ ctx: () => ctx(ud, { version: '9.9.8' }), feed, retries: 1 }).install('ffmpeg')).rejects.toThrow(/for Keeper 9.9.9-beta.1, but this is Keeper 9.9.8/);
  });

  it('says when it is offline (so it can retry later)', async () => {
    const ud = tmp('ud');
    const inst = new ComponentInstaller({ ctx: () => ctx(ud), feed: 'http://127.0.0.1:1', retries: 1 });
    await expect(inst.install('ffmpeg')).rejects.toMatchObject({ offline: true });
    expect(state(inst, 'ffmpeg')).toMatchObject({ state: 'error', offline: true });
    expect(isOfflineError(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }))).toBe(true);
    expect(isOfflineError(new Error('The download does not match'))).toBe(false);
  });

  it('can be cancelled', async () => {
    const ud = tmp('ud');
    const inst = make(ud);
    const p = inst.install('ffmpeg');
    inst.cancel('ffmpeg');
    await expect(p).rejects.toThrow(/Cancelled/);
    expect(state(inst, 'ffmpeg').state).toBe('missing');
  });

  it('shows an older version as outdated and replaces it', async () => {
    const ud = tmp('ud');
    const old = path.join(ud, 'components', 'rclone', '0.1.0');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'component.json'), JSON.stringify({ version: '0.1.0' }));
    fs.writeFileSync(path.join(old, P === 'win32' ? 'rclone.exe' : 'rclone'), 'old');
    const inst = make(ud);
    expect(state(inst, 'rclone')).toMatchObject({ state: 'outdated', version: '0.1.0' });
    expect(locateComponent('rclone', ctx(ud))).toBeNull();
    await inst.install('rclone');
    expect(fs.existsSync(old)).toBe(false);
    expect(state(inst, 'rclone').state).toBe('installed');
  });
});

describe('resolver', () => {
  const c = (over: Partial<ComponentPathsContext>): ComponentPathsContext => ({ version: '1.0.0', userData: '/u', platform: 'linux', arch: 'x64', packaged: false, dev: false, ...over });
  it('looks inside the app first, then downloads, then the development copy', () => {
    const list = componentCandidates('ffmpeg', c({ packaged: true, resourcesPath: '/r', appPath: '/p', dev: true }));
    expect(list.map((x) => x.source)).toEqual(['bundled', 'installed', 'dev']);
    expect(list[0].dir).toBe(path.join('/r', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static'));
    expect(list[1].dir).toBe(path.join('/u', 'components', 'ffmpeg', '1.0.0'));
  });
  it('uses node_modules directly in development', () => {
    const appPath = path.resolve(__dirname, '..');
    const l = locateComponent('onnxruntime', c({ appPath, dev: true, platform: P, arch: A }));
    const binding = path.join(appPath, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', P, A, 'onnxruntime_binding.node');
    if (fs.existsSync(binding)) expect(l).toMatchObject({ source: 'dev', probe: binding });
    expect(locateComponent('onnxruntime', c({ appPath, dev: false, platform: P, arch: A }))).toBeNull();
  });
  it('ignores a downloaded copy for another version', () => {
    const files = new Set([path.join('/u', 'components', 'rclone', '1.0.0', 'rclone')]);
    // No marker file is readable here, so the copy does not count.
    expect(locateComponent('rclone', c({}), (p) => files.has(p))).toBeNull();
  });
});

describe('Monorail add-on', () => {
  const rel = (tag: string, prerelease = false, draft = false): Release => ({ tag_name: tag, prerelease, draft, assets: [{ name: `Monorail-${tag}.zip`, browser_download_url: 'x', size: 5_000_000 }, { name: 'SHA256SUMS', browser_download_url: 'y' }] });
  it('compares versions the semantic way', () => {
    expect(compareVersions('1.2.0', '1.2.0-beta.3')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0-beta.10', '1.2.0-beta.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.3.0-beta.1', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });
  it('installs the latest stable release, or the latest pre-release for people who follow betas', () => {
    const list = [rel('v1.2.0-beta.3', true), rel('v1.1.0'), rel('v1.3.0-beta.1', true), rel('v1.2.0'), rel('v2.0.0', false, true)];
    expect(newestRelease(list)?.tag_name).toBe('v1.2.0');
    expect(newestRelease(list, true)?.tag_name).toBe('v1.3.0-beta.1');
    // A stable release beats its own betas, also for beta followers.
    expect(newestRelease([rel('v1.2.0-beta.3', true), rel('v1.2.0')], true)?.tag_name).toBe('v1.2.0');
  });
  it('maps its status to the row next to the components', () => {
    expect(addonRow('monorail', 'linux', null)).toMatchObject({ visible: false, actions: [] });
    expect(addonRow('monorail', 'linux', null).note).toMatch(/macOS/);
    expect(addonRow('monorail', 'darwin', { supported: false, unsupportedReason: 'Needs macOS 13', installed: false })).toMatchObject({ visible: true, actions: [], note: 'Needs macOS 13' });
    expect(addonRow('monorail', 'darwin', { supported: true, installed: false })).toMatchObject({ actions: ['install'], line: 'Not installed' });
    expect(addonRow('monorail', 'darwin', { supported: true, installed: true, version: '1.1.0' })).toMatchObject({ actions: ['open', 'uninstall'], latest: '1.1.0', line: 'Installed 1.1.0 · up to date' });
    expect(addonRow('monorail', 'darwin', { supported: true, installed: true, version: '1.1.0', update: { version: '1.2.0' } })).toMatchObject({ actions: ['update', 'open', 'uninstall'], latest: '1.2.0', line: 'Installed 1.1.0 · 1.2.0 available' });
    expect(addonRow('monorail', 'darwin', { supported: true, installed: false, busy: { step: 'Downloading Monorail 1.2.0', progress: 0.4 } })).toMatchObject({ actions: [], line: 'Downloading Monorail 1.2.0 40%' });
  });
});
