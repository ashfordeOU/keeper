// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A believable Mac for the browser demo's process manager: apps with helpers,
// system daemons, a dev server, and numbers that drift a little each second.

import type { ProcsApi } from '../core/api-procs';
import { energyImpact, macAppBundle, type ProcRow, type ServiceRow } from '../core/procs';

const MB = 1024 * 1024;
const SELF = 900;

interface Seed { pid: number; ppid: number; name: string; path: string; user?: string; cpu: number; mem: number; threads?: number; io?: number; app?: boolean }

const seeds: Seed[] = [
  { pid: 1, ppid: 0, name: 'launchd', path: '/sbin/launchd', user: 'root', cpu: 0.4, mem: 22 * MB },
  { pid: 0, ppid: 0, name: 'kernel_task', path: '', user: 'root', cpu: 4.2, mem: 2100 * MB },
  { pid: 140, ppid: 1, name: 'WindowServer', path: '/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer', user: '_windowserver', cpu: 9.5, mem: 610 * MB },
  { pid: 180, ppid: 1, name: 'mds_stores', path: '/System/Library/Frameworks/CoreServices.framework/mds_stores', user: 'root', cpu: 2.1, mem: 140 * MB, io: 3 * MB },
  { pid: 401, ppid: 1, name: 'Finder', path: '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder', cpu: 0.6, mem: 180 * MB, app: true },
  { pid: 402, ppid: 1, name: 'Dock', path: '/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock', cpu: 0.3, mem: 90 * MB, app: true },
  { pid: 510, ppid: 1, name: 'Browser', path: '/Applications/Browser.app/Contents/MacOS/Browser', cpu: 6.8, mem: 520 * MB, app: true, io: 0.4 * MB },
  { pid: 511, ppid: 510, name: 'Browser Helper (GPU)', path: '/Applications/Browser.app/Contents/Frameworks/Browser Helper (GPU).app/Contents/MacOS/Browser Helper (GPU)', cpu: 7.9, mem: 310 * MB },
  { pid: 512, ppid: 510, name: 'Browser Helper (Renderer)', path: '/Applications/Browser.app/Contents/Frameworks/Browser Helper (Renderer).app/Contents/MacOS/Browser Helper (Renderer)', cpu: 14.3, mem: 690 * MB },
  { pid: 513, ppid: 510, name: 'Browser Helper (Renderer)', path: '/Applications/Browser.app/Contents/Frameworks/Browser Helper (Renderer).app/Contents/MacOS/Browser Helper (Renderer)', cpu: 1.2, mem: 240 * MB },
  { pid: 514, ppid: 510, name: 'Browser Helper', path: '/Applications/Browser.app/Contents/Frameworks/Browser Helper.app/Contents/MacOS/Browser Helper', cpu: 0.4, mem: 60 * MB },
  { pid: 620, ppid: 1, name: 'Mail', path: '/System/Applications/Mail.app/Contents/MacOS/Mail', cpu: 0.9, mem: 210 * MB, app: true, io: 0.1 * MB },
  { pid: 640, ppid: 1, name: 'Music', path: '/System/Applications/Music.app/Contents/MacOS/Music', cpu: 1.7, mem: 160 * MB, app: true },
  { pid: 700, ppid: 1, name: 'Editor', path: '/Applications/Editor.app/Contents/MacOS/Editor', cpu: 3.3, mem: 440 * MB, app: true },
  { pid: 701, ppid: 700, name: 'Editor Helper (Renderer)', path: '/Applications/Editor.app/Contents/Frameworks/Editor Helper (Renderer).app/Contents/MacOS/Editor Helper (Renderer)', cpu: 4.4, mem: 380 * MB },
  { pid: 702, ppid: 700, name: 'Editor Helper (Plugin)', path: '/Applications/Editor.app/Contents/Frameworks/Editor Helper (Plugin).app/Contents/MacOS/Editor Helper (Plugin)', cpu: 1.1, mem: 300 * MB },
  { pid: 760, ppid: 1, name: 'Terminal', path: '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal', cpu: 0.5, mem: 95 * MB, app: true },
  { pid: 761, ppid: 760, name: 'zsh', path: '/bin/zsh', cpu: 0, mem: 6 * MB },
  { pid: 770, ppid: 761, name: 'node', path: '/opt/homebrew/bin/node', cpu: 11.6, mem: 230 * MB, io: 1.2 * MB },
  { pid: 771, ppid: 770, name: 'esbuild', path: '/Users/demo/Projects/site/node_modules/@esbuild/darwin-arm64/bin/esbuild', cpu: 2.2, mem: 40 * MB },
  { pid: 780, ppid: 1, name: 'postgres', path: '/opt/homebrew/opt/postgresql@16/bin/postgres', cpu: 0.3, mem: 55 * MB, io: 0.2 * MB },
  { pid: 820, ppid: 1, name: 'Photos Agent', path: '/System/Library/PrivateFrameworks/PhotoLibraryServices.framework/photoanalysisd', cpu: 18.4, mem: 410 * MB, io: 9 * MB },
  { pid: 830, ppid: 1, name: 'backupd', path: '/System/Library/CoreServices/backupd.bundle/Contents/Resources/backupd', user: 'root', cpu: 0, mem: 30 * MB },
  { pid: SELF, ppid: 1, name: 'Keeper', path: '/Applications/Keeper.app/Contents/MacOS/Keeper', cpu: 0.8, mem: 150 * MB, app: true },
];

const services: ServiceRow[] = [
  { id: 'com.example.updater.agent', name: 'updater.agent', description: 'Checks for app updates', scope: 'user', state: 'running', pid: 850, enabled: true },
  { id: 'homebrew.mxcl.postgresql@16', name: 'PostgreSQL 16', description: 'Database server', scope: 'user', state: 'running', pid: 780, enabled: true },
  { id: 'com.example.sync', name: 'sync', description: 'Cloud folder sync', scope: 'user', state: 'stopped', enabled: false },
  { id: 'com.example.vpn.helper', name: 'vpn.helper', description: 'VPN network helper', scope: 'system', state: 'running', enabled: true },
  { id: 'com.example.license', name: 'license', description: 'Licence check that keeps failing', scope: 'system', state: 'failed', enabled: true },
];

export function mockProcs(): { procs: ProcsApi } {
  const start = Date.now() - 3 * 3600_000;
  let gone = new Set<number>();
  const stopped = new Set<number>();
  const nice = new Map<number, number>();
  let t = 0;
  const wobble = (base: number, pid: number) => Math.max(0, Math.round(base * (0.7 + 0.6 * Math.abs(Math.sin(t / 3 + pid))) * 10) / 10);
  const rows = (): ProcRow[] =>
    seeds.filter((s) => !gone.has(s.pid)).map((s, i) => {
      const cpu = stopped.has(s.pid) ? 0 : wobble(s.cpu, s.pid);
      const io = s.io ? wobble(s.io, s.pid + 3) : 0;
      return {
        pid: s.pid, ppid: s.ppid, name: s.name, path: s.path || undefined, command: s.path ? `${s.path}${s.pid === 770 ? ' node_modules/.bin/vite --port 5173' : ''}` : undefined,
        user: s.user ?? 'demo', mine: !s.user, cpu, memory: Math.round(s.mem * (0.97 + 0.06 * Math.abs(Math.sin(t / 7 + i)))), threads: s.threads ?? 4 + (s.pid % 37),
        state: stopped.has(s.pid) ? 'T' : cpu > 5 ? 'R' : 'S', nice: nice.get(s.pid) ?? 0, started: start + s.pid * 9_000,
        readRate: s.io ? Math.round(io * 0.7) : undefined, writeRate: s.io ? Math.round(io * 0.3) : undefined, energy: energyImpact(cpu, io), app: s.app,
      };
    });
  const ok = (done: number) => ({ ok: true, done, failed: [] });
  return {
    procs: {
      sample: async (o) => {
        t++;
        const procs = rows().map((p) => ({ ...p, connections: o?.network ? (p.name.startsWith('Browser') ? 12 + (p.pid % 9) : p.name === 'Mail' ? 6 : p.name === 'postgres' || p.name === 'node' ? 3 : 0) : undefined }));
        const cpu = Math.min(100, procs.reduce((s, p) => s + p.cpu, 0) / 10);
        return {
          t: Date.now(), procs, self: SELF, unavailable: [],
          system: {
            cpu, perCore: Array.from({ length: 10 }, (_, i) => Math.round(Math.max(1, Math.min(100, cpu * (0.5 + Math.abs(Math.sin(t / 2 + i))))) )),
            memTotal: 32 * 1024 * MB, memUsed: 21.4 * 1024 * MB + Math.sin(t / 5) * 300 * MB, memAvailable: 10.6 * 1024 * MB,
            swapTotal: 4096 * MB, swapUsed: 1200 * MB, diskRead: 4 * MB + Math.abs(Math.sin(t)) * 20 * MB, diskWrite: 2 * MB + Math.abs(Math.cos(t / 2)) * 8 * MB,
            netIn: 300_000 + Math.abs(Math.sin(t / 3)) * 2 * MB, netOut: 80_000 + Math.abs(Math.cos(t / 4)) * 400_000,
          },
        };
      },
      act: async (action, pids) => {
        const failed = [];
        for (const pid of pids) {
          const s = seeds.find((x) => x.pid === pid);
          if (!s) continue;
          if (pid === SELF) { failed.push({ pid, name: s.name, reason: 'This is Keeper itself. Use Restart Keeper instead.' }); continue; }
          if (s.user === 'root' || s.user === '_windowserver') { failed.push({ pid, name: s.name, reason: `${s.name} keeps the system running; stopping it would crash the computer or sign you out.` }); continue; }
          if (action === 'suspend') stopped.add(pid);
          else if (action === 'resume') stopped.delete(pid);
          else if (action === 'restart') { /* comes straight back */ }
          else if (action === 'endTree') gone = new Set([...gone, pid, ...seeds.filter((x) => x.ppid === pid).map((x) => x.pid)]);
          else gone = new Set([...gone, pid]);
        }
        return { ok: !failed.length, done: pids.length - failed.length, failed };
      },
      setPriority: async (pid, level) => { nice.set(pid, { lowest: 19, low: 10, normal: 0, high: -10, highest: -20 }[level]); return ok(1); },
      details: async (pid) => {
        const s = seeds.find((x) => x.pid === pid);
        if (!s) return null;
        return {
          pid, name: s.name, path: s.path, command: s.path, cwd: '/Users/demo', user: s.user ?? 'demo', started: start + pid * 9_000, envCount: 42,
          memory: [{ label: 'In memory now', bytes: s.mem }, { label: 'Private (its own data)', bytes: s.mem * 0.7 }, { label: 'Files and libraries', bytes: s.mem * 0.25 }, { label: 'Shared', bytes: s.mem * 0.05 }],
          openFiles: ['/Users/demo/Library/Application Support/' + s.name + '/state.db', '/Users/demo/Documents/Budget 2026.xlsx', '/private/var/folders/xy/T/cache.bin'],
          connections: s.name.startsWith('Browser') || s.name === 'Mail' ? [{ proto: 'IPv4', local: '192.168.1.20:52144', remote: '140.82.112.4:443', state: 'ESTABLISHED' }, { proto: 'IPv6', local: '[::1]:52200', remote: '[::1]:5173', state: 'ESTABLISHED' }] : s.name === 'node' ? [{ proto: 'IPv4', local: '127.0.0.1:5173', state: 'LISTEN' }] : [],
          children: seeds.filter((x) => x.ppid === pid).map((x) => ({ pid: x.pid, name: x.name })), notes: [],
        };
      },
      icons: async () => ({}),
      reveal: async () => undefined,
      apps: async () => seeds.filter((s) => s.app && !gone.has(s.pid) && s.pid !== SELF).map((s) => ({ pid: s.pid, name: macAppBundle(s.path)!.split('/').pop()!.replace(/\.app$/, ''), path: s.path, notResponding: s.pid === 640 })),
      restartKeeper: async () => undefined,
      services: async () => ({ supported: true, services: services.map((s) => ({ ...s })), note: 'Apple’s own system services are protected and not listed.' }),
      serviceAction: async (id, _scope, action) => {
        const s = services.find((x) => x.id === id);
        if (s) {
          if (action === 'start' || action === 'restart') s.state = 'running';
          if (action === 'stop') s.state = 'stopped';
          if (action === 'enable') s.enabled = true;
          if (action === 'disable') s.enabled = false;
        }
        return ok(1);
      },
    },
  };
}
