// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Help that lives inside the app: for every page, what it is (one line), the
// three things you can do there, and the page's own guide from docs/*.md,
// bundled with Keeper so it works offline. The "?" in the top bar and F1 open
// it for the page you are on (src/components/HelpSheet.tsx).

import { NAV_PAGES, pageOf, hubOf, type NavRoute } from './nav';

export interface PageHelp {
  /** what this is, in one short sentence */
  what: string;
  /** the three things you can do here */
  can: [string, string, string];
  /** the page's guide in docs/ (file name) */
  doc: string;
}

/** By page id (core/nav.ts), and by the route of a tab where it has its own guide. */
export const PAGE_HELP: Record<string, PageHelp> = {
  home: { what: 'Your main folders, recent work and the one thing worth doing.', can: ['Open Desktop, Documents or Downloads', 'Jump back into recent work', 'Search by what a file is about'], doc: 'FILES.md' },
  recents: { what: 'The files you opened or changed lately.', can: ['Pick up where you left off', 'Filter by type with the chips', 'Preview with Space'], doc: 'FILES.md' },
  browse: { what: 'Your home folder, the way you know it.', can: ['Browse and preview files', 'Drag files to move or copy', 'Show hidden files'], doc: 'FILES.md' },
  library: { what: 'Every file Keeper knows about, in one list.', can: ['Filter by type, date or size', 'Sort and switch views', 'Save a search for later'], doc: 'FILES.md' },
  downloads: { what: 'Files grouped by the site or app they came from.', can: ['Find what came from one site', 'Clear out old downloads', 'Search “pdfs from mail”'], doc: 'FILES.md' },
  remote: { what: 'Cloud drives and servers, opened like folders.', can: ['Connect a drive or server', 'Browse and copy files', 'Keep sign-ins in the keychain'], doc: 'CONNECT.md' },
  notes: { what: 'Notes as plain Markdown files in folders you choose.', can: ['Write and link notes', 'See a note as a mind map', 'Import from other apps'], doc: 'NOTES.md' },
  reader: { what: 'Feeds and pages saved to read later.', can: ['Follow a site’s feed', 'Save a page for later', 'Read without clutter'], doc: 'READER.md' },
  journal: { what: 'A short entry a day, with photos and mood.', can: ['Write today’s entry', 'Add photos', 'Look back on this day'], doc: 'JOURNAL.md' },
  cues: { what: 'Notes and checklists that appear with an app or site.', can: ['Pin a checklist to an app', 'Remind yourself on a site', 'Show a cue at a time'], doc: 'ISLAND-CUES.md' },
  noteshub: { what: 'Notes from your other notes apps, in one place.', can: ['Connect another notes app', 'Search all your notes', 'Keep them in sync'], doc: 'NOTES-EVERYWHERE.md' },
  cleanup: { what: 'Caches, old installers and leftovers that are safe to remove.', can: ['Scan for what can go', 'See each item before it goes', 'Undo from Undo History'], doc: 'GUIDE.md' },
  duplicates: { what: 'Copies of the same file, and look-alike photos.', can: ['Find exact copies', 'Find look-alike photos', 'Keep the best one'], doc: 'FILES.md' },
  space: { what: 'A map of what takes up room on your disks.', can: ['See the biggest folders', 'Open a folder to look inside', 'Move or remove what you don’t need'], doc: 'FILES.md' },
  large: { what: 'The biggest files on this computer.', can: ['Sort by size', 'Preview before removing', 'Move to another disk'], doc: 'FILES.md' },
  convert: { what: 'Pictures, video, audio and documents in another format.', can: ['Convert many files at once', 'Make a PDF smaller', 'Cut out a background'], doc: 'FILEKIT.md' },
  rules: { what: 'Rules that tidy folders for you.', can: ['Move files by type or age', 'Rename as they arrive', 'Try a rule before it runs'], doc: 'FILES.md' },
  history: { what: 'Everything Keeper moved or removed, with undo.', can: ['Undo a move or rename', 'See what went to the Trash', 'Search past changes'], doc: 'FILES.md' },
  'sync-folders': { what: 'Folders kept the same on your devices.', can: ['Sync a folder', 'Choose which way it goes', 'See what changed'], doc: 'SYNC.md' },
  'sync-backups': { what: 'Copies of your files, on a schedule.', can: ['Back up a folder', 'Restore a file', 'Test that a backup works'], doc: 'SYNC.md' },
  'sync-mirrors': { what: 'A copy of a folder kept in a cloud drive.', can: ['Mirror a folder', 'Pause and resume', 'See when it last ran'], doc: 'SYNC.md' },
  'sync-versions': { what: 'Earlier versions of your files.', can: ['Find an older version', 'Compare it', 'Put it back'], doc: 'SYNC.md' },
  health: { what: 'How hard this computer is working, in plain words.', can: ['See what uses the most', 'Quit an app that hangs', 'Check battery and heat'], doc: 'MONITOR.md' },
  startup: { what: 'What starts with the computer, and the apps you have.', can: ['Stop an app starting at login', 'Find apps you don’t use', 'Uninstall cleanly'], doc: 'GUIDE.md' },
  controls: { what: 'Quick switches for your computer’s settings.', can: ['Turn Wi-Fi or Bluetooth on and off', 'Find a hidden setting', 'Set limits for an app'], doc: 'QUICK-CONTROLS.md' },
  awake: { what: 'Keeps the computer from sleeping while you need it.', can: ['Stay awake for a while', 'Stay awake while something runs', 'Keep working with the lid closed'], doc: 'KEEP-AWAKE.md' },
  time: { what: 'Where your time goes, kept only on this computer.', can: ['See today and this week', 'Group apps into projects', 'Export a timesheet'], doc: 'TIME-TRACKING.md' },
  blocking: { what: 'Blocks distracting sites and apps while you focus.', can: ['Block a list now', 'Block on a schedule', 'Make it strict'], doc: 'FOCUS-BLOCKING.md' },
  monitors: { what: 'Checks that your sites and servers are up.', can: ['Watch a site or port', 'Get told when it goes down', 'See uptime and speed'], doc: 'SITE-MONITORS.md' },
  todo: { what: 'One calm list of what is worth fixing on this computer.', can: ['Fix it, or follow the steps', 'Trust what is yours and fine', 'Snooze until later'], doc: 'GUIDE.md' },
  security: { what: 'Who can see you, where data goes, and how safe this computer is.', can: ['Fix what is worth fixing', 'See which apps can watch or listen', 'Scan for malware'], doc: 'SECURITY-CENTER.md' },
  protection: { what: 'Whether your system’s own protection is on.', can: ['See what is off', 'Turn it on step by step', 'Check again'], doc: 'SECURITY-CENTER.md' },
  firewall: { what: 'Which apps reach the internet, and where.', can: ['Allow or block an app', 'Be asked about new connections', 'See where data goes'], doc: 'FIREWALL.md' },
  netactivity: { what: 'Who this computer talks to, as it happens.', can: ['See each app’s connections', 'Spot unusual traffic', 'Look back at history'], doc: 'NETWORK.md' },
  vpn: { what: 'Your VPN connections, and whether they leak.', can: ['Connect a VPN', 'Check for leaks', 'Fix DNS going around it'], doc: 'NETWORK.md' },
  devices: { what: 'Your phones and computers, linked to Keeper.', can: ['Pair a device', 'Send files', 'Reach a computer from anywhere'], doc: 'LINK.md' },
  mesh: { what: 'A private network between your devices.', can: ['Join devices together', 'Reach them by name', 'Use one as an exit'], doc: 'MESH.md' },
  alerts: { what: 'Keeper’s alerts sent to your phone.', can: ['Choose ntfy, Telegram or e-mail', 'Pick what is sent', 'Send a test'], doc: 'PHONE-ALERTS.md' },
  rdc: { what: 'Remote desktops in a Keeper tab.', can: ['Connect to a computer', 'Save its sign-in', 'Open it full screen'], doc: 'REMOTE-DESKTOPS.md' },
  terminal: { what: 'A terminal, with tabs and coding assistants.', can: ['Open a shell or SSH', 'Split and arrange panes', 'Watch an assistant work'], doc: 'TERMINAL.md' },
  assistant: { what: 'Ask questions about your files and computer.', can: ['Ask in plain words', 'Choose which AI answers', 'Keep it on this computer'], doc: 'AI-SYSTEM.md' },
  agents: { what: 'AI agents that do tasks for you, with your say-so.', can: ['Connect an agent', 'Choose what it may do', 'Run it on a schedule'], doc: 'AGENTS.md' },
  aiusage: { what: 'Your AI subscriptions and how much is left.', can: ['See what is left', 'Get told before you run out', 'Compare plans'], doc: 'USAGE-TRACKER.md' },
  graph: { what: 'How your notes and files link together.', can: ['Explore links', 'Find what is related', 'Search by meaning'], doc: 'BRAIN.md' },
  dictation: { what: 'Speak and Keeper types for you, in any app.', can: ['Hold a key and talk', 'Say a snippet', 'See what was typed'], doc: 'VOICE.md' },
  meetings: { what: 'Record and write down a meeting.', can: ['Record a call', 'Read the transcript', 'Search past meetings'], doc: 'VOICE.md' },
  capture: { what: 'Screenshots, text from the screen and colours.', can: ['Take a screenshot', 'Copy text from the screen', 'Pin a picture on screen'], doc: 'CAPTURE.md' },
  photo: { what: 'Light edits to any picture; the original is kept.', can: ['Crop and straighten', 'Fix light and colour', 'Hide private parts'], doc: 'PHOTO-EDITOR.md' },
  studio: { what: 'Record your screen and make a clear video.', can: ['Record the screen or a window', 'Zoom on clicks', 'Export or share a link'], doc: 'CAPTURE.md' },
  stage: { what: 'A clean screen for presenting and recording.', can: ['Hide desktop clutter', 'Draw on screen', 'Start when you share'], doc: 'STAGE.md' },
  tools: { what: 'Small tools for everyday jobs.', can: ['Rename many files', 'Make a QR code', 'Check a file’s hash'], doc: 'TOOLS.md' },
  island: { what: 'The small bar at the top of your screen.', can: ['Choose what it shows', 'Change how it looks', 'Drop files on its shelf'], doc: 'ISLAND-TOOLS.md' },
  snippets: { what: 'Short words that become your saved text.', can: ['Add a snippet', 'Fill in the date', 'Import a list'], doc: 'LAUNCHER.md' },
  widgets: { what: 'Small cards on your desktop.', can: ['Add a clock or the weather', 'Move them where you like', 'Choose their look'], doc: 'MENU-BAR.md' },
  ambience: { what: 'Wallpaper, sound and mood for your desktop.', can: ['Pick a live wallpaper', 'Play a calm sound', 'Save a vibe'], doc: 'AMBIENCE.md' },
  weather: { what: 'The forecast for your places.', can: ['Add a place', 'See the week ahead', 'Get rain alerts'], doc: 'WEATHER.md' },
  tracks: { what: 'Your trips and places on a map, kept with you.', can: ['Import a track', 'See places you went', 'Share live, if you choose'], doc: 'TRACKS.md' },
  mail: { what: 'All your mail accounts in one inbox.', can: ['Read and reply', 'Snooze until later', 'Send later'], doc: 'PIM.md' },
  calendar: { what: 'Your calendars, from every account.', can: ['Add an event', 'See your week', 'Join a meeting'], doc: 'PIM.md' },
  reminders: { what: 'Things to do, with when and where.', can: ['Add a reminder', 'See today’s list', 'Flag what is important'], doc: 'PIM.md' },
  planner: { what: 'Your tasks laid out over the day and week.', can: ['Plan today', 'Move tasks between days', 'See what is overdue'], doc: 'PLANNER.md' },
  alarms: { what: 'Alarms, timers, a stopwatch and world clocks.', can: ['Set an alarm', 'Start a timer', 'Add a city'], doc: 'PIM.md' },
  settings: { what: 'Everything you can change about Keeper.', can: ['Search for a setting', 'Turn parts on or off', 'Export your settings'], doc: 'SETTINGS-CATALOG.md' },
  setup: { what: 'Choose what Keeper is for, in a few steps.', can: ['Pick up to three goals', 'Choose each part yourself', 'Run it again any time'], doc: 'SETUP.md' },
  help: { what: 'Help for the page you are on.', can: ['Read what the page is for', 'See three things to try', 'Read its guide offline'], doc: 'HELP.md' },
};

/** Docs that are for people using Keeper (the rest are for its makers and are not bundled). */
export const HELP_DOCS = [...new Set(Object.values(PAGE_HELP).map((h) => h.doc))].sort();

export interface HelpFor extends PageHelp {
  title: string;
}

/** The help for the page a route belongs to (a tab with its own guide first, then its page). */
export function helpFor(r: NavRoute): HelpFor {
  const page = pageOf(r);
  // A tab of a merged page with a guide of its own (Network & firewall under Privacy & Security).
  const tab = hubOf(r);
  const ownTab = !!tab && !!PAGE_HELP[r.name] && r.name !== page?.route.name;
  const h = (ownTab ? PAGE_HELP[r.name] : undefined) ?? (page ? PAGE_HELP[page.id] : undefined) ?? PAGE_HELP[r.name];
  if (h) return { title: (ownTab ? tab!.tab.label : page?.label) ?? 'Keeper', ...h };
  return { title: page?.label ?? 'Keeper', what: 'Keeper keeps your files and your computer in order.', can: ['Search from anywhere', 'Fix what is worth fixing', 'Turn parts on in Settings'], doc: 'GUIDE.md' };
}

/**
 * A doc as it is shown in the sheet: pictures and HTML comments taken out
 * (pictures are not bundled), the title line dropped (the sheet has its own),
 * and links to other docs kept so the sheet can follow them.
 */
export function cleanDoc(md: string): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/^# .*\n+/, '')
    // Notes for Keeper's makers: whole sections, and "Code:" or "Tests:" paragraphs.
    .split(/(?=^## )/m)
    .filter((sec) => !MAKERS.test(sec.split('\n')[0]))
    .join('')
    .replace(/^(?:Code|Tests?):[^\n]*(?:\n(?!\n)[^\n]*)*\n*/gm, '')
    .trim();
}

/** Section titles that are for Keeper's makers, not the people using it. */
const MAKERS = /^## .*(developer|verified|what is tested|testing|tests|real mac|real windows|needs a real|how it is built|internals|code)/i;

/** The headings of a doc, for its short contents line. */
export function docHeadings(md: string): string[] {
  return [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
}

/** Pages without help: none should be listed here (a test keeps it so). */
export function pagesWithoutHelp(): string[] {
  return NAV_PAGES.filter((p) => !PAGE_HELP[p.id]).map((p) => p.id);
}
