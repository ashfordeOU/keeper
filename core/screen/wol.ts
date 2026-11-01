// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Wake-on-LAN: a sleeping computer listens for a "magic packet" — six 0xFF
// bytes and then its network card's address sixteen times — sent as a UDP
// broadcast on its own network. Keeper learns each paired computer's addresses
// while it is awake, and any awake Keeper on that network can send the packet.

export function parseMac(s: string): Uint8Array | null {
  const hex = s.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12 || /^0+$/.test(hex) || /^f+$/.test(hex)) return null;
  const out = new Uint8Array(6);
  for (let i = 0; i < 6; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function formatMac(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join(':');
}

/** 102 bytes: FF×6, then the address ×16. */
export function magicPacket(mac: string): Uint8Array {
  const m = parseMac(mac);
  if (!m) throw new Error(`Not a network card address: ${mac}`);
  const p = new Uint8Array(6 + 16 * 6).fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) p.set(m, 6 + i * 6);
  return p;
}

/** The broadcast address of an IPv4 network (where the magic packet goes). */
export function broadcastAddress(ip: string, netmask: string): string | null {
  const a = ip.split('.').map(Number);
  const m = netmask.split('.').map(Number);
  if (a.length !== 4 || m.length !== 4 || [...a, ...m].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return a.map((x, i) => (x & m[i]) | (~m[i] & 255)).join('.');
}

/** Wired and Wi-Fi cards worth remembering: real addresses, not loopback, VPN or container bridges. */
export function wakeableInterfaces(ifs: Record<string, { mac: string; family: string; internal: boolean; address: string; netmask: string }[] | undefined>): { name: string; mac: string; broadcast: string }[] {
  const out: { name: string; mac: string; broadcast: string }[] = [];
  for (const [name, list] of Object.entries(ifs)) {
    if (/^(lo|docker|br-|veth|virbr|utun|tun|tap|wg|tailscale|zt|vmnet|vboxnet|awdl|llw|bridge)/i.test(name)) continue;
    for (const a of list ?? []) {
      if (a.internal || a.family !== 'IPv4' || !parseMac(a.mac)) continue;
      const b = broadcastAddress(a.address, a.netmask);
      if (b) out.push({ name, mac: a.mac.toLowerCase(), broadcast: b });
    }
  }
  return out;
}
