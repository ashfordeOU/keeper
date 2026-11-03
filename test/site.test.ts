// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The website (site/, published by .github/workflows/site.yml): it builds with no
// dependencies, every link inside it resolves, it never writes the paths release.yml owns on
// gh-pages, its wording keeps to the plain-words list, and it loads nothing from elsewhere.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jargonIn } from '../core/settings-schema';

const yaml = createRequire(import.meta.url)('js-yaml') as { load(text: string): unknown };
const ROOT = path.resolve(__dirname, '..');
let out = '';

function files(dir: string, base = ''): string[] {
  return readdirSync(path.join(dir, base), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(dir, path.join(base, e.name)) : [path.join(base, e.name).split(path.sep).join('/')]));
}

beforeAll(() => {
  out = path.join(mkdtempSync(path.join(tmpdir(), 'keeper-site-')), 'site');
  execFileSync(process.execPath, [path.join(ROOT, 'site/build.mjs'), '--out', out], { stdio: 'pipe' });
});
afterAll(() => { if (out) rmSync(path.dirname(out), { recursive: true, force: true }); });

describe('website', () => {
  it('builds every page, with the changelog made from CHANGELOG.md', () => {
    for (const p of ['index.html', 'features/index.html', 'download/index.html', 'privacy/index.html', 'monorail/index.html', 'changelog/index.html', 'support/index.html', '404.html']) {
      expect(existsSync(path.join(out, p)), p).toBe(true);
    }
    const newest = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').match(/^## \[(\d[^\]]*)\]/m)?.[1];
    expect(newest).toBeTruthy();
    expect(readFileSync(path.join(out, 'changelog/index.html'), 'utf8')).toContain(`id="v${newest!.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"`);
  });

  it('lists what it wrote, and never writes the dnf repository or the signing key', () => {
    const listed = readFileSync(path.join(out, '.site-files'), 'utf8').trim().split('\n').sort();
    expect(listed).toEqual(files(out).sort());
    for (const f of listed) expect(f).not.toMatch(/^(rpm|KEYS)(\/|$)|^keeper-release\.asc$/);
  });

  it('loads scripts, styles and pictures only from itself (no tracking, no other sites)', () => {
    for (const f of files(out).filter((p) => p.endsWith('.html'))) {
      const html = readFileSync(path.join(out, f), 'utf8');
      for (const m of html.matchAll(/<(?:script|img|link|iframe|source)\b[^>]*\s(?:src|href)="([^"]+)"/g)) {
        if (/rel="canonical"/.test(m[0])) continue;
        expect(m[1], `${f}: ${m[0]}`).not.toMatch(/^(https?:)?\/\//);
      }
      expect(html).not.toMatch(/googletagmanager|google-analytics|plausible|gtag\(|fbq\(/);
    }
  });

  it('keeps to plain words in its own pages (the changelog quotes CHANGELOG.md as it is)', () => {
    const problems: string[] = [];
    for (const f of readdirSync(path.join(ROOT, 'site/pages')).filter((p) => p.endsWith('.html') && p !== 'changelog.html')) {
      const text = readFileSync(path.join(ROOT, 'site/pages', f), 'utf8')
        .replace(/<!--[\s\S]*?-->/, '')
        .replace(/<(pre|code)\b[\s\S]*?<\/\1>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\{\{[^}]*\}\}/g, ' ');
      for (const w of jargonIn(text)) problems.push(`${f}: "${w}"`);
    }
    expect(problems).toEqual([]);
  });
});

describe('website workflow', () => {
  type Step = { name?: string; uses?: string; with?: Record<string, unknown>; run?: string; env?: Record<string, string>; if?: string };
  type Job = { concurrency?: { group?: string }; steps?: Step[] };
  const site = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/site.yml'), 'utf8')) as { on: Record<string, { paths?: string[]; branches?: string[] } | null>; permissions: Record<string, string>; concurrency: { group: string; 'cancel-in-progress': boolean }; jobs: Record<string, Job> };
  const release = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8')) as { jobs: Record<string, Job> };
  const land = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/sign-and-land.yml'), 'utf8')) as { jobs: Record<string, Job> };

  it('runs on pushes to main that touch the site, on releases and by hand', () => {
    expect(Object.keys(site.on).sort()).toEqual(['push', 'release', 'workflow_dispatch']);
    expect(site.on.push?.branches).toEqual(['main']);
    for (const p of ['site/**', 'README.md', 'CHANGELOG.md', 'docs/**']) expect(site.on.push?.paths).toContain(p);
    expect(site.permissions).toEqual({ contents: 'write' });
  });

  it('builds without installing anything and publishes a signed commit as ashfordeOU', () => {
    const steps = site.jobs.publish.steps ?? [];
    const raw = JSON.stringify(steps);
    expect(raw).not.toMatch(/npm (ci|install)/);
    expect(raw).toContain('node site/build.mjs --out');
    const publish = steps.find((s) => s.name === 'Publish to gh-pages');
    expect(publish?.env?.SIGNING_KEY).toContain('secrets.COMMIT_SIGNING_KEY');
    expect(publish?.run).toContain('git commit -S');
    expect(publish?.run).toContain('236818772+ashfordeOU@users.noreply.github.com');
    expect(publish?.run).not.toMatch(/github-actions|github\.actor|\[bot\]/);
    // Only what the last build listed is removed; the package repositories stay.
    expect(publish?.run).toContain('.site-files');
    expect(publish?.run).toMatch(/rpm\|rpm\/\*\|keeper-release\.asc/);
  });

  it('never pushes to gh-pages at the same time as the release', () => {
    expect(site.concurrency).toEqual({ group: 'gh-pages', 'cancel-in-progress': false });
    expect(release.jobs.pages.concurrency?.group).toBe('gh-pages');
  });

  it('is started by sign-and-land when a landed change touches the site', () => {
    const steps = land.jobs.land.steps ?? [];
    const start = steps.find((s) => s.run?.includes('gh workflow run site.yml'));
    expect(start?.if).toContain("steps.land.outputs.site == 'true'");
    expect(JSON.stringify(steps)).toContain('site=true');
  });
});
