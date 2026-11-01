// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SSH host keys: the SHA256 fingerprint people compare, and the person's own
// ~/.ssh/known_hosts (plain and hashed entries), so Keeper asks "is this the
// right computer?" once, the same way ssh does, and ssh agrees afterwards.

import { createHash, createHmac } from 'node:crypto';

/** "SHA256:…" as ssh prints it. */
export function fingerprint(keyBlob: Uint8Array): string {
  return 'SHA256:' + createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '');
}

/** The key type written at the start of an SSH public key blob (ssh-ed25519, ecdsa-sha2-nistp256, ssh-rsa…). */
export function keyType(keyBlob: Uint8Array): string {
  if (keyBlob.length < 4) return 'unknown';
  const len = (keyBlob[0] << 24) | (keyBlob[1] << 16) | (keyBlob[2] << 8) | keyBlob[3];
  return new TextDecoder().decode(keyBlob.subarray(4, 4 + Math.min(len, 64)));
}

/** How known_hosts names a host: "host", or "[host]:port" for other ports. */
export const hostPattern = (host: string, port: number) => (port === 22 ? host : `[${host}]:${port}`);

function patternMatches(field: string, name: string): boolean {
  if (field.startsWith('|1|')) {
    const [, , salt, hash] = field.split('|');
    if (!salt || !hash) return false;
    return createHmac('sha1', Buffer.from(salt, 'base64')).update(name).digest('base64') === hash;
  }
  let hit = false;
  for (const p of field.split(',')) {
    const neg = p.startsWith('!');
    const pat = neg ? p.slice(1) : p;
    const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    if (re.test(name)) {
      if (neg) return false;
      hit = true;
    }
  }
  return hit;
}

/** Is this key the one known_hosts has for the host? 'changed' means a different key is recorded: be careful. */
export function checkKnownHost(text: string, host: string, port: number, type: string, keyB64: string): 'known' | 'changed' | 'unknown' {
  const name = hostPattern(host, port);
  let other = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    // "@cert-authority" / "@revoked" markers.
    if (parts[0].startsWith('@')) {
      if (parts[0] === '@revoked' && parts[3] === keyB64) return 'changed';
      continue;
    }
    if (parts.length < 3 || !patternMatches(parts[0], name)) continue;
    if (parts[1] === type && parts[2] === keyB64) return 'known';
    if (parts[1] === type) other = true;
  }
  return other ? 'changed' : 'unknown';
}

export function knownHostsLine(host: string, port: number, type: string, keyB64: string): string {
  return `${hostPattern(host, port)} ${type} ${keyB64}`;
}
