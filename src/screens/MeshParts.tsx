// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Mesh outside its own page: the "mesh" label in the network and
// firewall views, the palette's mesh commands, and the choice of where each
// mesh control appears (tray, Island, palette).

import { useEffect, useState } from 'react';
import { looksLikeMeshAddr } from '../../core/mesh/label';
import { MESH_CONTROL_LABEL, MESH_PLACE_CHOICES, MESH_PLACE_LABEL, type MeshControl, type MeshState } from '../../core/mesh/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Check } from '../components/ui';
import '../styles/mesh.css';

let cached: MeshState | null = null;
const subs = new Set<(s: MeshState | null) => void>();
let watching = false;

/** The mesh state, shared by every small view that needs it (one read, refreshed on change). */
export function useMeshState(): MeshState | null {
  const [s, setS] = useState<MeshState | null>(cached);
  useEffect(() => {
    subs.add(setS);
    if (!api.mesh) return () => void subs.delete(setS);
    const read = () => void api.mesh.state().then((x) => { cached = x; for (const f of subs) f(x); }).catch(() => undefined);
    // read again whenever a view that needs it appears (the palette opens, a page loads)
    read();
    if (!watching) {
      watching = true;
      api.on('mesh-changed', read);
      api.on('features-changed', read);
    }
    return () => void subs.delete(setS);
  }, []);
  return s;
}

/** "mesh" after an address that belongs to your mesh, with the device's name when known. */
export function MeshTag({ ip, iface }: { ip?: string; iface?: string }) {
  const s = useMeshState();
  if (!s?.on) return null;
  const prefixes = s.networks.flatMap((n) => [n.prefix6, ...(n.prefix4 ? [n.prefix4] : [])]);
  const names = s.iface.name?.split(', ') ?? [];
  const byIface = iface && names.includes(iface);
  if (!byIface && !(ip && looksLikeMeshAddr(ip, prefixes))) return null;
  const peer = ip ? s.networks.flatMap((n) => n.peers).find((p) => p.a4 === ip || p.a6 === ip) : undefined;
  return <span className="badge mesh-tag" title="Private network for your devices (WireGuard)"><Icon name="graph" size={9} />mesh{peer ? ` · ${peer.name}` : ''}</span>;
}

/** Settings → Keeper Mesh: which places show which control. */
export function MeshPlaces() {
  const s = useMeshState();
  if (!s?.feature) return null;
  const set = (c: MeshControl, place: string, on: boolean) => {
    const cur = s.places[c];
    void api.mesh.setPlaces({ [c]: on ? [...cur, place] : cur.filter((x) => x !== place) }).then((x) => { cached = x; for (const f of subs) f(x); });
  };
  const places = ['tray', 'island', 'palette'] as const;
  return (
    <div className="mesh-places" data-testid="mesh-places">
      <div className="mesh-places-row head"><span>Control</span>{places.map((p) => <span key={p}>{MESH_PLACE_LABEL[p]}</span>)}<span>Mesh page</span></div>
      {(Object.keys(MESH_PLACE_CHOICES) as MeshControl[]).map((c) => (
        <div key={c} className="mesh-places-row">
          <span>{MESH_CONTROL_LABEL[c]}</span>
          {places.map((p) => <span key={p} data-testid={`mesh-place-${c}-${p}`}>{MESH_PLACE_CHOICES[c].includes(p) ? <Check on={s.places[c].includes(p)} onChange={(on) => set(c, p, on)} /> : <span className="muted">—</span>}</span>)}
          <span className="muted small">always</span>
        </div>
      ))}
    </div>
  );
}

export interface MeshCommand {
  id: string;
  label: string;
  group: 'Actions' | 'Go to';
  icon: string;
  keywords?: string;
  typed?: boolean;
  run: () => void | Promise<void>;
}

/** Palette commands: "Copy laptop's mesh address", turn the mesh on or off, pick an exit node. */
export function useMeshCommands(toast: (t: string) => void, go: (r: { name: 'mesh' }) => void): MeshCommand[] {
  const s = useMeshState();
  if (!s?.feature) return [];
  const out: MeshCommand[] = [{ id: 'mesh-page', label: 'Mesh', group: 'Go to', icon: 'graph', keywords: 'wireguard private network vpn devices exit node subnet', run: () => go({ name: 'mesh' }) }];
  if (s.places.power.includes('palette')) out.push({ id: 'mesh-toggle', label: s.on ? 'Turn Keeper Mesh Off' : 'Turn Keeper Mesh On', group: 'Actions', icon: 'graph', keywords: 'wireguard network on off', run: async () => { await api.mesh.setOn(!s.on); toast(s.on ? 'Mesh is off' : 'Mesh is on'); } });
  if (s.on && s.places.addresses.includes('palette'))
    for (const n of s.networks) {
      out.push({ id: `mesh-copy-me-${n.id}`, label: `Copy This Device’s Mesh Address${s.networks.length > 1 ? ` (${n.name})` : ''}`, group: 'Actions', icon: 'copy', keywords: `mesh ip address ${n.me.dns}`, run: async () => { await navigator.clipboard.writeText(n.me.a4 ?? n.me.a6); toast(`Copied ${n.me.a4 ?? n.me.a6}`); } });
      for (const p of n.peers.filter((x) => x.a6)) {
        const a = (p.a4 ?? p.a6)!;
        out.push({ id: `mesh-copy-${n.id}-${p.device}`, label: `Copy ${p.name}’s Mesh Address`, group: 'Actions', icon: 'copy', typed: true, keywords: `mesh ip address ${p.dns} ${a}`, run: async () => { await navigator.clipboard.writeText(a); toast(`Copied ${a}`); } });
        out.push({ id: `mesh-copy-name-${n.id}-${p.device}`, label: `Copy ${p.name}’s Mesh Name (${p.dns})`, group: 'Actions', icon: 'copy', typed: true, keywords: `mesh dns name ${p.dns}`, run: async () => { await navigator.clipboard.writeText(p.dns); toast(`Copied ${p.dns}`); } });
      }
    }
  if (s.on && s.places.exit.includes('palette')) {
    for (const p of s.networks.flatMap((n) => n.peers.filter((x) => x.offersExit)))
      out.push({ id: `mesh-exit-${p.device}`, label: `Send All Traffic Through ${p.name} (Exit Node)`, group: 'Actions', icon: 'globe', typed: true, keywords: 'mesh exit node vpn route internet', run: async () => { await api.mesh.setExit(p.device); toast(`Traffic goes through ${p.name}`); } });
    if (s.exit.using) out.push({ id: 'mesh-exit-off', label: 'Stop Using the Exit Node', group: 'Actions', icon: 'globe', keywords: 'mesh exit node off normal internet', run: async () => { await api.mesh.setExit(null); toast('Exit node off'); } });
  }
  return out;
}
