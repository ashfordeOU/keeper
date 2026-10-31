// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  appKey, buildTree, canEnd, coreUsage, cpuPercent, descendants, energyImpact, flattenTree, groupByApp, matchProc, parseBootTime, parseCmdline,
  parseDiskstats, parseIostat, parseLaunchctlList, parseMeminfo, parseNetDev, parseNetSockets, parseNetstatIb, parsePasswd, parsePidRest, parseProcIo,
  parseProcStat, parsePsLine, parsePsTime, parseStatusMemory, parseStatusUid, parseSwapusage, parseSystemctlUnits, parseUnitFiles, parseWinDate,
  parseWinProcesses, parseWinServices, priorityOf, protectedReason, psQuote, rate, safeServiceName, type ProcRow,
} from '../core/procs';

const row = (pid: number, ppid: number, name: string, extra: Partial<ProcRow> = {}): ProcRow => ({ pid, ppid, name, mine: true, cpu: 0, memory: 0, ...extra });

describe('Linux /proc', () => {
  it('reads stat lines, even with spaces and brackets in the name', () => {
    const s = parseProcStat('4242 (Web Content (x)) S 1200 4242 1200 0 -1 4194560 1234 0 0 0 150 50 0 0 20 5 31 0 98765 123456789 2048 18446744073709551615');
    expect(s).toMatchObject({ pid: 4242, name: 'Web Content (x)', state: 'S', ppid: 1200, ticks: 200, nice: 5, threads: 31, starttime: 98765, rssPages: 2048 });
    expect(parseProcStat('garbage')).toBeNull();
  });
  it('reads io, uid, memory, cmdline, passwd, boot time and meminfo', () => {
    expect(parseProcIo('rchar: 10\nwchar: 20\nsyscr: 1\nsyscw: 1\nread_bytes: 4096\nwrite_bytes: 8192\ncancelled_write_bytes: 0\n')).toEqual({ read: 4096, write: 8192 });
    expect(parseStatusUid('Name:\tbash\nUid:\t1000\t1000\t1000\t1000\n')).toBe(1000);
    expect(parseStatusMemory('VmRSS:\t  2048 kB\nRssAnon:\t 1024 kB\nVmSwap:\t0 kB\n')).toEqual({ VmRSS: 2048 * 1024, RssAnon: 1024 * 1024, VmSwap: 0 });
    expect(parseCmdline('/usr/bin/sleep\u00001000\u0000')).toEqual(['/usr/bin/sleep', '1000']);
    expect(parsePasswd('root:x:0:0:root:/root:/bin/bash\nana:x:1000:1000::/home/ana:/bin/zsh\n').get(1000)).toBe('ana');
    expect(parseBootTime('cpu  1 2 3\nbtime 1700000000\n')).toBe(1700000000);
    expect(parseMeminfo('MemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 200 kB\nSwapFree: 50 kB\n')).toEqual({ total: 1024000, available: 409600, swapTotal: 204800, swapFree: 51200 });
  });
  it('adds up whole disks only, and network without loopback', () => {
    const disks = [
      '   8       0 sda 100 0 10 0 50 0 20 0 0 0 0',
      '   8       1 sda1 100 0 999 0 50 0 999 0 0 0 0',
      '   7       0 loop0 5 0 999 0 0 0 0 0 0 0 0',
      ' 259       0 nvme0n1 1 0 4 0 1 0 2 0 0 0 0',
      ' 259       1 nvme0n1p1 1 0 999 0 1 0 999 0 0 0 0',
    ].join('\n');
    expect(parseDiskstats(disks)).toEqual({ read: 14 * 512, write: 22 * 512 });
    const net = 'Inter-|   Receive\n face |bytes packets\n    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0\n  eth0: 1000 10 0 0 0 0 0 0 500 5 0 0 0 0 0 0\n';
    expect(parseNetDev(net)).toEqual({ rx: 1000, tx: 500 });
    expect([...parseNetSockets('  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 31337 1 0\n')]).toEqual(['31337']);
  });
});

describe('macOS ps', () => {
  it('reads time and elapsed fields', () => {
    expect(parsePsTime('0:01.50')).toBe(1500);
    expect(parsePsTime('02:03.00')).toBe(123_000);
    expect(parsePsTime('1-01:00:00')).toBe(25 * 3600_000);
    expect(parsePsTime('nonsense')).toBe(0);
  });
  it('reads fixed fields and pid-plus-rest lines', () => {
    expect(parsePsLine('  412     1   501   3.5  20480 S     0   0:12.34   1-02:00:00')).toMatchObject({ pid: 412, ppid: 1, uid: 501, cpu: 3.5, rss: 20480 * 1024, state: 'S', nice: 0, cpuMs: 12_340 });
    expect(parsePsLine('PID PPID')).toBeNull();
    const m = parsePidRest('  412 /Applications/Google Thing.app/Contents/MacOS/Google Thing\n   1 /sbin/launchd\n');
    expect(m.get(412)).toBe('/Applications/Google Thing.app/Contents/MacOS/Google Thing');
  });
  it('reads netstat, iostat and swap', () => {
    const ns = [
      'Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
      'lo0        16384 <Link#1>                         10     0     9999       10     0     9999     0',
      'en0        1500  <Link#6>    a4:83:e7:00:00:01  100     0     5000       90     0     3000     0',
      'en0        1500  192.168.1     192.168.1.20       100     -     5000       90     -     3000     -',
      'utun0      1380  <Link#12>                        5     0     100        5      0     200      0',
    ].join('\n');
    expect(parseNetstatIb(ns)).toEqual({ rx: 5100, tx: 3200 });
    expect(parseIostat('              disk0               disk4\n    KB/t  xfrs   MB     KB/t  xfrs   MB\n   20.00  1000  100.00   10.00  10  2.00\n')).toBe(102 * 1024 * 1024);
    expect(parseSwapusage('vm.swapusage: total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)')).toEqual({ total: 2048 * 1024 ** 2, used: 512 * 1024 ** 2 });
  });
});

describe('Windows', () => {
  it('reads processes from JSON, one or many', () => {
    const one = JSON.stringify({ ProcessId: 10, ParentProcessId: 4, Name: 'notepad.exe', WorkingSetSize: '1048576', ThreadCount: 3, KernelModeTime: '10000000', UserModeTime: '20000000', ReadTransferCount: 5, WriteTransferCount: 6, CreationDate: '/Date(1700000000000)/', ExecutablePath: 'C:\\Windows\\notepad.exe', SessionId: 1 });
    expect(parseWinProcesses(one)).toEqual([{ pid: 10, ppid: 4, name: 'notepad', memory: 1048576, threads: 3, cpuMs: 3000, read: 5, write: 6, started: 1700000000000, path: 'C:\\Windows\\notepad.exe', command: undefined, session: 1 }]);
    expect(parseWinProcesses('not json')).toEqual([]);
    expect(parseWinDate('2024-01-01T00:00:00Z')).toBe(Date.UTC(2024, 0, 1));
  });
  it('quotes PowerShell strings so names cannot break out', () => {
    expect(psQuote("it's")).toBe("'it''s'");
    expect(psQuote('a\u2019b')).toBe("'a''b'");
    // Nothing else is special inside single quotes: $(...) and backticks stay literal.
    expect(psQuote('$(Remove-Item C:\\)`;')).toBe("'$(Remove-Item C:\\)`;'");
    expect(safeServiceName('wuauserv')).toBe(true);
    expect(safeServiceName("x'; Stop-Computer")).toBe(false);
    expect(safeServiceName('..\\..\\x')).toBe(false);
  });
  it('reads services', () => {
    const s = parseWinServices(JSON.stringify([{ Name: 'Spooler', DisplayName: 'Print Spooler', State: 'Running', StartMode: 'Auto', Description: 'Prints', ProcessId: 900 }, { Name: 'Fax', State: 'Stopped', StartMode: 'Manual' }]));
    expect(s).toEqual([
      { id: 'Spooler', name: 'Print Spooler', description: 'Prints', scope: 'system', state: 'running', enabled: true, pid: 900 },
      { id: 'Fax', name: 'Fax', description: undefined, scope: 'system', state: 'stopped', enabled: false, pid: undefined },
    ]);
  });
});

describe('services', () => {
  it('reads systemd units and unit files', () => {
    const t = 'cron.service      loaded active   running Regular background program processing daemon\n● bad.service loaded failed failed Broken thing\nold.service not-found inactive dead old.service\nidle.service loaded inactive dead Idle\n';
    expect(parseSystemctlUnits(t, 'system').map((s) => [s.id, s.state])).toEqual([['cron.service', 'running'], ['bad.service', 'failed'], ['idle.service', 'stopped']]);
    expect(parseUnitFiles('cron.service enabled enabled\nidle.service disabled enabled\n').get('cron.service')).toBe(true);
  });
  it('reads launchctl list', () => {
    const t = 'PID\tStatus\tLabel\n123\t0\tcom.apple.Finder\n-\t0\tcom.example.agent\n-\t78\tcom.example.broken\n';
    expect(parseLaunchctlList(t, 'user').map((s) => [s.id, s.state, s.pid])).toEqual([['com.apple.Finder', 'running', 123], ['com.example.agent', 'stopped', undefined], ['com.example.broken', 'failed', undefined]]);
  });
});

describe('rates', () => {
  it('turns counters into rates', () => {
    expect(cpuPercent(1000, 1500, 1000)).toBe(50);
    expect(cpuPercent(undefined, 1500, 1000)).toBe(0);
    expect(cpuPercent(1500, 1000, 1000)).toBe(0); // pid reused: counter went backwards
    expect(cpuPercent(0, 4000, 1000)).toBe(400); // four busy cores
    expect(rate(100, 2100, 2000)).toBe(1000);
    expect(rate(undefined, 5, 1000)).toBeUndefined();
    expect(energyImpact(10)).toBe(10);
    expect(energyImpact(0, 100 * 1024 * 1024)).toBe(40);
  });
  it('computes core usage', () => {
    const a = [{ times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }, { times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }];
    const b = [{ times: { user: 50, nice: 0, sys: 0, idle: 50, irq: 0 } }, { times: { user: 0, nice: 0, sys: 0, idle: 100, irq: 0 } }];
    expect(coreUsage(a, b)).toEqual({ total: 25, perCore: [50, 0] });
  });
});

describe('safety', () => {
  it('protects the system and Keeper itself', () => {
    expect(protectedReason(row(1, 0, 'systemd'), 'linux', 99)).toMatch(/core of the operating system/);
    expect(protectedReason(row(55, 2, 'kworker/0:1'), 'linux', 99)).toMatch(/kernel/);
    expect(protectedReason(row(300, 1, 'WindowServer'), 'darwin', 99)).toMatch(/keeps the system running/);
    expect(protectedReason(row(600, 4, 'lsass.exe'), 'win32', 99)).toMatch(/keeps the system running/);
    expect(protectedReason(row(99, 1, 'keeper'), 'linux', 99)).toMatch(/Keeper itself/);
    expect(protectedReason(row(1234, 1, 'sleep'), 'linux', 99)).toBeNull();
  });
  it('lets desktop pieces be restarted but not force-ended', () => {
    expect(canEnd(row(400, 1, 'Finder'), 'darwin', 99)).toMatchObject({ ok: true });
    expect(canEnd(row(400, 1, 'Finder'), 'darwin', 99, true).ok).toBe(false);
    expect(canEnd(row(400, 1, 'launchd'), 'darwin', 99).ok).toBe(false);
  });
});

describe('trees and apps', () => {
  const procs = [row(1, 0, 'init'), row(10, 1, 'shell'), row(11, 10, 'sleep', { cpu: 5 }), row(12, 10, 'cat'), row(20, 1, 'other'), row(30, 99, 'orphan')];
  it('builds a tree and flattens it with collapsed branches', () => {
    const t = buildTree(procs);
    expect(t.map((n) => n.p.pid)).toEqual([1, 30]);
    expect(flattenTree(t, new Set()).map((n) => [n.p.pid, n.depth])).toEqual([[1, 0], [10, 1], [11, 2], [12, 2], [20, 1], [30, 0]]);
    expect(flattenTree(t, new Set([10])).map((n) => n.p.pid)).toEqual([1, 10, 20, 30]);
  });
  it('survives cycles', () => {
    const t = buildTree([row(5, 6, 'a'), row(6, 5, 'b')]);
    expect(flattenTree(t, new Set()).length).toBeLessThanOrEqual(2);
  });
  it('lists descendants deepest first', () => {
    expect(descendants(1, procs)).toEqual([11, 12, 10, 20]);
    expect(descendants(11, procs)).toEqual([]);
  });
  it('groups helpers under their app', () => {
    const mac = [
      row(100, 1, 'Browser', { path: '/Applications/Browser.app/Contents/MacOS/Browser', cpu: 10, memory: 100 }),
      row(101, 100, 'Browser Helper (Renderer)', { path: '/Applications/Browser.app/Contents/Frameworks/Browser Helper (Renderer).app/Contents/MacOS/Browser Helper (Renderer)', cpu: 5, memory: 50 }),
      row(102, 1, 'zsh', { path: '/bin/zsh' }),
    ];
    const g = groupByApp(mac, 'darwin');
    const browser = g.find((x) => x.name === 'Browser')!;
    expect(browser.members.length).toBe(2);
    expect(browser.cpu).toBe(15);
    expect(browser.memory).toBe(150);
    expect(browser.lead.pid).toBe(100);
    expect(appKey({ name: 'Code Helper (GPU)' }, 'linux')).toBe('code');
    expect(appKey({ name: 'x', path: 'C:\\Program Files\\Editor\\editor.exe' }, 'win32')).toBe('c:\\program files\\editor');
  });
  it('filters and maps priorities', () => {
    expect(matchProc(row(42, 1, 'Sleep'), 'sle')).toBe(true);
    expect(matchProc(row(42, 1, 'x'), '42')).toBe(true);
    expect(matchProc(row(42, 1, 'x', { command: '/usr/bin/x --flag' }), 'flag')).toBe(true);
    expect(matchProc(row(42, 1, 'x'), 'nope')).toBe(false);
    expect(priorityOf(19)).toBe('lowest');
    expect(priorityOf(0)).toBe('normal');
    expect(priorityOf(-20)).toBe('highest');
  });
});
