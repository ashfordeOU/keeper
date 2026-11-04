// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The system monitor in the browser demo: believable live readings that
// drift, a month of history with a daily rhythm, two projects with dev
// servers, a few agents and a local model server, and an Apple-silicon Mac's
// sensors. Nothing touches the real computer.

import type { RunningAgent, SysmonApi } from '../core/api-sysmon';
import { addMinute, emptyStore, peaks, query, topApps, type HistoryStore } from '../core/monitor-history';
import type { DevProject } from '../core/monitor-devservers';
import { defaultMonitorSettings, normalizeMonitorSettings, pushRing, type LiveReading, type MonitorSettings } from '../core/monitor-tray';
import type { Sensors } from '../core/monitor-sensors';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function wave(t: number, period: number) {
  return (Math.sin((t / period) * Math.PI * 2) + 1) / 2;
}

/** Thirty days of minutes would be 43,200 points; the demo fills hours for the month and minutes for the last two days. */
function seedHistory(now: number): HistoryStore {
  const s = emptyStore();
  const apps = ['Browser', 'Editor', 'Music', 'Terminal', 'node', 'Mail'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const add = (t: number) => {
    const day = wave(t - 9 * 3600_000, 24 * 3600_000);
    const busy = 8 + day * 35 + rnd() * 18 + (rnd() > 0.985 ? 40 : 0);
    addMinute(s, {
      t, cpu: Math.min(100, busy), mem: 52 + day * 22 + rnd() * 6, netIn: (0.2 + day * 3 + rnd() * 2) * MB, netOut: (0.05 + day * 0.6 + rnd() * 0.3) * MB,
      diskR: (0.5 + rnd() * 4) * MB, diskW: (0.3 + rnd() * 3) * MB, gpu: 6 + day * 20 + rnd() * 10, power: 4 + busy * 0.18, temp: 42 + busy * 0.35, battery: 40 + day * 55,
      apps: apps.map((name, i) => ({ name, cpu: Math.max(0, (busy / (i + 1.5)) * (0.6 + rnd() * 0.8)), memory: (900 - i * 120) * MB })),
    }, 365);
  };
  for (let t = now - 30 * 24 * 3600_000; t < now - 2 * 24 * 3600_000; t += 3600_000) add(t);
  for (let t = now - 2 * 24 * 3600_000; t < now; t += 60_000) add(t);
  return s;
}

export function mockSysmon(): { sysmon: SysmonApi } {
  let settings: MonitorSettings = normalizeMonitorSettings({ ...defaultMonitorSettings(), surfaces: { tray: true, island: true, launcher: true } });
  let store: HistoryStore | null = null;
  const hist = () => (store ??= seedHistory(Date.now()));
  let recent: LiveReading[] = [];
  let recentTools = ['toolbox:json', 'convert:video.compress', 'page:health:history'];
  let projects: DevProject[] = [
    { root: '/Users/sam/code/storefront', name: 'storefront', servers: [
      { port: 5173, pid: 4310, name: 'node', kind: 'Vite', url: 'http://localhost:5173', address: '127.0.0.1', exposed: false, idle: false, command: 'node node_modules/.bin/vite', cwd: '/Users/sam/code/storefront', started: Date.now() - 52 * 60_000 },
      { port: 5432, pid: 812, name: 'postgres', kind: 'PostgreSQL', address: '127.0.0.1', exposed: false, idle: true, command: 'postgres -D /usr/local/var/postgres', cwd: '/Users/sam/code/storefront', started: Date.now() - 3 * 86_400_000 },
    ] },
    { root: '/Users/sam/code/api-service', name: 'api-service', servers: [
      { port: 8000, pid: 4522, name: 'python3', kind: 'Uvicorn', url: 'http://localhost:8000', address: '0.0.0.0', exposed: true, idle: false, command: 'python3 -m uvicorn app.main:app --reload', cwd: '/Users/sam/code/api-service', started: Date.now() - 20 * 60_000 },
      { port: 6379, pid: 4530, name: 'redis-server', kind: 'Redis', address: '127.0.0.1', exposed: false, idle: true, command: 'redis-server *:6379', cwd: '/Users/sam/code/api-service', started: Date.now() - 20 * 60_000 },
    ] },
    { root: '/Users/sam/notes-site', name: 'notes-site', servers: [
      { port: 4321, pid: 4701, name: 'node', kind: 'Astro', url: 'http://localhost:4321', address: '127.0.0.1', exposed: false, idle: true, command: 'node node_modules/.bin/astro dev', cwd: '/Users/sam/notes-site', started: Date.now() - 4 * 3600_000 },
    ] },
  ];
  let agents: RunningAgent[] = [
    { key: 'gemini-cli:4810', id: 'gemini-cli', label: 'Gemini CLI', kind: 'cli', pid: 4810, pids: [4810, 4811, 4812, 4813], cpu: 12.4, memory: 412 * MB, cwd: '/Users/sam/code/storefront', project: 'storefront', command: 'node /opt/homebrew/lib/node_modules/@google/gemini-cli/dist/index.js', ports: [] },
    { key: 'aider:4900', id: 'aider', label: 'Aider', kind: 'cli', pid: 4900, pids: [4900, 4902], cpu: 3.1, memory: 238 * MB, cwd: '/Users/sam/code/api-service', project: 'api-service', command: 'python3 -m aider --model sonnet', ports: [] },
    { key: 'opencode:5004', id: 'opencode', label: 'OpenCode', kind: 'cli', pid: 5004, pids: [5004, 5005, 5006], cpu: 0.4, memory: 180 * MB, cwd: '/Users/sam/notes-site', project: 'notes-site', command: 'opencode', ports: [] },
    { key: 'ollama:620', id: 'ollama', label: 'Ollama', kind: 'server', pid: 620, pids: [620, 1288], cpu: 1.2, memory: 5.4 * GB, cwd: '/', command: '/Applications/Ollama.app/Contents/Resources/ollama serve', ports: [11434] },
    { key: 'cursor:700', id: 'cursor', label: 'Cursor', kind: 'ide', pid: 700, pids: [700, 701, 702, 703, 704], cpu: 8.8, memory: 1.3 * GB, cwd: '/Users/sam/code/storefront', project: 'storefront', command: '/Applications/Cursor.app/Contents/MacOS/Cursor', ports: [] },
  ];

  let containers: import('../core/monitor-containers').ContainerRow[] = [
    { id: 'a1b2c3d4e5f6', name: 'storefront-db', image: 'postgres:16', state: 'running', status: 'Up 3 hours', ports: '127.0.0.1:5433->5432/tcp', cpu: 1.4, memUsed: 182 * MB, memLimit: 7.7 * GB, netIn: 21 * MB, netOut: 9 * MB, blockRead: 120 * MB, blockWrite: 64 * MB, pids: 14 },
    { id: 'b2c3d4e5f6a7', name: 'api-cache', image: 'redis:7', state: 'running', status: 'Up 3 hours', ports: '6380->6379/tcp', cpu: 0.3, memUsed: 9 * MB, memLimit: 7.7 * GB, netIn: 2 * MB, netOut: 4 * MB, pids: 6 },
    { id: 'c3d4e5f6a7b8', name: 'search', image: 'opensearch:2', state: 'running', status: 'Up 40 minutes', ports: '9200->9200/tcp', cpu: 18.2, memUsed: 1.6 * GB, memLimit: 7.7 * GB, netIn: 5 * MB, netOut: 1 * MB, pids: 88 },
    { id: 'd4e5f6a7b8c9', name: 'old-migration', image: 'node:22', state: 'exited', status: 'Exited (0) 2 days ago', ports: '' },
  ];
  let streams: import('../core/monitor-mixer').MixerStream[] = [
    { id: '41', pid: 510, name: 'Browser', volume: 80, muted: false },
    { id: '42', pid: 640, name: 'Music', volume: 55, muted: false },
    { id: '43', pid: 820, name: 'Video call', volume: 100, muted: false },
    { id: '44', pid: 900, name: 'Game', volume: 30, muted: true },
  ];
  let outputs: import('../core/monitor-mixer').OutputDevice[] = [{ id: 'speakers', name: 'Built-in speakers', default: true }, { id: 'headphones', name: 'Studio headphones', default: false }, { id: 'hdmi', name: 'Display (HDMI)', default: false }];
  let energyRows: import('../core/monitor-energy').EnergyRow[] = [
    { pid: 512, name: 'Browser Helper (Renderer)', power: 38.2 },
    { pid: 140, name: 'WindowServer', power: 21.4 },
    { pid: 700, name: 'Editor', power: 12.9, bundleId: 'com.example.editor', appNap: true },
    { pid: 640, name: 'Music', power: 6.1, bundleId: 'com.apple.Music', appNap: true, holds: ['PreventUserIdleSystemSleep: Playing audio'] },
    { pid: 820, name: 'Video call', power: 5.5, bundleId: 'com.example.call', appNap: false, holds: ['PreventUserIdleDisplaySleep: Call in progress'] },
  ];

  const reading = (): LiveReading => {
    const t = Date.now();
    const busy = 18 + wave(t, 40_000) * 30 + Math.random() * 12;
    return {
      t, cpu: busy, perCore: Array.from({ length: 10 }, (_, i) => Math.min(100, busy * (0.4 + (i % 5) * 0.3) + Math.random() * 10)), memUsed: 11.2 * GB + Math.random() * 0.3 * GB, memTotal: 16 * GB,
      netIn: (0.4 + wave(t, 13_000) * 2.6) * MB, netOut: (0.06 + Math.random() * 0.3) * MB, diskR: Math.random() * 3 * MB, diskW: Math.random() * 1.8 * MB,
      gpu: 9 + wave(t, 21_000) * 24, power: 6 + busy * 0.16, temp: 47 + busy * 0.3, battery: 82, charging: false,
    };
  };
  const live = () => {
    const last = recent[recent.length - 1];
    if (!last || Date.now() - last.t > 900) recent = pushRing(recent, reading(), 120);
    return { latest: recent[recent.length - 1], recent: recent.slice(-60) };
  };
  // Start with a minute of readings so sparklines are not empty.
  for (let i = 60; i > 0; i--) recent.push({ ...reading(), t: Date.now() - i * 1000 });

  const sensors = (): Sensors => {
    const r = reading();
    return {
      gpus: [{ name: 'Apple M3 Pro', vendor: 'apple', util: r.gpu, source: 'ioreg IOAccelerator' }],
      fans: [], temps: [],
      power: { battery: r.power, source: ['battery (ioreg AppleSmartBattery)'] },
      limits: ['macOS has no public way to read fan speeds or most temperatures (they sit behind the private SMC interface), so Keeper does not show them. Fan control is not offered on any system.'],
    };
  };

  const ok = (message: string) => ({ ok: true, message });

  return {
    sysmon: {
      watch: async () => live(),
      live: async () => live(),
      history: async (from, to, max = 600) => {
        const q = query(hist(), from, to, max);
        return { ...q, peaks: peaks(q), top: topApps(hist(), from, to), oldest: hist().tiers['1h'][0]?.t ?? null };
      },
      exportCsv: async () => '/Users/sam/Downloads/Keeper health.csv',
      clearHistory: async () => { store = emptyStore(); },
      devServers: async () => ({ projects }),
      stopServer: async (pid) => {
        const s = projects.flatMap((p) => p.servers).find((x) => x.pid === pid);
        projects = projects.map((p) => ({ ...p, servers: p.servers.filter((x) => x.pid !== pid) })).filter((p) => p.servers.length);
        return ok(`Stopped ${s?.kind ?? 'it'} on port ${s?.port ?? '?'}.`);
      },
      stopProject: async (root) => {
        const p = projects.find((x) => x.root === root);
        projects = projects.filter((x) => x.root !== root);
        return { ok: true, stopped: p?.servers.length ?? 0, message: `Stopped ${p?.servers.length ?? 0} processes of ${p?.name ?? 'the project'}.` };
      },
      restartServer: async (pid) => {
        const s = projects.flatMap((p) => p.servers).find((x) => x.pid === pid);
        return ok(`Started ${s?.kind ?? 'it'} again (port ${s?.port ?? '?'}).`);
      },
      agents: async () => agents.map((a) => ({ ...a, cpu: Math.max(0, a.cpu + (Math.random() - 0.5) * 2) })),
      stopAgentSession: async (pid) => {
        const a = agents.find((x) => x.pid === pid);
        agents = agents.filter((x) => x.pid !== pid);
        return { ok: true, stopped: a?.pids.length ?? 1, message: `Stopped ${a?.label ?? 'it'} and ${(a?.pids.length ?? 1) - 1} processes it started.` };
      },
      sensors: async () => sensors(),
      procExtras: async (pid, opts) => ({
        pid, parents: [{ pid: 1, name: 'launchd' }], ports: pid === 4310 ? [5173] : [],
        env: [['HOME', '/Users/sam', false], ['LANG', 'en_GB.UTF-8', false], ['NODE_ENV', 'development', false], ['OPENAI_API_KEY', 'sk-demo…', true], ['PATH', '/opt/homebrew/bin:/usr/bin:/bin', false], ['TERM_PROGRAM', 'Terminal', false]]
          .map(([name, value, secret]) => ({ name: name as string, secret: secret as boolean, value: secret ? (opts?.revealSecrets ? (value as string) : undefined) : opts?.reveal || ['HOME', 'LANG', 'PATH', 'NODE_ENV', 'TERM_PROGRAM'].includes(name as string) ? (value as string) : undefined })),
        signature: { valid: true, signed: true, signer: 'Developer ID Application: Example Software Ltd (AB12CD34EF)', teamId: 'AB12CD34EF', identifier: 'com.example.editor', hardenedRuntime: true, sandboxed: false, notarized: true, source: 'codesign' },
      }),
      settings: async () => settings,
      setSettings: async (patch) => (settings = normalizeMonitorSettings({ ...settings, ...patch, surfaces: { ...settings.surfaces, ...patch.surfaces }, tray: { ...settings.tray, ...patch.tray }, output: { ...settings.output, ...patch.output } })),
      trayPreview: async () => {
        const r = live().latest!;
        return settings.tray.metrics.map((m) => ({ metric: m, image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', title: m === 'cpu' ? `${Math.round(r.cpu)}%` : m === 'mem' ? `${Math.round((r.memUsed / r.memTotal) * 100)}%` : m === 'net' ? '↓1.2M ↑90K' : '—' }));
      },
      trayState: async () => ({ items: settings.surfaces.tray ? (settings.tray.layout === 'combined' ? ['combined'] : settings.tray.metrics) : [], tooltips: [] }),
      showPopover: async () => undefined,
      containers: async () => ({
        engine: 'docker',
        containers: containers.map((c) => (c.state === 'running' ? { ...c, cpu: Math.max(0, (c.cpu ?? 0) + (Math.random() - 0.5)), memUsed: (c.memUsed ?? 0) * (0.98 + Math.random() * 0.04) } : c)),
        disk: [
          { type: 'Images', total: 14, active: 5, size: 6.8 * GB, reclaimable: 3.1 * GB },
          { type: 'Containers', total: 4, active: 3, size: 210 * MB, reclaimable: 12 * MB },
          { type: 'Local Volumes', total: 6, active: 3, size: 1.9 * GB, reclaimable: 640 * MB },
          { type: 'Build Cache', total: 88, active: 0, size: 2.4 * GB, reclaimable: 2.4 * GB },
        ],
      }),
      containerAction: async (id, action) => {
        containers = containers.map((c) => (c.id === id ? { ...c, state: action === 'stop' ? 'exited' : action === 'pause' ? 'paused' : 'running', status: action === 'stop' ? 'Exited (0) just now' : 'Up 1 second', cpu: action === 'stop' ? undefined : c.cpu } : c));
        return { ok: true, message: `${action === 'stop' ? 'Stopped' : action === 'restart' ? 'Restarted' : action === 'start' ? 'Started' : action === 'pause' ? 'Paused' : 'Resumed'} ${id}` };
      },
      mixer: async () => ({ supported: true, canSwitchOutput: true, canSetVolume: true, canRouteStreams: true, streams, outputs }),
      setStream: async (id, patch) => { streams = streams.map((x) => (x.id === id ? { ...x, ...patch } : x)); return true; },
      setOutput: async (name) => { outputs = outputs.map((o) => ({ ...o, default: o.id === name })); return true; },
      setStreamOutput: async (id, sink) => { streams = streams.map((x) => (x.id === id ? { ...x, output: sink } : x)); return true; },
      soundRules: async () => ({ on: true, rules: {} }),
      forgetSound: async () => ({}),
      energy: async () => ({ supported: true, rows: energyRows }),
      setAppNap: async (id, allowed) => { energyRows = energyRows.map((r) => (r.bundleId === id ? { ...r, appNap: allowed } : r)); return true; },
      tabs: async () => ({ linked: true, tabs: [
        { session: 'b1', id: 11, browser: 'Browser', title: 'Design review — Figma-like board', url: 'https://board.example.com/file/42', memory: 612 * MB, bytes: 48 * MB },
        { session: 'b1', id: 12, browser: 'Browser', title: 'Live stream', url: 'https://video.example.com/watch?v=1', memory: 410 * MB, bytes: 320 * MB, audible: true },
        { session: 'b1', id: 13, browser: 'Browser', title: 'Inbox (12)', url: 'https://mail.example.com/', memory: 230 * MB, bytes: 6 * MB },
        { session: 'b1', id: 14, browser: 'Browser', title: 'Docs — API reference', url: 'https://docs.example.com/api', memory: 96 * MB, bytes: 2 * MB },
        { session: 'b1', id: 15, browser: 'Browser', title: 'Old article', url: 'https://news.example.com/a', memory: undefined, bytes: 1 * MB, asleep: true },
      ] }),
      openLauncher: async () => undefined,
      openTool: async (id) => { recentTools = [id, ...recentTools.filter((x) => x !== id)].slice(0, 12); },
      recentTools: async () => recentTools,
      closeWindow: async () => undefined,
      outputPreview: async () => (settings.output.mode === 'beside' ? '' : settings.output.mode === 'dated' ? '/Users/sam/Downloads/Keeper/2026-10-31 14.05 Example' : settings.output.folder),
    },
  };
}
