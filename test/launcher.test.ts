// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { calculate, formatCalc } from '../core/launcher/calc';
import { cleanBook, decayed, HALF_LIFE_MS, MAX_ENTRIES, recordUse, useBonus } from '../core/launcher/frecency';
import { buildLink, commandLine, defaultLauncher, homeCurrency, linkAllowed, matchCommandKeywords, matchLinks, normalizeLauncher, shellQuote, type QuickLink, type UserCommand } from '../core/launcher/links';
import { appNameFromPath, dedupeApps, execArgv, isNoiseShortcut, parseDesktopEntry } from '../core/launcher/apps';
import { availableActions, LAUNCH_ACTIONS } from '../core/launcher/actions';
import { LAUNCH_KINDS, topLaunchHits, type EverythingHit } from '../core/search-everything';

describe('Quick Search sums', () => {
  const v = (s: string) => calculate(s)?.value;
  it('does arithmetic with the usual order', () => {
    expect(v('2+3*4')).toBe(14);
    expect(v('(2+3)*4')).toBe(20);
    expect(v('2^10')).toBe(1024);
    expect(v('2**3**2')).toBe(512);
    expect(v('-3^2')).toBe(-9);
    expect(v('10/4')).toBe(2.5);
    expect(v('7 % 3')).toBe(1);
    expect(v('5!')).toBe(120);
    expect(v('1,234 + 1')).toBe(1235);
    expect(v('1e3 / 8')).toBe(125);
    expect(v('12 × 3 ÷ 4')).toBe(9);
  });
  it('knows percentages', () => {
    expect(v('15% of 80')).toBe(12);
    expect(v('120 + 15%')).toBeCloseTo(138);
    expect(v('200 - 10%')).toBeCloseTo(180);
    expect(v('50 * 10%')).toBeCloseTo(5);
  });
  it('knows functions and constants, with or without brackets', () => {
    expect(v('sqrt(16)')).toBe(4);
    expect(v('sqrt 2')).toBeCloseTo(Math.SQRT2);
    expect(v('2pi')).toBeCloseTo(Math.PI * 2);
    expect(v('max(3, 9, 4) + 1')).toBe(10);
    expect(v('round(2.5)')).toBe(3);
    expect(v('= 6*7')).toBe(42);
  });
  it('leaves what is not a sum alone, and never runs anything', () => {
    for (const s of ['2024', 'photoshop', 'report 2024', '-5', 'alert(1)', 'process.exit()', '1 +', '(1+2', 'x * 2', 'notes.md', '', 'sqrt', '1/0']) expect(calculate(s), s).toBeUndefined();
  });
  it('shows answers cleanly', () => {
    expect(calculate('0.1+0.2')?.text).toBe('0.3');
    expect(calculate('1000000*3')?.text).toBe('3,000,000');
    expect(formatCalc(1 / 3)).toBe('0.3333333333');
    expect(formatCalc(2 ** 60)).toMatch(/e\+18$/);
  });
});

describe('what you opened before', () => {
  const now = 1_700_000_000_000;
  it('counts uses that fade by half every two weeks', () => {
    let b = recordUse({}, 'app:a', now);
    b = recordUse(b, 'app:a', now);
    expect(decayed(b['app:a'], now)).toBe(2);
    expect(decayed(b['app:a'], now + HALF_LIFE_MS)).toBeCloseTo(1);
    expect(useBonus(b, 'app:a', now)).toBeGreaterThan(useBonus(recordUse({}, 'app:a', now - 60 * 86_400_000), 'app:a', now));
    expect(useBonus(b, 'never', now)).toBe(0);
  });
  it('a habit never outweighs a much better match', () => {
    let b = {};
    for (let i = 0; i < 500; i++) b = recordUse(b, 'x', now);
    expect(useBonus(b, 'x', now)).toBeLessThanOrEqual(8);
  });
  it('keeps at most a few hundred, dropping the weakest', () => {
    let b = {};
    for (let i = 0; i < MAX_ENTRIES + 20; i++) b = recordUse(b, `id${i}`, now + i);
    expect(Object.keys(b)).toHaveLength(MAX_ENTRIES);
    expect('id0' in b).toBe(false);
  });
  it('reads a saved file leniently', () => {
    expect(cleanBook({ a: { score: 1, at: 2 }, b: { score: 'x' }, c: null })).toEqual({ a: { score: 1, at: 2 } });
    expect(cleanBook('nonsense')).toEqual({});
  });
});

describe('saved links and your commands', () => {
  const links: QuickLink[] = [
    { id: 'm', keyword: 'map', name: 'Map', url: 'https://maps.example/?q={query}' },
    { id: 'h', keyword: 'home', name: 'Home page', url: 'https://example.org' },
    { id: 'bad', keyword: 'evil', name: 'Evil', url: 'javascript:alert(1)' },
  ];
  it('match their word and fill in the rest, encoded', () => {
    const [m] = matchLinks('Map  café & co', links);
    expect(m.link.id).toBe('m');
    expect(buildLink(m.link, m.query)).toBe('https://maps.example/?q=caf%C3%A9%20%26%20co');
    expect(matchLinks('home', links)[0].link.id).toBe('h');
    expect(matchLinks('mapping', links)).toEqual([]);
  });
  it('open only web, mail and Keeper addresses', () => {
    expect(matchLinks('evil x', links)).toEqual([]);
    expect(buildLink(links[2], 'x')).toBeUndefined();
    expect(linkAllowed('keeper://awake?for=1h')).toBe(true);
    expect(linkAllowed('mailto:a@b.c')).toBe(true);
    expect(linkAllowed('file:///etc/passwd')).toBe(false);
  });
  it('quote what you type as one piece for the shell', () => {
    expect(shellQuote(`it's; rm -rf ~`, 'linux')).toBe(`'it'\\''s; rm -rf ~'`);
    expect(shellQuote('a "b" %PATH%', 'win32')).toBe('"a ""b"" PATH"');
    const cmd: UserCommand = { id: 'c', name: 'Say', keyword: 'say', command: 'say {query}', confirm: true, output: 'none' };
    expect(commandLine(cmd, 'hello $(whoami)', 'darwin')).toBe(`say 'hello $(whoami)'`);
    expect(matchCommandKeywords('say hi there', [cmd])).toEqual([{ cmd, query: 'hi there' }]);
    expect(matchCommandKeywords('sayhi', [cmd])).toEqual([]);
  });
  it('settings from disk are cleaned and commands ask first unless told not to', () => {
    const n = normalizeLauncher({ calc: false, links: [{ keyword: 'w', url: 'https://w.example/{query}' }, { keyword: '', url: 'x' }], commands: [{ name: 'Up', command: 'uptime' }, { name: 'Quiet', command: 'true', confirm: false, output: 'copy' }, { name: '', command: 'x' }] });
    expect(n.calc).toBe(false);
    expect(n.currency).toBe(false);
    expect(n.links).toHaveLength(1);
    expect(n.links[0].name).toBe('w');
    expect(n.commands.map((c) => [c.name, c.confirm, c.output])).toEqual([['Up', true, 'none'], ['Quiet', false, 'copy']]);
    expect(normalizeLauncher(undefined)).toEqual(defaultLauncher());
    expect(defaultLauncher().currency).toBe(false);
  });
  it('knows the currency of the person’s region', () => {
    expect(homeCurrency('en-GB')).toBe('GBP');
    expect(homeCurrency('de_DE')).toBe('EUR');
    expect(homeCurrency('ja-JP')).toBe('JPY');
    expect(homeCurrency('en')).toBe('USD');
  });
});

describe('apps on each system', () => {
  const desktop = `[Desktop Entry]
Name=Text Editor
Name[de]=Texteditor
GenericName=Editor
Keywords=text;notes;
Exec=gnome-text-editor %U --new-window
Icon=org.gnome.TextEditor
Terminal=false
Type=Application

[Desktop Action new]
Name=New Window
Exec=other`;
  it('reads .desktop files in the person’s language', () => {
    const e = parseDesktopEntry(desktop, 'de_DE.UTF-8')!;
    expect(e.name).toBe('Texteditor');
    expect(e.keywords).toBe('text notes');
    expect(e.exec).toBe('gnome-text-editor %U --new-window');
    expect(e.hidden).toBe(false);
    expect(parseDesktopEntry(desktop.replace('Type=Application', 'Type=Link'))!.hidden).toBe(true);
    expect(parseDesktopEntry(desktop + '\n', 'en_US', 'KDE')!.hidden).toBe(false);
    expect(parseDesktopEntry(desktop.replace('Terminal=false', 'Terminal=false\nOnlyShowIn=GNOME;'), 'en_US', 'KDE')!.hidden).toBe(true);
    expect(parseDesktopEntry(desktop.replace('Terminal=false', 'NoDisplay=true'))!.hidden).toBe(true);
    expect(parseDesktopEntry('garbage')).toBeNull();
  });
  it('turns Exec lines into a program and arguments', () => {
    expect(execArgv('gnome-text-editor %U --new-window')).toEqual(['gnome-text-editor', '--new-window']);
    expect(execArgv('"/opt/My App/app" --name "a \\"b\\"" %f', { file: '/x' })).toEqual(['/opt/My App/app', '--name', 'a "b"', '/x']);
    expect(execArgv('app --icon-like %i %c', { icon: 'i', name: 'N' })).toEqual(['app', '--icon-like', '--icon', 'i', 'N']);
    expect(execArgv('printf 100%%')).toEqual(['printf', '100%']);
    expect(execArgv('"unclosed')).toBeUndefined();
    expect(execArgv('%U')).toBeUndefined();
  });
  it('names, noise and duplicates', () => {
    expect(appNameFromPath('/Applications/Visual Studio Code.app')).toBe('Visual Studio Code');
    expect(appNameFromPath('C:\\ProgramData\\Start Menu\\Firefox.lnk')).toBe('Firefox');
    expect(isNoiseShortcut('Uninstall Firefox')).toBe(true);
    expect(isNoiseShortcut('Firefox')).toBe(false);
    expect(dedupeApps([{ id: '2', name: 'Zed', path: '' }, { id: '1', name: 'zed', path: '' }, { id: '3', name: 'Atom', path: '' }]).map((a) => a.id)).toEqual(['3', '2']);
  });
});

describe('Keeper actions in Quick Search', () => {
  it('show only while their part is on', () => {
    const on = availableActions((f) => f !== 'capture', 'linux');
    expect(on.some((a) => a.feature === 'capture')).toBe(false);
    expect(on.some((a) => a.id === 'settings')).toBe(true);
    expect(availableActions(() => true, 'linux')).toHaveLength(LAUNCH_ACTIONS.length);
  });
  it('are Keeper links or named jobs, never both', () => {
    for (const a of LAUNCH_ACTIONS) {
      expect(!!a.link !== !!a.run, a.id).toBe(true);
      if (a.link) expect(a.link.startsWith('keeper://'), a.id).toBe(true);
    }
  });
});

describe('the launcher rows', () => {
  const h = (kind: EverythingHit['kind'], id: string, score: number): EverythingHit => ({ kind, id, title: id, route: '', score });
  it('put the answer first, then the best matches of every kind', () => {
    const out = topLaunchHits([h('mail', 'm', 99), h('app', 'weak', 2), h('action', 'strong', 9), h('answer', 'calc', 0), h('link', 'l', 9), h('app', 'best', 20)], 4);
    expect(out.map((x) => x.id)).toEqual(['calc', 'best', 'strong', 'l']);
    expect(LAUNCH_KINDS).toContain('app');
  });
});
