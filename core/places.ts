// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Places: the folders, cloud drives, disks and network servers a person reaches
// for, on macOS, Windows and Linux. Pure parsing and classification; the
// Electron layer collects the raw command output and hands it in here.

export type PlaceKind = 'folder' | 'home' | 'apps' | 'cloud' | 'volume' | 'network' | 'computer' | 'airdrop' | 'shared';
export type VolumeKind = 'internal' | 'external' | 'removable' | 'network' | 'image' | 'optical';

export interface Place {
  id: string;
  name: string;
  path: string;
  kind: PlaceKind;
  icon: string;
  /** for disks and shares */
  volume?: VolumeKind;
  ejectable?: boolean;
  total?: number;
  free?: number;
  /** cloud service ("iCloud Drive", "OneDrive"…) */
  provider?: string;
  /** network shares: smb, afp, nfs, sftp, webdav, ftp */
  protocol?: string;
  server?: string;
}

export interface PlacesModel {
  computerName: string;
  home: string;
  favorites: Place[];
  cloud: Place[];
  volumes: Place[];
  network: Place[];
  shared?: Place;
  airdrop: boolean;
}

const sepOf = (platform: string) => (platform === 'win32' ? '\\' : '/');
const join = (platform: string, ...parts: string[]) => parts.join(sepOf(platform)).replace(platform === 'win32' ? /\\{2,}/g : /\/{2,}/g, sepOf(platform));
const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;

// ---------------------------------------------------------------- favourites

/** The folders people keep things in, in the order Finder and Explorer show them. */
export function favoriteFolders(platform: string, home: string, exists: (p: string) => boolean): Place[] {
  const items: [string, string, string, PlaceKind][] = [];
  if (platform === 'darwin') items.push(['Applications', '/Applications', 'app', 'apps']);
  items.push(
    ['Desktop', join(platform, home, 'Desktop'), 'screenshot', 'folder'],
    ['Documents', join(platform, home, 'Documents'), 'document', 'folder'],
    ['Downloads', join(platform, home, 'Downloads'), 'down', 'folder'],
    ['Pictures', join(platform, home, 'Pictures'), 'image', 'folder'],
    platform === 'darwin' ? ['Movies', join(platform, home, 'Movies'), 'video', 'folder'] : ['Videos', join(platform, home, 'Videos'), 'video', 'folder'],
    ['Music', join(platform, home, 'Music'), 'audio', 'folder'],
  );
  const out = items.filter(([, p, , k]) => k === 'apps' || exists(p)).map(([name, path, icon, kind]) => ({ id: `fav:${path}`, name, path, icon, kind }));
  out.push({ id: `fav:${home}`, name: base(home) || 'Home', path: home, icon: 'home', kind: 'home' });
  return out;
}

// ---------------------------------------------------------------- cloud drives

/**
 * A friendly name for a folder in ~/Library/CloudStorage (macOS File Provider
 * folders), e.g. "OneDrive-Personal" → "OneDrive", "GoogleDrive-ana@x.com" →
 * "Google Drive (ana@x.com)", "ProtonDrive-ana@proton.me-folder" → "Proton Drive".
 */
export function cloudStorageName(dir: string): { name: string; provider: string } {
  const m = dir.match(/^([A-Za-z]+)(?:-(.+))?$/);
  const key = (m?.[1] ?? dir).toLowerCase();
  const rest = m?.[2];
  const providers: Record<string, string> = {
    onedrive: 'OneDrive', googledrive: 'Google Drive', dropbox: 'Dropbox', protondrive: 'Proton Drive', box: 'Box', pcloud: 'pCloud',
    nextcloud: 'Nextcloud', owncloud: 'ownCloud', synologydrive: 'Synology Drive', megasync: 'MEGA', mega: 'MEGA', tresorit: 'Tresorit', sync: 'Sync',
  };
  const provider = providers[key] ?? dir.split('-')[0];
  if (!rest || provider === 'Box' && rest === 'Box') return { name: provider, provider };
  if (provider === 'OneDrive') {
    // OneDrive-Personal, OneDrive-SharedLibraries-Contoso, OneDrive-Contoso
    if (/^personal$/i.test(rest)) return { name: 'OneDrive', provider };
    return { name: `OneDrive – ${rest.replace(/^SharedLibraries-/, '')}`, provider };
  }
  const account = rest.match(/[^\s@]+@[^\s@-]+\.[^\s@-]+/)?.[0];
  return { name: account ? `${provider} (${account})` : provider, provider };
}

export interface CloudEnv {
  platform: string;
  home: string;
  env: Record<string, string | undefined>;
  /** names inside a folder ([] when missing) */
  list: (dir: string) => string[];
  exists: (p: string) => boolean;
  /** Windows drive letters with their labels, for virtual drives such as Google Drive's */
  drives?: { letter: string; label: string }[];
}

export function detectCloud(e: CloudEnv): Place[] {
  const out: Place[] = [];
  const add = (name: string, provider: string, path: string) => {
    if (!out.some((p) => p.path.toLowerCase() === path.toLowerCase())) out.push({ id: `cloud:${path}`, name, path, kind: 'cloud', icon: 'cloud', provider });
  };
  const j = (...p: string[]) => join(e.platform, ...p);
  if (e.platform === 'darwin') {
    const icloud = j(e.home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
    if (e.exists(icloud)) add('iCloud Drive', 'iCloud Drive', icloud);
    const cs = j(e.home, 'Library', 'CloudStorage');
    for (const d of e.list(cs).filter((n) => !n.startsWith('.')).sort()) {
      const { name, provider } = cloudStorageName(d);
      add(name, provider, j(cs, d));
    }
    // Older clients sync to a plain folder in the home folder.
    for (const [dir, provider] of [['Dropbox', 'Dropbox'], ['Google Drive', 'Google Drive'], ['OneDrive', 'OneDrive'], ['Proton Drive', 'Proton Drive'], ['pCloud Drive', 'pCloud'], ['Nextcloud', 'Nextcloud']] as const) {
      if (e.exists(j(e.home, dir)) && !out.some((p) => p.provider === provider)) add(provider, provider, j(e.home, dir));
    }
  } else if (e.platform === 'win32') {
    if (e.env.OneDriveConsumer && e.exists(e.env.OneDriveConsumer)) add('OneDrive', 'OneDrive', e.env.OneDriveConsumer);
    else if (e.env.OneDrive && e.exists(e.env.OneDrive)) add('OneDrive', 'OneDrive', e.env.OneDrive);
    if (e.env.OneDriveCommercial && e.exists(e.env.OneDriveCommercial)) add(`OneDrive – ${base(e.env.OneDriveCommercial).replace(/^OneDrive\s*-\s*/, '')}`, 'OneDrive', e.env.OneDriveCommercial);
    for (const [dir, provider, label] of [['iCloudDrive', 'iCloud Drive', 'iCloud Drive'], ['Dropbox', 'Dropbox', 'Dropbox'], ['Proton Drive', 'Proton Drive', 'Proton Drive'], ['Box', 'Box', 'Box'], ['Nextcloud', 'Nextcloud', 'Nextcloud']] as const) {
      const p = j(e.home, dir);
      if (e.exists(p)) add(label, provider, p);
    }
    for (const d of e.drives ?? []) {
      if (/google drive/i.test(d.label)) {
        const my = `${d.letter}:\\My Drive`;
        add('Google Drive', 'Google Drive', e.exists(my) ? my : `${d.letter}:\\`);
      }
    }
  } else {
    for (const [dir, provider] of [['Dropbox', 'Dropbox'], ['pCloudDrive', 'pCloud'], ['Nextcloud', 'Nextcloud'], ['ownCloud', 'ownCloud'], ['OneDrive', 'OneDrive'], ['Google Drive', 'Google Drive'], ['MEGA', 'MEGA'], ['Proton Drive', 'Proton Drive'], ['SynologyDrive', 'Synology Drive']] as const) {
      const p = j(e.home, dir);
      if (e.exists(p)) add(provider, provider, p);
    }
  }
  return out;
}

// ---------------------------------------------------------------- mounts

export interface Mount {
  device: string;
  mount: string;
  fstype: string;
  options: string[];
}

/** macOS `mount` output: "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)". */
export function parseMacMount(text: string): Mount[] {
  const out: Mount[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(.+?) on (.+?) \(([^)]*)\)\s*$/);
    if (!m) continue;
    const opts = m[3].split(',').map((s) => s.trim());
    out.push({ device: m[1], mount: m[2], fstype: opts[0], options: opts.slice(1) });
  }
  return out;
}

/** Linux /proc/mounts: "device mountpoint fstype options 0 0", with octal escapes for spaces. */
export function parseProcMounts(text: string): Mount[] {
  const un = (s: string) => s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
  return text
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 4)
    .map(([device, mount, fstype, options]) => ({ device: un(device), mount: un(mount), fstype, options: options.split(',') }));
}

const NET_FS: Record<string, string> = {
  smbfs: 'smb', cifs: 'smb', smb3: 'smb', 'fuse.smbnetfs': 'smb', afpfs: 'afp', nfs: 'nfs', nfs4: 'nfs', webdav: 'webdav', 'fuse.sshfs': 'sftp',
  'fuse.davfs': 'webdav', davfs: 'webdav', ftp: 'ftp', 'fuse.curlftpfs': 'ftp', 'fuse.rclone': 'cloud',
};

/** "//guest@192.168.0.252/Media" → { server: "192.168.0.252", share: "Media" }. */
export function parseShareDevice(device: string): { server: string; share: string } {
  const d = device.replace(/^[a-z]+:\/\//i, '//');
  let m = d.match(/^\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/?(.*)$/);
  if (m) return { server: m[1], share: decodeURIComponent(m[2] ?? '').replace(/\/$/, '') };
  m = d.match(/^(?:[^@]+@)?([^:]+):(.*)$/); // nfs "nas:/export", sshfs "user@host:/path"
  if (m) return { server: m[1], share: m[2].replace(/^\//, '') };
  m = d.match(/^\\\\([^\\]+)\\?(.*)$/); // \\server\share
  if (m) return { server: m[1], share: m[2] };
  return { server: device, share: '' };
}

/** Disks and shares worth showing from a list of mounts (system and virtual mounts left out). */
export function classifyMounts(platform: string, mounts: Mount[], extra: { removable?: Set<string>; images?: Set<string>; optical?: Set<string>; labels?: Map<string, string> } = {}): { volumes: Place[]; network: Place[] } {
  const volumes: Place[] = [];
  const network: Place[] = [];
  for (const m of mounts) {
    const proto = NET_FS[m.fstype] ?? (m.device.startsWith('//') || /^[a-z]+:\/\//i.test(m.device) ? 'smb' : undefined);
    if (proto && proto !== 'cloud') {
      const { server, share } = parseShareDevice(m.device);
      network.push({ id: `net:${m.mount}`, name: share ? `${share} on ${server}` : server, path: m.mount, kind: 'network', icon: 'globe', volume: 'network', ejectable: true, protocol: proto, server });
      continue;
    }
    if (platform === 'darwin') {
      // The sealed system and its helper volumes; the person's data lives on "/".
      if (!m.device.startsWith('/dev/') || /^\/System\/Volumes\//.test(m.mount) || m.mount === '/dev') continue;
      if (m.mount !== '/' && !m.mount.startsWith('/Volumes/')) continue;
      const kind: VolumeKind = m.mount === '/' ? 'internal' : extra.images?.has(m.mount) ? 'image' : extra.optical?.has(m.mount) ? 'optical' : extra.removable?.has(m.mount) || !m.options.includes('local') ? 'removable' : 'external';
      const name = m.mount === '/' ? extra.labels?.get('/') ?? 'Macintosh HD' : extra.labels?.get(m.mount) ?? base(m.mount);
      volumes.push({ id: `vol:${m.mount}`, name, path: m.mount, kind: 'volume', icon: kind === 'image' ? 'zip' : 'archive', volume: kind, ejectable: m.mount !== '/' });
    } else {
      if (!m.device.startsWith('/dev/') || /^\/dev\/(loop|zram|ram)/.test(m.device)) continue;
      if (/^\/(boot|efi|snap|var|tmp|run\/credentials|sys|proc)(\/|$)/.test(m.mount) && m.mount !== '/') continue;
      if (/^(squashfs|tmpfs|overlay|devtmpfs|vfat)$/.test(m.fstype) && !/^\/(media|run\/media|mnt)\//.test(m.mount)) continue;
      const removable = /^\/(media|run\/media)\//.test(m.mount) || extra.removable?.has(m.device);
      const kind: VolumeKind = extra.optical?.has(m.device) ? 'optical' : m.mount === '/' ? 'internal' : removable ? 'removable' : 'internal';
      const name = m.mount === '/' ? extra.labels?.get('/') ?? 'Computer' : extra.labels?.get(m.mount) ?? base(m.mount);
      volumes.push({ id: `vol:${m.mount}`, name, path: m.mount, kind: 'volume', icon: 'archive', volume: kind, ejectable: kind === 'removable' || kind === 'optical' });
    }
  }
  return { volumes, network };
}

/** lsblk -J -b -o NAME,PATH,RM,HOTPLUG,TYPE,MOUNTPOINT,LABEL,SIZE: removable devices, optical drives and labels. */
export function parseLsblk(json: string): { removable: Set<string>; optical: Set<string>; labels: Map<string, string> } {
  const removable = new Set<string>();
  const optical = new Set<string>();
  const labels = new Map<string, string>();
  type Dev = { name?: string; path?: string; rm?: boolean | string; hotplug?: boolean | string; type?: string; mountpoint?: string | null; label?: string | null; children?: Dev[] };
  const yes = (v: unknown) => v === true || v === '1' || v === 1;
  const walk = (d: Dev, parentRemovable: boolean) => {
    const path = d.path ?? (d.name ? `/dev/${d.name}` : '');
    const rm = parentRemovable || yes(d.rm) || yes(d.hotplug);
    if (rm) removable.add(path);
    if (d.type === 'rom') optical.add(path);
    if (d.mountpoint && d.label) labels.set(d.mountpoint, d.label);
    for (const c of d.children ?? []) walk(c, rm);
  };
  try {
    const data = JSON.parse(json) as { blockdevices?: Dev[] };
    for (const d of data.blockdevices ?? []) walk(d, false);
  } catch {
    /* not JSON */
  }
  return { removable, optical, labels };
}

/** Windows: Get-CimInstance Win32_LogicalDisk | Select DeviceID,DriveType,VolumeName,ProviderName,Size,FreeSpace | ConvertTo-Json */
export function parseWinDisks(json: string): { volumes: Place[]; network: Place[]; drives: { letter: string; label: string }[] } {
  type Disk = { DeviceID: string; DriveType: number; VolumeName?: string | null; ProviderName?: string | null; Size?: number | null; FreeSpace?: number | null };
  let list: Disk[] = [];
  try {
    const raw = JSON.parse(json || '[]');
    list = Array.isArray(raw) ? raw : [raw];
  } catch {
    list = [];
  }
  const volumes: Place[] = [];
  const network: Place[] = [];
  const drives: { letter: string; label: string }[] = [];
  for (const d of list) {
    if (!d?.DeviceID) continue;
    const letter = d.DeviceID.replace(':', '');
    const path = `${d.DeviceID}\\`;
    drives.push({ letter, label: d.VolumeName ?? '' });
    const common = { total: d.Size ?? undefined, free: d.FreeSpace ?? undefined };
    if (d.DriveType === 4) {
      const { server, share } = parseShareDevice(d.ProviderName ?? path);
      network.push({ id: `net:${path}`, name: `${share || d.VolumeName || letter} on ${server} (${d.DeviceID})`, path, kind: 'network', icon: 'globe', volume: 'network', ejectable: true, protocol: 'smb', server, ...common });
      continue;
    }
    if (/google drive/i.test(d.VolumeName ?? '')) continue; // shown with the cloud drives
    const kind: VolumeKind = d.DriveType === 2 ? 'removable' : d.DriveType === 5 ? 'optical' : 'internal';
    const label = d.VolumeName ? `${d.VolumeName} (${d.DeviceID})` : kind === 'removable' ? `USB Drive (${d.DeviceID})` : kind === 'optical' ? `DVD Drive (${d.DeviceID})` : `Local Disk (${d.DeviceID})`;
    volumes.push({ id: `vol:${path}`, name: label, path, kind: 'volume', icon: 'archive', volume: kind, ejectable: kind !== 'internal', ...common });
  }
  return { volumes, network, drives };
}

// ---------------------------------------------------------------- connect to server

export type ServerProtocol = 'smb' | 'afp' | 'nfs' | 'sftp' | 'ftp' | 'webdav' | 'webdavs';

export interface ServerAddress {
  protocol: ServerProtocol;
  host: string;
  port?: number;
  share: string;
  user?: string;
  /** canonical URL, e.g. smb://nas.local/Media */
  url: string;
  /** Windows UNC form, e.g. \\nas.local\Media (smb only) */
  unc?: string;
}

/**
 * Reads what someone types into "Connect to Server": smb://nas/share,
 * afp://, nfs://, sftp://user@host, ftp://, http(s):// (WebDAV), \\server\share
 * or a bare host name (treated as smb). Returns null when it cannot be a server.
 */
export function parseServerAddress(input: string): ServerAddress | null {
  let s = input.trim();
  if (!s) return null;
  if (/^\\\\/.test(s)) s = 'smb://' + s.slice(2).replace(/\\/g, '/');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'smb://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const scheme = u.protocol.replace(':', '').toLowerCase();
  const map: Record<string, ServerProtocol> = { smb: 'smb', cifs: 'smb', afp: 'afp', nfs: 'nfs', sftp: 'sftp', ssh: 'sftp', ftp: 'ftp', ftps: 'ftp', http: 'webdav', https: 'webdavs', dav: 'webdav', davs: 'webdavs', webdav: 'webdav', webdavs: 'webdavs' };
  const protocol = map[scheme];
  if (!protocol) return null;
  const host = u.hostname;
  if (!host || !/^[a-z0-9.\-_[\]:]+$/i.test(host) || /\s/.test(host)) return null;
  const share = decodeURIComponent(u.pathname.replace(/^\/+|\/+$/g, ''));
  const user = u.username ? decodeURIComponent(u.username) : undefined;
  const port = u.port ? Number(u.port) : undefined;
  const schemeOut = protocol === 'webdav' ? 'http' : protocol === 'webdavs' ? 'https' : protocol;
  const url = `${schemeOut}://${user ? encodeURIComponent(user) + '@' : ''}${host}${port ? ':' + port : ''}${share ? '/' + share.split('/').map(encodeURIComponent).join('/') : ''}`;
  return { protocol, host, port, share, user, url, unc: protocol === 'smb' ? `\\\\${host}${share ? '\\' + share.replace(/\//g, '\\') : ''}` : undefined };
}

// ---------------------------------------------------------------- trash

/** A freedesktop.org .trashinfo file: [Trash Info] Path=… DeletionDate=… */
export function parseTrashInfo(text: string): { path: string; deletedAt?: number } | null {
  const path = text.match(/^Path=(.+)$/m)?.[1]?.trim();
  if (!path) return null;
  const date = text.match(/^DeletionDate=(.+)$/m)?.[1]?.trim();
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* keep as written */
  }
  const t = date ? Date.parse(date) : NaN;
  return { path: decoded, deletedAt: Number.isFinite(t) ? t : undefined };
}

export function buildTrashInfo(original: string, when = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
  return `[Trash Info]\nPath=${original.split('/').map(encodeURIComponent).join('/')}\nDeletionDate=${d}\n`;
}

// ---------------------------------------------------------------- multicast DNS (finding servers on the network)

export const MDNS_SERVICES: Record<string, ServerProtocol> = {
  '_smb._tcp.local': 'smb',
  '_afpovertcp._tcp.local': 'afp',
  '_sftp-ssh._tcp.local': 'sftp',
  '_webdav._tcp.local': 'webdav',
  '_webdavs._tcp.local': 'webdavs',
  '_nfs._tcp.local': 'nfs',
  '_ftp._tcp.local': 'ftp',
};

function encodeName(name: string): number[] {
  const out: number[] = [];
  for (const label of name.replace(/\.$/, '').split('.')) {
    const bytes = [...new TextEncoder().encode(label)];
    out.push(bytes.length, ...bytes);
  }
  out.push(0);
  return out;
}

/** A one-shot mDNS question (PTR) for each service type. */
export function buildMdnsQuery(names: string[]): Uint8Array {
  const header = [0, 0, 0, 0, 0, names.length, 0, 0, 0, 0, 0, 0];
  const qs = names.flatMap((n) => [...encodeName(n), 0, 12, 0, 1]); // type PTR, class IN
  return new Uint8Array([...header, ...qs]);
}

export interface MdnsRecord {
  name: string;
  type: number;
  ttl: number;
  /** PTR target, SRV target, A/AAAA address */
  data: string;
  port?: number;
}

function readName(buf: Uint8Array, offset: number, depth = 0): { name: string; next: number } {
  const labels: string[] = [];
  let i = offset;
  let next = -1;
  while (i < buf.length) {
    const len = buf[i];
    if (len === 0) {
      i++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | buf[i + 1];
      if (next < 0) next = i + 2;
      if (depth > 10) break;
      const r = readName(buf, ptr, depth + 1);
      labels.push(r.name);
      i = -1;
      break;
    }
    labels.push(new TextDecoder().decode(buf.slice(i + 1, i + 1 + len)));
    i += 1 + len;
  }
  return { name: labels.filter(Boolean).join('.'), next: next >= 0 ? next : i };
}

/** Answers and additional records of an mDNS response. */
export function parseMdnsResponse(buf: Uint8Array): MdnsRecord[] {
  if (buf.length < 12) return [];
  const u16 = (o: number) => (buf[o] << 8) | buf[o + 1];
  const qd = u16(4);
  const total = u16(6) + u16(8) + u16(10);
  let o = 12;
  try {
    for (let q = 0; q < qd; q++) o = readName(buf, o).next + 4;
    const out: MdnsRecord[] = [];
    for (let r = 0; r < total && o < buf.length; r++) {
      const { name, next } = readName(buf, o);
      o = next;
      const type = u16(o);
      const ttl = ((buf[o + 4] << 24) | (buf[o + 5] << 16) | (buf[o + 6] << 8) | buf[o + 7]) >>> 0;
      const len = u16(o + 8);
      const start = o + 10;
      let data = '';
      let port: number | undefined;
      if (type === 12) data = readName(buf, start).name;
      else if (type === 33) {
        port = u16(start + 4);
        data = readName(buf, start + 6).name;
      } else if (type === 1 && len === 4) data = [...buf.slice(start, start + 4)].join('.');
      else if (type === 28 && len === 16) data = Array.from({ length: 8 }, (_, k) => u16(start + k * 2).toString(16)).join(':');
      else if (type === 16) {
        // TXT: length-prefixed "key=value" strings, kept one per line.
        const parts: string[] = [];
        for (let k = start; k < start + len && k < buf.length; k += 1 + buf[k]) if (buf[k]) parts.push(new TextDecoder().decode(buf.slice(k + 1, k + 1 + buf[k])));
        data = parts.join('\n');
      }
      out.push({ name, type, ttl, data, port });
      o = start + len;
    }
    return out;
  } catch {
    return [];
  }
}

export interface DiscoveredServer {
  name: string;
  host: string;
  address?: string;
  port?: number;
  protocols: ServerProtocol[];
}

/** Turns mDNS records from many responses into servers ("Living Room NAS" offering smb and afp). */
export function serversFromRecords(records: MdnsRecord[]): DiscoveredServer[] {
  const byInstance = new Map<string, { protocol: ServerProtocol; instance: string }>();
  for (const r of records) {
    if (r.type !== 12) continue;
    const service = Object.keys(MDNS_SERVICES).find((s) => r.name.toLowerCase() === s);
    if (service) byInstance.set(r.data.toLowerCase(), { protocol: MDNS_SERVICES[service], instance: r.data });
  }
  const servers = new Map<string, DiscoveredServer>();
  for (const [key, { protocol, instance }] of byInstance) {
    const srv = records.find((r) => r.type === 33 && r.name.toLowerCase() === key);
    const host = srv?.data ?? instance.split('.')[0] + '.local';
    const address = records.find((r) => r.type === 1 && r.name.toLowerCase() === host.toLowerCase())?.data;
    const name = instance.split('._')[0];
    const id = host.toLowerCase();
    const s = servers.get(id) ?? { name, host: host.replace(/\.$/, ''), address, port: srv?.port, protocols: [] };
    if (!s.protocols.includes(protocol)) s.protocols.push(protocol);
    s.address ??= address;
    servers.set(id, s);
  }
  return [...servers.values()].sort((a, b) => a.name.localeCompare(b.name));
}
