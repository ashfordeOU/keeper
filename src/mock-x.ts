// SPDX-License-Identifier: AGPL-3.0-or-later
// Demo data for health history, weather, toolbox helpers, folder tidying,
// AI file actions and updates (`npm run demo`).

import type { KeeperApiX, UpdateStatus } from '../core/api-x';
import { defaultAlertRules, topConsumers, type HealthSample, type SpeedResult } from '../core/monitor';
import { planTidy, summarizeTidy } from '../core/tidy';
import type { Place, Weather } from '../core/weather';

const MIN = 60_000;
const now = Date.now();

function history(): HealthSample[] {
  const out: HealthSample[] = [];
  for (let i = 24 * 60; i >= 0; i -= 5) {
    const t = now - i * MIN;
    const hour = new Date(t).getHours();
    const busy = hour >= 9 && hour <= 18;
    const wave = Math.sin(i / 37) * 12 + Math.sin(i / 7) * 5;
    const chrome = Math.max(2, (busy ? 28 : 6) + wave);
    out.push({
      t, cpu: Math.max(3, Math.min(97, (busy ? 32 : 9) + wave + (i % 180 < 15 ? 40 : 0))), memUsed: (busy ? 12.4 : 9.1) * 1024 ** 3 + wave * 5e7, memTotal: 18 * 1024 ** 3,
      battery: Math.max(8, 100 - ((24 * 60 - i) % 600) / 6), charging: (24 * 60 - i) % 600 > 520,
      top: [
        { name: 'Google Chrome Helper (Renderer)', cpu: Math.round(chrome * 10) / 10, memory: 1.4 * 1024 ** 3 },
        { name: 'node', cpu: i % 180 < 15 ? 96 : 4, memory: 420 * 1024 ** 2 },
        { name: 'Slack', cpu: 3.2, memory: 640 * 1024 ** 2 },
        { name: 'WindowServer', cpu: 7.5, memory: 300 * 1024 ** 2 },
        { name: 'Figma', cpu: busy ? 9 : 0.4, memory: 900 * 1024 ** 2 },
      ],
    });
  }
  return out;
}

function weatherFor(p: Place, units: 'metric' | 'imperial'): Weather {
  const f = (c: number) => (units === 'imperial' ? Math.round(c * 1.8 + 32) : c);
  const seed = Math.abs(Math.round(p.lat * 10)) % 7;
  return {
    place: p, fetchedAt: now, units,
    current: { temp: f(17 + seed), feels: f(16 + seed), code: [2, 61, 0, 3, 1, 80, 2][seed], wind: 14 + seed, humidity: 60 + seed, isDay: true, uv: 3 + (seed % 4), aqi: 30 + seed * 9 },
    hourly: Array.from({ length: 24 }, (_, i) => ({ t: now + i * 3600_000, temp: f(15 + seed + Math.round(5 * Math.sin((i - 4) / 4))), code: i > 14 && i < 18 ? 61 : 2, rainChance: i > 13 && i < 19 ? 55 + i : 8, rain: i > 14 && i < 18 ? 0.6 + (i % 3) * 0.4 : 0, uv: Math.max(0, 6 - Math.abs(i - 5)), wind: 10 + (i % 6) * 2 })),
    daily: Array.from({ length: 7 }, (_, i) => ({ t: new Date(now + i * 86_400_000).setHours(0, 0, 0, 0), min: f(11 + ((i + seed) % 4)), max: f(19 + ((i * 3 + seed) % 6)), code: [2, 61, 3, 0, 1, 80, 95][(i + seed) % 7], rainChance: [10, 70, 30, 0, 5, 60, 80][(i + seed) % 7], sunrise: new Date(now + i * 86_400_000).setHours(7, 12), sunset: new Date(now + i * 86_400_000).setHours(18, 4), uvMax: 5 })),
    nowcast: seed % 2 ? 'Rain starting in about 40 minutes' : undefined,
  };
}

export function mockX(): KeeperApiX {
  let hist = history();
  let rules = defaultAlertRules();
  const speeds: SpeedResult[] = [{ t: now - 3 * 86_400_000, downMbps: 212.4, upMbps: 38.1, pingMs: 14 }, { t: now - 86_400_000, downMbps: 187.9, upMbps: 41.6, pingMs: 17 }];
  let places: Place[] = [
    { name: 'Lisbon', lat: 38.72, lon: -9.14, country: 'Portugal' },
    { name: 'Denver, Colorado', lat: 39.74, lon: -104.99, country: 'United States' },
  ];
  let login = false;
  let tweakState: Record<string, boolean | number> = { 'finder-hidden': false, 'finder-extensions': true, 'dock-autohide': true, 'dock-delay': 0.5 };
  const update: UpdateStatus = {
    state: 'available', current: '0.1.0', version: '0.2.0', checkedAt: now - 3600_000, publishedAt: new Date(now - 2 * 86_400_000).toISOString(),
    size: 128 * 1024 * 1024, method: 'in-place', canInstall: true, url: 'https://github.com/ashfordeOU/keeper/releases',
    notes: '## What’s new\n- **Faster search** across large libraries\n- New *Bubbles* view in Space Map\n- Fixes for the Island on external displays\n\nSee the [full changelog](https://github.com/ashfordeOU/keeper/blob/main/CHANGELOG.md).',
  };
  const delay = <T>(v: T, ms = 300) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  return {
    monitor: {
      history: async () => hist,
      topToday: async () => topConsumers(hist, now - 86_400_000).slice(0, 12),
      alerts: async () => ({ rules, active: [{ rule: 'cpu-hog', name: 'node', value: 96, since: now - 12 * MIN }] }),
      setAlertRules: async (r) => (rules = r),
      docker: async () => ({ available: true, containers: [
        { id: 'a1b2c3', name: 'postgres', image: 'postgres:16', state: 'running', status: 'Up 3 hours', ports: '0.0.0.0:5432->5432/tcp' },
        { id: 'd4e5f6', name: 'redis', image: 'redis:7', state: 'exited', status: 'Exited (0) 2 days ago', ports: '' },
      ] }),
      dockerAction: async () => true,
      killTree: async () => 3,
      stopAgent: async () => 1,
      thermals: async () => [{ label: 'CPU package', celsius: 54 }, { label: 'Battery', celsius: 31 }],
      disks: async () => [{ device: 'disk0', healthy: true, detail: 'SMART status: Verified' }],
      speedTest: async () => {
        const r = { t: Date.now(), downMbps: 198.3, upMbps: 40.2, pingMs: 15 };
        speeds.push(r);
        return delay(r, 2500);
      },
      speedHistory: async () => speeds,
    },
    forecast: {
      places: async () => places,
      savePlaces: async (p) => (places = p),
      get: async (p, units) => delay(weatherFor(p, units), 200),
      alerts: async (p) => (p.country === 'United States' ? { supported: true, alerts: [{ id: 'a', title: 'Wind Advisory', severity: 'moderate', headline: 'Wind Advisory until 6 PM', description: 'West winds 25 to 35 mph with gusts up to 55 mph.', instruction: 'Secure outdoor objects.', starts: now, ends: now + 6 * 3600_000, source: 'NWS Boulder CO' }] } : { supported: false, alerts: [] }),
      radar: async () => null,
      climate: async (p) => Array.from({ length: 12 }, (_, m) => ({ month: m, avgMax: Math.round((15 + 10 * Math.sin(((m - 3) / 12) * 2 * Math.PI) + (p.lat > 39 ? -3 : 0)) * 10) / 10, avgMin: Math.round((7 + 8 * Math.sin(((m - 3) / 12) * 2 * Math.PI) + (p.lat > 39 ? -6 : 0)) * 10) / 10, rainMm: Math.round(90 - 70 * Math.sin(((m - 3) / 12) * 2 * Math.PI)), rainyDays: Math.round(11 - 8 * Math.sin(((m - 3) / 12) * 2 * Math.PI)), sunHours: Math.round(180 + 120 * Math.sin(((m - 3) / 12) * 2 * Math.PI)) })),
      trips: async (units) => [{
        stop: { event: { uid: 't', title: 'Web Summit', start: now + 3 * 86_400_000, end: now + 3 * 86_400_000 + 8 * 3600_000, allDay: false, location: 'Altice Arena, Lisbon, Portugal' }, location: 'Altice Arena, Lisbon, Portugal', day: new Date(now + 3 * 86_400_000).setHours(0, 0, 0, 0) },
        place: places[0], day: weatherFor(places[0], units).daily[3], units,
      }],
    },
    tools: {
      networkInfo: async () => ({ hostname: 'demo-mac.local', interfaces: [{ name: 'en0', address: '192.168.1.42', family: 'IPv4', mac: 'a4:83:e7:12:34:56', internal: false }, { name: 'en0', address: 'fe80::1c2b:3d4e', family: 'IPv6', mac: 'a4:83:e7:12:34:56', internal: false }, { name: 'lo0', address: '127.0.0.1', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true }] }),
      publicIp: async () => delay('203.0.113.24'),
      tweaks: async () => [
        { id: 'finder-hidden', label: 'Show hidden files in Finder', description: 'Files whose names start with a dot become visible.', kind: 'toggle', value: tweakState['finder-hidden'] as boolean, confirm: 'Finder will restart.' },
        { id: 'finder-extensions', label: 'Always show file extensions', description: 'Show “.pdf”, “.jpg” and so on everywhere.', kind: 'toggle', value: tweakState['finder-extensions'] as boolean, confirm: 'Finder will restart.' },
        { id: 'dock-autohide', label: 'Hide the Dock automatically', description: 'The Dock slides away until you move the pointer to it.', kind: 'toggle', value: tweakState['dock-autohide'] as boolean, confirm: 'The Dock will restart.' },
        { id: 'dock-delay', label: 'Dock show delay (seconds)', description: '0 makes a hidden Dock appear instantly.', kind: 'number', value: tweakState['dock-delay'] as number, confirm: 'The Dock will restart.' },
        { id: 'restart-finder', label: 'Restart Finder', description: 'Fixes a Finder that stopped responding.', kind: 'action', confirm: 'Finder windows will close and reopen.' },
      ],
      setTweak: async function (id, v) { if (v !== undefined) tweakState = { ...tweakState, [id]: v }; return this.tweaks(); },
      clearQuarantine: async () => true,
      resetPermissions: async () => true,
      pickApp: async () => '/Applications/Example.app',
      pickFiles: async () => ['/Users/demo/Downloads/receipt-cafe.jpg', '/Users/demo/Downloads/receipt-taxi.pdf'],
      saveAs: async (name) => `/Users/demo/Downloads/${name}`,
    },
    folders: {
      tidy: async (dir, mode, apply) => {
        const items = [
          { path: `${dir}/Q3 Invoice.pdf`, name: 'Q3 Invoice.pdf', isDir: false, mtime: now - 3 * 86_400_000 },
          { path: `${dir}/chart.png`, name: 'chart.png', isDir: false, mtime: now - 40 * 86_400_000 },
          { path: `${dir}/Zoom.pkg`, name: 'Zoom.pkg', isDir: false, mtime: now - 70 * 86_400_000 },
          { path: `${dir}/notes.md`, name: 'notes.md', isDir: false, mtime: now - 2 * 86_400_000 },
          { path: `${dir}/movie.mp4`, name: 'movie.mp4', isDir: false, mtime: now - 100 * 86_400_000 },
        ];
        const moves = planTidy(dir, items, mode);
        return { moves, summary: summarizeTidy(moves), result: apply ? { freed: 0, removed: moves.length, failed: 0, skipped: [], journalId: 'demo' } : undefined };
      },
    },
    aiActions: {
      provider: async () => ({ provider: 'anthropic', local: false, configured: true, label: 'Claude' }),
      suggestName: async (p) => delay(`Acme invoice Q3 2026${p.match(/\.[^.]+$/)?.[0] ?? ''}`, 900),
      summarize: async () => delay('An invoice from Acme Corp for the third quarter.\n• Amount due: $4,200.00\n• Due date: November 15\n• Invoice number 4471', 1100),
      receipts: async (paths) => delay({ csvPath: '/Users/demo/Downloads/Receipts 2026-10-30.csv', rows: paths.map((p, i) => ({ file: p.split('/').pop()!, date: '2026-10-2' + i, merchant: ['Café Sol', 'City Taxi'][i % 2], total: [12.5, 23.8][i % 2], currency: 'EUR', tax: null, category: ['food', 'travel'][i % 2], payment: 'card' })) }, 1400),
      altText: async () => delay('A phone screenshot of Wi-Fi settings showing the network “Studio-5G” and its password.', 900),
      translateSubtitles: async (p, lang) => delay(p.replace(/\.(srt|vtt)$/i, `.${lang.toLowerCase()}.$1`), 1200),
    },
    appInfo: {
      updateStatus: async () => update,
      checkForUpdates: async () => delay({ ...update, state: 'none', checkedAt: Date.now() }, 800),
      installUpdate: async () => undefined,
      downloadUpdate: async () => delay({ ...update, state: 'ready', version: '0.2.0', message: 'Installs when you quit Keeper, or restart now' }, 1200),
      whatsNew: async () => null,
      releasesPage: async () => undefined,
      versionNotes: async () => [
        { version: '0.2.0', date: new Date(now - 2 * 86_400_000).toISOString(), url: 'https://github.com/ashfordeOU/keeper/releases', prerelease: false, short: ['Faster search across large libraries', 'New Bubbles view in Space Map', 'Island fixes on external displays'] },
        { version: '0.1.0', date: new Date(now - 20 * 86_400_000).toISOString(), url: 'https://github.com/ashfordeOU/keeper/releases', prerelease: false, short: ['First release: library, search, clean up, Island'] },
      ],
      loginItem: async () => login,
      setLoginItem: async (on) => (login = on),
    },
  };
}

