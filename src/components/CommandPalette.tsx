// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The command palette: jump anywhere or run any action by typing a few letters.

import { useExtensionCommands } from './Extensions';
import { textToRead } from './ReadingPanel';
import { openSendTo } from './SendTo';
import { filesItem } from '../../core/send-to';
import { openSetupAgain } from '../setup/FirstRun';
import { openPermissions } from './PermissionsPanel';
import { accessCommands } from '../screen/palette';
import { FLOWS } from '../../core/guide/builtin';
import { openGuide } from '../guide';
import { useCommandFilter, useHiddenRoutes } from '../features';
import { useEffect, useMemo, useRef, useState } from 'react';
import { OPEN_EXT } from '../../core/photo-formats';
import { THEMES } from '../../core/themes';
import { TOOL_INFO, type ConvertTool } from '../../core/convert-types';
import { api } from '../api';
import { themePatch, toggleThemePatch } from '../theme';
import { mod, shift, useStore, type Route } from '../state';
import { openNotices } from './Notices';
import { openHelp } from './HelpSheet';
import { openSelfCheck } from './SelfCheck';
import { Icon } from './Icon';
import { useFocusTrap } from '../a11y';
import { CATALOG } from '../../core/settings-catalog';
import { useTracksCommands } from '../screens/TracksSurfaces';
import '../styles/screens-a.css';
import { useMeshCommands } from '../screens/MeshParts';
import { useAmbienceCommands } from '../wallpaper/palette';
import { useVoiceCommands } from '../voice/palette';
import { openNative } from '../lib/native';
import { usageCommands } from '../screens/usage/palette';
import { HUB_TABS, listedPages, NAV_PAGES, navPage } from '../../core/nav';
import { TYPE_CHIPS } from '../../core/file-types';
import { useT } from '../i18n';
import { openInWindow, windowLabel } from '../page-window';
import { modeCommands } from './Modes';
import { modeOf } from '../../core/modes';

interface Command {
  id: string;
  label: string;
  group: 'Recent' | 'Common' | 'Go to' | 'Actions' | 'Search';
  icon: string;
  kbd?: string;
  keywords?: string;
  /** listed only once something is typed (e.g. one entry per theme) */
  typed?: boolean;
  /** the page it opens (hidden while the feature owning that page is off) */
  route?: string;
  run: () => unknown;
}

/** Subsequence match with a bonus for word starts; -1 when it does not match. */
const HOWTO_WORDS: Record<string, string> = {
  'free-space': 'disk full storage clean junk room', 'camera-access': 'webcam watching privacy', 'microphone-access': 'mic listening privacy',
  'screen-access': 'screen recording capture', 'encrypt-disk': 'filevault bitlocker encryption stolen', 'turn-on-firewall': 'firewall block incoming',
  'backup-photos': 'backup back up pictures safe', 'block-trackers': 'ads tracking trackers privacy', 'startup-apps': 'startup login items slow boot',
  'storage-optimise': 'storage sense optimize empty trash automatically', 'lock-folder': 'password protect private hide folder', 'software-updates': 'update windows update security updates',
};

export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (t.includes(q)) return 100 - t.indexOf(q);
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    score += at === 0 || /[\s\-/]/.test(t[at - 1]) ? 5 : 1;
    score -= Math.min(3, at - ti);
    ti = at + 1;
  }
  return score;
}

/**
 * "Go to" entries: every page under the name it has in the sidebar and as its title
 * (core/nav.ts), each tab of a merged page as "Page › Tab", and a few deeper places.
 */
const KBD: Record<string, string> = { J: `${shift}${mod}J`, K: `${shift}${mod}K`, D: `${shift}${mod}D` };
const PAGE_EXTRAS: [Route, string, string][] = [
  [{ name: 'health', arg: 'processes' }, 'Health › Processes (Task Manager)', 'list'],
  [{ name: 'health', arg: 'keeper' }, 'Health › Keeper Itself', 'power'],
  [{ name: 'health', arg: 'services' }, 'Health › Services', 'power'],
  [{ name: 'health', arg: 'apps' }, 'Health › Apps & Tabs', 'globe'],
  [{ name: 'notes', arg: 'today' }, 'Today’s Daily Note', 'calendar'],
  [{ name: 'notes', arg: 'graph' }, 'Notes Graph', 'graph'],
];

function pageCommands(t: (k: string) => string, home: string | undefined, go: (r: Route) => void): Command[] {
  const pages = listedPages().map((p) => ({
    id: `go-${p.label}`, label: p.i18n ? t(p.i18n) : p.label, group: 'Go to' as const, icon: p.icon, kbd: p.kbd ? KBD[p.kbd] : p.id === 'settings' ? `${mod},` : undefined,
    keywords: p.keywords, route: p.route.name, run: (go: (r: Route) => void) => go((p.id === 'browse' ? { name: 'browse', arg: home } : p.route) as Route),
  }));
  const tabs = Object.entries(HUB_TABS).flatMap(([hub, list]) => list.map((tab) => ({
    id: `go-${hub}-${tab.route.name}${tab.route.arg ? `-${tab.route.arg}` : ''}`, label: `${navPage(hub)?.label} › ${tab.label}`, group: 'Go to' as const, icon: navPage(hub)?.icon ?? 'settings', typed: true,
    keywords: tab.keywords, route: tab.route.name, run: (go: (r: Route) => void) => go(tab.route as Route),
  })));
  // Each type, Everywhere ("Documents everywhere"; once "All Documents", still found by that name).
  const kinds = TYPE_CHIPS.filter((c) => c.id !== 'web').map((c) => ({ id: `go-kind-${c.id}`, label: `${c.label} everywhere`, group: 'Go to' as const, icon: c.icon, typed: true, route: 'library', keywords: `all ${c.label.toLowerCase()} ${t(`kindAll.${c.id}`)} type kind`, run: (go: (r: Route) => void) => go({ name: 'library', arg: c.id }) }));
  const extras = PAGE_EXTRAS.map(([route, label, icon]) => ({ id: `go-${label}`, label, group: 'Go to' as const, icon, typed: true, route: route.name, run: (go: (r: Route) => void) => go(route) }));
  return [...pages, ...tabs, ...kinds, ...extras].map((c) => ({ ...c, run: () => c.run(go) }));
}

// With nothing typed: the commands run last, then the common pages and actions, then the rest.
const RECENT_KEY = 'palette.recent';
const COMMON = ['setup-again', 'go-Home', 'go-Clean Up', 'go-Recents', 'go-Health', 'go-Assistant', 'go-Settings', 'go-Browse', 'check-updates'];
function recentIds(): string[] {
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 5); } catch { return []; }
}
function noteRecent(id: string) {
  if (id === 'search') return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, 5))); } catch { /* storage unavailable */ }
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [text, setText] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Tab stays in the palette; focus goes back where it was when it closes.
  useFocusTrap(boxRef);

  const meshCmds = useMeshCommands(store.toast, store.go);
  const extCmds = useExtensionCommands();
  const ambienceCmds = useAmbienceCommands(store.toast, store.go);
  const voiceCmds = useVoiceCommands(store.toast, store.go);
  // Remote Desktops: Quick Connect and each saved connection (when Remote Desktops → Where it appears allows it).
  const [rdc, setRdc] = useState<{ id: string; name: string; protocol: string }[] | null>(null);
  useEffect(() => {
    void Promise.all([api.rdc?.places(), api.rdc?.state()]).then(([p, s]) => setRdc(p?.palette && s ? s.connections.map((c) => ({ id: c.id, name: c.name, protocol: c.protocol })) : null)).catch(() => undefined);
  }, []);
  // The photo editor: open a picture, or one of the pictures edited lately.
  const [photos, setPhotos] = useState<{ path: string; name: string }[]>([]);
  useEffect(() => { void api.photo?.recent().then((r) => setPhotos(r.slice(0, 5))).catch(() => undefined); }, []);
  // Places & Tracks: "Where is my laptop?" for each device, item and person (its settings can leave these out).
  const tracksCommands = useTracksCommands(store.go);
  const t = useT();
  const hiddenRoutes = useHiddenRoutes();
  const commands = useMemo<Command[]>(() => [
    { id: 'photo-open', label: 'Edit a Photo…', group: 'Actions' as const, icon: 'sliders', keywords: 'photo editor picture image edit crop background remove heic raw convert', run: async () => {
      const [f] = await api.settings.pickFiles({ title: 'Choose a picture to edit', extensions: OPEN_EXT });
      if (f) store.go({ name: 'photo', arg: f });
    } },
    ...photos.map((x) => ({ id: `photo-recent-${x.path}`, label: `Edit ${x.name}`, group: 'Actions' as const, icon: 'image', typed: true, keywords: 'photo picture recent edit', run: () => store.go({ name: 'photo', arg: x.path }) })),
    ...(rdc ? [
      { id: 'rdc-quick', label: 'Quick Connect to a Remote Desktop…', group: 'Actions' as const, icon: 'laptop', keywords: 'rdp vnc ssh remote desktop connect', run: () => void api.rdc.showQuick() },
      ...rdc.map((c) => ({ id: `rdc-${c.id}`, label: `Connect to ${c.name}`, group: 'Actions' as const, icon: 'laptop', typed: true, keywords: `remote desktop ${c.protocol}`, run: () => store.tabs.open({ name: 'rdc', q: `connect:${c.id}` }) })),
    ] : []),
    // Keeper Mesh: copy a device's address, on/off, exit node (as placed under Settings → Keeper Mesh).
    ...meshCmds,
    ...extCmds,
    ...ambienceCmds,
    ...voiceCmds,
    // AI usage: "Usage: …" (hidden with the tracker).
    ...usageCommands(store.toast, store.go),
    ...pageCommands(t, store.info?.home, store.go),
    // The page in front in a window of its own, and any page by name ("Mail in New Window").
    ...(api.windows ? [
      { id: 'page-window', label: `Open ${windowLabel(store.route, t) ?? 'This Page'} in New Window`, group: 'Actions' as const, icon: 'external', kbd: mod === '⌘' ? '⌥⌘N' : 'Ctrl+Alt+N', keywords: 'new window separate window detach own window', run: () => void openInWindow(store.route, windowLabel(store.route, t), store.toast) },
      ...NAV_PAGES.filter((p) => !hiddenRoutes.has(p.route.name)).map((p) => ({ id: `window-${p.id}`, label: `${p.i18n ? t(p.i18n) : p.label} in New Window`, group: 'Actions' as const, icon: p.icon, typed: true, keywords: `new window own window ${p.keywords ?? ''}`, run: () => void openInWindow(p.route, p.i18n ? t(p.i18n) : p.label, store.toast) })),
    ] : []),
    { id: 'rescan', label: 'Rescan Library', group: 'Actions', icon: 'refresh', keywords: 'index refresh reload', run: async () => { await api.library.rescan(); store.toast('Reading your folders…'); } },
    // Modes: "Mode: Focus" (with a preview first), add-ons, and Focus for a while.
    ...modeCommands(modeOf(store.settings ?? ({} as never)), store.go),
    { id: 'setup-again', label: 'Set Up Keeper Again…', group: 'Actions', icon: 'sparkle', keywords: 'welcome tour first run onboarding recommended presets choose parts', run: () => openSetupAgain() },
    { id: 'check-updates', label: 'Check for Updates…', group: 'Actions', icon: 'refresh', keywords: 'update upgrade new version release software', run: () => void api.appInfo.openUpdateWindow() },
    { id: 'help', label: 'Help for This Page', group: 'Actions', icon: 'help', keywords: 'help guide docs documentation manual how to explain what is this question', kbd: 'F1', run: () => openHelp() },
    { id: 'selfcheck', label: 'Check Keeper', group: 'Actions', icon: 'check', keywords: 'self check diagnostics health of keeper broken not working troubleshoot', run: () => openSelfCheck('check') },
    { id: 'problem-report', label: 'Make a Problem Report…', group: 'Actions', icon: 'bug', keywords: 'bug report logs support diagnostics send help issue', run: () => openSelfCheck('report') },
    { id: 'notices', label: 'Notifications', group: 'Actions', icon: 'bell', keywords: 'notices alerts inbox batch quiet hours snooze mark all done', run: () => openNotices() },
    { id: 'notices-snooze', label: 'Snooze Notifications for 1 Hour', group: 'Actions', icon: 'clock', keywords: 'quiet do not disturb mute pause alerts', run: () => void api.notices?.snoozeAll(3600_000) },
    { id: 'about', label: 'About Keeper', group: 'Actions', icon: 'info', keywords: 'version licence license electron', run: () => void api.appInfo.openAbout() },
    { id: 'terminal-window', label: 'New Terminal Window', group: 'Actions', icon: 'terminal', keywords: 'shell console', run: () => void api.terminal.openWindow() },
    { id: 'terminal-quick', label: 'Drop-down Terminal', group: 'Actions', icon: 'terminal', keywords: 'quake shell console', run: () => void api.terminal.toggleQuick() },
    { id: 'look', label: 'Switch Theme (last two used)', group: 'Actions', icon: 'palette', kbd: `${mod}${shift}L`, keywords: 'theme look colour color playful minimal', run: () => store.settings && store.updateSettings(toggleThemePatch(store.settings)) },
    // Every conversion tool, found by typing ("redact", "gif", "transcribe"…).
    ...(Object.keys(TOOL_INFO) as ConvertTool[]).map((t) => ({ id: `convert-${t}`, label: `${{ video: 'Video', audio: 'Audio', image: 'Pictures', pdf: 'PDF', doc: 'Documents', file: 'Files', convert: 'Convert' }[TOOL_INFO[t].category]}: ${TOOL_INFO[t].label}`, group: 'Actions' as const, icon: 'refresh', typed: true, keywords: `convert ${TOOL_INFO[t].description}`, run: () => store.go({ name: 'convert', arg: JSON.stringify({ tool: t, files: store.selection }) }) })),
    // "How do I…?": every guided flow, found by what the person wants to do.
    ...FLOWS.map((f) => ({ id: `howto-${f.id}`, label: `How do I… ${f.title.toLowerCase()}?`, group: 'Actions' as const, icon: 'sparkle', typed: true, keywords: `how do i how to help ${f.title} ${HOWTO_WORDS[f.id] ?? ''}`, run: () => openGuide(`flow:${f.id}`) })),
    ...THEMES.map((t) => ({ id: `theme-${t.id}`, label: `Theme: ${t.name}`, group: 'Actions' as const, icon: 'palette', typed: true, keywords: `theme look ${t.tags.join(' ')}`, run: () => store.settings && store.updateSettings(themePatch(store.settings, t.id)) })),
    { id: 'hidden-files', label: store.settings?.showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', group: 'Actions', icon: store.settings?.showHidden ? 'eyeOff' : 'eye', kbd: `${mod}${shift}.`, keywords: 'dot files dotfiles invisible show hide', run: () => store.settings && store.updateSettings({ showHidden: !store.settings.showHidden }) },
    { id: 'locked-folders', label: 'Locked Folders', group: 'Actions', icon: 'lock', keywords: 'lock unlock encrypt password protect vault private', run: () => store.go({ name: 'settings', arg: 'files#lockedFolders' }) },
    { id: 'appearance', label: 'Toggle Dark Mode', group: 'Actions', icon: 'moon', keywords: 'theme light appearance', run: () => store.settings && store.updateSettings({ appearance: store.settings.appearance === 'dark' ? 'light' : 'dark' }) },
    { id: 'view', label: store.view === 'grid' ? 'Show as List' : 'Show as Grid', group: 'Actions', icon: store.view === 'grid' ? 'list' : 'grid', kbd: store.view === 'grid' ? `${mod}2` : `${mod}1`, run: () => store.setView(store.view === 'grid' ? 'list' : 'grid') },
    { id: 'inspector', label: store.inspector ? 'Hide Inspector' : 'Show Inspector', group: 'Actions', icon: 'info', kbd: mod === '⌘' ? '⌘⌥I' : 'Ctrl+Alt+I', run: () => store.setInspector(!store.inspector) },
    { id: 'sidebar-toggle', label: 'Fold or open the sidebar', group: 'Actions', icon: 'columns', kbd: mod === '⌘' ? '⌘⌥S' : 'Ctrl+Alt+S', run: () => window.dispatchEvent(new Event('keeper-toggle-sidebar')) },
    { id: 'permissions', label: 'Permissions — set up what Keeper may use', group: 'Go to', icon: 'shield', keywords: 'permissions privacy accessibility screen recording microphone camera full disk access automation allow', run: () => openPermissions() },
    { id: 'inspector-settings', label: 'Details Panel: When It Shows…', group: 'Actions', icon: 'settings', keywords: 'inspector', run: () => store.go({ name: 'settings', arg: 'appearance#inspectorMode' }) },
    // Cues: a new cue for the app or page in front (the composer pops up beside it).
    { id: 'cue-new', label: 'New Cue for What’s in Front…', group: 'Actions', icon: 'pin', keywords: 'cue remind reminder note checklist app page site when back later', run: () => void api.cues?.compose({ attach: ['page', 'app'] }) },
    { id: 'awake', label: 'Keep Awake for 1 Hour', group: 'Actions', icon: 'coffee', keywords: 'caffeine sleep stay awake', run: async () => { await api.island.keepAwake(true, { minutes: 60 }); store.toast('Staying awake for the next hour'); } },
    { id: 'awake-off', label: 'Allow Sleep Again', group: 'Actions', icon: 'moon', keywords: 'keep awake stop', run: async () => { await api.island.keepAwake(false); store.toast('Your computer can sleep again'); } },
    { id: 'awake-toggle', label: 'Turn Keep Awake On or Off', group: 'Actions', icon: 'coffee', keywords: 'caffeine sleep stay awake toggle insomnia', run: async () => { const s = await api.awake.toggle(); store.toast(s.on ? 'Keeping awake until you turn it off' : 'Your computer can sleep again'); } },
    ...(store.settings?.awake?.quick ?? []).filter((m) => m !== 60).map((m) => ({ id: `awake-${m}`, label: `Keep Awake for ${m >= 60 ? `${m / 60} Hour${m === 60 ? '' : 's'}` : `${m} Minutes`}`, group: 'Actions' as const, icon: 'coffee', typed: true, keywords: 'caffeine sleep stay awake', run: async () => { await api.awake.start({ minutes: m }); store.toast(`Staying awake for ${m >= 60 ? `${m / 60} h` : `${m} min`}`); } })),
    // Keeper Link: Get help, Help someone, your devices (places chosen under Devices → Access from anywhere).
    ...accessCommands(store),
    // Monorail (Settings → Ashforde apps); hidden unless that feature is on.
    ...(() => {
      const mono = (kind: string, arg?: string | number | boolean, done?: string) => async () => { const r = await api.ashforde.action(kind, arg); store.toast(r.ok ? (done ?? 'Done') : (r.message ?? 'Monorail did not answer')); };
      return [
        { id: 'monorail-palette', label: 'Monorail: Command Palette', group: 'Actions' as const, icon: 'columns', keywords: 'monorail windows tile strip actions', run: mono('palette', undefined, 'Opened Monorail’s palette') },
        { id: 'monorail-focus-on', label: 'Monorail: Focus Mode On', group: 'Actions' as const, icon: 'columns', keywords: 'monorail focus dim windows', run: mono('focus-mode', true, 'Monorail focus mode is on') },
        { id: 'monorail-focus-off', label: 'Monorail: Focus Mode Off', group: 'Actions' as const, icon: 'columns', keywords: 'monorail focus dim windows', run: mono('focus-mode', false, 'Monorail focus mode is off') },
        { id: 'monorail-present', label: 'Monorail: Presentation Mode On', group: 'Actions' as const, icon: 'columns', keywords: 'monorail present slides', run: mono('presentation-mode', true, 'Monorail presentation mode is on') },
        { id: 'monorail-present-off', label: 'Monorail: Presentation Mode Off', group: 'Actions' as const, icon: 'columns', keywords: 'monorail present slides', run: mono('presentation-mode', false, 'Monorail presentation mode is off') },
        ...[1, 2, 3, 4, 5].map((n) => ({ id: `monorail-workspace-${n}`, label: `Monorail: Go to Workspace ${n}`, group: 'Actions' as const, icon: 'columns', typed: true, keywords: `monorail workspace desktop space ${n}`, run: mono('workspace', n, `Workspace ${n}`) })),
        { id: 'monorail-settings', label: 'Monorail: Settings', group: 'Actions' as const, icon: 'columns', keywords: 'monorail preferences window manager', run: mono('settings', undefined, 'Opened Monorail’s settings') },
        { id: 'monorail-page', label: 'Other Apps by Ashforde (Monorail)', group: 'Go to' as const, icon: 'columns', keywords: 'monorail ashforde apps window manager install update', run: () => store.go({ name: 'settings', arg: 'features#ashfordeApps' }) },
      ];
    })(),
    // Hand-offs to the system's own apps (Settings → Open with chooses which).
    ...(() => {
      const wx = store.settings?.island.place;
      const mac = store.info?.platform === 'darwin';
      return [
        { id: 'native-weather', label: wx ? `Open ${wx.name} in the Weather App` : 'Open the Weather App', group: 'Actions' as const, icon: 'sun', keywords: 'weather forecast app native system', run: () => openNative('weather', wx ? { lat: wx.lat, lon: wx.lon, label: wx.name } : {}, store.toast) },
        ...(wx ? [{ id: 'native-weather-map', label: `Show ${wx.name} on a Map`, group: 'Actions' as const, icon: 'map', keywords: 'maps apple google place', run: () => openNative('maps', { lat: wx.lat, lon: wx.lon, label: wx.name }, store.toast) }] : []),
        ...(mac ? [{ id: 'native-findmy', label: 'Open Find My', group: 'Actions' as const, icon: 'map', keywords: 'find my devices items airtag people locate lost', run: () => openNative('findMy', {}, store.toast) }] : []),
        { id: 'native-calendar', label: 'Open Today in the Calendar App', group: 'Actions' as const, icon: 'calendar', keywords: 'calendar app native system day events', run: () => openNative('calendar', { date: Date.now() }, store.toast) },
        { id: 'native-contacts', label: 'Open the Contacts App', group: 'Actions' as const, icon: 'smile', typed: true, keywords: 'contacts address book people', run: () => openNative('contacts', {}, store.toast) },
        { id: 'native-clock', label: 'Open the Clock App', group: 'Actions' as const, icon: 'clock', typed: true, keywords: 'clock alarm timer stopwatch world', run: () => openNative('clock', {}, store.toast) },
        { id: 'native-settings', label: 'Apps That Open Your Files…', group: 'Go to' as const, icon: 'settings', keywords: 'open with default apps maps weather calendar mail google apple native', run: () => store.go({ name: 'settings', arg: 'files#openWith' }) },
      ];
    })(),
    { id: 'capture', label: 'Copy Text from Screen Area', group: 'Actions', icon: 'text', keywords: 'ocr capture scan qr barcode', run: async () => {
      const r = await api.capture.text();
      if (!r) return;
      const out = r.code ?? r.text;
      if (out) { await api.files.copyText(out); store.toast(r.code ? 'QR code copied' : 'Text copied'); } else store.toast('No text found in that area');
    } },
    { id: 'clip-ocr', label: 'Copy Text from Image on Clipboard', group: 'Actions', icon: 'clipboard', keywords: 'ocr', run: async () => {
      const r = await api.capture.clipboardImage();
      if (r?.text || r?.code) { await api.files.copyText(r.code ?? r.text); store.toast('Text copied'); } else store.toast('No image with text on the clipboard');
    } },
    { id: 'clip-collect', label: 'Paste One by One: Collect What I Copy', group: 'Actions', icon: 'clipboard', keywords: 'paste queue paste stack clipboard sequential several', run: async () => { await api.island.queueStart(); store.toast('Copy what you want to paste; each paste then takes the next one'); } },
    { id: 'clip-queue-stop', label: 'Stop Pasting One by One', group: 'Actions', icon: 'clipboard', keywords: 'paste queue stop clear', run: async () => { await api.island.queueStop(); } },
    { id: 'snippet-new', label: 'New Typed Snippet', group: 'Actions', icon: 'text', keywords: 'text expansion abbreviation autotext', run: async () => { store.go({ name: 'snippets' }); } },
    { id: 'read-aloud', label: 'Read Aloud', group: 'Actions', icon: 'audio', keywords: 'speak text to speech tts voice listen selected dyslexia', run: async () => { const r = await api.reading.speak(textToRead()); if (!r.ok && r.message) store.toast(r.message); } },
    { id: 'read-aloud-stop', label: 'Stop Reading Aloud', group: 'Actions', icon: 'pause', keywords: 'speak voice quiet silence', run: async () => { await api.reading.stop(); } },
    { id: 'send-to', label: 'Send Selection to…', group: 'Actions', icon: 'send', keywords: 'send to note task event mail device ai shelf cue share forward turn into', run: async () => { if (store.selection.length) openSendTo(filesItem(store.selection)); else store.toast('Select a file first'); } },
    { id: 'inbox-catch', label: 'Catch Something…', group: 'Actions', icon: 'inbox', keywords: 'inbox capture quick thought idea note jot later', run: async () => { await api.inbox.card('open'); } },
    { id: 'plan-day', label: 'Plan My Day', group: 'Actions', icon: 'calendar', keywords: 'time block today schedule three tasks morning', run: async () => { store.go({ name: 'home', arg: 'plan' }); } },
    { id: 'wrap-up', label: 'Wrap Up the Day', group: 'Actions', icon: 'check', keywords: 'shutdown end of day evening tomorrow journal', run: async () => { store.go({ name: 'home', arg: 'wrap' }); } },
    { id: 'focus', label: 'Start a 25-Minute Focus', group: 'Actions', icon: 'timer', keywords: 'pomodoro timer', run: async () => { await api.island.focus('start', 25); store.toast('Focus started — see you in 25 minutes'); } },
    { id: 'focus-stop', label: 'Stop Focus Timer', group: 'Actions', icon: 'timer', run: async () => { await api.island.focus('stop'); } },
    // Menu bar icons live behind Keeper's divider only on a Mac.
    ...(store.info?.platform === 'darwin' ? [{ id: 'menubar-icons-show', label: 'Show Hidden Menu Bar Icons', group: 'Actions' as const, icon: 'eye', keywords: 'menu bar icons hidden status items divider notch', run: async () => { const s = await api.menuBar.peek(); if (!s.divider) store.toast(s.availability.line); } }] : []),
    // Snap windows: the window in front goes into place (Keeper's own, from its palette).
    { id: 'snap-left', label: 'Snap Window to the Left Half', group: 'Actions', icon: 'columns', keywords: 'tile window half side by side', run: async () => { const r = await api.snap.run('left'); if (!r.ok && r.message) store.toast(r.message); } },
    { id: 'snap-right', label: 'Snap Window to the Right Half', group: 'Actions', icon: 'columns', keywords: 'tile window half side by side', run: async () => { const r = await api.snap.run('right'); if (!r.ok && r.message) store.toast(r.message); } },
    { id: 'snap-fill', label: 'Make Window Fill the Screen', group: 'Actions', icon: 'columns', keywords: 'maximise maximize window full', run: async () => { const r = await api.snap.run('maximise'); if (!r.ok && r.message) store.toast(r.message); } },
    { id: 'displays-keep', label: 'Keep This Screen Mode', group: 'Actions', icon: 'check', keywords: 'display resolution keep confirm screen size', run: async () => { await api.displays.keep(); } },
    { id: 'battery-trip', label: 'Charge the Battery to 100% for a Trip', group: 'Actions', icon: 'battery', keywords: 'battery charge limit full trip travel 100', run: async () => { store.go({ name: 'battery' }); try { await api.batteryCare.setTrip(true); } catch (e) { store.toast(e instanceof Error ? e.message : String(e)); } } },
    { id: 'app-updates', label: 'Check App Updates', group: 'Actions', icon: 'refresh', keywords: 'update apps outdated upgrade newer version software updater homebrew winget flatpak snap', run: async () => { store.go({ name: 'apps', arg: 'updates' }); await api.appUpdates.check().catch(() => undefined); } },
    { id: 'blocking-hour', label: 'Block Distractions for an Hour', group: 'Actions', icon: 'block', keywords: 'focus block sites apps social news', run: async () => {
      try {
        const st = await api.focusBlock.status();
        const list = st.data.focusList ?? st.data.lists[0]?.id;
        if (!list) { store.go({ name: 'blocking' }); return; }
        await api.focusBlock.start(list, 60);
        store.toast('Blocking distractions for an hour');
      } catch (e) { store.toast(e instanceof Error ? e.message : String(e)); }
    } },
    // Stage mode: a clean screen (presets from the Stage page).
    { id: 'stage-recording', label: 'Stage: Recording', group: 'Actions', icon: 'video', keywords: 'clean screen record hide desktop dock do not disturb spotlight keystrokes', run: async () => { const r = await api.stage.start('recording'); store.toast(r.on || r.countdownEndsAt ? 'Stage: Recording' : 'Stage could not start'); } },
    { id: 'stage-presenting', label: 'Stage: Presenting', group: 'Actions', icon: 'eye', keywords: 'clean screen present slides talk do not disturb', run: async () => { await api.stage.start('presenting'); store.toast('Stage: Presenting'); } },
    { id: 'stage-screenshot', label: 'Stage: Screenshot', group: 'Actions', icon: 'screenshot', keywords: 'clean screen screenshot hide desktop dock menu bar backdrop', run: async () => { await api.stage.start('screenshot'); store.toast('Stage: Screenshot'); } },
    { id: 'draw-on-screen', label: 'Draw on Screen', group: 'Actions', icon: 'rename', keywords: 'draw pen highlight annotate screen present ink spotlight arrow', run: async () => { try { await api.stage.draw(true); } catch (e) { store.toast(e instanceof Error ? e.message : String(e)); } } },
    { id: 'stage-stop', label: 'Stop Stage and Put Everything Back', group: 'Actions', icon: 'eyeOff', keywords: 'stage end clean screen restore', run: async () => { await api.stage.stop(); store.toast('Stage is off; everything is back'); } },
    { id: 'studio-record', label: 'Studio: Record the Screen', group: 'Actions', icon: 'video', keywords: 'record screen video zoom cursor tutorial demo screencast', run: async () => { store.go({ name: 'studio' }); const r = await api.studio.record(); if (r.error) store.toast(r.error); } },
    { id: 'studio-clean-record', label: 'Studio: Clean the Screen and Record', group: 'Actions', icon: 'video', keywords: 'stage record screen video hide desktop dock clean', run: async () => { store.go({ name: 'studio' }); const r = await api.studio.record({ stage: true }); if (r.error) store.toast(r.error); } },
    { id: 'present', label: 'Presentation Mode', group: 'Actions', icon: 'eye', keywords: 'hide desktop do not disturb', run: async () => { const on = await api.island.presentation(true); store.toast(on ? 'Presentation mode on' : 'Presentation mode is not available here'); } },
    { id: 'present-off', label: 'End Presentation Mode', group: 'Actions', icon: 'eye', run: async () => { await api.island.presentation(false); } },
    { id: 'firewall-quiet', label: 'Firewall: Quiet Mode (allow and remember)', group: 'Actions', icon: 'shield', keywords: 'silent mode network', run: () => void api.fw.setMode('silent-allow').then(() => store.toast('Firewall: quiet mode')) },
    { id: 'firewall-ask', label: 'Firewall: Ask About New Connections', group: 'Actions', icon: 'shield', keywords: 'alert mode network', run: () => void api.fw.setMode('alert').then(() => store.toast('Firewall: asking about new connections')) },
    { id: 'controls-public', label: 'Quick Controls: Public Wi-Fi Preset', group: 'Actions', icon: 'shield', keywords: 'cafe hotel airport lock down network', run: () => store.go({ name: 'controls', arg: 'preset:public-wifi' }) },
    { id: 'controls-lockdown', label: 'Quick Controls: Lockdown Preset', group: 'Actions', icon: 'shield', keywords: 'block everything privacy', run: () => store.go({ name: 'controls', arg: 'preset:lockdown' }) },
    // Every catalogue setting for this system, found by typing ("swappiness", "show hidden files"…).
    ...CATALOG.filter((x) => x.os === (store.info?.platform ?? 'darwin')).map((x) => ({ id: `catalog-${x.id}`, label: `Setting: ${x.title}`, group: 'Actions' as const, icon: 'settings', typed: true, keywords: `${x.category} ${(x.keywords ?? []).join(' ')}`, run: () => store.go({ name: 'catalog', q: x.title }) })),
    { id: 'controls-wifi', label: 'Turn Wi-Fi On or Off', group: 'Actions', icon: 'globe', keywords: 'wireless radio network', run: () => store.go({ name: 'controls', q: 'wi-fi' }) },
    { id: 'firewall-map', label: 'Network Map', group: 'Actions', icon: 'globe', keywords: 'world map connections countries servers', run: () => store.go({ name: 'firewall', arg: 'connections' }) },
    { id: 'force-quit', label: 'Force Quit Applications…', group: 'Actions', icon: 'warning', kbd: mod === '⌘' ? '⌥⌘⎋' : 'Ctrl+Alt+Esc', keywords: 'kill end task frozen not responding hung', run: () => window.dispatchEvent(new Event('keeper:force-quit-anywhere')) },
    // System monitor.
    { id: 'health-history', label: 'Health History', group: 'Go to', icon: 'clock', keywords: 'cpu memory network disk graph chart year over time peaks', run: () => store.go({ name: 'health', arg: 'history' }) },
    { id: 'dev-servers', label: 'Dev Servers and Ports', group: 'Go to', icon: 'server', keywords: 'localhost port listening vite next project stop restart', run: () => store.go({ name: 'health', arg: 'dev' }) },
    { id: 'agents-running', label: 'Running AI Agents', group: 'Go to', icon: 'agent', keywords: 'coding agent cli model server ollama quit session', run: () => store.go({ name: 'health', arg: 'dev' }) },
    { id: 'sensors', label: 'Graphics, Fans and Power', group: 'Go to', icon: 'sun', keywords: 'gpu temperature fan watts battery drain sensors', run: () => store.go({ name: 'health', arg: 'sensors' }) },
    { id: 'monitor-tray', label: 'Menu-bar Readings…', group: 'Actions', icon: 'chart', keywords: 'tray menu bar cpu memory network live stats', run: () => store.go({ name: 'health', arg: 'settings' }) },
    { id: 'containers', label: 'Containers', group: 'Go to', icon: 'server', keywords: 'docker podman stats images volumes stop restart', run: () => store.go({ name: 'health', arg: 'containers' }) },
    { id: 'health-sound', label: 'Volume per App', group: 'Go to', icon: 'audio', keywords: 'mixer sound mute output device browser tabs memory energy app nap', run: () => store.go({ name: 'health', arg: 'apps' }) },
    { id: 'launcher', label: 'Tool Launcher', group: 'Actions', icon: 'grid', keywords: 'tools find open window', run: () => void api.sysmon.openLauncher() },
    { id: 'eject', label: 'Eject All Disks', group: 'Actions', icon: 'arrowUp', keywords: 'unmount drives usb', run: async () => { const r = await api.system.ejectAll(); store.toast(r.ejected.length ? `Ejected ${r.ejected.join(', ')}` : 'No disks to eject'); } },
    { id: 'mail-compose', label: 'New Mail Message', group: 'Actions', icon: 'mail', keywords: 'email write compose send', run: () => store.go({ name: 'mail', arg: 'compose' }) },
    { id: 'calendar-new', label: 'New Event…', group: 'Actions', icon: 'calendar', keywords: 'meeting appointment add schedule', run: () => store.go({ name: 'calendar', arg: 'new' }) },
    { id: 'calendar-import', label: 'Import Calendar File…', group: 'Actions', icon: 'calendar', keywords: 'ics ical import events file', run: () => void api.pim.importIcs().then((n) => { if (n) store.toast(`Imported ${n} event${n === 1 ? '' : 's'}`); }) },
    { id: 'planner-new', label: 'New Task…', group: 'Actions', icon: 'plus', keywords: 'todo task add reminder', run: () => store.go({ name: 'planner', arg: 'new' }) },
    ...[5, 10, 25].map((m) => ({ id: `timer-${m}`, label: `Start a ${m}-Minute Timer`, group: 'Actions' as const, icon: 'timer', keywords: 'countdown kitchen', run: async () => { await api.pim.startTimer(`${m} min`, m * 60_000); store.toast(`Timer set for ${m} minutes`); } })),
    { id: 'shelf-clear', label: 'Clear the Shelf', group: 'Actions', icon: 'island', run: async () => { await api.island.clearShelf(); } },
    ...tracksCommands,
  ], [store, meshCmds, extCmds, ambienceCmds, voiceCmds, rdc, tracksCommands, t, hiddenRoutes, photos]);

  const allowed = useCommandFilter();
  const looksLikeSearch = text.trim().length > 1;
  const results = useMemo(() => {
    const q = text.trim();
    const matched = commands
      // Commands of features that are off are not offered.
      .filter((c) => allowed(c.id) && (!c.route || allowed(c.route)))
      .map((c) => ({ c, s: q ? Math.max(fuzzyScore(c.label, q), fuzzyScore(c.keywords ?? '', q) - 10) : 0 }))
      .filter((x) => x.s >= 0 && (q || !x.c.typed));
    // Each kind once: the kind with the best match first (with nothing typed: what was run last, common ones, then pages, then actions).
    const best: Record<string, number> = {};
    for (const x of matched) best[x.c.group] = Math.max(best[x.c.group] ?? -1, x.s);
    const rank: Record<string, number> = { Recent: 0, 'Go to': 1, Actions: 2, Search: 3 };
    const scored = matched
      .sort((a, b) => (a.c.group === b.c.group ? b.s - a.s : q ? best[b.c.group] - best[a.c.group] || rank[a.c.group] - rank[b.c.group] : rank[a.c.group] - rank[b.c.group]))
      .map((x) => x.c);
    const search: Command[] = looksLikeSearch ? [{ id: 'search', label: `Search files for “${q}”`, group: 'Search', icon: 'search', kbd: '↩', run: () => store.go({ name: 'search', q }) }] : [];
    if (!q) {
      const byId = new Map(scored.map((c) => [c.id, c]));
      const recent = recentIds().map((id) => byId.get(id)).filter((c): c is Command => !!c).map((c) => ({ ...c, group: 'Recent' as const }));
      const common = COMMON.filter((id) => !recent.some((r) => r.id === id)).map((id) => byId.get(id)).filter((c): c is Command => !!c).map((c) => ({ ...c, group: 'Common' as const }));
      const shown = new Set([...recent, ...common].map((c) => c.id));
      return [...recent, ...common, ...scored.filter((c) => !shown.has(c.id))];
    }
    // A strong command match goes first; otherwise searching files does.
    const commandFirst = /^(theme|look)\b/i.test(q) && scored.some((c) => c.id.startsWith('theme-'));
    return q && scored.length && (commandFirst || fuzzyScore(scored[0].label, q) >= 90) ? [...scored, ...search] : [...search, ...scored];
  }, [commands, text, looksLikeSearch, store, allowed]);

  useEffect(() => setIndex(0), [text]);
  useEffect(() => {
    listRef.current?.querySelector('.q-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    noteRecent(c.id);
    onClose();
    void c.run();
  };

  return (
    <div className="palette-back" onMouseDown={onClose}>
      <div className="quick palette" ref={boxRef} role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="q-input">
          <Icon name="sparkle" size={18} />
          <input
            autoFocus
            role="combobox"
            aria-label="Command palette"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-autocomplete="list"
            aria-activedescendant={results[index] ? `palette-opt-${index}` : undefined}
            value={text}
            placeholder="Type a command, a page, or what you are looking for…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setIndex(0); }
              else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); setIndex(Math.max(0, results.length - 1)); }
              else if (e.key === 'PageDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 8)); }
              else if (e.key === 'PageUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 8)); }
              else if (e.key === 'Enter') run(results[index]);
            }}
          />
        </div>
        <div className="q-results" ref={listRef} id="palette-results" role="listbox" aria-label="Commands">
          {results.map((c, i) => (
            <div key={c.id} role="presentation">
              {i === 0 || results[i - 1].group !== c.group ? <div className="group" role="presentation" aria-hidden>{c.group}</div> : null}
              <div id={`palette-opt-${i}`} role="option" aria-selected={i === index} className={`q-row ${i === index ? 'on' : ''}`} onMouseMove={() => { if (i !== index) setIndex(i); }} onClick={() => run(c)}>
                <Icon name={c.icon} size={15} />
                <span className="ellipsis">{c.label}</span>
                {c.kbd ? <span className="kbd" aria-hidden>{c.kbd}</span> : null}
              </div>
            </div>
          ))}
          {!results.length ? <div className="empty small" role="status">No matching command</div> : null}
        </div>
        <div className="q-foot" aria-hidden><span>↑↓ to move</span><span>↩ to run</span><span>esc to close</span></div>
      </div>
    </div>
  );
}
