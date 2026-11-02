// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Downloadable components (docs/COMPONENTS.md): taken out of a packaged Keeper
// and packed as release assets, from the very same build as the installer.
//
//   node scripts/components.mjs stage --resources <dir> --platform <p> --arch <a> --out <staging> [--strip]
//       copy each component's files out of a packaged app (build/after-pack.cjs does this
//       for the core installer, with --strip, which then leaves them out)
//   node scripts/components.mjs pack --staging <staging> --platform <p> --arch <a> --version <v> --out <dir>
//       one keeper-component-<name>-<p>-<a>.tar.gz per component and components-<p>-<a>.json
//
// On macOS the programs inside are signed like the app by build/after-sign.cjs before
// they are packed; pack refuses a Mach-O file without a valid signature there.
// The archives are plain ustar (+pax for long names), with fixed times and owners,
// so the same files always give the same archive.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LAYOUT = JSON.parse(fs.readFileSync(path.join(root, 'core', 'component-layout.json'), 'utf8')).components;
const FEATURES = {
  ffmpeg: ['studio', 'capture', 'meetings', 'dictation', 'speechModel', 'videoDownload', 'convert'],
  onnxruntime: ['speechModel', 'semantic', 'faces', 'convert', 'dictation', 'meetings'],
  rclone: ['remote', 'sync'],
};

export const expand = (p, platform, arch) => p.replace(/\$\{exe\}/g, platform === 'win32' ? '.exe' : '').replace(/\$\{platform\}/g, platform).replace(/\$\{arch\}/g, arch);
export const componentAsset = (id, platform, arch) => `keeper-component-${id}-${platform}-${arch}.tar.gz`;
export const manifestAsset = (platform, arch) => `components-${platform}-${arch}.json`;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Where a package's folder is in the project's node_modules. */
function moduleDir(name, modules) {
  return path.join(modules ?? path.join(root, 'node_modules'), name);
}

/**
 * Copies every component's files out of a packaged app into `<out>/<id>/…`.
 * strip: also removes them from the app (the core installer). Returns what was staged.
 */
export function stageComponents({ resources, platform, arch, out, strip = false, modules, log = console.log }) {
  const staged = [];
  fs.rmSync(out, { recursive: true, force: true });
  for (const c of LAYOUT) {
    if ((c.unavailable ?? []).includes(`${platform}-${arch}`)) continue;
    const dest = path.join(out, c.id);
    let ok = true;
    for (const f of c.files) {
      const rel = expand(f.path, platform, arch);
      const src = f.from === 'unpacked' ? path.join(resources, 'app.asar.unpacked', rel) : f.from === 'resources' ? path.join(resources, rel) : moduleDir(rel, modules);
      if (!fs.existsSync(src)) {
        if (f.optional) continue;
        log(`  • components: ${c.id} is missing ${path.relative(resources, src) || src}; not staged`);
        ok = false;
        break;
      }
      fs.cpSync(src, path.join(dest, expand(f.to, platform, arch)), { recursive: true, verbatimSymlinks: true, preserveTimestamps: false });
    }
    if (!ok || !fs.existsSync(path.join(dest, expand(c.probe, platform, arch)))) {
      fs.rmSync(dest, { recursive: true, force: true });
      continue;
    }
    staged.push(c.id);
    if (strip) for (const f of c.files) if (f.strip && f.from !== 'modules') fs.rmSync(f.from === 'unpacked' ? path.join(resources, 'app.asar.unpacked', expand(f.path, platform, arch)) : path.join(resources, expand(f.path, platform, arch)), { recursive: true, force: true });
  }
  log(`  • components: staged ${staged.join(', ') || 'nothing'}${strip ? ' and left them out of the app' : ''}`);
  return staged;
}

// ---------------------------------------------------------------- tar

function header(name, { size = 0, mode = 0o644, type = '0', link = '' }) {
  const h = Buffer.alloc(512);
  const put = (s, at, len) => h.write(s, at, len, 'utf8');
  const oct = (n, at, len) => put(n.toString(8).padStart(len - 1, '0') + '\0', at, len);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const i = name.lastIndexOf('/', 155);
    if (i > 0 && Buffer.byteLength(name.slice(i + 1)) <= 100) { prefix = name.slice(0, i); base = name.slice(i + 1); } else base = name.slice(0, 100);
  }
  put(base, 0, 100);
  oct(mode, 100, 8);
  oct(0, 108, 8);
  oct(0, 116, 8);
  oct(size, 124, 12);
  oct(0, 136, 12);
  h.fill(32, 148, 156);
  put(type, 156, 1);
  put(link, 157, 100);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

function paxBlock(name, rec) {
  const lines = Object.entries(rec).map(([k, v]) => {
    const body = ` ${k}=${v}\n`;
    let len = Buffer.byteLength(body) + 1;
    while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
    return `${len}${body}`;
  }).join('');
  const data = Buffer.from(lines);
  return [header(`PaxHeader/${name}`.slice(0, 99), { size: data.length, type: 'x' }), data, Buffer.alloc((512 - (data.length % 512)) % 512)];
}

/** entries: { path, type: 'file'|'dir'|'symlink', mode, data?, link? } → tar bytes. */
export function writeTar(entries) {
  const parts = [];
  for (const e of entries) {
    const name = e.type === 'dir' ? `${e.path}/` : e.path;
    const pax = {};
    if (Buffer.byteLength(name) > 100 && !(name.lastIndexOf('/', 155) > 0 && Buffer.byteLength(name.slice(name.lastIndexOf('/', 155) + 1)) <= 100)) pax.path = name;
    if (e.link && Buffer.byteLength(e.link) > 100) pax.linkpath = e.link;
    if (Object.keys(pax).length) parts.push(...paxBlock(name, pax));
    const size = e.type === 'file' ? e.data.length : 0;
    parts.push(header(name, { size, mode: e.mode, type: e.type === 'dir' ? '5' : e.type === 'symlink' ? '2' : '0', link: e.link ?? '' }));
    if (size) parts.push(e.data, Buffer.alloc((512 - (size % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** Every file, folder and link under dir, sorted, with forward-slash paths. */
function walk(dir) {
  const out = [];
  const visit = (rel) => {
    const abs = path.join(dir, rel);
    const st = fs.lstatSync(abs);
    const p = rel.split(path.sep).join('/');
    if (st.isSymbolicLink()) out.push({ path: p, type: 'symlink', mode: 0o777, link: fs.readlinkSync(abs).split(path.sep).join('/') });
    else if (st.isDirectory()) {
      if (rel) out.push({ path: p, type: 'dir', mode: 0o755 });
      for (const c of fs.readdirSync(abs).sort()) visit(rel ? path.join(rel, c) : c);
    } else out.push({ path: p, type: 'file', mode: st.mode & 0o111 ? 0o755 : 0o644, data: fs.readFileSync(abs) });
  };
  visit('');
  return out;
}

export const isMachO = (b) => b.length >= 4 && [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(b.readUInt32BE(0));

/** The Mach-O programs and libraries in a staged component (what must be signed). */
export function machOFiles(dir) {
  return walk(dir).filter((e) => e.type === 'file' && isMachO(e.data)).map((e) => path.join(dir, ...e.path.split('/')));
}

/** One component's archive and manifest entry. */
export function packComponent({ dir, id, platform, arch, version }) {
  const entries = walk(dir);
  if (platform === 'darwin' && process.platform === 'darwin') {
    for (const e of entries) {
      if (e.type !== 'file' || !isMachO(e.data)) continue;
      // Signed like the app by build/after-sign.cjs; an unsigned program would not run on Apple silicon.
      execFileSync('/usr/bin/codesign', ['--verify', '--strict', path.join(dir, ...e.path.split('/'))], { stdio: 'inherit' });
    }
  }
  const tar = writeTar(entries);
  const gz = gzipSync(tar, { level: 9 });
  const files = entries.filter((e) => e.type !== 'dir').map((e) => (e.type === 'symlink'
    ? { path: e.path, size: 0, sha256: '', mode: 0o777, link: e.link }
    : { path: e.path, size: e.data.length, sha256: sha256(e.data), mode: e.mode }));
  return {
    archive: gz,
    entry: {
      name: id, version, file: componentAsset(id, platform, arch), sha256: sha256(gz), size: gz.length,
      unpackedSize: files.reduce((n, f) => n + f.size, 0), features: FEATURES[id] ?? [], files,
    },
  };
}

/** Packs every staged component; writes the archives and the manifest into out. */
export function packComponents({ staging, platform, arch, version, out, log = console.log }) {
  fs.mkdirSync(out, { recursive: true });
  const components = [];
  for (const c of LAYOUT) {
    const dir = path.join(staging, c.id);
    if (!fs.existsSync(dir)) continue;
    const { archive, entry } = packComponent({ dir, id: c.id, platform, arch, version });
    fs.writeFileSync(path.join(out, entry.file), archive);
    components.push(entry);
    log(`  • ${entry.file}: ${(entry.size / 1e6).toFixed(1)} MB (${(entry.unpackedSize / 1e6).toFixed(1)} MB unpacked, ${entry.files.length} files)`);
  }
  const manifest = { schema: 1, version, platform, arch, components };
  fs.writeFileSync(path.join(out, manifestAsset(platform, arch)), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// ---------------------------------------------------------------- command line

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = args(rest);
  const need = (...k) => { for (const x of k) if (!o[x]) { console.error(`components.mjs ${cmd}: --${x} is required`); process.exit(2); } };
  if (cmd === 'stage') {
    need('resources', 'platform', 'arch', 'out');
    stageComponents({ resources: o.resources, platform: o.platform, arch: o.arch, out: o.out, strip: !!o.strip, modules: o.modules });
  } else if (cmd === 'pack') {
    need('staging', 'platform', 'arch', 'out');
    const version = o.version || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    const m = packComponents({ staging: o.staging, platform: o.platform, arch: o.arch, version, out: o.out });
    if (o.require && m.components.length < LAYOUT.filter((c) => !(c.unavailable ?? []).includes(`${o.platform}-${o.arch}`)).length) {
      console.error(`components.mjs: only ${m.components.map((c) => c.name).join(', ') || 'none'} could be packed for ${o.platform}-${o.arch}`);
      process.exit(1);
    }
  } else {
    console.error('usage: node scripts/components.mjs stage|pack …');
    process.exit(2);
  }
}
