// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Sample data for the browser demo (`npm run demo`). Nothing here touches a disk.

import { mockUsage } from './mock-usage';
import { isUnder, typeCounts } from '../core/file-types';
import { mockIslandTools } from './mock-island-tools';
import { mockAiUsage } from './mock-ai-usage';
import { mockCues } from './mock-cues';
import { mockFocusBlock } from './mock-focus';
import { mockTimeTrack } from './mock-time';
import { mockJournal } from './mock-journal';
import { mockInbox } from './mock-inbox';
import { mockReader } from './mock-reader';
import { mockPhoneAlerts } from './mock-alerts';
import { mockNotices } from './mock-notices';
import { mockMonitors } from './mock-monitors';
import { mockPhoto } from './mock-photo';
import { mockCrashReports } from './mock-crash';
import { mockFeatures } from './mock-features';
import { mockUsageStats } from './mock-usage-stats';
import { mockPro } from './mock-pro';
import { mockPermissions } from './mock-permissions';
import { mockAwake } from './mock-awake';
import { mockStage } from './mock-stage';
import { mockStudio } from './mock-studio';
import { mockVoice } from './mock-voice';
import { mockTyping } from './mock-typing';
import { mockAshforde } from './mock-ashforde';
import { mockComponents } from './mock-components';
import { featureStates } from '../core/features';
import type { BrowseEntry, IslandState, KeeperApi } from '../core/api';
import { extOf, kindOf, looksLikeScreenshot } from '../core/classify';
import { search } from '../core/query/match';
import { parseQuery } from '../core/query/parse';
import { previewRename } from '../core/rename';
import { defaultSettings } from '../core/settings';
import { createMockCapture, DEMO_SHOT } from './mock-capture';
import { mockX } from './mock-x';
import { mockPlaces } from './mock-places';
import { mockTracks } from './mock-tracks';
import { mockRemote } from './mock-remote';
import { mockSession } from './mock-session';
import { mockProcs } from './mock-procs';
import { defaultGlanceSettings, glanceLayout, normalizeGlanceSettings, type GlanceSettings } from '../core/glance';
import { mockSysmon } from './mock-sysmon';
import { mockPim } from './mock-pim';
import { mockNotes } from './mock-notes';
import { mockFileKit } from './mock-filekit';
import { mockGuide } from './mock-guide';
import { mockControls } from './mock-controls';
import { mockSettingsPlus } from './mock-settingsplus';
import { mockNet } from './mock-net';
import { mockSecurity } from './mock-security';
import { mockFw } from './mock-fw';
import { mockSync } from './mock-sync';
import { mockNotesync } from './mock-notesync';
import { mockAgentTerm } from './mock-agentterm';
import { mockPlatform } from './mock-platform';
import { KIND_LABEL, NATIVE_KINDS, autoChoice, nativeChoices, planNative } from '../core/native-apps';
import { mockLock } from './mock-lock';
import { mockLink } from './mock-link';
import { mockMesh } from './mock-mesh';
import { mockScreen } from './mock-screen';
import { mockAccess } from './mock-access';
import { mockRdc } from './mock-rdc';
import { mockTerminal } from './mock-terminal';
import { mockBrain } from './mock-brain';
import { mockAgents } from './mock-agents';
import { mockCu } from './mock-cu';
import { mockAbilities } from './mock-abilities';
import { createMockIsland } from './mock-island';
import { mockAmbience } from './mock-ambience';
import type { CleanupGroup, DuplicateGroup, FileEntry, FileKind, Rule, SpaceNode } from '../core/types';
import { mockPreview } from './preview/mock';

const HOME = '/Users/demo';
const DAY = 86_400_000;
const now = Date.now();
const MB = 1024 * 1024;

const SOURCES = {
  gmail: { id: 'gmail', name: 'Gmail', host: 'mail.google.com' },
  gdrive: { id: 'gdrive', name: 'Google Drive', host: 'drive.google.com' },
  chatgpt: { id: 'chatgpt', name: 'ChatGPT', host: 'chatgpt.com' },
  slack: { id: 'slack', name: 'Slack', host: 'app.slack.com' },
  github: { id: 'github', name: 'GitHub', host: 'github.com' },
  canva: { id: 'canva', name: 'Canva', host: 'canva.com' },
  whatsapp: { id: 'whatsapp', name: 'WhatsApp', host: 'web.whatsapp.com' },
  x: { id: 'x', name: 'X', host: 'x.com' },
};

const seeds: [string, number, number, Partial<FileEntry>?][] = [
  ['Downloads/Q3 Invoice - Acme.pdf', 0.4, 2, { source: SOURCES.gmail, text: 'INVOICE #4471 Acme Corp. Amount due $4,200.00 Due date November 15' }],
  ['Downloads/Boarding pass LIS.pdf', 0.2, 6, { source: SOURCES.gmail }],
  ['Downloads/brand-kit-final.zip', 184, 40, { source: SOURCES.gdrive }],
  ['Downloads/brand-kit-final', 0, 40],
  ['Downloads/Figma-125.4.dmg', 412, 64, { source: { id: 'web:figma.com', name: 'figma.com', host: 'desktop.figma.com' } }],
  ['Downloads/Zoom.pkg', 96, 120],
  ['Downloads/report-draft (1).docx', 1.2, 9, { source: SOURCES.slack }],
  ['Downloads/report-draft.docx', 1.2, 10, { source: SOURCES.slack }],
  ['Downloads/chart-export.png', 0.8, 1, { source: SOURCES.chatgpt }],
  ['Downloads/data-analysis.csv', 3.1, 1, { source: SOURCES.chatgpt }],
  ['Downloads/instagram-post.png', 2.4, 15, { source: SOURCES.canva }],
  ['Downloads/keeper-0.1.0.AppImage', 128, 3, { source: SOURCES.github }],
  ['Downloads/WhatsApp Image 2026-09-12.jpeg', 0.3, 48, { source: SOURCES.whatsapp }],
  ['Downloads/meme.gif', 4.2, 200, { source: SOURCES.x }],
  ['Downloads/movie.mkv.crdownload', 650, 30],
  ['Desktop/Screenshot 2026-10-28 at 09.14.02.png', 1.1, 2, { text: 'Network: Studio-5G\nWi-Fi password: blue-otter-42\nSecurity: WPA3' }],
  ['Desktop/Screenshot 2026-10-21 at 16.40.11.png', 0.9, 9, { text: 'Tracking number 1Z 999 AA1 01 2345 6784  Estimated delivery Friday' }],
  ['Desktop/Screenshot 2026-07-02 at 11.02.45.png', 1.4, 120, { text: 'Meeting notes: launch on the 14th, budget approved' }],
  ['Desktop/Screenshot 2026-06-11 at 08.00.00.png', 1.3, 141],
  ['Desktop/todo.md', 0.01, 0.2],
  ['Documents/Taxes/2025 Tax Return.pdf', 2.8, 190, { tags: ['taxes', 'important'] }],
  ['Documents/Taxes/W-2 2025.pdf', 0.3, 230, { tags: ['taxes'] }],
  ['Documents/Resume - Demo.pdf', 0.2, 60, { tags: ['work'] }],
  ['Documents/Lease agreement.pdf', 5.6, 400],
  ['Documents/Budget 2026.xlsx', 0.4, 12, { tags: ['work'] }],
  ['Documents/Pitch deck v7.key', 48, 20, { tags: ['work'] }],
  ['Documents/Notes/ideas.txt', 0, 30],
  ['Documents/Launch plan.md', 0.002, 1],
  ['Documents/Projects/site/package.json', 0.001, 4],
  ['Documents/Projects/site/server.log', 0.004, 0.1],
  ['Documents/Growth.csv', 0.001, 3],
  ['Pictures/IMG_4102.HEIC', 3.2, 75, { meta: { width: 4032, height: 3024, camera: 'Apple iPhone 15 Pro' } }],
  ['Pictures/IMG_4102.JPG', 4.9, 75, { meta: { width: 4032, height: 3024, camera: 'Apple iPhone 15 Pro' } }],
  ['Pictures/IMG_4103.HEIC', 3.1, 75, { meta: { width: 4032, height: 3024, camera: 'Apple iPhone 15 Pro' } }],
  ['Pictures/IMG_4104.HEIC', 3.0, 75, { meta: { width: 4032, height: 3024, camera: 'Apple iPhone 15 Pro' } }],
  ['Pictures/Lisbon/PXL_20260812_101500.jpg', 4.1, 79, { meta: { width: 4080, height: 3072, camera: 'Google Pixel 9' } }],
  ['Pictures/Lisbon/PXL_20260812_101503.jpg', 4.0, 79, { meta: { width: 4080, height: 3072, camera: 'Google Pixel 9' } }],
  ['Pictures/wallpaper.png', 6.2, 300],
  ['Movies/Lisbon trip.mov', 2400, 79, { meta: { durationSec: 412, width: 3840, height: 2160, camera: 'Apple iPhone 15 Pro' } }],
  ['Movies/Screen Recording 2025-11-02.mov', 880, 362, { meta: { durationSec: 1310 } }],
  ['Movies/birthday.mp4', 310, 500, { meta: { durationSec: 95 } }],
  ['Music/Morning Light.mp3', 8.4, 210, { meta: { durationSec: 214, artist: 'Ana Sol', album: 'Coast' } }],
  ['Music/Tidewater.flac', 31, 210, { meta: { durationSec: 262, artist: 'Ana Sol', album: 'Coast' } }],
  ['Music/Podcast - Episode 12.m4a', 54, 14, { meta: { durationSec: 3120, artist: 'Builders' } }],
  ['Documents/Projects/site/index.html', 0.02, 4],
  ['Documents/Projects/site/app.ts', 0.03, 4],
  ['Documents/Archive/old-photos.zip', 1900, 700],
  // A code project worked on today (Home's Jump back in groups it).
  ['Developer/orbit-app/src/checkout.tsx', 0.01, 0.04],
  ['Developer/orbit-app/README.md', 0.004, 0.15],
  ['Developer/orbit-app/public/hero.png', 0.6, 0.6],
  ['Developer/orbit-app/docs/roadmap.md', 0.003, 1.5],
];

const files: FileEntry[] = seeds
  .filter(([p]) => !p.endsWith('brand-kit-final'))
  .map(([rel, mb, days, extra]) => {
    const name = rel.split('/').pop()!;
    const path = `${HOME}/${rel}`;
    const t = now - days * DAY;
    return {
      path, name, ext: extOf(name), kind: kindOf(name), size: Math.round(mb * MB), mtime: t, btime: t, atime: t + DAY,
      root: rel.split('/')[0], screenshot: looksLikeScreenshot(name) || undefined, ...extra,
    };
  });

const COLORS: Record<FileKind, [string, string]> = {
  image: ['#ff9a8b', '#ff6a88'], video: ['#a18cd1', '#6a5af9'], audio: ['#fbc2eb', '#f59e0b'], document: ['#89f7fe', '#3b82f6'],
  archive: ['#fddb92', '#a16207'], installer: ['#84fab0', '#14b8a6'], app: ['#96fbc4', '#10b981'], code: ['#cfd9df', '#64748b'], other: ['#e0e0e0', '#94a3b8'],
};

function thumb(f: FileEntry): string | null {
  if (f.kind !== 'image' && f.kind !== 'video') return null;
  const [a, b] = COLORS[f.kind];
  const seed = [...f.name].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const shot = f.screenshot
    ? `<rect x="20" y="22" width="160" height="12" rx="3" fill="#fff" opacity=".85"/><rect x="20" y="44" width="110" height="8" rx="3" fill="#fff" opacity=".6"/><rect x="20" y="60" width="130" height="8" rx="3" fill="#fff" opacity=".6"/>`
    : `<circle cx="${60 + (seed % 80)}" cy="${50 + (seed % 40)}" r="${22 + (seed % 20)}" fill="#fff" opacity=".35"/><path d="M0 130 L${50 + (seed % 60)} ${80 + (seed % 20)} L120 120 L160 95 L200 130Z" fill="#000" opacity=".18"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="200" height="150" fill="url(#g)"/>${shot}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const byPath = (p: string) => files.find((f) => f.path === p);
const delay = <T>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(v), ms));

function cleanupGroups(): CleanupGroup[] {
  const cache = (g: Omit<CleanupGroup, 'mode'> & { mode: 'cache' | 'bin' }): CleanupGroup => g;
  const pick = (names: string[]) => files.filter((f) => names.some((n) => f.path.endsWith(n)));
  const files_ = (id: string, name: string, description: string, icon: string, items: FileEntry[], preselect: boolean, safety: CleanupGroup['safety'] = 'review'): CleanupGroup =>
    ({ id, name, description, icon, mode: 'files', safety, preselect, items, size: items.reduce((n, f) => n + f.size, 0), count: items.length, locations: [...new Set(items.map((f) => f.root))] });
  return [
    cache({ id: 'browser-cache', name: 'Browser caches', description: 'Chrome, Safari, Firefox and others rebuild these as you browse. Logins, history and tabs stay.', icon: 'globe', mode: 'cache', safety: 'safe', preselect: true, size: 6.4 * 1024 * MB, count: 14, locations: ['~/Library/Caches/Google/Chrome', '~/Library/Caches/com.apple.Safari'] }),
    cache({ id: 'user-cache', name: 'User caches', description: 'Apps keep these to open faster and rebuild them when needed.', icon: 'layers', mode: 'cache', safety: 'safe', preselect: true, size: 3.9 * 1024 * MB, count: 212, locations: ['~/Library/Caches'] }),
    cache({ id: 'app-cache', name: 'App caches', description: 'Slack, Discord, Teams, VS Code, Notion and Spotify rebuild these on their own.', icon: 'apps', mode: 'cache', safety: 'safe', preselect: true, size: 2.1 * 1024 * MB, count: 9, locations: ['~/Library/Application Support/Slack/Cache'] }),
    cache({ id: 'logs', name: 'Logs', description: 'Diagnostic logs apps write over time. Nothing needs them to run.', icon: 'doc', mode: 'cache', safety: 'safe', preselect: true, size: 1.6 * 1024 * MB, count: 340, locations: ['~/Library/Logs'] }),
    cache({ id: 'dev-cache', name: 'Developer caches', description: 'npm, Yarn, pnpm, pip and Homebrew caches. The next install downloads packages again.', icon: 'code', mode: 'cache', safety: 'review', preselect: false, size: 4.9 * 1024 * MB, count: 6, locations: ['~/.npm/_cacache', '~/Library/Caches/Homebrew'] }),
    cache({ id: 'bin', name: 'Trash', description: 'Files you already deleted. Emptying it removes them for good.', icon: 'trash', mode: 'bin', safety: 'permanent', preselect: false, size: 1.2 * 1024 * MB, count: 31, locations: ['~/.Trash'] }),
    files_('old-installers', 'Old installers', 'Setup files (.dmg, .pkg) older than 14 days. The app is already installed — or you never needed it.', 'box', pick(['Figma-125.4.dmg', 'Zoom.pkg']), true, 'safe'),
    files_('unpacked-archives', 'Archives already unpacked', 'Zip and other archives in Downloads with an unpacked folder right next to them.', 'archive', pick(['brand-kit-final.zip']), true, 'safe'),
    files_('partial-downloads', 'Unfinished downloads', 'Downloads that stopped half-way (.crdownload, .part) and were never resumed.', 'down', pick(['movie.mkv.crdownload']), true, 'safe'),
    files_('old-downloads', 'Forgotten downloads', 'Files in Downloads you have not opened for 90+ days.', 'down', pick(['meme.gif']), false),
    files_('old-screenshots', 'Old screenshots', 'Screenshots older than 30 days. Copy any text out of them first — Keeper can read it.', 'screenshot', files.filter((f) => f.screenshot && now - f.mtime > 30 * DAY), false),
    files_('big-old-videos', 'Big old videos', 'Videos over 200 MB you have not watched in 6 months.', 'video', pick(['Screen Recording 2025-11-02.mov', 'birthday.mp4']), false),
    files_('unused-apps', 'Unused apps', 'Apps you have not opened in 6 months.', 'app', [], false),
  ].filter((g) => g.size > 0);
}

function dupes(): DuplicateGroup[] {
  const g = (kind: DuplicateGroup['kind'], paths: string[], keep: string, reason: string): DuplicateGroup => {
    const fs = paths.map((p) => byPath(`${HOME}/${p}`)!).filter(Boolean);
    return { id: `${kind}:${keep}`, kind, files: fs, keep: `${HOME}/${keep}`, reason, reclaimable: fs.filter((f) => f.path !== `${HOME}/${keep}`).reduce((n, f) => n + f.size, 0) };
  };
  return [
    g('exact', ['Downloads/report-draft.docx', 'Downloads/report-draft (1).docx'], 'Downloads/report-draft.docx', 'Keeping this one because it has the original name'),
    g('pair', ['Pictures/IMG_4102.HEIC', 'Pictures/IMG_4102.JPG'], 'Pictures/IMG_4102.HEIC', 'Keeps the original HEIC; the JPG is a converted copy'),
    g('similar', ['Pictures/Lisbon/PXL_20260812_101500.jpg', 'Pictures/Lisbon/PXL_20260812_101503.jpg'], 'Pictures/Lisbon/PXL_20260812_101500.jpg', 'Keeping this one because it has the most pixels'),
    g('similar', ['Pictures/IMG_4103.HEIC', 'Pictures/IMG_4104.HEIC'], 'Pictures/IMG_4103.HEIC', 'Keeping this one because it has the most pixels'),
  ];
}

function spaceTree(path: string): SpaceNode {
  const rel = path === HOME ? '' : path.slice(HOME.length + 1);
  if (!rel) {
    const kids: [string, number, boolean?][] = [['Library', 38, true], ['Movies', 61], ['Pictures', 44], ['Documents', 22], ['Downloads', 9.4, true], ['Music', 6], ['Desktop', 1.1], ['Projects', 14], ['.npm', 3.2, true], ['Applications', 4]];
    return { name: 'Home', path, size: kids.reduce((n, k) => n + k[1], 0) * 1024 * MB, files: 412_000, kind: 'folder', children: kids.map(([n, gb, c]) => ({ name: n, path: `${HOME}/${n}`, size: gb * 1024 * MB, files: Math.round(gb * 900), kind: 'folder' as const, cleanable: c })) };
  }
  const local = files.filter((f) => f.path.startsWith(path + '/'));
  const children: SpaceNode[] = local.map((f) => ({ name: f.name, path: f.path, size: f.size || MB, files: 1, kind: 'file' as const }));
  const fill = ['Caches', 'Application Support', 'Containers', 'Mail', 'Developer', 'Logs'];
  if (!children.length) fill.forEach((n, i) => children.push({ name: n, path: `${path}/${n}`, size: (12 - i * 2) * 1024 * MB, files: 1000, kind: 'folder', cleanable: n === 'Caches' || n === 'Logs' }));
  return { name: rel.split('/').pop()!, path, size: children.reduce((n, c) => n + c.size, 0), files: children.length, kind: 'folder', children };
}

const rules: Rule[] = [
  { id: 'old-installers', name: 'Send old installers to the Trash', enabled: false, conditions: [{ type: 'kind', kinds: ['installer'] }, { type: 'olderThanDays', days: 14 }], action: { type: 'trash' }, scope: [`${HOME}/Downloads`] },
  { id: 'screenshots-by-month', name: 'File screenshots into monthly folders', enabled: true, conditions: [{ type: 'screenshot' }, { type: 'olderThanDays', days: 1 }], action: { type: 'move', to: `${HOME}/Pictures/Screenshots/{yyyy}-{MM}` }, scope: [`${HOME}/Desktop`] },
  { id: 'downloads-by-source', name: 'Sort downloads into folders by where they came from', enabled: false, conditions: [{ type: 'olderThanDays', days: 7 }], action: { type: 'move', to: `${HOME}/Downloads/{source}` }, scope: [`${HOME}/Downloads`] },
];

export function createMockApi(): KeeperApi {
  const settings = defaultSettings(['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music'].map((n) => `${HOME}/${n}`), rules);
  // Demo only: ?theme=<id>&appearance=light|dark opens the demo in that theme, and
  // ?features=a,b switches on features that are off by default (used for screenshots).
  {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    const th = q.get('theme');
    const ap = q.get('appearance');
    if (th) settings.theme = th;
    if (ap === 'light' || ap === 'dark') settings.appearance = ap;
    for (const id of (q.get('features') ?? '').split(',').filter(Boolean)) settings.features = { ...settings.features, [id]: true };
    // ?islandLook=theme|dark|colorful&islandPreset=<gradient>: the Island in that look.
    const look = q.get('islandLook');
    const preset = q.get('islandPreset');
    if (look === 'theme' || look === 'dark' || look === 'colorful') settings.island = { ...settings.island, look };
    if (preset) settings.island = { ...settings.island, lookPreset: preset };
  }
  settings.savedSearches = [
    { id: 's1', name: 'Big videos', text: 'videos over 500 MB', createdAt: now },
    { id: 's2', name: 'Gmail PDFs', text: 'pdfs from gmail', createdAt: now },
  ];
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  const island: IslandState = {
    shelf: files.slice(0, 2),
    shelves: [],
    activeShelf: 'main',
    closedShelves: [],
    clips: [
      { id: 'c1', kind: 'text', text: 'blue-otter-42', at: now - 60_000 },
      { id: 'c2', kind: 'text', text: 'https://github.com/ashfordeOU/keeper', at: now - 3_600_000, pinned: true },
      { id: 'c3', kind: 'text', text: 'Meeting moved to 3pm — same room.', at: now - 7_200_000 },
    ],
    focus: { mode: 'idle', endsAt: 0, focusMin: 25, breakMin: 5, rounds: 2 },
    keepAwake: { on: false },
    battery: { percent: 76, charging: false },
    weather: {
      place: { name: 'Lisbon', lat: 38.72, lon: -9.14, country: 'Portugal' }, fetchedAt: now, units: 'metric',
      current: { temp: 19, feels: 18, code: 2, wind: 14, humidity: 64, isDay: true, uv: 3, aqi: 38 },
      hourly: Array.from({ length: 24 }, (_, i) => ({ t: now + i * 3600_000, temp: 19 + Math.round(4 * Math.sin(i / 4)), code: i > 14 && i < 18 ? 61 : 2, rainChance: i > 13 && i < 19 ? 60 : 10, rain: i > 14 && i < 18 ? 0.8 : 0, uv: Math.max(0, 5 - Math.abs(i - 4)), wind: 12 })),
      daily: Array.from({ length: 7 }, (_, i) => ({ t: now + i * DAY, min: 13 + (i % 3), max: 21 + (i % 4), code: [2, 61, 3, 0, 1, 80, 2][i], rainChance: [10, 70, 30, 0, 5, 60, 20][i], sunrise: now - 3 * 3600_000, sunset: now + 6 * 3600_000, uvMax: 5 })),
      // Every hour of the week, so the 7-day forecast widget can show rain by part of the day.
      hours: Array.from({ length: 7 * 24 }, (_, i) => {
        const t = new Date(now).setHours(0, 0, 0, 0) + i * 3600_000;
        const d = Math.floor(i / 24);
        const h = i % 24;
        const wet = [[5, 10, 35, 20], [40, 75, 85, 60], [25, 30, 15, 10], [0, 0, 5, 0], [5, 0, 10, 15], [30, 55, 70, 45], [15, 20, 25, 10]][d][Math.floor(h / 6)];
        return { t, temp: 15 + (d % 3) + Math.round(5 * Math.sin(((h - 9) / 24) * 2 * Math.PI)), code: [2, 61, 3, 0, 1, 80, 2][d], rainChance: Math.max(0, wet - (h % 6) * 3), rain: wet > 50 ? 0.6 : 0, uv: Math.max(0, 5 - Math.abs(h - 13)), wind: 12, isDay: h >= 7 && h < 18 };
      }),
      nowcast: 'Rain starting in about 40 minutes',
    },
    agents: [
      { id: 'a1', tool: 'claude-code', project: 'keeper', state: 'waiting', summary: 'Wants to use Bash', updatedAt: now - 20_000, file: '' },
      { id: 'a2', tool: 'codex', project: 'website', state: 'working', summary: 'Updating the pricing page', updatedAt: now - 3_000, file: '' },
    ],
    events: [
      { uid: 'e1', title: 'Design review', start: now + 40 * 60_000, end: now + 70 * 60_000, allDay: false, location: 'Room 4' },
      { uid: 'e2', title: 'Dentist', start: now + 26 * 3600_000, end: now + 27 * 3600_000, allDay: false },
    ],
    nowPlaying: { app: 'Music', title: 'Morning Light', artist: 'Ana Sol', album: 'Coast', playing: true, position: 42, duration: 214 },
    lyrics: [{ t: 30, text: 'Salt on the window, sun in the hall' }, { t: 40, text: 'Every small thing has a place after all' }, { t: 52, text: 'Keep what you love, let the rest of it go' }],
    // ?mailalert=1: new Important mail dropping down from the notch.
    alerts: typeof location !== 'undefined' && new URLSearchParams(location.search).get('mailalert') ? [{ id: 'mail1', kind: 'mail', ref: 'work:INBOX:101', title: 'Ana Lopez', detail: 'Homepage drafts — round 2', at: now }] : [],
  };
  const lockX = mockLock(HOME, () => listeners.get('library-changed')?.forEach((cb) => cb(undefined)));
  const islandX = createMockIsland(island, files, settings, () => listeners.get('island-changed')?.forEach((cb) => cb(undefined)), (ch) => listeners.get(ch)?.forEach((cb) => cb(undefined)));
  const ok = { freed: 0, removed: 0, failed: 0, skipped: [] as string[] };
  const browse = (dir: string): BrowseEntry[] => {
    const seen = new Map<string, BrowseEntry>();
    for (const f of files) {
      if (!f.path.startsWith(dir + '/')) continue;
      const rest = f.path.slice(dir.length + 1);
      const first = rest.split('/')[0];
      const isDir = rest.includes('/');
      const p = `${dir}/${first}`;
      const prev = seen.get(p);
      if (prev) { prev.size += f.size; continue; }
      seen.set(p, { path: p, name: first, isDir, size: f.size, mtime: f.mtime, kind: isDir ? 'folder' : f.kind, ext: isDir ? '' : f.ext, hidden: false });
    }
    if (dir === HOME) for (const n of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music']) if (!seen.has(`${HOME}/${n}`)) seen.set(`${HOME}/${n}`, { path: `${HOME}/${n}`, name: n, isDir: true, size: 0, mtime: now, kind: 'folder', ext: '', hidden: false });
    return [...seen.values()].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  };

  return {
    ...mockX(),
    ...mockTyping(),
    // Cues and Island+ (calls, levels, notifications, agents).
    ...mockCues((ch) => listeners.get(ch)?.forEach((cb) => (cb as () => void)())),
    ...mockTimeTrack(),
    ...mockJournal(),
    ...mockInbox((ch, ...a) => listeners.get(ch)?.forEach((cb) => (cb as (...x: unknown[]) => void)(...a))),
    ...mockReader(),
    ...mockPhoneAlerts(),
    pageUse: { opened: async () => undefined },
    ...mockNotices((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockMonitors(),
    ...mockPhoto(),
    ...mockCrashReports(),
    ...mockFocusBlock((ch) => listeners.get(ch)?.forEach((cb) => (cb as () => void)())),
    ...mockPlaces(),
    ...mockTracks((ch) => listeners.get(ch)?.forEach((cb) => (cb as () => void)())),
    ...mockRemote(),
    ...mockSession(),
    ...mockProcs(),
    ...mockSysmon(),
    glance: (() => {
      let gs = defaultGlanceSettings('darwin');
      const now = Date.now();
      const inputs = { now, weather: { place: 'Tallinn', temp: 7, units: 'c' as const, summary: 'Partly cloudy', nowcast: 'Rain starting in about 20 minutes' }, disk: { total: 994e9, free: 312e9, name: 'Main disk' }, system: { cpu: 6, memUsed: 21e9, memTotal: 36e9, battery: { percent: 74, charging: false, minutesLeft: 312 } }, network: { downBps: 182_000, upBps: 24_000, wifi: 'Studio', online: true }, awake: { on: true, until: now + 42 * 60_000, reason: 'Rendering' }, net: { apps: 7, down: 412_000, up: 38_000, spark: [120, 340, 220, 610, 480, 390, 520, 700, 450, 380, 560, 640].map((x) => x * 700), top: [{ app: 'Spotify', path: '/Applications/Spotify.app', down: 214_000, up: 6_000, blocked: false }, { app: 'Safari', path: '/Applications/Safari.app', down: 120_000, up: 14_000, blocked: false }, { app: 'Dropbox', path: '/Applications/Dropbox.app', down: 41_000, up: 16_000, blocked: false }], waiting: 2, canBlock: false }, usage: [{ label: 'Coding assistant · Weekly', percent: 81, resetsAt: now + 2 * 86_400_000 }], next: { title: 'Design review', start: now + 25 * 60_000 } };
      const view = async () => glanceLayout(inputs, gs, { list: [{ name: 'Quarterly report.pdf', path: '/Users/sam/Downloads/Quarterly report.pdf', size: 2_400_000, source: 'mail.example.com' }, { name: 'IMG_2041.HEIC', path: '/Users/sam/Downloads/IMG_2041.HEIC', size: 3_100_000 }, { name: 'setup.dmg', path: '/Users/sam/Downloads/setup.dmg', size: 88_000_000, source: 'example.org' }], total: 10 });
      return { show: async () => undefined, view, settings: async () => gs, setSettings: async (p: Partial<GlanceSettings>) => (gs = normalizeGlanceSettings({ ...gs, ...p }, 'darwin')), close: async () => undefined, fit: async () => undefined, run: async () => undefined, open: async () => undefined, openFile: async () => undefined, netRule: async () => undefined, netAsk: async () => undefined };
    })(),
    ...mockIslandTools(),
    ...mockAiUsage(),
    ...mockPim((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockFileKit(),
    ...mockNotes((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockGuide((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockControls((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockSettingsPlus(),
    ...mockAshforde((id) => featureStates(settings, 'darwin').get(id)?.on ?? false, (ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockNet(),
    ...mockSecurity((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockFw((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockSync(),
    ...mockNotesync((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockAgentTerm((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockPlatform(),
    lock: lockX.lock,
    ...mockScreen(),
    ...mockAccess((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockRdc((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockLink(HOME, (ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockMesh((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockStage((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockStudio((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockVoice((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    usage: mockUsage(),
    ...mockAwake(() => settings, (patch) => {
      Object.assign(settings, patch);
      listeners.get('settings-changed')?.forEach((cb) => (cb as (v: unknown) => void)(structuredClone(settings)));
    }, (ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    features: mockFeatures(() => settings, (patch) => {
      Object.assign(settings, patch);
      listeners.get('settings-changed')?.forEach((cb) => (cb as (v: unknown) => void)(structuredClone(settings)));
    }),
    ...mockTerminal(HOME, (ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args))),
    ...mockBrain(files, (ch, v) => listeners.get(ch)?.forEach((cb) => cb(v)), HOME),
    ...mockAgents(files, (ch, v) => listeners.get(ch)?.forEach((cb) => cb(v)), HOME),
    ...mockCu(),
    ...mockComponents((ch) => listeners.get(ch)?.forEach((cb) => (cb as () => void)())),
    ...mockUsageStats(() => settings, (patch) => {
      Object.assign(settings, patch);
      listeners.get('settings-changed')?.forEach((cb) => (cb as (v: unknown) => void)(structuredClone(settings)));
    }, (ch) => listeners.get(ch)?.forEach((cb) => (cb as () => void)())),
    ...mockPro((ch) => listeners.get(ch)?.forEach((cb) => (cb as () => void)())),
    ...mockAbilities((ch, v) => listeners.get(ch)?.forEach((cb) => cb(v))),
    ...mockPermissions(() => settings),
    preview: mockPreview(() => files, thumb),
    system: {
      info: async () => ({ platform: 'darwin', arch: 'arm64', osVersion: '15.4', appVersion: '0.1.0 (demo)', home: HOME, sep: '/' }),
      disks: async () => [{ mount: '/', label: 'Macintosh HD', total: 494 * 1024 ** 3, free: 61 * 1024 ** 3, system: true }],
      health: async () => ({
        cpuPercent: 23, cores: 10, cpuModel: 'Apple M3 Pro', memory: { total: 18 * 1024 ** 3, free: 5.2 * 1024 ** 3 }, uptimeSec: 3 * 86400 + 4000, loadAvg: [2.1, 2.4, 2.2],
        battery: { percent: 76, charging: false, health: 94, cycles: 212 },
        processes: [
          { pid: 812, name: 'Google Chrome Helper', cpu: 14.2, memory: 1.2 * 1024 ** 3 }, { pid: 455, name: 'Slack', cpu: 3.1, memory: 640 * MB },
          { pid: 1201, name: 'node', cpu: 8.4, memory: 420 * MB }, { pid: 990, name: 'Figma', cpu: 1.2, memory: 900 * MB }, { pid: 77, name: 'WindowServer', cpu: 6.0, memory: 300 * MB },
        ],
        awakeBlockers: ['Spotify (playing audio)', 'Keeper (keep awake)'],
        listening: [{ port: 5173, pid: 1201, name: 'node' }, { port: 5432, pid: 300, name: 'postgres' }],
      }),
      killProcess: async () => true,
      ejectAll: async () => ({ ejected: ['Backup', 'Untitled'], failed: [] }),
      wifiNetworks: async () => [{ ssid: 'Studio-5G', password: 'blue-otter-42' }],
      openExternal: async (u) => { window.open(u, '_blank'); },
    },
    capture: createMockCapture(),
    // The demo plays a Mac with Google Maps installed; links that would open an app open their web page instead.
    native: (() => {
      const inst: Record<string, string> = { googleMaps: '/Applications/Google Maps.app', appleMaps: '/System/Applications/Maps.app', appleWeather: '/System/Applications/Weather.app', findMy: '/System/Applications/FindMy.app', appleCalendar: '/System/Applications/Calendar.app', faceTime: '/System/Applications/FaceTime.app', appleMessages: '/System/Applications/Messages.app' };
      return {
        open: async (kind, params) => {
          const tries = planNative(kind, 'darwin', inst, settings.nativeApps?.[kind], params).tries;
          const web = tries.find((t) => t.launch.how === 'url' && t.launch.url.startsWith('https:'));
          if (web && web.launch.how === 'url') window.open(web.launch.url, '_blank');
          return { ok: !!tries[0], app: tries[0]?.name };
        },
        apps: async () => NATIVE_KINDS.map((kind) => ({ kind, label: KIND_LABEL[kind], choices: nativeChoices(kind, 'darwin', inst), auto: autoChoice(kind, 'darwin', inst), pick: settings.nativeApps?.[kind] || 'auto' })),
      };
    })(),
    weather: {
      get: async () => island.weather ?? null,
      search: async (n) => [{ name: n.charAt(0).toUpperCase() + n.slice(1), lat: 51.5, lon: -0.12, country: 'United Kingdom' }],
    },
    settings: {
      get: async () => structuredClone(settings),
      set: async (patch) => {
        Object.assign(settings, { ...patch, island: { ...settings.island, ...(patch.island ?? {}) } });
        return structuredClone(settings);
      },
      setSecret: async () => true,
      hasSecret: async () => false,
      pickFolder: async () => `${HOME}/Projects`,
      pickFiles: async () => [`${HOME}/Movies/Lisbon trip.mov`],
    },
    prefs: {
      // The demo's shortcuts: the clash Settings → Shortcuts warns about, once.
      shortcuts: async () => [
        { owner: 'Quick Search', accelerator: settings.quickSearchShortcut, state: 'ok' as const },
        { owner: 'Copy text from screen', accelerator: settings.island.captureShortcut, state: 'ok' as const },
        { owner: 'Studio: record', accelerator: 'CommandOrControl+Shift+9', state: 'ok' as const },
        { owner: 'Clipboard history', accelerator: settings.island.pasteShortcut, state: 'ok' as const },
        { owner: 'Screenshot', accelerator: 'CommandOrControl+Alt+S', state: 'taken' as const, takenBy: 'another app' },
      ],
      saveFile: async (name: string) => `${HOME}/Documents/${name}`,
      openFile: async () => null,
    },
    convert: {
      run: async (job) => {
        const first = job.inputs[0] ?? `${HOME}/file`;
        const dir = first.replace(/\/[^/]+$/, '') + '/' + (first.split('/').pop() ?? '').replace(/\.[^.]+$/, '') + ' (Keeper)';
        const ext = 'format' in job.op ? job.op.format : job.op.tool.startsWith('pdf') ? 'pdf' : job.op.tool.startsWith('video') ? 'mp4' : (first.split('.').pop() ?? 'bin');
        await delay(0, 1200);
        if (job.op.tool === 'file.checksum' || job.op.tool === 'file.verify') {
          const checksums = job.inputs.map((p) => ({ path: p, algo: 'sha256' as const, hash: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9' }));
          return { outputs: [], checksums, verified: job.op.tool === 'file.verify' ? true : undefined, message: job.op.tool === 'file.verify' ? 'The checksum matches — the file is intact.' : undefined };
        }
        if (job.op.tool === 'video.info') return { outputs: [], details: `${first.split('/').pop()}\nLength 6:52 · 8120 kb/s overall · mov,mp4,m4a\nVideo: h264 1920×1080 · 29.97 fps · yuv420p · 7860 kb/s\nAudio: aac · 48000 Hz · stereo · 256 kb/s\ncreation_time: 2026-10-12T09:41:00.000000Z` };
        if (job.op.tool === 'audio.transcribe') return { outputs: [`${dir}/Meeting transcript.${job.op.format === 'srt' ? 'srt' : job.op.format === 'vtt' ? 'vtt' : 'txt'}`], details: 'Thanks everyone for joining. Let us start with the launch plan for November, then budget, then the open questions from last week.' };
        return { outputs: job.inputs.map((p) => `${dir}/${(p.split('/').pop() ?? 'file').replace(/\.[^.]+$/, '')}.${ext}`), message: /compress|preset/.test(job.op.tool) ? 'Saved 1.8 GB (76% smaller)' : job.op.tool === 'image.faces' ? 'Hid 3 faces' : job.op.tool === 'pdf.redact' ? 'Removed 4 matches on 2 pages; document details were stripped too' : undefined };
      },
      capabilities: async () => ({ ffmpeg: true, qpdf: false, sips: true, bgRemoval: true, pdfRender: true, office: true, speech: true, transcribe: true }),
      duration: async () => 412,
      pageCount: async () => 12,
      mediaInfo: async () => ({ duration: 412, subtitles: 0, metadata: {}, video: { codec: 'h264', width: 1920, height: 1080, fps: 29.97 }, audio: { codec: 'aac', sampleRate: 48000, channels: 'stereo' } }),
      phoneBackups: async () => ({ folders: ['~/Library/Application Support/MobileSync/Backup'], backups: [{ id: '00008110-001A', path: '/Users/me/Library/Application Support/MobileSync/Backup/00008110-001A', deviceName: 'Ana’s iPhone', model: 'iPhone 15 Pro', productType: 'iPhone16,1', iosVersion: '19.1', lastBackup: Date.now() - 86_400_000 * 3, size: 48_300_000_000, encrypted: true }] }),
      displays: async () => ({ displays: [{ id: 'win:0', name: 'Studio monitor', external: true, brightness: 60, contrast: 50, volume: 30 }] }),
      setDisplay: async () => undefined,
      pdfThumbs: async () => Array.from({ length: 5 }, (_, i) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='160'><rect width='120' height='160' fill='white'/><text x='60' y='90' font-size='40' text-anchor='middle' fill='#555'>${i + 1}</text></svg>`)}`),
      pdfFields: async () => [{ name: 'Full name', type: 'text', value: '' }, { name: 'Date of birth', type: 'text', value: '' }, { name: 'I agree', type: 'checkbox', value: '' }, { name: 'Country', type: 'dropdown', value: '', options: ['Estonia', 'Germany', 'United Kingdom'] }],
      downloadVideo: async (o) => { await delay(0, 2500); return [`${HOME}/Downloads/Keeper Videos/Launch keynote [x1y2z3].${o.quality === 'audio' ? 'mp3' : 'mp4'}`]; },
      cancelDownload: async () => undefined,
      saveRecording: async () => `${HOME}/Music/Keeper Recordings/Recording 2026-10-31 12.40.m4a`,
      webToPdf: async (url) => { await delay(0, 1500); return `${HOME}/Downloads/${url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]} 2026-10-31.pdf`; },
    },
    library: {
      status: async () => ({ indexing: false, files: files.length, lastScan: now - 120_000, ocrPending: 0 }),
      rescan: async () => { await delay(0, 800); },
      speedUp: async () => undefined,
      totals: async () => {
        const t = {} as Record<FileKind, { count: number; size: number }>;
        for (const k of ['image', 'video', 'audio', 'document', 'archive', 'installer', 'app', 'code', 'other'] as FileKind[]) t[k] = { count: 0, size: 0 };
        for (const f of files) { t[f.kind].count += 37; t[f.kind].size += f.size * 37; }
        return t;
      },
      typeCounts: async (under) => typeCounts(files, under),
      recent: async (n, kind) => files
        .filter((f) => !kind || (kind === 'screenshot' ? f.screenshot : kind === 'download' ? f.root === 'Downloads' : f.kind === kind))
        .sort((a, b) => b.mtime - a.mtime).slice(0, n),
      list: async (o) => {
        let l = files.filter((f) => (!o.kind || f.kind === o.kind) && (!o.screenshot || f.screenshot) && (!o.fromWeb || !!f.source) && (!o.under || isUnder(f.path, o.under)) && (!o.root || f.root === o.root) && (!o.source || f.source?.id === o.source) && (!o.tag || f.tags?.includes(o.tag)));
        const dir = o.desc === false ? 1 : -1;
        const key = o.sort ?? 'date';
        l = l.sort((a, b) => key === 'name' ? a.name.localeCompare(b.name) * -dir : key === 'size' ? (a.size - b.size) * dir : key === 'kind' ? a.kind.localeCompare(b.kind) : (a.mtime - b.mtime) * dir);
        return delay(o.limit ? l.slice(0, o.limit) : l, 60);
      },
      search: async (text, limit = 200) => {
        const parsed = parseQuery(text);
        const dupePaths = new Set(dupes().flatMap((g) => g.files.map((f) => f.path)));
        return delay({ parsed, hits: search(files, parsed.query, { duplicatePaths: dupePaths }).slice(0, limit) }, 40);
      },
      bySource: async () => {
        const m = new Map<string, { id: string; name: string; count: number; size: number; latest: number }>();
        for (const f of files) if (f.source) {
          const g = m.get(f.source.id) ?? { id: f.source.id, name: f.source.name, count: 0, size: 0, latest: 0 };
          g.count++; g.size += f.size; g.latest = Math.max(g.latest, f.mtime); m.set(f.source.id, g);
        }
        return [...m.values()].sort((a, b) => b.count - a.count);
      },
      tags: async () => [{ tag: 'work', count: 3 }, { tag: 'taxes', count: 2 }, { tag: 'important', count: 1 }],
      setTags: async (p, tags) => { const f = byPath(p); if (f) f.tags = tags; },
      inspect: async (p) => byPath(p) ?? null,
      readText: async (paths) => paths.map((p) => ({ path: p, text: byPath(p)?.text ?? '' })),
      largeFiles: async (minMb) => files.filter((f) => f.size >= minMb * MB).sort((a, b) => b.size - a.size),
    },
    files: {
      browse: async (dir, showHidden) => lockX.adjust(dir, browse(dir), !!showHidden),
      thumbnail: async (p) => { const f = byPath(p); return f ? thumb(f) : null; },
      icon: async () => null,
      open: async () => undefined,
      openWith: async () => undefined,
      reveal: async () => undefined,
      copyPaths: async (paths) => { await navigator.clipboard?.writeText(paths.join('\n')).catch(() => undefined); },
      copyText: async (t) => { await navigator.clipboard?.writeText(t).catch(() => undefined); },
      trash: async (paths) => {
        let freed = 0;
        for (const p of paths) { const i = files.findIndex((f) => f.path === p); if (i >= 0) { freed += files[i].size; files.splice(i, 1); } }
        return delay({ ...ok, freed, removed: paths.length, journalId: 'demo' }, 400);
      },
      move: async (paths) => ({ ...ok, removed: paths.length }),
      copy: async (paths) => ({ ...ok, removed: paths.length }),
      conflicts: async () => [],
      rename: async (p, name) => { const f = byPath(p); if (f) { f.name = name; f.path = p.replace(/[^/]+$/, name); } return p.replace(/[^/]+$/, name); },
      previewRename: async (paths, steps) => previewRename(paths.map((p) => byPath(p)!).filter(Boolean), steps),
      applyRename: async (paths) => ({ ...ok, removed: paths.length }),
      newFolder: async (dir, name) => `${dir}/${name}`,
      compress: async (paths) => `${paths[0]}.zip`,
      startDrag: () => undefined,
      readImage: async (p) => { const f = byPath(p); return (f && thumb(f)) ?? DEMO_SHOT; },
      writeImage: async (p) => p.replace(/(\.[^.]+)?$/, ' (edited).png'),
      copyImage: async () => undefined,
    },
    duplicates: { scan: async () => delay(dupes(), 900) },
    cleanup: {
      scan: async () => delay(cleanupGroups(), 1200),
      clean: async (groups) => {
        const all = cleanupGroups();
        const freed = groups.reduce((n, g) => n + (all.find((x) => x.id === g.id)?.size ?? 0), 0);
        return delay({ ...ok, freed, removed: groups.length, journalId: 'demo' }, 1000);
      },
      details: async (id, dir) => {
        const g = cleanupGroups().find((x) => x.id === id);
        if (!g) return [];
        if (g.items) return g.items.map((f) => ({ path: f.path, name: f.name, isDir: false, size: f.size, files: 1, mtime: f.mtime }));
        const base = dir ?? g.locations[0].replace('~', HOME);
        const names = dir ? ['data_0', 'data_1', 'index', 'f_000a1c', 'f_000b2d', 'journal.log'] : ['Default', 'Profile 1', 'GPUCache', 'Code Cache', 'ShaderCache', 'Service Worker', 'old-session', 'blob_storage'];
        return delay(names.map((n, i) => ({
          path: `${base}/${n}`, name: n, isDir: !n.includes('.') && !n.startsWith('f_'), size: Math.round((g.size / (i + 2)) / (dir ? 4 : 1)),
          files: dir ? 1 : 40 + i * 13, mtime: now - (i * 9 + 1) * DAY,
        })), 250);
      },
    },
    space: { tree: async (p) => delay(spaceTree(p), 300) },
    startup: {
      list: async () => [
        { id: 'discord', name: 'Discord', command: '/Applications/Discord.app', enabled: true, scope: 'user', source: 'Login Items', impact: 'high', publisher: 'Discord Inc.' },
        { id: 'spotify', name: 'Spotify', command: '/Applications/Spotify.app', enabled: true, scope: 'user', source: 'Login Items', impact: 'medium' },
        { id: 'teams', name: 'Microsoft Teams', command: 'com.microsoft.teams2.launcher', enabled: false, scope: 'user', source: 'LaunchAgents', impact: 'high' },
        { id: 'docker', name: 'Docker', command: 'com.docker.helper', enabled: true, scope: 'system', source: 'LaunchDaemons', impact: 'high' },
        { id: 'onedrive', name: 'OneDrive', command: '/Applications/OneDrive.app', enabled: true, scope: 'user', source: 'Login Items', impact: 'medium' },
      ],
      toggle: async function (id, enabled) { const l = await this.list(); return l.map((i) => (i.id === id ? { ...i, enabled } : i)); },
    },
    apps: {
      list: async () => [
        { id: 'figma', name: 'Figma', path: '/Applications/Figma.app', version: '125.4', size: 512 * MB, lastUsed: now - 2 * DAY, system: false },
        { id: 'xcode', name: 'Xcode', path: '/Applications/Xcode.app', version: '17.0', size: 12.4 * 1024 * MB, lastUsed: now - 210 * DAY, system: false },
        { id: 'garageband', name: 'GarageBand', path: '/Applications/GarageBand.app', version: '10.4', size: 2.1 * 1024 * MB, lastUsed: now - 400 * DAY, system: false },
        { id: 'slack', name: 'Slack', path: '/Applications/Slack.app', version: '4.45', size: 410 * MB, lastUsed: now - 3600_000, system: false },
        { id: 'safari', name: 'Safari', path: '/Applications/Safari.app', version: '19.0', size: 14 * MB, lastUsed: now - 600_000, system: true },
      ],
      uninstall: async () => delay({ ...ok, removed: 1 }, 600),
    },
    protection: {
      check: async () => delay({
        score: 88, checkedAt: now, checks: [
          { id: 'gatekeeper', name: 'Gatekeeper', description: 'Only lets apps from identified developers open.', status: 'ok', weight: 3 },
          { id: 'xprotect', name: 'XProtect', description: 'Built-in malware signatures.', status: 'ok', detail: 'Definitions updated 2 days ago', weight: 3 },
          { id: 'sip', name: 'System Integrity Protection', description: 'Protects system files from modification.', status: 'ok', weight: 3 },
          { id: 'firewall', name: 'Firewall', description: 'Blocks unwanted incoming connections.', status: 'off', fix: 'System Settings → Network → Firewall', weight: 2 },
          { id: 'filevault', name: 'FileVault', description: 'Encrypts your disk.', status: 'ok', weight: 2 },
          { id: 'updates', name: 'Automatic updates', description: 'Installs security fixes as they come out.', status: 'warn', detail: 'Security responses are off', weight: 2 },
        ],
      }, 700),
    },
    rules: {
      list: async () => structuredClone(settings.rules),
      save: async (r) => { const i = settings.rules.findIndex((x) => x.id === r.id); if (i >= 0) settings.rules[i] = r; else settings.rules.push(r); return structuredClone(settings.rules); },
      remove: async (id) => { settings.rules = settings.rules.filter((r) => r.id !== id); return structuredClone(settings.rules); },
      plan: async (id) => (id === 'screenshots-by-month' ? files.filter((f) => f.screenshot).map((f) => ({ file: f, action: rules[1].action, to: `${HOME}/Pictures/Screenshots/2026-10/${f.name}` })) : id === 'old-installers' ? files.filter((f) => f.kind === 'installer').map((f) => ({ file: f, action: { type: 'trash' as const } })) : []),
      run: async () => delay({ ...ok, removed: 3 }, 500),
    },
    search: {
      everything: async (q) => (q.trim() ? { groups: [
        { kind: 'mail', label: 'Mail', hits: [{ kind: 'mail', id: 'm1', title: `Re: ${q}`, detail: 'Alice Martin', when: now - 3600_000, route: 'mail' }] },
        { kind: 'event', label: 'Events', hits: [{ kind: 'event', id: 'e1', title: `${q} review`, detail: 'Room 4', when: now + 86_400_000, route: 'calendar' }] },
        { kind: 'feature', label: 'Keeper', hits: [{ kind: 'feature', id: 'weather', title: 'Weather', detail: 'On · Forecasts for your places', route: 'weather' }] },
      ], missed: [] } : { groups: [], missed: [] }),
      open: async () => undefined,
      launch: async () => ({ ok: true }),
    },
    history: {
      list: async () => [
        { id: 'h1', at: now - 3600_000, title: 'Cleaned 4 groups', ops: [{ type: 'delete', from: '~/Library/Caches', size: 6.4 * 1024 * MB }], freed: 6.4 * 1024 * MB, undoable: false },
        { id: 'h2', at: now - 86_400_000, title: 'Filed 6 screenshots into monthly folders', ops: [{ type: 'move', from: `${HOME}/Desktop/a.png`, to: `${HOME}/Pictures/Screenshots/2026-10/a.png`, size: MB }], freed: 0, undoable: true },
        { id: 'h3', at: now - 2 * 86_400_000, title: 'Moved 2 duplicates to the Trash', ops: [{ type: 'trash', from: `${HOME}/Downloads/x (1).pdf`, size: 2 * MB }], freed: 2 * MB, undoable: true },
      ],
      undo: async () => ({ restored: 1, failed: [] }),
    },
    ai: {
      ask: async (history) => delay({
        text: history.length ? 'You have a few easy wins. The Figma and Zoom installers are already installed apps, the brand kit zip sits next to its unpacked folder, and the 1.9 GB old-photos.zip in your Documents archive has not been opened in almost two years — worth a look before removing.' : '',
        suggestions: [
          { path: `${HOME}/Downloads/Figma-125.4.dmg`, reason: 'Installer for an app you already have', size: 412 * MB, safety: 'safe' },
          { path: `${HOME}/Downloads/brand-kit-final.zip`, reason: 'Already unpacked next to it', size: 184 * MB, safety: 'safe' },
          { path: `${HOME}/Documents/Archive/old-photos.zip`, reason: 'Large and untouched for 2 years — check it is backed up first', size: 1900 * MB, safety: 'review' },
        ],
        search: 'zips older than 1 year',
      }, 900),
    },
    island: {
      state: async () => structuredClone(island),
      addToShelf: async (paths) => { for (const p of paths) { const f = byPath(p); if (f && !island.shelf.some((s) => s.path === p)) island.shelf.push(f); } },
      removeFromShelf: async (p) => { island.shelf = island.shelf.filter((f) => f.path !== p); },
      clearShelf: async () => { island.shelf = []; },
      copyClip: async () => undefined,
      pinClip: async (id) => { const c = island.clips.find((x) => x.id === id); if (c) c.pinned = !c.pinned; },
      removeClip: async (id) => { island.clips = island.clips.filter((c) => c.id !== id); },
      clearClips: async () => { island.clips = island.clips.filter((c) => c.pinned); },
      focus: async (action, minutes) => {
        const f = island.focus;
        if (action === 'start') Object.assign(f, { mode: 'focus', endsAt: Date.now() + (minutes ?? f.focusMin) * 60_000, pausedLeft: undefined, focusMin: minutes ?? f.focusMin });
        if (action === 'stop') Object.assign(f, { mode: 'idle', endsAt: 0, pausedLeft: undefined });
        if (action === 'pause') f.pausedLeft = f.endsAt - Date.now();
        if (action === 'resume' && f.pausedLeft) { f.endsAt = Date.now() + f.pausedLeft; f.pausedLeft = undefined; }
        return structuredClone(f);
      },
      keepAwake: async (on, options) => (island.keepAwake = on ? { on, since: Date.now(), options, until: options?.minutes ? Date.now() + options.minutes * 60_000 : options?.until, reason: options?.whileApp ? `While ${options.whileApp} is running` : undefined } : { on: false }),
      presentation: async (on) => on,
      media: async (a) => { if (a === 'toggle' && island.nowPlaying) island.nowPlaying.playing = !island.nowPlaying.playing; },
      openAgent: async () => undefined,
      transcribe: async () => 'This is a demo transcription.',
      typeText: async () => undefined,
      dismiss: async (id) => { island.alerts = island.alerts.filter((a) => a.id !== id); },
      setExpanded: () => undefined,
      ...islandX.island,
    } as KeeperApi['island'],
    // Arrange mode and the wallpaper tint for widgets, then wallpaper & vibes.
    widgets: { ...islandX.widgets, arrange: async (on: boolean) => on, arranging: async () => false, tint: async () => null },
    ...mockAmbience((ch, ...args) => listeners.get(ch)?.forEach((cb) => (cb as (...a: unknown[]) => void)(...args)), HOME),
    on: ((channel: string, cb: (v: unknown) => void) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(cb);
      listeners.set(channel, set);
      return () => set.delete(cb);
    }) as unknown as KeeperApi['on'],
  };
}
