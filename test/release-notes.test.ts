// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The release body (.github/scripts/release-notes.mjs): the CHANGELOG section or a
// hand-written summary, long notes folded so they stay readable, the platforms line
// and the install and first-launch notes.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { noteBlocks } from '../core/update-window';
// @ts-expect-error plain JavaScript module without type declarations
import { buildNotes, changelogSection, foldLongNotes } from '../.github/scripts/release-notes.mjs';

const ROOT = path.resolve(__dirname, '..');
const CHANGELOG = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const long = (n: number) => Array.from({ length: n }, (_, i) => `### Area ${i}\n${Array.from({ length: 6 }, (_, j) => `- Change ${i}.${j}: ${'words '.repeat(30)}`).join('\n')}`).join('\n\n');

describe('release notes', () => {
  it('takes the section of the changelog for the version', () => {
    const s = changelogSection(CHANGELOG, '0.1.0-beta.7') as string;
    expect(s).toMatch(/^### Fixed/);
    expect(s).not.toContain('## [0.1.0-beta.6]');
    expect(changelogSection(CHANGELOG, '9.9.9')).toBe('');
  });

  it('leaves short notes alone and folds the long sections of long ones', () => {
    expect(foldLongNotes('### Fixed\n- one')).toBe('### Fixed\n- one');
    const folded = foldLongNotes(`Intro line.\n\n${long(8)}`) as string;
    expect(folded.startsWith('Intro line.\n\n**In this release:** Area 0 · Area 1')).toBe(true);
    expect(folded.match(/<details><summary>6 changes<\/summary>/g)).toHaveLength(8);
    expect(folded.match(/<\/details>/g)).toHaveLength(8);
    // Every heading stays visible, and Keeper's own window (HTML dropped) still shows headings and lists.
    for (let i = 0; i < 8; i++) expect(folded).toContain(`### Area ${i}\n\n<details>`);
    const blocks = noteBlocks(folded);
    expect(blocks.filter((b) => b.t === 'h')).toHaveLength(8);
    expect(blocks.filter((b) => b.t === 'ul')).toHaveLength(8);
  });

  it('says which systems a partial release is for, and how to open the Mac build', () => {
    const mac = buildNotes({ version: '1.0.0', platforms: ['mac'], changelog: '## [1.0.0]\n### Added\n- x' }) as string;
    expect(mac).toMatch(/^> \*\*This release is for macOS\.\*\* Windows and Linux follow in a later release/);
    expect(mac).toContain('Open Anyway');
    expect(mac).toContain('Always Allow');
    expect(mac).not.toContain('install.ps1');
    const all = buildNotes({ version: '1.0.0', changelog: '## [1.0.0]\n### Added\n- x' }) as string;
    expect(all).not.toContain('This release is for');
    expect(all).toContain('install.ps1');
    const beta = buildNotes({ version: '1.1.0-beta.1', changelog: '' }) as string;
    expect(beta).toContain('Keeper 1.1.0-beta.1');
    expect(beta).toContain('| sh -s -- --beta');
  });

  it('stays under GitHub\'s size limit', () => {
    const huge = buildNotes({ version: '2.0.0', changelog: `## [2.0.0]\n${long(400)}` }) as string;
    expect(huge.length).toBeLessThan(125_000);
    expect(huge).toContain('the rest is in [CHANGELOG.md]');
    expect((huge.match(/<details>/g) ?? []).length).toBe((huge.match(/<\/details>/g) ?? []).length);
    expect(huge.trimEnd()).toMatch(/SECURITY\.md\)\.$/);
  });

  it('the 1.0.0 notes are a hand-written summary grouped by area', () => {
    const text = readFileSync(path.join(ROOT, '.github/release-notes/1.0.0.md'), 'utf8');
    expect(text.match(/^### /gm)?.length).toBeGreaterThanOrEqual(6);
    expect(text).toContain('0.1.0-beta.7');
  });
});
