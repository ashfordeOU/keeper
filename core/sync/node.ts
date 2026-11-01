// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One device's side of sync: its folders, answering other devices, and rounds
// with each online device that shares a folder.

import { FolderSync, type SyncRound } from './engine';
import type { PeerTransport } from './ports';
import { Rpc } from './rpc';

export const SYNC_PURPOSE = 'keeper-sync/1';

export class SyncNode {
  folders = new Map<string, FolderSync>();
  private off: () => void;
  constructor(public transport: PeerTransport) {
    this.off = transport.onIncoming(SYNC_PURPOSE, (peer, ch) => {
      new Rpc(ch, async (method, params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        // Which folders this device shares with the asking one (so it can accept them).
        if (method === 'offers') return { result: [...this.folders.values()].filter((x) => x.cfg.devices.includes(peer)).map((x) => ({ id: x.cfg.id, label: x.cfg.label ?? x.cfg.id })) };
        const f = this.folders.get(String(p.folder));
        if (!f) throw new Error('No such folder here');
        return f.serve(peer, method, p);
      });
    });
  }

  add(f: FolderSync) {
    this.folders.set(f.cfg.id, f);
  }

  remove(id: string) {
    this.folders.delete(id);
  }

  /** A round with every online device for every folder shared with it. */
  async syncAll(): Promise<SyncRound[]> {
    const out: SyncRound[] = [];
    for (const peer of this.transport.listPeers().filter((p) => p.online)) {
      const shared = [...this.folders.values()].filter((f) => f.cfg.devices.includes(peer.id) && !f.cfg.paused);
      if (!shared.length) continue;
      let rpc: Rpc | undefined;
      try {
        rpc = new Rpc(await this.transport.open(peer.id, SYNC_PURPOSE));
        for (const f of shared) out.push({ ...(await f.syncWith(peer.id, rpc)), folder: f.cfg.id } as SyncRound & { folder: string });
      } catch (e) {
        out.push({ peer: peer.id, pulled: [], deleted: [], conflicts: [], skipped: [{ path: '', why: e instanceof Error ? e.message : String(e) }], bytes: 0 });
      } finally {
        rpc?.close();
      }
    }
    return out;
  }

  /** Folders other online devices share with this one that are not set up here yet. */
  async offers(): Promise<{ peer: string; peerName: string; id: string; label: string }[]> {
    const out: { peer: string; peerName: string; id: string; label: string }[] = [];
    for (const peer of this.transport.listPeers().filter((p) => p.online)) {
      let rpc: Rpc | undefined;
      try {
        rpc = new Rpc(await this.transport.open(peer.id, SYNC_PURPOSE), undefined, 15_000);
        const { result } = await rpc.call('offers', {});
        for (const o of result as { id: string; label: string }[]) if (!this.folders.has(o.id)) out.push({ peer: peer.id, peerName: peer.name, ...o });
      } catch {
        /* that device is busy or does not share anything */
      } finally {
        rpc?.close();
      }
    }
    return out;
  }

  /** Scans every folder; returns whether anything changed. */
  async scanAll(signal?: AbortSignal): Promise<boolean> {
    let any = false;
    for (const f of this.folders.values()) if (!f.cfg.paused && (await f.scan(signal)).changed.length) any = true;
    return any;
  }

  close() {
    this.off();
  }
}
