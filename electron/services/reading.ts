// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The reading and writing comfort pack in the main process: reading aloud with
// the computer's own voice (core/read-aloud.ts), and the reading fonts, fetched
// once from a pinned public mirror when chosen, checked against their
// fingerprints and kept in Keeper's folder (core/a11y.ts READING_FONTS).

import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { READING_FONTS, readingFontUrl, type ReadingFont } from '../../core/a11y';
import type { ReadingApi } from '../../core/api-reading';
import { noVoiceHint, speakCommand } from '../../core/read-aloud';
import { featureOn } from './features';

const has = (cmd: string) => (process.env.PATH ?? '').split(path.delimiter).some((d) => d && existsSync(path.join(d, cmd)));

let speaking: ChildProcess | null = null;
let broadcast: (ch: string, ...a: unknown[]) => void = () => undefined;

function stop() {
  if (!speaking) return;
  try { speaking.kill(); } catch { /* gone */ }
  speaking = null;
  broadcast('read-aloud', false);
}

const fontsDir = () => path.join(app.getPath('userData'), 'reading-fonts');

async function fetchFont(file: string, sha256: string): Promise<Buffer> {
  const local = path.join(fontsDir(), file);
  const have = await fsp.readFile(local).catch(() => null);
  if (have && createHash('sha256').update(have).digest('hex') === sha256) return have;
  // KEEPER_FONTS_BASE: tests serve the same files from this computer.
  const res = await fetch(readingFontUrl(file, process.env.KEEPER_FONTS_BASE || undefined), { redirect: 'follow' }).catch(() => null);
  if (!res?.ok) throw new Error('Could not download the font. Check the connection and try again.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (createHash('sha256').update(buf).digest('hex') !== sha256) throw new Error('The downloaded font was not the expected file, so it was not used.');
  await fsp.mkdir(fontsDir(), { recursive: true });
  await fsp.writeFile(local, buf);
  return buf;
}

export const readingApi: ReadingApi = {
  async voice() {
    const c = speakCommand(process.platform, 'test', 1, has);
    return c ? { ok: true } : { ok: false, message: noVoiceHint(process.platform) };
  },
  async speak(text: string, speed = 1) {
    if (!featureOn('readAloud')) throw new Error('Read aloud is switched off (Settings → Features)');
    stop();
    const c = speakCommand(process.platform, String(text ?? ''), speed, has);
    if (!c) return { ok: false, message: speakCommandEmpty(String(text ?? '')) };
    const p = spawn(c.cmd, c.args, { stdio: [c.stdin ? 'pipe' : 'ignore', 'ignore', 'ignore'], windowsHide: true });
    speaking = p;
    broadcast('read-aloud', true);
    p.on('error', () => { if (speaking === p) { speaking = null; broadcast('read-aloud', false); } });
    p.on('exit', () => { if (speaking === p) { speaking = null; broadcast('read-aloud', false); } });
    if (c.stdin && p.stdin) { p.stdin.on('error', () => undefined); p.stdin.end(c.stdin); }
    return { ok: true };
  },
  async stop() { stop(); },
  async speaking() { return !!speaking; },
  async font(id: ReadingFont) {
    if (id === 'theme') return null;
    const f = READING_FONTS[id];
    if (!f) throw new Error('No such font');
    const faces = [];
    for (const x of f.files) faces.push({ weight: x.weight, data: (await fetchFont(x.file, x.sha256)).toString('base64') });
    return { family: f.family, faces };
  },
};

const speakCommandEmpty = (t: string) => (t.trim() ? noVoiceHint(process.platform) : 'Select some text first');

export function startReading(d: { broadcast: (ch: string, ...a: unknown[]) => void }) {
  broadcast = d.broadcast;
  app.on('before-quit', stop);
}
