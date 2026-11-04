// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Checking a maker's own download before Keeper opens it: Sparkle signs each
// update with an Ed25519 key whose public half ships inside the app
// (SUPublicEDKey in its Info.plist). A download that does not match is deleted
// and never opened. Node only (the main process and tests).

import { createPublicKey, verify } from 'node:crypto';

/** The fixed DER prefix of an Ed25519 public key (SubjectPublicKeyInfo); the raw 32 bytes follow. */
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

/** Whether `data` was signed by the holder of `publicKeyB64` (both base64, as Sparkle stores them). */
export function ed25519Valid(publicKeyB64: string, signatureB64: string, data: Buffer): boolean {
  try {
    const raw = Buffer.from(publicKeyB64.trim(), 'base64');
    const sig = Buffer.from(signatureB64.trim(), 'base64');
    if (raw.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: 'der', type: 'spki' });
    return verify(null, data, key, sig);
  } catch {
    return false;
  }
}

/** A safe file name for a download, from its address ("https://x/y/App%201.2.dmg" → "App 1.2.dmg"). */
export function downloadName(url: string, fallback = 'update'): string {
  let base = '';
  try { base = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); } catch { /* not an address */ }
  base = base.replace(/[\\/:*?"<>|\0-\x1f]/g, '').replace(/^\.+/, '').slice(0, 120);
  return base || fallback;
}
