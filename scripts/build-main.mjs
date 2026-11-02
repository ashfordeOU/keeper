// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Bundles the Electron main process, the preload script and the CLI with esbuild.
// Dependencies are bundled in, so the packaged app ships no node_modules except
// the ones listed in `external` (tesseract.js loads its worker from disk; libheif-js
// is LGPL-3.0, so it ships as its own module that people can swap for another build).
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { build, context } from 'esbuild';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const watch = process.argv.includes('--watch');
const cliOnly = process.argv.includes('--cli-only');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  // KEEPER_OFFICIAL_BUILD=1 is set only by Ashforde's release workflow; every other build reports itself as unofficial.
  // The sign-in client IDs (Google, Microsoft) come from the release workflow's secrets; empty means "not in this build",
  // and the Sign in with Google / Microsoft buttons stay hidden. KEEPER_DEVELOPER_ID=1 marks an Apple Developer ID build.
  define: {
    __KEEPER_VERSION__: JSON.stringify(version),
    __KEEPER_OFFICIAL__: JSON.stringify(process.env.KEEPER_OFFICIAL_BUILD === '1'),
    __KEEPER_GOOGLE_CLIENT_ID__: JSON.stringify(process.env.KEEPER_GOOGLE_CLIENT_ID ?? ''),
    __KEEPER_GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.KEEPER_GOOGLE_CLIENT_SECRET ?? ''),
    __KEEPER_MS_CLIENT_ID__: JSON.stringify(process.env.KEEPER_MS_CLIENT_ID ?? ''),
    __KEEPER_DEVELOPER_ID__: JSON.stringify(process.env.KEEPER_DEVELOPER_ID === '1'),
  },
  // libheif-js (LGPL-3.0) stays a separate module under node_modules so it can be replaced; see THIRD-PARTY-NOTICES.md.
  // usocket and x11 are optional extras of the D-Bus client (abstract sockets, X11 bus lookup); it works without them.
  external: ['electron', 'tesseract.js', 'ffmpeg-static', 'pdfjs-dist', 'sharp', 'onnxruntime-node', 'usocket', 'x11', 'cpu-features', '*.node', 'node-pty', 'libheif-js'],
};

// In a split ES module build, `import('pkg')` of a bundled CommonJS package gives a
// namespace with only `default` (the package's module.exports), so `(await import('ssh2')).Client`
// would be undefined. Every such import in Keeper's own code is given the named exports too,
// the way a CommonJS build (and TypeScript) present them: `import('pkg').then(__keeperInterop)`.
const INTEROP = ' const __keeperInterop = (ns) => { const k = Object.keys(ns); const m = ns.default; if (k.length !== 1 || k[0] !== "default" || m == null || (typeof m !== "object" && typeof m !== "function")) return ns; const out = {}; for (const n of Object.keys(m)) out[n] = m[n]; out.default = m.__esModule && "default" in m ? m.default : m; return out; };';
const lazyPackageInterop = {
  name: 'lazy-package-interop',
  setup(b) {
    b.onLoad({ filter: /[\\/](electron|core)[\\/].*\.ts$/ }, async (args) => {
      const src = readFileSync(args.path, 'utf8');
      // Only bare package names (not ./files or node: built-ins), only where the value is used
      // (after await, or followed by .then), never in type positions like typeof import('x').
      const re = /(await\s+)import\((['"])([^.'"/\\][^'"]*)\2\)|import\((['"])([^.'"/\\][^'"]*)\4\)(?=\s*\.then\()/g;
      const out = src.replace(re, (all, aw, q1, p1, q2, p2) => {
        const name = p1 ?? p2;
        if (name.startsWith('node:')) return all;
        return aw ? `${aw}import(${q1}${name}${q1}).then(__keeperInterop)` : `import(${q2}${name}${q2}).then(__keeperInterop)`;
      });
      return out === src ? undefined : { contents: out, loader: 'ts' };
    });
  },
};

const targets = [
  { ...common, entryPoints: ['cli/keeper.ts'], outfile: 'dist-cli/keeper.cjs', banner: { js: '#!/usr/bin/env node' } },
];
if (!cliOnly) {
  targets.push(
    // The main process is split into pieces that load when first needed: what starts
    // with Keeper is read at once, and each feature's code (and the libraries only it
    // uses) is read the first time that feature is used. V8 keeps the source of every
    // loaded piece in memory, so what is never used costs nothing. Whitespace and syntax
    // are minified (names are kept, so errors still read well and the source maps still
    // line up). ES modules, because only they can be split; the banner gives the bundled
    // code the CommonJS names it expects (require, __filename, __dirname), and every
    // piece sits next to main.mjs so __dirname is the same everywhere.
    {
      ...common, entryPoints: { main: 'electron/main.ts' }, outdir: 'dist-electron', format: 'esm', splitting: true,
      outExtension: { '.js': '.mjs' }, chunkNames: 'main-[hash]', minifyWhitespace: !watch, minifySyntax: !watch,
      banner: { js: "import { createRequire as __keeperRequire } from 'node:module'; import { fileURLToPath as __keeperPath } from 'node:url'; import { dirname as __keeperDir } from 'node:path'; const require = __keeperRequire(import.meta.url); const __filename = __keeperPath(import.meta.url); const __dirname = __keeperDir(__filename);" + INTEROP },
      plugins: [lazyPackageInterop],
    },
    { ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' },
    { ...common, entryPoints: ['electron/capture-preload.ts'], outfile: 'dist-electron/capture-preload.cjs' },
    { ...common, entryPoints: ['electron/brain-worker.ts'], outfile: 'dist-electron/brain-worker.cjs' },
    // Privacy & Security: content checks (fingerprints, heuristics, YARA) off the main thread.
    { ...common, entryPoints: ['electron/security-worker.ts'], outfile: 'dist-electron/security-worker.cjs' },
    // The terminal session host runs as its own process so terminals outlive the window.
    { ...common, entryPoints: ['electron/terminal-host.ts'], outfile: 'dist-electron/term-host.cjs' },
    // The watchdog that starts Keeper again after an unexpected stop, and the service hosts.
    { ...common, entryPoints: ['electron/watchdog.ts'], outfile: 'dist-electron/watchdog.cjs', sourcemap: false },
    { ...common, entryPoints: ['electron/svc/net-host.ts'], outfile: 'dist-electron/svc-net.cjs' },
    // Keeper Link without the app (unattended access for your own devices; installed as a system service).
    { ...common, entryPoints: ['electron/linkd.ts'], outfile: 'dist-electron/linkd.cjs' },
    // Keeper Mesh's privileged helper (runs as the administrator; small and separate on purpose).
    { ...common, entryPoints: ['electron/services/mesh/helper.ts'], outfile: 'dist-electron/mesh-helper.cjs', sourcemap: false },
    // The page a phone opens to use Keeper Link without an app (served by the app itself).
    { bundle: true, platform: 'browser', target: 'es2020', format: 'iife', minify: !watch, logLevel: 'info', entryPoints: ['companion/app.ts'], outfile: 'dist-electron/companion/app.js' },
  );
  mkdirSync('dist-electron/companion', { recursive: true });
  // Pieces of an earlier build (their names change with their contents).
  for (const f of readdirSync('dist-electron')) if (/^main-[A-Z0-9]+\.mjs(\.map)?$/i.test(f) || f === 'main.cjs' || f === 'main.cjs.map') rmSync(`dist-electron/${f}`);
  for (const f of ['index.html', 'manifest.webmanifest']) copyFileSync(`companion/${f}`, `dist-electron/companion/${f}`);
  copyFileSync('build/icon.png', 'dist-electron/companion/icon.png');
  copyFileSync('native/macos/mesh-helper.plist', 'dist-electron/mesh-helper.plist');
}

if (watch) {
  for (const t of targets) await (await context(t)).watch();
} else {
  const results = await Promise.all(targets.map((t) => build({ ...t, metafile: true })));
  // One character outside ASCII makes V8 keep the whole source as two bytes per
  // character; escaping the few there are halves the memory the source takes.
  for (const r of results) {
    for (const out of Object.keys(r.metafile.outputs).filter((f) => /\.(c|m)?js$/.test(f))) {
      const src = readFileSync(out, 'utf8');
      if (/[^\x00-\x7f]/.test(src)) writeFileSync(out, src.replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
    }
  }
}
