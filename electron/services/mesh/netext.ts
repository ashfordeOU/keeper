// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's side of the macOS Network Extension variant of the mesh
// (native/macos/KeeperMeshTunnel): it runs the bundled keeper-mesh-ne tool
// with one JSON request and reads one JSON line back. The tunnel itself
// (WireGuard inside a packet tunnel system extension) needs a Developer ID
// with Apple's Network Extension entitlement, so until such a signed build
// ships, `available()` is false and the helper with wireguard-go is used.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseUapiGet, type WgPeerStats } from '../../../core/mesh/wgconfig';

export interface NeReply {
  ok: boolean;
  message?: string;
  status?: string;
  /** WireGuard's counters, as UAPI "get" text */
  uapi?: string;
  needsApproval?: boolean;
}

export type NeRequest =
  | { cmd: 'activate' | 'stats' | 'down' | 'status' }
  | { cmd: 'up'; name: string; wgQuickConfig: string }
  | { cmd: 'sync'; wgQuickConfig: string }
  | { cmd: 'endpoint'; publicKey: string; endpoint: string };

type Spawn = typeof spawn;

/** Keeper.app/Contents/MacOS/keeper-mesh-ne, next to Keeper's own executable. */
export const defaultTool = () => path.join(path.dirname(process.execPath), 'keeper-mesh-ne');

export class NetworkExtensionPlane {
  readonly kind = 'network-extension' as const;
  why?: string;

  constructor(private tool = defaultTool(), private o: { platform?: NodeJS.Platform; spawn?: Spawn; timeoutMs?: number } = {}) {
    this.why = 'needs Keeper signed with a Developer ID that carries Apple’s Network Extension entitlement';
  }

  async available(): Promise<boolean> {
    return (this.o.platform ?? process.platform) === 'darwin' && existsSync(this.tool);
  }

  /** One request to the tool; never throws (a failure is an answer with ok: false). */
  call(req: NeRequest): Promise<NeReply> {
    return new Promise((resolve) => {
      const p = (this.o.spawn ?? spawn)(this.tool, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let done = false;
      const finish = (r: NeReply) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(r);
      };
      // installing the extension waits for the person to approve it
      const t = setTimeout(() => { p.kill(); finish({ ok: false, message: 'The network extension did not answer' }); }, this.o.timeoutMs ?? (req.cmd === 'activate' ? 130_000 : 30_000));
      p.stdout?.on('data', (d) => (out += d));
      p.on('error', (e) => finish({ ok: false, message: e.message }));
      p.on('close', () => {
        const line = out.trim().split('\n').pop() ?? '';
        try {
          const j = JSON.parse(line) as NeReply;
          finish(typeof j.ok === 'boolean' ? j : { ok: false, message: 'Unexpected answer from the network extension' });
        } catch {
          finish({ ok: false, message: 'Unexpected answer from the network extension' });
        }
      });
      p.stdin?.end(JSON.stringify(req));
    });
  }

  activate() { return this.call({ cmd: 'activate' }); }
  up(name: string, wgQuickConfig: string) { return this.call({ cmd: 'up', name, wgQuickConfig }); }
  sync(wgQuickConfig: string) { return this.call({ cmd: 'sync', wgQuickConfig }); }
  /** the direct handoff inside the extension */
  endpoint(publicKey: string, endpoint: string) { return this.call({ cmd: 'endpoint', publicKey, endpoint }); }
  down() { return this.call({ cmd: 'down' }); }

  async stats(): Promise<WgPeerStats[]> {
    const r = await this.call({ cmd: 'stats' });
    return r.ok && r.uapi ? parseUapiGet(r.uapi) : [];
  }
}
