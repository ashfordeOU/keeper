// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { actionFor, comboFromEvent, conflicts, formatCombo, matches, parseCombo } from '../core/terminal/keys';
import { close, equalize, leaf, leaves, neighbour, rects, resize, split, swap } from '../core/terminal/layout';
import { parseOsc, ShellIntegration } from '../core/terminal/osc';
import { DEFAULT_KEYBINDINGS, defaultKeybindings, defaultTerminalSettings, normalizeTerminalSettings, quotePath, resolveLaunch, type ResolveContext } from '../core/terminal/profiles';
import { encode, LineDecoder, socketPath } from '../core/terminal/protocol';
import { RingBuffer, stripAnsi } from '../core/terminal/ring';
import { SCHEMES, xtermTheme } from '../core/terminal/schemes';
import { parseEtcShells, parseWhere, parseWslList, shellKindOf, unixShells, windowsShells } from '../core/terminal/shells';
import { hostMatches, parseSshConfig, resolveHost } from '../core/terminal/sshconfig';
import { patternError, TriggerWatcher } from '../core/terminal/triggers';
import type { PaneNode, TerminalProfile } from '../core/terminal/types';
import { TERM_KEYS, TERM_LANGS, termDictionary } from '../src/terminal/dict';
import { LANGUAGES } from '../src/i18n-strings';

const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  platform: 'linux',
  env: { PATH: '/usr/bin', SHELL: '/bin/zsh', HOME: '/home/a', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect' },
  home: '/home/a',
  dataDir: '/home/a/.config/Keeper',
  shells: [{ id: 'bash', label: 'Bash', file: '/bin/bash', args: ['-l'], kind: 'posix' }],
  sessionId: 's1',
  ...over,
});

describe('profiles', () => {
  it('starts the login shell with Keeper variables and without Electron ones', () => {
    const l = resolveLaunch({ id: 'default', name: 'Default', shell: 'default' }, ctx());
    expect(l.file).toBe('/bin/zsh');
    expect(l.args).toEqual(['-l']);
    expect(l.env.TERM).toBe('xterm-256color');
    expect(l.env.KEEPER_SESSION).toBe('s1');
    expect(l.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(l.env.NODE_OPTIONS).toBeUndefined();
    expect(l.cwd).toBe('/home/a');
  });

  it('gives an isolated profile its own config folders, so two sign-ins never mix', () => {
    const a = resolveLaunch({ id: 'work', name: 'Work', shell: 'bash', isolate: true }, ctx());
    const b = resolveLaunch({ id: 'personal', name: 'Personal', shell: 'bash', isolate: true }, ctx());
    expect(a.env.CLAUDE_CONFIG_DIR).toBe('/home/a/.config/Keeper/terminal/profiles/work/claude');
    expect(b.env.CLAUDE_CONFIG_DIR).toBe('/home/a/.config/Keeper/terminal/profiles/personal/claude');
    expect(a.env.XDG_CONFIG_HOME).not.toBe(b.env.XDG_CONFIG_HOME);
    expect(a.env.HOME).toBe('/home/a');
    const h = resolveLaunch({ id: 'work', name: 'Work', shell: 'bash', isolate: true, isolateHome: true }, ctx());
    expect(h.env.HOME).toBe('/home/a/.config/Keeper/terminal/profiles/work');
  });

  it('uses Windows paths for isolated profiles on Windows', () => {
    const l = resolveLaunch({ id: 'w', name: 'W', shell: 'cmd', isolate: true }, ctx({ platform: 'win32', dataDir: 'C:\\Users\\a\\AppData\\Roaming\\Keeper', home: 'C:\\Users\\a', shells: [] }));
    expect(l.env.CLAUDE_CONFIG_DIR).toBe('C:\\Users\\a\\AppData\\Roaming\\Keeper\\terminal\\profiles\\w\\claude');
    expect(l.file.toLowerCase()).toContain('powershell.exe');
  });

  it('applies locale, variables with ${VAR}, folder overrides and SSH', () => {
    const p: TerminalProfile = { id: 'x', name: 'X', shell: 'bash', locale: 'de_DE.UTF-8', env: { FOO: 'bar', P: '${PATH}:/opt/bin' }, cwd: '~/code' };
    const l = resolveLaunch(p, ctx());
    expect(l.env.LANG).toBe('de_DE.UTF-8');
    expect(l.env.LC_ALL).toBe('de_DE.UTF-8');
    expect(l.env.P).toBe('/usr/bin:/opt/bin');
    expect(l.cwd).toBe('/home/a/code');
    expect(resolveLaunch(p, ctx(), '/tmp').cwd).toBe('/tmp');
    const s = resolveLaunch({ id: 's', name: 'S', shell: 'default', ssh: 'pi@raspberry' }, ctx());
    expect([s.file, ...s.args]).toEqual(['ssh', 'pi@raspberry']);
  });

  it('quotes dropped paths for each kind of shell', () => {
    expect(quotePath('/tmp/a b/it\'s', 'posix')).toBe(`'/tmp/a b/it'\\''s'`);
    expect(quotePath('/tmp/plain.txt', 'posix')).toBe('/tmp/plain.txt');
    expect(quotePath('C:\\My Files\\a.txt', 'cmd')).toBe('"C:\\My Files\\a.txt"');
    expect(quotePath("C:\\it's here", 'powershell')).toBe("'C:\\it''s here'");
  });

  it('normalizes settings saved by older versions', () => {
    const s = normalizeTerminalSettings({ profiles: [], scrollback: 5, keybindings: { 'tab.new': 'Ctrl+N' } });
    expect(s.profiles.length).toBe(1);
    expect(s.scrollback).toBe(500);
    expect(s.keybindings['tab.new']).toBe('Ctrl+N');
    expect(s.keybindings['pane.splitRight']).toBe(defaultTerminalSettings().keybindings['pane.splitRight']);
  });
});

describe('shell detection', () => {
  it('reads /etc/shells', () => {
    expect(parseEtcShells('# comment\n/bin/sh\n/bin/bash\n\n/usr/bin/zsh # mine\n/bin/bash\n')).toEqual(['/bin/sh', '/bin/bash', '/usr/bin/zsh']);
  });

  it('lists each known shell once, the login shell first', () => {
    const exists = (p: string) => ['/bin/bash', '/usr/bin/bash', '/usr/bin/zsh', '/usr/bin/fish', '/home/a/.cargo/bin/nu'].includes(p);
    const list = unixShells({ etcShells: '/bin/bash\n/usr/bin/zsh\n/bin/nonexistent', path: ['/usr/bin', '/home/a/.cargo/bin'], exists, loginShell: '/usr/bin/zsh' });
    expect(list.map((s) => s.id)).toEqual(['zsh', 'bash', 'fish', 'nu']);
    expect(list.find((s) => s.id === 'bash')?.file).toBe('/bin/bash');
    expect(list.find((s) => s.id === 'nu')?.args).toEqual([]);
  });

  it('reads the UTF-16 list of WSL distributions', () => {
    const buf = Buffer.from('\uFEFFUbuntu-24.04\r\ndocker-desktop\r\n\r\n', 'utf16le');
    expect(parseWslList(buf)).toEqual(['Ubuntu-24.04', 'docker-desktop']);
    expect(parseWslList(Buffer.from('Debian\n', 'utf8'))).toEqual(['Debian']);
    expect(parseWslList(Buffer.from('Windows Subsystem for Linux has no installed distributions.\r\n', 'utf16le'))).toEqual([]);
  });

  it('finds Windows shells', () => {
    const exists = (p: string) => p.endsWith('powershell.exe') || p === 'C:\\Program Files\\Git\\bin\\bash.exe';
    const list = windowsShells({ systemRoot: 'C:\\Windows', programFiles: ['C:\\Program Files'], exists, pwsh: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', wsl: Buffer.from('Ubuntu\r\n', 'utf16le') });
    expect(list.map((s) => s.id)).toEqual(['pwsh', 'powershell', 'cmd', 'wsl:Ubuntu', 'git-bash']);
    expect(list.find((s) => s.id === 'wsl:Ubuntu')?.args).toEqual(['-d', 'Ubuntu']);
    expect(parseWhere('C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\nC:\\other\\pwsh.exe\r\n')).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
    expect(shellKindOf('C:\\Windows\\System32\\cmd.exe')).toBe('cmd');
    expect(shellKindOf('/usr/bin/pwsh')).toBe('powershell');
    expect(shellKindOf('/bin/bash')).toBe('posix');
  });
});

describe('ring buffer', () => {
  it('keeps only the newest lines', () => {
    const r = new RingBuffer(3);
    for (let i = 1; i <= 6; i++) r.push(`line ${i}\n`);
    expect(r.snapshot()).toBe('line 4\nline 5\nline 6\n');
    expect(r.size.lines).toBe(3);
  });
  it('trims inside a big chunk and caps bytes for output without newlines', () => {
    const r = new RingBuffer(2);
    r.push('a\nb\nc\nd\n');
    r.push('e\n');
    expect(r.snapshot()).toBe('d\ne\n');
    const b = new RingBuffer(1000, 100);
    b.push('x'.repeat(150));
    expect(b.snapshot().length).toBe(100);
  });
  it('strips escape codes', () => {
    expect(stripAnsi('\x1b[1;31mred\x1b[0m \x1b]0;title\x07ok')).toBe('red ok');
  });
});

describe('shell integration', () => {
  it('reads prompts, commands, exit codes and folders', () => {
    const si = new ShellIntegration();
    const ev = si.feed('\x1b]133;A\x07$ ls\x1b]133;C\x07out\x1b]133;D;2\x07\x1b]7;file://box/home/a/My%20Docs\x1b\\');
    expect(ev).toEqual([
      { kind: 'prompt' },
      { kind: 'command-start' },
      { kind: 'command-end', exit: 2 },
      { kind: 'cwd', path: '/home/a/My Docs', host: 'box' },
    ]);
  });
  it('joins a sequence split across chunks', () => {
    const si = new ShellIntegration();
    expect(si.feed('text \x1b]13')).toEqual([]);
    expect(si.feed('3;D;0\x07more')).toEqual([{ kind: 'command-end', exit: 0 }]);
  });
  it('reads notifications and Windows folders', () => {
    expect(parseOsc('9;Build finished')).toEqual({ kind: 'notify', body: 'Build finished' });
    expect(parseOsc('9;4;1;50')).toBeNull();
    expect(parseOsc('777;notify;Tests;All 12 passed')).toEqual({ kind: 'notify', title: 'Tests', body: 'All 12 passed' });
    expect(parseOsc('7;file://PC/C:/Users/a')).toEqual({ kind: 'cwd', path: 'C:\\Users\\a', host: 'PC' });
    expect(parseOsc('633;E;git commit -m \\x3b')).toEqual({ kind: 'command-start', command: 'git commit -m ;' });
  });
});

describe('layout', () => {
  const a = leaf('s1', { id: 'a' });
  it('splits, nests and closes panes', () => {
    let t: PaneNode = split(a, 'a', 'row', leaf('s2', { id: 'b' }));
    t = split(t, 'b', 'col', leaf('s3', { id: 'c' }));
    t = split(t, 'a', 'row', leaf('s4', { id: 'd' }));
    expect(leaves(t).map((l) => l.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(t.type === 'split' && t.sizes).toEqual([0.25, 0.25, 0.5]);
    t = close(t, 'b')!;
    expect(leaves(t).map((l) => l.id)).toEqual(['a', 'd', 'c']);
    const sum = t.type === 'split' ? t.sizes.reduce((x, y) => x + y, 0) : 1;
    expect(sum).toBeCloseTo(1);
    expect(close(a, 'a')).toBeNull();
  });
  it('resizes within limits and swaps panes', () => {
    let t: PaneNode = split(a, 'a', 'row', leaf('s2', { id: 'b' }));
    const sid = t.id;
    t = resize(t, sid, 0, 0.2);
    expect(t.type === 'split' && t.sizes[0]).toBeCloseTo(0.7);
    expect(resize(t, sid, 0, 0.3)).toEqual(t);
    t = swap(t, 'a', 'b');
    expect(leaves(t).map((l) => [l.id, l.session])).toEqual([['a', 's2'], ['b', 's1']]);
    expect(equalize(t).type === 'split' && (equalize(t) as { sizes: number[] }).sizes).toEqual([0.5, 0.5]);
  });
  it('finds the pane in a direction', () => {
    let t: PaneNode = split(a, 'a', 'row', leaf('s2', { id: 'b' }));
    t = split(t, 'b', 'col', leaf('s3', { id: 'c' }));
    expect(neighbour(t, 'a', 'right')).toBe('b');
    expect(neighbour(t, 'c', 'up')).toBe('b');
    expect(neighbour(t, 'c', 'left')).toBe('a');
    expect(neighbour(t, 'a', 'left')).toBeUndefined();
    expect(rects(t).get('c')).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });
});

describe('keys', () => {
  const ev = (key: string, mods: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}, code?: string) => ({ key, code, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift });
  it('parses and matches CmdOrCtrl per platform', () => {
    const c = parseCombo('CmdOrCtrl+Shift+D', true)!;
    expect(c).toEqual({ key: 'd', ctrl: false, meta: true, alt: false, shift: true });
    expect(matches(c, ev('D', { meta: true, shift: true }, 'KeyD'))).toBe(true);
    expect(matches(parseCombo('CmdOrCtrl+Shift+D', false)!, ev('D', { ctrl: true, shift: true }, 'KeyD'))).toBe(true);
    expect(matches(c, ev('d', { meta: true }, 'KeyD'))).toBe(false);
  });
  it('uses the physical key with Option held, and handles + and backtick', () => {
    expect(matches(parseCombo('CmdOrCtrl+Alt+T', true)!, ev('†', { meta: true, alt: true }, 'KeyT'))).toBe(true);
    expect(matches(parseCombo('CmdOrCtrl+=', false)!, ev('+', { ctrl: true, shift: true }, 'Equal'))).toBe(true);
    expect(parseCombo('Ctrl++', false)?.key).toBe('+');
    expect(matches(parseCombo('Ctrl+`', false)!, ev('`', { ctrl: true }, 'Backquote'))).toBe(true);
  });
  it('never takes the shell’s own Ctrl+letter keys off the Mac, and has no clashes', () => {
    const other = defaultKeybindings('linux');
    expect(Object.keys(other).sort()).toEqual(Object.keys(DEFAULT_KEYBINDINGS).sort());
    for (const [action, combo] of Object.entries(other)) {
      const c = parseCombo(combo, false)!;
      const bareCtrlLetter = c.ctrl && !c.shift && !c.alt && /^[a-z]$/.test(c.key);
      expect(bareCtrlLetter, `${action} = ${combo}`).toBe(false);
    }
    expect(conflicts(other, false)).toEqual([]);
    expect(conflicts(defaultKeybindings('darwin'), true)).toEqual([]);
    expect(defaultTerminalSettings('win32').keybindings['tab.new']).toBe('Ctrl+Shift+T');
  });

  it('finds actions, formats, records and spots clashes', () => {
    expect(actionFor({ 'tab.new': 'CmdOrCtrl+T' }, ev('t', { ctrl: true }, 'KeyT'), false)).toBe('tab.new');
    expect(formatCombo('CmdOrCtrl+Shift+D', true)).toBe('⇧⌘D');
    expect(formatCombo('CmdOrCtrl+Shift+D', false)).toBe('Ctrl+Shift+D');
    expect(comboFromEvent(ev('k', { ctrl: true, shift: true }, 'KeyK'), false)).toBe('CmdOrCtrl+Shift+K');
    expect(comboFromEvent(ev('Shift', { shift: true }), false)).toBeNull();
    expect(conflicts({ a: 'Ctrl+K', b: 'Control+k', c: 'Ctrl+L' }, false)).toEqual([['a', 'b']]);
    expect(parseCombo('Ctrl+A+B', false)).toBeNull();
  });
});

describe('ssh config', () => {
  const files: Record<string, string> = {
    '/home/a/.ssh/config': `
Host *
  User everyone
  ServerAliveInterval 30
Include conf.d/*
Host web prod-*
  HostName 10.0.0.5
  Port 2222
Host db
  HostName db.internal
  User admin
  IdentityFile ~/.ssh/db_key
  ProxyJump web
Host !skip *.lan
  User lanuser
`,
    '/home/a/.ssh/conf.d/pi': 'Host pi\n  HostName raspberrypi.local\n  User pi\n',
  };
  const d = { home: '/home/a', read: (f: string) => files[f], glob: (p: string) => Object.keys(files).filter((f) => f.startsWith(p.replace('*', ''))) };
  it('lists concrete hosts with the options that apply', () => {
    const hosts = parseSshConfig(d);
    expect(hosts.map((h) => h.alias)).toEqual(['pi', 'web', 'db']);
    // First value wins: "Host *" set User before the more specific blocks.
    expect(hosts.find((h) => h.alias === 'db')).toMatchObject({ host: 'db.internal', user: 'everyone', identityFile: '/home/a/.ssh/db_key', proxyJump: 'web' });
    expect(hosts.find((h) => h.alias === 'web')).toMatchObject({ host: '10.0.0.5', port: 2222 });
    expect(hosts.find((h) => h.alias === 'pi')?.host).toBe('raspberrypi.local');
  });
  it('matches patterns with negation', () => {
    expect(hostMatches(['!skip', '*.lan'], 'nas.lan')).toBe(true);
    expect(hostMatches(['!skip', '*'], 'skip')).toBe(false);
    expect(hostMatches(['prod-*'], 'prod-eu')).toBe(true);
  });
  it('resolves targets', () => {
    expect(resolveHost('me@example.com:2200', [])).toEqual({ user: 'me', host: 'example.com', port: 2200 });
    expect(resolveHost('[::1]:22', [])).toEqual({ user: undefined, host: '::1', port: 22 });
    expect(resolveHost('pi', parseSshConfig(d))).toMatchObject({ host: 'raspberrypi.local', alias: 'pi' });
  });
});

describe('protocol', () => {
  it('decodes lines split anywhere and skips bad ones', () => {
    const got: unknown[] = [];
    const dec = new LineDecoder((m) => got.push(m));
    const a = encode({ t: 'ping', rid: 1 });
    const b = encode({ t: 'input', id: 's', data: 'ls\r\n"quoted"' });
    const all = a + 'not json\n' + b;
    for (let i = 0; i < all.length; i += 3) dec.push(all.slice(i, i + 3));
    expect(got).toEqual([{ t: 'ping', rid: 1 }, { t: 'input', id: 's', data: 'ls\r\n"quoted"' }]);
  });
  it('places the socket safely on each system', () => {
    expect(socketPath('C:\\x', 'win32', 'Ann Lee')).toBe('\\\\.\\pipe\\keeper-terminal-AnnLee');
    expect(socketPath('/home/a/.config/Keeper', 'linux')).toBe('/home/a/.config/Keeper/terminal/host.sock');
    expect(socketPath('/' + 'x'.repeat(120), 'darwin', 'ann')).toBe('/tmp/keeper-terminal-ann.sock');
  });
});

describe('triggers and schemes', () => {
  it('fires on complete and unfinished lines, once per quiet period', () => {
    const w = new TriggerWatcher([{ id: 'q', pattern: 'continue\\? \\(y/n\\)', action: 'island', enabled: true }], 1000);
    expect(w.feed('building...\n', 0)).toEqual([]);
    expect(w.feed('\x1b[33mContinue? (y/n) \x1b[0m', 10).map((h) => h.trigger.id)).toEqual(['q']);
    expect(w.feed('\n', 20)).toEqual([]);
    expect(w.feed('Continue? (y/n)\n', 2000).length).toBe(1);
    expect(new TriggerWatcher([{ id: 'x', pattern: '(', action: 'notify', enabled: true }]).active).toBe(false);
    expect(patternError('(')).toBeTruthy();
    expect(patternError('ok')).toBeUndefined();
  });
  it('has complete schemes with readable text', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(SCHEMES.length).toBeGreaterThanOrEqual(12);
    for (const s of SCHEMES) {
      expect(s.ansi.length).toBe(16);
      const [l1, l2] = [lum(s.foreground), lum(s.background)].sort((x, y) => y - x);
      expect((l1 + 0.05) / (l2 + 0.05)).toBeGreaterThanOrEqual(7);
      expect(Object.keys(xtermTheme(s))).toContain('brightMagenta');
    }
  });
});

describe('terminal words', () => {
  it('exist in every language Keeper offers', () => {
    for (const l of LANGUAGES.filter((x) => x.code !== 'system')) {
      expect(TERM_LANGS).toContain(l.code);
      const d = termDictionary(l.code);
      for (const k of TERM_KEYS) expect(d[k], `${l.code}:${k}`).toBeTruthy();
    }
  });
});
