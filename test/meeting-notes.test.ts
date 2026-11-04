// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Your meeting notes merged with the transcript: templates, the pad, matching,
// what the transcript adds, the AI's answer, Markdown and reminders.

import { describe, expect, it } from 'vitest';
import { toMarkdown } from '../core/voice/meeting';
import { allTemplates, BUILTIN_TEMPLATES, bestLine, keywords, mergeNotes, mergePrompt, padIsEmpty, parseMergeReply, parsePad, pickTemplate, reminderFor, sectionsMarkdown, templateFromInput, templateSkeleton } from '../core/voice/meeting-notes';
import { defaultVoiceSettings, normalizeVoiceSettings } from '../core/voice/settings';
import type { MeetingRecord, MeetingTemplate } from '../core/voice/types';

const u = (id: string, start: number, speaker: string, text: string) => ({ id, start, end: start + 4, speaker, text, track: (speaker === 'me' ? 'mic' : 'system') as 'mic' | 'system' });
const meeting = (): MeetingRecord => ({
  id: 'm1', title: 'Weekly 1:1 with Anja', startedAt: Date.UTC(2026, 9, 5, 9), durationMs: 25 * 60_000,
  speakers: [{ id: 'me', label: 'You', track: 'mic', estimated: false }, { id: 's1', label: 'Anja Tamm', track: 'system', estimated: false }],
  utterances: [
    u('a', 10, 's1', 'The budget for the autumn campaign was approved by finance yesterday afternoon.'),
    u('b', 70, 'me', 'Great. We decided to move the launch to the second week of November.'),
    u('c', 130, 's1', 'I am blocked on the new logo files, still waiting on the design agency.'),
    u('d', 190, 'me', 'I will send the press kit to the printers by Friday.'),
    u('e', 250, 's1', 'Hiring for the support role is going well, three strong candidates so far.'),
  ],
  event: { id: 'e1', title: 'Weekly 1:1 with Anja', start: 0, end: 1, attendees: ['Anja Tamm'] },
});

describe('templates', () => {
  const all = allTemplates();
  it('picks the template from words in the event title', () => {
    expect(pickTemplate('Weekly 1:1 with Anja', all).id).toBe('one-on-one');
    expect(pickTemplate('Daily standup', all).id).toBe('standup');
    expect(pickTemplate('Interview: backend candidate', all).id).toBe('interview');
    expect(pickTemplate('Quarterly planning', all).id).toBe('general');
    expect(pickTemplate(undefined, all, 'standup').id).toBe('standup');
  });
  it('matches whole words only', () => {
    expect(pickTemplate('dailyreport review', all).id).toBe('general');
  });
  it('your own templates are tried first and can replace a built-in one', () => {
    const mine: MeetingTemplate = { id: 'plan', name: 'Planning', sections: ['Goals', 'Risks'], match: ['planning'] };
    const list = allTemplates([mine, { id: 'standup', name: 'Our standup', sections: ['Done', 'Next'], match: ['standup'] }]);
    expect(pickTemplate('Quarterly planning', list).id).toBe('plan');
    expect(list.filter((t) => t.id === 'standup')).toHaveLength(1);
    expect(pickTemplate('standup', list).name).toBe('Our standup');
  });
  it('a skeleton has a heading per section, and an untouched skeleton counts as empty', () => {
    const sk = templateSkeleton(BUILTIN_TEMPLATES[2]);
    expect(sk).toContain('## Yesterday');
    expect(sk).toContain('## Blockers');
    expect(padIsEmpty(sk)).toBe(true);
    expect(padIsEmpty(`${sk}- shipped the beta`)).toBe(false);
    expect(padIsEmpty('')).toBe(true);
    expect(padIsEmpty('- [ ] ')).toBe(true);
  });
  it('makes a template from the editor’s words', () => {
    expect(templateFromInput('Planning', 'Goals, Risks,  Owners', 'planning, roadmap')).toEqual({ id: 'custom-planning', name: 'Planning', sections: ['Goals', 'Risks', 'Owners'], match: ['planning', 'roadmap'] });
    expect(templateFromInput('', 'a', '')).toBeNull();
    expect(templateFromInput('X', ' , ', '')).toBeNull();
  });
  it('keeps only sound templates from saved settings', () => {
    const s = normalizeVoiceSettings({ meetings: { templates: [{ id: 'x', name: 'X', sections: ['A'] }, { id: 'bad', name: '', sections: [] }, null] } });
    expect(s.meetings.templates.map((t) => t.id)).toEqual(['x']);
    expect(defaultVoiceSettings().meetings.autoTemplate).toBe(true);
  });
});

describe('the pad', () => {
  it('reads headings, points and action items', () => {
    const p = parsePad('## Topics\n- budget\n* launch date\nRisks:\n- logo late\n- [ ] send press kit @Sam\ntodo: book the room\n\n1. hiring');
    expect(p.map((x) => x.section)).toEqual(['Topics', 'Topics', 'Risks', 'Risks', 'Risks', 'Risks']);
    expect(p[3]).toMatchObject({ text: 'send press kit @Sam', action: true, owner: 'Sam' });
    expect(p[4]).toMatchObject({ text: 'book the room', action: true });
    expect(p[5]).toMatchObject({ text: 'hiring', action: false });
  });
  it('keywords skip small words and fold endings', () => {
    expect(keywords('The budget was approved')).toEqual(['budge', 'appro']);
  });
  it('finds the transcript line a point is about, and none when nothing really matches', () => {
    const lines = [{ at: 10, who: 'Anja', text: 'The budget for the autumn campaign was approved.' }, { at: 70, who: 'You', text: 'Lunch is at noon.' }];
    expect(bestLine('budget approved', lines)?.at).toBe(10);
    expect(bestLine('budget', lines)?.at).toBe(10);
    expect(bestLine('quarterly roadmap', lines)).toBeUndefined();
    expect(bestLine('the and of', lines)).toBeUndefined();
  });
});

describe('merging', () => {
  const tpl = BUILTIN_TEMPLATES.find((t) => t.id === 'one-on-one')!;
  it('keeps your words, adds the moment and fills short points out from the call', () => {
    const n = mergeNotes(meeting(), '## Topics\n- budget approved\n- launch moved\n- hiring\n- [ ] press kit to printers', tpl, 5);
    const topics = n.sections!.find((s) => s.title === 'Topics')!;
    expect(topics.items.map((i) => i.text)).toEqual(['budget approved', 'launch moved', 'hiring', 'press kit to printers']);
    expect(topics.items.every((i) => i.from === 'you')).toBe(true);
    expect(topics.items[0].at).toBe(10);
    expect(topics.items[0].detail).toMatch(/autumn campaign was approved/);
    expect(topics.items[2].detail).toMatch(/three strong candidates/);
    expect(n.actions[0]).toMatchObject({ text: 'press kit to printers', from: 'you' });
    expect(n.template).toBe('one-on-one');
    expect(n.by).toBe('rules');
    expect(n.at).toBe(5);
  });
  it('fills empty sections from the transcript and marks them', () => {
    const n = mergeNotes(meeting(), '- budget approved', BUILTIN_TEMPLATES[0], 5);
    const dec = n.sections!.find((s) => s.title === 'Decisions')!;
    expect(dec.items[0]).toMatchObject({ from: 'transcript' });
    expect(dec.items[0].text).toMatch(/move the launch/);
    const acts = n.sections!.find((s) => s.title === 'Action items')!;
    expect(acts.items.some((i) => i.from === 'transcript' && /press kit/.test(i.text))).toBe(true);
    expect(n.decisions[0]).toMatch(/move the launch/);
    // your point goes to the first section that is not for actions
    expect(n.sections![0].items[0].text).toBe('budget approved');
  });
  it('blockers come from the call when you left them empty', () => {
    const n = mergeNotes(meeting(), '## Today\n- logo', BUILTIN_TEMPLATES.find((t) => t.id === 'standup')!, 5);
    const b = n.sections!.find((s) => s.title === 'Blockers')!;
    expect(b.items[0].text).toMatch(/blocked on the new logo/);
    expect(b.items[0].from).toBe('transcript');
  });
  it('an action item you typed is not repeated from the transcript', () => {
    const n = mergeNotes(meeting(), '- [ ] send the press kit to the printers', BUILTIN_TEMPLATES[0], 5);
    expect(n.actions.filter((a) => /press kit/.test(a.text))).toHaveLength(1);
  });
  it('a heading that is not in the template becomes its own section', () => {
    const n = mergeNotes(meeting(), '## Parking lot\n- office move', tpl, 5);
    expect(n.sections!.map((s) => s.title)).toContain('Parking lot');
  });
  it('the summary leads with your points', () => {
    expect(mergeNotes(meeting(), '- budget approved\n- launch moved', tpl, 5).summary).toMatch(/Covered: budget approved; launch moved/);
  });
});

describe('with an AI', () => {
  const tpl = BUILTIN_TEMPLATES[1];
  it('asks to keep your words and use the template’s sections', () => {
    const p = mergePrompt(meeting(), '- budget', tpl);
    expect(p).toContain('How things are going, Topics, Feedback, Action items');
    expect(p).toContain('<notes>\n- budget\n</notes>');
    expect(p).toContain('Anja Tamm');
  });
  it('reads its answer, forgiving fences, and marks where each point came from', () => {
    const reply = '```json\n{"summary":"Good.","sections":[{"title":"Topics","items":[{"text":"Budget approved","from":"you","at":"0:10"},{"text":"Logo late","from":"transcript"}]},{"title":"Decisions","items":["Launch moves"]}],"actions":[{"text":"Send press kit","owner":"You","from":"you"},"Book room"]}\n```';
    const n = parseMergeReply(reply, tpl, 'Ollama', 9)!;
    expect(n.sections![0].items[0]).toEqual({ text: 'Budget approved', from: 'you', at: 10 });
    expect(n.sections![0].items[1].from).toBe('transcript');
    expect(n.decisions).toEqual(['Launch moves']);
    expect(n.actions).toEqual([{ text: 'Send press kit', owner: 'You', due: undefined, from: 'you' }, { text: 'Book room', owner: undefined, due: undefined, from: 'transcript' }]);
    expect(n.by).toBe('Ollama');
    expect(parseMergeReply('no json here', tpl, 'x')).toBeNull();
    expect(parseMergeReply('{"summary":"x"}', tpl, 'x')).toBeNull();
  });
});

describe('the note and reminders', () => {
  it('Markdown has your sections, with transcript points marked', () => {
    const m = meeting();
    m.notes = mergeNotes(m, '## Topics\n- budget approved', BUILTIN_TEMPLATES[1], 5);
    const md = toMarkdown(m);
    expect(md).toContain('## Topics');
    expect(md).toContain('- budget approved [0:10]');
    expect(md).toMatch(/_\(from the transcript( \[\d+:\d+\])?\)_/);
    expect(md).not.toContain('## Decisions\n\n- None noted');
    expect(md).toContain('## Transcript');
    expect(sectionsMarkdown({ summary: '', decisions: [], actions: [], by: 'rules', at: 0, sections: [{ title: 'Empty', items: [] }] })).toContain('- Nothing noted');
  });
  it('a reminder says which meeting, event and person it came from', () => {
    const r = reminderFor({ text: 'Send the press kit', owner: 'Sam', due: 'Friday', from: 'you' }, meeting());
    expect(r.title).toBe('Send the press kit');
    expect(r.notes).toBe('From “Weekly 1:1 with Anja” · event: Weekly 1:1 with Anja · owner: Sam · due Friday · from your notes');
  });
});
