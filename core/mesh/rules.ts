// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Access rules: who may reach which ports on this device over the mesh.
// Your own devices reach everything; devices you invited ("guests") reach
// nothing until you allow it. Pings and mesh names (DNS) always work, so
// the troubleshooting tools do. The result is put into the OS firewall,
// scoped to the mesh interface only (see os-plan.ts).

import type { MeshRole, MeshRule } from './types';

export type PortRange = [number, number];

/** "all" → null; "22, 80, 8000-8100" → ranges, sorted and merged. */
export function parsePorts(s: string): PortRange[] | null {
  const t = s.trim().toLowerCase();
  if (!t || t === 'all' || t === '*' || t === 'any') return null;
  const out: PortRange[] = [];
  for (const part of t.split(/[\s,]+/).filter(Boolean)) {
    const m = part.match(/^(\d{1,5})(?:-(\d{1,5}))?$/);
    if (!m) throw new Error(`“${part}” is not a port or a range like 8000-8100`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > 65535 || b < a) throw new Error(`“${part}” is not a valid port range`);
    out.push([a, b]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged: PortRange[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** The ports not in `ranges` (for Windows, whose block rules win over allow rules). */
export function complement(ranges: PortRange[]): PortRange[] {
  const out: PortRange[] = [];
  let next = 1;
  for (const [a, b] of ranges) {
    if (a > next) out.push([next, a - 1]);
    next = Math.max(next, b + 1);
  }
  if (next <= 65535) out.push([next, 65535]);
  return out;
}

export interface AclPeer {
  device: string;
  role: MeshRole;
  addrs: string[];
}

export interface AclEntry {
  /** addresses the traffic may come from */
  src: string[];
  proto: 'tcp' | 'udp' | 'any';
  /** null = every port */
  ports: PortRange[] | null;
}

/** Turns the rules and the current peers into firewall entries. */
export function compileAcl(rules: MeshRule[], peers: AclPeer[]): AclEntry[] {
  const out: AclEntry[] = [];
  const own = peers.filter((p) => p.role === 'own').flatMap((p) => p.addrs);
  if (own.length) out.push({ src: own, proto: 'any', ports: null });
  for (const r of rules) {
    const who = r.from === 'own' ? peers.filter((p) => p.role === 'own') : r.from === 'guests' ? peers.filter((p) => p.role === 'guest') : peers.filter((p) => p.device === r.from);
    const src = who.flatMap((p) => p.addrs);
    if (!src.length) continue;
    out.push({ src, proto: r.proto, ports: parsePorts(r.ports) });
  }
  return out;
}

/** The rules a new network starts with: none (own devices are allowed by default). */
export const DEFAULT_RULES: MeshRule[] = [];

export const describeRule = (r: MeshRule, name: (d: string) => string) =>
  `${r.from === 'own' ? 'Your devices' : r.from === 'guests' ? 'Guests' : name(r.from)} → ${r.ports.trim().toLowerCase() === 'all' ? 'every port' : `port ${r.ports}`}${r.proto === 'any' ? '' : ` (${r.proto.toUpperCase()})`}`;
