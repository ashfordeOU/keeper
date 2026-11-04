// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every part of Keeper that can be switched off, what it costs while on, and
// what it needs. Turning a feature off really stops it: no window, no timers,
// no watchers, nothing loaded, and its pages, menu items and commands hidden.
//
// To add a feature: add an entry below. Give it `routes` (pages it owns) and
// `commands` (palette ids it owns) so the interface hides them, and in the
// main process ask `featureOn(id)` / `onFeature(id, …)` before starting
// anything (electron/services/features.ts).

import { TIERS, type FeatureTier, type Normal, type SetupGroupId } from './feature-tiers';
import { proEnabled } from './pro-switch';
import type { AllSettings } from './settings';

export type FeatureGroup = 'Library' | 'Tidy' | 'Island' | 'Desktop' | 'AI' | 'Connections' | 'System';

export const FEATURE_GROUPS: FeatureGroup[] = ['Library', 'Tidy', 'Island', 'Desktop', 'AI', 'Connections', 'System'];

/**
 * The one taxonomy for the sidebar's sections, Settings → Features and the palette:
 * each feature belongs to one of these (`navGroup`), and so does each page (core/nav.ts).
 */
export type NavGroup = 'files' | 'pim' | 'notes' | 'tidy' | 'sync' | 'computer' | 'security' | 'devices' | 'connect' | 'ai' | 'screen' | 'desktop' | 'island' | 'general';

/** `within`: a group shown inside another one's sidebar section (the Island's page sits under Desktop). */
export const NAV_GROUPS: { id: NavGroup; title: string; within?: NavGroup }[] = [
  { id: 'files', title: 'Files' },
  { id: 'pim', title: 'Mail & Calendar' },
  { id: 'notes', title: 'Notes' },
  { id: 'tidy', title: 'Tidy' },
  { id: 'sync', title: 'Sync & Backup' },
  { id: 'computer', title: 'Computer' },
  { id: 'security', title: 'Privacy & Security' },
  { id: 'devices', title: 'Devices' },
  // Other people's machines (Remote Desktops, Terminal and SSH), apart from your own devices.
  { id: 'connect', title: 'Connect' },
  { id: 'ai', title: 'AI' },
  { id: 'screen', title: 'Screen' },
  { id: 'desktop', title: 'Desktop' },
  { id: 'island', title: 'Island', within: 'desktop' },
  // Keeper itself (Quick Search, the menu bar icon, opening at login, updates): parts with no page of their own.
  { id: 'general', title: 'Keeper itself' },
];

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
  /** its sidebar section and Settings → Features group (NAV_GROUP below fills it in) */
  navGroup?: NavGroup;
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
  /**
   * exists only in builds with Keeper Pro switched on (core/pro-switch.ts): otherwise it is
   * left out everywhere, like a part for another system. Every part here is free (core/entitlements.ts).
   */
  pro?: boolean;
  /** an older setting already switches this: read and write through it */
  bridge?: { get(s: AllSettings): boolean; set(on: boolean, s: AllSettings): Partial<AllSettings> };
  /**
   * How it fares in a store edition, where the build differs from the direct download.
   * Planning data only (docs/MAS-EDITION.md): nothing reads it yet. Absent means "available".
   */
  edition?: Partial<Record<KeeperEdition, EditionSupport>>;
  // ---- filled in from core/feature-tiers.ts (data for setup and Settings → Features)
  /**
   * recommended: on in Recommended (always, by a rule about this computer, or following its parent);
   * offered: off, but shown in Basic for people to turn on; advanced: shown only with advanced settings
   */
  tier?: 'recommended' | 'offered' | 'advanced';
  /** what Recommended does with it (see FeatureTier) */
  normal?: Normal;
  /** it follows this part: on whenever that one is on, with no switch of its own in Basic */
  follows?: string;
  /** its own row in Basic, inside its group's Customize, or Advanced only */
  shown?: FeatureTier['shown'];
  /** the group card it belongs to in setup */
  setup?: SetupGroupId;
  /** its name in plain words */
  plain?: string;
  /** the default everyone had before 1.0 (`defaultOn` is the default for new installs) */
  defaultBefore1?: boolean;
}

/** Builds of Keeper that differ in what they may do: the Mac App Store's sandboxed one so far. */
export type KeeperEdition = 'mas';
export type EditionSupport = 'available' | 'reduced' | 'unavailable';

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
  { id: 'filePanes', name: 'Side by Side', description: 'Two folders next to each other, on this computer or on a cloud or server, to copy and move between them, see what differs and sync them after a preview.', group: 'Library', defaultOn: true, routes: ['panes'], commands: ['panes*'], cost: { level: 'none', background: 'Nothing: only while the page is open' } },
  { id: 'lock', name: 'Locked folders', description: 'Encrypts folders so only you can open them.', group: 'Library', defaultOn: true, commands: ['lock*'], cost: { level: 'none', background: 'Locks folders again on your schedule' } },

  // ---------------------------------------------------------------- Tidy
  { id: 'cleanup', name: 'Clean Up', description: 'Caches, old installers and leftovers you can safely remove.', group: 'Tidy', defaultOn: true, routes: ['cleanup'], commands: ['cleanup', 'clean*'], cost: { level: 'none', background: 'Only when you scan' } },
  { id: 'duplicates', name: 'Duplicates and look-alike photos', description: 'Finds copies and near-identical pictures.', group: 'Tidy', defaultOn: true, routes: ['duplicates'], commands: ['duplicates'], cost: { level: 'low', background: 'A small fingerprint of each new picture' } },
  { id: 'space', name: 'Space Map and Large Files', description: 'See what takes up room on your disks.', group: 'Tidy', defaultOn: true, routes: ['space', 'large'], commands: ['space', 'large'], cost: { level: 'none', background: 'Only while open' } },
  { id: 'convert', name: 'Convert', description: 'Images, video, audio and PDFs in other formats, cut-outs and more.', group: 'Tidy', defaultOn: true, routes: ['convert'], commands: ['convert*'], cost: { level: 'none', background: 'Only while converting', memory: 'Loaded on first use' } },
  { id: 'pdfReader', name: 'PDF Reader', description: 'A calm reader for PDFs: thumbnails, search, zoom and dark pages; highlight, underline, notes, drawing, text boxes and signatures; fill in forms; turn, remove, reorder and add pages; saved as a real PDF.', group: 'Library', defaultOn: true, routes: ['pdf'], commands: ['pdf*'], cost: { level: 'none', background: 'Nothing: only while a PDF is open' } },
  { id: 'archives', name: 'Archives', description: 'Look inside zip, 7z, RAR and tar files without unpacking them, take out what you choose, and pack files into a ZIP or 7z with a password.', group: 'Tidy', defaultOn: true, routes: ['archives'], commands: ['archive*'], cost: { level: 'none', background: 'Only while you open or pack an archive' } },
  { id: 'rules', name: 'Automations', description: 'Rules that tidy folders for you.', group: 'Tidy', defaultOn: true, routes: ['rules'], commands: ['rules*'], cost: { level: 'low', background: 'Runs your rules once an hour' } },
  { id: 'history', name: 'History and undo', description: 'Everything Keeper moved or removed, with undo.', group: 'Tidy', defaultOn: true, routes: ['history'], cost: { level: 'none' } },

  // ---------------------------------------------------------------- Island
  { id: 'island', name: 'Island', description: 'The bar at the top of the screen: drop shelf, now playing, timers and alerts.', group: 'Island', defaultOn: true, bridge: island('enabled'), routes: ['island'], commands: ['island*', 'shelf*'], cost: { level: 'medium', background: 'A few small checks every few seconds while you are at the computer', windows: 'One small window per screen', memory: 'About 60 MB' } },
  { id: 'clipboard', name: 'Clipboard history', description: 'Keeps what you copy, with search; passwords are never kept.', group: 'Island', defaultOn: true, bridge: island('clipboard'), commands: ['clip*'], cost: { level: 'low', background: 'Looks at the clipboard about once a second while you are active' } },
  { id: 'media', name: 'Now playing', description: 'Music and video controls and lyrics in the Island.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'low', background: 'Asks what is playing every few seconds while something plays, less often otherwise' } },
  { id: 'agents', name: 'Coding assistants', description: 'Shows when a coding assistant in your terminal needs you.', group: 'Island', defaultOn: true, requires: ['island'], bridge: island('agents'), cost: { level: 'low', background: 'Reads their session files every few seconds' } },
  { id: 'focus', name: 'Focus timer and breaks', description: 'Focus sessions and reminders to take a break.', group: 'Island', defaultOn: true, requires: ['island'], commands: ['focus', 'focus-stop'], cost: { level: 'none', background: 'A timer only while a session runs' } },
  { id: 'keepAwake', name: 'Keep awake', description: 'Stops the computer sleeping for a while, until a time or while something runs; triggers, closed-lid mode, statistics and a menu-bar icon.', group: 'Island', defaultOn: true, routes: ['awake'], commands: ['awake*'], cost: { level: 'none', background: 'Nothing while no session runs and no trigger is on; then one check every 15 seconds (a session) or 30 seconds (triggers, slower while you are away), and one small system process holding the computer awake during a session' } },
  { id: 'islandWeather', name: 'Weather in the Island', description: 'The temperature, and alerts when rain is coming.', group: 'Island', defaultOn: true, requires: ['island', 'weather'], bridge: island('weather'), cost: { level: 'none', background: 'One forecast every 20 minutes' } },
  { id: 'islandAsk', name: 'Ask in the Island', description: 'Rewrite, summarize, extract or brainstorm with any connected AI (this computer\'s own AI first, where there is one).', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Nothing until you ask' } },
  { id: 'islandUsage', name: 'AI usage in the Island', description: 'Session and weekly limits for Claude Code, Codex, Copilot and Cursor, read from those tools on this computer.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Reads a few files once a minute while the tool is open' } },
  { id: 'islandSales', name: 'Sales in the Island', description: 'Today\'s revenue across Stripe, Shopify, Lemon Squeezy, Gumroad, Paddle, Polar and Dodo Payments, with read-only keys.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'low', background: 'Asks your services every 10 minutes only when new-sale pings are on' } },
  { id: 'islandStocks', name: 'Stocks in the Island', description: 'A watchlist of shares and crypto with quotes and an intraday chart.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Quotes once a minute while the tool is open' } },
  { id: 'islandNotes', name: 'Notes in the Island', description: 'Quick notes that save as you type.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none' } },
  { id: 'islandTodos', name: 'Tasks in the Island', description: 'Today’s tasks, the Inbox and every list, added in plain words and checked off without leaving the Island. The same tasks as the Reminders page; due ones show in the Island with Snooze and Done.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Nothing: it shows the task list when it changes' } },
  { id: 'islandPlanner', name: 'Week in the Island', description: 'The week ahead and the Inbox in the Island; drag tasks between days.', group: 'Island', defaultOn: true, requires: ['island', 'planner'], cost: { level: 'none' } },
  { id: 'islandInsights', name: 'Insights in the Island', description: 'Tasks done, focus minutes and your best hours, in the Island.', group: 'Island', defaultOn: true, requires: ['island', 'insights'], cost: { level: 'none' } },
  { id: 'islandPrompter', name: 'Teleprompter', description: 'Your script scrolls just under the camera, by reading speed or while you speak.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Uses the microphone only in voice-paced mode, while scrolling' } },
  { id: 'calendar', name: 'Next meeting', description: 'Your next event in the Island, counting down, with a Join button for video meetings.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'none', background: 'Uses the calendars Keeper already reads (nothing extra)' } },
  { id: 'micIndicator', name: 'Microphone and camera in use', description: 'A dot when an app is listening or watching.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'low', background: 'Asks the system every 10 seconds' } },
  { id: 'notifyMirror', name: 'Notifications in the Island', description: 'Shows other apps’ notifications in the Island.', group: 'Island', defaultOn: false, requires: ['island'], bridge: island('notifyMirror'), cost: { level: 'low', background: 'Listens for notifications' } },
  { id: 'hideInFullscreen', name: 'Hide in full screen', description: 'The Island steps aside for full-screen video and slides.', group: 'Island', defaultOn: true, requires: ['island'], bridge: island('hideInFullscreen'), cost: { level: 'low', background: 'One small helper watches the window in front' } },
  { id: 'islandCalls', name: 'Calls in the Island', description: 'A call timer and a mute button when a call app or a browser call uses the microphone.', group: 'Island', defaultOn: true, requires: ['island'], cost: { level: 'low', background: 'Asks which app uses the microphone every 10 seconds (5 during a call); on Windows and Linux it shares the microphone indicator’s look' } },
  { id: 'islandHud', name: 'Volume and brightness in the Island', description: 'Shows the level in the Island when you change it.', group: 'Island', defaultOn: false, requires: ['island'], cost: { level: 'low', background: 'Listens for level changes from the system (no polling): one small helper on Windows and Linux, Keeper’s helper on macOS' } },
  { id: 'cues', name: 'Cues', description: 'Notes, checklists, links and files tied to an app, a website, a page or a time; they pop up when you get there.', group: 'Desktop', defaultOn: true, routes: ['cues'], commands: ['cue*'], cost: { level: 'none', background: 'Nothing until a cue is tied to a place; then the window watcher reports the app in front (shared with “Hide in full screen”), and one timer for the next due cue', windows: 'A small window beside the app when a cue pops up' } },

  // ---------------------------------------------------------------- Desktop
  { id: 'writingHelp', name: 'Writing help', description: 'Proofread, rewrite, shorten or summarize selected text in Keeper’s text fields with the AI you set up (right-click).', group: 'AI', defaultOn: true, cost: { level: 'none', background: 'Nothing until you choose it from the right-click menu' } },
  { id: 'toolLauncher', name: 'Tool launcher', description: 'A shortcut from any app that finds any Keeper tool by typing and opens it in a small window of its own.', group: 'Desktop', defaultOn: true, commands: ['launcher'], cost: { level: 'none', windows: 'A small window, made the first time you use it; one small window per open tool' } },
  { id: 'quickSearch', name: 'Quick Search', description: 'Search from anywhere with a keyboard shortcut.', group: 'Desktop', defaultOn: true, cost: { level: 'none', windows: 'A small window, made the first time you use it' } },
  { id: 'launcher', name: 'Apps and commands in Quick Search', description: 'Open apps, do sums and conversions, use saved links and run your own commands from Quick Search; what you use most comes first.', group: 'Desktop', defaultOn: true, requires: ['quickSearch'], cost: { level: 'none', background: 'Reads the list of apps when you search (kept for ten minutes); nothing while Quick Search is closed' } },
  { id: 'textSnippets', name: 'Typed snippets', description: 'Type a short abbreviation in any app (like ;addr) and it becomes your saved text, with the date, the clipboard and where the cursor goes. The same list as Dictation’s snippets.', group: 'Desktop', defaultOn: false, routes: ['snippets'], commands: ['snippet*'], cost: { level: 'low', background: 'Listens to the keyboard while you have typed snippets (keys still reach your apps; nothing is kept)' } },
  { id: 'selectionBar', name: 'Actions for selected text', description: 'Select text in any app and press a shortcut: copy, search, translate, rewrite, define or open a link, with the AI you chose.', group: 'AI', defaultOn: false, cost: { level: 'none', background: 'Nothing until you press its shortcut' } },
  { id: 'widgets', name: 'Desktop widgets', description: 'Clocks, weather, disk space and more on your desktop.', group: 'Desktop', defaultOn: true, routes: ['widgets'], commands: ['widget*'], cost: { level: 'low', windows: 'One per widget you add' } },
  // Wallpaper, vibes, ambient sound and folder icons (electron/services/wallpaper/).
  { id: 'wallpaper', name: 'Live wallpaper', description: 'Animated scenes, your own videos, pictures or a web page behind the desktop icons; a still picture where the system has no desktop layer.', group: 'Desktop', defaultOn: false, commands: ['wallpaper*'], cost: { level: 'medium', background: 'Draws only while the desktop can be seen: paused when locked, asleep, under full-screen apps, and (by choice) on battery or in low power mode; a check for full-screen apps every few seconds while on', windows: 'One per display', memory: 'About 40–70 MB per display' } },
  { id: 'vibes', name: 'Vibes', description: 'Switch wallpaper, theme, ambient sound and widgets together, by hand or on a schedule (time, sunrise and sunset, battery, focus).', group: 'Desktop', defaultOn: true, routes: ['ambience'], commands: ['vibe*'], cost: { level: 'none', background: 'One check a minute only while a schedule has rules' } },
  { id: 'ambientSound', name: 'Ambient sound', description: 'Rain, café, waves, wind, fire, night and noise made on this computer, mixed in a small floating panel, with a sleep timer.', group: 'Desktop', defaultOn: true, commands: ['ambient*'], cost: { level: 'none', background: 'Nothing until you play a sound', windows: 'A small panel while sound plays (hidden unless you open it)', memory: 'About 30 MB while playing' } },
  { id: 'folderIcons', name: 'Custom folder icons', description: 'Give folders their own colours, patterns, symbols or pictures in the file manager, with one-click restore.', group: 'Desktop', defaultOn: true, commands: ['folder-icon*'], cost: { level: 'none', background: 'Only when you change an icon' } },
  { id: 'snapWindows', name: 'Snap windows', description: 'Put the window in front into a half, a third, a quarter or the whole screen with a shortcut, and bring back how your windows sat on each set of screens.', group: 'Desktop', defaultOn: false, routes: ['snap'], commands: ['snap*'], cost: { level: 'none', background: 'Only its shortcuts; a look at the screens when one is plugged in, if you ask for that' } },
  { id: 'folderBoxes', name: 'Folder boxes', description: 'Boxes on your desktop that show a folder’s files, sorted by kind, name or date, that roll up to their title; and Tidy my desktop into boxes, which you can undo.', group: 'Desktop', defaultOn: false, requires: ['widgets'], commands: ['boxes*'], cost: { level: 'low', windows: 'One small window per box', background: 'Each box looks at its folder every half minute' } },
  { id: 'menuBarItems', name: 'Menu bar icons', description: 'On a Mac, keep other apps’ menu bar icons out of sight behind Keeper’s divider, show them with a click, open one from a list, or move one across. Windows keeps its own overflow, and Linux trays differ, so there it says how.', group: 'Desktop', defaultOn: false, commands: ['menubar-icons*'], cost: { level: 'none', background: 'Mac: one small item in the menu bar; a look every 5 seconds only if it shows icons that change' } },
  { id: 'mouseButtons', name: 'Mouse buttons and app shortcuts (experimental)', description: 'Give the middle and side buttons of a mouse a job, in every app or one, and change what a shortcut does in one app. Experimental: it listens to the mouse, so it stays off until you turn it on.', group: 'Desktop', defaultOn: false, routes: ['buttons'], cost: { level: 'low', background: 'While it has buttons to listen for: a small mouse listener; while it has app shortcuts: a look at which app is in front' } },
  { id: 'weather', name: 'Weather', description: 'Forecasts, rain radar and trips.', group: 'Desktop', defaultOn: true, routes: ['weather'], cost: { level: 'none', background: 'Only for the places you add' } },
  { id: 'tracks', name: 'Places & Tracks', description: 'Where your things, people and activities have been: a private timeline, trips and maps from files and sources you add. Locations stay on this computer, encrypted.', group: 'Desktop', defaultOn: true, routes: ['tracks'], commands: ['tracks*'], cost: { level: 'none', background: 'Nothing until you add a source; then only the checks those sources need' } },
  { id: 'tracksLive', name: 'Places & Tracks: live sharing', description: 'Live positions from OwnTracks, GPS trackers, a Traccar server, Find My on a Mac and your phone, received on this computer.', group: 'Desktop', defaultOn: false, ownChoice: true, requires: ['tracks'], cost: { level: 'low', background: 'A small receiver waits for positions; servers you add are asked once a minute' } },
  { id: 'tracksServices', name: 'Places & Tracks: sports services', description: 'Activities from Strava, Polar and Fitbit with your own app credentials.', group: 'Desktop', defaultOn: false, ownChoice: true, requires: ['tracks'], cost: { level: 'none', background: 'Asks your connected services for new activities every six hours' } },
  { id: 'capture', name: 'Screenshots and recording', description: 'Capture the screen, annotate, record and read text from it.', group: 'Desktop', defaultOn: true, routes: ['capture', 'annotate'], commands: ['capture*', 'record*', 'screenshot*'], cost: { level: 'none', background: 'Only while capturing', memory: 'Loaded on first use' } },
  { id: 'studio', name: 'Studio', description: 'Record the screen with the pointer, clicks, keys, microphone and camera kept apart, then edit: automatic zooms where you click and type, a smooth pointer, backgrounds, trims and speed-ups, captions made on this computer, privacy blur, and exports to MP4, HEVC, WebM and GIF.', group: 'Desktop', defaultOn: true, routes: ['studio'], commands: ['studio*'], cost: { level: 'none', background: 'Nothing until you record or export; while recording, the recorder and a pointer reading 60 times a second', windows: 'A hidden recording page while recording, and a hidden export page while exporting', memory: 'Loaded on first use' } },
  { id: 'stage', name: 'Stage mode', description: 'A clean screen for recording, presenting and screenshots: hides desktop icons, the Dock and other apps, Do Not Disturb, a clean backdrop, pointer spotlight, keystrokes and more, each its own switch, with presets — and everything put back afterwards, even after a crash.', group: 'Desktop', defaultOn: true, routes: ['stage'], commands: ['stage*', 'present*'], cost: { level: 'none', background: 'Nothing until you start it; while on, the overlays you chose and a watchdog that checks every two seconds that Keeper is still there', windows: 'Only the overlays and backdrop you chose, while on' } },
  { id: 'drawOnScreen', name: 'Draw on screen', description: 'While you present, a shortcut lets you draw, highlight, add arrows and boxes or spotlight one spot on the screen; the ink can fade by itself.', group: 'Desktop', defaultOn: true, requires: ['stage'], commands: ['draw*'], cost: { level: 'none', background: 'Only a shortcut; nothing runs until you press it', windows: 'A see-through sheet over each screen while you draw' } },
  { id: 'stageAuto', name: 'Start Stage when I share my screen', description: 'Tidies the screen while you record or share, then puts it back.', group: 'Desktop', defaultOn: false, requires: ['stage'], cost: { level: 'low', background: 'Linux: listens to PipeWire’s change stream; everywhere: a look at running apps every 5 seconds (slower while you are away, paused while locked)' } },
  { id: 'displayKeys', name: 'Monitor brightness keys', description: 'Change an external monitor\'s brightness and volume with shortcuts.', group: 'Desktop', defaultOn: false, requires: ['displayControl'], cost: { level: 'none', background: 'Only global shortcuts; the monitor is asked only when you press one' } },
  { id: 'displayModes', name: 'Screen modes', description: 'Each screen’s size, refresh rate and sharp text on one page, presets for each set of screens (used by themselves when that set is plugged in, if you like), and a change that switches back by itself unless you press Keep.', group: 'Desktop', defaultOn: false, routes: ['displays'], commands: ['displays*'], cost: { level: 'none', background: 'Nothing; the system says when a screen is plugged in or out' } },
  { id: 'brightnessSync', name: 'Matched brightness', description: 'Plugged-in monitors follow the built-in screen’s brightness, a little brighter or dimmer each if you like, or a day and evening level.', group: 'Desktop', defaultOn: false, requires: ['displayControl', 'displayModes'], cost: { level: 'low', background: 'One look at the built-in screen’s brightness every few seconds (slower while you are away, none while the screen is locked); a monitor is told only when its level should change' } },
  { id: 'dictation', name: 'Dictation', description: 'Speak instead of typing in any app: finished text where your cursor is, recognised on this computer.', group: 'Desktop', defaultOn: true, routes: ['dictation'], commands: ['dictation*'], cost: { level: 'none', background: 'Only while you dictate', memory: 'About 150 MB while the speech model is loaded (let go a minute after)' } },
  { id: 'dictationHold', name: 'Hold a key to talk', description: 'Hold a key (like right Option or Ctrl) anywhere to dictate; tap it to lock on. Listens to that one key and Esc only.', group: 'Desktop', defaultOn: false, requires: ['dictation'], cost: { level: 'low', background: 'A small listener for the talk key (macOS asks for Input Monitoring)' } },
  { id: 'meetings', name: 'Meeting recorder', description: 'Records your microphone and the computer’s sound, transcribes it on this computer, tells speakers apart and writes notes.', group: 'Desktop', defaultOn: true, routes: ['meetings'], commands: ['meeting*'], cost: { level: 'none', background: 'Only while recording', memory: 'About 150 MB while recording' } },
  { id: 'meetingNotes', name: 'Your meeting notes', description: 'A notes pad beside the live transcript; afterwards your points are tidied with what was said, by a template for the kind of meeting, with action items to Reminders.', group: 'Desktop', defaultOn: true, requires: ['meetings'], cost: { level: 'none', background: 'Nothing: only while you write notes' } },
  { id: 'meetingDetect', name: 'Notice calls', description: 'Offers to record when a meeting app or a meeting page starts using the microphone.', group: 'Desktop', defaultOn: true, requires: ['meetings'], cost: { level: 'low', background: 'Every 15 seconds: which app uses the microphone (window titles only while one does)' } },
  { id: 'tray', name: 'Keeper in the menu bar or tray', description: 'Keeps Keeper ready after you close its window.', group: 'Desktop', defaultOn: true, bridge: { get: (s) => s.trayEnabled !== false, set: (on) => ({ trayEnabled: on }) }, cost: { level: 'none' } },
  { id: 'login', name: 'Start at login', description: 'Keeper starts quietly in the tray when you log in.', group: 'Desktop', defaultOn: false, cost: { level: 'none' } },
  { id: 'terminal', name: 'Terminal', description: 'Terminals, SSH and remote files inside Keeper.', group: 'Desktop', defaultOn: true, routes: ['terminal'], commands: ['terminal*'], cost: { level: 'low', background: 'A small helper keeps open terminals running, even with the window closed', memory: 'About 30 MB per open terminal' } },
  { id: 'agentHub', name: 'AI agents in the terminal', description: 'Coding agents get their own terminals, pass work along and share a task list.', group: 'Desktop', defaultOn: true, requires: ['terminal'], cost: { level: 'none', background: 'Nothing while agents are quiet; a timer only while a message waits or a terminal has a time limit' } },

  // ---------------------------------------------------------------- AI
  { id: 'brain', name: 'Let AI search your files', description: 'Keeps a private copy of your files\' text so your AI can quote them.', group: 'AI', defaultOn: true, requires: ['docText'], bridge: { get: (s) => s.brain?.enabled !== false, set: (on, s) => ({ brain: { ...s.brain, enabled: on } }) }, cost: { level: 'medium', background: 'Updates its index after file changes', memory: 'About 20 MB per 10,000 documents' } },
  { id: 'semantic', name: 'Search by meaning', description: 'Finds files by what they\'re about. Downloads a model once; heavy while it learns.', group: 'AI', defaultOn: false, requires: ['brain'], bridge: { get: (s) => !!s.brain?.semantic, set: (on, s) => ({ brain: { ...s.brain, semantic: on } }) }, cost: { level: 'high', background: 'Builds meaning vectors when you are not busy, never on battery by default', memory: 'About 150 MB with the model loaded' } },
  { id: 'graphAll', name: 'Knowledge graph of everything', description: 'Links your files and notes with mail, people, events, tasks and meetings, and says why each link is there. Built and kept on this computer.', group: 'AI', defaultOn: true, requires: ['brain'], routes: ['graph'], cost: { level: 'low', background: 'Nothing in the background: it catches up on what changed when the Graph page, a Related panel or the Assistant asks', memory: 'About 30 MB per 100,000 things while in use' } },
  { id: 'assistant', name: 'Assistant', description: 'Ask about your files with the AI you choose.', group: 'AI', defaultOn: true, routes: ['assistant'], commands: ['assistant*', 'ask*'], cost: { level: 'none', background: 'Only while you ask' } },
  { id: 'abilities', name: 'More AI skills', description: 'Let your AI search the web, write reports, make pictures and run code safely.', group: 'AI', defaultOn: true, routes: [], commands: ['abilit*', 'team*'], cost: { level: 'none', background: 'Only while an AI uses one, and a timer for scheduled requests' } },
  { id: 'aiAgents', name: 'AI agents', description: 'Agents that work on your files with the AI you choose, asking before they change anything.', group: 'AI', defaultOn: true, routes: ['agents'], commands: ['agent*'], cost: { level: 'none', background: 'Only while an agent runs' } },
  { id: 'usageTracker', name: 'AI usage and subscriptions', description: 'How much of each AI account’s limits, credits and budget is left (coding tools on this computer, service usage and balance endpoints with your keys, Keeper’s own calls), with warnings before they run out and your subscriptions’ renewals.', group: 'AI', defaultOn: true, routes: ['aiusage'], commands: ['usage-*'], cost: { level: 'none', background: 'Nothing until you add an account; then a look at local files every 2 minutes and at services every 10 (slower when you are away, none while locked)' } },
  { id: 'platform', name: 'Works with your computer', description: 'Spotlight, desktop search, Explorer menu, Siri Shortcuts and the system’s text recognition.', group: 'AI', defaultOn: true, cost: { level: 'low', background: 'Small helpers for the integrations you turn on' } },

  // ---------------------------------------------------------------- Connections
  { id: 'remote', name: 'Cloud and servers', description: 'Your cloud storage, servers and NAS in one place.', group: 'Connections', defaultOn: true, routes: ['remote'], commands: ['remote*'], cost: { level: 'low', background: 'A health check every 15 minutes for connected services' } },
  { id: 'driveMount', name: 'Connections as drives', description: 'Open a cloud service or a WebDAV server as a drive in Finder, File Explorer or the file manager, so every app can open and save its files. Needs a file-system helper from the system (built into macOS, WinFsp on Windows, FUSE 3 on Linux).', group: 'Connections', defaultOn: false, requires: ['remote'], commands: ['drive*'], cost: { level: 'low', background: 'Nothing while no drive is open. While one is: rclone serves it, keeps a cache in Keeper’s data folder (5 GB at most) and its state is read every 10 seconds', memory: 'About 40 MB for rclone while a drive is open' } },
  { id: 'link', name: 'Keeper on your other devices', description: 'Reach this computer’s files from your phone and other computers, and see your devices in one place.', group: 'Connections', defaultOn: true, routes: ['devices'], commands: ['link*', 'devices'], cost: { level: 'low', background: 'Answers your paired devices over the network while on' } },
  { id: 'remoteScreen', name: 'Remote screens', description: 'See and control your other computers, let them (or your phone) see this one when you allow it, and wake them from sleep.', group: 'Connections', defaultOn: true, requires: ['link'], commands: ['screen*'], cost: { level: 'none', background: 'Nothing until a session starts; while one runs, the screen is captured and sent', windows: 'A viewer window, or a small banner while this screen is shared' } },
  { id: 'keeperMesh', name: 'Private network for your devices', description: 'Your devices reach each other as if at home, wherever they are (WireGuard).', group: 'Connections', defaultOn: false, requires: ['link'], routes: ['mesh'], commands: ['mesh*'], cost: { level: 'low', background: 'Nothing while off. While on: a WireGuard network card, a keepalive every 25 s only while a device is in use, and a look for new addresses every few minutes', memory: 'About 5 MB' } },
  { id: 'meshDirectHandoff', name: 'Faster private network', description: 'When two devices can reach each other directly, traffic skips Keeper.', group: 'Connections', defaultOn: true, requires: ['keeperMesh'], cost: { level: 'low', background: 'While a direct path is handed off: a look at WireGuard’s counters every 2 s', memory: 'None' } },
  { id: 'remoteDesktops', name: 'Remote Desktops', description: 'Connect to other computers by Remote Desktop (RDP), VNC, SSH, Mosh, serial, SPICE, PowerShell and web consoles, from saved connections or a quick-connect bar.', group: 'Connections', defaultOn: true, routes: ['rdc'], commands: ['rdc*'], cost: { level: 'none', background: 'Nothing until you open the page or a connection; while the page is open, one light knock on each saved computer every 30 seconds', windows: 'Outside programs (FreeRDP, viewers) only while a connection uses them' } },
  { id: 'rdcHosting', name: 'Remote Desktop into this computer', description: 'Turns on Remote Desktop or VNC here, reachable only by your devices.', group: 'Connections', defaultOn: false, ownChoice: true, requires: ['remoteDesktops'], cost: { level: 'none', background: 'Nothing until you switch a server on; a VNC server Keeper starts runs while Keeper is open' } },
  { id: 'linkDirect', name: 'Faster connections between your devices', description: 'Sends files and screens straight between devices when the network allows.', group: 'Connections', defaultOn: true, requires: ['link'], cost: { level: 'none', background: 'Only while a device is connected through a relay or tunnel: one look for a direct path, then one small network socket while it is used' } },
  { id: 'remoteFleet', name: 'Your devices in one list', description: 'Groups, tags, notes and search for your devices, their system details, and lock, sleep and restart from here.', group: 'Connections', defaultOn: true, requires: ['link'], cost: { level: 'none', background: 'Nothing in the background' } },
  { id: 'remoteTerminal', name: 'Terminals on your other devices', description: 'Open a terminal on another of your devices (it must allow “Terminal on this device”).', group: 'Connections', defaultOn: true, requires: ['link'], cost: { level: 'none', background: 'Only while a terminal is open' } },
  { id: 'remoteCommands', name: 'Run commands on your devices', description: 'Run saved commands on your other devices, and let them run commands here. Each device must allow “Run commands”, and you see every new command once.', group: 'Connections', defaultOn: false, ownChoice: true, requires: ['link'], cost: { level: 'none', background: 'Only while a command runs' } },
  { id: 'remoteHelp', name: 'Help mode', description: 'One-time support sessions with someone who is not paired: they read you a code and password, you see their screen, and they choose whether you may control it.', group: 'Connections', defaultOn: false, ownChoice: true, requires: ['remoteScreen'], commands: ['remote-get-help', 'remote-help-someone'], cost: { level: 'none', background: 'Only while a code is waiting (10 minutes at most) or a session runs' } },
  { id: 'screenExtras', name: 'More while sharing a screen', description: 'Sound, several screens, drawing, voice chat and files during a session.', group: 'Connections', defaultOn: true, requires: ['remoteScreen'], cost: { level: 'none', background: 'Only during a session' } },
  { id: 'unattendedAccess', name: 'Reach this computer before login', description: 'Your devices can connect after a restart. Needs an administrator once.', group: 'Connections', defaultOn: false, ownChoice: true, requires: ['link'], cost: { level: 'low', background: 'One small service, only while Keeper itself is not running' } },
  { id: 'waylandControl', name: 'Let your devices control this Linux desktop', description: 'Your desktop asks once.', group: 'Connections', defaultOn: true, requires: ['remoteScreen'], platforms: ['linux'], cost: { level: 'none', background: 'Only during a session' } },
  { id: 'mirroring', name: 'Phones on this screen', description: 'Show and use an Android phone here (scrcpy), and receive an iPhone or iPad through AirPlay.', group: 'Connections', defaultOn: true, cost: { level: 'none', background: 'Nothing until you show a phone' } },
  { id: 'sync', name: 'Sync and backup', description: 'Folder sync between your devices, backups and cloud mirrors.', group: 'Connections', defaultOn: true, routes: ['sync'], commands: ['sync*', 'backup*'], cost: { level: 'low', background: 'Watches the folders you set up and checks them every few minutes; nothing until you add one' } },
  { id: 'notes', name: 'Notes', description: 'Open any folder of Markdown files as a vault: links and backlinks, properties, search, daily notes, templates, canvases, bases, graph and publishing. Vaults made by other notes apps work as they are. Import notes from other apps, and export them.', group: 'Library', defaultOn: true, routes: ['notes'], commands: ['go-Notes', 'go-Today’s Daily Note', 'go-Notes Graph'], cost: { level: 'none', background: 'Nothing while the Notes page is closed; while open, it follows changes to the vault folder', memory: 'About 4 MB per 1,000 notes while open' } },
  { id: 'journal', name: 'Journal', description: 'A dated entry a day in your notes: mood, photos, and if you like the weather and where you were; a streak, and On this day from earlier years. Plain Markdown files.', group: 'Library', defaultOn: false, requires: ['notes'], routes: ['journal'], commands: ['journal*'], cost: { level: 'none', background: 'Nothing; entries are read when the page opens' } },
  { id: 'reader', name: 'Reader', description: 'Follow sites through their feeds (RSS, Atom, JSON Feed) and save any page for later as a clean article you can read offline. Only the feeds and pages you add are fetched.', group: 'Library', defaultOn: false, routes: ['reader'], commands: ['reader*'], cost: { level: 'low', background: 'Looks at your feeds once an hour (less often when you are away, never while the screen is locked)' } },
  { id: 'notesHub', name: 'Notes from other apps', description: 'Search notes from Apple Notes, Obsidian, OneNote and more in one place.', group: 'Connections', defaultOn: true, routes: ['noteshub'], commands: ['notes-hub*'], cost: { level: 'none', background: 'Nothing until you connect an app and press Sync' } },
  { id: 'notesSync', name: 'Keep notes apps in sync', description: 'Checks your connected notes apps about every 30 minutes.', group: 'Connections', defaultOn: false, requires: ['notesHub'], cost: { level: 'low', background: 'One look per connected app every 30 minutes or so, slower while you are away, never while the screen is locked' } },
  { id: 'photoEditor', name: 'Photo editor', description: 'Crop, straighten, light and colour, blur or cover private parts, resize and convert any picture, and remove its background on this computer. Your original is kept, so Revert always brings it back.', group: 'Desktop', defaultOn: true, routes: ['photo'], commands: ['photo*'], cost: { level: 'none', background: 'Nothing; loads when a picture is opened' } },
  { id: 'monitors', name: 'Site and server monitors', description: 'Check your websites, servers and ports on a schedule: whether they answer, how fast, a word on the page and when the certificate expires. Uptime and response times, and an alert when one goes down.', group: 'System', defaultOn: false, routes: ['monitors'], commands: ['monitors*'], cost: { level: 'low', background: 'Only the checks you add, each on its own interval (every 5 minutes by default); nothing while there are none' } },
  { id: 'phoneAlerts', name: 'Alerts to your phone', description: 'Keeper’s alerts (a site down, a failed backup, an automation that ran) sent to your phone through ntfy, Telegram, e-mail or a web address of yours. Only the alerts you choose, only to the places you set up.', group: 'Connections', defaultOn: false, routes: ['alerts'], commands: ['alerts*'], cost: { level: 'none', background: 'Nothing; sends only when one of your alerts happens' } },
  { id: 'netwatch', name: 'Network activity and VPN', description: 'Which apps use the network and where they connect; your VPNs.', group: 'Connections', defaultOn: true, routes: ['netactivity', 'vpn'], commands: ['netactivity*', 'vpn*'], cost: { level: 'none', background: 'Only while open; optional alerts look every few minutes' } },
  { id: 'firewall', name: 'Network & firewall', description: 'Every app’s connections live, with rules per app and site (allow, block or ask), a calm prompt for new connections, profiles for home, work and public Wi-Fi, history, where your data goes, a DNS filter with blocklists, and a network part in the menu bar.', group: 'Connections', defaultOn: true, requires: ['netwatch'], routes: ['firewall'], commands: ['firewall*'], cost: { level: 'none', background: 'Nothing until watching, asking or rules are switched on; then a look at connections every 10 seconds (slower when you are away), the DNS filter if on, and a daily list update. The menu bar’s network part reads only while it is open.', memory: 'About 15 MB with large blocklists' } },
  { id: 'mail', name: 'Mail', description: 'Your mail accounts (Gmail, Outlook, iCloud, Fastmail and any other): read, write, search and file mail.', group: 'Connections', defaultOn: true, routes: ['mail'], commands: ['mail*'], cost: { level: 'low', background: 'Stays connected to each inbox so the server can say when mail arrives (no checking every few minutes); nothing while you have no accounts', memory: 'About 10 MB per account' } },
  { id: 'calendars', name: 'Calendar and reminders', description: 'Your calendars (this computer\'s own, iCloud, Google, Microsoft 365, Fastmail, .ics links, holidays, birthdays) and to-do lists, with event alerts.', group: 'Connections', defaultOn: true, routes: ['calendar', 'reminders'], commands: ['calendar*', 'reminder*'], cost: { level: 'low', background: 'Reads this computer’s calendars when they change (macOS) or every 5 minutes, and connected calendars every 5 minutes (every minute while a calendar is on screen; .ics links every 15; never while locked); one timer for the next alert' } },
  { id: 'planner', name: 'Planner', description: 'Today (with unfinished tasks carried forward), the week ahead, the Inbox, Overdue and Upcoming, repeating tasks and steps: a planner over your reminders.', group: 'Desktop', defaultOn: true, requires: ['calendars'], routes: ['planner'], commands: ['planner*'], cost: { level: 'none', background: 'Nothing: it reads the task list when it changes' } },
  { id: 'dayPlan', name: 'Plan my day', description: 'A two-minute plan each morning: pick three tasks, say how long, and Keeper puts them in the free time between your events. Wrap up the day moves what is left to tomorrow.', group: 'Desktop', defaultOn: true, requires: ['calendars'], commands: ['plan-day', 'wrap-up'], cost: { level: 'none', background: 'Nothing: the plan is made when you ask, and its blocks are ordinary events' } },
  { id: 'captureInbox', name: 'Inbox', description: 'One shortcut from any app catches a thought, a link, a voice note, a screenshot or a file. Sort them later, one at a time: task, note, event, snippet or delete.', group: 'Desktop', defaultOn: true, routes: ['inbox'], commands: ['inbox*'], cost: { level: 'none', background: 'Nothing but one keyboard shortcut', windows: 'A small card while you catch something' } },
  { id: 'insights', name: 'Insights', description: 'A small log on this computer of tasks done and focus sessions: today, this week and your best hours. Nothing leaves the computer.', group: 'Desktop', defaultOn: true, cost: { level: 'none', background: 'One line written when a task is done or a focus session ends' } },
  { id: 'alarms', name: 'Alarms, timers and world clocks', description: 'Alarms that ring at a time, countdown timers, a stopwatch and clocks for other places.', group: 'Desktop', defaultOn: true, routes: ['alarms'], commands: ['alarm*', 'timer*'], cost: { level: 'none', background: 'One timer waiting for the next alarm' } },

  // Ashforde apps: sister apps Keeper can install and work with (Settings → Ashforde apps, core/ashforde).
  { id: 'monorail', name: 'Monorail', description: 'Install and work with Monorail by Ashforde®, the scrolling window manager: its workspace in the Island, its actions in the palette, Focus and presentation in step, and its tools for your AI apps.', group: 'Desktop', defaultOn: false, platforms: ['darwin'], commands: ['monorail*'], cost: { level: 'none', background: 'One file watch on Monorail’s folder and an update check once a day; nothing when Monorail is not installed' } },
  // ---------------------------------------------------------------- System
  { id: 'health', name: 'Health and alerts', description: 'Processor, memory, heat and battery history, with alerts for misbehaving apps.', group: 'System', defaultOn: true, routes: ['health'], commands: ['health*'], cost: { level: 'low', background: 'One look at running apps per minute' } },
  { id: 'processes', name: 'Processes', description: 'Every running app and process; quit, end or restart them.', group: 'System', defaultOn: true, requires: ['health'], routes: ['processes'], commands: ['process*', 'force-quit'], cost: { level: 'none', background: 'Only while open' } },
  { id: 'monitorHistory', name: 'A year of health history', description: 'Look back at what slowed the computer. About 1 MB on disk.', group: 'System', defaultOn: true, requires: ['health'], commands: ['health-history'], cost: { level: 'low', background: 'Adds network, disk and sensor counters to the existing once-a-minute look', memory: 'About 1 MB on disk for a full year' } },
  { id: 'monitorTray', name: 'Live readings in the menu bar', description: 'Processor, memory, network, disk, graphics, temperature and power as text and sparklines in the menu bar or tray, one item per reading or all in one, with a pop-over of details.', group: 'System', defaultOn: false, requires: ['health'], commands: ['monitor-tray*'], cost: { level: 'low', background: 'One small reading every 2 seconds (your choice) while the readings are shown; slower while you are away, none while the screen is locked' } },
  { id: 'devServers', name: 'Dev servers and coding agents', description: 'Dev servers and listening ports grouped by project, with open, stop and restart; every running coding agent, AI tool and local model server with everything it started.', group: 'System', defaultOn: true, requires: ['health'], commands: ['dev-servers', 'agents-running'], cost: { level: 'none', background: 'Only while the page is open' } },
  { id: 'containers', name: 'Containers', description: 'Docker or Podman containers with processor, memory, network and disk use, the engine\'s disk use, and stop, start, restart and pause.', group: 'System', defaultOn: true, requires: ['health'], commands: ['containers'], cost: { level: 'none', background: 'Only while the Containers tab is open' } },
  { id: 'monitorSensors', name: 'Graphics, fans and power', description: 'Graphics use (NVIDIA, AMD, Intel, Apple), fan speeds and temperatures where the system publishes them, and power draw from the battery or the processor package.', group: 'System', defaultOn: true, requires: ['health'], commands: ['sensors'], cost: { level: 'none', background: 'Only while shown; graphics and power join the once-a-minute history look' } },
  { id: 'soundPerApp', name: 'Sound for each app', description: 'Each app keeps the volume, mute and output you give it in Health → Sound & tabs, set again the next time it plays. On Linux each app can also play to its own speakers or headphones.', group: 'System', defaultOn: false, requires: ['health'], cost: { level: 'low', background: 'On Linux one small listener that hears when an app starts playing (no polling); nothing on Windows, which keeps each app’s volume itself' } },
  { id: 'macAppVolume', name: 'Volume for each app on a Mac (experiment)', description: 'Changes one app’s volume through the system’s audio capture (macOS 14.2 and later): the app’s own sound is muted and played again at your level, with a little delay. Needs the audio recording permission. No driver is installed.', group: 'System', defaultOn: false, platforms: ['darwin'], requires: ['health'], cost: { level: 'low', background: 'Only for apps whose volume you changed: a small audio stream each, while they play; with Sound for each app, one look every 5 seconds' } },
  { id: 'startupItems', name: 'Startup items and apps', description: 'What starts with your computer, and apps you no longer use.', group: 'System', defaultOn: true, routes: ['startup', 'apps'], cost: { level: 'none' } },
  { id: 'appUpdates', name: 'App updates', description: 'Finds apps with a newer version, from each app’s own update feed on a Mac, Homebrew, winget, Flatpak, Snap or your system’s packages, and updates them through the package manager or the maker’s own download, checked first. Never a copy kept by Keeper.', group: 'System', defaultOn: false, requires: ['startupItems'], commands: ['app-updates*'], cost: { level: 'low', background: 'One look a day at each app’s update feed and your package managers (slower while you are away, never while the screen is locked)' } },
  { id: 'chargeLimit', name: 'Battery care', description: 'Stops charging at a limit you choose (80% suits a laptop that is plugged in most of the day), charges to full once for a trip and pauses charging while the battery is warm. Linux sets it itself; on Windows it opens your laptop maker’s app; a Mac manages charging itself.', group: 'System', defaultOn: false, routes: ['battery'], commands: ['battery*'], cost: { level: 'none', background: 'Nothing, unless a trip charge or pausing while warm is on: then one look a minute at the battery' } },
  { id: 'bigButtons', name: 'Big buttons', description: 'Six large buttons at the top of Today: find a file, free up space, write a mail, your calendar, your pictures and help. Made for Simple and Family, and there for anyone.', group: 'Library', defaultOn: false, cost: { level: 'none', background: 'Nothing: six buttons on Today' } },
  { id: 'offlineCheck', name: 'Offline check', description: 'Every way Keeper could reach the internet on one page, each with its own switch, and one button that turns them all off. Part of Privacy-max, and there for anyone.', group: 'System', defaultOn: false, commands: ['offline-check'], cost: { level: 'none', background: 'Nothing: a list read from your settings when you open it' } },
  { id: 'guide', name: 'Fix-it list', description: 'What\'s worth fixing on this computer, with a fix for each.', group: 'System', defaultOn: true, routes: ['todo'], commands: ['todo', 'howto*'], cost: { level: 'low', background: 'A look a minute after start, then twice a day' } },
  { id: 'protection', name: 'Privacy & Security', description: 'Who can use your camera, microphone and screen; risky browser extensions; trackers; how secure the system is; with a score and fixes.', group: 'System', defaultOn: true, routes: ['protection'], cost: { level: 'none', background: 'Only when you look' } },
  { id: 'security', name: 'Scan downloads for malware', description: 'Checks new files as they arrive and warns about new startup programs.', group: 'System', defaultOn: true, requires: ['protection'], commands: ['security*'], cost: { level: 'low', background: 'Watches Downloads, Desktop and Documents for new files; startup locations every 30 min; signature updates twice a day', memory: 'The checker loads only while checking, then stops' } },
  { id: 'videoDownload', name: 'Video downloads', description: 'Save videos or their sound from web pages (the downloader is fetched once, on first use).', group: 'System', defaultOn: true, requires: ['tools'], cost: { level: 'none', background: 'Only while downloading' } },
  { id: 'fileKit', name: 'Convert to any format', description: 'More PDF tools and “Convert to…” for pictures, documents, e-books, data, subtitles, fonts, 3D, drawings, mail, contacts and calendars. Outside programs (LibreOffice, Pandoc, Calibre, Ghostscript) are used only when installed.', group: 'Tidy', defaultOn: true, requires: ['convert'], commands: ['convert-convert.to'], cost: { level: 'none', background: 'Only while converting', memory: 'Loaded on first use' } },
  { id: 'workflows', name: 'Workflows', description: 'Tools joined into saved steps (merge → number → watermark → compress), run by hand, on new files in a watched folder, or on a schedule.', group: 'Tidy', defaultOn: true, requires: ['convert'], cost: { level: 'none', background: 'Only for workflows that watch a folder (one watcher each) or run on a schedule (one timer)' } },
  { id: 'faces', name: 'Hide faces', description: 'Finds faces in pictures on this computer, to blur or black them out (1.3 MB, fetched on first use).', group: 'Tidy', defaultOn: true, requires: ['convert'], cost: { level: 'none', memory: 'Loaded on first use' } },
  { id: 'speechModel', name: 'Speech to text on this computer', description: 'Transcribes recordings and makes subtitles with a built-in speech model (40–250 MB, fetched on first use and checked).', group: 'Tidy', defaultOn: true, requires: ['convert'], cost: { level: 'none', memory: 'Loaded while transcribing, let go a minute later' } },
  { id: 'displayControl', name: 'Monitor controls', description: 'Brightness, contrast, volume and input of a plugged-in monitor.', group: 'System', defaultOn: true, requires: ['tools'], cost: { level: 'none', background: 'Only while the tool is open' } },
  { id: 'quickControls', name: 'Quick Controls', description: 'Switch Wi-Fi, Bluetooth, VPN, firewalls, encrypted DNS, camera, microphone and other system settings from one place, with presets and undo.', group: 'System', defaultOn: true, routes: ['controls'], commands: ['controls*'], cost: { level: 'none', background: 'Nothing in the background; settings are read when the page, tray menu or Island tiles open' } },
  { id: 'quickControlsNetwork', name: 'Quick Controls: network', description: 'Wi-Fi, Bluetooth, airplane mode, VPN, encrypted DNS, IPv6, hotspot and sharing switches.', group: 'System', defaultOn: true, requires: ['quickControls'], cost: { level: 'none' } },
  { id: 'quickControlsFirewall', name: 'Quick Controls: firewall', description: 'The system firewall, stealth mode, block all incoming, and Keeper’s firewall and DNS filter.', group: 'System', defaultOn: true, requires: ['quickControls'], cost: { level: 'none' } },
  { id: 'quickControlsPrivacy', name: 'Quick Controls: privacy', description: 'Camera, microphone, location, advertising ID, diagnostics, clipboard and lock-screen switches, and per-app access.', group: 'System', defaultOn: true, requires: ['quickControls'], cost: { level: 'none' } },
  { id: 'quickControlsSecurity', name: 'Quick Controls: security', description: 'Keeper’s real-time protection and quarantine, Gatekeeper, Defender, SmartScreen and automatic updates.', group: 'System', defaultOn: true, requires: ['quickControls'], cost: { level: 'none' } },
  { id: 'settingsCatalog', name: 'Hidden system settings', description: 'Hundreds of settings your system hides, each with a preview and undo.', group: 'System', defaultOn: true, routes: ['catalog'], commands: ['catalog*'], cost: { level: 'none', background: 'Nothing in the background; values are read when the page opens' } },
  { id: 'appControls', name: 'Limits for each app', description: 'Per app: network, speed, VPN, memory, start at login and more.', group: 'System', defaultOn: true, routes: ['appcontrols'], commands: ['appcontrols*'], cost: { level: 'none', background: 'Nothing, unless an app is set to pause in the background (then only front-app changes)' } },
  { id: 'browserTabs', name: 'Browser tab controls', description: 'All open tabs across browsers in one place, with mute, sleep, site permissions, tracker blocking and per-site proxy through Keeper’s browser extension.', group: 'System', defaultOn: true, routes: ['browsers'], commands: ['browsers*'], cost: { level: 'none', background: 'Only while a browser with Keeper’s extension is open; updates when tabs change' } },
  { id: 'focusBlock', name: 'Block distractions', description: 'Blocks the sites and apps you choose while you focus, on a schedule or for a while: a calm page instead, and a short, deliberate way back in.', group: 'System', defaultOn: false, routes: ['blocking'], commands: ['blocking*'], cost: { level: 'none', background: 'Nothing until a block starts; then the browser extension, the DNS filter and a look at the app in front' } },
  { id: 'timeTracking', name: 'Time tracking', description: 'Records which app, document and site you use and for how long, only on this computer and encrypted: a day’s timeline, a week, projects by your own rules and CSV for timesheets.', group: 'System', defaultOn: false, ownChoice: true, routes: ['time'], commands: ['time*'], cost: { level: 'low', background: 'Notices when the app in front changes, and one look every 15 seconds whether you are at the computer' } },
  { id: 'tools', name: 'Toolbox', description: 'Developer tools, system tweaks and handy utilities.', group: 'System', defaultOn: true, routes: ['tools'], commands: ['tool*'], cost: { level: 'none' } },
  { id: 'soloApps', name: 'Light app icons', description: 'Keeper Mail, Keeper Notes and the other app icons start only their own part when Keeper is closed: no library, Island or widgets. Off, they start all of Keeper.', group: 'System', defaultOn: true, cost: { level: 'none', background: 'Nothing: it only changes what an app icon starts' } },
  { id: 'updates', name: 'Automatic update checks', description: 'Looks for a new Keeper on GitHub every six hours (you can always check by hand).', group: 'System', defaultOn: true, bridge: { get: (s) => s.updateMode !== 'off', set: (on, s) => ({ updateMode: on ? (s.updateMode === 'off' ? 'auto' : s.updateMode) : 'off' }) }, cost: { level: 'none', background: 'One small request every six hours' } },
  { id: 'notices', name: 'Notification center', description: 'Every notice from Keeper in one list, shown now, batched a few times a day or kept silent, per part; quiet hours and focus hold them back.', group: 'System', defaultOn: true, commands: ['notices*'], cost: { level: 'none', background: 'One timer only while a notice waits for its batch' } },
  { id: 'crashReports', name: 'Crash reports for Ashforde', description: 'When something goes wrong in Keeper, an anonymous report (version, kind of computer, the error’s name and where in Keeper’s code) helps Ashforde fix it. Never the error’s message, files or names. Off until you switch it on; Settings → Privacy shows exactly what is sent.', group: 'System', defaultOn: false, ownChoice: true, cost: { level: 'none', background: 'Nothing until something goes wrong; reports go together at most every 30 minutes' } },
  { id: 'usageStats', name: 'Anonymous usage stats', description: 'Once a day, a small anonymous report (version, kind of computer, which features and pages are used, crash counts) to help Ashforde improve Keeper. Never files, searches or names. Settings → Privacy shows exactly what is sent.', group: 'System', defaultOn: true, ownChoice: true, cost: { level: 'none', background: 'One look an hour; sends at most once a day when the computer is idle' } },
  { id: 'proAccount', name: 'Account & Pro', description: 'Your plan and license. Everything that is free stays free.', group: 'System', defaultOn: true, pro: true, ownChoice: true, cost: { level: 'none', background: 'One small check a day for license changes' } },
];

// New installs get the 1.0 defaults (Recommended for a typical computer: core/feature-tiers.ts);
// the values written above are what everyone had before, kept for upgrades (keepChoices).
for (const f of FEATURES) {
  const t = TIERS[f.id];
  f.defaultBefore1 = f.defaultOn;
  if (!t) continue;
  f.plain = t.plain;
  f.setup = t.setup;
  f.normal = t.normal;
  f.follows = t.follows;
  f.shown = t.shown;
  f.tier = t.shown === 'advanced' ? 'advanced' : t.normal === 'off' ? 'offered' : 'recommended';
  if (!f.always) f.defaultOn = staticNormal(t.normal);
}

/** A part's 1.0 default without knowing the computer: rules about the computer count as off, except the "not on…" ones. */
function staticNormal(n: Normal): boolean {
  return n === 'on' || n === 'parent' || n === 'enoughMemory' || n === 'notWindows' || n === 'notMac';
}

/** Each feature's section in the sidebar and in Settings → Features (the same groups). */
const NAV_GROUP: Record<NavGroup, string[]> = {
  files: ['library', 'sources', 'docText', 'ocr', 'places', 'network', 'filePanes', 'lock', 'remote', 'driveMount', 'bigButtons'],
  pim: ['mail', 'calendars', 'planner', 'dayPlan', 'insights', 'alarms'],
  notes: ['notes', 'captureInbox', 'cues', 'notesHub', 'notesSync', 'journal', 'reader', 'pdfReader', 'graphAll'],
  tidy: ['cleanup', 'duplicates', 'space', 'convert', 'archives', 'rules', 'history', 'fileKit', 'workflows', 'faces', 'speechModel'],
  sync: ['sync'],
  computer: ['health', 'processes', 'monitorHistory', 'monitorTray', 'devServers', 'containers', 'monitorSensors', 'soundPerApp', 'macAppVolume', 'startupItems', 'guide', 'keepAwake', 'quickControls', 'quickControlsNetwork', 'quickControlsFirewall', 'quickControlsPrivacy', 'quickControlsSecurity', 'settingsCatalog', 'appControls', 'browserTabs', 'displayControl', 'displayKeys', 'displayModes', 'brightnessSync', 'focusBlock', 'timeTracking', 'monitors', 'appUpdates', 'chargeLimit'],
  security: ['protection', 'security', 'netwatch', 'firewall', 'offlineCheck'],
  devices: ['phoneAlerts', 'link', 'remoteScreen', 'keeperMesh', 'meshDirectHandoff', 'rdcHosting', 'linkDirect', 'remoteFleet', 'remoteTerminal', 'remoteCommands', 'remoteHelp', 'screenExtras', 'unattendedAccess', 'waylandControl', 'mirroring'],
  connect: ['remoteDesktops', 'terminal'],
  ai: ['writingHelp', 'selectionBar', 'brain', 'semantic', 'assistant', 'abilities', 'aiAgents', 'usageTracker', 'agentHub', 'dictation', 'dictationHold', 'meetings', 'meetingDetect', 'meetingNotes'],
  screen: ['capture', 'photoEditor', 'studio', 'stage', 'drawOnScreen', 'stageAuto', 'tools', 'videoDownload'],
  desktop: ['textSnippets', 'snapWindows', 'widgets', 'folderBoxes', 'menuBarItems', 'mouseButtons', 'wallpaper', 'vibes', 'ambientSound', 'folderIcons', 'weather', 'tracks', 'tracksLive', 'tracksServices', 'monorail'],
  island: ['island', 'clipboard', 'media', 'agents', 'focus', 'islandWeather', 'islandAsk', 'islandUsage', 'islandSales', 'islandStocks', 'islandNotes', 'islandTodos', 'islandPlanner', 'islandInsights', 'islandPrompter', 'calendar', 'micIndicator', 'notifyMirror', 'hideInFullscreen', 'islandCalls', 'islandHud'],
  general: ['toolLauncher', 'quickSearch', 'launcher', 'tray', 'login', 'platform', 'soloApps', 'updates', 'notices', 'usageStats', 'crashReports', 'proAccount'],
};
const FALLBACK_NAV: Record<FeatureGroup, NavGroup> = { Library: 'files', Tidy: 'tidy', Island: 'island', Desktop: 'desktop', AI: 'ai', Connections: 'devices', System: 'computer' };
for (const [g, ids] of Object.entries(NAV_GROUP) as [NavGroup, string[]][]) for (const f of FEATURES) if (!f.navGroup && ids.includes(f.id)) f.navGroup = g;
for (const f of FEATURES) f.navGroup ??= FALLBACK_NAV[f.group];

/** Pages and palette commands that belong to Keeper itself and cannot be switched off (settings and appearance). */
export const CORE = {
  routes: ['settings'],
  // native-*: handing a place, forecast or day to the system's own apps (core/native-apps.ts).
  // check-updates and about: the small Software Update and About Keeper windows (a check by hand works with automatic checks off).
  // page-window and window-*: a page in a window of its own (the palette lists only pages that are on).
  commands: ['help', 'selfcheck', 'problem-report', 'appearance', 'hidden-files', 'inspector', 'inspector-settings', 'sidebar-toggle', 'permissions', 'view', 'look', 'theme-*', 'native-*', 'check-updates', 'about', 'setup-again', 'page-window', 'window-*', 'mode-*', 'focus-session*', 'send-to'],
};

const byId = new Map(FEATURES.map((f) => [f.id, f]));
// The renderer has no `process`; it passes the platform from system info.
const HOST = typeof process !== 'undefined' ? process.platform : '';

/** Does this build offer the part on this system? (Other systems' parts, and Pro's parts in builds without Pro, are left out everywhere.) */
export function featureOffered(f: Pick<FeatureDef, 'platforms' | 'pro'>, platform: string = HOST): boolean {
  if (f.pro && !proEnabled()) return false;
  return !f.platforms || !platform || f.platforms.includes(platform as NodeJS.Platform);
}
export const featureDef = (id: string) => byId.get(id);

export type FeatureMap = Record<string, boolean>;

/**
 * Upgrade safety: the settings change that writes every part's current choice into
 * `features` (parts kept in older settings already are), so that `wanted()`
 * never falls back to a default that a newer version changed. Parts this system cannot
 * run and the library itself are left out. `before` gives the default each part had
 * before the defaults changed (see `defaultBefore`).
 */
export function keepChoices(s: AllSettings, platform: string = HOST, before: (f: FeatureDef) => boolean = defaultBefore): Partial<AllSettings> {
  let next: AllSettings = { ...s, features: { ...(s.features ?? {}) } };
  for (const f of FEATURES) {
    if (f.always) continue;
    if (f.platforms && !f.platforms.includes(platform as NodeJS.Platform)) continue;
    // Parts kept in an older setting (ocrEnabled, island.clipboard…) are already written:
    // the whole merged settings object is saved, so their value cannot follow a new default.
    if (f.bridge) continue;
    if (typeof next.features[f.id] !== 'boolean') next.features = { ...next.features, [f.id]: before(f) };
  }
  return Object.keys(next.features).length === Object.keys(s.features ?? {}).length ? {} : diff(s, next);
}

/** The default a part had for everyone before 1.0 (what an upgrading install was running with). */
export function defaultBefore(f: FeatureDef): boolean {
  return f.defaultBefore1 ?? f.defaultOn;
}

/** What the person asked for (before dependencies). */
export function wanted(s: AllSettings, id: string, platform: string = HOST): boolean {
  const f = byId.get(id);
  if (!f) return true; // unknown ids (a newer feature in an older registry) stay on
  if (f.always) return true;
  if (f.platforms && !f.platforms.includes(platform as NodeJS.Platform)) return false;
  if (f.pro && !proEnabled()) return false;
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
  // Parts that follow this one come on with it (they have no switch of their own in Basic).
  if (on) for (const g of FEATURES) if (g.follows === id && g.normal === 'parent' && !g.ownChoice && !wanted(next, g.id)) apply(g.id, true);
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

/** Presets; 'balanced' and 'minimal' are their names before 1.0 (still read: saved power-source choices use them). */
export type PresetId = 'recommended' | 'light' | 'files' | 'everything' | 'balanced' | 'minimal';

/** What Recommended knows about this computer (built in the main process: electron/services/setup.ts). */
export interface ComputerContext {
  platform: string;
  /** has a battery (a laptop or tablet); null = unknown */
  battery?: boolean | null;
  /** a Mac whose screen has a notch */
  notch?: boolean;
  /** memory in GB and processor cores */
  memoryGb?: number;
  cores?: number;
  /** free space on the home disk, GB */
  freeDiskGb?: number;
  /** coding tools found (VS Code, Cursor, Claude Code, Codex, git…), by name */
  devTools?: string[];
  /** Docker or Podman found */
  docker?: boolean;
  /** an Obsidian vault or a Markdown notes folder */
  notesFound?: string;
  /** an AI on this computer: Apple's own, or Ollama */
  localAI?: 'apple' | 'ollama';
  /** Monorail is installed */
  monorail?: boolean;
  /** what the person removed from the "found on this computer" chips */
  declined?: ('dev' | 'docker' | 'notes' | 'ai')[];
}

const ALIASES: Record<string, PresetId> = { balanced: 'recommended', minimal: 'light' };
/** The 1.0 name of a preset ('balanced' → 'recommended', 'minimal' → 'light'). */
export const presetName = (id: string): PresetId => ALIASES[id] ?? (id as PresetId);

/** Is this part on in Recommended, on this computer? */
export function recommend(f: FeatureDef, ctx?: ComputerContext): boolean {
  if (f.always) return true;
  const n = f.normal;
  if (!n) return f.defaultOn;
  if (!ctx) return staticNormal(n);
  const no = (k: 'dev' | 'docker' | 'notes' | 'ai') => ctx.declined?.includes(k) ?? false;
  switch (n) {
    case 'on': return true;
    // A part that follows another is on when that one is (Draw on screen with Stage).
    case 'parent': { const p = f.follows ? byId.get(f.follows) : undefined; return p ? recommend(p, ctx) : true; }
    case 'off': return false;
    case 'dev': return !!ctx.devTools?.length && !no('dev');
    case 'docker': return !!ctx.docker && !no('dev') && !no('docker');
    case 'notesFound': return !!ctx.notesFound && !no('notes');
    case 'localAI': return !!ctx.localAI && !no('ai');
    // Text in pictures is heavy: not on computers with under 8 GB of memory or 4 cores or fewer.
    case 'enoughMemory': return (ctx.memoryGb ?? 8) >= 7.5 && (ctx.cores ?? 8) > 4;
    case 'notWindows': return ctx.platform !== 'win32';
    case 'notMac': return ctx.platform !== 'darwin';
    case 'monorail': return !!ctx.monorail;
  }
  return false;
}

export const PRESETS: { id: PresetId; name: string; description: string; on: (f: FeatureDef, ctx?: ComputerContext) => boolean }[] = [
  { id: 'recommended', name: 'Recommended', description: 'The essentials, picked for this computer. Light on battery.', on: (f, ctx) => recommend(f, ctx) },
  { id: 'light', name: 'Light', description: 'Files, search and tidying, with the Island and the menu bar. Nothing heavy in the background.', on: (f) => ['Library', 'Tidy'].includes(f.group) ? f.id !== 'ocr' : ['island', 'tray', 'quickSearch', 'clipboard', 'focus', 'keepAwake', 'hideInFullscreen', 'updates'].includes(f.id) },
  { id: 'files', name: 'Files only', description: 'A file manager and nothing else: files, search, places and tidying.', on: (f) => ['library', 'sources', 'docText', 'places', 'network', 'lock', 'cleanup', 'duplicates', 'space', 'convert', 'history', 'tray', 'quickSearch'].includes(f.id) },
  { id: 'everything', name: 'Everything', description: 'Every part on, to try it all.', on: () => true },
];

export function presetPatch(s: AllSettings, preset: PresetId, ctx?: ComputerContext): Partial<AllSettings> {
  const p = PRESETS.find((x) => x.id === presetName(preset));
  if (!p) return {};
  let next: AllSettings = { ...s, features: { ...(s.features ?? {}) } };
  for (const f of FEATURES) {
    if (f.always || f.ownChoice) continue;
    const v = p.on(f, ctx);
    if (f.bridge) next = { ...next, ...f.bridge.set(v, next) };
    else next.features = { ...next.features, [f.id]: v };
  }
  return diff(s, next);
}

/**
 * The parts Recommended turns on here, as a list for "Choose what you want" to start from:
 * a part that only follows another (with parent) is left out while that one is off,
 * so starting from this list never switches the parent on.
 */
export function recommendedIds(ctx: ComputerContext | undefined, platform: string = HOST): string[] {
  const parts = FEATURES.filter((f) => (!f.platforms || f.platforms.includes(platform as NodeJS.Platform)) && featureOffered(f, platform) && !f.ownChoice && recommend(f, ctx));
  const on = new Set(parts.map((f) => f.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const f of parts) {
      if (!on.has(f.id) || f.always) continue;
      const need = [...(f.follows ? [f.follows] : []), ...(f.requires ?? [])];
      if (need.some((r) => !on.has(r) && !byId.get(r)?.always)) { on.delete(f.id); changed = true; }
    }
  }
  return [...on];
}

/** The settings change for "Choose what you want": exactly these parts on (and what they need), the rest off. */
export function choicePatch(s: AllSettings, on: Iterable<string>): Partial<AllSettings> {
  const want = new Set(on);
  let next: AllSettings = { ...s, features: { ...(s.features ?? {}) } };
  const apply = (f: FeatureDef, v: boolean) => {
    if (f.bridge) next = { ...next, ...f.bridge.set(v, next) };
    else next.features = { ...next.features, [f.id]: v };
  };
  for (const f of FEATURES) if (!f.always && !f.ownChoice) apply(f, want.has(f.id));
  for (const id of want) {
    const extra = featurePatch(next, id, true);
    next = { ...next, ...extra };
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
export function currentPreset(s: AllSettings, ctx?: ComputerContext): PresetId | undefined {
  // Features this system cannot run never count against a preset.
  return PRESETS.find((p) => FEATURES.every((f) => f.always || f.ownChoice || !featureOffered(f) || wanted(s, f.id) === p.on(f, ctx)))?.id;
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
