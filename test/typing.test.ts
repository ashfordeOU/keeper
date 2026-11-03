// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { appExcluded, countUse, defaultTyping, findAbbreviation, findSnippets, insertPlaceholder, needsClipboard, normalizeTyping, parseCsv, renderSnippet, shiftDate, snippetsFromCsv, snippetsToCsv, STARTER_SNIPPETS, TypedBuffer, validAbbr } from '../core/typing/expand';
import { keysymChar, LinuxKeyReader, parseTypedLine, parseXmodmap } from '../core/typing/keys';
import { PasteQueue, queueLabel } from '../core/paste-queue';
import { actionsFor, cleanReply, defaultSelection, linkIn, mailIn, normalizeSelection, searchLink, selectionPrompt, targetLanguage } from '../core/selection';
import { normalizeVoiceSettings } from '../core/voice/settings';
import { activitiesFrom } from '../core/island-activities';
import type { Snippet } from '../core/voice/types';

const snip = (abbr: string, text: string, trigger = ''): Snippet => ({ id: abbr, abbr, text, trigger });

describe('typed snippets: spotting an abbreviation', () => {
  it('keeps the last characters typed, and starts again at Enter or a click', () => {
    const b = new TypedBuffer(5);
    for (const c of 'abcdefg') b.feed({ t: 'char', c });
    expect(b.text).toBe('cdefg');
    b.feed({ t: 'back' });
    expect(b.text).toBe('cdef');
    b.feed({ t: 'reset' });
    expect(b.text).toBe('');
  });
  it('finds the longest abbreviation the text ends with', () => {
    const list = [snip(';a', 'A'), snip(';addr', '12 High Street'), snip('brb', 'be right back')];
    expect(findAbbreviation('see ;addr', list)?.text).toBe('12 High Street');
    expect(findAbbreviation('x;a', list)?.text).toBe('A');
    expect(findAbbreviation('ok brb', list)?.text).toBe('be right back');
    expect(findAbbreviation('brb', list)?.text).toBe('be right back');
    // letters at the start of an abbreviation count only at the start of a word
    expect(findAbbreviation('herbrb', list)).toBeUndefined();
    expect(findAbbreviation(';ad', list)).toBeUndefined();
    expect(findAbbreviation(';addr', [{ id: 'x', trigger: 'say', text: 'only said' }])).toBeUndefined();
  });
  it('checks abbreviations', () => {
    expect(validAbbr(';a')).toBe(true);
    expect(validAbbr('a')).toBe(false);
    expect(validAbbr('has space')).toBe(false);
    expect(validAbbr('x'.repeat(33))).toBe(false);
  });
});

describe('typed snippets: placeholders', () => {
  const now = new Date(2026, 10, 3, 14, 5); // Tue 3 Nov 2026, 14:05
  const ctx = { now, locale: 'en-US', clipboard: 'COPIED' };
  it('fill in dates, times and date maths', () => {
    expect(renderSnippet('{date iso}', ctx).text).toBe('2026-11-03');
    expect(renderSnippet('{date iso +1d}', ctx).text).toBe('2026-11-04');
    expect(renderSnippet('{date +1w iso}', ctx).text).toBe('2026-11-10');
    expect(renderSnippet('{date iso -1m}', ctx).text).toBe('2026-10-03');
    expect(renderSnippet('{date}', ctx).text).toBe('Nov 3, 2026');
    expect(renderSnippet('{date long}', ctx).text).toBe('November 3, 2026');
    expect(renderSnippet('{time 24h}', ctx).text).toBe('14:05');
    expect(renderSnippet('{time 24h +2h}', ctx).text).toBe('16:05');
    expect(renderSnippet('{weekday}', ctx).text).toBe('Tuesday');
    expect(renderSnippet('{weekday +1d}', ctx).text).toBe('Wednesday');
    expect(shiftDate(now, '+30min')!.getMinutes()).toBe(35);
    expect(shiftDate(now, 'soon')).toBeUndefined();
  });
  it('fill in the clipboard and say where the cursor goes', () => {
    const r = renderSnippet('Hi {cursor},\n{clipboard}', ctx);
    expect(r.text).toBe('Hi ,\nCOPIED');
    expect(r.cursorBack).toBe(',\nCOPIED'.length);
    expect(r.usedClipboard).toBe(true);
    expect(renderSnippet('no cursor', ctx).cursorBack).toBe(0);
    expect(needsClipboard('{ clipboard }')).toBe(true);
    expect(needsClipboard('{date}')).toBe(false);
  });
  it('use other snippets, braces, and leave unknown ones alone', () => {
    const list = [snip(';sig', 'Ana {date iso}'), snip(';loop', '{snippet ;loop}')];
    expect(renderSnippet('Thanks\n{snippet ;sig}', { ...ctx, snippets: list }).text).toBe('Thanks\nAna 2026-11-03');
    expect(renderSnippet('{snippet ;loop}', { ...ctx, snippets: list }).text).toBe('{snippet ;loop}');
    expect(renderSnippet('{{literal}} {nope} {date bogus}', ctx).text).toBe('{literal} {nope} {date bogus}');
    expect(renderSnippet('a { b', ctx).text).toBe('a { b');
  });
});

describe('typed snippets: lists and exclusions', () => {
  it('reads CSV files with quotes and line breaks, skipping headers, repeats and bad rows', () => {
    expect(parseCsv('a,"b, c"\n"x ""y""",z\r\n')).toEqual([['a', 'b, c'], ['x "y"', 'z']]);
    const csv = 'abbreviation,text,say\n;addr,"12 High St\nLondon",my address\n;addr,again\nx,too short\n;sig,Ana\n';
    let n = 0;
    const r = snippetsFromCsv(csv, [snip(';sig', 'old')], () => `n${n++}`);
    expect(r.added).toEqual([{ id: 'n0', abbr: ';addr', text: '12 High St\nLondon', trigger: 'my address' }]);
    expect(r.skipped).toBe(3);
  });
  it('leaves out password managers by default, by name', () => {
    expect(appExcluded('1Password 8', defaultTyping().excludeApps)).toBe(true);
    expect(appExcluded('TextEdit', defaultTyping().excludeApps)).toBe(false);
    expect(appExcluded(undefined, ['x'])).toBe(false);
    expect(normalizeTyping({ excludeApps: [' Code ', '', 3] })).toEqual({ excludeApps: ['Code'] });
  });
  it('one list with Dictation: typed-only snippets are kept, said-only ones too', () => {
    const v = normalizeVoiceSettings({ snippets: [{ id: '1', trigger: '', abbr: ';x', text: 'X' }, { id: '2', trigger: 'my address', text: 'A' }, { id: '3', trigger: '', text: 'nothing to say or type' }, { id: '4', trigger: '', abbr: 'bad abbr', text: 'Y' }] });
    expect(v.snippets.map((s) => s.id)).toEqual(['1', '2']);
    expect(v.snippets[1].abbr).toBeUndefined();
  });
});

describe('the key listeners', () => {
  it('read the macOS and Windows lines', () => {
    expect(parseTypedLine('t "é"')).toEqual({ t: 'char', c: 'é' });
    expect(parseTypedLine('t "\\""')).toEqual({ t: 'char', c: '"' });
    expect(parseTypedLine('k back')).toEqual({ t: 'back' });
    expect(parseTypedLine('k paste')).toEqual({ t: 'paste' });
    expect(parseTypedLine('k reset')).toEqual({ t: 'reset' });
    expect(parseTypedLine('ready')).toBeNull();
    expect(parseTypedLine('t nope')).toBeNull();
  });
  it('turn Linux key codes into characters, with Shift and Caps Lock', () => {
    const r = new LinuxKeyReader();
    const type = (code: number) => { const e = r.key(code, true); r.key(code, false); return e; };
    expect(type(39)).toEqual({ t: 'char', c: ';' });
    expect(type(30)).toEqual({ t: 'char', c: 'a' });
    r.key(42, true);
    expect(type(30)).toEqual({ t: 'char', c: 'A' });
    expect(type(3)).toEqual({ t: 'char', c: '@' });
    r.key(42, false);
    expect(type(58)).toBeNull();
    expect(type(30)).toEqual({ t: 'char', c: 'A' });
    expect(type(3)).toEqual({ t: 'char', c: '2' });
    expect(type(14)).toEqual({ t: 'back' });
    expect(type(28)).toEqual({ t: 'reset' });
    r.key(29, true);
    expect(r.key(47, true)).toEqual({ t: 'paste' });
    expect(r.key(46, true)).toEqual({ t: 'reset' });
  });
  it('follow the X server’s keyboard layout', () => {
    const layout = parseXmodmap('keycode  38 = a A a A\nkeycode  52 = y Y y Y\nkeycode  47 = odiaeresis Odiaeresis\nkeycode  10 = 1 exclam\nkeycode 9 = Escape NoSymbol Escape\nkeycode  66 = Caps_Lock');
    expect(layout.get(52)).toEqual(['y', 'Y']);
    expect(layout.get(47)).toEqual(['ö', 'Ö']);
    expect(layout.has(9)).toBe(false);
    const r = new LinuxKeyReader(layout);
    expect(r.key(44, true)).toEqual({ t: 'char', c: 'y' });
    expect(r.key(39, true)).toEqual({ t: 'char', c: 'ö' });
    expect(keysymChar('U00E9')).toBe('é');
    expect(keysymChar('BackSpace')).toBeUndefined();
  });
});

describe('paste one by one', () => {
  it('collects copies, then each paste takes the next', () => {
    const q = new PasteQueue();
    q.start();
    expect(q.collecting).toBe(true);
    expect(q.copied('a')).toBe(true);
    expect(q.copied('b')).toBe(true);
    expect(q.copied('a')).toBe(false);
    q.copied('c');
    expect(q.view()).toEqual({ left: 3, collecting: true, total: 3 });
    expect(q.peek()).toBe('a');
    expect(q.took()).toBe('b');
    expect(q.collecting).toBe(false);
    expect(q.copied('d')).toBe(false);
    expect(q.took()).toBe('c');
    expect(queueLabel(q.view()!)).toBe('Last one');
    expect(q.took()).toBeUndefined();
    expect(q.active).toBe(false);
    expect(q.view()).toBeUndefined();
  });
  it('starts with chosen clips, in that order, and drops removed ones', () => {
    const q = new PasteQueue();
    q.start(['x', 'y', 'x', 'z']);
    expect(q.items).toEqual(['x', 'y', 'z']);
    q.drop('y');
    expect(q.took()).toBe('z');
    expect(queueLabel({ left: 3, collecting: false })).toBe('3 left');
    q.stop();
    expect(q.active).toBe(false);
  });
  it('shows in the Island as how many are left', () => {
    const base = { shelf: [], shelves: [], activeShelf: '', closedShelves: [], clips: [], focus: { mode: 'idle' }, keepAwake: { on: false }, agents: [], events: [], alerts: [] } as never;
    const acts = activitiesFrom({ ...(base as object), pasteQueue: { left: 3, collecting: false, total: 5, next: 'Hello' } } as never, Date.now());
    const a = acts.find((x) => x.kind === 'paste-queue')!;
    expect(a.trailing).toBe('3 left');
    expect(a.detail).toBe('Hello');
    expect(activitiesFrom(base, Date.now()).some((x) => x.kind === 'paste-queue')).toBe(false);
  });
});

describe('the selection bar', () => {
  it('offers what fits the text', () => {
    const all = defaultSelection().actions;
    expect(actionsFor('https://example.com/a.', all, true)).toContain('open');
    expect(actionsFor('some words here', all, true)).not.toContain('open');
    expect(actionsFor('serendipity', all, true)).toContain('define');
    expect(actionsFor('a long sentence of many words', all, true)).not.toContain('define');
    expect(actionsFor('hello', all, false)).toEqual(['copy', 'search']);
    expect(actionsFor('ana@example.com', all, false)).toContain('mail');
    expect(actionsFor('   ', all, true)).toEqual([]);
  });
  it('finds links and addresses', () => {
    expect(linkIn('(www.example.org/x)')).toBe('https://www.example.org/x');
    expect(linkIn('not a link')).toBeUndefined();
    expect(mailIn('mailto:a@b.co.')).toBe('a@b.co');
    expect(searchLink('https://s.example/?q={query}', ' a&b ')).toBe('https://s.example/?q=a%26b');
  });
  it('asks the AI plainly and tidies its answer', () => {
    expect(selectionPrompt('translate', 'Hallo', 'English')).toMatch(/Translate this into English[\s\S]*<text>\nHallo\n<\/text>/);
    expect(selectionPrompt('define', 'tidy', 'French')).toMatch(/in French/);
    expect(cleanReply('Here is the translation: Hello')).toBe('Hello');
    expect(cleanReply('```\nHello\n```')).toBe('Hello');
    expect(targetLanguage('', 'de-DE')).toBe('German');
    expect(targetLanguage('Japanese', 'en-US')).toBe('Japanese');
  });
  it('settings from disk are cleaned', () => {
    const n = normalizeSelection({ shortcut: '', actions: ['copy', 'bogus', 'copy'], searchUrl: 'javascript:x' });
    expect(n.shortcut).toBe('');
    expect(n.actions).toEqual(['copy']);
    expect(n.searchUrl).toBe(defaultSelection().searchUrl);
  });
});

describe('typed snippets: the page', () => {
  it('exports a CSV file that imports back the same', () => {
    const list = [snip(';sig', 'Best,\n"Ana"', 'sign off'), snip(';x', 'a, b'), { id: 'said', trigger: 'hello', text: 'Hello' } as Snippet];
    const csv = snippetsToCsv(list);
    expect(csv.split('\r\n')[0]).toBe('abbreviation,text,say');
    const back = snippetsFromCsv(csv, [], () => 'n').added;
    expect(back.map((s) => [s.abbr, s.text, s.trigger])).toEqual([[';sig', 'Best,\n"Ana"', 'sign off'], [';x', 'a, b', '']]);
  });
  it('counts a use of the snippet that was typed', () => {
    const list = [snip(';a', 'A'), { ...snip(';b', 'B'), uses: 2 }];
    expect(countUse(list, ';b').map((s) => s.uses)).toEqual([undefined, 3]);
    expect(countUse(list, ';a')[0].uses).toBe(1);
    expect(countUse(list, ';zz')).toBe(list);
  });
  it('finds snippets by what is typed, said or written, most used first or by name', () => {
    const list = [{ ...snip(';b', 'Beta'), uses: 1 }, { ...snip('/a', 'Alpha', 'first'), uses: 5 }, snip(';c', 'Gamma')];
    expect(findSnippets(list, '').map((s) => s.abbr)).toEqual(['/a', ';b', ';c']);
    expect(findSnippets(list, '', 'name').map((s) => s.abbr)).toEqual(['/a', ';b', ';c']);
    expect(findSnippets(list, 'gam').map((s) => s.abbr)).toEqual([';c']);
    expect(findSnippets(list, 'FIRST').map((s) => s.abbr)).toEqual(['/a']);
  });
  it('puts a placeholder where the cursor is, replacing a selection', () => {
    expect(insertPlaceholder('Hi !', 3, 3, '{clipboard}')).toEqual({ text: 'Hi {clipboard}!', at: 14 });
    expect(insertPlaceholder('Hi there', 3, 8, '{cursor}')).toEqual({ text: 'Hi {cursor}', at: 11 });
    expect(insertPlaceholder('ab', 9, 9, '{date}')).toEqual({ text: 'ab{date}', at: 8 });
  });
  it('offers three starters that are valid and fill in', () => {
    expect(STARTER_SNIPPETS).toHaveLength(3);
    for (const s of STARTER_SNIPPETS) {
      expect(validAbbr(s.abbr)).toBe(true);
      expect(renderSnippet(s.text, { now: new Date(2026, 10, 3) }).text).not.toMatch(/\{/);
    }
  });
});
