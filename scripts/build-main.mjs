// Bundles the Electron main process, the preload script and the CLI with esbuild.
// Dependencies are bundled in, so the packaged app ships no node_modules except
// the ones listed in `external` (tesseract.js loads its worker from disk).
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const cliOnly = process.argv.includes('--cli-only');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron', 'tesseract.js'],
};

const targets = [
  { ...common, entryPoints: ['cli/keeper.ts'], outfile: 'dist-cli/keeper.cjs', banner: { js: '#!/usr/bin/env node' } },
];
if (!cliOnly) {
  targets.push(
    { ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' },
    { ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' },
    { ...common, entryPoints: ['electron/capture-preload.ts'], outfile: 'dist-electron/capture-preload.cjs' },
  );
}

if (watch) {
  for (const t of targets) await (await context(t)).watch();
} else {
  await Promise.all(targets.map((t) => build(t)));
}
