// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One map of Keeper's pages: the sidebar's sections and rows, the palette's
// "Go to" entries, and each page's title all come from here, so a page has one
// name everywhere. The sections are the same groups as Settings → Features
// (`navGroup` in core/features.ts). Old routes keep working (resolveRoute).

import { FEATURES, NAV_GROUPS, type FeatureState, type NavGroup } from './features';
import { migrateFilesRoute } from './file-types';

export interface NavRoute {
  name: string;
  arg?: string;
  q?: string;
}

export interface NavPage {
  /** stable id ("cleanup", "security") */
  id: string;
  route: NavRoute;
  /** the page's one name: sidebar row, page title, palette entry */
  label: string;
  /** an i18n key that translates the label, where there is one */
  i18n?: string;
  icon: string;
  /** sidebar section; 'top' for Home and Recents; 'none' for palette-only pages */
  group: NavGroup | 'top' | 'none';
  /** other routes that are part of this page (its tabs): the row stays highlighted on them */
  also?: string[];
  /** the part that owns it, when no route in core/features.ts says so */
  feature?: string;
  keywords?: string;
  kbd?: 'J' | 'K' | 'D';
}

/** Tabs of the pages that were merged: each old page is now a tab, under its old route. */
export interface NavTab {
  route: NavRoute;
  label: string;
  /** the part that owns it, when no route in core/features.ts says so */
  feature?: string;
  keywords?: string;
}

export const HUB_TABS: Record<string, NavTab[]> = {
  security: [
    { route: { name: 'security' }, label: 'Overview', feature: 'protection', keywords: 'camera microphone screen trackers browser extensions score privacy' },
    { route: { name: 'protection' }, label: 'Protection', keywords: 'antivirus malware defender gatekeeper xprotect updates' },
    { route: { name: 'firewall' }, label: 'Network & firewall', keywords: 'network monitor firewall block allow ask rules connections apps traffic outgoing incoming dns where data goes' },
    { route: { name: 'netactivity' }, label: 'Network activity', keywords: 'connections traffic bandwidth apps where' },
    { route: { name: 'vpn' }, label: 'VPN', keywords: 'wireguard tunnel leak' },
  ],
  controls: [
    { route: { name: 'controls' }, label: 'Quick switches', keywords: 'wifi bluetooth airplane vpn dns firewall camera microphone toggle' },
    { route: { name: 'catalog' }, label: 'Hidden system settings', keywords: 'defaults registry gsettings sysctl tweak setting catalogue catalog' },
    { route: { name: 'appcontrols' }, label: 'Per app', keywords: 'per app limit bandwidth cpu memory priority vpn route notifications volume gpu' },
  ],
  startup: [
    { route: { name: 'startup' }, label: 'Startup items', keywords: 'login items boot slow start' },
    { route: { name: 'apps' }, label: 'Installed apps', keywords: 'applications uninstall unused programs' },
  ],
  devices: [
    { route: { name: 'devices' }, label: 'Paired', keywords: 'phone computer pair link send files' },
    { route: { name: 'devices', arg: 'phone' }, label: 'Phone', keywords: 'android iphone mirror' },
    { route: { name: 'devices', arg: 'remote' }, label: 'Access from anywhere', keywords: 'remote access help unattended audit' },
    { route: { name: 'mesh' }, label: 'Private network', keywords: 'mesh wireguard vpn network devices address exit node' },
  ],
};

/** Every page in the sidebar and the palette, in sidebar order. */
export const NAV_PAGES: NavPage[] = [
  { id: 'home', route: { name: 'home' }, label: 'Hello', i18n: 'nav.home', icon: 'home', group: 'top' },
  { id: 'recents', route: { name: 'recents' }, label: 'Recents', i18n: 'nav.recents', icon: 'clock', group: 'top' },
  // The sidebar lists real places only (the folders come from Places). Your home folder and the
  // file types are reached from Home, the palette and the chips on every file list.
  { id: 'browse', route: { name: 'browse' }, label: 'Home Folder', icon: 'folder', group: 'none', keywords: 'browse files folders user folder' },
  { id: 'library', route: { name: 'library' }, label: 'Everywhere', icon: 'search', group: 'none', keywords: 'all files library every document all documents all images kinds types find by type' },
  { id: 'downloads', route: { name: 'library', arg: 'web' }, label: 'From the Web', icon: 'down', group: 'none', kbd: 'J', keywords: 'downloaded from download sources where downloads came from website app source' },
  { id: 'remote', route: { name: 'remote' }, label: 'Cloud & Servers', icon: 'cloud', group: 'none', keywords: 'cloud drive dropbox onedrive google sftp webdav s3 nas server' },

  { id: 'notes', route: { name: 'notes' }, label: 'Notes', icon: 'document', group: 'notes', keywords: 'markdown vault obsidian' },
  { id: 'reader', route: { name: 'reader' }, label: 'Reader', icon: 'rss', group: 'notes', keywords: 'rss atom feeds news blogs read later pocket articles opml' },
  { id: 'journal', route: { name: 'journal' }, label: 'Journal', icon: 'book', group: 'notes', keywords: 'diary daily entry mood photos on this day streak' },
  { id: 'cues', route: { name: 'cues' }, label: 'Cues', icon: 'pin', group: 'notes', keywords: 'checklist reminder app site' },
  { id: 'noteshub', route: { name: 'noteshub' }, label: 'Notes from Other Apps', icon: 'note', group: 'notes', keywords: 'notes everywhere apple notes onenote evernote obsidian sync' },

  { id: 'cleanup', route: { name: 'cleanup' }, label: 'Clean Up', i18n: 'nav.cleanup', icon: 'broom', group: 'tidy', kbd: 'K', keywords: 'junk cache free space' },
  { id: 'duplicates', route: { name: 'duplicates' }, label: 'Duplicates', i18n: 'nav.duplicates', icon: 'dupes', group: 'tidy', kbd: 'D', keywords: 'copies look-alike photos' },
  { id: 'space', route: { name: 'space' }, label: 'Space Map', i18n: 'nav.space', icon: 'map', group: 'tidy', keywords: 'disk usage treemap storage' },
  { id: 'large', route: { name: 'large' }, label: 'Large Files', i18n: 'nav.large', icon: 'weight', group: 'tidy', keywords: 'big files storage' },
  { id: 'convert', route: { name: 'convert' }, label: 'Convert', i18n: 'nav.convert', icon: 'refresh', group: 'tidy', keywords: 'format pdf video image' },
  { id: 'rules', route: { name: 'rules' }, label: 'Automations', i18n: 'nav.rules', icon: 'rules', group: 'tidy', keywords: 'rules tidy folders' },
  { id: 'history', route: { name: 'history' }, label: 'Undo History', i18n: 'nav.history', icon: 'history', group: 'tidy', keywords: 'undo history moved removed activity' },

  { id: 'sync-folders', route: { name: 'sync', arg: 'folders' }, label: 'Synced Folders', icon: 'refresh', group: 'sync', keywords: 'sync folders devices' },
  { id: 'sync-backups', route: { name: 'sync', arg: 'backups' }, label: 'Backups', icon: 'shield', group: 'sync', keywords: 'backup restore' },
  { id: 'sync-mirrors', route: { name: 'sync', arg: 'mirrors' }, label: 'Cloud Mirrors', icon: 'cloud', group: 'sync', keywords: 'mirror cloud copy' },
  { id: 'sync-versions', route: { name: 'sync', arg: 'versions' }, label: 'Older Versions', icon: 'history', group: 'sync', keywords: 'versions restore previous' },

  { id: 'health', route: { name: 'health' }, label: 'Health', i18n: 'nav.health', icon: 'bolt', group: 'computer', also: ['browsers'], keywords: 'cpu memory battery heat processes task manager activity monitor' },
  { id: 'startup', route: { name: 'startup' }, label: 'Startup & Apps', icon: 'power', group: 'computer', also: ['apps'], keywords: 'startup items login installed applications uninstall' },
  { id: 'controls', route: { name: 'controls' }, label: 'System Controls', icon: 'settings', group: 'computer', also: ['catalog', 'appcontrols'], keywords: 'quick controls system settings+ app controls wifi bluetooth' },
  { id: 'awake', route: { name: 'awake' }, label: 'Keep Awake', icon: 'coffee', group: 'computer', keywords: 'caffeine sleep stay awake triggers closed lid' },
  { id: 'time', route: { name: 'time' }, label: 'Time Tracking', icon: 'stopwatch', group: 'computer', keywords: 'time tracker timesheet hours apps sites projects productivity timeline' },
  { id: 'blocking', route: { name: 'blocking' }, label: 'Focus Blocking', icon: 'block', group: 'computer', keywords: 'block sites apps distractions focus schedule strict social news' },
  { id: 'monitors', route: { name: 'monitors' }, label: 'Monitors', icon: 'pulse', group: 'computer', keywords: 'uptime site server website down ping port dns certificate ssl tls response time status monitor' },
  { id: 'todo', route: { name: 'todo' }, label: 'Fix-it List', icon: 'check', group: 'computer', keywords: 'to do todo fix issues problems recommendations space security privacy' },

  { id: 'security', route: { name: 'security' }, label: 'Privacy & Security', i18n: 'nav.protection', icon: 'shield', group: 'security', also: ['protection', 'firewall', 'netactivity', 'vpn'], feature: 'protection', keywords: 'privacy security protection firewall vpn network' },

  { id: 'devices', route: { name: 'devices' }, label: 'Devices', icon: 'link', group: 'devices', also: ['mesh'], keywords: 'phone pair link mesh access from anywhere' },
  { id: 'alerts', route: { name: 'alerts' }, label: 'Phone Alerts', icon: 'bell', group: 'devices', keywords: 'notifications push phone telegram ntfy webhook email alert send' },
  { id: 'rdc', route: { name: 'rdc' }, label: 'Remote Desktops', icon: 'laptop', group: 'devices', keywords: 'rdp vnc ssh remote desktop connect' },
  { id: 'terminal', route: { name: 'terminal' }, label: 'Terminal', icon: 'terminal', group: 'devices', keywords: 'shell console ssh' },

  { id: 'assistant', route: { name: 'assistant' }, label: 'Assistant', i18n: 'nav.assistant', icon: 'assistant', group: 'ai', keywords: 'ask ai chat' },
  { id: 'agents', route: { name: 'agents' }, label: 'Agents', icon: 'agent', group: 'ai', keywords: 'ai agents' },
  { id: 'aiusage', route: { name: 'aiusage' }, label: 'AI Usage', icon: 'chart', group: 'ai', keywords: 'usage limits credits subscriptions claude codex copilot' },
  { id: 'graph', route: { name: 'graph' }, label: 'Knowledge Graph', icon: 'graph', group: 'ai', keywords: 'brain graph links' },
  { id: 'dictation', route: { name: 'dictation' }, label: 'Dictation', icon: 'mic', group: 'ai', keywords: 'voice speak type' },
  { id: 'meetings', route: { name: 'meetings' }, label: 'Meetings', icon: 'calendar', group: 'ai', keywords: 'record transcribe notes' },

  { id: 'capture', route: { name: 'capture' }, label: 'Capture', i18n: 'nav.capture', icon: 'screenshot', group: 'screen', keywords: 'screenshot text from screen color picker' },
  { id: 'photo', route: { name: 'photo' }, label: 'Photo Editor', icon: 'sliders', group: 'none', keywords: 'edit photo picture image crop rotate straighten brightness exposure contrast saturation warmth blur redact pixelate resize convert background remove' },
  { id: 'studio', route: { name: 'studio' }, label: 'Studio', icon: 'video', group: 'screen', keywords: 'record screen video edit zoom export' },
  { id: 'stage', route: { name: 'stage' }, label: 'Stage', icon: 'eye', group: 'screen', keywords: 'clean screen present recording' },
  { id: 'tools', route: { name: 'tools' }, label: 'Toolbox', i18n: 'nav.toolbox', icon: 'terminal', group: 'screen', keywords: 'tools utilities developer' },

  { id: 'island', route: { name: 'island' }, label: 'Island', i18n: 'nav.island', icon: 'island', group: 'desktop', keywords: 'notch shelf now playing' },
  { id: 'snippets', route: { name: 'snippets' }, label: 'Typed Snippets', icon: 'text', group: 'desktop', keywords: 'text expansion abbreviation expand autotext shortcut' },
  { id: 'widgets', route: { name: 'widgets' }, label: 'Widgets', i18n: 'nav.widgets', icon: 'grid', group: 'desktop', keywords: 'desktop clock' },
  { id: 'ambience', route: { name: 'ambience' }, label: 'Wallpaper & Vibes', icon: 'palette', group: 'desktop', keywords: 'wallpaper vibes ambient sound theme' },
  { id: 'weather', route: { name: 'weather' }, label: 'Weather', i18n: 'nav.weather', icon: 'sun', group: 'desktop', keywords: 'forecast rain radar' },
  { id: 'tracks', route: { name: 'tracks' }, label: 'Places & Tracks', icon: 'map', group: 'desktop', keywords: 'map location timeline trips' },

  // Mail & Calendar's own section lists these (src/pim/PimSidebar.tsx); the palette names them the same.
  { id: 'mail', route: { name: 'mail' }, label: 'Mail', icon: 'mail', group: 'none', keywords: 'inbox email' },
  { id: 'calendar', route: { name: 'calendar' }, label: 'Calendar', icon: 'calendar', group: 'none', keywords: 'events schedule agenda' },
  { id: 'reminders', route: { name: 'reminders' }, label: 'Reminders', icon: 'listCheck', group: 'none', keywords: 'todo tasks to-do lists' },
  { id: 'planner', route: { name: 'planner' }, label: 'Planner', icon: 'columns', group: 'none', keywords: 'today week inbox plan tasks overdue upcoming' },
  { id: 'alarms', route: { name: 'alarms' }, label: 'Clock', icon: 'alarm', group: 'none', keywords: 'alarms timers stopwatch world clocks' },

  { id: 'settings', route: { name: 'settings' }, label: 'Settings', i18n: 'nav.settings', icon: 'settings', group: 'none', keywords: 'preferences options' },
];

const byId = new Map(NAV_PAGES.map((p) => [p.id, p]));
export const navPage = (id: string) => byId.get(id);

/** The sidebar's suite sections, in order: the Features groups that have pages. */
export function navSections(): { id: NavGroup; title: string; pages: NavPage[] }[] {
  return NAV_GROUPS.map((g) => ({ id: g.id, title: g.title, pages: NAV_PAGES.filter((p) => p.group === g.id) })).filter((s) => s.pages.length);
}

/** The page a route belongs to (a tab of a merged page belongs to that page). */
export function pageOf(r: NavRoute): NavPage | undefined {
  const exact = NAV_PAGES.find((p) => p.route.name === r.name && (p.route.arg ?? '') === (r.arg ?? ''));
  return exact ?? NAV_PAGES.find((p) => p.route.name === r.name && !p.route.arg) ?? NAV_PAGES.find((p) => p.also?.includes(r.name)) ?? NAV_PAGES.find((p) => p.route.name === r.name);
}

/** Its page title: the merged page's for a tab of one. */
export function titleOf(r: NavRoute): string | undefined {
  return pageOf(r)?.label;
}

/** The hub (merged page) a route is a tab of, and which tab. */
export function hubOf(r: NavRoute): { hub: string; tab: NavTab } | undefined {
  for (const [hub, tabs] of Object.entries(HUB_TABS)) {
    const exact = tabs.find((t) => t.route.name === r.name && (t.route.arg ?? '') === (r.arg ?? ''));
    const loose = exact ?? tabs.find((t) => t.route.name === r.name && !t.route.arg && !tabs.some((o) => o.route.name === r.name && o.route.arg === r.arg));
    if (loose) return { hub, tab: loose };
  }
  return undefined;
}

/**
 * Old routes that moved (the Library's pages became Everywhere + a type chip:
 * core/file-types.ts migrateFilesRoute). Everything else stays where it was: the merged pages
 * keep their old routes as tabs (controls, catalog, appcontrols; protection,
 * firewall, netactivity, vpn; startup, apps; mesh).
 */
export function resolveRoute<R extends NavRoute>(r: R): R {
  const arg = r.arg ?? '';
  if (r.name === 'settings') {
    const [sec] = arg.split('#');
    // Keeper's processes and the system monitor's settings live in Health now.
    if (sec === 'processes') return { ...r, name: 'health', arg: 'keeper' };
    if (sec === 'monitor') return { ...r, name: 'health', arg: 'settings' };
  }
  // Browser tabs is part of Health → Apps & tabs.
  if (r.name === 'browsers') return { ...r, name: 'health', arg: 'apps' };
  // Privacy & Security's own tabs (protection:<tab>) moved to the overview's route.
  if (r.name === 'protection' && arg) return { ...r, name: 'security', arg };
  // The Library's pages are Everywhere + a type chip (All Screenshots, Download Sources, a source).
  return migrateFilesRoute(r);
}

/** Routes hidden because the part named on a page or tab (rather than in core/features.ts) is off. */
export function navHiddenRoutes(states: Map<string, FeatureState>): Set<string> {
  const out = new Set<string>();
  for (const p of NAV_PAGES) if (p.feature && states.get(p.feature)?.on === false) out.add(p.route.name);
  for (const tabs of Object.values(HUB_TABS)) for (const t of tabs) if (t.feature && states.get(t.feature)?.on === false) out.add(t.route.name);
  return out;
}

/** The feature that owns a route (for "X is off" pages). */
export function featureOfRoute(name: string): string | undefined {
  return FEATURES.find((f) => f.routes?.includes(name))?.id ?? NAV_PAGES.find((p) => p.route.name === name)?.feature ?? Object.values(HUB_TABS).flat().find((t) => t.route.name === name)?.feature;
}
