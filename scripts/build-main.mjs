// Bundles the Electron main process, the preload script and the CLI with esbuild.
// Dependencies are bundled in, so the packaged app ships no node_modules except
// the ones listed in `external` (tesseract.js loads its worker from disk).
import { readFileSync } from 'node:fs';
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
  external: ['electron', 'tesseract.js', 'ffmpeg-static', 'pdfjs-dist', 'sharp', 'onnxruntime-node', 'usocket', 'x11'],
};

const targets = [
  { ...common, entryPoints: ['cli/keeper.ts'], outfile: 'dist-cli/keeper.cjs', banner: { js: '#!/usr/bin/env node' } },
];
if (!cliOnly) {
  targets.push(
    { ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' },
    { ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' },
    { ...common, entryPoints: ['electron/capture-preload.ts'], outfile: 'dist-electron/capture-preload.cjs' },
    { ...common, entryPoints: ['electron/brain-worker.ts'], outfile: 'dist-electron/brain-worker.cjs' },
  );
}

if (watch) {
  for (const t of targets) await (await context(t)).watch();
} else {
  await Promise.all(targets.map((t) => build(t)));
}
