// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Personas (how an assistant talks: instructions, voice, avatar) and projects
// (a set of folders, instructions and memories). Both are the person's own;
// a persona never claims to be a real, living person.

import type { Persona, Project } from './config';

/** Names that a persona must not pretend to be: obvious real people and the person's own AI services. */
const REAL_PERSON = /\b(i am|i'm|you are|act as|pretend to be|impersonate)\b[^.]{0,40}\b(the real|actual|genuine)\b/i;

export function checkPersona(p: Pick<Persona, 'name' | 'instructions'>): string | undefined {
  if (!p.name.trim()) return 'Give the persona a name';
  if (p.name.length > 40) return 'Keep the name under 40 characters';
  if (REAL_PERSON.test(p.instructions)) return 'A persona can have a personality, but it may not claim to be a real person';
  if (p.instructions.length > 4000) return 'Keep the instructions under 4,000 characters';
  return undefined;
}

export const PERSONA_GUARD = 'You are a persona the person created for Keeper. Stay in this voice, but never claim to be a real person or a human, and say you are an AI if asked.';

export function personaPrompt(p: Persona | undefined): string {
  if (!p) return '';
  return `${PERSONA_GUARD}\nYour name: ${p.name}.\n${p.instructions.trim()}`;
}

export function projectPrompt(p: Project | undefined): string {
  if (!p) return '';
  return `You are working in the project “${p.name}”. Only use files in: ${p.folders.join(', ') || '(no folders)'}.\n${p.instructions.trim()}`;
}

/** Is this path inside one of the project's folders? */
export function inProject(p: Project | undefined, file: string, sep = '/'): boolean {
  if (!p) return true;
  const norm = (s: string) => s.replace(/[\\/]+$/, '');
  return p.folders.some((f) => file === norm(f) || file.startsWith(norm(f) + sep) || file.startsWith(norm(f) + '/'));
}

export const PERSONA_TEMPLATES: Omit<Persona, 'id'>[] = [
  { name: 'Researcher', avatar: '🔎', instructions: 'Look things up before answering. Prefer primary sources, give numbered citations, and say how confident you are.', memoryScope: 'shared' },
  { name: 'Editor', avatar: '✍️', instructions: 'Improve writing: clearer, shorter, friendlier. Keep the author\'s meaning and voice. Show the changed text, then a one-line note on what changed.', memoryScope: 'shared' },
  { name: 'Coach', avatar: '🧭', instructions: 'Help the person plan and follow through. Ask one question at a time, keep a short list of next steps, and offer reminders.', memoryScope: 'own' },
  { name: 'Coder', avatar: '⌨️', instructions: 'Answer programming questions with working code. Run code to check calculations when you can. Be precise and brief.', memoryScope: 'shared' },
  { name: 'Companion', avatar: '🦉', instructions: 'Be warm and curious, chat about the person\'s day and interests, and remember what matters to them (only what they ask you to).', memoryScope: 'own' },
];
