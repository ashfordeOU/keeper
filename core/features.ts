// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every part of Keeper that can be switched off, what it costs while on, and
// what it needs. Turning a feature off really stops it: no window, no timers,
// no watchers, nothing loaded, and its pages, menu items and commands hidden.
//
// To add a feature: add an entry below. Give it `routes` (pages it owns) and
// `commands` (palette ids it owns) so the interface hides them, and in the
// main process ask `featureOn(id)` / `onFeature(id, …)` before starting
// anything (electron/services/features.ts).

import type { AllSettings } from './settings';

export type FeatureGroup = 'Library' | 'Tidy' | 'Island' | 'Desktop' | 'AI' | 'Connections' | 'System';

export const FEATURE_GROUPS: FeatureGroup[] = ['Library', 'Tidy', 'Island', 'Desktop', 'AI', 'Connections', 'System'];

export type CostLevel = 'none' | 'low' | 'medium' | 'high';

export interface FeatureCost {
  /** overall, for sorting and the coloured dot */
  level: CostLevel;
  /** plain English: what runs while it is on */
  background?: string;
  windows?: string;
  memory?: string;
}

export interface FeatureDef {
  id: string;
  name: string;
  description: string;
  group: FeatureGroup;
  defaultOn: boolean;
  cost: FeatureCost;
  /** other features this one needs; it is off while any of them is off */
  requires?: string[];
  /** cannot be switched off (the library itself) */
  always?: boolean;
  /** only the person's own switch changes it: presets, saved sets and safe mode leave it as it is */
  ownChoice?: boolean;
  /** pages this feature owns: hidden from the sidebar and palette when off */
  routes?: string[];
  /** command palette ids (or id prefixes ending in "*") it owns */
  commands?: string[];
  /** only on these systems */
  platforms?: NodeJS.Platform[];
  /** an older setting already switches this: read and write through it */
  bridge?: { get(s: AllSettings): boolean; set(on: boolean, s: AllSettings): Partial<AllSettings> };
}

const island = (key: keyof AllSettings['island']) => ({
  get: (s: AllSettings) => s.island?.[key] !== false,
  set: (on: boolean, s: AllSettings) => ({ island: { ...s.island, [key]: on } }) as Partial<AllSettings>,
});

export const FEATURES: FeatureDef[] = [
  // ---------------------------------------------------------------- Library
  { id: 'library', name: 'Library and search', description: 'Finds your files by name, kind, date and what is in them.', group: 'Library', defaultOn: true, always: true, routes: ['home', 'recents', 'library', 'screenshots', 'search', 'browse', 'tag', 'saved'], commands: ['browse', 'rescan', 'search'], cost: { level: 'low', background: 'Notices new and changed files; a full re-read every half hour', memory: 'About 3 MB per 1,000 files' } },
  { id: 'sources', name: 'Where downloads came from', description: 'Remembers the website or app each download came from, so “pdfs from gmail” works.', group: 'Library', defaultOn: true, routes: ['downloads', 'source'], cost: { level: 'low', background: 'One quick look per new file' } },
  { id: 'docText', name: 'Text inside documents', description: 'Reads PDFs and text files so search finds words inside them.', group: 'Library', defaultOn: true, cost: { level: 'medium', background: 'Reads new documents when you are not busy' } },
  { id: 'ocr', name: 'Text in pictures', description: 'Recognises text in screenshots and photos, on this computer.', group: 'Library', defaultOn: true, bridge: { get: (s) => s.ocrEnabled !== false, set: (on) => ({ ocrEnabled: on }) }, cost: { level: 'high', background: 'Recognises text in new pictures when you are not busy, never on battery', memory: 'About 150 MB while it works, released after a minute' } },
  { id: 'places', name: 'Disks, cloud drives and servers', description: 'The Locations part of the sidebar, with free space and eject.', group: 'Library', defaultOn: true, routes: ['trash'], commands: ['eject'], cost: { level: 'low', background: 'Notices disks coming and going (no programs started)' } },
  { id: 'network', name: 'Network browsing', description: 'Finds servers and shared folders on your network; Connect to Server.', group: 'Library', defaultOn: true, requires: ['places'], routes: ['network'], cost: { level: 'none', background: 'Only while the Network page is open' } },
  { id: 'lock', name: 'Locked folders', description: 'Encrypts folders so only you can open them.', group: 'Library', defaultOn: true, commands: ['lock*'], cost: { level: 'none', background: 'Locks folders again on your schedule' } },

  // ---------------------------------------------------------------- Tidy
  { id: 'cleanup', name: 'Clean Up', description: 'Caches, old installers and leftovers you can safely remove.', group: 'Tidy', defaultOn: true, routes: ['cleanup'], commands: ['cleanup', 'clean*'], cost: { level: 'none', background: 'Only when you scan' } },
  { id: 'duplicates', name: 'Duplicates and look-alike photos', description: 'Finds copies and near-identical pictures.', group: 'Tidy', defaultOn: true, routes: ['duplicates'], commands: ['duplicates'], cost: { level: 'low', background: 'A small fingerprint of each new picture' } },
  { id: 'space', name: 'Space Map and Large Files', description: 'See what takes up room on your disks.', group: 'Tidy', defaultOn: true, routes: ['space', 'large'], commands: ['space', 'large'], cost: { level: 'none', background: 'Only while open' } },
  { id: 'convert', name: 'Convert', description: 'Images, video, audio and PDFs in other formats, cut-outs and more.', group: 'Tidy', defaultOn: true, routes: ['convert'], commands: ['convert*'], cost: { level: 'none', background: 'Only while converting', memory: 'Loaded on first use' } },
  { id: 'rules', name: 'Automations', description: 'Rules that tidy folders for you.', group: 'Tidy', defaultOn: true, routes: ['rules'], commands: ['rules*'], cost: { level: 'low', background: 'Runs your rules once an hour' } },
  { id: 'history', name: 'History and undo', description: 'Everything Keeper moved or removed, with undo.', group: 'Tidy', defaultOn: true, routes: ['history'], cost: { level: 'none' } },

  // ---------------------------------------------------------------- Island
  { id: 'island', name: 'Island', description: 'The bar at the top of the screen: drop shelf, now playing, timers and alerts.', group: 'Island', defaultOn: true, bridge: island('enabled'), routes: ['island'], commands: ['island*', 'shelf*'], cost: { level: 'medium', background: 'A few small checks every few seconds while you are at the computer', windows: 'One small window per screen', memory: 'About 60 MB' } },
  { id: 'clipboard', name: 'Clipboard history', description: 'Keeps what you copy, with search; passwords are never kept.', group: 'Island', defaultOn: true, bridge: island('clipboard'), commands: ['clip*'], cost: { level: 'low', background: 'Looks at the clipboard about once a second while you are active' } },
  { id: 'media', name: 'Now playing', description: 'Music and video controls and lyrics in the Island.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'low', background: 'Asks what is playing every few seconds while something plays, less often otherwise' } },
  { id: 'agents', name: 'Coding assistants', description: 'Shows when a coding assistant in your terminal needs you.', group: 'Island', defaultOn: true, requires: ['island'], bridge: island('agents'), cost: { level: 'low', background: 'Reads their session files every few seconds' } },
  { id: 'focus', name: 'Focus timer and breaks', description: 'Focus sessions and reminders to take a break.', group: 'Island', defaultOn: true, requires: ['island'], commands: ['focus', 'focus-stop'], cost: { level: 'none', background: 'A timer only while a session runs' } },
  { id: 'keepAwake', name: 'Keep awake', description: 'Stops the computer sleeping for a while, until a time or while something runs; triggers, closed-lid mode, statistics and a menu-bar icon.', group: 'Island', defaultOn: true, routes: ['awake'], commands: ['awake*'], cost: { level: 'none', background: 'Nothing while no session runs and no trigger is on; then one check every 15 seconds (a session) or 30 seconds (triggers, slower while you are away), and one small system process holding the computer awake during a session' } },
  { id: 'islandWeather', name: 'Weather in the Island', description: 'The temperature and rain alerts at a glance.', group: 'Island', defaultOn: true, requires: ['island', 'weather'], bridge: island('weather'), cost: { level: 'none', background: 'One forecast every 20 minutes' } },
  { id: 'islandAsk', name: 'Ask in the Island', description: 'Rewrite, summarize, extract or brainstorm with any connected AI (the computer’s own model first where there is one).', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Nothing until you ask' } },
  { id: 'islandUsage', name: 'AI usage in the Island', description: 'Session and weekly limits for Claude Code, Codex, Copilot and Cursor, read from those tools on this computer.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Reads a few files once a minute while the tool is open' } },
  { id: 'islandSales', name: 'Sales in the Island', description: 'Today\'s revenue across Stripe, Shopify, Lemon Squeezy, Gumroad, Paddle, Polar and Dodo Payments, with read-only keys.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'low', background: 'Asks your services every 10 minutes only when new-sale pings are on' } },
  { id: 'islandStocks', name: 'Stocks in the Island', description: 'A watchlist of shares and crypto with quotes and an intraday chart.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Quotes once a minute while the tool is open' } },
  { id: 'islandNotes', name: 'Notes in the Island', description: 'Quick notes that save as you type.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none' } },
  { id: 'islandTodos', name: 'To-dos in the Island', description: 'A starred to-do list and your reminders, checked off without leaving the Island.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none' } },
  { id: 'islandPrompter', name: 'Teleprompter', description: 'Your script scrolls just under the camera, by reading speed or while you speak.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Uses the microphone only in voice-paced mode, while scrolling' } },
  { id: 'calendar', name: 'Next meeting', description: 'Your next event in the Island, counting down, with a Join button for video meetings.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Uses the calendars Keeper already reads (nothing extra)' } },
  { id: 'micIndicator', name: 'Microphone and camera in use', description: 'A dot when an app is listening or watching.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'low', background: 'Asks the system every 10 seconds' } },
  { id: 'notifyMirror', name: 'Notifications in the Island', description: 'Shows other apps’ notifications in the Island.', group: 'Island', defaultOn: false, requires: ['island'], bridge: island('notifyMirror'), cost: { level: 'low', background: 'Listens for notifications' } },
  { id: 'hideInFullscreen', name: 'Hide in full screen', description: 'The Island steps aside for full-screen video and slides.', group: 'Island', defaultOn: true, requires: ['island'], bridge: island('hideInFullscreen'), cost: { level: 'low', background: 'One small helper watches the window in front' } },
  { id: 'islandCalls', name: 'Calls in the Island', description: 'A call timer and a mute button when a call app or a browser call uses the microphone.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'low', background: 'Asks which app uses the microphone every 10 seconds (5 during a call); on Windows and Linux it shares the microphone indicator’s look' } },
  { id: 'islandHud', name: 'Volume and brightness in the Island', description: 'Keeper’s own level beside the system’s pop-up when the volume or brightness changes.', group: 'Island', defaultOn: false, requires: ['island'], cost: { level: 'low', background: 'Listens for level changes from the system (no polling): one small helper on Windows and Linux, Keeper’s helper on macOS' } },
  { id: 'cues', name: 'Cues', description: 'Notes, checklists, links and files tied to an app, a website, a page or a time; they pop up when you get there.', group: 'Desktop', defaultOn: true, routes: ['cues'], commands: ['cue*'], cost: { level: 'none', background: 'Nothing until a cue is tied to a place; then the window watcher reports the app in front (shared with “Hide in full screen”), and one timer for the next due cue', windows: 'A small window beside the app when a cue pops up' } },

  // ---------------------------------------------------------------- Desktop
  { id: 'writingHelp', name: 'Writing help', description: 'Proofread, rewrite, shorten or summarize selected text in Keeper’s text fields with the AI you set up (right-click).', group: 'AI', defaultOn: true, cost: { level: 'none', background: 'Nothing until you choose it from the right-click menu' } },
  { id: 'toolLauncher', name: 'Tool launcher', description: 'A shortcut from any app that finds any Keeper tool by typing and opens it in a small window of its own.', group: 'Desktop', defaultOn: true, commands: ['launcher'], cost: { level: 'none', windows: 'A small window, made the first time you use it; one small window per open tool' } },
  { id: 'quickSearch', name: 'Quick Search', description: 'Search from anywhere with a keyboard shortcut.', group: 'Desktop', defaultOn: true, cost: { level: 'none', windows: 'A small window, made the first time you use it' } },
  { id: 'widgets', name: 'Desktop widgets', description: 'Clocks, weather, disk space and more on your desktop.', group: 'Desktop', defaultOn: true, routes: ['widgets'], commands: ['widget*'], cost: { level: 'low', windows: 'One per widget you add' } },
  // Wallpaper, vibes, ambient sound and folder icons (electron/services/wallpaper/).
  { id: 'wallpaper', name: 'Live wallpaper', description: 'Animated scenes, your own videos, pictures or a web page behind the desktop icons; a still picture where the system has no desktop layer.', group: 'Desktop', defaultOn: false, commands: ['wallpaper*'], cost: { level: 'medium', background: 'Draws only while the desktop can be seen: paused when locked, asleep, under full-screen apps, and (by choice) on battery or in low power mode; a check for full-screen apps every few seconds while on', windows: 'One per display', memory: 'About 40–70 MB per display' } },
  { id: 'vibes', name: 'Vibes', description: 'Switch wallpaper, theme, ambient sound and widgets together, by hand or on a schedule (time, sunrise and sunset, battery, focus).', group: 'Desktop', defaultOn: true, routes: ['ambience'], commands: ['vibe*'], cost: { level: 'none', background: 'One check a minute only while a schedule has rules' } },
  { id: 'ambientSound', name: 'Ambient sound', description: 'Rain, café, waves, wind, fire, night and noise made on this computer, mixed in a small floating panel, with a sleep timer.', group: 'Desktop', defaultOn: true, commands: ['ambient*'], cost: { level: 'none', background: 'Nothing until you play a sound', windows: 'A small panel while sound plays (hidden unless you open it)', memory: 'About 30 MB while playing' } },
  { id: 'folderIcons', name: 'Custom folder icons', description: 'Give folders their own colours, patterns, symbols or pictures in the file manager, with one-click restore.', group: 'Desktop', defaultOn: true, commands: ['folder-icon*'], cost: { level: 'none', background: 'Only when you change an icon' } },
  { id: 'weather', name: 'Weather', description: 'Forecasts, rain radar and trips.', group: 'Desktop', defaultOn: true, routes: ['weather'], cost: { level: 'none', background: 'Only for the places you add' } },
  { id: 'tracks', name: 'Places & Tracks', description: 'Where your things, people and activities have been: a private timeline, trips and maps from files and sources you add. Locations stay on this computer, encrypted.', group: 'Desktop', defaultOn: true, routes: ['tracks'], commands: ['tracks*'], cost: { level: 'none', background: 'Nothing until you add a source; then only the checks those sources need' } },
  { id: 'tracksLive', name: 'Places & Tracks: live sharing', description: 'Live positions from OwnTracks, GPS trackers, a Traccar server, Find My on a Mac and your phone, received on this computer.', group: 'Desktop', defaultOn: false, ownChoice: true, requires: ['tracks'], cost: { level: 'low', background: 'A small receiver waits for positions; servers you add are asked once a minute' } },
  { id: 'tracksServices', name: 'Places & Tracks: sports services', description: 'Activities from Strava, Polar and Fitbit with your own app credentials.', group: 'Desktop', defaultOn: false, ownChoice: true, requires: ['tracks'], cost: { level: 'none', background: 'Asks your connected services for new activities every six hours' } },
  { id: 'capture', name: 'Screenshots and recording', description: 'Capture the screen, annotate, record and read text from it.', group: 'Desktop', defaultOn: true, routes: ['capture', 'annotate'], commands: ['capture*', 'record*', 'screenshot*'], cost: { level: 'none', background: 'Only while capturing', memory: 'Loaded on first use' } },
  { id: 'stage', name: 'Stage mode', description: 'A clean screen for recording, presenting and screenshots: hides desktop icons, the Dock and other apps, Do Not Disturb, a clean backdrop, pointer spotlight, keystrokes and more, each its own switch, with presets — and everything put back afterwards, even after a crash.', group: 'Desktop', defaultOn: true, routes: ['stage'], commands: ['stage*', 'present*'], cost: { level: 'none', background: 'Nothing until you start it; while on, the overlays you chose and a watchdog that checks every two seconds that Keeper is still there', windows: 'Only the overlays and backdrop you chose, while on' } },
  { id: 'stageAuto', name: 'Stage: start when the screen is captured', description: 'Starts Stage mode by itself when the screen is being recorded or shared, and ends it afterwards. Reliable on Linux (PipeWire) and for Keeper’s own recorder; a best guess from known recorder apps on macOS and Windows.', group: 'Desktop', defaultOn: false, requires: ['stage'], cost: { level: 'low', background: 'Linux: listens to PipeWire’s change stream; everywhere: a look at running apps every 5 seconds (slower while you are away, paused while locked)' } },
  { id: 'displayKeys', name: 'Display keys', description: 'Shortcuts that change an external monitor’s brightness and volume over DDC/CI, with a small level display; optionally the keyboard’s volume keys too.', group: 'Desktop', defaultOn: false, requires: ['displayControl'], cost: { level: 'none', background: 'Only global shortcuts; the monitor is asked only when you press one' } },
  { id: 'dictation', name: 'Dictation', description: 'Speak instead of typing in any app: finished text where your cursor is, recognised on this computer.', group: 'Desktop', defaultOn: true, routes: ['dictation'], commands: ['dictation*'], cost: { level: 'none', background: 'Only while you dictate', memory: 'About 150 MB while the speech model is loaded (let go a minute after)' } },
  { id: 'dictationHold', name: 'Hold a key to talk', description: 'Hold a key (like right Option or Ctrl) anywhere to dictate; tap it to lock on. Listens to that one key and Esc only.', group: 'Desktop', defaultOn: false, requires: ['dictation'], cost: { level: 'low', background: 'A small listener for the talk key (macOS asks for Input Monitoring)' } },
  { id: 'meetings', name: 'Meeting recorder', description: 'Records your microphone and the computer’s sound, transcribes it on this computer, tells speakers apart and writes notes.', group: 'Desktop', defaultOn: true, routes: ['meetings'], commands: ['meeting*'], cost: { level: 'none', background: 'Only while recording', memory: 'About 150 MB while recording' } },
  { id: 'meetingDetect', name: 'Notice calls', description: 'Offers to record when a meeting app or a meeting page starts using the microphone.', group: 'Desktop', defaultOn: true, requires: ['meetings'], cost: { level: 'low', background: 'Every 15 seconds: which app uses the microphone (window titles only while one does)' } },
  { id: 'tray', name: 'Menu bar / tray icon', description: 'Keeper stays available when its window is closed.', group: 'Desktop', defaultOn: true, bridge: { get: (s) => s.trayEnabled !== false, set: (on) => ({ trayEnabled: on }) }, cost: { level: 'none' } },
  { id: 'login', name: 'Start at login', description: 'Keeper starts quietly in the tray when you log in.', group: 'Desktop', defaultOn: false, cost: { level: 'none' } },
  { id: 'terminal', name: 'Terminal', description: 'Terminals, SSH and remote files inside Keeper.', group: 'Desktop', defaultOn: true, routes: ['terminal'], commands: ['terminal*'], cost: { level: 'low', background: 'A small helper keeps open terminals running, even with the window closed', memory: 'About 30 MB per open terminal' } },
  { id: 'agentHub', name: 'Agent terminals and hub', description: 'AI agents (any tool, model or account) open their own terminals and sub-workers, message each other, share a task board and hand work over — always within your rules.', group: 'Desktop', defaultOn: true, requires: ['terminal'], cost: { level: 'none', background: 'Nothing while agents are quiet; a timer only while a message waits or a terminal has a time limit' } },

  // ---------------------------------------------------------------- AI
  { id: 'brain', name: 'Keeper’s brain', description: 'Indexes the text in your files so any AI can search and read them (with your permission).', group: 'AI', defaultOn: true, requires: ['docText'], routes: ['graph'], bridge: { get: (s) => s.brain?.enabled !== false, set: (on, s) => ({ brain: { ...s.brain, enabled: on } }) }, cost: { level: 'medium', background: 'Updates its index after file changes', memory: 'About 20 MB per 10,000 documents' } },
  { id: 'semantic', name: 'Search by meaning', description: 'Finds files by what they are about, not just their words (on-device model).', group: 'AI', defaultOn: false, requires: ['brain'], bridge: { get: (s) => !!s.brain?.semantic, set: (on, s) => ({ brain: { ...s.brain, semantic: on } }) }, cost: { level: 'high', background: 'Builds meaning vectors when you are not busy, never on battery by default', memory: 'About 150 MB with the model loaded' } },
  { id: 'assistant', name: 'Assistant', description: 'Ask about your files with the AI you choose.', group: 'AI', defaultOn: true, routes: ['assistant'], commands: ['assistant*', 'ask*'], cost: { level: 'none', background: 'Only while you ask' } },
  { id: 'abilities', name: 'AI abilities', description: 'Web search with sources, research reports, posts, pictures, code in a sealed workspace, memory, schedules, personas, projects and teams — for whichever AI you use.', group: 'AI', defaultOn: true, routes: [], commands: ['abilit*', 'team*'], cost: { level: 'none', background: 'Only while an AI uses one, and a timer for scheduled requests' } },
  { id: 'aiAgents', name: 'AI agents', description: 'Agents that work on your files with the AI you choose, asking before they change anything.', group: 'AI', defaultOn: true, routes: ['agents'], commands: ['agent*'], cost: { level: 'none', background: 'Only while an agent runs' } },
  { id: 'platform', name: 'Works with your computer', description: 'Spotlight, desktop search, Explorer menu, Siri Shortcuts and the system’s text recognition.', group: 'AI', defaultOn: true, cost: { level: 'low', background: 'Small helpers for the integrations you turn on' } },

  // ---------------------------------------------------------------- Connections
  { id: 'remote', name: 'Cloud and servers', description: 'Your cloud storage, servers and NAS in one place.', group: 'Connections', defaultOn: true, routes: ['remote'], commands: ['remote*'], cost: { level: 'low', background: 'A health check every 15 minutes for connected services' } },
  { id: 'link', name: 'Keeper on your other devices', description: 'Reach this computer’s files from your phone and other computers, and see your devices in one place.', group: 'Connections', defaultOn: true, routes: ['devices'], commands: ['link*', 'devices'], cost: { level: 'low', background: 'Answers your paired devices over the network while on' } },
  { id: 'remoteScreen', name: 'Remote screens', description: 'See and control your other computers, let them (or your phone) see this one when you allow it, and wake them from sleep.', group: 'Connections', defaultOn: true, requires: ['link'], commands: ['screen*'], cost: { level: 'none', background: 'Nothing until a session starts; while one runs, the screen is captured and sent', windows: 'A viewer window, or a small banner while this screen is shared' } },
  { id: 'keeperMesh', name: 'Keeper Mesh', description: 'A private network between your paired devices (WireGuard): every app reaches them by address or by name, with an exit node and shared subnets if you want.', group: 'Connections', defaultOn: false, requires: ['link'], routes: ['mesh'], commands: ['mesh*'], cost: { level: 'low', background: 'Nothing while off. While on: a WireGuard network card, a keepalive every 25 s only while a device is in use, and a look for new addresses every few minutes', memory: 'About 5 MB' } },
  { id: 'remoteDesktops', name: 'Remote Desktops', description: 'Connect to other computers by Remote Desktop (RDP), VNC, SSH, Mosh, serial, SPICE, PowerShell and web consoles, from saved connections or a quick-connect bar.', group: 'Connections', defaultOn: true, routes: ['rdc'], commands: ['rdc*'], cost: { level: 'none', background: 'Nothing until you open the page or a connection; while the page is open, one light knock on each saved computer every 30 seconds', windows: 'Outside programs (FreeRDP, viewers) only while a connection uses them' } },
  { id: 'rdcHosting', name: 'Let others reach this computer', description: 'Switch on this computer’s own remote desktop or VNC server, reach it through Keeper Link without opening ports, and check it is safe.', group: 'Connections', defaultOn: false, ownChoice: true, requires: ['remoteDesktops'], cost: { level: 'none', background: 'Nothing until you switch a server on; a VNC server Keeper starts runs while Keeper is open' } },
  { id: 'linkDirect', name: 'Direct connections between your devices', description: 'Files, ports, sync and screens go straight from one device to the other when the routers allow it, instead of through a relay or tunnel. Respects “This network only”.', group: 'Connections', defaultOn: true, requires: ['link'], cost: { level: 'none', background: 'Only while a device is connected through a relay or tunnel: one look for a direct path, then one small network socket while it is used' } },
  { id: 'remoteFleet', name: 'Your devices at a glance', description: 'Groups, tags, notes and search for your devices, their system details, and lock, sleep and restart from here.', group: 'Connections', defaultOn: true, requires: ['link'], cost: { level: 'none', background: 'Nothing in the background' } },
  { id: 'remoteTerminal', name: 'Terminals on your other devices', description: 'Open a terminal on another of your devices (it must allow “Terminal on this device”).', group: 'Connections', defaultOn: true, requires: ['link'], cost: { level: 'none', background: 'Only while a terminal is open' } },
  { id: 'remoteCommands', name: 'Run commands on your devices', description: 'Run saved commands on your other devices, and let them run commands here. Each device must allow “Run commands”, and you see every new command once.', group: 'Connections', defaultOn: false, ownChoice: true, requires: ['link'], cost: { level: 'none', background: 'Only while a command runs' } },
  { id: 'remoteHelp', name: 'Help mode', description: 'One-time support sessions with someone who is not paired: they read you a code and password, you see their screen, and they choose whether you may control it.', group: 'Connections', defaultOn: false, ownChoice: true, requires: ['remoteScreen'], commands: ['remote-get-help', 'remote-help-someone'], cost: { level: 'none', background: 'Only while a code is waiting (10 minutes at most) or a session runs' } },
  { id: 'screenExtras', name: 'Remote screen extras', description: 'Sound, several screens or one window, drawing on the other screen, voice chat, a file panel, printing there, a second viewer, and Keeper tabs for several screens.', group: 'Connections', defaultOn: true, requires: ['remoteScreen'], cost: { level: 'none', background: 'Only during a session' } },
  { id: 'unattendedAccess', name: 'Unattended access', description: 'A small system service keeps this computer reachable by your own devices after a restart and before anyone logs in. Needs an administrator once.', group: 'Connections', defaultOn: false, ownChoice: true, requires: ['link'], cost: { level: 'low', background: 'One small service, only while Keeper itself is not running' } },
  { id: 'waylandControl', name: 'Control on Wayland', description: 'Lets your devices control this Linux desktop through the system’s own permission dialog (asked once).', group: 'Connections', defaultOn: true, requires: ['remoteScreen'], platforms: ['linux'], cost: { level: 'none', background: 'Only during a session' } },
  { id: 'mirroring', name: 'Phones on this screen', description: 'Show and use an Android phone here (scrcpy), and receive an iPhone or iPad through AirPlay.', group: 'Connections', defaultOn: true, cost: { level: 'none', background: 'Nothing until you show a phone' } },
  { id: 'sync', name: 'Sync and backup', description: 'Folder sync between your devices, backups and cloud mirrors.', group: 'Connections', defaultOn: true, routes: ['sync'], commands: ['sync*', 'backup*'], cost: { level: 'low', background: 'Watches the folders you set up and checks them every few minutes; nothing until you add one' } },
  { id: 'notes', name: 'Notes', description: 'Open any folder of Markdown files as a vault: links and backlinks, properties, search, daily notes, templates, canvases, bases, graph and publishing. Vaults made by other notes apps work as they are.', group: 'Library', defaultOn: true, routes: ['notes'], commands: ['go-Notes', 'go-Today’s Daily Note', 'go-Notes Graph'], cost: { level: 'none', background: 'Nothing while the Notes page is closed; while open, it follows changes to the vault folder', memory: 'About 4 MB per 1,000 notes while open' } },
  { id: 'notesHub', name: 'Notes Everywhere', description: 'One home for notes from all your notes apps: search them together, see where each one lives, move them between apps and keep dated backups.', group: 'Connections', defaultOn: true, routes: ['noteshub'], commands: ['notes-hub*'], cost: { level: 'none', background: 'Nothing until you connect an app and press Sync' } },
  { id: 'notesSync', name: 'Notes Everywhere: sync in the background', description: 'Syncs your connected notes apps on their own every so often (each connection says how often).', group: 'Connections', defaultOn: false, requires: ['notesHub'], cost: { level: 'low', background: 'One look per connected app every 30 minutes or so, slower while you are away, never while the screen is locked' } },
  { id: 'netwatch', name: 'Network activity and VPN', description: 'Which apps use the network and where they connect; your VPNs.', group: 'Connections', defaultOn: true, routes: ['netactivity', 'vpn'], commands: ['netactivity*', 'vpn*'], cost: { level: 'none', background: 'Only while open; optional alerts look every few minutes' } },
  { id: 'firewall', name: 'Firewall', description: 'Rules for which app may connect where, alerts for new connections, a DNS filter with blocklists and encrypted DNS, traffic history and unusual-transfer warnings.', group: 'Connections', defaultOn: true, requires: ['netwatch'], routes: ['firewall'], commands: ['firewall*'], cost: { level: 'none', background: 'Nothing until switched on; then a look at connections every 10 seconds (slower when you are away), the DNS filter if on, and a daily list update', memory: 'About 15 MB with large blocklists' } },
  { id: 'mail', name: 'Mail', description: 'Your mail accounts (IMAP, Gmail, Outlook, iCloud, Fastmail…): read, write, search and file mail.', group: 'Connections', defaultOn: true, routes: ['mail'], commands: ['mail*'], cost: { level: 'low', background: 'Stays connected to each inbox so the server can say when mail arrives (no checking every few minutes); nothing while you have no accounts', memory: 'About 10 MB per account' } },
  { id: 'calendars', name: 'Calendar and reminders', description: 'Your calendars (this computer’s own, iCloud, Google, Microsoft 365, Fastmail, CalDAV, .ics links, holidays, birthdays) and to-do lists, with event alerts.', group: 'Connections', defaultOn: true, routes: ['calendar', 'reminders'], commands: ['calendar*', 'reminder*'], cost: { level: 'low', background: 'Reads this computer’s calendars when they change (macOS) or every 5 minutes, and connected calendars every 5 minutes (every minute while a calendar is on screen; .ics links every 15; never while locked); one timer for the next alert' } },
  { id: 'alarms', name: 'Alarms, timers and world clocks', description: 'Alarms that ring at a time, countdown timers, a stopwatch and clocks for other places.', group: 'Desktop', defaultOn: true, routes: ['alarms'], commands: ['alarm*', 'timer*'], cost: { level: 'none', background: 'One timer waiting for the next alarm' } },

  // Ashforde apps: sister apps Keeper can install and work with (Settings → Ashforde apps, core/ashforde).
  { id: 'monorail', name: 'Monorail', description: 'Install and work with Monorail by Ashforde®, the scrolling window manager: its workspace in the Island, its actions in the palette, Focus and presentation in step, and its tools for your AI apps.', group: 'Desktop', defaultOn: false, platforms: ['darwin'], commands: ['monorail*'], cost: { level: 'none', background: 'One file watch on Monorail’s folder and an update check once a day; nothing when Monorail is not installed' } },
  // ---------------------------------------------------------------- System
  { id: 'health', name: 'Health and alerts', description: 'Processor, memory, heat and battery history, with alerts for misbehaving apps.', group: 'System', defaultOn: true, routes: ['health'], commands: ['health*'], cost: { level: 'low', background: 'One look at running apps per minute' } },
  { id: 'processes', name: 'Processes', description: 'Every running app and process; quit, end or restart them.', group: 'System', defaultOn: true, requires: ['health'], routes: ['processes'], commands: ['process*', 'force-quit'], cost: { level: 'none', background: 'Only while open' } },
  { id: 'monitorHistory', name: 'Long-term health history', description: 'Keeps a year of processor, memory, network, disk, graphics and power history (rolled up to 5-minute, hourly and daily points) and which apps worked hardest each hour, with zoomable charts and CSV export.', group: 'System', defaultOn: true, requires: ['health'], commands: ['health-history'], cost: { level: 'low', background: 'Adds network, disk and sensor counters to the existing once-a-minute look', memory: 'About 1 MB on disk for a full year' } },
  { id: 'monitorTray', name: 'Live readings in the menu bar', description: 'Processor, memory, network, disk, graphics, temperature and power as text and sparklines in the menu bar or tray, one item per reading or all in one, with a pop-over of details.', group: 'System', defaultOn: false, requires: ['health'], commands: ['monitor-tray*'], cost: { level: 'low', background: 'One small reading every 2 seconds (your choice) while the readings are shown; slower while you are away, none while the screen is locked' } },
  { id: 'devServers', name: 'Dev servers and coding agents', description: 'Dev servers and listening ports grouped by project, with open, stop and restart; every running coding agent, AI tool and local model server with everything it started.', group: 'System', defaultOn: true, requires: ['health'], commands: ['dev-servers', 'agents-running'], cost: { level: 'none', background: 'Only while the page is open' } },
  { id: 'containers', name: 'Containers', description: 'Docker or Podman containers with processor, memory, network and disk use, the engine\'s disk use, and stop, start, restart and pause.', group: 'System', defaultOn: true, requires: ['health'], commands: ['containers'], cost: { level: 'none', background: 'Only while the Containers tab is open' } },
  { id: 'monitorSensors', name: 'Graphics, fans and power', description: 'Graphics use (NVIDIA, AMD, Intel, Apple), fan speeds and temperatures where the system publishes them, and power draw from the battery or the processor package.', group: 'System', defaultOn: true, requires: ['health'], commands: ['sensors'], cost: { level: 'none', background: 'Only while shown; graphics and power join the once-a-minute history look' } },
  { id: 'startupItems', name: 'Startup items and apps', description: 'What starts with your computer, and apps you no longer use.', group: 'System', defaultOn: true, routes: ['startup', 'apps'], cost: { level: 'none' } },
  { id: 'guide', name: 'To do and guides', description: 'One list of what needs doing about space, security, privacy, backups and updates, with the fix done for you or walked through step by step.', group: 'System', defaultOn: true, routes: ['todo'], commands: ['todo', 'howto*'], cost: { level: 'low', background: 'A look a minute after start, then twice a day' } },
  { id: 'protection', name: 'Privacy & Security', description: 'Who can use your camera, microphone and screen; risky browser extensions; trackers; how secure the system is; with a score and fixes.', group: 'System', defaultOn: true, routes: ['protection'], cost: { level: 'none', background: 'Only when you look' } },
  { id: 'security', name: 'Malware protection', description: 'Real-time checks of downloads with several engines, scans, quarantine, and alerts for new startup items and miner-like programs.', group: 'System', defaultOn: true, requires: ['protection'], commands: ['security*'], cost: { level: 'low', background: 'Watches Downloads, Desktop and Documents for new files; startup locations every 30 min; signature updates twice a day', memory: 'The checker loads only while checking, then stops' } },
  { id: 'videoDownload', name: 'Video downloads', description: 'Save videos or their sound from web pages (the downloader is fetched once, on first use).', group: 'System', defaultOn: true, requires: ['tools'], cost: { level: 'none', background: 'Only while downloading' } },
  { id: 'fileKit', name: 'Convert to any format', description: 'More PDF tools and “Convert to…” for pictures, documents, e-books, data, subtitles, fonts, 3D, drawings, mail, contacts and calendars. Outside programs (LibreOffice, Pandoc, Calibre, Ghostscript) are used only when installed.', group: 'Tidy', defaultOn: true, requires: ['convert'], commands: ['convert-convert.to'], cost: { level: 'none', background: 'Only while converting', memory: 'Loaded on first use' } },
  { id: 'workflows', name: 'Workflows', description: 'Tools joined into saved steps (merge → number → watermark → compress), run by hand, on new files in a watched folder, or on a schedule.', group: 'Tidy', defaultOn: true, requires: ['convert'], cost: { level: 'none', background: 'Only for workflows that watch a folder (one watcher each) or run on a schedule (one timer)' } },
  { id: 'faces', name: 'Hide faces', description: 'Finds faces in pictures on this computer, to blur or black them out (a 1.3 MB model, fetched on first use).', group: 'Tidy', defaultOn: true, requires: ['convert'], cost: { level: 'none', memory: 'Loaded on first use' } },
  { id: 'speechModel', name: 'Speech to text on this computer', description: 'Transcribes recordings and makes subtitles with a built-in speech model (40–250 MB, fetched on first use and checked).', group: 'Tidy', defaultOn: true, requires: ['convert'], cost: { level: 'none', memory: 'Loaded while transcribing, let go a minute later' } },
  { id: 'displayControl', name: 'External display controls', description: 'Brightness, contrast, volume and input source of external monitors over DDC/CI, from the Toolbox.', group: 'System', defaultOn: true, requires: ['tools'], cost: { level: 'none', background: 'Only while the tool is open' } },
  { id: 'quickControls', name: 'Quick Controls', description: 'Switch Wi-Fi, Bluetooth, VPN, firewalls, encrypted DNS, camera, microphone and other system settings from one place, with presets and undo.', group: 'System', defaultOn: true, routes: ['controls'], commands: ['controls*'], cost: { level: 'none', background: 'Nothing in the background; settings are read when the page, tray menu or Island tiles open' } },
  { id: 'quickControlsNetwork', name: 'Quick Controls: network', description: 'Wi-Fi, Bluetooth, airplane mode, VPN, encrypted DNS, IPv6, hotspot and sharing switches.', group: 'System', defaultOn: true, requires: ['quickControls'], cost: { level: 'none' } },
  { id: 'quickControlsFirewall', name: 'Quick Controls: firewall', description: 'The system firewall, stealth mode, block all incoming, and Keeper’s firewall and DNS filter.', group: 'System', defaultOn: true, requires: ['quickControls'], cost: { level: 'none' } },
  { id: 'quickControlsPrivacy', name: 'Quick Controls: privacy', description: 'Camera, microphone, location, advertising ID, diagnostics, clipboard and lock-screen switches, and per-app access.', group: 'System', defaultOn: true, requires: ['quickControls'], cost: { level: 'none' } },
  { id: 'quickControlsSecurity', name: 'Quick Controls: security', description: 'Keeper’s real-time protection and quarantine, Gatekeeper, Defender, SmartScreen and automatic updates.', group: 'System', defaultOn: true, requires: ['quickControls'], cost: { level: 'none' } },
  { id: 'settingsCatalog', name: 'System Settings+', description: 'A searchable catalogue of hundreds of system settings that usually need commands (defaults, registry, gsettings, sysctl, services), with exact previews, backups, a change log with undo, and setup profiles.', group: 'System', defaultOn: true, routes: ['catalog'], commands: ['catalog*'], cost: { level: 'none', background: 'Nothing in the background; values are read when the page opens' } },
  { id: 'appControls', name: 'App controls', description: 'Per-app network access, upload limits, VPN routing, CPU and memory limits, priority, pause, start at login, notifications, language, volume and graphics card.', group: 'System', defaultOn: true, routes: ['appcontrols'], commands: ['appcontrols*'], cost: { level: 'none', background: 'Nothing, unless an app is set to pause in the background (then only front-app changes)' } },
  { id: 'browserTabs', name: 'Browser tab controls', description: 'All open tabs across browsers in one place, with mute, sleep, site permissions, tracker blocking and per-site proxy through Keeper’s browser extension.', group: 'System', defaultOn: true, routes: ['browsers'], commands: ['browsers*'], cost: { level: 'none', background: 'Only while a browser with Keeper’s extension is open; updates when tabs change' } },
  { id: 'tools', name: 'Toolbox', description: 'Developer tools, system tweaks and handy utilities.', group: 'System', defaultOn: true, routes: ['tools'], commands: ['tool*'], cost: { level: 'none' } },
  { id: 'updates', name: 'Automatic update checks', description: 'Looks for a new Keeper on GitHub every six hours (you can always check by hand).', group: 'System', defaultOn: true, bridge: { get: (s) => s.updateMode !== 'off', set: (on, s) => ({ updateMode: on ? (s.updateMode === 'off' ? 'auto' : s.updateMode) : 'off' }) }, cost: { level: 'none', background: 'One small request every six hours' } },
  { id: 'usageStats', name: 'Anonymous usage stats', description: 'Once a day, a small anonymous report (version, kind of computer, which features and pages are used, crash counts) to help Ashforde improve Keeper. Never files, searches or names. Settings → Privacy shows exactly what is sent.', group: 'System', defaultOn: true, ownChoice: true, cost: { level: 'none', background: 'One look an hour; sends at most once a day when the computer is idle' } },
];

/** Pages and palette commands that belong to Keeper itself and cannot be switched off (settings and appearance). */
export const CORE = {
  routes: ['settings'],
  commands: ['appearance', 'hidden-files', 'inspector', 'view', 'look', 'theme-*'],
};

const byId = new Map(FEATURES.map((f) => [f.id, f]));
// The renderer has no `process`; it passes the platform from system info.
const HOST = typeof process !== 'undefined' ? process.platform : '';
export const featureDef = (id: string) => byId.get(id);

export type FeatureMap = Record<string, boolean>;

/** What the person asked for (before dependencies). */
export function wanted(s: AllSettings, id: string, platform: string = HOST): boolean {
  const f = byId.get(id);
  if (!f) return true; // unknown ids (a newer feature in an older registry) stay on
  if (f.always) return true;
  if (f.platforms && !f.platforms.includes(platform as NodeJS.Platform)) return false;
  if (f.bridge) return f.bridge.get(s);
  return s.features?.[id] ?? f.defaultOn;
}

export interface FeatureState {
  id: string;
  wanted: boolean;
  /** on, and everything it needs is on */
  on: boolean;
  /** the features that keep it off although it is wanted */
  blockedBy?: string[];
}

/** Every feature's state, with dependencies applied (a feature is off while what it needs is off). */
export function featureStates(s: AllSettings, platform: string = HOST): Map<string, FeatureState> {
  const out = new Map<string, FeatureState>();
  const visit = (id: string, seen: Set<string>): boolean => {
    const done = out.get(id);
    if (done) return done.on;
    const w = wanted(s, id, platform);
    const f = byId.get(id);
    const blockedBy: string[] = [];
    for (const r of f?.requires ?? []) {
      if (seen.has(r)) continue; // a loop in the registry: ignore that edge
      if (!visit(r, new Set([...seen, id]))) blockedBy.push(r);
    }
    const st: FeatureState = { id, wanted: w, on: w && blockedBy.length === 0, blockedBy: blockedBy.length ? blockedBy : undefined };
    out.set(id, st);
    return st.on;
  };
  for (const f of FEATURES) visit(f.id, new Set());
  return out;
}

export function isOn(s: AllSettings, id: string, platform: string = HOST): boolean {
  return featureStates(s, platform).get(id)?.on ?? true;
}

/** The settings change that switches one feature. Turning one on also turns on what it needs. */
export function featurePatch(s: AllSettings, id: string, on: boolean): Partial<AllSettings> {
  const f = byId.get(id);
  if (!f || f.always) return {};
  let next: AllSettings = { ...s, features: { ...(s.features ?? {}) } };
  const apply = (fid: string, v: boolean) => {
    const d = byId.get(fid);
    if (!d || d.always) return;
    if (d.bridge) next = { ...next, ...d.bridge.set(v, next) };
    else next.features = { ...next.features, [fid]: v };
  };
  apply(id, on);
  if (on) {
    const need = (fid: string, seen = new Set<string>()) => {
      for (const r of byId.get(fid)?.requires ?? []) {
        if (seen.has(r)) continue;
        seen.add(r);
        if (!wanted(next, r)) apply(r, true);
        need(r, seen);
      }
    };
    need(id);
  }
  return diff(s, next);
}

export type PresetId = 'everything' | 'balanced' | 'minimal' | 'files';

export const PRESETS: { id: PresetId; name: string; description: string; on: (f: FeatureDef) => boolean }[] = [
  { id: 'everything', name: 'Everything', description: 'Every feature on.', on: () => true },
  { id: 'balanced', name: 'Balanced', description: 'Keeper as it comes: the useful things on, the heavier extras off until you want them.', on: (f) => f.defaultOn },
  { id: 'minimal', name: 'Minimal', description: 'Files, search and tidying, with the Island and tray. Nothing heavy in the background.', on: (f) => ['Library', 'Tidy'].includes(f.group) ? f.id !== 'ocr' : ['island', 'tray', 'quickSearch', 'clipboard', 'focus', 'keepAwake', 'hideInFullscreen', 'updates'].includes(f.id) },
  { id: 'files', name: 'Files only', description: 'A file manager and nothing else: library, search, places and tidying.', on: (f) => ['library', 'sources', 'docText', 'places', 'network', 'lock', 'cleanup', 'duplicates', 'space', 'convert', 'history', 'tray', 'quickSearch'].includes(f.id) },
];

export function presetPatch(s: AllSettings, preset: PresetId): Partial<AllSettings> {
  const p = PRESETS.find((x) => x.id === preset);
  if (!p) return {};
  let next: AllSettings = { ...s, features: { ...(s.features ?? {}) } };
  for (const f of FEATURES) {
    if (f.always || f.ownChoice) continue;
    const v = p.on(f);
    if (f.bridge) next = { ...next, ...f.bridge.set(v, next) };
    else next.features = { ...next.features, [f.id]: v };
  }
  return diff(s, next);
}

// ---------------------------------------------------------------- your own sets

export interface FeatureSet {
  id: string;
  name: string;
  /** feature id → on; features not listed keep their default */
  features: Record<string, boolean>;
}

/** The current choices, to save as a set. */
export function snapshotSet(s: AllSettings, id: string, name: string, platform: string = HOST): FeatureSet {
  const features: Record<string, boolean> = {};
  for (const f of FEATURES) if (!f.always && !f.ownChoice) features[f.id] = wanted(s, f.id, platform);
  return { id, name: name.trim() || 'My set', features };
}

/** The settings change that applies a saved set (features it does not mention go back to their defaults). */
export function setPatch(s: AllSettings, set: Pick<FeatureSet, 'features'>): Partial<AllSettings> {
  let next: AllSettings = { ...s, features: { ...(s.features ?? {}) } };
  for (const f of FEATURES) {
    if (f.always || f.ownChoice) continue;
    const v = set.features[f.id] ?? f.defaultOn;
    if (f.bridge) next = { ...next, ...f.bridge.set(v, next) };
    else next.features = { ...next.features, [f.id]: v };
  }
  return diff(s, next);
}

/** Which saved set the current choices match, if any. */
export function currentSet(s: AllSettings, sets: FeatureSet[], platform: string = HOST): string | undefined {
  return sets.find((x) => FEATURES.every((f) => f.always || f.ownChoice || wanted(s, f.id, platform) === (x.features[f.id] ?? f.defaultOn)))?.id;
}

/** The set (or preset) to switch to when the power source changes; '' = leave as is. */
export function setForPower(s: Pick<AllSettings, 'featureSetOnBattery' | 'featureSetOnPower'>, onBattery: boolean): string {
  return (onBattery ? s.featureSetOnBattery : s.featureSetOnPower) || '';
}

/** Which preset the current choices match, if any. */
export function currentPreset(s: AllSettings): PresetId | undefined {
  // Features this system cannot run never count against a preset.
  return PRESETS.find((p) => FEATURES.every((f) => f.always || f.ownChoice || (f.platforms && !f.platforms.includes(HOST as NodeJS.Platform)) || wanted(s, f.id) === p.on(f)))?.id;
}

function diff(prev: AllSettings, next: AllSettings): Partial<AllSettings> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof AllSettings)[]) if (next[k] !== prev[k]) out[k] = next[k];
  return out as Partial<AllSettings>;
}

/** Pages hidden because the feature that owns them is off. */
export function hiddenRoutes(states: Map<string, FeatureState>): Set<string> {
  const hidden = new Set<string>();
  for (const f of FEATURES) if (states.get(f.id)?.on === false) for (const r of f.routes ?? []) hidden.add(r);
  return hidden;
}

/** Is this palette command owned by a feature that is off? */
export function commandHidden(states: Map<string, FeatureState>, commandId: string): boolean {
  for (const f of FEATURES) {
    if (states.get(f.id)?.on !== false) continue;
    for (const c of f.commands ?? []) if (c.endsWith('*') ? commandId.startsWith(c.slice(0, -1)) : commandId === c) return true;
  }
  return false;
}
