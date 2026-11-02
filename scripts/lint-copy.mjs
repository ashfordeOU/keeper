// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Plain words: fails when a Basic setting's label or help, a section name, a
// page name, or a part offered to everyone uses a word from the banned list
// (index, MCP, WireGuard, glance, CommandOrControl…; core/settings-schema.ts).
// Advanced rows may name the technical term in brackets after plain words.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'keeper-copy-'));
const out = path.join(dir, 'copy.mjs');
try {
  await build({
    stdin: { contents: "export { copyProblems, jargonIn } from './core/settings-schema'; export { NAV_PAGES, HUB_TABS } from './core/nav';", resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
  });
  const { copyProblems, jargonIn, NAV_PAGES, HUB_TABS } = await import(pathToFileURL(out).href);
  const problems = [...copyProblems()];
  for (const p of NAV_PAGES) for (const w of jargonIn(p.label)) problems.push(`page ${p.id}: "${w}"`);
  for (const t of Object.values(HUB_TABS).flat()) for (const w of jargonIn(t.label)) problems.push(`tab ${t.label}: "${w}"`);
  if (problems.length) {
    console.error(`Plain words: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
  } else console.log('Plain words: no banned words in Basic copy');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
