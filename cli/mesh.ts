// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// `keeper mesh …`: Keeper Mesh from the command line. Talks to the running
// app on this computer (loopback only, with the token in Keeper's data folder).

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { keeperDataDir } from '../core/brain/paths';
import { PATH_LABEL, type MeshDiag, type MeshState } from '../core/mesh/types';

async function control<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  let c: { port: number; token: string };
  try {
    c = JSON.parse(await fsp.readFile(path.join(keeperDataDir(), 'mesh', 'control.json'), 'utf8'));
  } catch {
    throw new Error('Keeper is not running, or Keeper Mesh is off in Settings → Features. Open Keeper first.');
  }
  const r = await fetch(`http://127.0.0.1:${c.port}/mesh/${op}`, { method: 'POST', headers: { 'x-keeper-token': c.token, 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) throw new Error('Keeper is not answering. Is it still open?');
  if (r.status === 403) throw new Error('Keeper refused the request (restart Keeper and try again).');
  const j = (await r.json()) as { ok: boolean; r?: T; e?: string };
  if (!j.ok) throw new Error(j.e ?? 'Failed');
  return j.r as T;
}

const USAGE = `keeper mesh up | down | status | peers | ip [device] | ping <device> | path <device>
            exit-node <device|off> | routes advertise <cidr,…> | rules [list | allow <from> <ports> [tcp|udp|any] | remove <id>] | config`;

export async function cmdMesh(rest: string[], _flags: Record<string, string | boolean>, out: (data: unknown, human: () => void) => void) {
  const [sub, ...args] = rest;
  const diag = (d: MeshDiag) => out(d, () => { for (const l of d.lines) console.log(l); if (!d.ok) process.exitCode = 1; });
  switch (sub ?? 'status') {
    case 'up':
    case 'down': {
      const s = await control<MeshState>(sub);
      return out(s.iface, () => console.log(sub === 'up' ? `Mesh is on: ${s.iface.state}${s.iface.message ? ` (${s.iface.message})` : ''}` : 'Mesh is off; interfaces, routes, DNS and firewall rules removed'));
    }
    case 'status': {
      const s = await control<MeshState>('state');
      return out(s, () => {
        console.log(`Keeper Mesh: ${s.on ? 'on' : 'off'} · network card: ${s.iface.state}${s.iface.name ? ` (${s.iface.name})` : ''}`);
        if (s.iface.message) console.log(`  ${s.iface.message}`);
        console.log(`  names: *.${s.dns.suffix} · split DNS ${s.dns.split}${s.dns.responder ? ` · ${s.dns.responder}` : ''}`);
        if (s.exit.using) console.log(`  exit node: ${s.networks.flatMap((n) => n.peers).find((p) => p.device === s.exit.using)?.name ?? s.exit.using}${s.exit.killSwitch ? ' (kill switch on)' : ''}`);
        if (s.exit.offering) console.log('  this device is offered as an exit node');
        for (const n of s.networks) console.log(`  ${n.name}: ${n.me.a4 ?? n.me.a6}  ${n.me.dns}  · ${n.peers.length} device(s)`);
      });
    }
    case 'peers': {
      const s = await control<MeshState>('state');
      const rows = s.networks.flatMap((n) => n.peers.map((p) => ({ net: n.name, ...p })));
      return out(rows, () => {
        if (!rows.length) console.log('No devices in your mesh yet. Add them on the Mesh page.');
        for (const p of rows) console.log(`${p.path === 'none' ? '○' : '●'} ${p.name.padEnd(22)} ${(p.a4 ?? p.a6 ?? '—').padEnd(40)} ${p.dns.padEnd(26)} ${PATH_LABEL[p.path]}${p.latencyMs !== undefined ? ` ${p.latencyMs} ms` : ''}${p.role === 'guest' ? ' (guest)' : ''}`);
      });
    }
    case 'ip': {
      const s = await control<MeshState>('state');
      const q = args[0]?.toLowerCase();
      if (!q) {
        const n = s.networks[0];
        if (!n) throw new Error('No mesh network yet');
        return out({ v4: n.me.a4, v6: n.me.a6 }, () => console.log(n.me.a4 ?? n.me.a6));
      }
      const p = s.networks.flatMap((n) => n.peers).find((x) => x.device === q || x.name.toLowerCase() === q || x.dns === q || x.dns.split('.')[0] === q);
      if (!p?.a6) throw new Error(`No device called ${args[0]} in your mesh`);
      return out({ v4: p.a4, v6: p.a6 }, () => console.log(p.a4 ?? p.a6));
    }
    case 'ping':
      if (!args[0]) throw new Error('Usage: keeper mesh ping <device>');
      return diag(await control<MeshDiag>('ping', { device: args[0] }));
    case 'path':
      if (!args[0]) throw new Error('Usage: keeper mesh path <device>');
      return diag(await control<MeshDiag>('path', { device: args[0] }));
    case 'exit-node': {
      if (!args[0]) throw new Error('Usage: keeper mesh exit-node <device|off>');
      const s = await control<MeshState>('exit', { device: args[0] });
      return out(s.exit, () => console.log(s.exit.using ? 'All traffic now goes through the exit node' : 'Exit node off: normal internet'));
    }
    case 'routes': {
      if (args[0] !== 'advertise') throw new Error('Usage: keeper mesh routes advertise <cidr>[,<cidr>…]   (empty to stop)');
      const s = await control<MeshState>('advertise', { routes: args.slice(1).join(',') });
      return out(s.advertise, () => console.log(s.advertise.routes.length ? `Sharing ${s.advertise.routes.join(', ')} (confirm on this computer)` : 'Not sharing any local network'));
    }
    case 'rules': {
      const [what, ...r] = args;
      if (!what || what === 'list') {
        const s = await control<MeshState>('state');
        return out(s.networks.map((n) => ({ net: n.name, rules: n.rules })), () => {
          for (const n of s.networks) {
            console.log(`${n.name}: your devices reach everything${n.rules.length ? '' : '; guests reach nothing'}`);
            for (const x of n.rules) console.log(`  ${x.id}  ${x.from} → ${x.ports} (${x.proto})`);
          }
        });
      }
      if (what === 'allow') {
        if (r.length < 2) throw new Error('Usage: keeper mesh rules allow <guests|own|device> <ports> [tcp|udp|any]');
        await control('rule-add', { from: r[0], ports: r[1], proto: r[2] ?? 'tcp' });
        return out(true, () => console.log('Rule saved'));
      }
      if (what === 'remove') {
        await control('rule-remove', { id: r[0] });
        return out(true, () => console.log('Rule removed'));
      }
      throw new Error(USAGE);
    }
    case 'config': {
      const c = await control<string>('config', { net: args[0] });
      return out(c, () => process.stdout.write(c));
    }
    default:
      throw new Error(USAGE);
  }
}
