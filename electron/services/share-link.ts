// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Share links in the person's own storage (Island settings → Upload & share:
// WebDAV or S3-compatible). A video goes up with a small page next to it (the
// player, chapters, captions, the transcript and a download button); a picture
// goes up on its own. The link is copied, and the Island shows "Uploading…"
// then "Link copied". Nothing goes to a Keeper or Ashforde server.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { expiresAt, safeUploadName, signedSeconds, viewerHtml, type ShareKind } from '../../core/share-page';
import type { Caption, Chapter } from '../../core/studio/types';
import type { Progress } from '../../core/types';
import { getSecret, settings } from '../store';
import { writeText } from './clip';
import { mimeOf, uploadFolder } from './upload';

export interface ShareTarget {
  kind: ShareKind;
  /** where uploads go, in a few words ("cloud.example.com", "my-bucket at s3.eu-west-1.amazonaws.com") */
  where: string;
  /** the hours S3 links work for, from the settings */
  hours: number;
}

export interface ShareResult {
  link: string;
  kind: ShareKind;
  /** when the link stops working (S3) or the page says it has ended (WebDAV) */
  expiresAt?: number;
}

interface Hooks {
  progress(p: Progress): void;
  alert(title: string, detail?: string): void;
}
let hooks: Hooks | null = null;
export function setShareHooks(h: Hooks) {
  hooks = h;
}

const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export function shareTarget(): ShareTarget {
  const u = settings().island.upload;
  const where = u.kind === 's3' ? `${u.bucket || 'a bucket'} at ${host(u.url)}` : u.kind === 'webdav' ? host(u.publicUrl || u.url) : '';
  return { kind: u.kind, where, hours: u.expiresHours };
}

async function folder() {
  const cfg = settings().island.upload;
  return uploadFolder(cfg, await getSecret('upload'));
}

/** Runs an upload with the Island's "Uploading…" activity, copies the link and says so. */
async function withActivity(label: string, fn: (report: (fraction: number) => void) => Promise<ShareResult>): Promise<ShareResult> {
  const report = (f: number) => hooks?.progress({ task: 'upload', phase: label, done: Math.round(Math.max(0, Math.min(0.999, f)) * 1000), total: 1000 });
  report(0);
  try {
    const r = await fn(report);
    hooks?.progress({ task: 'upload', phase: 'Done', done: 1000, total: 1000 });
    await writeText(r.link);
    hooks?.alert('Link copied', r.link);
    return r;
  } catch (e) {
    hooks?.progress({ task: 'upload', phase: 'Done', done: 1000, total: 1000 });
    hooks?.alert('The upload did not finish', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export interface VideoShare {
  title: string;
  captions?: Caption[];
  chapters?: Chapter[];
  /** how long the link works (S3) or until the page says it has ended (WebDAV, 0 = no end) */
  hours: number;
}

/** Uploads a video and its page; the page's link is copied. */
export async function shareVideo(file: string, o: VideoShare): Promise<ShareResult> {
  const st = await fsp.stat(file);
  if (!st.isFile()) throw new Error('Only a finished video can be shared.');
  const f = await folder();
  const kind = f.kind;
  const ext = path.extname(file).toLowerCase() || '.mp4';
  const name = `${safeUploadName(o.title || path.basename(file, ext))}${ext}`;
  const seconds = signedSeconds(o.hours);
  const now = Date.now();
  return withActivity(name, async (report) => {
    await f.put(name, { file }, (sent, total) => report(total ? (sent / total) * 0.95 : 0));
    // WebDAV: the page sits next to the video and finds it by name; S3: each address is signed.
    const videoUrl = kind === 's3' ? f.link(name, { seconds }) : `./${encodeURIComponent(name)}`;
    const downloadUrl = kind === 's3' ? f.link(name, { seconds, download: name }) : videoUrl;
    const html = viewerHtml({
      title: o.title || path.basename(file, ext), videoUrl, downloadUrl, type: mimeOf(name).split(';')[0], fileName: name, size: st.size,
      captions: o.captions ?? [], chapters: o.chapters ?? [], madeAt: now, expiresAt: expiresAt(kind, o.hours, now),
    });
    await f.put('index.html', { data: html });
    report(0.99);
    return { link: f.link('index.html', { seconds }), kind, expiresAt: expiresAt(kind, o.hours, now) };
  });
}

/** Uploads a picture (a screenshot) and copies its link. */
export async function shareFile(file: string): Promise<ShareResult> {
  const st = await fsp.stat(file);
  if (!st.isFile()) throw new Error('Only a file can be shared.');
  const f = await folder();
  const name = safeUploadName(path.basename(file), 'picture.png');
  const cfg = settings().island.upload;
  return withActivity(name, async (report) => {
    await f.put(name, { file }, (sent, total) => report(total ? sent / total : 0));
    return { link: f.link(name), kind: f.kind, expiresAt: f.kind === 's3' ? Date.now() + Math.max(1, cfg.expiresHours) * 3_600_000 : undefined };
  });
}
