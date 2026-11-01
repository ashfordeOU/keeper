// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh's direct handoff (core/mesh/handoff.ts): when WireGuard is
// given the direct path, when it is confirmed, when it falls back to the
// shim, and the exact steps the helper is allowed to run for it. The real
// thing (two wireguard-go interfaces behind two NATs) runs in
// test/e2e/mesh-netns.cjs.

import { describe, expect, it } from 'vitest';
import { newIdentity } from '../core/link/identity';
import { deviceAddr6 } from '../core/mesh/address';
import { freshHandoff, HANDOFF, peerEndpointStep, stepHandoff, uapiEndpoint, type HandoffPeer, type HandoffSeen } from '../core/mesh/handoff';
import { newWgKey, signRecord, verifyRecord, type MeshRecord } from '../core/mesh/keys';
import { ifaceUp } from '../core/mesh/os-plan';
import { checkStep } from '../core/mesh/plan-guard';
import { deviceId } from '../core/link/identity';

const best = { host: '198.51.100.12', port: 41820 };
const T = '198.51.100.12:51820';
const seen = (now: number, more: Partial<HandoffSeen> = {}): HandoffSeen => ({ now, direct: true, best, peerWgPort: 51820, active: true, stats: { endpoint: '127.0.0.1:40000', rx: 100, tx: 100 }, allowed: true, ...more });

/** Runs looks every 2 s, feeding the stats a function gives. */
function run(p: HandoffPeer, from: number, to: number, f: (now: number, p: HandoffPeer) => Partial<HandoffSeen>) {
  const sets: { at: number; set: string }[] = [];
  for (let now = from; now <= to; now += 2000) {
    const r = stepHandoff(p, seen(now, f(now, p)));
    p = r.next;
    if (r.set) sets.push({ at: now, set: r.set });
  }
  return { p, sets };
}

describe('mesh: direct handoff', () => {
  it('waits for a steady, used direct path and the peer’s WireGuard port before handing off', () => {
    let p = freshHandoff(0);
    expect(stepHandoff(p, seen(0)).set).toBeUndefined(); // path just seen
    p = stepHandoff(p, seen(0)).next;
    expect(stepHandoff(p, seen(HANDOFF.stableMs - 1)).set).toBeUndefined();
    expect(stepHandoff(p, seen(HANDOFF.stableMs, { active: false })).set).toBeUndefined(); // nothing to move
    expect(stepHandoff(p, seen(HANDOFF.stableMs, { peerWgPort: undefined })).set).toBeUndefined(); // an older peer
    expect(stepHandoff(p, seen(HANDOFF.stableMs, { stats: undefined })).set).toBeUndefined(); // WireGuard not readable
    expect(stepHandoff(p, seen(HANDOFF.stableMs, { allowed: false })).set).toBeUndefined();
    const r = stepHandoff(p, seen(HANDOFF.stableMs));
    expect(r.set).toBe(T);
    expect(r.next).toMatchObject({ state: 'trying', endpoint: T });
  });

  it('is confirmed when WireGuard shows that endpoint and received bytes; re-tells WireGuard while the peer still uses its shim', () => {
    let p = stepHandoff(stepHandoff(freshHandoff(0), seen(0)).next, seen(10_000)).next;
    // WireGuard followed the peer's packets back to our shim: told again after a moment
    let r = stepHandoff(p, seen(12_000));
    expect(r.set).toBeUndefined();
    r = stepHandoff(r.next, seen(10_000 + HANDOFF.resetMs));
    expect(r.set).toBe(T);
    p = r.next;
    r = stepHandoff(p, seen(17_000, { stats: { endpoint: T, rx: 300, tx: 300 } }));
    expect(r.next.state).toBe('direct');
    expect(r.set).toBeUndefined();
  });

  it('gives up after 30 s and tries again later, waiting longer each time', () => {
    const p = stepHandoff(stepHandoff(freshHandoff(0), seen(0)).next, seen(10_000)).next;
    const { p: after, sets } = run(p, 12_000, 42_000, () => ({ stats: { endpoint: T, rx: 100, tx: 500 } })); // our side switched, nothing came back
    expect(after.state).toBe('shim');
    expect(after.failures).toBe(1);
    expect(sets.at(-1)?.set).toBe('shim');
    expect(after.retryAt - sets.at(-1)!.at).toBe(HANDOFF.backoffMs[0]);
    expect(stepHandoff(after, seen(sets.at(-1)!.at + 30_000)).set).toBeUndefined(); // not yet
  });

  it('falls back to the shim when the direct path stops answering, or Keeper’s path is no longer direct', () => {
    const direct: HandoffPeer = { ...freshHandoff(0), state: 'direct', endpoint: T, path: T, pathSince: 0, rx: 1000, tx: 1000, rxAt: 50_000 };
    // still flowing both ways: stays
    expect(stepHandoff(direct, seen(52_000, { stats: { endpoint: T, rx: 1100, tx: 1100 } })).next.state).toBe('direct');
    // sending, nothing back for more than 15 s
    const { p, sets } = run(direct, 52_000, 70_000, (now) => ({ stats: { endpoint: T, rx: 1000, tx: 1000 + now } }));
    expect(p.state).toBe('shim');
    expect(sets).toEqual([{ at: 66_000, set: 'shim' }]);
    // Keeper's probes say the path is gone
    expect(stepHandoff(direct, seen(52_000, { direct: false })).set).toBe('shim');
    // the peer went back through Keeper (WireGuard roamed to our shim): back to the shim, no penalty
    const r = stepHandoff(direct, seen(52_000, { stats: { endpoint: '127.0.0.1:40000', rx: 1200, tx: 1200 } }));
    expect(r).toMatchObject({ set: 'shim', next: { state: 'shim', failures: 0 } });
  });

  it('follows the path when it moves', () => {
    const direct: HandoffPeer = { ...freshHandoff(0), state: 'direct', endpoint: T, path: T, pathSince: 0 };
    const r = stepHandoff(direct, seen(5000, { best: { host: '192.168.1.20', port: 41820 } }));
    expect(r).toMatchObject({ set: '192.168.1.20:51820', next: { state: 'trying' } });
    expect(stepHandoff(direct, seen(5000, { best: { host: 'fd00::7', port: 41820 } })).set).toBe('[fd00::7]:51820');
  });

  it('builds exactly the steps the helper allows: wg set for the kernel, the control socket for wireguard-go', () => {
    const pub = newWgKey().pub;
    const k = peerEndpointStep({ os: 'linux', impl: 'kernel', iface: 'km-3f2a' }, pub, T)!;
    expect(k).toEqual({ file: 'wg', args: ['set', 'km-3f2a', 'peer', pub, 'endpoint', T] });
    expect(checkStep(k, { os: 'linux', wg: 'wg' })).toBeNull();
    const g = peerEndpointStep({ os: 'darwin', impl: 'wireguard-go', iface: 'utun7' }, pub, '[fd00::7]:51820')!;
    expect(g.stdin).toBe(uapiEndpoint(Buffer.from(pub, 'base64').toString('hex'), '[fd00::7]:51820'));
    expect(g.stdin).toMatch(/^set=1\npublic_key=[0-9a-f]{64}\nupdate_only=true\nendpoint=\[fd00::7\]:51820\n\n$/);
    expect(checkStep(g, { os: 'darwin' })).toBeNull();
    expect(peerEndpointStep({ os: 'win32', impl: 'wireguard-nt', iface: 'Keeper-Home' }, pub, T)).toBeNull();
    for (const bad of [
      ['set', 'km-3f2a', 'peer', pub, 'endpoint', 'evil.example:1'],
      ['set', 'km-3f2a', 'peer', pub, 'allowed-ips', '0.0.0.0/0'],
      ['set', 'eth0', 'peer', pub, 'endpoint', T],
      ['set', 'km-3f2a', 'peer', 'not-a-key', 'endpoint', T],
      ['set', 'km-3f2a', 'private-key', '/etc/shadow'],
    ]) expect(checkStep({ file: 'wg', args: bad }, { os: 'linux', wg: 'wg' })).not.toBeNull();
  });

  it('records carry the WireGuard port, checked like the mesh port', () => {
    const me = newIdentity();
    const dev = deviceId(me.publicKey);
    const net = '3f2a9c1d7e6b5a40';
    const rec = (wgp: number | undefined): MeshRecord => ({ v: 1, net, dev, to: 'abcdefghijkmnpqr', name: 'Desk', wg: newWgKey().pub, a6: deviceAddr6(net, dev), port: 41820, ...(wgp !== undefined ? { wgp } : {}), cands: [], pk: Buffer.alloc(32).toString('base64'), seq: 1, ts: Date.now() });
    expect(verifyRecord(me.publicKey, signRecord(me, rec(51820)), { net, to: 'abcdefghijkmnpqr' })).toMatchObject({ ok: true, rec: { wgp: 51820 } });
    expect(verifyRecord(me.publicKey, signRecord(me, rec(undefined)), { net, to: 'abcdefghijkmnpqr' }).ok).toBe(true);
    expect(verifyRecord(me.publicKey, signRecord(me, rec(70000)), { net, to: 'abcdefghijkmnpqr' })).toEqual({ ok: false, why: 'bad WireGuard port' });
  });

  it('starts wireguard-go without WG_PROCESS_FOREGROUND (setting it to 0 made it start itself again and again)', () => {
    for (const os of ['linux', 'darwin'] as const) {
      const step = ifaceUp({ os, iface: os === 'linux' ? 'km-3f2a' : 'utun7', impl: 'wireguard-go', bin: '/opt/wg/wireguard-go', a6: 'fd00::1', prefix6: 'fd00::/48', mtu: 1280, conf: 'set=1\n\n' }).find((s) => s.file === '/opt/wg/wireguard-go')!;
      expect(step.env).toBeUndefined();
    }
  });
});
