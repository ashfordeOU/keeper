// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Direct handoff: once Keeper's data path has found a direct path to a peer
// and it has been steady for a while, WireGuard itself is told to send to the
// peer (its proven address with the peer's own WireGuard port), so packets no
// longer pass through Keeper's process. Keeper keeps watching WireGuard's own
// counters and its probes; when the direct path stops working it points
// WireGuard back at the local shim, and the packets go through Keeper again
// (direct UDP from the mesh socket, or the relay).
//
//   shim ──(direct ≥ 10 s, in use, peer told us its WireGuard port)──▶ trying
//   trying ──(WireGuard shows that endpoint and received bytes)──▶ direct
//   trying ──(30 s without that)──▶ shim, try again later (1 min, 5 min, 30 min)
//   direct ──(sending but nothing back for 15 s)──▶ shim (and later again)
//   any ──(Keeper's path is no longer direct, or it moved)──▶ shim / a new try
//
// WireGuard roams on its own: if the peer keeps sending through its shim, our
// WireGuard follows those packets back to our shim; that just means "not yet".
// Pure, so the steps are tested without a network; the engine and the
// namespace test run it against real WireGuard counters.

import type { MeshOS, Step } from './os-plan';
import { endpoint as joinEndpoint } from './wgconfig';

export type HandoffState = 'shim' | 'trying' | 'direct';

export interface HandoffPeer {
  state: HandoffState;
  /** where WireGuard was told to send (trying / direct) */
  endpoint?: string;
  /** when the current state began */
  since: number;
  /** when that endpoint was last given to WireGuard */
  setAt?: number;
  /** not before this time (after a failed try) */
  retryAt: number;
  failures: number;
  /** the direct path Keeper saw, and since when, unchanged */
  path?: string;
  pathSince?: number;
  /** WireGuard's counters at the last look */
  rx?: number;
  tx?: number;
  /** when received bytes last grew */
  rxAt?: number;
  /** received bytes when the try began */
  rx0?: number;
}

export interface HandoffSeen {
  now: number;
  /** Keeper's own path to the peer is direct (probes answered) */
  direct: boolean;
  best?: { host: string; port: number };
  /** the peer's WireGuard listen port, from its signed record */
  peerWgPort?: number;
  /** packets flowed recently (the peer is in use) */
  active: boolean;
  /** WireGuard's view of this peer, or undefined when it could not be read */
  stats?: { endpoint?: string; rx: number; tx: number };
  /** handoff allowed here (WireGuard kind, settings, not the exit node with a kill switch…) */
  allowed: boolean;
}

export const HANDOFF = { stableMs: 10_000, verifyMs: 30_000, resetMs: 5_000, brokenMs: 15_000, backoffMs: [60_000, 300_000, 1_800_000] };
export type HandoffTimings = typeof HANDOFF;

export const freshHandoff = (now = 0): HandoffPeer => ({ state: 'shim', since: now, retryAt: 0, failures: 0 });

/** One look: the new state, and what (if anything) to tell WireGuard: an endpoint, or 'shim'. */
export function stepHandoff(p: HandoffPeer, s: HandoffSeen, t: HandoffTimings = HANDOFF): { next: HandoffPeer; set?: string } {
  const now = s.now;
  const n: HandoffPeer = { ...p };
  const target = s.direct && s.best && s.peerWgPort ? joinEndpoint(s.best.host, s.peerWgPort) : undefined;
  // how long Keeper's direct path has stayed the same
  if (target !== n.path) { n.path = target; n.pathSince = now; }
  const rx = s.stats?.rx;
  const tx = s.stats?.tx;
  if (rx !== undefined && rx !== n.rx) n.rxAt = now;
  const sentMore = tx !== undefined && n.tx !== undefined && tx > n.tx;
  n.rx = rx ?? n.rx;
  n.tx = tx ?? n.tx;
  const toShim = (failed: boolean): { next: HandoffPeer; set?: string } => {
    const back: HandoffPeer = { ...n, state: 'shim', endpoint: undefined, since: now, setAt: undefined };
    if (failed) {
      back.failures = n.failures + 1;
      back.retryAt = now + t.backoffMs[Math.min(back.failures, t.backoffMs.length) - 1];
    }
    return { next: back, set: p.state === 'shim' ? undefined : 'shim' };
  };

  if (!s.allowed || !target) return toShim(false);

  if (n.state === 'shim') {
    if (now - (n.pathSince ?? now) >= t.stableMs && now >= n.retryAt && s.active && s.stats) {
      return { next: { ...n, state: 'trying', endpoint: target, since: now, setAt: now, rx0: rx, rxAt: now }, set: target };
    }
    return { next: n };
  }

  // the direct path moved (roaming): follow it
  if (n.endpoint !== target) return { next: { ...n, state: 'trying', endpoint: target, since: now, setAt: now, rx0: rx, rxAt: now }, set: target };

  if (n.state === 'trying') {
    if (s.stats?.endpoint === target && rx !== undefined && rx > (n.rx0 ?? 0)) return { next: { ...n, state: 'direct', since: now, failures: 0 } };
    if (now - n.since > t.verifyMs) return toShim(true);
    // WireGuard followed the peer's packets back to the shim: tell it again (the peer has not switched yet)
    if (s.stats?.endpoint !== target && now - (n.setAt ?? 0) >= t.resetMs) return { next: { ...n, setAt: now }, set: target };
    return { next: n };
  }

  // direct
  if (s.stats && s.stats.endpoint !== target) return toShim(false); // the peer went back through Keeper
  if (sentMore && now - (n.rxAt ?? now) > t.brokenMs) return toShim(true); // sending, nothing coming back
  return { next: n };
}

/** The UAPI request that changes one peer's endpoint on wireguard-go (other settings stay). */
export function uapiEndpoint(pubHex: string, ep: string): string {
  return `set=1\npublic_key=${pubHex}\nupdate_only=true\nendpoint=${ep}\n\n`;
}

/** The step that points one WireGuard peer at an endpoint (kernel: `wg set`; wireguard-go: its control socket). */
export function peerEndpointStep(c: { os: MeshOS; impl: string; iface: string; wg?: string }, pubB64: string, ep: string): Step | null {
  if (c.os === 'win32') return null; // WireGuard for Windows' tunnel service: not handed off (yet)
  if (c.os === 'linux' && c.impl === 'kernel') return { file: c.wg ?? 'wg', args: ['set', c.iface, 'peer', pubB64, 'endpoint', ep] };
  return { file: 'uapi', args: [c.iface], stdin: uapiEndpoint(Buffer.from(pubB64, 'base64').toString('hex'), ep) };
}
