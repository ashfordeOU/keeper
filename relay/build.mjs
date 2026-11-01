// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
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
  banner: { js: '// Keeper Relay — PolyForm Shield 1.0.0 (LicenseRef-PolyForm-Shield-1.0.0) — © Ashforde OÜ — https://github.com/ashfordeOU/keeper' },
  logLevel: 'info',
});
