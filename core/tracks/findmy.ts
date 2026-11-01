// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Find My app's own cache on a Mac: ~/Library/Caches/com.apple.findmy.fmipcore/
// Items.data (AirTags and other items) and Devices.data (your Apple devices).
//
// What works where (see docs/TRACKS.md):
//  - macOS 10.15 to 14.3: the files are plain JSON. Keeper reads them only when
//    the system lets your own account read them (macOS asks for Full Disk
//    Access for apps reading another app's caches), and only as fresh as the
//    last time the Find My app was open.
//  - macOS 14.4 and later: Apple encrypts these files with a key kept in the
//    system keychain for Apple's own apps. Keeper does not try to get that key
//    or decrypt the files; it says the files are encrypted and stops there.

import { validLL } from './geo';
import type { LivePosition } from './types';

type J = Record<string, unknown>;

export type FindMyRead =
  | { state: 'ok'; positions: LivePosition[] }
  | { state: 'encrypted' }
  | { state: 'unreadable'; reason: string };

/** Does this macOS version (e.g. "14.3.1", or Darwin "23.3.0") still write plain JSON? */
export function findMyPlainOn(version: string, darwin = false): boolean {
  const [maj, min] = version.split('.').map(Number);
  if (darwin) return maj < 23 || (maj === 23 && min < 4); // Darwin 23.4 = macOS 14.4
  return maj < 14 || (maj === 14 && min < 4);
}

/** Reads one of the two cache files' bytes. */
export function readFindMyCache(bytes: Uint8Array, kind: 'item' | 'device', now = Date.now()): FindMyRead {
  const head = new TextDecoder().decode(bytes.subarray(0, 8));
  if (head.startsWith('bplist')) return { state: 'encrypted' };
  const first = bytes.find((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09);
  if (first !== 0x5b && first !== 0x7b) return { state: 'encrypted' };
  let list: unknown;
  try {
    list = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { state: 'unreadable', reason: 'The file is not readable JSON.' };
  }
  const arr = Array.isArray(list) ? list : [list];
  const positions: LivePosition[] = [];
  for (const raw of arr as J[]) {
    const loc = (raw.location ?? {}) as J;
    const lat = Number(loc.latitude), lon = Number(loc.longitude);
    if (!validLL(lat, lon)) continue;
    const id = String(raw.identifier ?? raw.id ?? raw.baUUID ?? raw.deviceDiscoveryId ?? raw.name);
    const role = (raw.role ?? {}) as J;
    const name = String(raw.name ?? raw.deviceDisplayName ?? role.name ?? 'Item');
    const ts = Number(loc.timeStamp);
    const battery = kind === 'device' && typeof raw.batteryLevel === 'number' ? Math.round(raw.batteryLevel * 100) : undefined;
    const addr = (raw.address ?? {}) as J;
    const p: LivePosition = { id: `findmy:${kind}:${id}`, name, kind: kind === 'item' ? 'item' : 'device', source: 'findmy', t: Number.isFinite(ts) && ts > 0 ? ts : now, lat, lon };
    const acc = Number(loc.horizontalAccuracy);
    if (Number.isFinite(acc)) p.acc = acc;
    if (battery !== undefined) p.battery = battery;
    if (typeof raw.batteryStatus === 'string') p.charging = /charging/i.test(raw.batteryStatus) && !/not/i.test(raw.batteryStatus);
    const address = (addr.mapItemFullAddress ?? (Array.isArray(addr.formattedAddressLines) ? (addr.formattedAddressLines as string[]).join(', ') : undefined)) as string | undefined;
    if (address) p.address = address;
    positions.push(p);
  }
  return { state: 'ok', positions };
}
