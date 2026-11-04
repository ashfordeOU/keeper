// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIONS, actionLink, appleScriptFor, automationDoc, parseDo, powershellCommandName, powershellModule, sendFromLink } from '../core/automation';
import { LINUX_ACTIONS } from '../electron/services/platform/dbus-actions';
import { jargonIn } from '../core/settings-schema';

describe('one list of actions', () => {
  it('has unique ids, plain words and a keeper:// link for each', () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
    for (const a of ACTIONS) {
      expect(jargonIn(`${a.title} ${a.what}`), a.id).toEqual([]);
      expect(a.link(a.example ?? {}), a.id).toMatch(/^keeper:\/\//);
    }
  });

  it('keeps the links the session bus always had', () => {
    expect(LINUX_ACTIONS.slice(0, 9).map((x) => x[0])).toEqual(['ask', 'search', 'open-page', 'focus', 'lock-all', 'automation', 'capture', 'awake', 'terminal']);
    expect(LINUX_ACTIONS.find((x) => x[0] === 'open-page')![3]!({ page: 'health' })).toBe('keeper://go?page=health');
    expect(LINUX_ACTIONS.find((x) => x[0] === 'focus')![3]!({ minutes: '10' })).toBe('keeper://focus?minutes=10');
    expect(LINUX_ACTIONS.map((x) => x[0])).toEqual(ACTIONS.map((a) => a.id));
  });

  it('checks arguments and says what is wrong in plain words', () => {
    expect(actionLink('focus', { minutes: 25 })).toEqual({ ok: true, link: 'keeper://focus?minutes=25' });
    expect(actionLink('focus', {})).toEqual({ ok: true, link: 'keeper://focus?minutes=25' });
    expect(actionLink('focus', { minutes: 999 })).toEqual({ ok: false, message: 'minutes must be a number from 0 to 240.' });
    expect(actionLink('format-disk', {})).toMatchObject({ ok: false, message: expect.stringContaining('No action called “format-disk”') });
    expect(actionLink('ask', {})).toEqual({ ok: false, message: 'Ask Keeper needs question (your question).' });
    expect(actionLink('focus', { colour: 'red' })).toEqual({ ok: false, message: 'Start a focus timer does not take “colour”. It takes: minutes.' });
    expect(actionLink('send.shelf', { path: 'relative/file.txt' })).toEqual({ ok: false, message: 'Give the full path of the file.' });
    expect(actionLink('send.task', { title: 'Call Ana & Bo' })).toEqual({ ok: true, link: 'keeper://send?to=task&title=Call%20Ana%20%26%20Bo' });
    expect(actionLink('catch', {})).toEqual({ ok: true, link: 'keeper://inbox' });
    expect(actionLink('settings', { section: 'accessibility' })).toEqual({ ok: true, link: 'keeper://settings/accessibility' });
  });

  it('reads keeper do’s words', () => {
    expect(parseDo(['focus', '--minutes', '25', '--json'])).toEqual({ id: 'focus', args: { minutes: '25' } });
    expect(parseDo(['ask', 'when is my passport due?'])).toEqual({ id: 'ask', args: { question: 'when is my passport due?' } });
    expect(parseDo(['send.task', '--title=Call Ana'])).toEqual({ id: 'send.task', args: { title: 'Call Ana' } });
  });

  it('turns a send link back into what the window sends, and refuses odd ones', () => {
    expect(sendFromLink('keeper://send?to=task&title=Call%20Ana')).toEqual({ verb: 'task', title: 'Call Ana' });
    expect(sendFromLink('keeper://send?to=shelf&path=%2Fhome%2Fa%2Fb.pdf')).toEqual({ verb: 'shelf', title: 'b.pdf', path: '/home/a/b.pdf' });
    expect(sendFromLink('keeper://send?to=event&title=Lunch&when=friday%201pm')).toEqual({ verb: 'event', title: 'Lunch', when: 'friday 1pm' });
    expect(sendFromLink('keeper://send?to=rm&title=x')).toBeNull();
    expect(sendFromLink('keeper://send?to=shelf&path=..%2Fetc')).toBeNull();
    expect(sendFromLink('keeper://send?to=task')).toBeNull();
    expect(sendFromLink('https://send?to=task&title=x')).toBeNull();
  });

  it('makes a PowerShell module with one command per action, values escaped', () => {
    const m = powershellModule('1.0.0');
    for (const a of ACTIONS) expect(m).toContain(`function ${powershellCommandName(a)} {`);
    expect(powershellCommandName(ACTIONS.find((a) => a.id === 'focus')!)).toBe('Start-KeeperFocus');
    expect(m).toContain('Open-KeeperLink "keeper://focus?minutes=$(Get-KeeperEscaped $Minutes)"');
    expect(m).toContain("[string]$Minutes = '25'");
    expect(m).toContain('Open-KeeperLink "keeper://send?to=task&title=$(Get-KeeperEscaped $Title)');
    expect(m).toMatch(/Export-ModuleMember -Function Invoke-KeeperAction, /);
    expect(m.includes('\r\n')).toBe(true);
    // Names are unique, so PowerShell loads every one.
    const names = ACTIONS.map(powershellCommandName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('writes AppleScript that opens the link', () => {
    expect(appleScriptFor('focus', { minutes: '25' })).toBe('tell application "Keeper" to open location "keeper://focus?minutes=25"');
    expect(() => appleScriptFor('nope')).toThrow(/No action called/);
  });
});

describe('the docs page', () => {
  it('docs/AUTOMATION.md lists every action, made from the list', () => {
    const file = path.resolve(__dirname, '../docs/AUTOMATION.md');
    const text = readFileSync(file, 'utf8');
    const block = `<!-- actions:start -->\n${automationDoc()}<!-- actions:end -->`;
    if (process.env.ACTIONS_DOC === 'write') writeFileSync(file, text.replace(/<!-- actions:start -->[\s\S]*<!-- actions:end -->/, block));
    expect(readFileSync(file, 'utf8')).toContain(block);
  });
});
