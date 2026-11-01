// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What another device may do on this one. Every request that arrives over a
// link is checked here first; nothing is allowed by default except offering
// files, which still asks before anything is saved.

export type Permission = 'sendFiles' | 'browse' | 'write' | 'clipboard' | 'screenView' | 'screenControl' | 'terminal' | 'sync' | 'forward';

export const PERMISSIONS: { id: Permission; label: string; detail: string }[] = [
  { id: 'sendFiles', label: 'Send files to this device', detail: 'You are asked before anything is saved, unless you turn on automatic accept.' },
  { id: 'browse', label: 'See shared folders', detail: 'Only the folders you share under Shared folders, read-only.' },
  { id: 'write', label: 'Change shared folders', detail: 'Add, rename and remove files in the shared folders.' },
  { id: 'clipboard', label: 'Shared clipboard', detail: 'Text you copy appears on the other device and the other way round.' },
  { id: 'screenView', label: 'See this screen', detail: 'Watch this screen from the other device.' },
  { id: 'screenControl', label: 'Control this computer', detail: 'Use the mouse and keyboard from the other device.' },
  { id: 'terminal', label: 'Open a terminal here', detail: 'Run commands on this computer as you.' },
  { id: 'sync', label: 'Sync and back up folders', detail: 'Keep folders the same on both devices.' },
  { id: 'forward', label: 'Reach ports on this computer', detail: 'Connect to services running here (for example a web server on port 3000).' },
];

export type PermissionSet = Partial<Record<Permission, boolean>>;

export const DEFAULT_PERMISSIONS: PermissionSet = { sendFiles: true };

/** Which permission each request needs; a request that is not listed is refused. */
export const METHOD_PERMISSION: Record<string, Permission | null> = {
  hello: null,
  ping: null,
  'xfer.offer': 'sendFiles',
  'fs.shares': 'browse',
  'fs.list': 'browse',
  'fs.stat': 'browse',
  'fs.read': 'browse',
  'fs.write': 'write',
  'fs.mkdir': 'write',
  'fs.rename': 'write',
  'fs.remove': 'write',
  'clip.set': 'clipboard',
  'clip.get': 'clipboard',
  'tcp.open': 'forward',
};

export function allowed(perms: PermissionSet | undefined, method: string): boolean {
  if (!(method in METHOD_PERMISSION)) return false;
  const need = METHOD_PERMISSION[method];
  return need === null || !!perms?.[need];
}

/** Ports a forward may reach: only this computer unless the person allows the wider network. */
export function forwardTargetAllowed(host: string, opts: { lan?: boolean }): boolean {
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (!opts.lan) return false;
  // Private ranges only: never the open internet through someone else's computer.
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  if (/^[a-z0-9-]+(\.local|\.lan|\.home\.arpa)?$/.test(h) && !h.includes('.') ) return true;
  return /\.(local|lan|home\.arpa)$/.test(h);
}
