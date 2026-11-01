// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Meetings: noticing a call, linking it to the calendar, writing the note
// (summary, decisions, action items, transcript) and exporting it as
// Markdown, subtitles (SRT, WebVTT) or plain text. Pure.

import type { ActionItem, MeetingNotes, MeetingRecord, Speaker, Utterance } from './types';

// ---------------------------------------------------------------- noticing a call

/** Apps that hold calls, as the system names them (process or app name, lower case, part is enough). */
export const MEETING_APPS: { match: RegExp; name: string }[] = [
  { match: /^zoom(\.us)?$|^cpthost|zoom meeting/i, name: 'Zoom' },
  { match: /teams|ms-teams/i, name: 'Microsoft Teams' },
  { match: /webex|ciscocollab/i, name: 'Webex' },
  { match: /^slack$/i, name: 'Slack' },
  { match: /^facetime$|avconferenced/i, name: 'FaceTime' },
  { match: /skype/i, name: 'Skype' },
  { match: /^discord/i, name: 'Discord' },
  { match: /gotomeeting|goto opener|^goto$/i, name: 'GoTo Meeting' },
  { match: /bluejeans/i, name: 'BlueJeans' },
  { match: /ringcentral/i, name: 'RingCentral' },
  { match: /chime/i, name: 'Amazon Chime' },
  { match: /^signal$/i, name: 'Signal' },
  { match: /whatsapp/i, name: 'WhatsApp' },
  { match: /^telegram/i, name: 'Telegram' },
  { match: /^element$/i, name: 'Element' },
  { match: /^lark$|^feishu$/i, name: 'Lark' },
  { match: /^tuple$/i, name: 'Tuple' },
  { match: /^around$/i, name: 'Around' },
];

/** Browser windows showing a meeting page (title text, or an address in the title). */
export const MEETING_PAGES: { match: RegExp; name: string }[] = [
  { match: /\bmeet\.google\.com\b|^meet\s*[-–—]\s*[a-z]{3}-[a-z]{4}-[a-z]{3}|google meet/i, name: 'Google Meet' },
  { match: /teams\.(microsoft|live)\.com|\|\s*microsoft teams|microsoft teams meeting/i, name: 'Microsoft Teams' },
  { match: /zoom\.us\/(wc|j)|zoom meeting|zoom workplace/i, name: 'Zoom' },
  { match: /whereby\.com|\bwhereby\b/i, name: 'Whereby' },
  { match: /meet\.jit\.si|jitsi meet/i, name: 'Jitsi Meet' },
  { match: /webex\.com\/(meet|wbxmjs)|webex meeting/i, name: 'Webex' },
  { match: /app\.slack\.com\/huddle|huddle/i, name: 'Slack huddle' },
  { match: /discord\.com\/channels.*voice|\bvoice connected\b/i, name: 'Discord' },
  { match: /\bwhatsapp\b.*\bcall\b/i, name: 'WhatsApp' },
];

const BROWSERS = /chrome|chromium|firefox|safari|edge|msedge|brave|opera|vivaldi|arc|orion|zen|librewolf|waterfox|epiphany|falkon/i;

export interface DetectInput {
  /** apps using the microphone right now */
  micApps: string[];
  /** open windows: app and title (the front one first) */
  windows: { app: string; title: string }[];
  /** calendar events happening now */
  events?: { title: string; start: number; end: number; url?: string; location?: string }[];
  extraApps?: string[];
  now: number;
}

export interface Detected { app: string; reason: string; event?: { title: string; start: number } }

/**
 * A call is going on when a meeting app (or a browser on a meeting page) has
 * the microphone. A meeting app merely running is not enough.
 */
export function detectMeeting(x: DetectInput): Detected | null {
  if (!x.micApps.length) return null;
  const extra = (x.extraApps ?? []).filter(Boolean).map((s) => s.toLowerCase());
  const event = x.events?.find((e) => e.start - 5 * 60_000 <= x.now && e.end >= x.now);
  const ev = event ? { title: event.title, start: event.start } : undefined;
  for (const raw of x.micApps) {
    const a = raw.replace(/\.(app|exe)$/i, '');
    const known = MEETING_APPS.find((m) => m.match.test(a)) ?? (extra.some((e) => a.toLowerCase().includes(e)) ? { name: a } : undefined);
    if (known) return { app: known.name, reason: `${known.name} is using the microphone`, event: ev };
  }
  // A browser has the microphone: look for a meeting page among its windows.
  const browserOnMic = x.micApps.find((a) => BROWSERS.test(a));
  if (browserOnMic) {
    for (const w of x.windows) {
      if (!BROWSERS.test(w.app) && !BROWSERS.test(browserOnMic)) continue;
      const page = MEETING_PAGES.find((p) => p.match.test(w.title)) ?? (extra.some((e) => w.title.toLowerCase().includes(e)) ? { name: w.title.slice(0, 40) } : undefined);
      if (page) return { app: page.name, reason: `A ${page.name} page in ${prettyApp(w.app || browserOnMic)} is using the microphone`, event: ev };
    }
    // a browser on the microphone during a calendar event with a meeting link
    if (event && /meet\.google|teams\.microsoft|zoom\.us|whereby|jit\.si|webex/i.test(`${event.url ?? ''} ${event.location ?? ''}`)) {
      return { app: prettyApp(browserOnMic), reason: `${prettyApp(browserOnMic)} is using the microphone during “${event.title}”`, event: ev };
    }
  }
  return null;
}

const prettyApp = (a: string) => a.replace(/\.(app|exe)$/i, '').replace(/^google-chrome.*/i, 'Chrome').replace(/^msedge$/i, 'Edge').replace(/^(\w)/, (c) => c.toUpperCase());

/** The calendar event a recording belongs to: the one that overlaps it most (starting up to 10 minutes away). */
export function bestEvent<E extends { start: number; end: number; allDay?: boolean }>(events: E[], from: number, to: number): E | undefined {
  let best: E | undefined;
  let bestOverlap = 0;
  for (const e of events) {
    if (e.allDay) continue;
    const overlap = Math.min(e.end, to) - Math.max(e.start, from);
    const near = Math.abs(e.start - from) <= 10 * 60_000;
    const score = overlap > 0 ? overlap : near ? 1 : 0;
    if (score > bestOverlap) { bestOverlap = score; best = e; }
  }
  return best;
}

// ---------------------------------------------------------------- exports

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');
export function stamp(sec: number, sep: ',' | '.' = ','): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  return `${pad(ms / 3_600_000)}:${pad((ms / 60_000) % 60)}:${pad((ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}
export const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

const nameOf = (speakers: Speaker[], id: string) => speakers.find((s) => s.id === id)?.label ?? id;

export function toSrt(m: Pick<MeetingRecord, 'utterances' | 'speakers'>): string {
  return m.utterances.map((u, i) => `${i + 1}\n${stamp(u.start)} --> ${stamp(Math.max(u.end, u.start + 0.5))}\n${nameOf(m.speakers, u.speaker)}: ${u.text}\n`).join('\n');
}

export function toVtt(m: Pick<MeetingRecord, 'utterances' | 'speakers'>): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `WEBVTT\n\n${m.utterances.map((u) => `${stamp(u.start, '.')} --> ${stamp(Math.max(u.end, u.start + 0.5), '.')}\n<v ${esc(nameOf(m.speakers, u.speaker))}>${esc(u.text)}\n`).join('\n')}`;
}

/** The transcript as lines, joining back-to-back pieces from the same speaker. */
export function transcriptLines(m: Pick<MeetingRecord, 'utterances' | 'speakers'>): { at: number; who: string; text: string }[] {
  const out: { at: number; who: string; text: string; id: string; end: number }[] = [];
  for (const u of [...m.utterances].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && last.id === u.speaker && u.start - last.end < 4) { last.text += ` ${u.text}`; last.end = u.end; continue; }
    out.push({ at: u.start, who: nameOf(m.speakers, u.speaker), text: u.text, id: u.speaker, end: u.end });
  }
  return out.map(({ at, who, text }) => ({ at, who, text }));
}

export function toTxt(m: Pick<MeetingRecord, 'utterances' | 'speakers'>): string {
  return transcriptLines(m).map((l) => `[${clock(l.at)}] ${l.who}: ${l.text}`).join('\n') + '\n';
}

const fmtDate = (t: number) => new Date(t).toISOString().slice(0, 10);
const fmtTime = (t: number) => new Date(t).toTimeString().slice(0, 5);
const yamlStr = (s: string) => JSON.stringify(s);

/** The meeting note: front matter, summary, decisions and action items first, the transcript after. */
export function toMarkdown(m: MeetingRecord): string {
  const fm = [
    '---',
    `title: ${yamlStr(m.title)}`,
    `date: ${fmtDate(m.startedAt)}`,
    `start: ${yamlStr(fmtTime(m.startedAt))}`,
    `duration: ${yamlStr(clock(m.durationMs / 1000))}`,
    ...(m.app ? [`app: ${yamlStr(m.app)}`] : []),
    ...(m.event ? [`event: ${yamlStr(m.event.title)}`] : []),
    ...(m.event?.attendees.length ? [`attendees: [${m.event.attendees.map(yamlStr).join(', ')}]`] : []),
    `speakers: [${m.speakers.map((s) => yamlStr(s.label)).join(', ')}]`,
    'tags: [meeting]',
    '---',
    '',
  ];
  const n = m.notes;
  const body = [`# ${m.title}`, ''];
  if (n) {
    if (n.summary) body.push('## Summary', '', n.summary.trim(), '');
    body.push('## Decisions', '', ...(n.decisions.length ? n.decisions.map((d) => `- ${d}`) : ['- None noted']), '');
    body.push('## Action items', '', ...(n.actions.length ? n.actions.map((a) => `- [ ] ${a.text}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (due ${a.due})` : ''}`) : ['- None noted']), '');
  }
  const est = m.speakers.some((s) => s.estimated && s.label.startsWith('Speaker'));
  body.push('## Transcript', '', ...(est ? ['> Speaker labels for other people are estimated from their voices.', ''] : []));
  body.push(...transcriptLines(m).map((l) => `**${l.who}** [${clock(l.at)}]: ${l.text}  `));
  return fm.join('\n') + body.join('\n') + '\n';
}

/** A file name for a meeting: "2026-10-31 Weekly sync". */
export const meetingFileName = (m: Pick<MeetingRecord, 'title' | 'startedAt'>) => `${fmtDate(m.startedAt)} ${m.title.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Meeting'}`;

// ---------------------------------------------------------------- notes

const MAX_PROMPT_CHARS = 60_000;

/** What the AI is asked (only the transcript text is sent; never the sound). */
export function notesPrompt(m: MeetingRecord): string {
  let t = toTxt(m);
  if (t.length > MAX_PROMPT_CHARS) t = t.slice(0, MAX_PROMPT_CHARS / 2) + '\n[…]\n' + t.slice(-MAX_PROMPT_CHARS / 2);
  return [
    'You write meeting notes from a transcript. Reply with JSON only, no other text, in this shape:',
    '{"summary": "3 to 6 sentences", "decisions": ["…"], "actions": [{"text": "…", "owner": "name or empty", "due": "date words or empty"}]}',
    'Use the language of the meeting. Only include decisions and action items that were actually said. Names come from the transcript or the attendee list.',
    m.event?.attendees.length ? `Attendees: ${m.event.attendees.join(', ')}` : '',
    `Meeting: ${m.title}`,
    '<transcript>',
    t,
    '</transcript>',
  ].filter(Boolean).join('\n');
}

/** Reads the AI's answer, forgiving code fences and stray text around the JSON. */
export function parseNotesReply(reply: string, by: string, at = Date.now()): MeetingNotes | null {
  const m = reply.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { summary?: unknown; decisions?: unknown; actions?: unknown };
    const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
    const actions: ActionItem[] = Array.isArray(j.actions)
      ? j.actions.map((a) => (typeof a === 'string' ? { text: a } : { text: String((a as ActionItem)?.text ?? '').trim(), owner: String((a as ActionItem)?.owner ?? '').trim() || undefined, due: String((a as ActionItem)?.due ?? '').trim() || undefined })).filter((a) => a.text)
      : [];
    return { summary: String(j.summary ?? '').trim(), decisions: strs(j.decisions), actions, by, at };
  } catch {
    return null;
  }
}

/**
 * Notes without any AI: decisions and action items picked out by the words
 * people use for them, and a summary from the longest turns. Honest but plain.
 */
export function ruleNotes(m: MeetingRecord, at = Date.now()): MeetingNotes {
  const lines = transcriptLines(m);
  const sentences = lines.flatMap((l) => (l.text.match(/[^.!?]+[.!?]?/g) ?? []).map((s) => ({ who: l.who, s: s.trim() }))).filter((x) => x.s.split(/\s+/).length >= 4);
  const decided = /\b(we(?:'ve| have)? (?:decided|agreed)|let'?s go with|decision is|we'll go with|agreed (?:to|on|that)|final answer|we are going with|settled on)\b/i;
  const action = /\b(i'll|i will|you'll|you will|we'll|we will|(?:he|she|they)(?:'ll| will)|can you|could you|please|action item|to-?do|follow up|by (?:monday|tuesday|wednesday|thursday|friday|tomorrow|next week|end of (?:day|week)))\b/i;
  const decisions = [...new Set(sentences.filter((x) => decided.test(x.s)).map((x) => x.s))].slice(0, 10);
  const actions: ActionItem[] = [];
  for (const x of sentences) {
    if (!action.test(x.s) || decided.test(x.s) || /\?$/.test(x.s) && !/can you|could you/i.test(x.s)) continue;
    const owner = /^(i'll|i will)/i.test(x.s) ? x.who : (x.s.match(/^(\p{Lu}\p{Ll}+) (?:will|'ll)/u)?.[1] ?? undefined);
    const due = x.s.match(/\bby ((?:next )?(?:monday|tuesday|wednesday|thursday|friday|tomorrow|week|end of (?:day|week)))\b/i)?.[1];
    if (!actions.some((a) => a.text === x.s)) actions.push({ text: x.s, owner, due });
    if (actions.length >= 12) break;
  }
  const longest = [...lines].sort((a, b) => b.text.length - a.text.length).slice(0, 3).sort((a, b) => a.at - b.at);
  const who = [...new Set(lines.map((l) => l.who))];
  const summary = lines.length
    ? `${clock(m.durationMs / 1000)} with ${who.join(', ')}. ${longest.map((l) => `${l.who}: “${l.text.slice(0, 160)}${l.text.length > 160 ? '…' : ''}”`).join(' ')}`
    : 'Nothing was said.';
  return { summary, decisions, actions, by: 'rules', at };
}

/** Live transcript for AIs: the last N minutes as plain lines. */
export function liveText(m: Pick<MeetingRecord, 'utterances' | 'speakers'>, sinceSec = 0): string {
  return transcriptLines({ ...m, utterances: m.utterances.filter((u) => u.end >= sinceSec) }).map((l) => `[${clock(l.at)}] ${l.who}: ${l.text}`).join('\n');
}

export const newUtteranceId = (track: 'mic' | 'system', start: number) => `${track[0]}${Math.round(start * 100)}`;

export function sortUtterances(u: Utterance[]): Utterance[] {
  return [...u].sort((a, b) => a.start - b.start || (a.track === 'mic' ? -1 : 1));
}
