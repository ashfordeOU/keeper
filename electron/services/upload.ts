// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Upload & share": sends files to the person's own WebDAV server or
// S3-compatible bucket and returns a link. Used by the Island's shelf, Studio's
// "Upload and copy link" and Capture's Upload. Nothing goes to a Keeper server.

import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import type { UploadSettings } from '../../core/api';
import { objectUrl, presignGet, sha256hex, signHeaders, uriEncode } from '../../core/s3';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', zip: 'application/zip',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', txt: 'text/plain; charset=utf-8', json: 'application/json', html: 'text/html; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8', srt: 'text/plain; charset=utf-8',
};
export const mimeOf = (p: string) => MIME[path.extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream';

/** A short random folder so shared links cannot be guessed from the file name. */
const token = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export type Body = { file: string } | { data: Buffer | string };

/** One upload folder in the person's storage: put files into it and make links to them. */
export interface UploadFolder {
  kind: 'webdav' | 's3';
  /** puts a file (from disk or memory); `progress` hears bytes sent so far */
  put(name: string, body: Body, progress?: (sent: number, total: number) => void): Promise<void>;
  /** a link anyone can open: S3 links are signed for `seconds`; `download` asks the browser to save it under that name */
  link(name: string, o?: { seconds?: number; download?: string }): string;
}

const NOT_SET = 'Choose where to upload in Island settings → Upload & share';

/** Checks the settings and opens a fresh, unguessable folder. */
export function uploadFolder(cfg: UploadSettings, secret: string | undefined): UploadFolder {
  const folder = [cfg.prefix.replace(/^\/+|\/+$/g, ''), token()].filter(Boolean).join('/');
  const keyOf = (name: string) => `${folder}/${name}`;

  if (cfg.kind === 'webdav') {
    if (!cfg.url) throw new Error('Add your WebDAV folder address in Island settings');
    const base = cfg.url.replace(/\/+$/, '');
    const auth: Record<string, string> = cfg.username ? { authorization: 'Basic ' + Buffer.from(`${cfg.username}:${secret ?? ''}`).toString('base64') } : {};
    let made = false;
    return {
      kind: 'webdav',
      async put(name, body, progress) {
        if (!made) {
          // Create the folders on the way (MKCOL fails harmlessly when they exist).
          const parts = folder.split('/');
          for (let i = 1; i <= parts.length; i++) {
            await fetch(`${base}/${parts.slice(0, i).map((p) => uriEncode(p)).join('/')}/`, { method: 'MKCOL', headers: auth }).catch(() => undefined);
          }
          made = true;
        }
        const target = `${base}/${uriEncode(keyOf(name), true)}`;
        let payload: BodyInit;
        let total: number;
        if ('file' in body) {
          total = (await fsp.stat(body.file)).size;
          let sent = 0;
          const count = new Transform({ transform(chunk: Buffer, _e, cb) { sent += chunk.length; progress?.(sent, total); cb(null, chunk); } });
          payload = Readable.toWeb(createReadStream(body.file).pipe(count)) as unknown as ReadableStream;
        } else {
          const buf = Buffer.isBuffer(body.data) ? body.data : Buffer.from(body.data, 'utf8');
          total = buf.length;
          payload = new Uint8Array(buf);
        }
        const res = await fetch(target, {
          method: 'PUT',
          headers: { ...auth, 'content-type': mimeOf(name), ...('file' in body ? {} : { 'content-length': String(total) }) },
          body: payload,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' });
        if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}`);
        progress?.(total, total);
      },
      link(name) {
        return cfg.publicUrl ? `${cfg.publicUrl.replace(/\/+$/, '')}/${uriEncode(keyOf(name), true)}` : `${base}/${uriEncode(keyOf(name), true)}`;
      },
    };
  }

  if (cfg.kind === 's3') {
    if (!cfg.url || !cfg.bucket || !cfg.accessKeyId || !secret) throw new Error('Fill in the storage address, bucket, key and secret in Island settings');
    const creds = { accessKeyId: cfg.accessKeyId, secretAccessKey: secret, region: cfg.region || 'auto' };
    return {
      kind: 's3',
      async put(name, body, progress) {
        const url = objectUrl(cfg.url, cfg.bucket, keyOf(name));
        const data = 'file' in body ? await fsp.readFile(body.file) : Buffer.isBuffer(body.data) ? body.data : Buffer.from(body.data, 'utf8');
        progress?.(0, data.length);
        const headers = signHeaders({ method: 'PUT', url, headers: { 'content-type': mimeOf(name), 'content-length': String(data.length) }, payloadHash: sha256hex(data), creds });
        delete (headers as Record<string, string>).host;
        const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(data) });
        if (!res.ok) throw new Error(`Storage answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
        progress?.(data.length, data.length);
      },
      link(name, o = {}) {
        const url = objectUrl(cfg.url, cfg.bucket, keyOf(name));
        if (o.download) url.searchParams.set('response-content-disposition', `attachment; filename="${o.download.replace(/["\\\r\n]/g, '')}"`);
        return presignGet(url, creds, o.seconds ?? Math.max(1, cfg.expiresHours) * 3600);
      },
    };
  }

  throw new Error(NOT_SET);
}

/** Uploads one file and returns its link (the shelf's Upload & share). */
export async function uploadFile(file: string, cfg: UploadSettings, secret: string | undefined): Promise<string> {
  const st = await fsp.stat(file);
  if (!st.isFile()) throw new Error(`${path.basename(file)} is a folder; zip it first`);
  const f = uploadFolder(cfg, secret);
  const name = path.basename(file);
  await f.put(name, { file });
  return f.link(name);
}
