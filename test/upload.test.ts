// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseNotify } from '../electron/services/notify-mirror';
import { uploadFile } from '../electron/services/upload';

const seen: { method: string; url: string; auth?: string; body: string }[] = [];
let base = '';
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
    res.statusCode = req.method === 'MKCOL' ? 201 : 200;
    res.end();
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const file = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'keeper-up-'));
  const p = path.join(dir, 'report final.txt');
  writeFileSync(p, 'shared text');
  return p;
};
const cfg = { username: '', bucket: '', region: 'us-east-1', accessKeyId: '', prefix: 'keeper', expiresHours: 24, publicUrl: '' };

describe('upload & share', () => {
  it('WebDAV: creates folders, PUTs the file, returns its address', async () => {
    seen.length = 0;
    const link = await uploadFile(file(), { ...cfg, kind: 'webdav', url: `${base}/dav`, username: 'ana' }, 'pw');
    const put = seen.find((s) => s.method === 'PUT')!;
    expect(put.body).toBe('shared text');
    expect(put.auth).toBe('Basic ' + Buffer.from('ana:pw').toString('base64'));
    expect(put.url).toMatch(/^\/dav\/keeper\/[a-z0-9]+\/report%20final\.txt$/);
    expect(seen.filter((s) => s.method === 'MKCOL').length).toBeGreaterThanOrEqual(2);
    expect(link).toBe(`${base}${put.url}`);
  });

  it('S3: signed PUT, then a presigned link that expires', async () => {
    seen.length = 0;
    const link = await uploadFile(file(), { ...cfg, kind: 's3', url: base, bucket: 'shared', accessKeyId: 'AKIDEXAMPLE' }, 'secret');
    const put = seen.find((s) => s.method === 'PUT')!;
    expect(put.url).toMatch(/^\/shared\/keeper\/[a-z0-9]+\/report%20final\.txt$/);
    expect(put.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=content-length;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(link).toContain('X-Amz-Expires=86400');
    expect(link).toContain('X-Amz-Signature=');
  });

  it('refuses when nothing is set up', async () => {
    await expect(uploadFile(file(), { ...cfg, kind: 'none', url: '' }, undefined)).rejects.toThrow(/Choose where to upload/);
  });
});

describe('notification mirror', () => {
  it('parses a Notify call from the session bus', () => {
    const block = `method call time=1 sender=:1.1 -> destination=:1.2 serial=7 path=/org/freedesktop/Notifications; interface=org.freedesktop.Notifications; member=Notify
   string "Chat"
   uint32 0
   string "chat-icon"
   string "Sam"
   string "Lunch at <b>noon</b>?"
   array [
   ]`;
    expect(parseNotify(block)).toEqual({ app: 'Chat', title: 'Sam', body: 'Lunch at noon?' });
    expect(parseNotify('signal member=NameAcquired')).toBeNull();
  });
});
