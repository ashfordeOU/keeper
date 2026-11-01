// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The exact programs and arguments each connection uses on each system, and
// proof that a password never lands on a command line, in the environment or
// in a note (it goes to standard input or a private 0600 file).

import { describe, expect, it } from 'vitest';
import { freerdpArgs, launchPlan, NoEngine, sshArgs, visibleParts, type LaunchCtx } from '../core/rdc/clients';
import { vncUnobfuscate } from '../core/rdc/des';
import { engineInfo, ENGINES } from '../core/rdc/engines';
import type { Connection } from '../core/rdc/types';

const SECRET = 'p@ss w0rd!';
const conn = (x: Partial<Connection> & Pick<Connection, 'protocol' | 'host'>): Connection => ({ id: 'c1', name: 'Box', created: 1, ...x });
const ctx = (os: LaunchCtx['os'], found: LaunchCtx['found'], more: Partial<LaunchCtx> = {}): LaunchCtx => ({ os, found, host: 'box.lan', port: 3389, tmp: os === 'win32' ? 'C:\\T' : '/t', home: '/home/ana', password: SECRET, ...more });
const F = (path: string, bin = path.split(/[\\/]/).pop()!) => ({ path, bin });
const noSecret = (parts: string[]) => { for (const p of parts) expect(p).not.toContain(SECRET); };

describe('rdc: Remote Desktop on each system', () => {
  const c = conn({ protocol: 'rdp', host: 'box.lan', user: 'ana', domain: 'CORP', rdp: { width: 1920, height: 1080, multimon: true, drives: true, audio: 'remote', gateway: 'rdg.corp', gatewayUser: 'gw', admin: true, nla: false, ignoreCert: true } });

  it('Linux: FreeRDP 3 with mapped options, the password on standard input', () => {
    const p = launchPlan(c, ctx('linux', { freerdp: F('/usr/bin/xfreerdp3') }));
    expect(p.file).toBe('/usr/bin/xfreerdp3');
    expect(p.args).toEqual(['/v:box.lan:3389', '/t:Box', '/u:ana', '/d:CORP', '/from-stdin:force', '/size:1920x1080', '/multimon', '+clipboard', '/drive:home,/home/ana', '/audio-mode:1', '/sec:tls', '/admin', '/cert:ignore', '/gateway:g:rdg.corp,u:gw']);
    expect(p.stdin).toBe(`${SECRET}\n`);
    noSecret(visibleParts(p));
  });

  it('FreeRDP 2 spells the gateway differently; no password means no stdin', () => {
    const a = freerdpArgs(c, { host: 'h', port: 3390, home: '/h' }, 2);
    expect(a).toEqual(expect.arrayContaining(['/v:h:3390', '/g:rdg.corp', '/gu:gw']));
    expect(a).not.toContain('/from-stdin:force');
    const p = launchPlan(conn({ protocol: 'rdp', host: 'b' }), ctx('linux', { freerdp: F('/usr/bin/xfreerdp') }, { password: undefined }));
    expect(p.stdin).toBeUndefined();
    expect(p.args).toEqual(['/v:box.lan:3389', '/t:Box', '+clipboard', '/sound', '/cert:tofu']);
  });

  it('Windows: mstsc with a private temporary .rdp file (no password in it)', () => {
    const p = launchPlan(c, ctx('win32', { mstsc: F('C:\\Windows\\System32\\mstsc.exe') }));
    expect(p.file).toBe('C:\\Windows\\System32\\mstsc.exe');
    expect(p.args[0]).toMatch(/^C:\\T\\Box\.rdp$/);
    expect(p.args).toEqual(expect.arrayContaining(['/admin', '/multimon']));
    expect(p.files?.[0]).toMatchObject({ mode: 0o600 });
    expect(String(p.files?.[0].content)).toContain('full address:s:box.lan');
    expect(String(p.files?.[0].content)).not.toContain(SECRET);
    noSecret(visibleParts(p));
  });

  it('macOS: FreeRDP when installed, otherwise the system app through a .rdp file', () => {
    expect(launchPlan(c, ctx('darwin', { freerdp: F('/opt/homebrew/bin/sdl-freerdp3') })).file).toBe('/opt/homebrew/bin/sdl-freerdp3');
    const p = launchPlan(c, ctx('darwin', {}));
    expect(p.file).toBe('/usr/bin/open');
    expect(p.args[0]).toBe('/t/Box.rdp');
    noSecret([...visibleParts(p), String(p.files?.[0].content)]);
  });

  it('Linux without FreeRDP says what to install', () => {
    expect(() => launchPlan(c, ctx('linux', {}))).toThrow(NoEngine);
  });
});

describe('rdc: terminals', () => {
  it('SSH: jump hosts, forwards, X11, agent, key; password through a private askpass file', () => {
    const c = conn({ protocol: 'ssh', host: 'build', user: 'ci', keyFile: '~/.ssh/id', auth: 'password', jump: ['bastion', 'u@jump2:2200'], ssh: { x11: true, agent: true, forwards: [{ kind: 'L', listen: 8080, host: 'localhost', port: 80 }, { kind: 'R', listen: 9000, bind: '127.0.0.1', host: 'db', port: 5432 }, { kind: 'D', listen: 1080 }] } });
    const p = launchPlan(c, ctx('linux', { ssh: F('/usr/bin/ssh') }, { port: 2222 }));
    expect(p.where).toBe('terminal');
    expect(p.args).toEqual(['-p', '2222', '-J', 'bastion,u@jump2:2200', '-i', '~/.ssh/id', '-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=password,keyboard-interactive', '-A', '-X', '-L', '8080:localhost:80', '-R', '127.0.0.1:9000:db:5432', '-D', '1080', '-o', 'StrictHostKeyChecking=ask', '-o', 'ServerAliveInterval=30', 'ci@box.lan']);
    expect(p.env).toMatchObject({ SSH_ASKPASS_REQUIRE: 'force', SSH_ASKPASS: '/t/askpass.sh', KEEPER_ASKPASS_FILE: '/t/secret' });
    const secret = p.files!.find((f) => f.path === '/t/secret')!;
    expect(secret).toMatchObject({ content: SECRET, mode: 0o600 });
    const script = String(p.files!.find((f) => f.path.endsWith('askpass.sh'))!.content);
    expect(script).not.toContain(SECRET);
    expect(script).toMatch(/\*\) exit 1/); // a host key question is never answered with the password
    noSecret(visibleParts(p));
  });

  it('SSH through a forward checks the key under the real name; a gateway becomes -J', () => {
    expect(sshArgs(conn({ protocol: 'ssh', host: 'x' }), { host: '127.0.0.1', port: 40001, aliasOf: 'real.lan' })).toEqual(expect.arrayContaining(['-o', 'HostKeyAlias=real.lan', '127.0.0.1']));
    expect(sshArgs(conn({ protocol: 'ssh', host: 'x', gateway: { kind: 'ssh', host: 'gw', user: 'u' } }), { host: 'x', port: 22 })).toEqual(expect.arrayContaining(['-J', 'u@gw']));
    expect(sshArgs(conn({ protocol: 'ssh', host: 'x', user: 'a;rm -rf /' }), { host: 'x', port: 22 }).pop()).toBe('x');
  });

  it('Mosh, Telnet, serial and PowerShell', () => {
    const m = launchPlan(conn({ protocol: 'mosh', host: 'dev', user: 'ana' }), ctx('linux', { mosh: F('/usr/bin/mosh') }, { port: 2222, password: undefined }));
    expect(m.args).toEqual(['--ssh=ssh -p 2222', 'ana@box.lan']);
    expect(launchPlan(conn({ protocol: 'telnet', host: 's' }), ctx('linux', { telnet: F('/usr/bin/telnet') }, { port: 23 })).args).toEqual(['box.lan', '23']);
    expect(launchPlan(conn({ protocol: 'telnet', host: 's' }), ctx('win32', { telnet: F('C:\\p\\plink.exe', 'plink') }, { port: 23 })).args).toEqual(['-telnet', '-P', '23', 'box.lan']);
    const ser = (bin: string) => launchPlan(conn({ protocol: 'serial', host: '/dev/ttyUSB0', serial: { baud: 115200 } }), ctx('linux', { serial: F(`/usr/bin/${bin}`, bin) })).args;
    expect(ser('picocom')).toEqual(['-b', '115200', '-d', '8', '-y', 'n', '-p', '1', '/dev/ttyUSB0']);
    expect(ser('screen')).toEqual(['/dev/ttyUSB0', '115200']);
    expect(ser('plink')).toEqual(['-serial', '/dev/ttyUSB0', '-sercfg', '115200,8,n,1,N']);
    expect(() => launchPlan(conn({ protocol: 'serial', host: '/dev/x; rm' }), ctx('linux', { serial: F('/usr/bin/screen', 'screen') }))).toThrow();
    const ps = launchPlan(conn({ protocol: 'winrm', host: 'fs01', user: 'ana', domain: 'CORP', winrm: { ssl: true } }), ctx('win32', { pwsh: F('C:\\W\\powershell.exe') }, { host: 'fs01', port: 5986 }));
    expect(ps.args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-Command']);
    expect(ps.args[3]).toBe("Enter-PSSession -ComputerName 'fs01' -Port 5986 -UseSSL -Credential (Get-Credential -UserName 'CORP\\ana' -Message 'Sign in to Box')");
    noSecret(visibleParts(ps));
  });
});

describe('rdc: outside viewers', () => {
  it('TigerVNC reads a scrambled private password file; macOS falls back to Screen Sharing', () => {
    const p = launchPlan(conn({ protocol: 'vnc', host: 'pi', vnc: { viewOnly: true } }), ctx('linux', { vncviewer: F('/usr/bin/vncviewer') }, { port: 5901 }));
    expect(p.args).toEqual(['-passwd', '/t/passwd', '-ViewOnly', '-Shared', 'box.lan::5901']);
    expect(p.files![0].mode).toBe(0o600);
    expect(vncUnobfuscate(p.files![0].content as Uint8Array)).toBe(SECRET.slice(0, 8));
    noSecret(visibleParts(p));
    expect(launchPlan(conn({ protocol: 'vnc', host: 'pi', user: 'me' }), ctx('darwin', {}, { port: 5900 })).args).toEqual(['vnc://me@box.lan:5900']);
  });

  it('SPICE and X2Go get generated config files', () => {
    const s = launchPlan(conn({ protocol: 'spice', host: 'vm', spice: { tls: true } }), ctx('linux', { 'remote-viewer': F('/usr/bin/remote-viewer') }, { port: 5930 }));
    expect(String(s.files![0].content)).toMatch(/type=spice\nhost=box\.lan\ntls-port=5930/);
    expect(s.files![0].mode).toBe(0o600);
    noSecret(visibleParts(s));
    const x = launchPlan(conn({ protocol: 'x2go', host: 'old', user: 'ana', x2go: { command: 'MATE' } }), ctx('linux', { x2goclient: F('/usr/bin/x2goclient') }, { port: 22 }));
    expect(x.args).toEqual(['--session-conf=/t/sessions', '--session=Box', '--hide']);
    expect(String(x.files![0].content)).toContain('command=MATE');
  });

  it('lists each engine with an install hint for this system', () => {
    const fr = engineInfo(ENGINES.find((e) => e.id === 'freerdp')!, 'linux', null);
    expect(fr).toMatchObject({ found: false, hint: expect.stringContaining('apt install freerdp3-x11') });
    expect(engineInfo(ENGINES.find((e) => e.id === 'mosh')!, 'win32', null).na).toBe(true);
    for (const e of ENGINES) expect(e.url).toMatch(/^https:\/\//);
  });
});
