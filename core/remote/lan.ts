// SPDX-License-Identifier: AGPL-3.0-or-later
// Other machines on the local network: what they are (a home server, a NAS,
// a Mac, a Windows PC, a Linux box), the best way to open their files, and the
// shared folders (and the external drives behind them) they offer.

import type { DeviceKind } from './types';

export type LanProtocol = 'smb' | 'afp' | 'nfs' | 'sftp' | 'ssh' | 'ftp' | 'webdav' | 'webdavs' | 'http' | 'https';

export interface LanDevice {
  name: string;
  host: string;
  address?: string;
  protocols: LanProtocol[];
  /** TXT records from the announcements, e.g. model=MacBookPro18,3 */
  txt?: Record<string, string>;
  /** title of the web page it serves, when probed */
  webTitle?: string;
}

export interface DeviceGuess {
  kind: DeviceKind;
  /** "Home server", "NAS", "Mac"… */
  label: string;
  /** a more precise name when known, e.g. "Synology NAS" */
  detail?: string;
  /** the protocol Keeper suggests for opening its files */
  suggest?: 'smb' | 'sftp' | 'webdav' | 'ftp' | 'nfs' | 'afp';
  /** a short note on how to share files from it, when nothing is offered yet */
  tip?: string;
}

const HOME_SERVERS: [RegExp, string][] = [
  [/umbrel/i, 'umbrelOS'],
  [/casaos|zimaos|zimaboard|zimablade/i, 'CasaOS / ZimaOS'],
  [/start9|embassy/i, 'StartOS'],
  [/yunohost/i, 'YunoHost'],
  [/homeassistant|home-assistant|hassio/i, 'Home Assistant'],
  [/runtipi|tipi\b/i, 'Runtipi'],
  [/cosmos-?server/i, 'Cosmos'],
  [/nextcloud|nextcloudpi|ncp\b/i, 'Nextcloud'],
  [/raspberrypi|raspi\b|\bpi\d?\b/i, 'Raspberry Pi'],
];

const NAS: [RegExp, string][] = [
  [/synology|diskstation|\bds\d{3,4}/i, 'Synology'],
  [/qnap|\bts-\d{3}/i, 'QNAP'],
  [/truenas|freenas/i, 'TrueNAS'],
  [/unraid|\btower\b/i, 'Unraid'],
  [/openmediavault|\bomv\b/i, 'openmediavault'],
  [/wdmycloud|mycloud|\bwd[- ]?my/i, 'WD My Cloud'],
  [/asustor|\bas\d{4}/i, 'ASUSTOR'],
  [/terramaster|\bf\d-\d{3}/i, 'TerraMaster'],
  [/netgear|readynas/i, 'ReadyNAS'],
  [/ugreen|nasync/i, 'UGREEN NAS'],
  [/time ?capsule|airport/i, 'AirPort Time Capsule'],
];

/** "MacBookPro18,3" → "MacBook Pro"; newer "Mac15,6"-style ids just say "Mac". */
export function macName(model: string): string | undefined {
  if (!model) return undefined;
  const names: [RegExp, string][] = [[/^MacBookPro/i, 'MacBook Pro'], [/^MacBookAir/i, 'MacBook Air'], [/^MacBook/i, 'MacBook'], [/^Macmini/i, 'Mac mini'], [/^iMacPro/i, 'iMac Pro'], [/^iMac/i, 'iMac'], [/^MacStudio/i, 'Mac Studio'], [/^MacPro/i, 'Mac Pro'], [/^Mac\d/i, 'Mac']];
  return names.find(([re]) => re.test(model))?.[1];
}

function hay(d: LanDevice): string {
  return [d.name, d.host, d.webTitle, ...Object.entries(d.txt ?? {}).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join(' ');
}

/** A best guess at what a device is, from its name, its announcements and its web page. */
export function classifyDevice(d: LanDevice): DeviceGuess {
  const h = hay(d);
  const model = d.txt?.model ?? '';
  const has = (p: LanProtocol) => d.protocols.includes(p);
  const suggest = (): DeviceGuess['suggest'] =>
    has('smb') ? 'smb' : has('sftp') || has('ssh') ? 'sftp' : has('webdavs') || has('webdav') ? 'webdav' : has('afp') ? 'afp' : has('nfs') ? 'nfs' : has('ftp') ? 'ftp' : undefined;

  for (const [re, name] of HOME_SERVERS) {
    if (re.test(h)) {
      return {
        kind: 'home-server', label: 'Home server', detail: name, suggest: suggest(),
        tip: suggest() ? undefined : `Turn on network file sharing in ${name} (its Files or Samba app), then connect with SMB. External drives plugged into it show up as their own shared folders.`,
      };
    }
  }
  for (const [re, name] of NAS) {
    if (re.test(h)) return { kind: 'nas', label: 'NAS', detail: `${name} NAS`, suggest: suggest() ?? 'smb' };
  }
  if (/^(MacBook|iMac|Macmini|MacPro|Mac\d|MacStudio|Xserve)/i.test(model) || has('afp') || /macbook|imac|mac-?mini|mac-?studio|mac-?pro/i.test(h)) {
    return { kind: 'mac', label: 'Mac', detail: macName(model), suggest: suggest() ?? 'smb', tip: suggest() ? undefined : 'On that Mac: System Settings → General → Sharing → File Sharing, then add the folders to share.' };
  }
  if (/^(DESKTOP|LAPTOP|WIN)-[A-Z0-9]{5,}$/i.test(d.name) || /windows/i.test(h)) {
    return { kind: 'windows', label: 'Windows PC', suggest: suggest() ?? 'smb', tip: suggest() ? undefined : 'On that PC: right-click a folder → Properties → Sharing → Share, and turn on network discovery.' };
  }
  if (has('ssh') || has('sftp') || /ubuntu|debian|fedora|arch|linux|nixos/i.test(h)) {
    return { kind: 'linux', label: 'Linux computer', suggest: suggest() ?? 'sftp', tip: suggest() ? undefined : 'Files on a Linux machine open over SFTP with your usual login (the SSH server must be running).' };
  }
  if (suggest()) return { kind: 'server', label: 'File server', suggest: suggest() };
  return { kind: 'unknown', label: 'Device', suggest: undefined };
}

export interface Share {
  name: string;
  comment?: string;
  /** an external drive or USB disk behind the share, as far as the name tells */
  external?: boolean;
}

const looksExternal = (name: string, comment = '') => /usb|external|ext[- ]?hdd|ext[- ]?drive|sd[a-z]\d?\b|sdcard|backup ?drive|portable|seagate|wd ?(elements|passport)|sandisk|samsung t\d/i.test(`${name} ${comment}`);

/** Hidden admin shares (C$, IPC$, print$) are never offered. */
const visible = (name: string) => !!name && !name.endsWith('$');

/** `smbclient -g -L //host -N` ("Disk|Media|Movies and TV") or the plain table form. */
export function parseSmbclient(out: string): Share[] {
  const shares: Share[] = [];
  for (const line of out.split(/\r?\n/)) {
    const g = line.match(/^Disk\|([^|]+)\|(.*)$/);
    if (g) {
      if (visible(g[1])) shares.push({ name: g[1], comment: g[2] || undefined, external: looksExternal(g[1], g[2]) });
      continue;
    }
    const t = line.match(/^\s+(\S(?:.*?\S)?)\s{2,}Disk\s*(.*)$/);
    if (t && visible(t[1])) shares.push({ name: t[1], comment: t[2].trim() || undefined, external: looksExternal(t[1], t[2]) });
  }
  return shares;
}

/** macOS `smbutil view -g //host` table: "Share   Type   Comments". */
export function parseSmbutil(out: string): Share[] {
  const shares: Share[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(\S(?:.*?\S)?)\s{2,}Disk\b\s*(.*)$/);
    if (m && visible(m[1]) && !/^Share$/i.test(m[1])) shares.push({ name: m[1], comment: m[2].trim() || undefined, external: looksExternal(m[1], m[2]) });
  }
  return shares;
}

/** Windows `net view \\host`: "Share name  Type  Used as  Comment". */
export function parseNetView(out: string): Share[] {
  const shares: Share[] = [];
  let body = false;
  for (const line of out.split(/\r?\n/)) {
    if (/^-{5,}/.test(line)) { body = true; continue; }
    if (!body || /^The command completed/i.test(line)) continue;
    const m = line.match(/^(\S(?:.*?\S)?)\s{2,}Disk\b\s*(?:[A-Z]:(?:\s+|$))?(.*)$/);
    if (m && visible(m[1])) shares.push({ name: m[1], comment: m[2].trim() || undefined, external: looksExternal(m[1], m[2]) });
  }
  return shares;
}

/** "key=value" strings from a TXT record into an object (keys lower-cased). */
export function parseTxt(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines) {
    const i = l.indexOf('=');
    if (i > 0) out[l.slice(0, i).toLowerCase()] = l.slice(i + 1);
    else if (l) out[l.toLowerCase()] = '';
  }
  return out;
}

/** mDNS service types Keeper asks for, and what each one offers. */
export const LAN_SERVICES: Record<string, LanProtocol | null> = {
  '_smb._tcp.local': 'smb',
  '_afpovertcp._tcp.local': 'afp',
  '_sftp-ssh._tcp.local': 'sftp',
  '_ssh._tcp.local': 'ssh',
  '_webdav._tcp.local': 'webdav',
  '_webdavs._tcp.local': 'webdavs',
  '_nfs._tcp.local': 'nfs',
  '_ftp._tcp.local': 'ftp',
  '_http._tcp.local': 'http',
  '_https._tcp.local': 'https',
  // Macs and many devices describe themselves here (model=MacBookPro18,3).
  '_device-info._tcp.local': null,
};

interface Rec { name: string; type: number; data: string; port?: number }

/** Groups mDNS answers into devices: one per machine, with every protocol it offers and its TXT details. */
export function devicesFromRecords(records: Rec[]): LanDevice[] {
  const devices = new Map<string, LanDevice & { ports: Record<string, number> }>();
  const instanceName = (inst: string) => inst.split('._')[0];
  // Device descriptions come last, so they join the machine their file services announced.
  const ptrs = records.filter((r) => r.type === 12).sort((a, b) => Number(a.name.startsWith('_device-info')) - Number(b.name.startsWith('_device-info')));
  for (const r of ptrs) {
    const service = Object.keys(LAN_SERVICES).find((s) => r.name.toLowerCase() === s);
    if (!service) continue;
    const inst = r.data;
    const srv = records.find((x) => x.type === 33 && x.name.toLowerCase() === inst.toLowerCase());
    const name = instanceName(inst);
    const host = (srv?.data ?? `${name.replace(/\s+/g, '-')}.local`).replace(/\.$/, '');
    // _device-info has no SRV: attach it to the device with the same name.
    const key = srv ? host.toLowerCase() : [...devices.values()].find((d) => d.name.toLowerCase() === name.toLowerCase())?.host.toLowerCase() ?? host.toLowerCase();
    const d = devices.get(key) ?? { name, host, protocols: [], txt: {}, ports: {} };
    const proto = LAN_SERVICES[service];
    if (proto && !d.protocols.includes(proto)) d.protocols.push(proto);
    if (proto && srv?.port) d.ports[proto] = srv.port;
    const txt = records.find((x) => x.type === 16 && x.name.toLowerCase() === inst.toLowerCase());
    if (txt?.data) Object.assign(d.txt!, parseTxt(txt.data.split('\n')));
    d.address ??= records.find((x) => x.type === 1 && x.name.toLowerCase() === host.toLowerCase())?.data;
    devices.set(key, d);
  }
  return [...devices.values()].map(({ ports: _p, ...d }) => d).sort((a, b) => a.name.localeCompare(b.name));
}
