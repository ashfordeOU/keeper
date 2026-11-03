// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Trust: "this is mine, it is fine". Keeper remembers the exact item by a
// fingerprint, so a trusted item stays off the Fix-it List across restarts and
// comes back when it changes: a new program or signer behind a login item, an
// extension's new version or permissions, a different certificate.

import type { Finding, Subject } from './types';

/** A short, stable hash (two FNV-1a passes, 64 bits as hex); the same in the window and the main process. */
export function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c ^ (i & 0xff), 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** What identifies the exact item: everything that, when it changes, should make Keeper ask again. */
export function subjectKey(s: Subject): string {
  switch (s.kind) {
    case 'login-item':
      // Signed: the developer (team, or the publisher), so an update from the same developer stays trusted
      // and another signer does not. Not signed: the program's own hash, so any new program asks again.
      return ['login', s.path, s.program ?? '', s.contentHash ?? '', s.signed && (s.team || s.signer) ? `signed:${s.team ?? s.signer}` : `hash:${s.codeHash ?? ''}`].join('\n');
    case 'extension':
      return ['ext', s.browser, s.id, s.version ?? '', [...s.permissions].sort().join(','), [...s.hostPermissions].sort().join(',')].join('\n');
    case 'certificate':
      return ['cert', s.sha256 ?? s.sha1 ?? s.name].join('\n');
  }
}

/** The fingerprint Trust remembers. Findings without a subject are known by their id. */
export function fingerprint(f: Pick<Finding, 'id' | 'title' | 'subject'>): string {
  return hashText(f.subject ? subjectKey(f.subject) : `id\n${f.id}`);
}
