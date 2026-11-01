// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// `keeper remote …`: your own devices from the command line, through the
// running Keeper app on this computer (loopback only, with its token).
//
//   keeper remote list
//   keeper remote connect <device> [--view]
//   keeper remote help                      show a help code and password here
//   keeper remote help --code C --password P   help someone (opens their screen)
//   keeper remote exec <device> -- <command…>  needs "Run commands" there
//   keeper remote ssh-proxy <device> [--port 22]
//   keeper remote wake <device>
//   keeper remote send <device> <file…>
//   keeper remote forward <device> <local>[:<remote>] | socks:<port>
//   keeper remote screenshot <device> [--out file.jpg]
//   keeper remote info <device> | lock | sleep | restart <device> | log [device]

import { promises as fsp } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { LinkState } from '../core/api-link';
import type { AuditEntry } from '../core/link/audit';
import { sysInfoLines, type SysInfo } from '../core/link/actions';
import { formatCode } from '../core/link/help';
import { lastSeenLabel } from '../core/link/fleet';
import { keeperDataDir } from '../core/brain/paths';
import { cmdLink, control } from './link';

const via = (v?: string) => ({ lan: 'local network', relay: 'relay', tunnel: 'tunnel', direct: 'direct', local: 'this computer' } as Record<string, string>)[v ?? ''] ?? '';

export const REMOTE_USAGE = 'Usage: keeper remote list | connect <device> [--view] | help [--code C --password P] | exec <device> -- <command> | ssh-proxy <device> [--port N] | wake <device> | send <device> <file…> | forward <device> <port>[:<port>] | screenshot <device> [--out F] | info <device> | lock|sleep|restart <device> | log [device]';

/** The flags this command understands, read from the raw arguments (so `--` and what follows stay intact). */
function parse(argv: string[]) {
  const dash = argv.indexOf('--');
  const head = dash >= 0 ? argv.slice(0, dash) : argv;
  const tail = dash >= 0 ? argv.slice(dash + 1) : [];
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (['code', 'password', 'pw', 'port', 'out', 'timeout', 'name'].includes(k) && head[i + 1] !== undefined) flags[k] = head[++i];
      else flags[k] = true;
    } else rest.push(a);
  }
  return { rest, flags, tail };
}

/** ssh's ProxyCommand: stdin/stdout become a TCP stream to the device's port, over Keeper Link. */
async function sshProxy(device: string, port: number) {
  let c: { port: number; token: string };
  try {
    c = JSON.parse(await fsp.readFile(path.join(keeperDataDir(), 'link', 'control.json'), 'utf8'));
  } catch {
    throw new Error('Keeper is not running, or Keeper Link is off. Open Keeper first.');
  }
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect(c.port, '127.0.0.1');
    let head = Buffer.alloc(0);
    let open = false;
    sock.on('connect', () => sock.write(`GET /local/pipe?device=${encodeURIComponent(device)}&port=${port} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: keeper-pipe\r\nx-keeper-token: ${c.token}\r\n\r\n`));
    sock.on('data', (d) => {
      if (open) return;
      head = Buffer.concat([head, d]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      const status = head.subarray(0, head.indexOf('\r\n')).toString();
      if (!/^HTTP\/1.1 101/.test(status)) {
        sock.destroy();
        return reject(new Error(head.subarray(end + 4).toString().trim() || status));
      }
      open = true;
      const extra = head.subarray(end + 4);
      if (extra.length) process.stdout.write(extra);
      sock.removeAllListeners('data');
      sock.pipe(process.stdout);
      process.stdin.pipe(sock);
    });
    sock.on('error', reject);
    sock.on('close', () => resolve());
    process.stdin.on('end', () => sock.end());
  });
}

export async function cmdRemote(argv: string[], out: (data: unknown, human: () => void) => void) {
  const { rest, flags, tail } = parse(argv);
  const [sub, ...args] = rest;
  const need = (x: string | undefined, usage: string) => {
    if (!x) throw new Error(`Usage: keeper remote ${usage}`);
    return x;
  };
  switch (sub ?? 'list') {
    case 'list': {
      const s = await control<LinkState>('state');
      const now = Date.now();
      return out(s.devices, () => {
        if (!s.devices.length) console.log('No paired devices. Pair one in Keeper → Devices.');
        for (const d of s.devices) console.log(`${d.online ? '●' : '○'} ${d.name.padEnd(24)} ${d.online ? via(d.via) || 'nearby' : lastSeenLabel(now, false, d.lastSeen)}${d.meta?.group ? `  [${d.meta.group}]` : ''}${d.meta?.tags.length ? `  ${d.meta.tags.map((t) => `#${t}`).join(' ')}` : ''}`);
      });
    }
    case 'connect': {
      const device = need(args[0], 'connect <device> [--view]');
      const r = await control<{ sid: string }>('remote.connect', { device, view: !!flags.view });
      return out(r, () => console.log(`Opened ${device}’s screen in Keeper${flags.view ? ' (view only)' : ''}.`));
    }
    case 'help': {
      if (flags.code) {
        const r = await control<{ sid: string; name: string }>('remote.help', { code: String(flags.code), password: String(flags.password ?? flags.pw ?? ''), name: flags.name ? String(flags.name) : undefined });
        return out(r, () => console.log(`Connected to ${r.name}. Their screen is open in Keeper, view only until they let you control.`));
      }
      const o = await control<{ code: string; password: string; link: string; expires: number }>('remote.help', {});
      return out(o, () => {
        console.log(`Session code: ${formatCode(o.code)}`);
        console.log(`Password:     ${o.password}`);
        console.log(`Link:         ${o.link}`);
        console.log('Read both to the person helping you. Works once, for 10 minutes.');
      });
    }
    case 'exec': {
      const device = need(args[0], 'exec <device> -- <command>');
      const command = (tail.length ? tail : args.slice(1)).join(' ').trim();
      if (!command) throw new Error('Usage: keeper remote exec <device> -- <command>');
      const r = await control<{ code: number | null; stdout: string; stderr: string }>('remote.exec', { device, command, timeoutMs: flags.timeout ? Number(flags.timeout) * 1000 : undefined });
      return out(r, () => {
        if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
        if (r.stderr) process.stderr.write(r.stderr.endsWith('\n') ? r.stderr : r.stderr + '\n');
        process.exitCode = r.code ?? 124;
      });
    }
    case 'ssh-proxy':
      return sshProxy(need(args[0], 'ssh-proxy <device> [--port 22]'), Number(flags.port ?? 22));
    case 'wake': {
      const device = need(args[0], 'wake <device>');
      const r = await control<{ sent: number; via: string[] }>('remote.wake', { device });
      return out(r, () => console.log(`Wake signal sent${r.via.length ? ` (also through ${r.via.join(', ')})` : ''}.`));
    }
    case 'send': {
      const device = need(args[0], 'send <device> <file…>');
      const files = args.slice(1);
      if (!files.length) throw new Error('Usage: keeper remote send <device> <file…>');
      return cmdLink(['send', ...files.slice(0, 1), device], flags, out).then(async () => {
        for (const f of files.slice(1)) await cmdLink(['send', f, device], flags, out);
      });
    }
    case 'forward':
      return cmdLink(['forward', ...args], flags, out);
    case 'screenshot': {
      const device = need(args[0], 'screenshot <device> [--out file.jpg]');
      const r = await control<{ jpeg: string; width: number; height: number }>('remote.screenshot', { device });
      const file = path.resolve(String(flags.out ?? `${device.replace(/[^\w.-]+/g, '-')}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`));
      await fsp.writeFile(file, Buffer.from(r.jpeg, 'base64'));
      return out({ file, width: r.width, height: r.height }, () => console.log(`Saved ${file} (${r.width}×${r.height})`));
    }
    case 'info': {
      const r = await control<SysInfo>('remote.info', { device: need(args[0], 'info <device>') });
      return out(r, () => sysInfoLines(r).forEach(([k, v]) => console.log(`${k.padEnd(12)} ${v}`)));
    }
    case 'lock':
    case 'sleep':
    case 'restart': {
      const device = need(args[0], `${sub} <device>`);
      await control('remote.power', { device, action: sub });
      return out({ ok: true }, () => console.log(`${sub === 'lock' ? 'Locked' : sub === 'sleep' ? 'Sleeping:' : 'Restarting:'} ${device}`));
    }
    case 'log': {
      const r = await control<AuditEntry[]>('remote.audit', { device: args[0], limit: 50 });
      return out(r, () => r.forEach((e) => console.log(`${new Date(e.at).toLocaleString()}  ${e.ok ? ' ' : '!'} ${e.direction === 'in' ? '←' : '→'} ${e.title}${e.detail ? `  (${e.detail.split('\n')[0]})` : ''}`)));
    }
    default:
      throw new Error(REMOTE_USAGE);
  }
}
