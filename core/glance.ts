// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The glance: what the owl in the menu bar (the tray icon) shows when it is
// clicked or hovered. A header with one line of status ("All good", or the one
// thing that needs attention), four equal reading tiles (weather, disk, this
// computer, network), a Keep Awake switch and a few rows of the moment (AI
// usage, the next event, a tip), four quick actions with the rest under More,
// and the three newest downloads. This file turns raw readings into tiles and
// rows with short values that never wrap; electron/services/glance.ts gathers
// the readings (only while the glance is open) and src/glance/Glance.tsx draws it.

import type { GlanceNet } from './api-fw';
import { onlineLine, rateText } from './fw/live';
import { memoryTone, type MemoryPressure } from './memory';

export const GLANCE_CARDS = ['weather', 'storage', 'system', 'network', 'awake', 'usage', 'calendar', 'tip'] as const;
export type GlanceCardId = (typeof GLANCE_CARDS)[number];

export const GLANCE_ACTIONS = ['quickSearch', 'screenshot', 'captureText', 'keepAwake', 'dictation', 'stage', 'cleanup', 'terminal', 'launcher', 'recordScreen', 'colour', 'clipboard'] as const;
export type GlanceActionId = (typeof GLANCE_ACTIONS)[number];

/** `short` is what fits under the icon in the glance; `label` is its full name (tooltip, Settings). */
export const ACTION_INFO: Record<GlanceActionId, { label: string; short: string; icon: string }> = {
  quickSearch: { label: 'Quick Search', short: 'Search', icon: 'search' },
  screenshot: { label: 'Screenshot', short: 'Screenshot', icon: 'camera' },
  captureText: { label: 'Copy Text', short: 'Copy Text', icon: 'text' },
  keepAwake: { label: 'Keep Awake', short: 'Awake', icon: 'coffee' },
  dictation: { label: 'Dictation', short: 'Dictation', icon: 'mic' },
  stage: { label: 'Stage', short: 'Stage', icon: 'eye' },
  cleanup: { label: 'Clean Up', short: 'Clean Up', icon: 'trash' },
  terminal: { label: 'Terminal', short: 'Terminal', icon: 'terminal' },
  launcher: { label: 'Tools', short: 'Tools', icon: 'grid' },
  recordScreen: { label: 'Record Screen', short: 'Record', icon: 'video' },
  colour: { label: 'Pick a Colour', short: 'Colour', icon: 'palette' },
  clipboard: { label: 'Clipboard', short: 'Clipboard', icon: 'clipboard' },
};

/** How many quick actions show as buttons; the rest are one click away under More. */
export const PINNED_ACTIONS = 4;

/** The four reading tiles; the other cards are rows under them. */
export const TILE_CARDS = ['weather', 'storage', 'system', 'network'] as const satisfies readonly GlanceCardId[];

export const GLANCE_SECTIONS = ['stats', 'network', 'actions', 'downloads'] as const;
export type GlanceSectionId = (typeof GLANCE_SECTIONS)[number];
export const SECTION_INFO: Record<GlanceSectionId, { label: string; help: string }> = {
  stats: { label: 'Readings', help: 'Weather, disk, this computer and the network.' },
  network: { label: 'Network', help: 'Apps online now, the busiest three and prompts waiting.' },
  actions: { label: 'Quick actions', help: 'Four buttons; the rest are under More.' },
  downloads: { label: 'Recent downloads', help: 'The three newest files in Downloads.' },
};

export const CARD_INFO: Record<GlanceCardId, { label: string }> = {
  weather: { label: 'Weather' }, storage: { label: 'Storage' }, system: { label: 'This computer' }, network: { label: 'Network' },
  awake: { label: 'Keep Awake' }, usage: { label: 'AI usage' }, calendar: { label: 'Next event' }, tip: { label: 'Did you know' },
};

export interface GlanceSettings {
  cards: GlanceCardId[];
  /** the pinned quick actions (up to PINNED_ACTIONS), in order */
  actions: GlanceActionId[];
  /** which parts show */
  sections: Record<GlanceSectionId, boolean>;
  /** show the glance when the pointer rests on the owl (macOS menu bar) */
  hover: boolean;
}

export function defaultGlanceSettings(platform: string = process.platform): GlanceSettings {
  return {
    // The tip is one click away in Settings: less to read by default.
    cards: GLANCE_CARDS.filter((c) => c !== 'tip'),
    actions: ['quickSearch', 'screenshot', 'captureText', 'clipboard'],
    sections: { stats: true, network: true, actions: true, downloads: true },
    hover: platform === 'darwin',
  };
}

export function normalizeGlanceSettings(g: Partial<GlanceSettings> | undefined, platform: string = process.platform): GlanceSettings {
  const d = defaultGlanceSettings(platform);
  const pick = <T extends string>(list: unknown, known: readonly T[], fallback: T[]): T[] => (Array.isArray(list) ? [...new Set(list.filter((x): x is T => known.includes(x as T)))] : fallback);
  return {
    cards: pick(g?.cards, GLANCE_CARDS, d.cards),
    actions: pick(g?.actions, GLANCE_ACTIONS, d.actions).slice(0, PINNED_ACTIONS),
    sections: Object.fromEntries(GLANCE_SECTIONS.map((k) => [k, typeof g?.sections?.[k] === 'boolean' ? g.sections[k] : d.sections[k]])) as Record<GlanceSectionId, boolean>,
    hover: typeof g?.hover === 'boolean' ? g.hover : d.hover,
  };
}

/** The quick actions under More: every one not pinned (Keep Awake has its own switch while that row shows). */
export function moreActions(s: GlanceSettings): GlanceActionId[] {
  return GLANCE_ACTIONS.filter((a) => !s.actions.includes(a) && !(a === 'keepAwake' && s.cards.includes('awake')));
}

/** What electron/services/glance.ts reads; every part optional (a part that cannot be read is left out). */
export interface GlanceInputs {
  now: number;
  weather?: { place: string; temp: number; units: 'c' | 'f'; summary: string; nowcast?: string };
  disk?: { total: number; free: number; name: string };
  system?: {
    cpu: number; memUsed: number; memTotal: number; battery?: { percent: number; charging: boolean; minutesLeft?: number };
    /** macOS memory pressure; colours the memory reading there instead of how full it is */
    memPressure?: MemoryPressure;
    /** "Cached 3.8 GB · Swap 24.6 GB · Compressed 16.4 GB" */
    memDetail?: string;
  };
  network?: { downBps?: number; upBps?: number; wifi?: string; vpn?: string; mesh?: string; online: boolean };
  awake?: { on: boolean; until?: number; reason?: string };
  usage?: { label: string; percent: number; resetsAt?: number }[];
  /** the AI usage tracker's accounts (Keeper → Usage), when any are tracked; shown instead of `usage` */
  aiUsage?: { value: string; detail: string; usedPercent?: number; tone: 'ok' | 'warn' | 'bad' };
  next?: { title: string; start: number; link?: string };
  tipIndex?: number;
  /** apps online and the busiest ones (the firewall's monitor), only while the summary is open */
  net?: GlanceNet;
}

export interface GlanceCard {
  id: GlanceCardId;
  title: string;
  value: string;
  detail?: string;
  /** 0–100 for a bar (storage, memory, usage) */
  bar?: number;
  tone?: 'ok' | 'warn' | 'bad';
  /** more on hover */
  hint?: string;
  /** the page it opens (a route for showMain), or an action */
  open: string;
}

export const TIPS = [
  'Drop files on the owl in the menu bar to put them on the shelf.',
  'Type a question in Quick Search: “photos from Lisbon last summer”.',
  'Copy Text reads the words in any part of the screen, even in pictures.',
  'Clean Up finds duplicates and large old files, and puts nothing in the Trash without asking.',
  'Keep Awake can follow an app: it stays on while a download or a render runs.',
  'Stage hides the Dock, desktop icons and notifications while you present.',
  'Every file Keeper downloads remembers where it came from.',
  'The Island shows a timer, music and calls around the notch.',
];

const GB = 1024 ** 3;
const fmtBytes = (n: number) => (n >= 1024 ** 4 ? `${(n / 1024 ** 4).toFixed(1)} TB` : n >= 100 * GB ? `${Math.round(n / GB)} GB` : `${(n / GB).toFixed(1)} GB`);
export const fmtRate = (bps: number) => (bps >= 1024 ** 2 ? `${(bps / 1024 ** 2).toFixed(1)} MB/s` : bps >= 1024 ? `${Math.round(bps / 1024)} KB/s` : `${Math.round(bps)} B/s`);
const fmtLeft = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The cards to show, in the person's order; a card with nothing to say is left out. */
export function glanceCards(i: GlanceInputs, chosen: GlanceCardId[]): GlanceCard[] {
  const out: GlanceCard[] = [];
  for (const id of chosen) {
    if (id === 'weather' && i.weather) {
      out.push({ id, title: i.weather.place, value: `${Math.round(i.weather.temp)}°${i.weather.units.toUpperCase()}`, detail: i.weather.nowcast || i.weather.summary, open: 'weather' });
    } else if (id === 'storage' && i.disk && i.disk.total > 0) {
      const used = Math.round(((i.disk.total - i.disk.free) / i.disk.total) * 100);
      out.push({ id, title: i.disk.name, value: `${fmtBytes(i.disk.free)} free`, detail: `of ${fmtBytes(i.disk.total)}`, bar: used, tone: used >= 95 ? 'bad' : used >= 85 ? 'warn' : 'ok', open: 'space' });
    } else if (id === 'system' && i.system) {
      const mem = i.system.memTotal ? Math.round((i.system.memUsed / i.system.memTotal) * 100) : 0;
      const b = i.system.battery;
      const batt = b ? ` · battery ${Math.round(b.percent)}%${b.charging ? ', charging' : b.minutesLeft ? `, ${fmtLeft(b.minutesLeft * 60_000)} left` : ''}` : '';
      const memTone = i.system.memPressure ? memoryTone({ used: i.system.memUsed, total: i.system.memTotal, pressure: i.system.memPressure }) : mem >= 92 ? 'warn' : 'ok';
      const tone = memTone === 'bad' ? 'bad' : i.system.cpu >= 90 || memTone === 'warn' ? 'warn' : 'ok';
      const hint = [`Memory ${fmtBytes(i.system.memUsed)} of ${fmtBytes(i.system.memTotal)} in use`, i.system.memDetail, i.system.memPressure ? `pressure ${i.system.memPressure}` : ''].filter(Boolean).join(' · ');
      out.push({ id, title: 'This computer', value: `CPU ${Math.round(i.system.cpu)}%`, detail: `memory ${mem}%${batt}`, bar: mem, tone, hint, open: 'health' });
    } else if (id === 'network' && i.network) {
      const n = i.network;
      const where = n.vpn ? `VPN ${n.vpn}` : n.mesh ? `Mesh ${n.mesh}` : n.wifi ? n.wifi : n.online ? 'Online' : 'Offline';
      const rates = n.downBps !== undefined && n.upBps !== undefined ? `↓ ${fmtRate(n.downBps)} ↑ ${fmtRate(n.upBps)}` : n.online ? 'Connected' : 'No connection';
      out.push({ id, title: 'Network', value: rates, detail: where, tone: n.online ? 'ok' : 'bad', open: 'netactivity' });
    } else if (id === 'awake' && i.awake) {
      const a = i.awake;
      out.push({ id, title: 'Keep Awake', value: a.on ? (a.until ? `${fmtLeft(a.until - i.now)} left` : 'On, no end') : 'Off', detail: a.on ? a.reason : 'The computer can sleep as usual', open: 'action:keepAwake' });
    } else if (id === 'usage' && i.aiUsage) {
      out.push({ id, title: 'AI usage', value: i.aiUsage.value, detail: i.aiUsage.detail, bar: i.aiUsage.usedPercent, tone: i.aiUsage.tone, open: 'aiusage' });
    } else if (id === 'usage' && i.usage?.length) {
      const top = [...i.usage].sort((a, b) => b.percent - a.percent)[0];
      out.push({ id, title: 'AI usage', value: `${Math.round(top.percent)}% used`, detail: `${top.label}${top.resetsAt ? ` · resets ${clock(top.resetsAt)}` : ''}`, bar: Math.round(top.percent), tone: top.percent >= 90 ? 'bad' : top.percent >= 75 ? 'warn' : 'ok', open: 'island' });
    } else if (id === 'calendar' && i.next && i.next.start >= i.now - 30 * 60_000) {
      const inMin = Math.round((i.next.start - i.now) / 60_000);
      out.push({ id, title: 'Next', value: i.next.title, detail: inMin <= 0 ? 'Now' : inMin < 60 ? `In ${inMin} min` : clock(i.next.start), open: i.next.link ? `link:${i.next.link}` : 'island' });
    } else if (id === 'tip') {
      out.push({ id, title: 'Did you know', value: TIPS[Math.abs(i.tipIndex ?? Math.floor(i.now / 3_600_000)) % TIPS.length], open: 'home' });
    }
  }
  return out;
}

// ---------------------------------------------------------------- short formats
// Values in the glance sit in fixed-width tiles and rows: these keep them to a
// few characters so they never wrap or get cut off.

/** "96 GB", "5.2 GB", "512 MB", "1.4 TB": whole numbers from 10 up, one decimal below. */
export function shortBytes(n: number): string {
  const units: [number, string][] = [[1024 ** 4, 'TB'], [1024 ** 3, 'GB'], [1024 ** 2, 'MB'], [1024, 'KB']];
  const v = Math.max(0, n || 0);
  for (const [u, name] of units) {
    if (v >= u * 0.95 || name === 'KB') {
      const x = v / u;
      const s = x >= 9.95 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, '');
      return `${name === 'KB' && x > 0 && x < 1 ? '1' : s} ${name}`;
    }
  }
  return '0 KB';
}

/** Both directions in one unit, the larger one's: "↓34 ↑2 KB/s", "↓3.1 ↑0.2 MB/s". */
export function shortRates(downBps: number, upBps: number): string {
  const d = Math.max(0, downBps || 0);
  const u = Math.max(0, upBps || 0);
  const top = Math.max(d, u);
  const [div, unit] = top >= 1024 ** 2 * 0.95 ? [1024 ** 2, 'MB/s'] : top >= 1024 ? [1024, 'KB/s'] : [1, 'B/s'];
  const f = (x: number) => { const v = x / div; return v === 0 ? '0' : unit === 'MB/s' && v < 9.95 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)); };
  return `↓${f(d)} ↑${f(u)} ${unit}`;
}

/** "7°C" */
export const shortTemp = (temp: number, units: 'c' | 'f') => `${Math.round(temp)}°${units.toUpperCase()}`;

/**
 * A file name cut in the middle so its start and its type stay readable:
 * "holiday-photos-lis…export.zip". Names that fit are left as they are.
 */
export function middleTruncate(name: string, max = 30): string {
  const chars = [...name];
  if (chars.length <= max) return name;
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] ?? '';
  const tail = Math.min(Math.max(ext.length + 6, Math.floor(max / 3)), max - 4);
  const head = max - 1 - tail;
  return `${chars.slice(0, head).join('').trimEnd()}…${chars.slice(chars.length - tail).join('').trimStart()}`;
}

// ---------------------------------------------------------------- tiles, rows and the status line

export interface GlanceTile {
  id: (typeof TILE_CARDS)[number];
  /** small, above the value: "Darmstadt", "Main disk" */
  label: string;
  /** one short line: "7°C", "96 GB free", "CPU 95%", "↓34 ↑2 KB/s" */
  value: string;
  /** one short line under it: "Overcast", "of 926 GB", "Memory 85%", "Online" */
  sub: string;
  /** 0–100 for the bar, when there is an amount to show */
  bar?: number;
  tone: 'ok' | 'warn' | 'bad';
  /** the whole story, for the tooltip and screen readers */
  hint: string;
  open: string;
}

/** The reading tiles, in the person's order. */
export function glanceTiles(i: GlanceInputs, chosen: GlanceCardId[]): GlanceTile[] {
  const out: GlanceTile[] = [];
  const cards = new Map(glanceCards(i, chosen.filter((c) => (TILE_CARDS as readonly string[]).includes(c))).map((c) => [c.id, c]));
  for (const id of TILE_CARDS.filter((t) => chosen.includes(t))) {
    const c = cards.get(id);
    if (!c) continue;
    if (id === 'weather' && i.weather) {
      const w = i.weather;
      out.push({ id, label: w.place, value: shortTemp(w.temp, w.units), sub: w.summary, tone: 'ok', hint: [`${w.place}: ${shortTemp(w.temp, w.units)}, ${w.summary}`, w.nowcast].filter(Boolean).join('. '), open: c.open });
    } else if (id === 'storage' && i.disk) {
      out.push({ id, label: i.disk.name, value: `${shortBytes(i.disk.free)} free`, sub: `of ${shortBytes(i.disk.total)}`, bar: c.bar, tone: c.tone ?? 'ok', hint: `${i.disk.name}: ${c.value} ${c.detail ?? ''}`.trim(), open: c.open });
    } else if (id === 'system' && i.system) {
      const mem = c.bar ?? 0;
      out.push({ id, label: 'This computer', value: `CPU ${Math.round(i.system.cpu)}%`, sub: `Memory ${mem}%`, bar: mem, tone: c.tone ?? 'ok', hint: [`${c.value}, ${c.detail}`, c.hint].filter(Boolean).join('. '), open: c.open });
    } else if (id === 'network' && i.network) {
      const n = i.network;
      const value = n.downBps !== undefined && n.upBps !== undefined ? shortRates(n.downBps, n.upBps) : n.online ? 'Connected' : 'Offline';
      out.push({ id, label: 'Network', value, sub: c.detail ?? '', tone: c.tone ?? 'ok', hint: `Network: ${c.value}, ${c.detail ?? ''}`.replace(/, $/, ''), open: c.open });
    }
  }
  return out;
}

/** The Keep Awake switch's words. */
export function awakeRow(i: GlanceInputs): { on: boolean; text: string } | undefined {
  const a = i.awake;
  if (!a) return undefined;
  if (!a.on) return { on: false, text: 'Off, the computer can sleep' };
  const left = a.until ? `${fmtLeft(a.until - i.now)} left` : 'On until you turn it off';
  return { on: true, text: a.reason ? `${left} · ${a.reason}` : left };
}

export interface GlanceStatus { tone: 'ok' | 'warn' | 'bad'; text: string; open?: string }

/** One line for the header: "All good", or the one thing that most needs attention. */
export function glanceStatus(i: GlanceInputs): GlanceStatus {
  const bad: GlanceStatus[] = [];
  const warn: GlanceStatus[] = [];
  if (i.network && !i.network.online) bad.push({ tone: 'bad', text: 'No internet connection', open: 'netactivity' });
  if (i.disk && i.disk.total > 0) {
    const used = ((i.disk.total - i.disk.free) / i.disk.total) * 100;
    if (used >= 95) bad.push({ tone: 'bad', text: `${i.disk.name} is almost full`, open: 'space' });
    else if (used >= 85) warn.push({ tone: 'warn', text: `${i.disk.name} is getting full`, open: 'space' });
  }
  if (i.system) {
    const s = i.system;
    const memTone = s.memPressure ? memoryTone({ used: s.memUsed, total: s.memTotal, pressure: s.memPressure }) : s.memTotal && s.memUsed / s.memTotal >= 0.92 ? 'warn' : 'ok';
    if (memTone === 'bad') bad.push({ tone: 'bad', text: 'Memory is running out', open: 'health' });
    else if (memTone === 'warn') warn.push({ tone: 'warn', text: 'Memory is nearly full', open: 'health' });
    const b = s.battery;
    if (b && !b.charging && b.percent <= 10) bad.push({ tone: 'bad', text: `Battery is low (${Math.round(b.percent)}%)`, open: 'health' });
    else if (b && !b.charging && b.percent <= 20) warn.push({ tone: 'warn', text: `Battery is low (${Math.round(b.percent)}%)`, open: 'health' });
    if (s.cpu >= 90) warn.push({ tone: 'warn', text: 'The computer is busy', open: 'health' });
  }
  const ai = i.aiUsage?.tone ?? (i.usage?.length ? (Math.max(...i.usage.map((u) => u.percent)) >= 90 ? 'bad' : Math.max(...i.usage.map((u) => u.percent)) >= 75 ? 'warn' : 'ok') : 'ok');
  if (ai === 'bad') bad.push({ tone: 'bad', text: 'An AI limit is used up', open: i.aiUsage ? 'aiusage' : 'island' });
  else if (ai === 'warn') warn.push({ tone: 'warn', text: 'An AI limit is running low', open: i.aiUsage ? 'aiusage' : 'island' });
  return bad[0] ?? warn[0] ?? { tone: 'ok', text: 'All good' };
}

export interface GlanceRecentFile { name: string; path: string; size: number; source?: string }

/** The network part, in short words that fit one line each. */
export interface GlanceNetView {
  /** "3 apps online" */
  line: string;
  /** "↓34 ↑2 KB/s" */
  rates: string;
  spark: number[];
  top: { app: string; path?: string; rate: string; hint: string; blocked: boolean }[];
  /** "2 waiting", when prompts wait */
  waiting?: string;
  canBlock: boolean;
}

export function glanceNetView(n: GlanceNet): GlanceNetView {
  return {
    line: onlineLine(n.apps),
    // Where speeds per app are not counted, the line keeps the computer's own speed out and each app says how many places it reaches.
    rates: n.counted === false ? 'speeds not counted' : shortRates(n.down, n.up),
    spark: n.counted === false ? [] : n.spark,
    top: n.top.map((t) => {
      const places = `${t.places ?? 0} ${t.places === 1 ? 'place' : 'places'}`;
      return { app: t.app, path: t.path, rate: n.counted === false ? places : rateText(t.down + t.up), hint: n.counted === false ? `${t.app}: ${places}${t.blocked ? ' · blocked' : ''}` : `${t.app}: ↓ ${rateText(t.down)} ↑ ${rateText(t.up)}${t.blocked ? ' · blocked' : ''}`, blocked: t.blocked };
    }),
    waiting: n.waiting ? `${n.waiting} waiting` : undefined,
    canBlock: n.canBlock,
  };
}
export interface GlanceView {
  /** every chosen card in full (the tray's tooltip) */
  cards: GlanceCard[];
  status: GlanceStatus;
  tiles: GlanceTile[];
  awake?: { on: boolean; text: string };
  /** AI usage, the next event and the tip, when chosen and there is something to say */
  rows: GlanceCard[];
  actions: GlanceActionId[];
  more: GlanceActionId[];
  recent: GlanceRecentFile[];
  moreRecent: number;
  /** the network part, when it is on and the firewall is in use */
  net?: GlanceNetView;
  settings: GlanceSettings;
}

/** Everything the pop-over draws, from the readings and the settings. */
export function glanceLayout(i: GlanceInputs, s: GlanceSettings, recent: { list: GlanceRecentFile[]; total: number }): GlanceView {
  const cards = glanceCards(i, s.cards);
  return {
    cards,
    status: glanceStatus(i),
    tiles: s.sections.stats ? glanceTiles(i, s.cards) : [],
    awake: s.cards.includes('awake') ? awakeRow(i) : undefined,
    rows: cards.filter((c) => c.id === 'usage' || c.id === 'calendar' || c.id === 'tip'),
    actions: s.sections.actions ? s.actions : [],
    more: s.sections.actions ? moreActions(s) : [],
    recent: s.sections.downloads ? recent.list : [],
    moreRecent: Math.max(0, recent.total - recent.list.length),
    net: s.sections.network && i.net ? glanceNetView(i.net) : undefined,
    settings: s,
  };
}

export interface GlanceApi {
  /** opens the glance, as a click on the owl does */
  show(): Promise<void>;
  view(): Promise<GlanceView>;
  settings(): Promise<GlanceSettings>;
  setSettings(patch: Partial<GlanceSettings>): Promise<GlanceSettings>;
  close(): Promise<void>;
  /** the pop-over's content height in pixels: the window takes that height (within the screen) */
  fit(height: number): Promise<void>;
  run(id: GlanceActionId): Promise<void>;
  /** a route in the main window, "action:<id>" or "link:<url>" */
  open(target: string): Promise<void>;
  openFile(path: string, how: 'open' | 'show'): Promise<void>;
  /** blocks one app everywhere (`deny`) or takes that block away again (`null`) */
  netRule(app: string, path: string | undefined, verdict: 'deny' | null): Promise<void>;
  /** opens the waiting prompts */
  netAsk(): Promise<void>;
}

/** A one-line summary for the tray's tooltip where there is no hover (Windows, Linux). */
export function glanceTooltip(cards: GlanceCard[], brand = 'Keeper'): string {
  return [brand, ...cards.filter((c) => c.id !== 'tip').map((c) => `${c.title}: ${c.value}${c.detail && c.id !== 'calendar' ? ` (${c.detail})` : ''}`)].join('\n');
}
