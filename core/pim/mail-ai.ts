// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The pieces of Mail's AI help that need no AI: the tones of the ⌘J menu,
// the person's own instruction, answers with their [1] citations turned into
// links to the messages, and "AI memory" (facts the person keeps, shown and
// edited in Settings, sent with each request). Pure.

import { redact } from '../brain/redact';

export interface Tone {
  id: string;
  label: string;
  /** what the AI is asked to do */
  ask: string;
}

export const TONES: Tone[] = [
  { id: 'shorter', label: 'Shorter', ask: 'Make it shorter and to the point; keep every fact, date and question.' },
  { id: 'longer', label: 'More detail', ask: 'Expand it a little with helpful detail, without inventing facts.' },
  { id: 'friendly', label: 'Friendlier', ask: 'Make it warmer and friendlier, still natural.' },
  { id: 'professional', label: 'More formal', ask: 'Make it more formal and professional.' },
  { id: 'confident', label: 'More confident', ask: 'Make it sound confident and direct, without being rude.' },
  { id: 'casual', label: 'Casual', ask: 'Make it casual and relaxed, as to a friend.' },
  { id: 'apologetic', label: 'Apologetic', ask: 'Make it apologise sincerely, briefly.' },
  { id: 'proofread', label: 'Fix spelling and grammar', ask: 'Fix spelling, grammar and punctuation only; change nothing else.' },
];

/** The request for a tone or the person's own instruction ("make it sound like a pirate"). */
export function rewritePrompt(text: string, how: { tone?: string; instruction?: string; lang?: string }, memory: string[] = []): string {
  const tone = TONES.find((t) => t.id === how.tone);
  const ask = how.instruction?.trim() || tone?.ask || 'Improve it.';
  return [
    'Rewrite this email draft.', ask,
    how.lang ? `Write it in ${how.lang}.` : 'Keep its language.',
    'Keep names, numbers, links and line breaks. Reply with the resulting text only — no introduction, quotes or notes.',
    memoryBlock(memory),
    `<draft>\n${text}\n</draft>`,
  ].filter(Boolean).join('\n\n');
}

/** A new draft (or an addition to one) from the person's instruction. */
export function draftPrompt(instruction: string, o: { draft?: string; thread?: string; memory?: string[] } = {}): string {
  return [
    'Write the body of an email as me, following this instruction:', instruction.trim(),
    o.draft?.trim() ? `What I have written so far (continue or rework it as the instruction says):\n<draft>\n${o.draft}\n</draft>` : '',
    o.thread ? `The conversation I am answering:\n<thread>\n${o.thread}\n</thread>` : '',
    memoryBlock(o.memory ?? []),
    'Only the email text: no subject line, no signature, no notes.',
  ].filter(Boolean).join('\n\n');
}

export function memoryBlock(memory: string[]): string {
  const m = cleanMemory(memory);
  return m.length ? `Things to keep in mind about me (my own notes):\n${m.map((x) => `- ${x}`).join('\n')}` : '';
}

/** At most 50 short lines, no empty ones, no duplicates, nothing that looks like a secret. */
export function cleanMemory(memory: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of memory) {
    const x = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!x || seen.has(x.toLowerCase())) continue;
    if (redact(x).text !== x) continue;
    seen.add(x.toLowerCase());
    out.push(x);
    if (out.length >= 50) break;
  }
  return out;
}

/** "Remember that …" / "remember: …" in an instruction, as a line for the memory. */
export function rememberIn(instruction: string): string | undefined {
  const m = instruction.match(/^\s*remember(?: that|:)?\s+(.{3,300})$/i);
  return m ? m[1].trim().replace(/\.$/, '') : undefined;
}

export type AnswerPart = { text: string } | { cite: number };

/** An answer split into text and its citations ([1], [2, 3]), each citation within 1…count. */
export function citationParts(answer: string, count: number): AnswerPart[] {
  const out: AnswerPart[] = [];
  let last = 0;
  for (const m of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    const nums = m[1].split(',').map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= count);
    if (!nums.length) continue;
    if (m.index! > last) out.push({ text: answer.slice(last, m.index) });
    for (const n of nums) out.push({ cite: n });
    last = m.index! + m[0].length;
  }
  if (last < answer.length) out.push({ text: answer.slice(last) });
  return out;
}

/** Text arriving bit by bit, put into a draft: the new text replaces the selection (or goes at the end). */
export function streamInto(draft: string, sel: { start: number; end: number } | null, sofar: string): string {
  if (!sel) return draft ? `${draft.replace(/\s+$/, '')}\n\n${sofar}` : sofar;
  return draft.slice(0, sel.start) + sofar + draft.slice(sel.end);
}
