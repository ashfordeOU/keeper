// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The glance: what the owl in the menu bar (the tray icon) shows when it is
// clicked or hovered. Cards of the moment (weather, storage, this computer,
// the network, Keep Awake, AI usage running out, the next event and a tip),
// a grid of quick actions the person picks, and the newest downloads. This
// file turns raw readings into cards; electron/services/glance.ts gathers the
// readings (only while the glance is open) and src/glance/Glance.tsx draws it.

export const GLANCE_CARDS = ['weather', 'storage', 'system', 'network', 'awake', 'usage', 'calendar', 'tip'] as const;
export type GlanceCardId = (typeof GLANCE_CARDS)[number];

export const GLANCE_ACTIONS = ['quickSearch', 'screenshot', 'captureText', 'keepAwake', 'dictation', 'stage', 'cleanup', 'terminal', 'launcher', 'recordScreen', 'colour', 'clipboard'] as const;
export type GlanceActionId = (typeof GLANCE_ACTIONS)[number];

export const ACTION_INFO: Record<GlanceActionId, { label: string; icon: string }> = {
  quickSearch: { label: 'Quick Search', icon: 'search' },
  screenshot: { label: 'Screenshot', icon: 'camera' },
  captureText: { label: 'Copy Text', icon: 'text' },
  keepAwake: { label: 'Keep Awake', icon: 'coffee' },
  dictation: { label: 'Dictation', icon: 'mic' },
  stage: { label: 'Stage', icon: 'eye' },
  cleanup: { label: 'Clean Up', icon: 'trash' },
  terminal: { label: 'Terminal', icon: 'terminal' },
  launcher: { label: 'Tools', icon: 'grid' },
  recordScreen: { label: 'Record Screen', icon: 'video' },
  colour: { label: 'Pick a Colour', icon: 'palette' },
  clipboard: { label: 'Clipboard', icon: 'clipboard' },
};

export const CARD_INFO: Record<GlanceCardId, { label: string }> = {
  weather: { label: 'Weather' }, storage: { label: 'Storage' }, system: { label: 'This computer' }, network: { label: 'Network' },
  awake: { label: 'Keep Awake' }, usage: { label: 'AI usage' }, calendar: { label: 'Next event' }, tip: { label: 'Did you know' },
};

export interface GlanceSettings {
  cards: GlanceCardId[];
  actions: GlanceActionId[];
  /** show the glance when the pointer rests on the owl (macOS menu bar) */
  hover: boolean;
}

export function defaultGlanceSettings(platform: string = process.platform): GlanceSettings {
  return {
    cards: [...GLANCE_CARDS],
    actions: ['quickSearch', 'screenshot', 'captureText', 'keepAwake', 'dictation', 'stage', 'cleanup', 'terminal'],
    hover: platform === 'darwin',
  };
}

export function normalizeGlanceSettings(g: Partial<GlanceSettings> | undefined, platform: string = process.platform): GlanceSettings {
  const d = defaultGlanceSettings(platform);
  const pick = <T extends string>(list: unknown, known: readonly T[], fallback: T[]): T[] => (Array.isArray(list) ? [...new Set(list.filter((x): x is T => known.includes(x as T)))] : fallback);
  return {
    cards: pick(g?.cards, GLANCE_CARDS, d.cards),
    actions: pick(g?.actions, GLANCE_ACTIONS, d.actions).slice(0, 12),
    hover: typeof g?.hover === 'boolean' ? g.hover : d.hover,
  };
}

/** What electron/services/glance.ts reads; every part optional (a part that cannot be read is left out). */
export interface GlanceInputs {
  now: number;
  weather?: { place: string; temp: number; units: 'c' | 'f'; summary: string; nowcast?: string };
  disk?: { total: number; free: number; name: string };
  system?: { cpu: number; memUsed: number; memTotal: number; battery?: { percent: number; charging: boolean; minutesLeft?: number } };
  network?: { downBps?: number; upBps?: number; wifi?: string; vpn?: string; mesh?: string; online: boolean };
  awake?: { on: boolean; until?: number; reason?: string };
  usage?: { label: string; percent: number; resetsAt?: number }[];
  /** the AI usage tracker's accounts (Keeper → Usage), when any are tracked; shown instead of `usage` */
  aiUsage?: { value: string; detail: string; usedPercent?: number; tone: 'ok' | 'warn' | 'bad' };
  next?: { title: string; start: number; link?: string };
  tipIndex?: number;
}

export interface GlanceCard {
  id: GlanceCardId;
  title: string;
  value: string;
  detail?: string;
  /** 0–100 for a bar (storage, memory, usage) */
  bar?: number;
  tone?: 'ok' | 'warn' | 'bad';
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
      out.push({ id, title: 'This computer', value: `CPU ${Math.round(i.system.cpu)}%`, detail: `memory ${mem}%${batt}`, bar: mem, tone: i.system.cpu >= 90 || mem >= 92 ? 'warn' : 'ok', open: 'health' });
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

export interface GlanceRecentFile { name: string; path: string; size: number; source?: string }
export interface GlanceView { cards: GlanceCard[]; actions: GlanceActionId[]; recent: GlanceRecentFile[]; moreRecent: number; settings: GlanceSettings }

export interface GlanceApi {
  /** opens the glance, as a click on the owl does */
  show(): Promise<void>;
  view(): Promise<GlanceView>;
  settings(): Promise<GlanceSettings>;
  setSettings(patch: Partial<GlanceSettings>): Promise<GlanceSettings>;
  close(): Promise<void>;
  run(id: GlanceActionId): Promise<void>;
  /** a route in the main window, "action:<id>" or "link:<url>" */
  open(target: string): Promise<void>;
  openFile(path: string, how: 'open' | 'show'): Promise<void>;
}

/** A one-line summary for the tray's tooltip where there is no hover (Windows, Linux). */
export function glanceTooltip(cards: GlanceCard[], brand = 'Keeper'): string {
  return [brand, ...cards.filter((c) => c.id !== 'tip').map((c) => `${c.title}: ${c.value}${c.detail && c.id !== 'calendar' ? ` (${c.detail})` : ''}`)].join('\n');
}
