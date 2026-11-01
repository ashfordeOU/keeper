// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Packing the bundle: every text file is scrubbed (and file names too), the
// owner sees what is inside and can leave out pictures, the video and crash
// dumps (they cannot be scrubbed), and everything goes into one .zip.

import fs from 'node:fs';
import path from 'node:path';
import { color, type Prompter } from './prompt';
import { makeScrubber, TEXT_EXT, type Identity } from './scrub';
import type { Sys } from './sys';

export interface FileEntry { rel: string; bytes: number; kind: 'text' | 'screen' | 'window' | 'video' | 'dump' | 'other' }

export function listFiles(dir: string): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const rel = path.relative(dir, p);
      const bytes = fs.statSync(p).size;
      const kind: FileEntry['kind'] = TEXT_EXT.test(e.name) ? 'text' : rel.startsWith('screen/') ? 'screen' : rel.startsWith('shots/') ? 'window' : /\.(mov|mp4)$/i.test(e.name) ? 'video' : /\.dmp$/i.test(e.name) ? 'dump' : 'other';
      out.push({ rel, bytes, kind });
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Scrubs every text file in place and renames files whose names carry the owner's identity. Returns how many changed. */
export function scrubTree(dir: string, id: Identity): number {
  const s = makeScrubber(id);
  let changed = 0;
  for (const f of listFiles(dir)) {
    const p = path.join(dir, f.rel);
    if (f.kind === 'text') {
      const before = fs.readFileSync(p, 'utf8');
      const after = s.text(before);
      if (after !== before) { fs.writeFileSync(p, after); changed++; }
    }
    const base = path.basename(f.rel);
    const clean = s.name(base);
    if (clean !== base) { fs.renameSync(p, path.join(path.dirname(p), clean)); changed++; }
  }
  return changed;
}

export const human = (n: number) => (n >= 1 << 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / 2 ** 20).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

export function summaryLines(files: FileEntry[]): string[] {
  const by = (k: FileEntry['kind']) => files.filter((f) => f.kind === k);
  const sum = (l: FileEntry[]) => human(l.reduce((s, f) => s + f.bytes, 0));
  const lines = [
    `Results and report: results.json, results.schema.json, report.md`,
    `Text files (logs, command output, system info): ${by('text').length} files, ${sum(by('text'))} — your user name, full name, home folder, computer names, serial numbers, hardware ids, MAC and email addresses replaced`,
    `Pictures of Keeper's own windows: ${by('window').length} (${sum(by('window'))})`,
    `Pictures of the whole screen or part of it: ${by('screen').length} (${sum(by('screen'))}) — pictures cannot be scrubbed; they show whatever was on screen`,
  ];
  if (by('video').length) lines.push(`Screen video: ${by('video').length} (${sum(by('video'))}) — shows everything on screen during the run`);
  if (by('dump').length) lines.push(`Crash dumps of Keeper: ${by('dump').length} (${sum(by('dump'))}) — binary memory snapshots of Keeper (its throwaway data only), cannot be scrubbed`);
  if (by('other').length) lines.push(`Other files: ${by('other').length} (${sum(by('other'))})`);
  return lines;
}

/** Shows what is in the bundle and lets the owner leave out what cannot be scrubbed. */
export async function reviewBundle(dir: string, prompt: Prompter): Promise<void> {
  const files = listFiles(dir);
  prompt.say('');
  prompt.say(color.b('What goes into the file you send back:'));
  for (const l of summaryLines(files)) prompt.say(`  • ${l}`);
  for (const [kind, what, key] of [['screen', 'the whole-screen pictures', 'pack-screen'], ['video', 'the screen video', 'pack-video'], ['dump', 'the crash dumps', 'pack-dumps']] as const) {
    const list = files.filter((f) => f.kind === kind);
    if (!list.length) continue;
    const a = await prompt.ask({ key, title: `Include ${what}?`, lines: [`${list.length} file(s). Look at them first if you like: ${path.join(dir, list[0].rel.split('/')[0])}`], question: `Include ${what}?`, timeoutSec: 300, fallback: kind === 'dump' ? 'n' : 'y' });
    if (a.answer === 'n' || (kind === 'dump' && a.answer !== 'y')) {
      for (const f of list) fs.rmSync(path.join(dir, f.rel), { force: true });
      fs.appendFileSync(path.join(dir, 'README.txt'), `\nLeft out by the owner: ${list.length} file(s) of ${what}.\n`);
    }
  }
}

export async function zipBundle(sys: Sys, dir: string, outZip: string): Promise<{ ok: boolean; error?: string }> {
  fs.mkdirSync(path.dirname(outZip), { recursive: true });
  fs.rmSync(outZip, { force: true });
  const parent = path.dirname(dir);
  const name = path.basename(dir);
  // zip is on every Mac (and on the Linux dry run); ditto is the Mac's fallback
  let r = await sys.runReal('/usr/bin/env', ['zip', '-r', '-X', '-q', outZip, name], { cwd: parent, timeoutMs: 600_000 });
  if (!r.ok && process.platform === 'darwin') r = await sys.runReal('/usr/bin/ditto', ['-c', '-k', '--keepParent', dir, outZip], { timeoutMs: 600_000 });
  return r.ok && fs.existsSync(outZip) ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim() || 'zip failed' };
}

export function sendBackText(zip: string, bytes: number): string[] {
  const big = bytes > 25 * 2 ** 20;
  return [
    color.b(color.grn('Done. Thank you!')),
    `  The file: ${zip}`,
    `  Size: ${human(bytes)}`,
    '',
    color.b('How to send it back:'),
    `  • Attach it in our chat (drag it in, or use the paper clip) and send it.${big ? ' It is large: if the chat will not take it, use one of these:' : ''}`,
    '  • Or upload it to GitHub: on github.com/ashfordeOU/keeper → Releases → Draft a new release → drop the file under "Attach binaries" → Save draft (a draft is only visible to the repository\'s people),',
    '    or with the GitHub CLI: gh release upload <tag> "<file>" --repo ashfordeOU/keeper',
    '  • Or as a secret gist (gists take text only, so encode it first):',
    '      base64 -i "<file>" -o keeper-mac-test.b64 && gh gist create keeper-mac-test.b64',
  ];
}
