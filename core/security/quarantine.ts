// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Quarantine: a suspicious file is encrypted (AES-256-GCM, the same cipher as
// locked folders) and its original removed, so it can no longer run or be
// opened by accident. It can be put back byte for byte, or deleted for good.
//
// File format: "KQ1\n" + 12-byte nonce + 16-byte tag + ciphertext. The key is
// kept in the system keychain; the record (name, where it was, why) beside it.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('KQ1\n');

export function seal(data: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('quarantine key must be 32 bytes');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function open(sealed: Buffer, key: Buffer): Buffer {
  if (!sealed.subarray(0, 4).equals(MAGIC)) throw new Error('not a quarantined file');
  const iv = sealed.subarray(4, 16);
  const tag = sealed.subarray(16, 32);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(MAGIC);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(sealed.subarray(32)), d.final()]);
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
