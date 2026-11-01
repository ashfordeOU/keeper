// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Long-term memories the person controls: they see every one, can edit or
// delete it, and choose whether memories may ever go to an AI on the internet.
// Each memory belongs to everyone ("shared"), one persona, or one project.

export interface Memory {
  id: string;
  text: string;
  scope: 'shared' | 'persona' | 'project';
  /** the persona or project it belongs to */
  owner?: string;
  createdAt: number;
  updatedAt: number;
  /** who saved it: the person, or which AI */
  by: string;
  /** may go to AIs on the internet (otherwise only to AIs on this computer) */
  cloud: boolean;
  pinned?: boolean;
}

export interface MemoryFilter {
  persona?: string;
  project?: string;
  /** the AI it would be sent to runs on this computer */
  localModel: boolean;
  /** the person allows memories to go to cloud AIs at all */
  cloudAllowed: boolean;
}

let seq = 0;
export function memoryId(now = Date.now()): string {
  return `m${now.toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}`;
}

export function addMemory(list: Memory[], m: { text: string; scope?: Memory['scope']; owner?: string; by: string; cloud?: boolean }, now = Date.now()): { list: Memory[]; memory: Memory } {
  const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) throw new Error('Nothing to remember');
  // The same fact twice is updated, not duplicated.
  const same = list.find((x) => x.text.toLowerCase() === text.toLowerCase() && x.scope === (m.scope ?? 'shared') && x.owner === m.owner);
  if (same) {
    const memory = { ...same, updatedAt: now };
    return { list: list.map((x) => (x.id === same.id ? memory : x)), memory };
  }
  const memory: Memory = { id: memoryId(now), text, scope: m.scope ?? 'shared', owner: m.owner, createdAt: now, updatedAt: now, by: m.by, cloud: m.cloud ?? false };
  return { list: [...list, memory].slice(-2000), memory };
}

export function editMemory(list: Memory[], id: string, patch: Partial<Pick<Memory, 'text' | 'cloud' | 'pinned' | 'scope' | 'owner'>>, now = Date.now()): Memory[] {
  if (!list.some((x) => x.id === id)) throw new Error('No memory with that id');
  return list.map((x) => (x.id === id ? { ...x, ...patch, text: (patch.text ?? x.text).trim().slice(0, 500), updatedAt: now } : x));
}

export function removeMemory(list: Memory[], id: string): Memory[] {
  if (!list.some((x) => x.id === id)) throw new Error('No memory with that id');
  return list.filter((x) => x.id !== id);
}

/** The memories this conversation may see. */
export function visibleMemories(list: Memory[], f: MemoryFilter): Memory[] {
  return list.filter((m) => {
    if (!f.localModel && (!f.cloudAllowed || !m.cloud)) return false;
    if (m.scope === 'shared') return true;
    if (m.scope === 'persona') return !!f.persona && m.owner === f.persona;
    if (m.scope === 'project') return !!f.project && m.owner === f.project;
    return false;
  });
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

/** Memories that share words with the query, best first (pinned always first). */
export function searchMemories(list: Memory[], query: string, limit = 20): Memory[] {
  const q = new Set(words(query));
  const scored = list.map((m) => ({ m, s: (m.pinned ? 100 : 0) + (q.size ? words(m.text).filter((w) => q.has(w)).length : 1) + m.updatedAt / 1e15 }));
  return scored.filter((x) => !q.size || x.s >= 1).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.m);
}

/** A few lines for the AI's instructions. */
export function memoryBlock(list: Memory[], max = 30): string {
  if (!list.length) return '';
  const pinned = list.filter((m) => m.pinned);
  const rest = list.filter((m) => !m.pinned).sort((a, b) => b.updatedAt - a.updatedAt);
  return `What the person asked you to remember (ids in brackets; they can be forgotten with forget):\n${[...pinned, ...rest].slice(0, max).map((m) => `- [${m.id}] ${m.text}`).join('\n')}`;
}
