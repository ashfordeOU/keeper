// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { datedName, launcherTools, PAGES, parseToolId, searchTools, standardOutputDir, TOOLBOX } from '../core/tool-catalog';
import { FEATURES } from '../core/features';

describe('tool launcher catalogue', () => {
  it('lists every Toolbox tool that the Toolbox really has', () => {
    const src = ['Tools', 'ToolsMore', 'ToolsPlus'].map((f) => readFileSync(`src/screens/${f}.tsx`, 'utf8')).join('\n');
    for (const t of TOOLBOX) expect(src, t.id).toContain(`id: '${t.id.slice('toolbox:'.length)}'`);
  });

  it('includes every Convert tool and only known features', () => {
    const all = launcherTools();
    expect(all.filter((t) => t.kind === 'convert').length).toBeGreaterThan(40);
    const ids = new Set(FEATURES.map((f) => f.id));
    for (const t of all) if (t.feature) expect(ids.has(t.feature), t.feature).toBe(true);
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    expect(launcherTools((f) => f !== 'convert').some((t) => t.kind === 'convert')).toBe(false);
  });

  it('pages point at real Health tabs', () => {
    for (const p of PAGES.filter((x) => x.id.startsWith('page:health:'))) expect(['processes', 'history', 'dev', 'sensors']).toContain(p.id.split(':')[2]);
  });

  it('ranks by name, then words, then description; recent first when empty', () => {
    const all = launcherTools();
    expect(searchTools(all, 'json')[0].id).toBe('toolbox:json');
    expect(searchTools(all, 'compress video')[0].id).toBe('convert:video.compress');
    expect(searchTools(all, 'sha')[0].id).toBe('toolbox:hash');
    expect(searchTools(all, 'zzzz')).toEqual([]);
    expect(searchTools(all, '', ['toolbox:uuid'])[0].id).toBe('toolbox:uuid');
  });

  it('parses ids', () => {
    expect(parseToolId('convert:video.compress')).toEqual({ kind: 'convert', ref: 'video.compress' });
    expect(parseToolId('page:health:history')).toEqual({ kind: 'page', ref: 'health:history' });
    expect(parseToolId('nope')).toBeNull();
  });
});

describe('standard output folder', () => {
  const now = new Date(2026, 9, 31, 14, 5);
  it('names dated folders so they sort and are valid everywhere', () => {
    expect(datedName(now)).toBe('2026-10-31 14.05');
    expect(datedName(now, 'Compress: to a size?')).toBe('2026-10-31 14.05 Compress  to a size');
  });

  it('beside keeps the tool’s own place; dated makes a new folder each time; folder uses the chosen one', () => {
    expect(standardOutputDir({ mode: 'beside', folder: '' }, '/d', 'x', now)).toBeUndefined();
    expect(standardOutputDir({ mode: 'folder', folder: '/out' }, '/d', 'x', now)).toBe('/out');
    expect(standardOutputDir({ mode: 'dated', folder: '' }, '/d', 'Trim', now, path.posix.join)).toBe('/d/Keeper/2026-10-31 14.05 Trim');
    const taken = new Set(['/d/Keeper/2026-10-31 14.05 Trim']);
    expect(standardOutputDir({ mode: 'dated', folder: '' }, '/d', 'Trim', now, path.posix.join, (p) => taken.has(p))).toBe('/d/Keeper/2026-10-31 14.05 Trim 2');
  });
});
