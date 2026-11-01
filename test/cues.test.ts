// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  anchorMatches, anchorsFor, checklistDone, complete, cueFromDraft, cuesFor, dueNow, leftPlace, nextOccurrence, nextWake, normalizeUrl, parseCueInput,
  progressOf, projectOf, purgeOld, shouldHint, siteOf, skipItem, snooze, softDelete, startRun, statusOf, templateFromCue, toggleItem, type Cue,
} from '../core/cues/model';
import { cueFileName, cueFromMarkdown, cueToMarkdown, exportMarkdown, idFromFileName, templateFromMarkdown, templateToMarkdown } from '../core/cues/markdown';
import { buildPhraseModel, counts, filterCues, searchCues, sections, suggest, whenText } from '../core/cues/dashboard';
import { normalizeCueSettings } from '../core/cues/api';

const NOW = new Date(2026, 9, 31, 10, 0, 0).getTime();
const mk = (p: Partial<Cue> = {}): Cue => ({ id: p.id ?? Math.random().toString(36).slice(2, 9), type: 'note', title: 't', body: '', anchors: [], show: 'every', done: false, createdAt: NOW - 1000, updatedAt: NOW - 1000, ...p });

describe('cue places', () => {
  it('normalises pages and sites', () => {
    expect(normalizeUrl('https://www.GitHub.com/a/b/?utm_source=x&z=1&a=2#frag')).toBe('https://github.com/a/b?a=2&z=1');
    expect(siteOf('https://www.docs.github.com/x')).toBe('docs.github.com');
    expect(siteOf('github.com/path')).toBe('github.com');
  });
  it('matches apps, sites, pages, titles and files', () => {
    expect(anchorMatches({ kind: 'app', value: 'Figma' }, { app: 'Figma' })).toBe(true);
    expect(anchorMatches({ kind: 'app', value: 'figma.exe' }, { app: 'Figma', appId: 'C:\\Apps\\Figma.exe' })).toBe(true);
    expect(anchorMatches({ kind: 'app', value: 'com.figma.Desktop' }, { app: 'Figma', appId: 'com.figma.Desktop' })).toBe(true);
    expect(anchorMatches({ kind: 'app', value: 'Code' }, { app: 'Xcode' })).toBe(false);
    expect(anchorMatches({ kind: 'site', value: 'github.com' }, { url: 'https://gist.github.com/x' })).toBe(true);
    expect(anchorMatches({ kind: 'site', value: 'github.com' }, { url: 'https://notgithub.com/' })).toBe(false);
    expect(anchorMatches({ kind: 'page', value: 'https://example.com/a?x=1' }, { url: 'https://www.example.com/a/?x=1#top' })).toBe(true);
    expect(anchorMatches({ kind: 'title', value: 'keeper island' }, { title: 'island.ts — Keeper — Island work' })).toBe(true);
    expect(anchorMatches({ kind: 'title', value: '/^PR #\\d+/' }, { title: 'PR #42 review' })).toBe(true);
    expect(anchorMatches({ kind: 'file', value: '/home/a/Budget.xlsx' }, { title: 'Budget.xlsx - Calc' })).toBe(true);
  });
  it('finds the project in a window title and offers anchors', () => {
    expect(projectOf({ app: 'Code', title: 'island.ts — keeper — Code' })).toBe('keeper');
    expect(projectOf({ app: 'Figma', title: 'Website redesign – Figma' })).toBe('Website redesign');
    expect(projectOf({ app: 'Notes', title: 'Notes' })).toBeUndefined();
    const offered = anchorsFor({ app: 'Chrome', url: 'https://github.com/a/b', title: 'Pull requests - Chrome' });
    expect(offered.map((a) => a.kind)).toEqual(['page', 'site', 'app', 'title']);
  });
});

describe('cue timing', () => {
  it('pops up in the right place, most specific first, with a cool-down', () => {
    const a = mk({ id: 'a', anchors: [{ kind: 'site', value: 'github.com' }] });
    const b = mk({ id: 'b', anchors: [{ kind: 'page', value: 'https://github.com/x' }] });
    const c = mk({ id: 'c', anchors: [{ kind: 'app', value: 'Figma' }] });
    const d = mk({ id: 'd', anchors: [{ kind: 'site', value: 'github.com' }], shownAt: NOW - 60_000 });
    const e = mk({ id: 'e', anchors: [{ kind: 'site', value: 'github.com' }], done: true });
    expect(cuesFor([a, b, c, d, e], { url: 'https://github.com/x', app: 'Chrome' }, NOW).map((x) => x.id)).toEqual(['b', 'a']);
    const once = mk({ id: 'o', show: 'once', anchors: [{ kind: 'app', value: 'Figma' }], shownAt: NOW - 3600_000, updatedAt: NOW - 7200_000 });
    expect(cuesFor([once], { app: 'Figma' }, NOW)).toEqual([]);
  });
  it('snoozes: for a while, or until the next visit', () => {
    const c = mk({ anchors: [{ kind: 'app', value: 'Figma' }] });
    const later = snooze(c, '1h', NOW);
    expect(later.snoozedUntil).toBe(NOW + 3600_000);
    expect(statusOf(later, NOW)).toBe('later');
    expect(cuesFor([later], { app: 'Figma' }, NOW)).toEqual([]);
    expect(cuesFor([later], { app: 'Figma' }, NOW + 3600_001).length).toBe(1);
    const next = snooze(c, 'nextvisit', NOW);
    expect(cuesFor([next], { app: 'Figma' }, NOW)).toEqual([]);
    const after = leftPlace([next], { app: 'Figma' });
    expect(cuesFor(after, { app: 'Figma' }, NOW).length).toBe(1);
    const tomorrow = snooze(c, 'tomorrow', NOW);
    expect(new Date(tomorrow.snoozedUntil!).getHours()).toBe(9);
  });
  it('rings once per due time; overdue snooze moves the time', () => {
    const c = mk({ due: NOW - 1000 });
    expect(dueNow([c], NOW).length).toBe(1);
    expect(dueNow([{ ...c, rangFor: c.due }], NOW)).toEqual([]);
    const moved = snooze(c, '10m', NOW);
    expect(moved.due).toBe(NOW + 600_000);
    expect(statusOf(c, NOW)).toBe('overdue');
    expect(nextWake([mk({ due: NOW + 5000 }), mk({ snoozedUntil: NOW + 2000 })], NOW)).toBe(NOW + 2000);
  });
  it('repeats come back with the checklist unticked', () => {
    const c = cueFromDraft({ title: 'Ship', body: '', type: 'checklist', items: ['a', 'b'], anchors: [], due: NOW - 1000, repeat: 'weekdays' }, NOW);
    const ticked = toggleItem(c, c.items![0].id, NOW);
    expect(progressOf(ticked)).toEqual({ done: 1, total: 2 });
    const next = complete(ticked, NOW);
    expect(next.done).toBe(false);
    expect(next.due! > NOW).toBe(true);
    expect([0, 6]).not.toContain(new Date(next.due!).getDay());
    expect(next.items!.every((i) => !i.done)).toBe(true);
    expect(complete(mk(), NOW).done).toBe(true);
    const fri = new Date(2026, 9, 30, 9).getTime();
    expect(new Date(nextOccurrence(fri, 'weekdays', fri)).getDay()).toBe(1);
    expect(new Date(nextOccurrence(fri, 'monthly', fri)).getMonth()).toBe(10);
  });
});

describe('typing a cue', () => {
  it('reads times, repeats, places and steps', () => {
    const a = parseCueInput('Send the invoice tomorrow 9am', NOW);
    expect(a.title).toBe('Send the invoice');
    expect(new Date(a.due!).getDate()).toBe(1);
    expect(new Date(a.due!).getHours()).toBe(9);
    const b = parseCueInput('@figma check comments', NOW);
    expect(b.anchors).toEqual([{ kind: 'app', value: 'figma', label: 'figma' }]);
    expect(b.title).toBe('check comments');
    const c = parseCueInput('review PRs on github.com every weekday', NOW);
    expect(c.anchors[0]).toMatchObject({ kind: 'site', value: 'github.com' });
    expect(c.repeat).toBe('weekdays');
    const d = parseCueInput('Release\n- tag\n- [ ] notes\n1. publish', NOW);
    expect(d.type).toBe('checklist');
    expect(d.items).toEqual(['tag', 'notes', 'publish']);
    const e = parseCueInput('https://example.com/a?utm_source=x', NOW);
    expect(e.type).toBe('link');
    expect(e.url).toBe('https://example.com/a');
    const f = parseCueInput('Just a thought', NOW);
    expect(f.due).toBeUndefined();
    expect(f.title).toBe('Just a thought');
    expect(parseCueInput('remind me to stretch in 30 minutes', NOW).due).toBe(NOW + 30 * 60_000);
  });
  it('reusable checklists with skipped steps', () => {
    const c = cueFromDraft({ title: 'Deploy', body: '', type: 'checklist', items: ['build', 'test', 'ship'], anchors: [{ kind: 'app', value: 'Terminal' }] }, NOW);
    const t = templateFromCue(c, 'Deploy', NOW);
    const run = startRun(t, NOW, { skip: [1] });
    expect(run.items!.map((i) => !!i.skipped)).toEqual([false, true, false]);
    let r = toggleItem(run, run.items![0].id, NOW);
    r = toggleItem(r, r.items![2].id, NOW);
    expect(checklistDone(r)).toBe(true);
    expect(checklistDone(skipItem(r, r.items![1].id, NOW))).toBe(false);
    expect(run.anchors).toEqual(c.anchors);
  });
});

describe('cue files', () => {
  it('round-trips through Markdown and keeps outside edits', () => {
    const c = cueFromDraft({ title: 'Check "quotes": yes', body: 'Line one\n\nLine two', type: 'checklist', items: ['first', 'second'], url: 'https://x.org/a', anchors: [{ kind: 'site', value: 'x.org', label: 'x.org' }, { kind: 'app', value: 'com.x.App', label: 'X App' }], due: NOW + 3600_000, repeat: 'weekly' }, NOW, { tags: ['work'] });
    const skipped = skipItem(c, c.items![1].id, NOW);
    const md = cueToMarkdown(skipped);
    expect(md).toMatch(/^---\nkeeper: "cue"/);
    expect(md).toContain('- [ ] ~~second~~');
    const back = cueFromMarkdown(md)!;
    expect(back).toMatchObject({ id: c.id, type: 'checklist', title: 'Check "quotes": yes', body: 'Line one\n\nLine two', url: 'https://x.org/a', due: c.due, repeat: 'weekly', tags: ['work'] });
    expect(back.anchors).toEqual(c.anchors);
    expect(back.items!.map((i) => [i.text, i.done, !!i.skipped])).toEqual([['first', false, false], ['second', false, true]]);
    const edited = md.replace('- [ ] first', '- [x] first').replace('# Check', '# Edited check');
    const e = cueFromMarkdown(edited)!;
    expect(e.items![0].done).toBe(true);
    expect(e.title).toBe('Edited check "quotes": yes');
    expect(cueFromMarkdown('# not a cue')).toBeNull();
  });
  it('names files safely and finds the id again', () => {
    const c = mk({ id: 'abc123xyz', title: 'a/b: c?*', createdAt: NOW });
    const name = cueFileName(c);
    expect(name).toBe('2026-10-31 a b c (abc123xyz).md');
    expect(idFromFileName(name)).toBe('abc123xyz');
  });
  it('templates as Markdown, and an export of everything', () => {
    const t = { id: 'tpl1', name: 'Morning', items: ['mail', 'standup'], createdAt: NOW };
    expect(templateFromMarkdown(templateToMarkdown(t))).toMatchObject({ id: 'tpl1', name: 'Morning', items: ['mail', 'standup'] });
    expect(exportMarkdown([mk({ title: 'A' }), mk({ title: 'B', deletedAt: NOW })])).toContain('# A');
    expect(exportMarkdown([mk({ title: 'B', deletedAt: NOW })])).not.toContain('# B');
  });
});

describe('dashboard', () => {
  const list = [
    mk({ id: '1', title: 'Pay rent', due: NOW - 1000 }),
    mk({ id: '2', title: 'Review design', anchors: [{ kind: 'app', value: 'Figma', label: 'Figma' }] }),
    mk({ id: '3', title: 'Read later', type: 'link', url: 'https://a.b', due: NOW + 2 * 86_400_000 }),
    mk({ id: '4', title: 'Old', done: true }),
    mk({ id: '5', title: 'Gone', deletedAt: NOW - 31 * 86_400_000 }),
  ];
  it('filters, counts and searches', () => {
    expect(filterCues(list, { filter: 'overdue', now: NOW }).map((c) => c.id)).toEqual(['1']);
    expect(filterCues(list, { filter: 'waiting', now: NOW }).map((c) => c.id)).toEqual(['2']);
    expect(filterCues(list, { filter: 'link', now: NOW }).map((c) => c.id)).toEqual(['3']);
    expect(filterCues(list, { sort: 'due', now: NOW }).map((c) => c.id)).toEqual(['1', '3', '2']);
    expect(counts(list, NOW)).toMatchObject({ all: 3, done: 1, deleted: 1, overdue: 1 });
    expect(searchCues(list, 'figma').map((c) => c.id)).toEqual(['2']);
    expect(searchCues(list, 'pay').map((c) => c.id)).toEqual(['1']);
    const s = sections(list, NOW);
    expect(s.today.map((c) => c.id)).toEqual(['1']);
    expect(s.upcoming.map((c) => c.id)).toEqual(['3']);
    expect(purgeOld(list, NOW).gone.map((c) => c.id)).toEqual(['5']);
    expect(softDelete(list[0], NOW).deletedAt).toBe(NOW);
    expect(whenText(NOW + 5 * 60_000, NOW)).toBe('in 5 min');
  });
  it('learns phrases for Tab completion', () => {
    const model = buildPhraseModel([mk({ title: 'check the pull requests' }), mk({ title: 'check the pull requests today' }), mk({ title: 'check email' })]);
    expect(suggest(model, 'check the ')).toBe('pull requests');
    expect(suggest(model, 'check the pu')).toBe('ll requests');
    expect(suggest(model, '')).toBe('');
  });
  it('hints once after time on a page and keeps settings in range', () => {
    expect(shouldHint({ dwellMs: 200_000, minDwellMs: 180_000, minGapMs: 3600_000, hasCue: false, url: 'https://a.b', now: NOW })).toBe(true);
    expect(shouldHint({ dwellMs: 200_000, minDwellMs: 180_000, minGapMs: 3600_000, hasCue: false, url: 'https://a.b', lastHintAt: NOW - 1000, now: NOW })).toBe(false);
    expect(shouldHint({ dwellMs: 200_000, minDwellMs: 180_000, minGapMs: 3600_000, hasCue: true, url: 'https://a.b', now: NOW })).toBe(false);
    expect(normalizeCueSettings({ textSize: 99, cooldownMin: -4 })).toMatchObject({ textSize: 28, cooldownMin: 0 });
  });
});
