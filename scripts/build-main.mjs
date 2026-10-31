// Bundles the Electron main process, the preload script and the CLI with esbuild.
// Dependencies are bundled in, so the packaged app ships no node_modules except
// the ones listed in `external` (tesseract.js loads its worker from disk).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  define: { __KEEPER_VERSION__: JSON.stringify(version) },
  // usocket and x11 are optional extras of the D-Bus client (abstract sockets, X11 bus lookup); it works without them.
  external: ['electron', 'tesseract.js', 'ffmpeg-static', 'pdfjs-dist', 'sharp', 'onnxruntime-node', 'usocket', 'x11', 'cpu-features', '*.node', 'node-pty'],
};

const targets = [
  { ...common, entryPoints: ['cli/keeper.ts'], outfile: 'dist-cli/keeper.cjs', banner: { js: '#!/usr/bin/env node' } },
];
if (!cliOnly) {
  targets.push(
    // Whitespace and syntax are minified (names are kept, so errors still read well and the
    // source maps still line up): the main process keeps its whole source in memory.
    { ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs', minifyWhitespace: !watch, minifySyntax: !watch },
    { ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' },
    { ...common, entryPoints: ['electron/capture-preload.ts'], outfile: 'dist-electron/capture-preload.cjs' },
    { ...common, entryPoints: ['electron/brain-worker.ts'], outfile: 'dist-electron/brain-worker.cjs' },
    // The terminal session host runs as its own process so terminals outlive the window.
    { ...common, entryPoints: ['electron/terminal-host.ts'], outfile: 'dist-electron/term-host.cjs' },
    // The page a phone opens to use Keeper Link without an app (served by the app itself).
    { bundle: true, platform: 'browser', target: 'es2020', format: 'iife', minify: !watch, logLevel: 'info', entryPoints: ['companion/app.ts'], outfile: 'dist-electron/companion/app.js' },
  );
  mkdirSync('dist-electron/companion', { recursive: true });
  for (const f of ['index.html', 'manifest.webmanifest']) copyFileSync(`companion/${f}`, `dist-electron/companion/${f}`);
  copyFileSync('build/icon.png', 'dist-electron/companion/icon.png');
}

if (watch) {
  for (const t of targets) await (await context(t)).watch();
} else {
  await Promise.all(targets.map((t) => build(t)));
  // One character outside ASCII makes V8 keep the whole source as two bytes per
  // character; escaping the few there are halves the memory the source takes.
  for (const t of targets) {
    const src = readFileSync(t.outfile, 'utf8');
    if (/[^\x00-\x7f]/.test(src)) writeFileSync(t.outfile, src.replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
  }
}
