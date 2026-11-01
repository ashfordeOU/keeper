// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The release workflow's promises: betas (tags with a hyphen) become GitHub pre-releases and
// never reach a package manager; the Store package stays a workflow artifact. See docs/BETA.md.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// js-yaml ships no type declarations; only load() is used.
const yaml = createRequire(import.meta.url)('js-yaml') as { load(text: string): unknown };

const ROOT = path.resolve(__dirname, '..');
type Job = { if?: string; needs?: string | string[]; steps?: { uses?: string; with?: Record<string, unknown>; run?: string }[] };
const wf = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8')) as { jobs: Record<string, Job> };

/** Jobs that publish somewhere other than the GitHub release itself. */
const CHANNELS = ['homebrew', 'cask', 'winget', 'chocolatey', 'scoop', 'snap', 'aur', 'npm', 'pages'];

describe('release workflow', () => {
  it('marks versions with a hyphen as pre-releases', () => {
    const release = wf.jobs.release;
    const version = wf.jobs.tag.steps?.find((s) => s.run?.includes('prerelease='));
    expect(version?.run).toMatch(/\*-\*\) prerelease=true/);
    const gh = release.steps?.find((s) => s.uses?.startsWith('softprops/action-gh-release'));
    expect(String(gh?.with?.prerelease)).toContain("steps.meta.outputs.prerelease == 'true'");
  });

  it.each(CHANNELS)('the %s channel never runs for a pre-release', (name) => {
    const job = wf.jobs[name];
    expect(job, name).toBeTruthy();
    // pages runs only when the apt/dnf repositories were built, which itself needs a stable release.
    if (name === 'pages') {
      expect(job.if).toContain("needs.release.outputs.repos == 'true'");
      expect(JSON.stringify(wf.jobs.release.steps)).toMatch(/steps\.meta\.outputs\.prerelease == 'false'/);
      return;
    }
    expect(job.if).toContain("needs.release.outputs.prerelease == 'false'");
  });

  it('no publishing job is left unchecked', () => {
    const known = new Set(['tag', 'build', 'release', 'msstore', ...CHANNELS]);
    expect(Object.keys(wf.jobs).filter((j) => !known.has(j))).toEqual([]);
  });

  it('builds the Store package only when a version is being built', () => {
    expect(wf.jobs.msstore.needs).toBe('tag');
    expect(wf.jobs.msstore.if).toContain("needs.tag.outputs.build == 'true'");
  });

  it('keeps the Store package out of the GitHub release', () => {
    const upload = wf.jobs.msstore.steps?.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    // The release job downloads "keeper-*" artifacts; the .msix must not match that pattern.
    expect(String(upload?.with?.name)).not.toMatch(/^keeper-/);
    expect(JSON.stringify(wf.jobs.msstore.steps)).not.toContain('action-gh-release');
  });
  it('publishes SHA256SUMS.txt covering every file in the release (the updater refuses a release without it)', () => {
    const steps = wf.jobs.release.steps ?? [];
    const at = (pred: (s: (typeof steps)[number]) => boolean) => steps.findIndex(pred);
    const sums = at((s) => /SHA256SUMS\.txt/.test(s.run ?? '') && /sha256sum/.test(s.run ?? ''));
    expect(sums).toBeGreaterThan(-1);
    // Every file in artifacts/ (the downloaded keeper-* builds and the npm package), not a hand-picked list.
    expect(steps[sums].run).toMatch(/cd artifacts && sha256sum -- \* > SHA256SUMS\.txt/);
    // Everything that lands in artifacts/ comes before the checksums...
    const npm = at((s) => /npm pack .*--pack-destination artifacts/.test(s.run ?? ''));
    const builds = at((s) => s.uses?.startsWith('actions/download-artifact') === true && s.with?.path === 'artifacts');
    for (const i of [npm, builds]) expect(i).toBeGreaterThan(-1);
    expect(Math.max(npm, builds)).toBeLessThan(sums);
    // ...and the release uploads the whole folder, the checksums with it.
    const gh = at((s) => s.uses?.startsWith('softprops/action-gh-release') === true);
    expect(gh).toBeGreaterThan(sums);
    expect(steps[gh].with?.files).toBe('artifacts/*');
    // The name the updater looks for.
    expect(readFileSync(path.join(ROOT, 'core/update-verify.ts'), 'utf8')).toContain("CHECKSUMS_FILE = 'SHA256SUMS.txt'");
  });
});
