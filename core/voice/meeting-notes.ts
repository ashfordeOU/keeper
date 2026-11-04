// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Your own notes, typed during a meeting, made into tidy notes with the
// transcript: each of your lines keeps your words and gains the moment in the
// call it was about; short lines are filled out from what was said there; the
// template's other sections (decisions, action items, blockers…) are filled
// from the transcript and marked as such. Templates per kind of meeting,
// picked from the calendar event's title. Pure.

import { clock, ruleNotes, toTxt, transcriptLines } from './meeting';
export { sectionsMarkdown } from './meeting';
import type { ActionItem, MeetingNoteItem, MeetingNotes, MeetingNoteSection, MeetingRecord, MeetingTemplate } from './types';

// ---------------------------------------------------------------- templates

/** The templates Keeper comes with. Their ids are stable; people can add their own. */
export const BUILTIN_TEMPLATES: MeetingTemplate[] = [
  { id: 'general', name: 'Any meeting', sections: ['Notes', 'Decisions', 'Action items'], match: [] },
  { id: 'one-on-one', name: '1:1', sections: ['How things are going', 'Topics', 'Feedback', 'Action items'], match: ['1:1', '1-1', '1on1', 'one on one', 'one-on-one', 'catch up', 'catch-up', 'check-in', 'check in'] },
  { id: 'standup', name: 'Standup', sections: ['Yesterday', 'Today', 'Blockers', 'Action items'], match: ['standup', 'stand-up', 'stand up', 'daily', 'scrum', 'sync-up'] },
  { id: 'interview', name: 'Interview', sections: ['About the candidate', 'Strengths', 'Concerns', 'Next steps'], match: ['interview', 'candidate', 'screening', 'hiring', 'recruit'] },
];

/** Built-in and your own templates together (yours win on the same id). */
export function allTemplates(custom: MeetingTemplate[] = []): MeetingTemplate[] {
  const mine = custom.filter((t) => t && t.id && t.name?.trim() && t.sections?.length);
  return [...BUILTIN_TEMPLATES.filter((b) => !mine.some((m) => m.id === b.id)), ...mine];
}

/** The template whose words appear in the event title; the general one otherwise. Your own templates are tried first. */
export function pickTemplate(title: string | undefined, templates: MeetingTemplate[], fallback = 'general'): MeetingTemplate {
  const t = ` ${(title ?? '').toLowerCase()} `;
  const ordered = [...templates.filter((x) => !BUILTIN_TEMPLATES.some((b) => b.id === x.id)), ...templates.filter((x) => BUILTIN_TEMPLATES.some((b) => b.id === x.id))];
  for (const tpl of ordered) {
    for (const w of tpl.match ?? []) {
      const word = w.trim().toLowerCase();
      if (!word) continue;
      // whole words only: "daily" in "Daily sync", not in "dailyreport"
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u');
      if (re.test(t)) return tpl;
    }
  }
  return templates.find((x) => x.id === fallback) ?? templates[0] ?? BUILTIN_TEMPLATES[0];
}

/** A blank pad for a template: a heading per section. */
export function templateSkeleton(t: MeetingTemplate): string {
  return t.sections.map((s) => `## ${s}\n- `).join('\n\n') + '\n';
}

/** True when the pad holds nothing but a template's headings and empty bullets. */
export function padIsEmpty(text: string | undefined): boolean {
  return !(text ?? '').split(/\r?\n/).some((l) => { const s = l.trim(); return s && !/^#{1,6}\s/.test(s) && !/^[-*•]\s*$/.test(s) && !/^-\s*\[\s?\]\s*$/.test(s); });
}

/** A template from the words people type in the editor: a name, sections separated by commas, words for the event title. */
export function templateFromInput(name: string, sections: string, match: string, id?: string): MeetingTemplate | null {
  const n = name.trim().slice(0, 40);
  const secs = sections.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  if (!n || !secs.length) return null;
  return { id: id || `custom-${n.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'template'}`, name: n, sections: secs, match: match.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12) };
}

// ---------------------------------------------------------------- your notes

export interface PadLine {
  /** the section heading it was typed under ('' before any heading) */
  section: string;
  text: string;
  /** "- [ ] …", "todo: …", "action: …" or "@name …" */
  action: boolean;
  owner?: string;
}

/** Reads the pad: headings ("## Topics", "Topics:") start a section; every other line is a point. */
export function parsePad(text: string | undefined): PadLine[] {
  const out: PadLine[] = [];
  let section = '';
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,6}\s+(.+)$/) ?? line.match(/^([^-*•\[].{0,40}):$/);
    if (h) { section = h[1].trim(); continue; }
    let t = line.replace(/^(?:[-*•]|\d+[.)])\s*/, '');
    let action = false;
    const box = t.match(/^\[( |x|X)?\]\s*/);
    if (box) { action = true; t = t.slice(box[0].length); }
    const tag = t.match(/^(?:todo|to do|action|ai)\s*[:\-–]\s*/i);
    if (tag) { action = true; t = t.slice(tag[0].length); }
    const at = t.match(/(?:^|\s)@([\p{L}][\p{L}\p{N}._-]*)/u);
    if (at) action = true;
    t = t.trim();
    if (!t) continue;
    out.push({ section, text: t, action, owner: at?.[1] });
  }
  return out;
}

// ---------------------------------------------------------------- matching to the transcript

const STOP = new Set('a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its just like me my no not of on or our out so that the their them then there they this to too up us was we were what when which who will with would you your yeah okay ok um uh really very also going get got let lets let\'s think know need maybe some about more one two'.split(' '));

/** The words that carry meaning (lower case, short stems), for matching your line to what was said. */
export function keywords(s: string): string[] {
  return [...new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => (w.length > 5 ? w.slice(0, 5) : w)))];
}

/** The transcript line that best matches one of your points, when one really does (two shared words, or one for a one-word point). */
export function bestLine(point: string, lines: { at: number; who: string; text: string }[]): { at: number; who: string; text: string; score: number } | undefined {
  const k = keywords(point);
  if (!k.length) return undefined;
  let best: { at: number; who: string; text: string; score: number; shared: number } | undefined;
  for (const l of lines) {
    const lk = new Set(keywords(l.text));
    const shared = k.filter((w) => lk.has(w)).length;
    if (!shared) continue;
    const score = shared / k.length + shared * 0.1;
    if (!best || score > best.score) best = { ...l, score, shared };
  }
  if (!best || best.shared < Math.min(2, k.length)) return undefined;
  return { at: best.at, who: best.who, text: best.text, score: best.score };
}

/** The sentence in a line that holds the most of the point's words (what a short note gets filled out with). */
function bestSentence(point: string, line: string): string {
  const k = keywords(point);
  const sentences = (line.match(/[^.!?]+[.!?]?/g) ?? [line]).map((s) => s.trim()).filter(Boolean);
  let best = sentences[0] ?? line;
  let n = -1;
  for (const s of sentences) {
    const sk = new Set(keywords(s));
    const c = k.filter((w) => sk.has(w)).length;
    if (c > n) { n = c; best = s; }
  }
  return best.length > 240 ? `${best.slice(0, 237)}…` : best;
}

const norm = (s: string) => s.trim().toLowerCase();
const sameSection = (a: string, b: string) => norm(a).replace(/s$/, '') === norm(b).replace(/s$/, '');

// ---------------------------------------------------------------- merging

/**
 * Tidy notes from your pad and the transcript, without any AI. Your words are
 * kept as you typed them (marked "you"); a short point gains the sentence it
 * was about; each point remembers when in the call it was said. Sections your
 * pad left empty are filled from the transcript (decisions, action items,
 * blockers) and marked "transcript".
 */
export function mergeNotes(m: MeetingRecord, pad: string | undefined, template: MeetingTemplate, at = Date.now()): MeetingNotes {
  const lines = transcriptLines(m);
  const mine = parsePad(pad);
  const rules = ruleNotes(m, at);
  const sections: MeetingNoteSection[] = template.sections.map((title) => ({ title, items: [] }));
  const sectionFor = (name: string): MeetingNoteSection => {
    if (!name) return sections.find((s) => !/action|next step/i.test(s.title)) ?? sections[0];
    let s = sections.find((x) => sameSection(x.title, name));
    if (!s) { s = { title: name, items: [] }; sections.push(s); }
    return s;
  };
  const actions: ActionItem[] = [];
  const actionSection = sections.find((s) => /action|next step/i.test(s.title));
  for (const p of mine) {
    const hit = bestLine(p.text, lines);
    const item: MeetingNoteItem = { text: p.text, from: 'you', ...(hit ? { at: hit.at, who: hit.who } : {}) };
    if (hit && p.text.split(/\s+/).length <= 5) {
      const s = bestSentence(p.text, hit.text);
      if (norm(s) !== norm(p.text)) item.detail = s;
    }
    if (p.action) {
      actions.push({ text: p.text.replace(/(?:^|\s)@[\p{L}][\p{L}\p{N}._-]*/u, '').trim() || p.text, owner: p.owner, from: 'you' });
      if (actionSection && !p.section) { actionSection.items.push(item); continue; }
    }
    sectionFor(p.section).items.push(item);
  }
  // What the transcript adds, in the sections your pad left empty.
  for (const s of sections) {
    if (s.items.length) continue;
    const title = s.title.toLowerCase();
    if (/decision|agreed|outcome/.test(title)) s.items = rules.decisions.map((d) => ({ text: d, from: 'transcript' as const, ...atOf(d, lines) }));
    else if (/blocker|risk|concern|issue/.test(title)) s.items = sentencesMatching(lines, /\b(block(?:ed|er|ing)?|stuck|waiting (?:on|for)|risk|worr(?:y|ied)|concern(?:ed)?|problem)\b/i).map((x) => ({ text: x.text, from: 'transcript' as const, at: x.at, who: x.who }));
  }
  // Action items said in the call that your pad doesn't already have.
  for (const a of rules.actions) {
    if (actions.some((x) => overlap(x.text, a.text) >= 0.5)) continue;
    actions.push({ ...a, from: 'transcript' });
  }
  if (actionSection) {
    for (const a of actions) if (a.from === 'transcript') actionSection.items.push({ text: a.text, from: 'transcript', ...atOf(a.text, lines), ...(a.owner ? { who: a.owner } : {}) });
  }
  const summary = summaryFrom(m, mine, lines, rules.summary);
  return { summary, decisions: sections.filter((s) => /decision/i.test(s.title)).flatMap((s) => s.items.map((i) => i.text)), actions: actions.slice(0, 20), sections, template: template.id, by: 'rules', at };
}

function overlap(a: string, b: string): number {
  const ka = keywords(a);
  const kb = new Set(keywords(b));
  return ka.length ? ka.filter((w) => kb.has(w)).length / ka.length : 0;
}

function atOf(text: string, lines: { at: number; who: string; text: string }[]): { at?: number } {
  const l = lines.find((x) => x.text.includes(text.slice(0, 40)));
  return l ? { at: l.at } : {};
}

function sentencesMatching(lines: { at: number; who: string; text: string }[], re: RegExp): { at: number; who: string; text: string }[] {
  const out: { at: number; who: string; text: string }[] = [];
  for (const l of lines) for (const s of l.text.match(/[^.!?]+[.!?]?/g) ?? []) if (re.test(s) && s.trim().split(/\s+/).length >= 4) out.push({ at: l.at, who: l.who, text: s.trim() });
  return out.slice(0, 6);
}

function summaryFrom(m: MeetingRecord, mine: PadLine[], lines: { who: string }[], fallback: string): string {
  if (!mine.length) return fallback;
  const who = [...new Set(lines.map((l) => l.who))];
  const head = `${clock(m.durationMs / 1000)}${who.length ? ` with ${who.join(', ')}` : ''}.`;
  const points = mine.filter((p) => !p.action).slice(0, 4).map((p) => p.text.replace(/[.;:,]+$/, ''));
  return points.length ? `${head} Covered: ${points.join('; ')}.` : head;
}

// ---------------------------------------------------------------- with an AI

const MAX_PROMPT_CHARS = 60_000;

/** What the AI is asked when you typed notes: keep your words, fill them out from the transcript, mark what came from it. */
export function mergePrompt(m: MeetingRecord, pad: string, template: MeetingTemplate): string {
  let t = toTxt(m);
  if (t.length > MAX_PROMPT_CHARS) t = t.slice(0, MAX_PROMPT_CHARS / 2) + '\n[…]\n' + t.slice(-MAX_PROMPT_CHARS / 2);
  return [
    'You turn a person\'s rough meeting notes into tidy notes, using the transcript. Reply with JSON only, no other text, in this shape:',
    '{"summary": "2 to 4 sentences", "sections": [{"title": "…", "items": [{"text": "…", "from": "you" or "transcript", "at": "m:ss or empty"}]}], "actions": [{"text": "…", "owner": "name or empty", "due": "date words or empty", "from": "you" or "transcript"}]}',
    `Use exactly these sections, in this order: ${template.sections.join(', ')}.`,
    'Keep every one of the person\'s points, in their words, marked "you"; you may complete a short point from the transcript. Add only what was actually said, marked "transcript". Use the language of the meeting.',
    m.event?.attendees.length ? `Attendees: ${m.event.attendees.join(', ')}` : '',
    `Meeting: ${m.title}`,
    '<notes>',
    pad.slice(0, 20_000),
    '</notes>',
    '<transcript>',
    t,
    '</transcript>',
  ].filter(Boolean).join('\n');
}

const toSec = (s: unknown): number | undefined => {
  const m = String(s ?? '').match(/^(?:(\d+):)?(\d+):(\d{2})$/);
  return m ? (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : undefined;
};

/** Reads the AI's merged notes; null when it did not answer in shape (Keeper then uses its own rules). */
export function parseMergeReply(reply: string, template: MeetingTemplate, by: string, at = Date.now()): MeetingNotes | null {
  const m = reply.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { summary?: unknown; sections?: unknown; actions?: unknown };
    if (!Array.isArray(j.sections)) return null;
    const sections: MeetingNoteSection[] = j.sections.map((s) => {
      const x = s as { title?: unknown; items?: unknown };
      const items = Array.isArray(x.items) ? x.items.map((i) => (typeof i === 'string' ? { text: i } : (i as { text?: unknown; from?: unknown; at?: unknown }))).map((i) => ({ text: String(i.text ?? '').trim(), from: i.from === 'transcript' ? 'transcript' as const : 'you' as const, ...(toSec((i as { at?: unknown }).at) !== undefined ? { at: toSec((i as { at?: unknown }).at) } : {}) })).filter((i) => i.text) : [];
      return { title: String(x.title ?? '').trim(), items };
    }).filter((s) => s.title);
    const actions: ActionItem[] = Array.isArray(j.actions)
      ? j.actions.map((a) => (typeof a === 'string' ? { text: a } : (a as Record<string, unknown>))).map((a) => ({ text: String(a.text ?? '').trim(), owner: String(a.owner ?? '').trim() || undefined, due: String(a.due ?? '').trim() || undefined, from: a.from === 'you' ? 'you' as const : 'transcript' as const })).filter((a) => a.text)
      : [];
    return { summary: String(j.summary ?? '').trim(), decisions: sections.filter((s) => /decision/i.test(s.title)).flatMap((s) => s.items.map((i) => i.text)), actions, sections, template: template.id, by, at };
  } catch {
    return null;
  }
}

/** The reminder an action item becomes: its words, and where it came from. */
export function reminderFor(a: ActionItem, m: Pick<MeetingRecord, 'title' | 'event'>): { title: string; notes: string } {
  return { title: a.text.slice(0, 200), notes: [`From “${m.title}”`, m.event ? `event: ${m.event.title}` : '', a.owner ? `owner: ${a.owner}` : '', a.due ? `due ${a.due}` : '', a.from === 'you' ? 'from your notes' : a.from === 'transcript' ? 'from the transcript' : ''].filter(Boolean).join(' · ') };
}
