// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Locations at rest: AES-256-GCM with a random key that the system keychain
// holds (the same pattern Keeper Link uses). Main process and tests only.

import crypto from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

const MAGIC = Buffer.from('KTRK1');
const PLAIN = Buffer.from('KTRK0');

export const newKey = () => crypto.randomBytes(32);

/** Gzip, then encrypt (or only gzip when there is no key: no keychain on this system). */
export function seal(json: string, key: Buffer | undefined): Buffer {
  const packed = gzipSync(Buffer.from(json, 'utf8'));
  if (!key) return Buffer.concat([PLAIN, packed]);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const body = Buffer.concat([c.update(packed), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function isSealed(b: Buffer): boolean {
  return b.subarray(0, 5).equals(MAGIC);
}

export function open(b: Buffer, key: Buffer | undefined): string {
  if (b.subarray(0, 5).equals(PLAIN)) return gunzipSync(b.subarray(5)).toString('utf8');
  if (!isSealed(b)) throw new Error('This is not a Places & Tracks data file.');
  if (!key) throw new Error('The key for your location data is missing from the keychain.');
  const iv = b.subarray(5, 17), tag = b.subarray(17, 33);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(MAGIC);
  d.setAuthTag(tag);
  return gunzipSync(Buffer.concat([d.update(b.subarray(33)), d.final()])).toString('utf8');
}
