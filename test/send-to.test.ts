// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { aiPrompt, backLine, backLink, cueFrom, eventWords, fileItem, filesItem, mailDraft, noteLine, taskFrom, verbForKey, verbsFor, VERBS, type SendItem } from '../core/send-to';
import { jargonIn } from '../core/settings-schema';

const mail: SendItem = { kind: 'mail', title: 'Invoice October', text: 'Please pay by Friday', link: 'keeper://mail/a%3Ab%3Ac' };
const all = () => true;

describe('Send to', () => {
  it('offers the same eight verbs, keyed 1 to 8, in plain words', () => {
    expect(VERBS.map((v) => v.id)).toEqual(['note', 'task', 'event', 'mail', 'device', 'ai', 'shelf', 'cue']);
    expect(VERBS.map((v) => v.key).join('')).toBe('12345678');
    expect(verbForKey('2')).toBe('task');
    for (const v of VERBS) expect(jargonIn(`${v.label} ${v.hint}`)).toEqual([]);
  });

  it('says why a verb cannot be used, instead of hiding it', () => {
    const v = verbsFor(mail, (f) => f !== 'notes');
    expect(v.find((x) => x.id === 'note')?.why).toBe('Notes is switched off');
    expect(v.find((x) => x.id === 'device')?.why).toBe('Only files can go there');
    expect(v.find((x) => x.id === 'shelf')?.why).toBe('Only files can go there');
    expect(v.find((x) => x.id === 'task')?.why).toBeUndefined();
    const f = verbsFor(fileItem('/home/a/photo.jpg'), all);
    expect(f.every((x) => !x.why)).toBe(true);
  });

  it('does not offer turning a task into a task or an event into an event', () => {
    expect(verbsFor({ kind: 'task', title: 'Call Ana' }, all).map((v) => v.id)).not.toContain('task');
    expect(verbsFor({ kind: 'event', title: 'Lunch' }, all).map((v) => v.id)).not.toContain('event');
  });

  it('keeps a line back to where it came from', () => {
    expect(backLine(mail)).toBe('from mail: Invoice October');
    expect(backLink(mail)).toBe('from mail: Invoice October (keeper://mail/a%3Ab%3Ac)');
    expect(taskFrom(mail)).toEqual({ title: 'Invoice October', notes: 'Please pay by Friday\nfrom mail: Invoice October (keeper://mail/a%3Ab%3Ac)', url: 'keeper://mail/a%3Ab%3Ac' });
    expect(noteLine(mail, '14:05')).toBe('- 14:05 Invoice October _(from mail: Invoice October (keeper://mail/a%3Ab%3Ac))_');
    expect(cueFrom(mail).body).toContain('from mail: Invoice October');
  });

  it('uses a clip’s own words as the title', () => {
    const c: SendItem = { kind: 'clip', title: 'Copied text', text: 'call the plumber\nabout the boiler' };
    expect(taskFrom(c).title).toBe('call the plumber about the boiler');
    expect(eventWords(c)).toBe('call the plumber about the boiler');
  });

  it('files go to mail as attachments and to notes as links', () => {
    const f = fileItem('/home/a/My file.pdf');
    expect(f).toMatchObject({ kind: 'file', title: 'My file.pdf', paths: ['/home/a/My file.pdf'] });
    expect(mailDraft(f)).toEqual({ subject: 'My file.pdf', body: 'from file: My file.pdf', attachments: ['/home/a/My file.pdf'] });
    expect(noteLine(f, '9:00')).toContain('[My file.pdf](keeper://open?path=%2Fhome%2Fa%2FMy%20file.pdf)');
    expect(filesItem(['/a', '/b']).title).toBe('2 files');
    expect(fileItem('/s.png', { screenshot: true }).kind).toBe('screenshot');
  });

  it('asks the AI about it with its words and files', () => {
    expect(aiPrompt(mail)).toBe('Help me with this mail: “Invoice October”.\n\nPlease pay by Friday');
    expect(aiPrompt(fileItem('/x/a.txt'))).toContain('Files: /x/a.txt.');
  });

  it('keeps long titles short', () => {
    const t = taskFrom({ kind: 'text', title: 'x', text: 'word '.repeat(100) });
    expect(t.title.length).toBeLessThanOrEqual(120);
    expect(t.title.endsWith('…')).toBe(true);
  });
});
