// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The visual budget's rules (core/design-budget.ts), the words for paths that
// replace raw ones in the interface (core/format.ts), and page names short
// enough for a title. test/e2e/design-budget.cjs applies the rules to the real app.
import { describe, expect, it } from 'vitest';
import { BUDGET, budgetReport, checkBudget, cutMidWord, rawPathsIn, soundsEmpty, toolbarsOf, words, type PageSnapshot, type SeenButton } from '../core/design-budget';
import { friendlyPath, friendlyPathsIn, programName } from '../core/format';
import { HUB_TABS, NAV_PAGES } from '../core/nav';
import { SECTIONS } from '../core/settings-schema';

const btn = (x: number, y: number, iconOnly = true, name = 'Do it', w = 28): SeenButton => ({ x, y, w, h: 28, iconOnly, name, where: 'test' });
const snap = (p: Partial<PageSnapshot>): PageSnapshot => ({ page: 'p', size: '1440x900', buttons: [], tabRows: [], primaries: [], clipped: [], texts: [], ...p });

describe('toolbarsOf', () => {
  it('groups buttons side by side in one row, and keeps rows and far-apart groups apart', () => {
    const rows = toolbarsOf([btn(0, 0), btn(32, 0), btn(64, 2), btn(400, 0), btn(0, 60)]);
    expect(rows.map((r) => r.length).sort()).toEqual([1, 1, 3]);
  });
  it('labelled buttons join the icons around them into one toolbar', () => {
    const rows = toolbarsOf([btn(0, 0), btn(32, 0, false, 'Share', 80), btn(116, 0), btn(148, 0)]);
    expect(rows).toHaveLength(1);
  });
});

describe('checkBudget', () => {
  it('passes a calm page', () => {
    expect(checkBudget(snap({ title: 'Clean Up', buttons: [btn(0, 0), btn(32, 0)], tabRows: [{ label: 'x', tabs: 6, where: '' }], primaries: [{ text: 'Review', where: '' }] }))).toEqual([]);
  });
  it('flags more than six tabs in view', () => {
    expect(checkBudget(snap({ tabRows: [{ label: 'Agents', tabs: 11, where: '' }] })).map((v) => v.rule)).toEqual(['tabs']);
  });
  it('flags a toolbar of more than five bare icons, but not five', () => {
    const six = Array.from({ length: 6 }, (_, i) => btn(i * 32, 0));
    expect(checkBudget(snap({ buttons: six })).map((v) => v.rule)).toEqual(['icon-buttons']);
    expect(checkBudget(snap({ buttons: six.slice(0, BUDGET.iconButtons) }))).toEqual([]);
  });
  it('flags an icon with no label or tooltip', () => {
    expect(checkBudget(snap({ buttons: [btn(0, 0, true, ' ')] })).map((v) => v.rule)).toEqual(['unnamed-icon']);
  });
  it('flags a second filled button', () => {
    expect(checkBudget(snap({ primaries: [{ text: 'Connect', where: 'a' }, { text: 'Connect', where: 'b' }] })).map((v) => v.rule)).toEqual(['primaries']);
  });
  it('flags a cut inside a word, not one between words', () => {
    expect(checkBudget(snap({ clipped: [{ text: 'Connect a cloud or server…', fits: 20, kind: 'row', where: '' }] })).map((v) => v.rule)).toEqual(['mid-word-cut']);
    expect(checkBudget(snap({ clipped: [{ text: 'Connect a cloud or server', fits: 19, kind: 'row', where: '' }] }))).toEqual([]);
  });
  it('flags raw paths and temporary folders, once each', () => {
    const v = checkBudget(snap({ texts: [{ text: 'Added to /tmp/tmp.s2NVxk/keeper-mail.desktop', where: 'a' }, { text: 'Added to /tmp/tmp.s2NVxk/keeper-mail.desktop', where: 'b' }] }));
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => x.rule === 'raw-path')).toBe(true);
  });
  it('flags long page titles', () => {
    expect(checkBudget(snap({ title: 'Everything about your computer today' })).map((v) => v.rule)).toEqual(['title-words']);
  });
  it('flags "No … yet" said outside the designed empty state', () => {
    expect(checkBudget(snap({ plainEmpties: [{ text: 'No accounts yet.', where: '' }] })).map((v) => v.rule)).toEqual(['plain-empty']);
    expect(checkBudget(snap({ plainEmpties: [{ text: 'No, keep it', where: '' }] }))).toEqual([]);
  });
  it('reports by page', () => {
    expect(budgetReport([])).toMatch(/within the visual budget/);
    const r = budgetReport(checkBudget(snap({ page: 'agents', tabRows: [{ label: 'Agents', tabs: 11, where: '.tabs' }] })));
    expect(r.split('\n')[0]).toBe('agents');
    expect(r).toContain('11 tabs');
  });
});

describe('cutMidWord', () => {
  it('is inside a word only when letters sit on both sides of the cut', () => {
    expect(cutMidWord('screenshots with wifi password', 26)).toBe(true);
    expect(cutMidWord('screenshots with wifi password', 21)).toBe(false);
    expect(cutMidWord('Ünïcödé wörds', 3)).toBe(true);
    expect(cutMidWord('short', 5)).toBe(false);
    expect(cutMidWord('short', 0)).toBe(false);
  });
});

describe('rawPathsIn', () => {
  it('finds paths on every system and temporary folders', () => {
    expect(rawPathsIn('kept in /Users/ana/Library/Keeper/Notes')).toEqual(['/Users/ana/Library/Keeper/Notes']);
    expect(rawPathsIn('C:\\Users\\ana\\AppData\\Local\\Temp\\x.txt').length).toBeGreaterThan(0);
    expect(rawPathsIn('in ~/.ssh/config')).toEqual(['~/.ssh/config']);
    expect(rawPathsIn('/var/folders/xy/T/abc').length).toBeGreaterThan(0);
  });
  it('leaves ordinary words, dates, web addresses and friendly paths alone', () => {
    for (const ok of ['Read/write', 'on 11/04/2026', 'https://example.com/a/b', 'Documents › Work', 'TCP/UDP', '1/2 done', 'and/or']) expect(rawPathsIn(ok), ok).toEqual([]);
  });
});

describe('words for paths', () => {
  const home = '/Users/ana';
  it('names folders under Home by their names', () => {
    expect(friendlyPath('/Users/ana', home)).toBe('Home');
    expect(friendlyPath('/Users/ana/', home)).toBe('Home');
    expect(friendlyPath('/Users/ana/Documents/Work', home)).toBe('Documents › Work');
    expect(friendlyPath('~/Pictures/Screenshots/', home)).toBe('Pictures › Screenshots');
    expect(friendlyPath('C:\\Users\\ana\\Documents', 'C:\\Users\\ana')).toBe('Documents');
  });
  it('names disks, temporary folders and system places plainly', () => {
    expect(friendlyPath('/Volumes/USB/Photos', home)).toBe('USB › Photos');
    expect(friendlyPath('/media/ana/STICK', home)).toBe('STICK');
    expect(friendlyPath('/tmp/tmp.s2NV/keeper-mail.desktop', home)).toBe('a temporary folder');
    expect(friendlyPath('/usr/local/share/ca-certificates', home)).toBe('share › ca-certificates');
    expect(friendlyPath('D:\\', '')).toBe('Drive D:');
    expect(friendlyPath('', home)).toBe('');
  });
  it('rewrites every path in a sentence and keeps its full stop', () => {
    expect(friendlyPathsIn('Move to ~/Pictures/Screenshots/.', home)).toBe('Move to Pictures › Screenshots.');
    expect(friendlyPathsIn('Copy to /Users/ana/Backups and keep and/or delete', home)).toBe('Copy to Backups and keep and/or delete');
  });
  it('names the program a command runs', () => {
    expect(programName('"/opt/Keeper/keeper" --hidden')).toBe('keeper');
    expect(programName('C:\\Program Files\\Teams\\Teams.exe --quiet')).toBe('Teams');
    expect(programName('"C:\\Program Files\\Teams\\Teams.exe" --quiet')).toBe('Teams');
    expect(programName('/usr/bin/syncthing serve')).toBe('syncthing');
  });
});

describe('page names', () => {
  it('every page, tab and Settings section is a title of at most four words', () => {
    const long = [...NAV_PAGES.map((p) => p.label), ...Object.values(HUB_TABS).flat().map((t) => t.label), ...SECTIONS.map((s) => s.label)].filter((l) => words(l) > BUDGET.titleWords);
    expect(long).toEqual([]);
  });
  it('says empty in the words people expect', () => {
    expect(soundsEmpty('No backups yet')).toBe(true);
    expect(soundsEmpty('Nothing here.')).toBe(true);
    expect(soundsEmpty('Nothing to show')).toBe(true);
    expect(soundsEmpty('No, keep both')).toBe(false);
  });
});
