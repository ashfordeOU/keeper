// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktops: what people type, connection files in and out, VNC's DES,
// known_hosts, the list, and the hosting parsers.

import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { desEncrypt, vncObfuscate, vncResponse, vncUnobfuscate } from '../core/rdc/des';
import { decodeText, detectFormat, exportText, importText, parseJson, parseRdp, parseSshConfig, parseVnc, toJson, toRdp, toSshConfig, toVnc, redact } from '../core/rdc/formats';
import { guessFromPorts, parseTarget, splitHostPort, toUri, vncPort } from '../core/rdc/uri';
import { checkKnownHost, fingerprint, keyType, knownHostsLine } from '../core/rdc/knownhosts';
import { filterConnections, findConnection, foldersOf, sortConnections, tagsOf } from '../core/rdc/list';
import { hostingFindings, listenState, lockoutOn, parseGrdctl, parseListeners, regDword, securityChecks, windowsCanHost, winRdpPlan, x11vncArgs, type HostItem } from '../core/rdc/hosting';
import { comboEvents, keysymFor } from '../core/rdc/keysym';
import type { Connection } from '../core/rdc/types';

const conn = (x: Partial<Connection> & Pick<Connection, 'protocol' | 'host'>): Connection => ({ id: 'c1', name: x.host, created: 1, ...x });

describe('rdc: what people type', () => {
  it('reads links for every protocol', () => {
    expect(parseTarget('rdp://office-pc')).toMatchObject({ protocol: 'rdp', host: 'office-pc', guess: false });
    expect(parseTarget('rdp://ana@office-pc:3390')).toMatchObject({ protocol: 'rdp', host: 'office-pc', port: 3390, user: 'ana' });
    expect(parseTarget('vnc://pi.local:5901')).toMatchObject({ protocol: 'vnc', host: 'pi.local', port: 5901 });
    expect(parseTarget('vnc://pi.local:1')).toMatchObject({ protocol: 'vnc', port: 5901 });
    expect(parseTarget('vnc://pi.local::5999')).toMatchObject({ protocol: 'vnc', port: 5999 });
    expect(parseTarget('ssh://deploy@web.example.com:2222')).toMatchObject({ protocol: 'ssh', host: 'web.example.com', user: 'deploy', port: 2222 });
    expect(parseTarget('telnet://10.0.0.2')).toMatchObject({ protocol: 'telnet', host: '10.0.0.2' });
    expect(parseTarget('spice://vm.lan:5930')).toMatchObject({ protocol: 'spice', port: 5930 });
    expect(parseTarget('https://idrac.lan/console')).toMatchObject({ protocol: 'web', host: 'idrac.lan', extra: { web: { url: 'https://idrac.lan/console' } } });
    expect(parseTarget('serial:///dev/ttyUSB0?baud=115200')).toMatchObject({ protocol: 'serial', host: '/dev/ttyUSB0', extra: { serial: { baud: 115200 } } });
    expect(parseTarget('rdp://full%20address=s:host.example:3391&username=s:bob')).toMatchObject({ protocol: 'rdp', host: 'host.example', port: 3391, user: 'bob' });
  });

  it('reads commands, user@host and bare hosts (which are guessed)', () => {
    expect(parseTarget('ssh ana@build-01 -p 2200 -J bastion,jump2')).toMatchObject({ protocol: 'ssh', host: 'build-01', user: 'ana', port: 2200, extra: { jump: ['bastion', 'jump2'] } });
    expect(parseTarget('mosh ana@devbox')).toMatchObject({ protocol: 'mosh', host: 'devbox', user: 'ana' });
    expect(parseTarget('telnet switch 2323')).toMatchObject({ protocol: 'telnet', host: 'switch', port: 2323 });
    expect(parseTarget('ana@10.0.0.5')).toMatchObject({ protocol: 'ssh', host: '10.0.0.5', user: 'ana' });
    expect(parseTarget('office-pc')).toMatchObject({ host: 'office-pc', guess: true });
    expect(parseTarget('192.168.1.20:3389')).toMatchObject({ protocol: 'rdp', guess: false });
    expect(parseTarget('192.168.1.20:5902')).toMatchObject({ protocol: 'vnc', port: 5902 });
    expect(parseTarget('[fe80::1]:5900')).toMatchObject({ protocol: 'vnc', host: 'fe80::1', port: 5900 });
    expect(parseTarget('COM3')).toMatchObject({ protocol: 'serial', host: 'COM3' });
  });

  it('refuses what is not a host', () => {
    for (const bad of ['', 'two words here', 'ftp://x', 'host:99999', '999.1.1.1', 'rdp://', 'bad_host!']) expect(parseTarget(bad), bad).toBeNull();
    expect(splitHostPort('a:0')).toBeNull();
    expect(vncPort('2')).toBe(5902);
    expect(vncPort('6000')).toBe(6000);
  });

  it('writes links back (without secrets) and they read the same', () => {
    for (const c of [conn({ protocol: 'rdp', host: 'pc', user: 'ana', port: 3390 }), conn({ protocol: 'vnc', host: 'pi', port: 5901 }), conn({ protocol: 'ssh', host: 'fe80::1', user: 'x' })]) {
      const back = parseTarget(toUri(c))!;
      expect(back).toMatchObject({ protocol: c.protocol, host: c.host, user: c.user });
    }
    expect(toUri(conn({ protocol: 'serial', host: '/dev/ttyUSB0', serial: { baud: 115200 } }))).toBe('serial:///dev/ttyUSB0?baud=115200');
  });

  it('guesses RDP, then VNC, then SSH, then PowerShell from the ports that answer', () => {
    expect(guessFromPorts([22, 3389])).toEqual({ protocol: 'rdp', port: 3389 });
    expect(guessFromPorts([22, 5903, 5901])).toEqual({ protocol: 'vnc', port: 5901 });
    expect(guessFromPorts([22])).toEqual({ protocol: 'ssh', port: 22 });
    expect(guessFromPorts([5985])).toEqual({ protocol: 'winrm', port: 5985 });
    expect(guessFromPorts([])).toBeNull();
  });
});

describe('rdc: connection files', () => {
  const RDP = 'full address:s:office-pc.corp:3390\r\nusername:s:CORP\\ana\r\nscreen mode id:i:1\r\ndesktopwidth:i:1920\r\ndesktopheight:i:1080\r\nuse multimon:i:1\r\nredirectclipboard:i:1\r\ndrivestoredirect:s:*\r\naudiomode:i:2\r\ngatewayhostname:s:rdg.corp\r\ngatewayusagemethod:i:1\r\nenablecredsspsupport:i:1\r\nadministrative session:i:1\r\n';

  it('.rdp: reads Windows files (UTF-16 with a mark) and writes them back the same', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...Buffer.from(RDP, 'utf16le')]);
    const text = decodeText(utf16);
    expect(detectFormat(text, 'Office PC.rdp')).toBe('rdp');
    const [r] = parseRdp(text, 'C:\\Users\\ana\\Office PC.rdp');
    expect(r.conn).toMatchObject({ name: 'Office PC', protocol: 'rdp', host: 'office-pc.corp', port: 3390, user: 'ana', domain: 'CORP', rdp: { width: 1920, height: 1080, fullscreen: false, multimon: true, drives: true, audio: 'off', gateway: 'rdg.corp', admin: true } });
    const again = parseRdp(toRdp({ ...r.conn, id: 'x', created: 1 }), 'Office PC.rdp')[0].conn;
    expect(again).toEqual(r.conn);
    expect(toRdp({ ...r.conn, id: 'x', created: 1 })).not.toMatch(/password/i);
  });

  it('.vnc: reads RealVNC/TightVNC files, the stored password goes to the keychain only', () => {
    const scrambled = Buffer.from(vncObfuscate('secret')).toString('hex');
    const [v] = parseVnc(`[Connection]\nHost=pi.local:2\nPassword=${scrambled}\nUserName=pi\n[Options]\nViewOnly=1\n`, 'Pi.vnc');
    expect(v.conn).toMatchObject({ name: 'Pi', protocol: 'vnc', host: 'pi.local', port: 5902, user: 'pi', vnc: { viewOnly: true } });
    expect(v.secret).toBe('secret');
    const out = toVnc({ ...v.conn, id: 'x', created: 1 });
    expect(out).not.toContain(scrambled);
    expect(parseVnc(out, 'Pi.vnc')[0].conn).toEqual(v.conn);
    expect(parseVnc('[connection]\nhost=10.0.0.9\nport=5911\n')[0].conn).toMatchObject({ host: '10.0.0.9', port: 5911 });
  });

  it('~/.ssh/config: Host entries in and out, patterns skipped, forwards kept', () => {
    const cfg = `Host *\n  ServerAliveInterval 30\n\nHost build build-alias\n  HostName build-01.lab\n  User ci\n  Port 2200\n  IdentityFile ~/.ssh/id_ed25519\n  ProxyJump bastion,jump2\n  ForwardAgent yes\n  ForwardX11 yes\n  LocalForward 8080 localhost:80\n  RemoteForward 127.0.0.1:9000 localhost:9000\n  DynamicForward 1080\n\nHost web\n  HostName=web.example.com\n`;
    const list = parseSshConfig(cfg);
    expect(list.map((x) => x.conn.name)).toEqual(['build', 'web']);
    expect(list[0].conn).toMatchObject({ host: 'build-01.lab', user: 'ci', port: 2200, keyFile: '~/.ssh/id_ed25519', auth: 'key', jump: ['bastion', 'jump2'], ssh: { agent: true, x11: true, forwards: [{ kind: 'L', listen: 8080, host: 'localhost', port: 80 }, { kind: 'R', listen: 9000, bind: '127.0.0.1', host: 'localhost', port: 9000 }, { kind: 'D', listen: 1080 }] } });
    const round = parseSshConfig(toSshConfig(list.map((x, i) => ({ ...x.conn, id: String(i), created: 1 }))));
    expect(round.map((x) => x.conn)).toEqual(list.map((x) => x.conn));
  });

  it('JSON: everything in and out; hasPassword and unknown fields never travel', () => {
    const c = { ...conn({ protocol: 'rdp', host: 'pc', user: 'ana', tags: ['a'], folder: 'Work', hasPassword: true, rdp: { multimon: true } }), evil: '<script>' } as Connection;
    const text = toJson([c]);
    expect(text).not.toContain('hasPassword');
    const back = parseJson(text);
    expect(back[0].conn).toMatchObject({ protocol: 'rdp', host: 'pc', user: 'ana', tags: ['a'], folder: 'Work', rdp: { multimon: true } });
    expect(JSON.stringify(back)).not.toContain('evil');
    expect(parseJson('{"connections":[{"protocol":"nope","host":"x"},{"protocol":"vnc"}]}')).toEqual([]);
    expect(importText(text, 'json')).toHaveLength(1);
    expect(exportText([c], 'rdp')).toContain('full address:s:pc');
  });

  it('never shows a secret', () => {
    expect(redact('xfreerdp /p:hunter2 failed: hunter2', ['hunter2'])).toBe('xfreerdp /p:•••• failed: ••••');
  });
});

describe('rdc: VNC passwords', () => {
  it('is real DES (the standard test vector)', () => {
    expect(Buffer.from(desEncrypt(Buffer.from('133457799BBCDFF1', 'hex'), Buffer.from('0123456789ABCDEF', 'hex'))).toString('hex')).toBe('85e813540f0ab405');
  });
  it('scrambles stored passwords as x11vnc -storepasswd does', () => {
    // `x11vnc -storepasswd secret file` writes exactly these bytes.
    expect(Buffer.from(vncObfuscate('secret')).toString('hex')).toBe('2e2dbf576eb06c9e');
    expect(vncUnobfuscate('2e2dbf576eb06c9e')).toBe('secret');
    expect(vncUnobfuscate(vncObfuscate('12345678toolong'))).toBe('12345678');
  });
  it('answers a challenge with 16 bytes that depend on password and challenge', () => {
    const ch = new Uint8Array(16).map((_, i) => i * 7);
    const a = vncResponse('pw', ch);
    expect(a).toHaveLength(16);
    expect(Buffer.from(a).equals(Buffer.from(vncResponse('pw2', ch)))).toBe(false);
  });
});

describe('rdc: known_hosts', () => {
  const blob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from([0, 0, 0, 32]), Buffer.alloc(32, 7)]);
  const b64 = blob.toString('base64');
  it('fingerprints like ssh and reads the key type', () => {
    expect(fingerprint(blob)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect(keyType(blob)).toBe('ssh-ed25519');
  });
  it('finds plain, bracketed and hashed entries, and notices a changed key', () => {
    expect(checkKnownHost(`${knownHostsLine('pc', 22, 'ssh-ed25519', b64)}\n`, 'pc', 22, 'ssh-ed25519', b64)).toBe('known');
    expect(checkKnownHost(`${knownHostsLine('pc', 2222, 'ssh-ed25519', b64)}\n`, 'pc', 2222, 'ssh-ed25519', b64)).toBe('known');
    expect(checkKnownHost(`[pc]:2222 ssh-ed25519 ${b64}\n`, 'pc', 22, 'ssh-ed25519', b64)).toBe('unknown');
    const salt = Buffer.alloc(20, 3);
    const hashed = `|1|${salt.toString('base64')}|${createHmac('sha1', salt).update('pc').digest('base64')} ssh-ed25519 ${b64}`;
    expect(checkKnownHost(hashed, 'pc', 22, 'ssh-ed25519', b64)).toBe('known');
    expect(checkKnownHost(`pc,10.0.0.1 ssh-ed25519 AAAAother\n`, 'pc', 22, 'ssh-ed25519', b64)).toBe('changed');
    expect(checkKnownHost(`*.lab ssh-ed25519 ${b64}\n`, 'build.lab', 22, 'ssh-ed25519', b64)).toBe('known');
  });
});

describe('rdc: the list', () => {
  const list = [
    conn({ id: 'a', name: 'Office PC', protocol: 'rdp', host: 'office', folder: 'Work', tags: ['windows'] }),
    conn({ id: 'b', name: 'Pi', protocol: 'vnc', host: 'pi.local', folder: 'Home', favourite: true }),
    conn({ id: 'c', name: 'Build', protocol: 'ssh', host: 'build', folder: 'Work/Lab', tags: ['linux'] }),
  ];
  it('searches, filters by folder (with subfolders), tag and favourites, and sorts favourites first', () => {
    expect(filterConnections(list, { q: 'work ssh' }).map((c) => c.id)).toEqual(['c']);
    expect(filterConnections(list, { folder: 'Work' }).map((c) => c.id)).toEqual(['a', 'c']);
    expect(filterConnections(list, { tag: 'linux' }).map((c) => c.id)).toEqual(['c']);
    expect(filterConnections(list, { favourites: true }).map((c) => c.id)).toEqual(['b']);
    expect(sortConnections(list)[0].id).toBe('b');
    expect(foldersOf(list)).toEqual(['Home', 'Work', 'Work/Lab']);
    expect(tagsOf(list)).toEqual(['linux', 'windows']);
    expect(findConnection(list, 'office')?.id).toBe('a');
    expect(findConnection(list, 'b')?.id).toBe('b');
  });
});

describe('rdc: keys', () => {
  it('maps keys to X keysyms', () => {
    expect(keysymFor({ key: 'a', code: 'KeyA' })).toBe(0x61);
    expect(keysymFor({ key: 'Enter', code: 'Enter' })).toBe(0xff0d);
    expect(keysymFor({ key: 'Shift', code: 'ShiftRight' })).toBe(0xffe2);
    expect(keysymFor({ key: 'F5', code: 'F5' })).toBe(0xffc2);
    expect(keysymFor({ key: 'é', code: 'KeyE' })).toBe(0xe9);
    expect(keysymFor({ key: '€', code: 'KeyE' })).toBe(0x010020ac);
    expect(comboEvents([1, 2, 3]).map((e) => `${e.keysym}${e.down ? '+' : '-'}`).join(' ')).toBe('1+ 2+ 3+ 3- 2- 1-');
  });
});

describe('rdc: hosting', () => {
  it('reads the registry, editions and lockout', () => {
    expect(regDword('    fDenyTSConnections    REG_DWORD    0x0\r\n', 'fDenyTSConnections')).toBe(0);
    expect(windowsCanHost('Core')).toBe(false);
    expect(windowsCanHost('CoreSingleLanguage')).toBe(false);
    expect(windowsCanHost('Professional')).toBe(true);
    expect(lockoutOn('Lockout threshold:                                    Never\r\n')).toBe(false);
    expect(lockoutOn('Lockout threshold:                                    10\r\n')).toBe(true);
  });
  it('turns Remote Desktop on with NLA and the firewall group, all under one admin prompt', () => {
    const p = winRdpPlan(true);
    expect(p.every((c) => c.admin)).toBe(true);
    expect(p[0].args).toContain('0');
    expect(p.some((c) => c.args.join(' ').includes('UserAuthentication'))).toBe(true);
    expect(p.some((c) => c.args.join(' ').includes('Enable-NetFirewallRule'))).toBe(true);
  });
  it('reads grdctl and listening sockets on every system', () => {
    expect(parseGrdctl('RDP:\n\tStatus: enabled\n\tPort: 3389\n\tUsername: ana\nVNC:\n\tStatus: disabled\n')).toEqual({ rdp: true, vnc: false, rdpUser: true });
    const ss = parseListeners('LISTEN 0 4096 127.0.0.1:5900 0.0.0.0:*\nLISTEN 0 4096 [::]:3389 [::]:*\n');
    expect(listenState(ss, 5900)).toBe('local');
    expect(listenState(ss, 3389)).toBe('all');
    expect(listenState(parseListeners('  TCP    0.0.0.0:3389           0.0.0.0:0              LISTENING\r\n'), 3389)).toBe('all');
    expect(listenState(parseListeners('tcp4       0      0  *.5900                 *.*                    LISTEN\n'), 5900)).toBe('all');
    expect(listenState(ss, 22)).toBe('no');
  });
  it('the checklist turns failures into To do items', () => {
    const items: HostItem[] = [{ id: 'win-rdp', name: 'Remote Desktop', protocol: 'rdp', port: 3389, available: true, on: true, listening: 'all', needsAdmin: true }];
    const checks = securityChecks({ os: 'win32', items, nla: false, lockout: false });
    expect(checks.map((c) => [c.id, c.ok])).toEqual([['nla', false], ['exposed', undefined], ['password', undefined], ['lockout', false]]);
    const f = hostingFindings(checks);
    expect(f.map((x) => x.id)).toEqual(['rdc:nla', 'rdc:lockout']);
    expect(f[0]).toMatchObject({ area: 'security', severity: 'high', fix: { kind: 'page', route: { name: 'rdc', arg: 'host' } } });
    expect(securityChecks({ os: 'linux', items: [] })).toEqual([expect.objectContaining({ id: 'exposed', ok: true })]);
  });
  it('x11vnc listens on this computer only by default and reads its password from a file', () => {
    const a = x11vncArgs(':0', '/p/x11vnc.passwd');
    expect(a).toContain('-localhost');
    expect(a).toEqual(expect.arrayContaining(['-rfbauth', '/p/x11vnc.passwd']));
    expect(x11vncArgs(':0', '/p', 5900, false)).not.toContain('-localhost');
  });
});

import { connectionFileFromArgv, DEFAULT_PLACES, fileMenuPlan, normalizePlaces, trayEntries } from '../core/rdc/places';

describe('rdc: where it appears', () => {
  it('keeps only sensible choices', () => {
    expect(normalizePlaces({ tray: false, sessions: 'window', accelerator: 'rm -rf' })).toEqual({ ...DEFAULT_PLACES, tray: false, sessions: 'window' });
    expect(normalizePlaces(null)).toEqual(DEFAULT_PLACES);
  });

  it('the tray shows favourites, recent ones and what is open, or nothing when switched off', () => {
    const list = [
      conn({ id: 'f', name: 'Fav', protocol: 'rdp', host: 'a', favourite: true }),
      conn({ id: 'r1', name: 'Old', protocol: 'ssh', host: 'b', lastUsed: 1 }),
      conn({ id: 'r2', name: 'New', protocol: 'vnc', host: 'c', lastUsed: 5 }),
      conn({ id: 'n', name: 'Never', protocol: 'vnc', host: 'd' }),
    ];
    const sessions = [{ id: 's1', name: 'New', protocol: 'vnc' as const, kind: 'inapp' as const, state: 'connected' as const, started: 1 }];
    const [top] = trayEntries(list, sessions, DEFAULT_PLACES);
    expect(top).toMatchObject({ label: 'Remote Desktops (1 open)' });
    const labels = ('submenu' in top ? top.submenu! : []).map((e) => ('label' in e ? e.label : '—'));
    expect(labels).toEqual(['Quick Connect…', '—', 'Favourites', 'Fav', '—', 'Recent', 'New', 'Old', '—', 'Open now', 'New', '—', 'All Connections…']);
    expect(trayEntries(list, sessions, { ...DEFAULT_PLACES, tray: false })).toEqual([]);
  });

  it('notices .rdp and .vnc files Keeper is asked to open', () => {
    expect(connectionFileFromArgv(['/opt/Keeper/keeper', '/home/a/Office PC.rdp'])).toEqual({ file: '/home/a/Office PC.rdp', action: 'connect' });
    expect(connectionFileFromArgv(['keeper.exe', '--rdc-edit', 'C:\\x\\pi.VNC'])).toEqual({ file: 'C:\\x\\pi.VNC', action: 'edit' });
    expect(connectionFileFromArgv(['keeper', '--hidden'])).toBeNull();
    expect(connectionFileFromArgv(['keeper', 'notes.txt'])).toBeNull();
  });

  it('adds "Connect with Keeper" per user: registry verbs on Windows, desktop files on Linux', () => {
    const w = fileMenuPlan('win32', 'C:\\Keeper\\Keeper.exe', 'C:\\Users\\a');
    expect(w.reg.every((r) => r[1].startsWith('HKCU\\Software\\Classes\\SystemFileAssociations\\'))).toBe(true);
    expect(w.reg).toContainEqual(['add', 'HKCU\\Software\\Classes\\SystemFileAssociations\\.rdp\\shell\\KeeperConnect\\command', '/ve', '/d', '"C:\\Keeper\\Keeper.exe" --rdc-connect "%1"', '/f']);
    const l = fileMenuPlan('linux', '/opt/Keeper/keeper', '/home/a');
    expect(l.files.map((f) => f.path)).toEqual(['/home/a/.local/share/applications/keeper-rdc.desktop', '/home/a/.local/share/kio/servicemenus/keeper-rdc.desktop', '/home/a/.local/share/nautilus/scripts/Connect with Keeper', '/home/a/.local/share/mime/packages/keeper-rdc.xml']);
    expect(l.files[0].content).toContain('MimeType=application/x-rdp;');
    expect(l.files[1].content).toContain('Name=Connect with Keeper');
  });
});
