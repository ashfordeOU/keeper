// SPDX-License-Identifier: AGPL-3.0-or-later
// History of everything Keeper changed on disk, newest first. Moves and renames
// can be undone directly; Trash moves can be put back where the OS supports it.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { JournalEntry, JournalOp } from './types';

const MAX_ENTRIES = 500;

export class Journal {
  private entries: JournalEntry[] = [];
  private loaded = false;

  constructor(private file: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      if (Array.isArray(data)) this.entries = data.filter((e) => e && typeof e.id === 'string' && Array.isArray(e.ops));
    } catch {
      this.entries = [];
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(this.entries.slice(0, MAX_ENTRIES)));
    await fsp.rename(tmp, this.file);
  }

  list(): JournalEntry[] {
    return this.entries;
  }

  get(id: string): JournalEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  async record(title: string, ops: JournalOp[]): Promise<JournalEntry | undefined> {
    await this.load();
    if (ops.length === 0) return undefined;
    const entry: JournalEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      title,
      ops,
      freed: ops.filter((o) => o.type === 'trash' || o.type === 'delete').reduce((n, o) => n + o.size, 0),
      undoable: ops.some((o) => o.type === 'move' || o.type === 'trash' || o.type === 'startup'),
    };
    this.entries.unshift(entry);
    await this.save();
    return entry;
  }

  async markUndone(id: string): Promise<void> {
    const e = this.get(id);
    if (!e) return;
    e.undone = true;
    await this.save();
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.save();
  }
}

/** Reverses the moves of an entry (newest first). Returns how many were put back. */
export async function undoMoves(entry: JournalEntry): Promise<{ restored: number; failed: string[] }> {
  let restored = 0;
  const failed: string[] = [];
  for (const op of [...entry.ops].reverse()) {
    if (op.type !== 'move' || !op.to) continue;
    try {
      await fsp.access(op.from).then(
        () => { throw Object.assign(new Error('exists'), { code: 'EEXIST' }); },
        () => undefined,
      );
      await fsp.mkdir(path.dirname(op.from), { recursive: true });
      await moveFile(op.to, op.from);
      restored++;
    } catch {
      failed.push(op.to);
    }
  }
  return { restored, failed };
}

/** rename, falling back to copy + delete across drives. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fsp.rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    await fsp.rm(from, { recursive: true, force: true });
  }
}
