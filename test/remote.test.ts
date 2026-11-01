// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cacheKey, evictionPlan } from '../core/remote/cache';
import { classifyDevice, devicesFromRecords, parseNetView, parseSmbclient, parseSmbutil, parseTxt } from '../core/remote/lan';
import { joinRemote, localSafeName, normalizeRemote, onServer, parentRemote, parseRemoteRoute, remoteCrumbs, remoteRoute } from '../core/remote/paths';
import { appliesTo, formFor, formValues, needsSignIn, providerCatalog } from '../core/remote/providers';
import type { Connection, RemoteFs } from '../core/remote/types';
import { parseMultistatus, parseQuota } from '../core/remote/webdav-xml';
import { FtpFs } from '../electron/services/remote/ftp';
import { findRclone, parseAuthorizeOutput, RcClient, RcloneFs, remoteNameFor, type RcloneDaemon } from '../electron/services/remote/rclone';
import { HostKeyChanged, SftpFs } from '../electron/services/remote/sftp';
import { WebDavFs } from '../electron/services/remote/webdav';
import providersJson from './fixtures/rclone-providers.json';

const require = createRequire(import.meta.url);

async function text(s: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of s as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

describe('paths inside a connection', () => {
  it('normalises and never climbs above the top', () => {
    expect(normalizeRemote('a/./b/../c/')).toBe('/a/c');
    expect(normalizeRemote('../../etc/passwd')).toBe('/etc/passwd');
    expect(normalizeRemote('\\Photos\\2026')).toBe('/Photos/2026');
    expect(normalizeRemote('')).toBe('/');
  });
  it('joins names and refuses names with separators', () => {
    expect(joinRemote('/a', 'b.txt')).toBe('/a/b.txt');
    expect(() => joinRemote('/a', '../x')).toThrow();
    expect(() => joinRemote('/a', 'x/y')).toThrow();
  });
  it('knows parents, server paths, routes and crumbs', () => {
    expect(parentRemote('/a/b')).toBe('/a');
    expect(parentRemote('/')).toBeNull();
    expect(onServer('/remote.php/dav/files/ana', '/Docs')).toBe('/remote.php/dav/files/ana/Docs');
    expect(onServer(undefined, 'x')).toBe('/x');
    expect(parseRemoteRoute(remoteRoute('nas', '/Media/TV'))).toEqual({ id: 'nas', path: '/Media/TV' });
    expect(parseRemoteRoute('nope')).toBeNull();
    expect(remoteCrumbs('NAS', '/Media/TV').map((c) => c.label)).toEqual(['NAS', 'Media', 'TV']);
  });
  it('makes names safe for this computer', () => {
    expect(localSafeName('a:b?.txt')).toBe('a_b_.txt');
    expect(localSafeName('CON.txt')).toBe('_CON.txt');
    expect(localSafeName('trailing. ')).toBe('trailing');
  });
});

describe('rclone providers', () => {
  const cat = providerCatalog(providersJson);
  it('lists services people use first and leaves out building blocks', () => {
    expect(cat.slice(0, 3).map((p) => p.name)).toEqual(['Google Drive', 'OneDrive', 'Dropbox']);
    expect(cat.find((p) => p.id === 'local')).toBeUndefined();
    expect(cat.find((p) => p.id === 'crypt')).toBeUndefined();
    expect(cat.find((p) => p.id === 'drive')?.oauth).toBe(true);
    expect(cat.find((p) => p.id === 'webdav')?.oauth).toBe(false);
    expect(cat.find((p) => p.id === 'iclouddrive')?.beta).toBe(true);
    expect(cat.find((p) => p.id === 'jottacloud')?.name).toBe('Jottacloud');
  });
  it('accepts the rc answer shape too', () => {
    expect(providerCatalog({ providers: providersJson }).length).toBe(cat.length);
  });
  it('builds a form without tokens or hidden options', () => {
    const drive = formFor(providersJson, 'drive');
    expect(drive.map((f) => f.name)).not.toContain('token');
    expect(drive.map((f) => f.name)).not.toContain('encoding');
    expect(drive.find((f) => f.name === 'client_secret')?.secret).toBe(true);
    expect(drive.find((f) => f.name === 'use_trash')).toMatchObject({ type: 'bool', advanced: true, default: 'true' });
    expect(drive.find((f) => f.name === 'scope')?.suggestions?.length).toBe(2);
    expect(formFor(providersJson, 'sftp').map((f) => f.name)).not.toContain('hidden_internal');
    expect(formFor(providersJson, 'onedrive').find((f) => f.name === 'region')?.type).toBe('select');
    expect(formFor(providersJson, 'webdav').find((f) => f.name === 'pass')).toMatchObject({ type: 'password', secret: true });
    // Basic fields come before advanced ones, required ones first.
    const sftp = formFor(providersJson, 'sftp');
    expect(sftp[0].name).toBe('host');
  });
  it('shows the fields that apply to the chosen S3 provider', () => {
    expect(appliesTo('AWS,Ceph', 'ceph')).toBe(true);
    expect(appliesTo('!AWS', 'AWS')).toBe(false);
    expect(appliesTo(undefined, 'x')).toBe(true);
    const none = formFor(providersJson, 's3').map((f) => f.name);
    expect(none).toContain('endpoint');
    expect(none).not.toContain('region');
    const aws = formFor(providersJson, 's3', 'AWS').map((f) => f.name);
    expect(aws).toContain('region');
    expect(aws).not.toContain('endpoint');
    const minio = formFor(providersJson, 's3', 'Minio').map((f) => f.name);
    expect(minio).toContain('endpoint');
    expect(minio).not.toContain('storage_class');
  });
  it('splits values into plain settings and secrets, leaving out defaults and blanks', () => {
    const fields = formFor(providersJson, 'webdav');
    expect(formValues(fields, { url: ' https://x/ ', user: 'ana', pass: 'p', vendor: '', bearer_token: undefined })).toEqual({ plain: { url: 'https://x/' }, secret: { user: 'ana', pass: 'p' } });
    const drive = formFor(providersJson, 'drive');
    expect(formValues(drive, { use_trash: true, team_drive: 'abc' }).plain).toEqual({ team_drive: 'abc' });
    expect(formValues(drive, { use_trash: false }).plain).toEqual({ use_trash: 'false' });
  });
  it('recognises errors that need a new sign-in', () => {
    expect(needsSignIn('oauth2: cannot fetch token: 400 Bad Request Response: {"error": "invalid_grant"}')).toBe(true);
    expect(needsSignIn('couldn\'t list: HTTP 401 Unauthorized')).toBe(true);
    expect(needsSignIn('directory not found')).toBe(false);
  });
});

describe('the download cache', () => {
  it('removes what was used longest ago until it fits, keeping open files', () => {
    const files = [{ path: 'a', size: 50, used: 1 }, { path: 'b', size: 50, used: 2 }, { path: 'c', size: 50, used: 3 }];
    expect(evictionPlan(files, 200)).toEqual([]);
    expect(evictionPlan(files, 100)).toEqual(['a']);
    expect(evictionPlan(files, 60, (p) => p === 'a')).toEqual(['b', 'c']);
  });
  it('fetches a file again when it changed on the server', () => {
    expect(cacheKey('x', '/a', 10, 1000)).toBe(cacheKey('x', '/a', 10, 1400));
    expect(cacheKey('x', '/a', 10, 1000)).not.toBe(cacheKey('x', '/a', 11, 1000));
    expect(cacheKey('x', '/a', 10, 1000)).not.toBe(cacheKey('y', '/a', 10, 1000));
  });
});

describe('WebDAV answers', () => {
  const nextcloud = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns">
<d:response><d:href>/remote.php/dav/files/ana/Photos/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getlastmodified>Fri, 30 Oct 2026 10:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/ana/Photos/Beach%20day.jpg</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>4400000</d:getcontentlength><d:getcontenttype>image/jpeg</d:getcontenttype><d:getlastmodified>Thu, 29 Oct 2026 09:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><oc:size/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>
<d:response><d:href>/remote.php/dav/files/ana/Photos/Trips/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getlastmodified>Wed, 28 Oct 2026 09:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;
  it('lists a Nextcloud folder, leaving out the folder itself', () => {
    const e = parseMultistatus(nextcloud, '/remote.php/dav/files/ana', '/Photos');
    expect(e.map((x) => [x.name, x.isDir, x.size])).toEqual([['Beach day.jpg', false, 4400000], ['Trips', true, 0]]);
    expect(e[0].mime).toBe('image/jpeg');
    expect(e[0].path).toBe('/Photos/Beach day.jpg');
    expect(new Date(e[0].mtime).toISOString()).toBe('2026-10-29T09:00:00.000Z');
  });
  it('handles servers that send full URLs and other prefixes', () => {
    const apache = `<D:multistatus xmlns:D="DAV:"><D:response><D:href>http://nas.local/dav/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><D:response><D:href>http://nas.local/dav/a%26b.txt</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>3</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
    expect(parseMultistatus(apache, '/dav', '/').map((x) => x.path)).toEqual(['/a&b.txt']);
  });
  it('reads quota, treating negative numbers as unlimited', () => {
    expect(parseQuota('<d:quota-available-bytes>100</d:quota-available-bytes><d:quota-used-bytes>50</d:quota-used-bytes>')).toEqual({ free: 100, used: 50, total: 150 });
    expect(parseQuota('<d:quota-available-bytes>-3</d:quota-available-bytes><d:quota-used-bytes>50</d:quota-used-bytes>')).toEqual({ free: undefined, used: 50, total: undefined });
    expect(parseQuota('<x/>')).toBeUndefined();
  });
});

describe('machines on the network', () => {
  it('recognises home servers, NAS boxes, Macs, Windows PCs and Linux machines', () => {
    expect(classifyDevice({ name: 'umbrel', host: 'umbrel.local', protocols: ['http'] })).toMatchObject({ kind: 'home-server', detail: 'umbrelOS' });
    expect(classifyDevice({ name: 'box', host: 'box.local', protocols: ['http'], webTitle: 'CasaOS' }).kind).toBe('home-server');
    expect(classifyDevice({ name: 'umbrel', host: 'umbrel.local', protocols: ['http'] }).tip).toMatch(/SMB/);
    expect(classifyDevice({ name: 'DiskStation', host: 'DiskStation.local', protocols: ['smb', 'afp'] })).toMatchObject({ kind: 'nas', detail: 'Synology NAS', suggest: 'smb' });
    expect(classifyDevice({ name: 'Studio', host: 'studio.local', protocols: ['smb'], txt: { model: 'MacStudio1,1' } })).toMatchObject({ kind: 'mac', suggest: 'smb' });
    expect(classifyDevice({ name: 'DESKTOP-7Q2LM0K', host: 'DESKTOP-7Q2LM0K', protocols: ['smb'] }).kind).toBe('windows');
    expect(classifyDevice({ name: 'homelab', host: 'homelab.local', protocols: ['ssh'] })).toMatchObject({ kind: 'linux', suggest: 'sftp' });
    expect(classifyDevice({ name: 'printer', host: 'p.local', protocols: [] }).kind).toBe('unknown');
  });
  it('reads shared folder lists from smbclient, smbutil and net view', () => {
    expect(parseSmbclient('Disk|Media|Movies and TV\nDisk|IPC$|IPC Service\nPrinter|hp|\nDisk|Seagate Expansion|External USB disk\n')).toEqual([
      { name: 'Media', comment: 'Movies and TV', external: false },
      { name: 'Seagate Expansion', comment: 'External USB disk', external: true },
    ]);
    expect(parseSmbclient('\n\tSharename       Type      Comment\n\t---------       ----      -------\n\tumbrel          Disk      umbrelOS files\n\tIPC$            IPC       IPC Service\n').map((s) => s.name)).toEqual(['umbrel']);
    expect(parseSmbutil('Share                                           Type    Comments\n-------------------------------\nPublic                                          Disk    \nana                                             Disk    Ana’s home\nIPC$                                            Pipe    \n\n3 shares listed\n').map((s) => s.name)).toEqual(['Public', 'ana']);
    expect(parseNetView('Shared resources at \\\\DESKTOP-7Q2LM0K\n\nShare name  Type  Used as  Comment\n\n-------------------------------------------------------------------------------\nPhotos      Disk           Family photos\nUsers       Disk  Z:\nThe command completed successfully.\n')).toEqual([
      { name: 'Photos', comment: 'Family photos', external: false },
      { name: 'Users', comment: undefined, external: false },
    ]);
  });
  it('groups mDNS answers into one device per machine with its details', () => {
    const recs = [
      { name: '_device-info._tcp.local', type: 12, data: 'Ana’s Mac mini._device-info._tcp.local' },
      { name: 'Ana’s Mac mini._device-info._tcp.local', type: 16, data: 'model=Macmini9,1\nosxvers=24' },
      { name: '_smb._tcp.local', type: 12, data: 'Ana’s Mac mini._smb._tcp.local' },
      { name: 'Ana’s Mac mini._smb._tcp.local', type: 33, data: 'Anas-Mac-mini.local', port: 445 },
      { name: '_sftp-ssh._tcp.local', type: 12, data: 'Ana’s Mac mini._sftp-ssh._tcp.local' },
      { name: 'Ana’s Mac mini._sftp-ssh._tcp.local', type: 33, data: 'Anas-Mac-mini.local', port: 22 },
      { name: 'Anas-Mac-mini.local', type: 1, data: '192.168.0.31' },
      { name: '_http._tcp.local', type: 12, data: 'umbrel._http._tcp.local' },
      { name: 'umbrel._http._tcp.local', type: 33, data: 'umbrel.local', port: 80 },
    ];
    const d = devicesFromRecords(recs);
    expect(d.map((x) => [x.name, x.protocols.sort().join(','), x.address])).toEqual([['Ana’s Mac mini', 'sftp,smb', '192.168.0.31'], ['umbrel', 'http', undefined]]);
    expect(d[0].txt?.model).toBe('Macmini9,1');
    expect(classifyDevice(d[0]).kind).toBe('mac');
    expect(classifyDevice(d[0]).detail).toBe('Mac mini');
    expect(parseTxt(['a=1', 'B', ''])).toEqual({ a: '1', b: '' });
  });
});

// ---------------------------------------------------------------- the built-in clients, against real servers

function conn(partial: Partial<Connection>): Connection {
  return { id: 't', name: 't', kind: 'sftp', createdAt: 0, ...partial } as Connection;
}

async function exercise(fs: RemoteFs) {
  const names = (await fs.list('/')).map((e) => [e.name, e.isDir]).sort();
  expect(names).toEqual([['Photos', true], ['hello.txt', false]]);
  const hello = (await fs.list('/')).find((e) => e.name === 'hello.txt')!;
  expect(hello.size).toBe(11);
  expect(hello.mtime).toBeGreaterThan(0);
  expect(await text(await fs.read('/hello.txt'))).toBe('hello world');
  await fs.write('/Photos/new.txt', Readable.from([Buffer.from('uploaded ✓')]), Buffer.byteLength('uploaded ✓'));
  expect(await text(await fs.read('/Photos/new.txt'))).toBe('uploaded ✓');
  await fs.mkdir('/Made');
  await fs.rename('/Photos/new.txt', '/Made/moved.txt');
  expect((await fs.list('/Made')).map((e) => e.name)).toEqual(['moved.txt']);
  expect((await fs.stat('/Made/moved.txt'))?.size).toBe(Buffer.byteLength('uploaded ✓'));
  expect(await fs.stat('/nope.txt')).toBeNull();
  await fs.remove('/Made', true);
  expect((await fs.list('/')).map((e) => e.name).sort()).toEqual(['Photos', 'hello.txt']);
}

function seed(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'keeper-remote-'));
  writeFileSync(path.join(dir, 'hello.txt'), 'hello world');
  mkdirSync(path.join(dir, 'Photos'));
  return dir;
}

describe('SFTP', () => {
  let root: string;
  let server: { port: number; close: () => Promise<void> };
  beforeAll(async () => {
    root = seed();
    server = await require('./servers/sftp-server.cjs').start(root);
  });
  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists, reads, uploads, renames and deletes', async () => {
    const keys = new Map<string, string>();
    const fs = await SftpFs.open(conn({ kind: 'sftp', host: '127.0.0.1', port: server.port, user: 'ana' }), { password: 'secret' }, { get: (h) => keys.get(h), set: (h, f) => keys.set(h, f) });
    try {
      await exercise(fs);
      expect([...keys.values()][0]).toMatch(/^SHA256:/);
      // A byte range.
      expect(await text(await fs.read('/hello.txt', { start: 6, end: 11 }))).toBe('world');
    } finally {
      await fs.close();
    }
  });

  it('refuses a server whose key changed', async () => {
    const keys = { get: () => 'SHA256:somethingelse', set: () => undefined };
    await expect(SftpFs.open(conn({ kind: 'sftp', host: '127.0.0.1', port: server.port, user: 'ana' }), { password: 'secret' }, keys)).rejects.toBeInstanceOf(HostKeyChanged);
  });

  it('reports a wrong password', async () => {
    await expect(SftpFs.open(conn({ kind: 'sftp', host: '127.0.0.1', port: server.port, user: 'ana' }), { password: 'wrong' }, { get: () => undefined, set: () => undefined })).rejects.toThrow(/authentication/i);
  });
});

describe('FTP', () => {
  let root: string;
  let server: { port: number; close: () => Promise<void> };
  beforeAll(async () => {
    root = seed();
    server = await require('./servers/ftp-server.cjs').start(root);
  });
  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists, reads, uploads, renames and deletes', async () => {
    const fs = await FtpFs.open(conn({ kind: 'ftp', host: '127.0.0.1', port: server.port, user: 'ana' }), 'secret');
    try {
      await exercise(fs);
      // Requests made at the same moment wait their turn on the one connection.
      const [a, b] = await Promise.all([fs.list('/'), fs.list('/Photos')]);
      expect(a.length).toBe(2);
      expect(b.length).toBe(0);
    } finally {
      await fs.close();
    }
  });

  it('reports a wrong password', async () => {
    await expect(FtpFs.open(conn({ kind: 'ftp', host: '127.0.0.1', port: server.port, user: 'ana' }), 'nope')).rejects.toThrow(/530/);
  });
});

describe('WebDAV', () => {
  let root: string;
  let server: { port: number; base: string; close: () => Promise<void> };
  beforeAll(async () => {
    root = seed();
    server = await require('./servers/webdav-server.cjs').start(root);
  });
  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists, reads, uploads, renames and deletes, under a Nextcloud-style path', async () => {
    const fs = await WebDavFs.open(conn({ kind: 'webdav', host: '127.0.0.1', port: server.port, user: 'ana', root: server.base }), 'secret');
    try {
      await exercise(fs);
      expect(await text(await fs.read('/hello.txt', { start: 0, end: 5 }))).toBe('hello');
      expect(await fs.quota()).toEqual({ free: 1000000, used: 2500, total: 1002500 });
    } finally {
      await fs.close();
    }
  });

  it('says when the password is wrong', async () => {
    await expect(WebDavFs.open(conn({ kind: 'webdav', host: '127.0.0.1', port: server.port, user: 'ana', root: server.base }), 'wrong')).rejects.toThrow(/did not accept/);
  });
});

describe('rclone', () => {
  let server: http.Server;
  let port = 0;
  const calls: { path: string; body: Record<string, unknown>; auth?: string }[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.headers.authorization !== 'Basic ' + Buffer.from('keeper:pw').toString('base64')) {
          res.writeHead(401);
          return res.end();
        }
        if (req.method === 'GET') {
          // --rc-serve: /[remote:]/path
          expect(req.url).toBe('/[keeper-abc:]/Photos/Beach%20day.jpg');
          res.writeHead(req.headers.range ? 206 : 200);
          return res.end(req.headers.range ? 'Bea' : 'Beach bytes');
        }
        const json = body ? JSON.parse(body) : {};
        calls.push({ path: req.url!, body: json });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/operations/list') return res.end(JSON.stringify({ list: [{ Path: 'Photos/Beach day.jpg', Name: 'Beach day.jpg', Size: 4400, MimeType: 'image/jpeg', ModTime: '2026-10-29T09:00:00Z', IsDir: false }, { Path: 'Photos/Trips', Name: 'Trips', Size: -1, ModTime: '2026-10-28T09:00:00Z', IsDir: true }] }));
        if (req.url === '/operations/about') return res.end(JSON.stringify({ total: 100, used: 40, free: 60 }));
        if (req.url === '/operations/deletefile') {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: 'oauth2: cannot fetch token: invalid_grant', status: 500 }));
        }
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('calls rc with the password and maps listings', async () => {
    const rc = new RcClient(`http://127.0.0.1:${port}`, 'keeper', 'pw');
    const daemon = { rc: async () => rc, hold: () => () => undefined } as unknown as RcloneDaemon;
    const fs = new RcloneFs(daemon, conn({ kind: 'rclone', provider: 'drive', root: '/' }), remoteNameFor('abc'));
    const list = await fs.list('/Photos');
    expect(list).toEqual([
      { name: 'Beach day.jpg', path: '/Photos/Beach day.jpg', isDir: false, size: 4400, mtime: Date.parse('2026-10-29T09:00:00Z'), mime: 'image/jpeg' },
      { name: 'Trips', path: '/Photos/Trips', isDir: true, size: 0, mtime: Date.parse('2026-10-28T09:00:00Z'), mime: undefined },
    ]);
    expect(calls.at(-1)).toMatchObject({ path: '/operations/list', body: { fs: 'keeper-abc:', remote: 'Photos' } });
    expect(await fs.quota()).toEqual({ total: 100, used: 40, free: 60, trashed: undefined });
    expect(await text(await fs.read('/Photos/Beach day.jpg'))).toBe('Beach bytes');
    expect(await text(await fs.read('/Photos/Beach day.jpg', { start: 0, end: 3 }))).toBe('Bea');
    await expect(fs.remove('/x', false)).rejects.toThrow(/invalid_grant/);
    expect(needsSignIn('oauth2: cannot fetch token: invalid_grant')).toBe(true);
  });

  it('refuses calls without the password', async () => {
    await expect(new RcClient(`http://127.0.0.1:${port}`, 'keeper', 'wrong').call('rc/noop')).rejects.toMatchObject({ status: 401 });
  });

  it('reads the token rclone authorize prints', () => {
    const out = 'If your browser doesn\'t open automatically go to...\nPaste the following into your remote machine --->\n{"access_token":"ya29","token_type":"Bearer","expiry":"2026-10-31T10:00:00Z"}\n<---End paste\n';
    expect(JSON.parse(parseAuthorizeOutput(out)!).access_token).toBe('ya29');
    expect(parseAuthorizeOutput('Error: failed to get token')).toBeNull();
  });

  it('finds rclone: an override, the bundled copy, then the system one', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'keeper-rclone-'));
    const exe = process.platform === 'win32' ? 'rclone.exe' : 'rclone';
    mkdirSync(path.join(dir, 'rclone'));
    writeFileSync(path.join(dir, 'rclone', exe), '');
    expect(findRclone({ resourcesPath: dir, env: { PATH: '' } })).toBe(path.join(dir, 'rclone', exe));
    expect(findRclone({ env: { PATH: '', KEEPER_RCLONE: path.join(dir, 'rclone', exe) } })).toBe(path.join(dir, 'rclone', exe));
    expect(findRclone({ env: { PATH: path.join(dir, 'rclone') } })).toBe(path.join(dir, 'rclone', exe));
    expect(findRclone({ env: { PATH: '' } })).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('pins a checksum for every build Keeper ships', () => {
    const script = readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-rclone.mjs'), 'utf8');
    for (const k of ['linux-amd64', 'linux-arm64', 'osx-amd64', 'osx-arm64', 'windows-amd64', 'windows-arm64']) expect(script).toMatch(new RegExp(`'${k}': '[0-9a-f]{64}'`));
  });
});

describe('FTP listing dates', () => {
  it('reads recent, older and Windows-style dates', async () => {
    const { listDate } = await import('../electron/services/remote/ftp');
    const now = new Date(2026, 9, 31, 12, 0).getTime();
    expect(new Date(listDate('Oct 31 01:23', now))).toEqual(new Date(2026, 9, 31, 1, 23));
    expect(new Date(listDate('Dec 24 18:00', now)).getFullYear()).toBe(2025);
    expect(new Date(listDate('Mar  2  2024', now))).toEqual(new Date(2024, 2, 2));
    expect(new Date(listDate('10-31-26  01:23PM', now))).toEqual(new Date(2026, 9, 31, 13, 23));
    expect(listDate('whenever', now)).toBe(0);
  });
});
