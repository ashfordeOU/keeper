// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sending files between devices: offered first (the other side may ask its
// person), sent in chunks, resumable after a dropped connection, and checked
// with SHA-256 end to end before the file gets its real name. Node only.

import crypto from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { call, type Mux, type Stream } from './mux';

export interface Offer {
  id: string;
  name: string;
  size: number;
  mtime?: number;
}

export interface Progress {
  id: string;
  name: string;
  size: number;
  done: number;
  direction: 'send' | 'receive';
  state: 'waiting' | 'sending' | 'receiving' | 'checking' | 'done' | 'failed' | 'declined';
  error?: string;
  savedAs?: string;
  peer?: string;
}

/** A transfer id that stays the same for the same file, so a retry resumes. */
export function transferId(file: string, size: number, mtime: number): string {
  return crypto.createHash('sha256').update(`${file}\0${size}\0${mtime}`).digest('base64url').slice(0, 22);
}

/** Never a path: a file name that cannot climb out of the folder it lands in. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 200);
  return clean || 'file';
}

async function hashRange(file: string, end: number, h: crypto.Hash) {
  if (end <= 0) return;
  await new Promise<void>((resolve, reject) => {
    createReadStream(file, { start: 0, end: end - 1 }).on('data', (c) => h.update(c)).on('end', () => resolve()).on('error', reject);
  });
}

/** Sends one file. Resolves with where the other side saved it. */
export async function sendFile(mux: Mux, file: string, onProgress?: (p: Progress) => void, opts: { name?: string; offerTimeoutMs?: number } = {}): Promise<{ savedAs?: string }> {
  const st = await fsp.stat(file);
  if (!st.isFile()) throw new Error('Only files can be sent');
  const offer: Offer = { id: transferId(file, st.size, st.mtimeMs), name: safeName(opts.name ?? path.basename(file)), size: st.size, mtime: st.mtimeMs };
  const p: Progress = { id: offer.id, name: offer.name, size: offer.size, done: 0, direction: 'send', state: 'waiting' };
  onProgress?.({ ...p });
  const answer = await call<{ accept: boolean; offset?: number; reason?: string }>(mux, 'xfer.offer', { ...offer }, opts.offerTimeoutMs ?? 10 * 60_000);
  if (!answer.accept) {
    onProgress?.({ ...p, state: 'declined', error: answer.reason });
    throw new Error(answer.reason ?? 'The other device declined the file');
  }
  const offset = Math.max(0, Math.min(st.size, Math.floor(answer.offset ?? 0)));
  const hash = crypto.createHash('sha256');
  await hashRange(file, offset, hash);
  p.done = offset;
  p.state = 'sending';
  onProgress?.({ ...p });
  const s = mux.open({ k: 'file', id: offer.id, offset });
  const reply = s.readAll(64 * 1024);
  let last = 0;
  try {
    for await (const chunk of createReadStream(file, { start: offset, highWaterMark: 256 * 1024 })) {
      const c = chunk as Buffer;
      hash.update(c);
      await s.write(c);
      p.done += c.length;
      if (Date.now() - last > 200) {
        last = Date.now();
        onProgress?.({ ...p });
      }
    }
  } catch (e) {
    s.reset('sender stopped');
    onProgress?.({ ...p, state: 'failed', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  s.end({ sha256: hash.digest('hex'), size: st.size });
  p.state = 'checking';
  onProgress?.({ ...p });
  const r = JSON.parse((await reply).data.toString() || '{}') as { ok?: boolean; savedAs?: string; error?: string };
  if (!r.ok) {
    onProgress?.({ ...p, state: 'failed', error: r.error });
    throw new Error(r.error ?? 'The file did not arrive intact');
  }
  onProgress?.({ ...p, state: 'done', savedAs: r.savedAs });
  return { savedAs: r.savedAs };
}

/** The receiving side: keeps partial files so a retry continues where it stopped. */
export class Receiver {
  private offers = new Map<string, Offer>();

  constructor(private dir: () => string, private partDir: () => string) {}

  private part(id: string) {
    return path.join(this.partDir(), `${id.replace(/[^\w-]/g, '')}.part`);
  }

  /** Called for xfer.offer once the person (or automatic accept) said yes. */
  async accept(offer: Offer): Promise<{ accept: true; offset: number }> {
    this.offers.set(offer.id, offer);
    await fsp.mkdir(this.partDir(), { recursive: true });
    const have = await fsp.stat(this.part(offer.id)).then((s) => s.size).catch(() => 0);
    return { accept: true, offset: have <= offer.size ? have : 0 };
  }

  /** A 'file' stream. */
  async receive(s: Stream, onProgress?: (p: Progress) => void): Promise<void> {
    const id = String(s.meta.id ?? '');
    const offer = this.offers.get(id);
    if (!offer) return s.reset('not offered');
    const part = this.part(id);
    const offset = Number(s.meta.offset ?? 0);
    const have = await fsp.stat(part).then((x) => x.size).catch(() => 0);
    if (offset !== have) {
      if (offset !== 0) return s.reset('resume mismatch');
      await fsp.rm(part, { force: true });
    }
    const fh = await fsp.open(part, offset ? 'a' : 'w');
    const p: Progress = { id, name: offer.name, size: offer.size, done: offset, direction: 'receive', state: 'receiving' };
    let last = 0;
    onProgress?.({ ...p });
    const finished = new Promise<unknown>((resolve, reject) => {
      s.onend = resolve;
      s.onreset = (r) => reject(new Error(r));
    });
    s.ondata = async (c) => {
      await fh.write(c);
      p.done += c.length;
      if (p.done > offer.size) throw new Error('more data than offered');
      if (Date.now() - last > 200) {
        last = Date.now();
        onProgress?.({ ...p });
      }
    };
    void s.start();
    let trailer: { sha256?: string; size?: number } | undefined;
    try {
      trailer = (await finished) as typeof trailer;
    } catch (e) {
      await fh.close();
      // Keep what arrived: the next try continues from here.
      onProgress?.({ ...p, state: 'failed', error: e instanceof Error ? e.message : String(e) });
      return;
    }
    await fh.close();
    p.state = 'checking';
    onProgress?.({ ...p });
    const h = crypto.createHash('sha256');
    await hashRange(part, offer.size, h);
    const size = await fsp.stat(part).then((x) => x.size);
    if (size !== offer.size || h.digest('hex') !== trailer?.sha256) {
      await fsp.rm(part, { force: true });
      await s.writeJson({ ok: false, error: 'The file was damaged on the way; try again' }).catch(() => undefined);
      s.end();
      onProgress?.({ ...p, state: 'failed', error: 'damaged on the way' });
      return;
    }
    await fsp.mkdir(this.dir(), { recursive: true });
    const dest = await uniquePath(path.join(this.dir(), safeName(offer.name)));
    await fsp.rename(part, dest).catch(async () => {
      await fsp.copyFile(part, dest);
      await fsp.rm(part, { force: true });
    });
    if (offer.mtime) await fsp.utimes(dest, new Date(), new Date(offer.mtime)).catch(() => undefined);
    this.offers.delete(id);
    await s.writeJson({ ok: true, savedAs: dest });
    s.end();
    onProgress?.({ ...p, state: 'done', savedAs: dest });
  }
}

export async function uniquePath(p: string): Promise<string> {
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let i = 1; i < 10_000; i++) {
    const c = i === 1 ? p : `${base} ${i}${ext}`;
    try {
      await fsp.access(c);
    } catch {
      return c;
    }
  }
  return `${base} ${Date.now()}${ext}`;
}
