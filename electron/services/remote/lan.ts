// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Finds other machines on the local network (home servers, NAS boxes, Macs,
// Windows PCs, Linux computers), says what each one is and how best to open
// its files, and lists the folders it shares, including external drives
// plugged into it.

import { execFile } from 'node:child_process';
import dgram from 'node:dgram';
import { buildMdnsQuery, parseMdnsResponse, type MdnsRecord } from '../../../core/places';
import { classifyDevice, devicesFromRecords, LAN_SERVICES, parseNetView, parseSmbclient, parseSmbutil, type DeviceGuess, type LanDevice, type Share } from '../../../core/remote/lan';
import { run } from '../../../core/platform';

export interface FoundDevice extends LanDevice {
  guess: DeviceGuess;
}

/** Listens for announcements for about two and a half seconds. */
export function scanLan(timeoutMs = 2500): Promise<FoundDevice[]> {
  return new Promise((resolve) => {
    const records: MdnsRecord[] = [];
    const extra: LanDevice[] = [];
    let sock: dgram.Socket | null = null;
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      try {
        sock?.close();
      } catch {
        /* closed */
      }
      const found = devicesFromRecords(records);
      for (const e of extra) if (!found.some((f) => f.name.toLowerCase() === e.name.toLowerCase())) found.push(e);
      // Machines that announce only a web page (home servers often do): a quick look at its title tells what it is.
      await Promise.all(found.filter((d) => d.protocols.includes('http') && !d.protocols.some((p) => p !== 'http' && p !== 'https')).map(async (d) => {
        d.webTitle = await pageTitle(d.address ?? d.host).catch(() => undefined);
      }));
      resolve(found.map((d) => ({ ...d, guess: classifyDevice(d) })));
    };
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (msg) => records.push(...parseMdnsResponse(new Uint8Array(msg))));
      sock.on('error', () => void finish());
      sock.bind(0, () => {
        const q = buildMdnsQuery(Object.keys(LAN_SERVICES));
        sock?.send(q, 5353, '224.0.0.251', () => undefined);
        setTimeout(() => sock?.send(q, 5353, '224.0.0.251', () => undefined), 500);
      });
    } catch {
      /* no network */
    }
    if (process.platform === 'win32') {
      // Windows sharing that does not announce itself over mDNS.
      void run('net', ['view'], 4000).then((r) => {
        for (const m of r.stdout.matchAll(/^\\\\(\S+)/gm)) extra.push({ name: m[1], host: m[1], protocols: ['smb'] });
      });
    }
    setTimeout(() => void finish(), timeoutMs);
  });
}

async function pageTitle(host: string): Promise<string | undefined> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const res = await fetch(`http://${host}/`, { signal: ctl.signal, redirect: 'follow' });
    const html = (await res.text()).slice(0, 20_000);
    return html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim();
  } finally {
    clearTimeout(t);
  }
}

/**
 * The folders a machine shares over SMB. Without a user name only the
 * folders open to guests are listed; the system's own tools are used, and
 * a password is passed through the environment, never the command line.
 */
export async function listShares(host: string, user?: string, password?: string): Promise<{ shares: Share[]; message?: string }> {
  if (!/^[\w.\-:[\]]+$/.test(host)) return { shares: [], message: 'That is not a valid server name.' };
  if (process.platform === 'win32') {
    const r = await run('net', ['view', `\\\\${host}`], 10_000);
    return r.ok ? { shares: parseNetView(r.stdout) } : { shares: [], message: (r.stderr || r.stdout).trim().split('\n')[0] || 'The server did not list its folders' };
  }
  if (process.platform === 'darwin') {
    const target = user ? `//${encodeURIComponent(user)}@${host}` : `//guest@${host}`;
    const r = await run('/usr/bin/smbutil', ['view', ...(user ? [] : ['-g']), target], 10_000);
    return r.ok ? { shares: parseSmbutil(r.stdout) } : { shares: [], message: 'The server did not list its folders without signing in. Connect to it to choose one.' };
  }
  const r = await new Promise<{ ok: boolean; stdout: string; stderr: string; missing?: boolean }>((resolve) =>
    execFile('smbclient', ['-g', '-L', `//${host}`, ...(user ? ['-U', user] : ['-N'])], { timeout: 10_000, encoding: 'utf8', env: { ...process.env, ...(user ? { PASSWD: password ?? '' } : {}) } }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '', missing: (err as NodeJS.ErrnoException | null)?.code === 'ENOENT' })));
  if (r.missing) return { shares: [], message: 'Listing shared folders needs smbclient (part of Samba). Connect with a folder name instead, e.g. smb://server/Media.' };
  return r.ok || r.stdout ? { shares: parseSmbclient(r.stdout) } : { shares: [], message: 'The server did not list its folders without signing in.' };
}
