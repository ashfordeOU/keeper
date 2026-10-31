// SPDX-License-Identifier: AGPL-3.0-or-later
// The platform integrations ask "the brain" for results. Until the brain
// service hands itself over with useBrain(), a plain library search stands in,
// so Spotlight, GNOME, KRunner and links keep working either way.

import type { Brain, BrainHit, BrainSearchOptions, BrainStatus } from '../../../core/brain-contract';
import type { FileIndex } from '../../../core/indexer';
import type { FileEntry } from '../../../core/types';

let brain: Brain | null = null;
let index: (() => FileIndex | undefined) | null = null;

export function useBrain(b: Brain) {
  brain = b;
}

export function useIndex(get: () => FileIndex | undefined) {
  index = get;
}

export function toHit(f: FileEntry, score: number, snippet?: string): BrainHit {
  return { path: f.path, name: f.name, kind: f.kind, size: f.size, mtime: f.mtime, score, snippet, source: f.source?.name, tags: f.tags };
}

const fallback: Brain = {
  status(): BrainStatus {
    const all = index?.()?.all() ?? [];
    return { files: all.length, withText: all.filter((f) => f.text).length, embedded: 0, pending: 0, semantic: 'off' };
  },
  async search(o: BrainSearchOptions): Promise<BrainHit[]> {
    const ix = index?.();
    if (!ix || !o.query.trim()) return [];
    const { hits } = ix.query(o.query);
    const top = hits[0]?.score || 1;
    return hits
      .filter((h) => (!o.kinds?.length || o.kinds.includes(h.file.kind)) && (!o.modifiedAfter || h.file.mtime >= o.modifiedAfter) && (!o.modifiedBefore || h.file.mtime <= o.modifiedBefore))
      .filter((h) => !o.within?.length || o.within.some((w) => h.file.path.startsWith(w)))
      .slice(0, o.limit ?? 20)
      .map((h) => toHit(h.file, Math.max(0, Math.min(1, h.score / top)), h.snippet));
  },
  async read(p: string, opts: { offset?: number; maxChars?: number } = {}) {
    const f = index?.()?.files.get(p);
    const text = f?.text ?? '';
    const start = opts.offset ?? 0;
    const max = opts.maxChars ?? 20_000;
    return { text: text.slice(start, start + max), total: text.length, truncated: start + max < text.length };
  },
  async ask() {
    throw new Error('The assistant is not ready yet');
  },
};

export function getBrain(): Brain {
  return brain ?? fallback;
}
