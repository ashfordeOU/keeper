// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places & Tracks and Notes, read only and with counts only: the Find My
// cache (which macOS version, whether the files are readable or encrypted;
// never decrypted, no position is recorded), the Apple Notes reader (asks
// macOS for Automation; only the number of notes is kept) and Bear's
// database if Bear is installed (a private copy is read; counts only).

import fs from 'node:fs';
import path from 'node:path';
import { findMyPlainOn, readFindMyCache } from '../../../../core/tracks/findmy';
import { fromAppleRows, listScript, type AppleNoteRow } from '../../../../core/notes-sync/connectors/applenotes';
import { BEAR_DB_REL, BEAR_SQL, fromBearRows } from '../../../../core/notes-sync/connectors/localdb';
import { readRows } from '../../../../electron/services/notes-sync/sqlite';
import { fail, pass, skip, verdict, type Ctx } from '../context';

export async function runTracks(ctx: Ctx) {
  await ctx.rec.check('tracks.findmy', 'Find My cache: detected, and readable or encrypted as expected for this macOS', 'auto', async (h) => {
    const v = ctx.facts.macos || '0';
    const plain = findMyPlainOn(v);
    const base = path.join(ctx.facts.realHome, 'Library/Caches/com.apple.findmy.fmipcore');
    const out: Record<string, unknown> = { macos: v, expectPlainJson: plain, folder: fs.existsSync(base) || ctx.dry };
    const states: string[] = [];
    for (const [file, kind] of [['Items.data', 'item'], ['Devices.data', 'device']] as const) {
      const f = path.join(base, file);
      let bytes: Buffer | null = null;
      let err = '';
      try { bytes = ctx.dry ? Buffer.from('{"encryptedData":"AAAA"}') : fs.readFileSync(f); } catch (e) { err = (e as NodeJS.ErrnoException).code ?? String(e); }
      if (!bytes) { out[file] = { readable: false, error: err }; states.push(err === 'ENOENT' ? 'missing' : 'no-access'); continue; }
      const r = readFindMyCache(new Uint8Array(bytes), kind);
      // never the positions themselves: their number only
      out[file] = { readable: true, size: bytes.length, state: r.state, ...(r.state === 'ok' ? { positions: r.positions.length } : {}), ...(r.state === 'unreadable' ? { reason: r.reason } : {}) };
      states.push(r.state);
    }
    h.artifact(ctx.saveData('tracks-findmy.json', out));
    if (states.every((s) => s === 'missing')) return skip(`No Find My cache on this Mac (Find My was never opened?) — macOS ${v}`, out);
    if (states.includes('no-access')) return pass(`macOS ${v}: the files exist but this terminal may not read them (Full Disk Access): Keeper must say so, not fail`, out);
    const consistent = plain ? states.every((s) => s === 'ok' || s === 'unreadable' || s === 'missing') : states.every((s) => s === 'encrypted' || s === 'missing');
    return verdict(consistent, `macOS ${v} (${plain ? 'plain JSON expected' : 'encrypted expected'}): ${states.join(', ')}`, out);
  });

  await ctx.rec.check('tracks.overview', 'Places & Tracks overview (Find My state as Keeper reports it)', 'auto', async (h) => {
    const app = await ctx.app();
    const o = await app.call<any>('tracks.overview');
    h.artifact(ctx.saveData('tracks-overview.json', { findMy: o?.findMy, sources: o?.sources ? Object.keys(o.sources) : undefined }));
    return verdict(!!o, `Find My: ${JSON.stringify(o?.findMy ?? null)}`);
  });
}

export async function runNotes(ctx: Ctx) {
  await ctx.rec.check('notes.applenotes', 'Apple Notes: Keeper\'s reader lists the notes (read only, counts only)', 'guided', async (h) => {
    if (!ctx.args.guided) return skip('Asks macOS for Automation permission: needs the owner');
    const yes = await ctx.prompt.consent('notes-apple', 'Read your Apple Notes list (read only)', ['Nothing changes. Notes opens, and macOS asks once whether this terminal may control Notes (Automation).', 'Keeper\'s own reader lists the notes; only their number (and how many are locked) is recorded: no titles, no text.'], ['Notes is quit again if it was not open before. You can remove the Automation permission in System Settings → Privacy & Security → Automation.']);
    if (!yes) return skip('The owner said no');
    const wasOpen = (await ctx.sys.run('/usr/bin/pgrep', ['-x', 'Notes'])).ok;
    const r = await ctx.sys.run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', listScript()], { timeoutMs: 180_000, secret: true });
    if (!wasOpen && !ctx.dry) await ctx.sys.run('/usr/bin/osascript', ['-e', 'tell application "Notes" to quit']);
    if (!r.ok) {
      h.artifact(ctx.saveData('notes-apple.json', { code: r.code, error: r.stderr.slice(0, 500) }));
      return fail(/-1743|not allowed/i.test(r.stderr) ? 'macOS did not allow this terminal to control Notes (Automation)' : `The reader failed: ${r.stderr.trim().slice(0, 200)}`, r.stderr.slice(0, 1000));
    }
    let rows: AppleNoteRow[] = [];
    try { rows = JSON.parse(r.stdout); } catch (e) { return fail('The reader\'s answer was not JSON', String(e)); }
    const notes = fromAppleRows(rows);
    const info = { notes: notes.length, locked: notes.filter((n) => n.locked).length, folders: new Set(notes.map((n) => n.folder ?? '')).size, seconds: r.ms / 1000 };
    h.artifact(ctx.saveData('notes-apple.json', info));
    return pass(`${info.notes} notes in ${info.folders} folders (${info.locked} locked), read in ${info.seconds.toFixed(1)} s`, info);
  });

  await ctx.rec.check('notes.bear', 'Bear: Keeper reads its database (a private copy; counts only)', 'auto', async (h) => {
    const db = path.join(ctx.facts.realHome, BEAR_DB_REL);
    if (!ctx.dry && !fs.existsSync(path.dirname(db))) return skip('Bear is not installed');
    if (ctx.dry) return skip('dry run: no Bear database');
    try {
      const notes = fromBearRows(await readRows(db, BEAR_SQL));
      const info = { notes: notes.filter((n) => !n.trashed).length, trashed: notes.filter((n) => n.trashed).length };
      h.artifact(ctx.saveData('notes-bear.json', info));
      return pass(`${info.notes} notes (${info.trashed} in the trash)`, info);
    } catch (e) {
      return fail(`Could not read Bear's notes: ${(e as Error).message} (macOS may ask to allow access to another app's data)`, String(e));
    }
  });
}
