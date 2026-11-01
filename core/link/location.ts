// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A paired device's last known position, over Keeper Link (request
// 'loc.get'). Sent only when that device turned on "Share my location" for the
// device asking. Pure: checking what comes in.

export interface DevicePosition {
  /** the paired device's id */
  device: string;
  name: string;
  lat: number;
  lon: number;
  /** metres */
  acc?: number;
  /** when the position was taken (ms) */
  t: number;
  /** 0..100 */
  battery?: number;
}

/** A position from the other device, or null when it is not a sensible one. */
export function cleanPosition(x: unknown, device: string, name: string, now = Date.now()): DevicePosition | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const lat = Number(o.lat);
  const lon = Number(o.lon);
  const t = Number(o.t);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!Number.isFinite(t) || t <= 0 || t > now + 5 * 60_000) return null;
  const acc = Number(o.acc);
  const battery = Number(o.battery);
  return { device, name, lat, lon, t, acc: Number.isFinite(acc) && acc >= 0 ? acc : undefined, battery: Number.isFinite(battery) && battery >= 0 && battery <= 100 ? battery : undefined };
}
