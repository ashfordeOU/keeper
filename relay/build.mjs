// Bundles Keeper Relay into one file with no dependencies: relay/dist/keeper-relay.mjs
import { build } from 'esbuild';

await build({
  entryPoints: [new URL('./server.ts', import.meta.url).pathname],
  outfile: new URL('./dist/keeper-relay.mjs', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: true,
  banner: { js: '// Keeper Relay — AGPL-3.0-or-later — https://github.com/ashfordeOU/keeper' },
  logLevel: 'info',
});
