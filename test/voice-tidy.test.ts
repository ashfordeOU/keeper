// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { formatAddresses, formatDates, formatNumbers, parseCardinal, tidyTimes } from '../core/voice/numbers';
import {
  applyCorrections, applyDictionary, applyScratch, appKind, closePairs, dictionaryPrompt, learnFromCorrection, matchSnippet, paragraphs, readySuggestions, removeFillers,
  resolveRules, stripArtifacts, tidy, wordCount, type TidyOptions,
} from '../core/voice/tidy';
import { defaultVoiceSettings } from '../core/voice/settings';

const prose: TidyOptions = { tone: 'neutral', mode: 'prose', commands: true, fillers: true, formatting: true };
const T = (s: string, o: Partial<TidyOptions> = {}) => tidy(s, { ...prose, ...o }).text;

describe('numbers, times, money, dates and addresses', () => {
  it('reads number words', () => {
    expect(parseCardinal(['twenty', 'three'])).toBe(23);
    expect(parseCardinal(['one', 'hundred', 'and', 'five'])).toBe(105);
    expect(parseCardinal(['two', 'thousand', 'twenty', 'six'])).toBe(2026);
    expect(parseCardinal(['a', 'million'])).toBe(1_000_000);
    expect(parseCardinal(['five', 'five'])).toBeNull();
  });
  it('writes figures with their context', () => {
    expect(formatNumbers('it costs twenty five dollars')).toBe('it costs $25');
    expect(formatNumbers('five dollars and fifty cents please')).toBe('$5.50 please');
    expect(formatNumbers('about fifty percent of them')).toBe('about 50% of them');
    expect(formatNumbers('ten euros')).toBe('€10');
    expect(formatNumbers('three point five kilos')).toBe('3.5 kilos');
    expect(formatNumbers('I have three cats')).toBe('I have three cats');
    expect(formatNumbers('there were twelve thousand five hundred people')).toBe('there were 12,500 people');
    expect(formatNumbers('back in nineteen eighty four')).toBe('back in 1984');
    expect(formatNumbers('in twenty twenty six')).toBe('in 2026');
    expect(formatNumbers('call five five five one two three four')).toBe('call 5551234');
    expect(formatNumbers('the twenty first century')).toBe('the 21st century');
    expect(formatNumbers('first of all')).toBe('first of all');
    expect(formatNumbers('five kg')).toBe('5 kg');
  });
  it('writes clock times', () => {
    expect(formatNumbers('meet at three thirty pm')).toBe('meet at 3:30 PM');
    expect(formatNumbers('at ten am tomorrow')).toBe('at 10 AM tomorrow');
    expect(formatNumbers("seven o'clock")).toBe('7:00');
    expect(formatNumbers('nine oh five pm')).toBe('9:05 PM');
    expect(tidyTimes('at 3.30 p.m. and 10 a.m.')).toBe('at 3:30 PM and 10 AM');
  });
  it('writes dates', () => {
    expect(formatDates(formatNumbers('on march third'))).toBe('on March 3');
    expect(formatDates(formatNumbers('the third of march'))).toBe('3 March');
    expect(formatDates('see you monday')).toBe('see you Monday');
  });
  it('writes emails and links', () => {
    expect(formatAddresses('write to anna dot lee at example dot com')).toBe('write to anna.lee@example.com');
    expect(formatAddresses('go to keeper dot app slash docs slash voice')).toBe('go to keeper.app/docs/voice');
    expect(formatAddresses('visit www dot example dot org')).toBe('visit www.example.org');
    expect(formatAddresses('mail j underscore doe at mail.example.com')).toBe('mail j_doe@mail.example.com');
  });
});

describe('fillers, false starts and corrections', () => {
  it('removes fillers and stutters', () => {
    expect(removeFillers('Um, I think, uh, we should go')).toBe('I think, we should go');
    expect(removeFillers('I I think the the plan works')).toBe('I think the plan works');
    expect(removeFillers('It was very very good')).toBe('It was very very good');
  });
  it('honours scratch that', () => {
    expect(applyScratch('Send it today. Actually wait scratch that')).toBe('Send it today.');
    expect(applyScratch('Hello there. Send the report scratch that send the slides.')).toBe('Hello there. send the slides.');
    expect(T('Let us meet Friday scratch that let us meet Monday')).toBe('Let us meet Monday.');
  });
  it('keeps only the corrected value', () => {
    expect(applyCorrections('see you at 3 PM, no wait, 4 PM')).toBe('see you at 4 PM');
    expect(applyCorrections('on Tuesday I mean Wednesday')).toBe('on Wednesday');
    expect(T('book it for three pm no wait four pm')).toBe('Book it for 4 PM.');
    expect(applyCorrections('I mean it, really')).toBe('I mean it, really');
  });
});

describe('spoken commands', () => {
  it('punctuation and structure', () => {
    expect(T('hello comma how are you question mark')).toBe('Hello, how are you?');
    expect(T('Hello, comma, how are you? Question mark.')).toBe('Hello, how are you?');
    expect(T('first line new line second line')).toBe('First line\nSecond line');
    expect(T('dear team new paragraph thanks for coming')).toBe('Dear team\n\nThanks for coming');
    expect(T('wait for it period then go exclamation mark')).toBe('Wait for it. Then go!');
    expect(T('the end colon done')).toBe('The end: done');
  });
  it('symbols and pairs, and closes what was left open', () => {
    expect(T('send it to me open paren today close paren')).toBe('Send it to me (today).');
    expect(T('price in dollar sign 5')).toBe('Price in $5');
    expect(T('use hashtag keeper')).toBe('Use #keeper');
    expect(closePairs('a note (more later')).toBe('a note (more later)');
    expect(T('he said open quote hello')).toBe('He said “hello”');
  });
  it('case commands', () => {
    expect(T('call it camel case user name field', { mode: 'exact', tone: 'verbatim' })).toBe('call it userNameField');
    expect(T('snake case max retry count', { mode: 'exact', tone: 'verbatim' })).toBe('max_retry_count');
    expect(T('kebab case main menu', { mode: 'exact', tone: 'verbatim' })).toBe('main-menu');
    expect(T('this is all caps very important end caps ok', { tone: 'verbatim' })).toBe('this is VERY IMPORTANT ok');
  });
  it('"literally" types the word', () => {
    expect(T('type literally comma here')).toBe('Type comma here');
  });
  it('emoji by name', () => {
    expect(T('great job thumbs up emoji')).toBe('Great job 👍');
    expect(T('ship it rocket emoji')).toBe('Ship it 🚀');
  });
  it('commands off: words stay words', () => {
    expect(T('a comma is a mark', { commands: false })).toBe('A comma is a mark.');
  });
  it('exact mode for shells', () => {
    expect(T('git commit dash m fix', { mode: 'exact', tone: 'verbatim' })).toBe('git commit -m fix');
    expect(T('open index dot html', { mode: 'exact', tone: 'verbatim' })).toBe('open index.html');
    expect(T('cd tilde slash projects', { mode: 'exact', tone: 'verbatim' })).toBe('cd ~/projects');
  });
});

describe('tone, dictionary, snippets and paragraphs', () => {
  it('tones', () => {
    expect(T('yeah sounds good see you there', { tone: 'casual' })).toBe('Yeah sounds good see you there');
    expect(T('yeah we are gonna ship it ok', { tone: 'professional' })).toBe('Yes we are going to ship it OK.');
    expect(T('um so this stays', { tone: 'verbatim' })).toBe('um so this stays');
  });
  it('dictionary fixes words and spelling', () => {
    const dict = [{ id: '1', word: 'Keeper', heard: ['keep her'] }, { id: '2', word: 'PostgreSQL', heard: ['postgres sequel'] }];
    expect(applyDictionary('I use keep her with postgres sequel', dict)).toBe('I use Keeper with PostgreSQL');
    expect(T('ask keep her about postgresql', { dictionary: dict })).toBe('Ask Keeper about PostgreSQL.');
    expect(dictionaryPrompt([...dict, { id: '3', word: 'Nope', suggested: true }])).toBe('Keeper, PostgreSQL');
  });
  it('snippets are typed exactly, said a little differently is fine', () => {
    const snippets = [{ id: 's', trigger: 'my address', text: '12 High Street, Tallinn' }];
    expect(matchSnippet('My address.', snippets)?.id).toBe('s');
    expect(matchSnippet('my adress', snippets)?.id).toBe('s');
    expect(matchSnippet('my whole address book', snippets)).toBeUndefined();
    expect(tidy('My address.', { ...prose, snippets }).text).toBe('12 High Street, Tallinn');
    expect(T('ship to snippet my address please', { snippets })).toBe('Ship to 12 High Street, Tallinn please.');
  });
  it('adds paragraph breaks in long takes', () => {
    const s = 'We met the client today. They liked the plan. The budget is fine. They want the first draft soon. We agreed on the scope. Also we need to hire a designer. That will take a month. We should start now. Everyone agreed it was a good idea and we will move quickly from here on with it.';
    const out = paragraphs(s);
    expect(out).toContain('\n\nAlso we need');
    expect(paragraphs('Short one. Two.')).toBe('Short one. Two.');
  });
  it('strips sound notes', () => {
    expect(stripArtifacts('[BLANK_AUDIO] hello (music) ♪')).toBe('hello');
    expect(tidy('[BLANK_AUDIO]', prose).text).toBe('');
  });
  it('counts words', () => {
    expect(wordCount('Hello, there — 3 cats!')).toBe(4);
  });
});

describe('per-app rules', () => {
  const rules = defaultVoiceSettings('darwin').apps;
  it('works out the tone and mode for the app in front', () => {
    expect(resolveRules('Terminal', rules, { tone: 'auto', commands: 'everywhere' })).toMatchObject({ tone: 'verbatim', mode: 'exact', commands: true });
    expect(resolveRules('Slack', rules, { tone: 'auto', commands: 'everywhere' })).toMatchObject({ tone: 'casual', mode: 'prose' });
    expect(resolveRules('Notes', rules, { tone: 'auto', commands: 'editors' })).toMatchObject({ tone: 'neutral', commands: false });
    expect(resolveRules('Alacritty', [], { tone: 'auto', commands: 'editors' })).toMatchObject({ mode: 'exact', commands: true });
    expect(resolveRules('1Password 8', rules, { tone: 'auto', commands: 'off' }).rule?.exclude).toBe(true);
    expect(appKind('Cursor')).toBe('editor');
  });
});

describe('learning from corrections', () => {
  it('suggests a word after two corrections, never adds it alone', () => {
    let id = 0;
    let d = learnFromCorrection([], 'I talked to anya today', 'I talked to Anja today', () => String(++id));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ word: 'Anja', heard: ['anya'], suggested: true, uses: 1 });
    expect(readySuggestions(d)).toHaveLength(0);
    d = learnFromCorrection(d, 'anya said hi', 'Anja said hi', () => String(++id));
    expect(readySuggestions(d)).toHaveLength(1);
    expect(learnFromCorrection([], 'same text', 'same text', () => 'x')).toHaveLength(0);
  });
});
