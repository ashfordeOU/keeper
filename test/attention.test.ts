// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { CALM_WORD, calmOf, calmScore, pageSlice, rankAttention, worthLine } from '../core/attention';
import { attention } from '../core/home-layout';
import { scoreLabel } from '../core/security/score';
import { severityWord } from '../core/guide/group';

const GB = 1024 ** 3;

describe('one calm attention model', () => {
  it('three calm levels instead of five alarm colours', () => {
    expect(['critical', 'high', 'medium', 'low', 'info'].map(calmOf)).toEqual(['worth', 'worth', 'soon', 'fyi', 'fyi']);
    expect(Object.values(CALM_WORD).join(' ')).not.toMatch(/risk|danger|critical|urgent|alert/i);
  });

  it('ranks open items, most worth doing first, then by space freed, then by title', () => {
    const items = rankAttention([
      { id: 'a', title: 'B thing', severity: 'medium' },
      { id: 'b', title: 'A thing', severity: 'medium' },
      { id: 'c', title: 'Disk', severity: 'high', impactBytes: 1 },
      { id: 'd', title: 'Bigger', severity: 'high', impactBytes: 9 },
      { id: 'e', title: 'Tip', severity: 'info' },
      { id: 'f', title: 'Snoozed', severity: 'critical', status: 'snoozed' },
    ]);
    expect(items.map((i) => i.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(rankAttention([{ id: 'e', title: 'Tip', severity: 'info' }], { all: true })).toHaveLength(1);
  });

  it('filters by area or source, for a page that shows its own part', () => {
    const list = [{ id: 'x', title: 'x', severity: 'high', source: 'security', area: 'privacy' }, { id: 'y', title: 'y', severity: 'high', source: 'space', area: 'space' }];
    expect(rankAttention(list, { sources: ['security'] }).map((i) => i.id)).toEqual(['x']);
    expect(rankAttention(list, { areas: ['space'] }).map((i) => i.id)).toEqual(['y']);
  });

  it('Home shows one item and Privacy three, with the rest on the Fix-it List', () => {
    const items = rankAttention(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, title: id, severity: 'high' })));
    expect(pageSlice(items, 'home')).toMatchObject({ more: 4 });
    expect(pageSlice(items, 'home').shown).toHaveLength(1);
    expect(pageSlice(items, 'privacy').shown).toHaveLength(3);
    expect(pageSlice([], 'privacy')).toEqual({ shown: [], more: 0 });
  });

  it('says how many things are worth fixing in plain words', () => {
    expect(worthLine(0)).toBe('Nothing worth fixing');
    expect(worthLine(1)).toBe('1 thing worth fixing');
    expect(worthLine(3)).toBe('3 things worth fixing');
  });

  it('scores use calm words, never "at risk"', () => {
    expect(calmScore(95)).toBe('Well protected');
    expect(calmScore(75)).toBe('A few things to look at');
    expect(calmScore(10)).toBe('Some things to look at');
    for (const s of [0, 32, 49, 50, 69]) expect(scoreLabel(s)).not.toMatch(/risk|attention/i);
  });

  it('the Fix-it List, Home and Privacy use the same words', () => {
    expect(severityWord('high')).toBe(CALM_WORD.worth);
    expect(severityWord('medium')).toBe(CALM_WORD.soon);
  });

  it('Home’s low-space line is the Fix-it List’s own item, not a second alarm', () => {
    const a = attention({ disk: { free: 5 * GB, total: 256 * GB, label: 'Macintosh HD' }, findings: [{ id: 'space:low', title: 'Only 5 GB free', severity: 'critical' }, { id: 'f', title: 'FileVault is off', severity: 'high' }] }, (b) => `${Math.round(b / GB)} GB`)!;
    expect(a.title).toBe('Free up space on Macintosh HD');
    expect(a.title).not.toMatch(/nearly full/);
    expect(a.more).toBe(1);
  });
});
