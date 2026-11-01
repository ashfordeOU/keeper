// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The `keeper` command's system monitor (ps, top, kill, process, ports, sensors,
// volume) loads these modules in plain Node: installed copies run it inside the
// app's runtime with ELECTRON_RUN_AS_NODE, where there is no 'electron' module.
// Electron may only be loaded on demand (await import), never when the module loads.
import { build } from 'esbuild';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const MODULES = ['electron/services/procs.ts', 'electron/services/monitor-probe.ts', 'electron/services/monitor-extras.ts'];

async function staticElectronImports(entry: string): Promise<string[]> {
  const found: string[] = [];
  await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'electron-at-load',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, (args) => {
          if (args.kind !== 'dynamic-import') found.push(path.relative(ROOT, args.importer));
          return { path: 'electron', external: true };
        });
      },
    }],
  });
  return found;
}

describe('the keeper command runs without Electron', () => {
  for (const m of MODULES) {
    it(`${m} does not load Electron when it loads`, async () => {
      expect(await staticElectronImports(m)).toEqual([]);
    });
  }
});
