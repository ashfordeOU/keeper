// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// `keeper link …`: Keeper Link from the command line. Talks to the running
// app on this computer (loopback only, with the token in Keeper's data folder).

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { LinkState } from '../core/api-link';
import { keeperDataDir } from '../core/brain/paths';

async function control<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  let c: { port: number; token: string };
  try {
    c = JSON.parse(await fsp.readFile(path.join(keeperDataDir(), 'link', 'control.json'), 'utf8'));
  } catch {
    throw new Error('Keeper is not running, or Keeper Link is off. Open Keeper first.');
  }
  const r = await fetch(`http://127.0.0.1:${c.port}/local/${op}`, { method: 'POST', headers: { 'x-keeper-token': c.token, 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) throw new Error('Keeper is not answering. Is it still open?');
  if (r.status === 403) throw new Error('Keeper refused the request (restart Keeper and try again).');
  const j = (await r.json()) as { ok: boolean; r?: T; e?: string };
  if (!j.ok) throw new Error(j.e ?? 'Failed');
  return j.r as T;
}

const via = (v?: string) => ({ lan: 'local network', relay: 'relay', tunnel: 'tunnel', direct: 'direct', local: 'this computer' } as Record<string, string>)[v ?? ''] ?? '';

export async function cmdLink(rest: string[], flags: Record<string, string | boolean>, out: (data: unknown, human: () => void) => void) {
  const [sub, ...args] = rest;
  switch (sub ?? 'status') {
    case 'status': {
      const s = await control<LinkState>('state');
      return out(s.me, () => {
        console.log(`${s.me.name}  (${s.me.fingerprint})`);
        console.log(`  mode: ${s.settings.mode}${s.settings.localOnly ? ', never leaves this network' : ''}`);
        if (s.me.listening) console.log(`  listening on ${s.me.addresses.join(', ') || 'localhost'} port ${s.me.port}`);
        if (s.me.tunnel && s.me.tunnel.state !== 'off') console.log(`  tunnel: ${s.me.tunnel.state}${s.me.tunnel.url ? ` ${s.me.tunnel.url}` : ''}`);
        if (s.me.relay) console.log(`  relay: ${s.me.relay.connected ? 'connected' : 'not connected'} ${s.me.relay.url}`);
        console.log(`  ${s.devices.length} paired device(s), ${s.devices.filter((d) => d.online).length} reachable now`);
      });
    }
    case 'devices': {
      const s = await control<LinkState>('state');
      return out(s.devices, () => {
        if (!s.devices.length) console.log('No paired devices. Pair one in Keeper → Devices, or: keeper link pair <address> <code>');
        for (const d of s.devices) console.log(`${d.online ? '●' : '○'} ${d.name.padEnd(24)} ${d.id}  ${d.online ? via(d.via) || 'nearby' : 'not reachable'}${d.rtt !== undefined ? ` ${d.rtt} ms` : ''}`);
      });
    }
    case 'invite': {
      const inv = await control<{ code: string; link: string }>('invite');
      return out(inv, () => {
        console.log(`Code: ${inv.code.replace(/(\d{3})(\d{3})/, '$1 $2')}  (valid for 10 minutes)`);
        console.log(`Link: ${inv.link}`);
      });
    }
    case 'pair': {
      const [target, code] = args;
      if (!target) throw new Error('Usage: keeper link pair <address[:port]> <code>   or   keeper link pair keeper://pair?…');
      const r = await control<{ ok: boolean; error?: string; device?: string }>('pair', target.startsWith('keeper://') ? { link: target } : { address: target, code });
      if (!r.ok) throw new Error(r.error ?? 'Could not pair');
      return out(r, () => console.log('Paired. Compare the six digits Keeper shows on both screens before you confirm.'));
    }
    case 'send': {
      const [file, device] = args;
      if (!file || !device) throw new Error('Usage: keeper link send <file> <device name or id>');
      await control('send', { device, paths: [path.resolve(file)] });
      return out({ sent: true }, () => console.log(`Sent ${path.basename(file)} to ${device}`));
    }
    case 'check': {
      if (!args[0]) throw new Error('Usage: keeper link check <device>');
      const r = await control<{ ok: boolean; via?: string; rtt?: number; error?: string }>('check', { device: args[0] });
      return out(r, () => console.log(r.ok ? `Reachable over the ${via(r.via)}: ${r.rtt} ms` : r.error));
    }
    case 'forward': {
      const [device, spec] = args;
      if (!device || !spec) throw new Error('Usage: keeper link forward <device> <local port>[:<remote port>]   or   keeper link forward <device> socks:<local port>');
      const socks = spec.startsWith('socks:');
      const [lp, rp] = spec.replace(/^socks:/, '').split(':');
      const f = await control<{ localPort: number; port?: number }>('forward', { device, kind: socks ? 'socks' : 'port', localPort: Number(lp), port: rp ? Number(rp) : Number(lp), host: flags.host ? String(flags.host) : undefined });
      return out(f, () => console.log(socks ? `SOCKS5 proxy on 127.0.0.1:${f.localPort} through ${device}` : `127.0.0.1:${f.localPort} now reaches port ${f.port} on ${device} (until Keeper quits or you remove it in Devices)`));
    }
    default:
      throw new Error('Usage: keeper link [status | devices | invite | pair | send | check | forward]');
  }
}
