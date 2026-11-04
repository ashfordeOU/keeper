// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Send to…": one set of verbs for every kind of thing in Keeper. A file, a
// mail, an event, a task, a note, a clip, a screenshot or a snippet can each be
// sent to a Note, a Task, an Event, a Mail, another Device, the AI, the Shelf or
// a Cue. Every copy keeps a line back to where it came from ("from mail:
// Invoice October"). The window runs the verbs (src/components/SendTo.tsx);
// the same list feeds Keeper's automation (core/automation.ts).

export type SendKind = 'file' | 'mail' | 'event' | 'task' | 'note' | 'clip' | 'screenshot' | 'snippet' | 'text';
export type SendVerb = 'note' | 'task' | 'event' | 'mail' | 'device' | 'ai' | 'shelf' | 'cue';

/** Something to send: what it is, its words and files, and where it came from. */
export interface SendItem {
  kind: SendKind;
  /** a short title ("Invoice October", "photo.jpg") */
  title: string;
  /** its words, if any (a note's text, a clip, a mail's summary) */
  text?: string;
  /** files that go with it (a file, a screenshot, a mail's attachments saved) */
  paths?: string[];
  /** a web link that goes with it */
  url?: string;
  /** a link back to it inside Keeper (keeper://mail/…, keeper://open?path=…) */
  link?: string;
}

export interface VerbDef {
  id: SendVerb;
  label: string;
  icon: string;
  /** what it does, in a few words */
  hint: string;
  /** the part that must be on */
  feature: string;
  /** kinds it takes; files-only verbs need paths */
  needsFiles?: boolean;
  /** the number key in the Send to sheet */
  key: string;
}

export const VERBS: VerbDef[] = [
  { id: 'note', label: 'Note', icon: 'note', hint: 'Add to today’s note', feature: 'notes', key: '1' },
  { id: 'task', label: 'Task', icon: 'listCheck', hint: 'A task that links back', feature: 'calendars', key: '2' },
  { id: 'event', label: 'Event', icon: 'calendar', hint: 'Into your calendar', feature: 'calendars', key: '3' },
  { id: 'mail', label: 'Mail', icon: 'mail', hint: 'A new message with it', feature: 'mail', key: '4' },
  { id: 'device', label: 'Device', icon: 'send', hint: 'To your phone or computer', feature: 'link', needsFiles: true, key: '5' },
  { id: 'ai', label: 'AI', icon: 'sparkle', hint: 'Ask about it', feature: 'assistant', key: '6' },
  { id: 'shelf', label: 'Shelf', icon: 'island', hint: 'Keep it on the Island', feature: 'island', needsFiles: true, key: '7' },
  { id: 'cue', label: 'Cue', icon: 'pin', hint: 'A reminder where you need it', feature: 'cues', key: '8' },
];

const OFF_WHY: Record<SendVerb, string> = {
  note: 'Notes is switched off', task: 'Calendar and reminders are switched off', event: 'Calendar and reminders are switched off', mail: 'Mail is switched off',
  device: 'Your other devices are switched off', ai: 'The assistant is switched off', shelf: 'The Island is switched off', cue: 'Cues are switched off',
};

export const KIND_WORD: Record<SendKind, string> = {
  file: 'file', mail: 'mail', event: 'event', task: 'task', note: 'note', clip: 'clipboard', screenshot: 'screenshot', snippet: 'snippet', text: 'text',
};

/** The verbs for this item, each with a reason when it cannot be used now. */
export function verbsFor(item: SendItem, isOn: (feature: string) => boolean): (VerbDef & { why?: string })[] {
  return VERBS.filter((v) => !(v.id === 'task' && item.kind === 'task') && !(v.id === 'event' && item.kind === 'event') && !(v.id === 'note' && item.kind === 'note' && !item.text))
    .map((v) => {
      if (!isOn(v.feature)) return { ...v, why: OFF_WHY[v.id] };
      if (v.needsFiles && !item.paths?.length) return { ...v, why: 'Only files can go there' };
      return { ...v };
    });
}

export const verbForKey = (key: string): SendVerb | undefined => VERBS.find((v) => v.key === key)?.id;

/** "from mail: Invoice October", the line every copy keeps. */
export function backLine(item: SendItem): string {
  return `from ${KIND_WORD[item.kind]}: ${oneLine(item.title) || 'untitled'}`;
}

/** The same, with the link back when there is one. */
export function backLink(item: SendItem): string {
  return item.link ? `${backLine(item)} (${item.link})` : backLine(item);
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** A task: the title in its words, the rest and the back-link in its notes. */
export function taskFrom(item: SendItem): { title: string; notes: string; url?: string } {
  const title = clip(oneLine(item.kind === 'clip' || item.kind === 'text' ? item.text || item.title : item.title), 120) || 'Untitled';
  const notes = [item.kind === 'clip' || item.kind === 'text' ? '' : clip(item.text ?? '', 2000), ...(item.paths ?? []), backLink(item)].filter(Boolean).join('\n');
  return { title, notes, ...(item.url ? { url: item.url } : item.link ? { url: item.link } : {}) };
}

/** One line for today's note: "- 14:05 Invoice October (from mail: …)". */
export function noteLine(item: SendItem, time: string): string {
  const body = item.kind === 'clip' || item.kind === 'text' ? oneLine(item.text || item.title) : oneLine(item.title);
  const files = (item.paths ?? []).map((p) => ` [${p.split(/[\\/]/).pop()}](${fileUrl(p)})`).join('');
  return `- ${time} ${clip(body, 400)}${files}${item.url ? ` ${item.url}` : ''} _(${backLink(item)})_`;
}

/** The words Calendar's quick add reads ("lunch with Ana friday 1pm"). */
export function eventWords(item: SendItem): string {
  return clip(oneLine(item.kind === 'clip' || item.kind === 'text' ? item.text || item.title : `${item.title} ${item.text ?? ''}`), 300);
}

/** A draft mail: the subject, a body with the back-link, and any files attached. */
export function mailDraft(item: SendItem): { subject: string; body: string; attachments: string[] } {
  const body = [item.kind === 'file' || item.kind === 'screenshot' ? '' : item.text ?? '', item.url ?? '', '', backLine(item)].join('\n').replace(/^\n+/, '').trimEnd();
  return { subject: clip(oneLine(item.title), 140), body, attachments: item.paths ?? [] };
}

/** A question for the assistant about it. */
export function aiPrompt(item: SendItem): string {
  const what = KIND_WORD[item.kind];
  const files = item.paths?.length ? ` Files: ${item.paths.join(', ')}.` : '';
  const text = item.text ? `\n\n${clip(item.text, 4000)}` : '';
  return `Help me with this ${what}: “${oneLine(item.title)}”.${files}${text}`;
}

/** A cue that carries it. */
export function cueFrom(item: SendItem): { title: string; body: string; url?: string; files?: string[] } {
  return { title: clip(oneLine(item.title), 120) || 'Untitled', body: [item.kind === 'file' ? '' : clip(item.text ?? '', 2000), backLink(item)].filter(Boolean).join('\n\n'), ...(item.url ? { url: item.url } : {}), ...(item.paths?.length ? { files: item.paths } : {}) };
}

/** keeper://open?path=… for a file. */
export function fileUrl(p: string): string {
  return `keeper://open?path=${encodeURIComponent(p)}`;
}

/** A file as something to send. */
export function fileItem(p: string, opts: { screenshot?: boolean; text?: string } = {}): SendItem {
  return { kind: opts.screenshot ? 'screenshot' : 'file', title: p.split(/[\\/]/).pop() || p, paths: [p], link: fileUrl(p), ...(opts.text ? { text: opts.text } : {}) };
}

/** Several files at once. */
export function filesItem(paths: string[]): SendItem {
  if (paths.length === 1) return fileItem(paths[0]);
  return { kind: 'file', title: `${paths.length} files`, paths };
}
