// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where your paired devices are, for Places & Tracks ("Your paired devices").
//
//   setOwnPositionSource(fn)   this device's own position (tracks supplies it)
//   devicePosition(device)     a paired device's last position, or null
//   pairedPositions()          every reachable device that shares its location
//
// A device answers only if its owner turned on "Share my location" for the
// device asking (Devices → that device → permissions; off by default). Each
// answer is logged in the answering device's audit log. Plain Node.

import { cleanPosition, type DevicePosition } from '../../../core/link/location';
import { call } from '../../../core/link/mux';
import type { LinkNode } from './node';

export type { DevicePosition };

type OwnPosition = { lat: number; lon: number; acc?: number; t: number; battery?: number } | null;
let ownSource: (() => Promise<OwnPosition> | OwnPosition) | null = null;
let current: LinkNode | null = null;

/** Places & Tracks tells Link where this device is (its own latest position). */
export function setOwnPositionSource(fn: (() => Promise<OwnPosition> | OwnPosition) | null) {
  ownSource = fn;
}

export function installLocation(node: LinkNode) {
  current = node;
  node.registerRpc('loc.get', 'location', async (p) => {
    const device = String(p.$device ?? '');
    const pos = ownSource ? await ownSource() : null;
    if (!pos) throw new Error('This device does not know where it is right now');
    const who = node.peer(device)?.name ?? 'A device';
    node.audit({ kind: 'location', direction: 'in', device, deviceName: who, title: `${who} saw this device’s location`, ok: true });
    return { lat: pos.lat, lon: pos.lon, acc: pos.acc, t: pos.t, battery: pos.battery };
  });
}

/** A paired device's last position; null when it does not share it, is not reachable, or does not know. */
export async function devicePosition(device: string, node: LinkNode | null = current): Promise<DevicePosition | null> {
  if (!node) return null;
  const dev = node.state().devices.find((d) => d.id === device);
  if (!dev) return null;
  try {
    const r = await call(await node.connect(device), 'loc.get', {}, 10_000);
    return cleanPosition(r, device, dev.name);
  } catch {
    return null;
  }
}

/** Every paired device that is online and shares its location with this one. */
export async function pairedPositions(node: LinkNode | null = current): Promise<DevicePosition[]> {
  if (!node) return [];
  const online = node.state().devices.filter((d) => d.online);
  const all = await Promise.all(online.map((d) => devicePosition(d.id, node)));
  return all.filter((x): x is DevicePosition => !!x);
}
