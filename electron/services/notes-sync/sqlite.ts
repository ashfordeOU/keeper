// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading (and, for Sticky Notes, writing) another app's SQLite database.
// Reads use a copy so the app's own database is never locked or changed.
// Uses Node's built-in SQLite; falls back to the sqlite3 command.

import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Row = Record<string, unknown>;
interface Db { prepare(sql: string): { all(...p: unknown[]): Row[]; run(...p: unknown[]): unknown }; close(): void }

async function nodeSqlite(): Promise<(new (file: string, opts?: { readOnly?: boolean }) => Db) | null> {
  try {
    const m = (await import('node:sqlite')) as unknown as { DatabaseSync: new (file: string, opts?: { readOnly?: boolean }) => Db };
    return m.DatabaseSync;
  } catch {
    return null;
  }
}

/** Rows from a database, read from a private copy (with its -wal file). */
export async function readRows(dbFile: string, sql: string): Promise<Row[]> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'keeper-notes-'));
  try {
    const copy = path.join(dir, 'db.sqlite');
    await fsp.copyFile(dbFile, copy);
    for (const ext of ['-wal', '-shm']) await fsp.copyFile(dbFile + ext, copy + ext).catch(() => undefined);
    const Database = await nodeSqlite();
    if (Database) {
      const db = new Database(copy);
      try { return db.prepare(sql).all(); } finally { db.close(); }
    }
    return await new Promise<Row[]>((resolve, reject) => execFile('sqlite3', ['-json', '-readonly', copy, sql], { maxBuffer: 256 << 20, timeout: 30_000 }, (err, out) => {
      if (err) return reject(new Error('Could not read the notes database (the sqlite3 command is needed on this system).'));
      try { resolve(out.trim() ? (JSON.parse(out) as Row[]) : []); } catch (e) { reject(e); }
    }));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Runs one change on the real database (only used for Sticky Notes, while it is closed). */
export async function runWrite(dbFile: string, sql: string, params: (string | number)[]): Promise<void> {
  const Database = await nodeSqlite();
  if (!Database) throw new Error('Writing needs a newer Keeper (built-in SQLite is missing).');
  const db = new Database(dbFile);
  try { db.prepare(sql).run(...params); } finally { db.close(); }
}
