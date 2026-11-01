// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The command palette: jump anywhere or run any action by typing a few letters.

import { openPermissions } from './PermissionsPanel';
import { accessCommands } from '../screen/palette';
import { FLOWS } from '../../core/guide/builtin';
import { openGuide } from '../guide';
import { useCommandFilter } from '../features';
import { useEffect, useMemo, useRef, useState } from 'react';
import { THEMES } from '../../core/themes';
import { TOOL_INFO, type ConvertTool } from '../../core/convert-types';
import { api } from '../api';
import { themePatch, toggleThemePatch } from '../theme';
import { mod, shift, useStore, type Route } from '../state';
import { Icon } from './Icon';
import { CATALOG } from '../../core/settings-catalog';
import { useTracksCommands } from '../screens/TracksSurfaces';
import '../styles/screens-a.css';
import { useMeshCommands } from '../screens/MeshParts';
import { useAmbienceCommands } from '../wallpaper/palette';
import { useVoiceCommands } from '../voice/palette';
import { openNative } from '../lib/native';

interface Command {
  id: string;
  label: string;
  group: 'Go to' | 'Actions' | 'Search';
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

const PAGES: [Route, string, string, string?][] = [
  [{ name: 'home' }, 'Home', 'home'],
  [{ name: 'cues' }, 'Cues', 'pin'],
  [{ name: 'recents' }, 'Recents', 'clock'],
  [{ name: 'downloads' }, 'Downloaded From', 'down', `${shift}${mod}J`],
  [{ name: 'library', arg: 'image' }, 'Images', 'image'],
  [{ name: 'library', arg: 'video' }, 'Videos', 'video'],
  [{ name: 'library', arg: 'audio' }, 'Music', 'audio'],
  [{ name: 'library', arg: 'document' }, 'Documents', 'document'],
  [{ name: 'library', arg: 'archive' }, 'Archives', 'archive'],
  [{ name: 'library', arg: 'installer' }, 'Installers', 'installer'],
  [{ name: 'library', arg: 'app' }, 'Apps', 'app'],
  [{ name: 'screenshots' }, 'Screenshots', 'screenshot'],
  [{ name: 'cleanup' }, 'Clean Up', 'broom', `${shift}${mod}K`],
  [{ name: 'duplicates' }, 'Duplicates', 'dupes', `${shift}${mod}D`],
  [{ name: 'space' }, 'Space Map', 'map'],
  [{ name: 'large' }, 'Large Files', 'weight'],
  [{ name: 'rules' }, 'Automations', 'rules'],
  [{ name: 'health' }, 'Health', 'bolt'],
  [{ name: 'health', arg: 'processes' }, 'Processes (Task Manager)', 'list'],
  [{ name: 'health', arg: 'services' }, 'Services', 'power'],
  [{ name: 'startup' }, 'Startup Items', 'power'],
  [{ name: 'apps' }, 'Applications', 'app'],
  [{ name: 'protection' }, 'Protection', 'shield'],
  [{ name: 'notes' }, 'Notes', 'document'],
  [{ name: 'notes', arg: 'today' }, 'Today’s Daily Note', 'calendar'],
  [{ name: 'notes', arg: 'graph' }, 'Notes Graph', 'graph'],
  [{ name: 'assistant' }, 'Assistant', 'assistant'],
  [{ name: 'tools' }, 'Toolbox', 'terminal'],
  [{ name: 'island' }, 'Island', 'island'],
  [{ name: 'history' }, 'History', 'history'],
  [{ name: 'settings' }, 'Settings', 'settings', `${mod},`],
];

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [text, setText] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const meshCmds = useMeshCommands(store.toast, store.go);
  const ambienceCmds = useAmbienceCommands(store.toast, store.go);
  const voiceCmds = useVoiceCommands(store.toast, store.go);
  // Remote Desktops: Quick Connect and each saved connection (when Remote Desktops → Where it appears allows it).
  const [rdc, setRdc] = useState<{ id: string; name: string; protocol: string }[] | null>(null);
  useEffect(() => {
    void Promise.all([api.rdc?.places(), api.rdc?.state()]).then(([p, s]) => setRdc(p?.palette && s ? s.connections.map((c) => ({ id: c.id, name: c.name, protocol: c.protocol })) : null)).catch(() => undefined);
  }, []);
  // Places & Tracks: "Where is my laptop?" for each device, item and person (its settings can leave these out).
  const tracksCommands = useTracksCommands(store.go);
  const commands = useMemo<Command[]>(() => [
    ...(rdc ? [
      { id: 'rdc-quick', label: 'Quick Connect to a Remote Desktop…', group: 'Actions' as const, icon: 'laptop', keywords: 'rdp vnc ssh remote desktop connect', run: () => void api.rdc.showQuick() },
      ...rdc.map((c) => ({ id: `rdc-${c.id}`, label: `Connect to ${c.name}`, group: 'Actions' as const, icon: 'laptop', typed: true, keywords: `remote desktop ${c.protocol}`, run: () => store.tabs.open({ name: 'rdc', q: `connect:${c.id}` }) })),
    ] : []),
    // Keeper Mesh: copy a device's address, on/off, exit node (as placed under Settings → Keeper Mesh).
    ...meshCmds,
    ...ambienceCmds,
    ...voiceCmds,
    ...PAGES.map(([route, label, icon, kbd]) => ({ id: `go-${label}`, label, group: 'Go to' as const, icon, kbd, route: route.name, run: () => store.go(route) })),
    { id: 'browse', label: 'Browse Home Folder', group: 'Go to', icon: 'folder', run: () => store.go({ name: 'browse', arg: store.info?.home }) },
    { id: 'rescan', label: 'Rescan Library', group: 'Actions', icon: 'refresh', keywords: 'index refresh reload', run: async () => { await api.library.rescan(); store.toast('Reading your folders…'); } },
    { id: 'terminal', label: 'Terminal', group: 'Actions', icon: 'terminal', keywords: 'shell console command line ssh sftp tabs panes', run: () => store.go({ name: 'terminal' }) },
    { id: 'terminal-window', label: 'New Terminal Window', group: 'Actions', icon: 'terminal', keywords: 'shell console', run: () => void api.terminal.openWindow() },
    { id: 'terminal-quick', label: 'Drop-down Terminal', group: 'Actions', icon: 'terminal', keywords: 'quake shell console', run: () => void api.terminal.toggleQuick() },
    { id: 'look', label: 'Switch Theme (last two used)', group: 'Actions', icon: 'palette', kbd: `${mod}${shift}L`, keywords: 'theme look colour color playful minimal', run: () => store.settings && store.updateSettings(toggleThemePatch(store.settings)) },
    // Every conversion tool, found by typing ("redact", "gif", "transcribe"…).
    ...(Object.keys(TOOL_INFO) as ConvertTool[]).map((t) => ({ id: `convert-${t}`, label: `${{ video: 'Video', audio: 'Audio', image: 'Pictures', pdf: 'PDF', doc: 'Documents', file: 'Files', convert: 'Convert' }[TOOL_INFO[t].category]}: ${TOOL_INFO[t].label}`, group: 'Actions' as const, icon: 'refresh', typed: true, keywords: `convert ${TOOL_INFO[t].description}`, run: () => store.go({ name: 'convert', arg: JSON.stringify({ tool: t, files: store.selection }) }) })),
    // "How do I…?": every guided flow, found by what the person wants to do.
    { id: 'todo', label: 'To do — what is worth fixing', group: 'Go to', icon: 'check', keywords: 'todo fix issues problems recommendations space security privacy', run: () => store.go({ name: 'todo' }) },
    ...FLOWS.map((f) => ({ id: `howto-${f.id}`, label: `How do I… ${f.title.toLowerCase()}?`, group: 'Actions' as const, icon: 'sparkle', typed: true, keywords: `how do i how to help ${f.title} ${HOWTO_WORDS[f.id] ?? ''}`, run: () => openGuide(`flow:${f.id}`) })),
    ...THEMES.map((t) => ({ id: `theme-${t.id}`, label: `Theme: ${t.name}`, group: 'Actions' as const, icon: 'palette', typed: true, keywords: `theme look ${t.tags.join(' ')}`, run: () => store.settings && store.updateSettings(themePatch(store.settings, t.id)) })),
    { id: 'hidden-files', label: store.settings?.showHidden ? 'Hide Hidden Files' : 'Show Hidden Files', group: 'Actions', icon: store.settings?.showHidden ? 'eyeOff' : 'eye', kbd: `${mod}${shift}.`, keywords: 'dot files dotfiles invisible show hide', run: () => store.settings && store.updateSettings({ showHidden: !store.settings.showHidden }) },
    { id: 'locked-folders', label: 'Locked Folders', group: 'Actions', icon: 'lock', keywords: 'lock unlock encrypt password protect vault private', run: () => store.go({ name: 'settings', arg: 'locked' }) },
    { id: 'appearance', label: 'Toggle Dark Mode', group: 'Actions', icon: 'moon', keywords: 'theme light appearance', run: () => store.settings && store.updateSettings({ appearance: store.settings.appearance === 'dark' ? 'light' : 'dark' }) },
    { id: 'view', label: store.view === 'grid' ? 'Show as List' : 'Show as Grid', group: 'Actions', icon: store.view === 'grid' ? 'list' : 'grid', kbd: store.view === 'grid' ? `${mod}2` : `${mod}1`, run: () => store.setView(store.view === 'grid' ? 'list' : 'grid') },
    { id: 'inspector', label: store.inspector ? 'Hide Inspector' : 'Show Inspector', group: 'Actions', icon: 'info', kbd: mod === '⌘' ? '⌘⌥I' : 'Ctrl+Alt+I', run: () => store.setInspector(!store.inspector) },
    { id: 'sidebar-toggle', label: 'Fold or open the sidebar', group: 'Actions', icon: 'columns', kbd: mod === '⌘' ? '⌘⌥S' : 'Ctrl+Alt+S', run: () => window.dispatchEvent(new Event('keeper-toggle-sidebar')) },
    { id: 'permissions', label: 'Permissions — set up what Keeper may use', group: 'Go to', icon: 'shield', keywords: 'permissions privacy accessibility screen recording microphone camera full disk access automation allow', run: () => openPermissions() },
    { id: 'inspector-settings', label: 'Inspector: when it shows…', group: 'Actions', icon: 'settings', run: () => store.go({ name: 'settings', arg: 'inspector' }) },
    // Cues: a new cue for the app or page in front (the composer pops up beside it).
    { id: 'cue-new', label: 'New Cue for What’s in Front…', group: 'Actions', icon: 'pin', keywords: 'cue remind reminder note checklist app page site when back later', run: () => void api.cues?.compose({ attach: ['page', 'app'] }) },
    { id: 'awake', label: 'Keep Awake for 1 Hour', group: 'Actions', icon: 'coffee', keywords: 'caffeine sleep stay awake', run: async () => { await api.island.keepAwake(true, { minutes: 60 }); store.toast('Staying awake for the next hour'); } },
    { id: 'awake-off', label: 'Allow Sleep Again', group: 'Actions', icon: 'moon', keywords: 'keep awake stop', run: async () => { await api.island.keepAwake(false); store.toast('Your computer can sleep again'); } },
    { id: 'awake-toggle', label: 'Turn Keep Awake On or Off', group: 'Actions', icon: 'coffee', keywords: 'caffeine sleep stay awake toggle insomnia', run: async () => { const s = await api.awake.toggle(); store.toast(s.on ? 'Keeping awake until you turn it off' : 'Your computer can sleep again'); } },
    ...(store.settings?.awake?.quick ?? []).filter((m) => m !== 60).map((m) => ({ id: `awake-${m}`, label: `Keep Awake for ${m >= 60 ? `${m / 60} Hour${m === 60 ? '' : 's'}` : `${m} Minutes`}`, group: 'Actions' as const, icon: 'coffee', typed: true, keywords: 'caffeine sleep stay awake', run: async () => { await api.awake.start({ minutes: m }); store.toast(`Staying awake for ${m >= 60 ? `${m / 60} h` : `${m} min`}`); } })),
    // Keeper Link: Get help, Help someone, your devices (places chosen under Devices → Remote Access).
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
        { id: 'monorail-page', label: 'Ashforde Apps (Monorail)', group: 'Go to' as const, icon: 'columns', keywords: 'monorail ashforde apps window manager install update', run: () => store.go({ name: 'settings', arg: 'ashforde' }) },
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
        { id: 'native-settings', label: 'Open With: Choose Which Apps Keeper Uses', group: 'Go to' as const, icon: 'settings', keywords: 'open with default apps maps weather calendar mail google apple native', run: () => store.go({ name: 'settings', arg: 'open-with' }) },
      ];
    })(),
    { id: 'awake-page', label: 'Keep Awake', group: 'Go to', icon: 'coffee', keywords: 'caffeine sleep stay awake triggers closed lid lid statistics', run: () => store.go({ name: 'awake' }) },
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
    { id: 'focus', label: 'Start a 25-Minute Focus', group: 'Actions', icon: 'timer', keywords: 'pomodoro timer', run: async () => { await api.island.focus('start', 25); store.toast('Focus started — see you in 25 minutes'); } },
    { id: 'focus-stop', label: 'Stop Focus Timer', group: 'Actions', icon: 'timer', run: async () => { await api.island.focus('stop'); } },
    // Stage mode: a clean screen (presets from the Stage page).
    { id: 'stage-recording', label: 'Stage: Recording', group: 'Actions', icon: 'video', keywords: 'clean screen record hide desktop dock do not disturb spotlight keystrokes', run: async () => { const r = await api.stage.start('recording'); store.toast(r.on || r.countdownEndsAt ? 'Stage: Recording' : 'Stage could not start'); } },
    { id: 'stage-presenting', label: 'Stage: Presenting', group: 'Actions', icon: 'eye', keywords: 'clean screen present slides talk do not disturb', run: async () => { await api.stage.start('presenting'); store.toast('Stage: Presenting'); } },
    { id: 'stage-screenshot', label: 'Stage: Screenshot', group: 'Actions', icon: 'screenshot', keywords: 'clean screen screenshot hide desktop dock menu bar backdrop', run: async () => { await api.stage.start('screenshot'); store.toast('Stage: Screenshot'); } },
    { id: 'stage-stop', label: 'Stop Stage and Put Everything Back', group: 'Actions', icon: 'eyeOff', keywords: 'stage end clean screen restore', run: async () => { await api.stage.stop(); store.toast('Stage is off; everything is back'); } },
    { id: 'stage-page', label: 'Stage', group: 'Go to', icon: 'eye', keywords: 'clean screen recording presenting screenshot presets spotlight keystrokes monitor input display keys', run: () => store.go({ name: 'stage' }) },
    { id: 'present', label: 'Presentation Mode', group: 'Actions', icon: 'eye', keywords: 'hide desktop do not disturb', run: async () => { const on = await api.island.presentation(true); store.toast(on ? 'Presentation mode on' : 'Presentation mode is not available here'); } },
    { id: 'present-off', label: 'End Presentation Mode', group: 'Actions', icon: 'eye', run: async () => { await api.island.presentation(false); } },
    { id: 'firewall', label: 'Firewall', group: 'Go to', icon: 'shield', keywords: 'network block allow rules connections outgoing incoming', run: () => store.go({ name: 'firewall' }) },
    { id: 'firewall-quiet', label: 'Firewall: Quiet Mode (allow and remember)', group: 'Actions', icon: 'shield', keywords: 'silent mode network', run: () => void api.fw.setMode('silent-allow').then(() => store.toast('Firewall: quiet mode')) },
    { id: 'firewall-ask', label: 'Firewall: Ask About New Connections', group: 'Actions', icon: 'shield', keywords: 'alert mode network', run: () => void api.fw.setMode('alert').then(() => store.toast('Firewall: asking about new connections')) },
    { id: 'controls', label: 'Quick Controls', group: 'Go to', icon: 'settings', keywords: 'wifi bluetooth airplane vpn dns firewall camera microphone privacy toggle switch settings', run: () => store.go({ name: 'controls' }) },
    { id: 'controls-public', label: 'Quick Controls: Public Wi-Fi Preset', group: 'Actions', icon: 'shield', keywords: 'cafe hotel airport lock down network', run: () => store.go({ name: 'controls', arg: 'preset:public-wifi' }) },
    { id: 'controls-lockdown', label: 'Quick Controls: Lockdown Preset', group: 'Actions', icon: 'shield', keywords: 'block everything privacy', run: () => store.go({ name: 'controls', arg: 'preset:lockdown' }) },
    { id: 'catalog', label: 'System Settings+', group: 'Go to', icon: 'settings', keywords: 'defaults registry gsettings sysctl tweak hidden setting catalogue terminal command', run: () => store.go({ name: 'catalog' }) },
    { id: 'appcontrols', label: 'App Controls', group: 'Go to', icon: 'cpu', keywords: 'per app limit bandwidth cpu memory priority vpn route notifications volume gpu', run: () => store.go({ name: 'appcontrols' }) },
    { id: 'browsers', label: 'Browser Tabs', group: 'Go to', icon: 'globe', keywords: 'tabs chrome firefox edge mute sleep site permissions trackers', run: () => store.go({ name: 'browsers' }) },
    // Every catalogue setting for this system, found by typing ("swappiness", "show hidden files"…).
    ...CATALOG.filter((x) => x.os === (store.info?.platform ?? 'darwin')).map((x) => ({ id: `catalog-${x.id}`, label: `Setting: ${x.title}`, group: 'Actions' as const, icon: 'settings', typed: true, keywords: `${x.category} ${(x.keywords ?? []).join(' ')}`, run: () => store.go({ name: 'catalog', q: x.title }) })),
    { id: 'controls-wifi', label: 'Turn Wi-Fi On or Off', group: 'Actions', icon: 'globe', keywords: 'wireless radio network', run: () => store.go({ name: 'controls', q: 'wi-fi' }) },
    { id: 'firewall-map', label: 'Network Map', group: 'Go to', icon: 'globe', keywords: 'world map connections countries servers', run: () => store.go({ name: 'firewall', arg: 'connections' }) },
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
    { id: 'mail-open', label: 'Mail', group: 'Go to', icon: 'mail', keywords: 'inbox email', run: () => store.go({ name: 'mail' }) },
    { id: 'calendar-new', label: 'New Event…', group: 'Actions', icon: 'calendar', keywords: 'meeting appointment add schedule', run: () => store.go({ name: 'calendar', arg: 'new' }) },
    { id: 'calendar-import', label: 'Import Calendar File…', group: 'Actions', icon: 'calendar', keywords: 'ics ical import events file', run: () => void api.pim.importIcs().then((n) => { if (n) store.toast(`Imported ${n} event${n === 1 ? '' : 's'}`); }) },
    { id: 'calendar-open', label: 'Calendar', group: 'Go to', icon: 'calendar', keywords: 'events schedule agenda', run: () => store.go({ name: 'calendar' }) },
    { id: 'reminder-new', label: 'Reminders', group: 'Go to', icon: 'listCheck', keywords: 'todo tasks to-do', run: () => store.go({ name: 'reminders' }) },
    { id: 'alarm-new', label: 'Alarms', group: 'Go to', icon: 'alarm', keywords: 'wake clock alarm', run: () => store.go({ name: 'alarms', arg: 'alarms' }) },
    ...[5, 10, 25].map((m) => ({ id: `timer-${m}`, label: `Start a ${m}-Minute Timer`, group: 'Actions' as const, icon: 'timer', keywords: 'countdown kitchen', run: async () => { await api.pim.startTimer(`${m} min`, m * 60_000); store.toast(`Timer set for ${m} minutes`); } })),
    { id: 'shelf-clear', label: 'Clear the Shelf', group: 'Actions', icon: 'island', run: async () => { await api.island.clearShelf(); } },
    ...tracksCommands,
  ], [store, meshCmds, ambienceCmds, voiceCmds, rdc, tracksCommands]);

  const allowed = useCommandFilter();
  const looksLikeSearch = text.trim().length > 1;
  const results = useMemo(() => {
    const q = text.trim();
    const scored = commands
      // Commands of features that are off are not offered.
      .filter((c) => allowed(c.id) && (!c.route || allowed(c.route)))
      .map((c) => ({ c, s: q ? Math.max(fuzzyScore(c.label, q), fuzzyScore(c.keywords ?? '', q) - 10) : 0 }))
      .filter((x) => x.s >= 0 && (q || !x.c.typed))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
    const search: Command[] = looksLikeSearch ? [{ id: 'search', label: `Search files for “${q}”`, group: 'Search', icon: 'search', kbd: '↩', run: () => store.go({ name: 'search', q }) }] : [];
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
    onClose();
    void c.run();
  };

  return (
    <div className="palette-back" onMouseDown={onClose}>
      <div className="quick palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="q-input">
          <Icon name="sparkle" size={18} />
          <input
            autoFocus
            value={text}
            placeholder="Type a command, a page, or what you are looking for…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter') run(results[index]);
            }}
          />
        </div>
        <div className="q-results" ref={listRef}>
          {results.map((c, i) => (
            <div key={c.id}>
              {i === 0 || results[i - 1].group !== c.group ? <div className="group">{c.group}</div> : null}
              <div className={`q-row ${i === index ? 'on' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => run(c)}>
                <Icon name={c.icon} size={15} />
                <span className="ellipsis">{c.label}</span>
                {c.kbd ? <span className="kbd">{c.kbd}</span> : null}
              </div>
            </div>
          ))}
          {!results.length ? <div className="empty small">No matching command</div> : null}
        </div>
        <div className="q-foot"><span>↑↓ to move</span><span>↩ to run</span><span>esc to close</span></div>
      </div>
    </div>
  );
}
