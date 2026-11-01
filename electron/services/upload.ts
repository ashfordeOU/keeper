// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Upload & share" for shelves: sends files to the user's own WebDAV server or
// S3-compatible bucket and returns a link. Nothing goes to a Keeper server.

import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { UploadSettings } from '../../core/api';
import { objectUrl, presignGet, sha256hex, signHeaders, uriEncode } from '../../core/s3';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', zip: 'application/zip',
  mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', txt: 'text/plain; charset=utf-8', json: 'application/json', html: 'text/html',
};
const mimeOf = (p: string) => MIME[path.extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream';

/** A short random folder so shared links cannot be guessed from the file name. */
const token = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export async function uploadFile(file: string, cfg: UploadSettings, secret: string | undefined): Promise<string> {
  const st = await fsp.stat(file);
  if (!st.isFile()) throw new Error(`${path.basename(file)} is a folder; zip it first`);
  const name = path.basename(file);
  const key = [cfg.prefix.replace(/^\/+|\/+$/g, ''), token(), name].filter(Boolean).join('/');

  if (cfg.kind === 'webdav') {
    if (!cfg.url) throw new Error('Add your WebDAV folder address in Island settings');
    const base = cfg.url.replace(/\/+$/, '');
    const auth: Record<string, string> = cfg.username ? { authorization: 'Basic ' + Buffer.from(`${cfg.username}:${secret ?? ''}`).toString('base64') } : {};
    // Create the folders on the way (MKCOL fails harmlessly when they exist).
    const parts = key.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      await fetch(`${base}/${parts.slice(0, i).map((p) => uriEncode(p)).join('/')}/`, { method: 'MKCOL', headers: auth }).catch(() => undefined);
    }
    const target = `${base}/${uriEncode(key, true)}`;
    const res = await fetch(target, {
      method: 'PUT',
      headers: { ...auth, 'content-type': mimeOf(file) },
      body: Readable.toWeb(createReadStream(file)) as unknown as ReadableStream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}`);
    return cfg.publicUrl ? `${cfg.publicUrl.replace(/\/+$/, '')}/${uriEncode(key, true)}` : target;
  }

  if (cfg.kind === 's3') {
    if (!cfg.url || !cfg.bucket || !cfg.accessKeyId || !secret) throw new Error('Fill in the storage address, bucket, key and secret in Island settings');
    const creds = { accessKeyId: cfg.accessKeyId, secretAccessKey: secret, region: cfg.region || 'auto' };
    const url = objectUrl(cfg.url, cfg.bucket, key);
    const body = await fsp.readFile(file);
    const headers = signHeaders({ method: 'PUT', url, headers: { 'content-type': mimeOf(file), 'content-length': String(body.length) }, payloadHash: sha256hex(body), creds });
    delete (headers as Record<string, string>).host;
    const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });
    if (!res.ok) throw new Error(`Storage answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return presignGet(url, creds, Math.max(1, cfg.expiresHours) * 3600);
  }

  throw new Error('Choose where to upload in Island settings → Upload & share');
}
