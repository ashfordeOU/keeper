// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One zlib stream for the life of a VNC connection (ZRLE keeps its dictionary
// across rectangles). Each call inflates one rectangle's bytes. Node only.

import zlib from 'node:zlib';

export function createInflater(): { inflate: (data: Uint8Array) => Promise<Uint8Array>; close: () => void } {
  const inf = zlib.createInflate();
  let chunks: Buffer[] = [];
  let failed: Error | null = null;
  inf.on('data', (d: Buffer) => chunks.push(d));
  inf.on('error', (e) => { failed = e; });
  // Calls are queued so each rectangle's output is collected on its own.
  let tail: Promise<unknown> = Promise.resolve();
  const inflate = (data: Uint8Array) => {
    const p = tail.then(() => new Promise<Uint8Array>((resolve, reject) => {
      if (failed) return reject(failed);
      inf.write(Buffer.from(data));
      inf.flush(zlib.constants.Z_SYNC_FLUSH, () => {
        if (failed) return reject(failed);
        const out = Buffer.concat(chunks);
        chunks = [];
        resolve(new Uint8Array(out.buffer, out.byteOffset, out.length));
      });
    }));
    tail = p.catch(() => undefined);
    return p;
  };
  return { inflate, close: () => inf.destroy() };
}

/** Tight's four zlib streams, each kept for the connection; a reset flag starts one afresh. */
export function createTightInflaters(): { inflate: (stream: number, data: Uint8Array, reset: boolean) => Promise<Uint8Array>; close: () => void } {
  const streams: ({ inflate: (data: Uint8Array) => Promise<Uint8Array>; close: () => void } | null)[] = [null, null, null, null];
  return {
    inflate: (stream, data, reset) => {
      const i = stream & 3;
      if (reset && streams[i]) { streams[i]!.close(); streams[i] = null; }
      streams[i] ??= createInflater();
      return streams[i]!.inflate(data);
    },
    close: () => { for (const s of streams) s?.close(); },
  };
}
