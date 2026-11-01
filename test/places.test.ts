// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  buildMdnsQuery, buildTrashInfo, classifyMounts, cloudStorageName, detectCloud, favoriteFolders, parseLsblk, parseMacMount, parseMdnsResponse,
  parseProcMounts, parseServerAddress, parseShareDevice, parseTrashInfo, parseWinDisks, serversFromRecords,
} from '../core/places';

const MAC_MOUNT = `/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
devfs on /dev (devfs, local, nobrowse)
/dev/disk3s6 on /System/Volumes/VM (apfs, local, noexec, journaled, noatime, nobrowse)
/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect)
map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)
/dev/disk5s1 on /Volumes/KINGSTON (msdos, local, nodev, nosuid, noowners, noatime)
/dev/disk6s1 on /Volumes/Keeper 0.2.0 (hfs, local, nodev, nosuid, read-only, noowners, quarantine, mounted by chak)
//guest@192.168.0.252/Media on /Volumes/Media (smbfs, nodev, nosuid, mounted by chak)
`;

const PROC_MOUNTS = `sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0
/dev/nvme0n1p2 / ext4 rw,relatime 0 0
/dev/nvme0n1p1 /boot/efi vfat rw,relatime 0 0
tmpfs /run tmpfs rw,nosuid 0 0
/dev/loop3 /snap/core22/1380 squashfs ro,nodev 0 0
/dev/sda1 /media/ana/USB\\040STICK vfat rw,nosuid,nodev 0 0
//nas.local/photos /mnt/photos cifs rw,relatime 0 0
nas:/export/backup /mnt/backup nfs4 rw,relatime 0 0
ana@server:/home/ana /home/ana/remote fuse.sshfs rw,nosuid 0 0
`;

const LSBLK = JSON.stringify({ blockdevices: [
  { name: 'nvme0n1', path: '/dev/nvme0n1', rm: false, hotplug: false, type: 'disk', mountpoint: null, label: null, children: [
    { name: 'nvme0n1p2', path: '/dev/nvme0n1p2', rm: false, hotplug: false, type: 'part', mountpoint: '/', label: 'System' },
  ] },
  { name: 'sda', path: '/dev/sda', rm: true, hotplug: true, type: 'disk', mountpoint: null, children: [
    { name: 'sda1', path: '/dev/sda1', rm: true, hotplug: true, type: 'part', mountpoint: '/media/ana/USB STICK', label: 'USB STICK' },
  ] },
  { name: 'sr0', path: '/dev/sr0', rm: true, type: 'rom', mountpoint: null },
] });

const WIN_DISKS = JSON.stringify([
  { DeviceID: 'C:', DriveType: 3, VolumeName: 'Windows', ProviderName: null, Size: 512e9, FreeSpace: 120e9 },
  { DeviceID: 'E:', DriveType: 2, VolumeName: null, ProviderName: null, Size: 32e9, FreeSpace: 10e9 },
  { DeviceID: 'G:', DriveType: 3, VolumeName: 'Google Drive', ProviderName: null, Size: 100e9, FreeSpace: 50e9 },
  { DeviceID: 'Z:', DriveType: 4, VolumeName: 'Media', ProviderName: '\\\\192.168.0.252\\Media', Size: 4e12, FreeSpace: 1e12 },
  { DeviceID: 'D:', DriveType: 5, VolumeName: null, ProviderName: null, Size: null, FreeSpace: null },
]);

describe('favourites and cloud drives', () => {
  it('lists the usual folders per system', () => {
    const mac = favoriteFolders('darwin', '/Users/chak', () => true).map((p) => p.name);
    expect(mac).toEqual(['Applications', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'chak']);
    const win = favoriteFolders('win32', 'C:\\Users\\chak', (p) => !p.endsWith('Music'));
    expect(win.map((p) => p.name)).toEqual(['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'chak']);
    expect(win[0].path).toBe('C:\\Users\\chak\\Desktop');
  });

  it('names cloud storage folders', () => {
    expect(cloudStorageName('OneDrive-Personal')).toEqual({ name: 'OneDrive', provider: 'OneDrive' });
    expect(cloudStorageName('OneDrive-SharedLibraries-Contoso').name).toBe('OneDrive – Contoso');
    expect(cloudStorageName('GoogleDrive-ana@gmail.com')).toEqual({ name: 'Google Drive (ana@gmail.com)', provider: 'Google Drive' });
    expect(cloudStorageName('ProtonDrive-chak@proton.me-folder')).toEqual({ name: 'Proton Drive (chak@proton.me)', provider: 'Proton Drive' });
    expect(cloudStorageName('Dropbox').name).toBe('Dropbox');
    expect(cloudStorageName('Box-Box').name).toBe('Box');
  });

  it('finds iCloud Drive and CloudStorage on macOS', () => {
    const icloud = '/Users/chak/Library/Mobile Documents/com~apple~CloudDocs';
    const c = detectCloud({ platform: 'darwin', home: '/Users/chak', env: {}, exists: (p) => p === icloud, list: (d) => (d.endsWith('CloudStorage') ? ['ProtonDrive-chak@proton.me-folder', '.DS_Store', 'Dropbox'] : []) });
    expect(c.map((p) => p.name)).toEqual(['iCloud Drive', 'Dropbox', 'Proton Drive (chak@proton.me)']);
  });

  it('finds OneDrive, iCloud and Google Drive on Windows', () => {
    const c = detectCloud({
      platform: 'win32', home: 'C:\\Users\\chak', env: { OneDrive: 'C:\\Users\\chak\\OneDrive', OneDriveCommercial: 'C:\\Users\\chak\\OneDrive - Contoso' },
      exists: (p) => ['C:\\Users\\chak\\OneDrive', 'C:\\Users\\chak\\OneDrive - Contoso', 'C:\\Users\\chak\\iCloudDrive', 'G:\\My Drive'].includes(p), list: () => [],
      drives: [{ letter: 'G', label: 'Google Drive' }],
    });
    expect(c.map((p) => p.name)).toEqual(['OneDrive', 'OneDrive – Contoso', 'iCloud Drive', 'Google Drive']);
    expect(c[3].path).toBe('G:\\My Drive');
  });

  it('finds sync folders on Linux', () => {
    const c = detectCloud({ platform: 'linux', home: '/home/ana', env: {}, exists: (p) => p === '/home/ana/Dropbox' || p === '/home/ana/Nextcloud', list: () => [] });
    expect(c.map((p) => p.provider)).toEqual(['Dropbox', 'Nextcloud']);
  });
});

describe('disks and shares', () => {
  it('macOS: system disk, USB stick, disk image and a server', () => {
    const { volumes, network } = classifyMounts('darwin', parseMacMount(MAC_MOUNT), { images: new Set(['/Volumes/Keeper 0.2.0']) });
    expect(volumes.map((v) => [v.name, v.volume, v.ejectable])).toEqual([
      ['Macintosh HD', 'internal', false], ['KINGSTON', 'external', true], ['Keeper 0.2.0', 'image', true],
    ]);
    expect(network).toHaveLength(1);
    expect(network[0]).toMatchObject({ name: 'Media on 192.168.0.252', path: '/Volumes/Media', protocol: 'smb', server: '192.168.0.252', ejectable: true });
  });

  it('Linux: root, USB stick with a label, smb, nfs and sftp; no snaps, efi or tmpfs', () => {
    const blk = parseLsblk(LSBLK);
    expect(blk.removable.has('/dev/sda1')).toBe(true);
    expect(blk.optical.has('/dev/sr0')).toBe(true);
    const { volumes, network } = classifyMounts('linux', parseProcMounts(PROC_MOUNTS), blk);
    expect(volumes.map((v) => [v.name, v.volume])).toEqual([['System', 'internal'], ['USB STICK', 'removable']]);
    expect(volumes[1].path).toBe('/media/ana/USB STICK');
    expect(network.map((n) => [n.protocol, n.server])).toEqual([['smb', 'nas.local'], ['nfs', 'nas'], ['sftp', 'server']]);
  });

  it('Windows: local, USB, optical and a mapped network drive; Google Drive left to the cloud list', () => {
    const { volumes, network, drives } = parseWinDisks(WIN_DISKS);
    expect(volumes.map((v) => [v.name, v.volume, v.ejectable])).toEqual([
      ['Windows (C:)', 'internal', false], ['USB Drive (E:)', 'removable', true], ['DVD Drive (D:)', 'optical', true],
    ]);
    expect(network[0]).toMatchObject({ name: 'Media on 192.168.0.252 (Z:)', path: 'Z:\\', server: '192.168.0.252' });
    expect(drives.find((d) => d.letter === 'G')?.label).toBe('Google Drive');
  });

  it('reads share devices in every notation', () => {
    expect(parseShareDevice('//guest@192.168.0.252/Media')).toEqual({ server: '192.168.0.252', share: 'Media' });
    expect(parseShareDevice('nas:/export/backup')).toEqual({ server: 'nas', share: 'export/backup' });
    expect(parseShareDevice('\\\\nas\\Public')).toEqual({ server: 'nas', share: 'Public' });
    expect(parseShareDevice('smb://nas.local/My%20Files')).toEqual({ server: 'nas.local', share: 'My Files' });
  });
});

describe('connect to server', () => {
  it('accepts the usual forms', () => {
    expect(parseServerAddress('smb://192.168.0.252/Media')).toMatchObject({ protocol: 'smb', host: '192.168.0.252', share: 'Media', unc: '\\\\192.168.0.252\\Media' });
    expect(parseServerAddress('\\\\nas\\Public Files')).toMatchObject({ protocol: 'smb', host: 'nas', share: 'Public Files', url: 'smb://nas/Public%20Files' });
    expect(parseServerAddress('nas.local')).toMatchObject({ protocol: 'smb', host: 'nas.local', share: '' });
    expect(parseServerAddress('sftp://ana@server:2222/home')).toMatchObject({ protocol: 'sftp', user: 'ana', port: 2222, share: 'home' });
    expect(parseServerAddress('https://cloud.example.org/remote.php/dav')).toMatchObject({ protocol: 'webdavs', host: 'cloud.example.org' });
    expect(parseServerAddress('afp://mac-mini.local')).toMatchObject({ protocol: 'afp' });
  });
  it('refuses things that are not servers', () => {
    expect(parseServerAddress('')).toBeNull();
    expect(parseServerAddress('javascript://alert(1)')).toBeNull();
    expect(parseServerAddress('file:///etc/passwd')).toBeNull();
    expect(parseServerAddress('smb://bad host/x')).toBeNull();
  });
});

describe('trash records', () => {
  it('reads and writes .trashinfo', () => {
    const info = buildTrashInfo('/home/ana/Documents/My report.pdf', new Date(2026, 9, 30, 9, 5, 7));
    expect(info).toBe('[Trash Info]\nPath=/home/ana/Documents/My%20report.pdf\nDeletionDate=2026-10-30T09:05:07\n');
    const back = parseTrashInfo(info)!;
    expect(back.path).toBe('/home/ana/Documents/My report.pdf');
    expect(new Date(back.deletedAt!).getMinutes()).toBe(5);
    expect(parseTrashInfo('garbage')).toBeNull();
  });
});

describe('finding servers on the network', () => {
  it('builds a PTR query', () => {
    const q = buildMdnsQuery(['_smb._tcp.local']);
    expect([...q.slice(0, 12)]).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(new TextDecoder().decode(q.slice(13, 17))).toBe('_smb');
    expect([...q.slice(-4)]).toEqual([0, 12, 0, 1]);
  });

  it('parses a response with PTR, SRV and A records (with name compression)', () => {
    const bytes: number[] = [0, 0, 0x84, 0, 0, 0, 0, 3, 0, 0, 0, 0];
    const name = (s: string) => s.split('.').flatMap((l) => [l.length, ...new TextEncoder().encode(l)]).concat([0]);
    const u16 = (n: number) => [n >> 8, n & 255];
    const rr = (n: number[], type: number, data: number[]) => [...n, ...u16(type), 0x80, 1, 0, 0, 0x11, 0x94, ...u16(data.length), ...data];
    // PTR _smb._tcp.local -> Living Room NAS._smb._tcp.local
    const svcOffset = bytes.length;
    const svc = name('_smb._tcp.local');
    const inst = [15, ...new TextEncoder().encode('Living Room NAS'), 0xc0, svcOffset];
    bytes.push(...rr(svc, 12, inst));
    // SRV Living Room NAS._smb._tcp.local -> nas.local:445 (instance name via pointer to the PTR data)
    const instOffset = svcOffset + svc.length + 10;
    bytes.push(...rr([0xc0, instOffset], 33, [0, 0, 0, 0, ...u16(445), ...name('nas.local')]));
    // A nas.local -> 192.168.0.252
    bytes.push(...rr(name('nas.local'), 1, [192, 168, 0, 252]));
    const recs = parseMdnsResponse(new Uint8Array(bytes));
    expect(recs.map((r) => r.type)).toEqual([12, 33, 1]);
    expect(recs[0].data).toBe('Living Room NAS._smb._tcp.local');
    expect(recs[1]).toMatchObject({ name: 'Living Room NAS._smb._tcp.local', data: 'nas.local', port: 445 });
    const servers = serversFromRecords(recs);
    expect(servers).toEqual([{ name: 'Living Room NAS', host: 'nas.local', address: '192.168.0.252', port: 445, protocols: ['smb'] }]);
  });

  it('ignores junk', () => {
    expect(parseMdnsResponse(new Uint8Array([1, 2, 3]))).toEqual([]);
  });
});
