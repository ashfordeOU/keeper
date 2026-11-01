// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The test areas, in the order they run. "quick" marks the ones in the
// 15-minute smoke run (--quick runs a lighter version of each).

import type { Ctx } from '../context';
import { runAmbience } from './ambience';
import { runAwake } from './awake';
import { runCalendar } from './calendar';
import { runHelper } from './helper';
import { runIsland } from './island';
import { runMonitor } from './monitor';
import { runMonorail } from './monorail';
import { runFirewall, runLink } from './network';
import { runNotes, runTracks } from './places';
import { runRdc } from './rdc';
import { runCatalog, runSecurity } from './settings';
import { runStage } from './stage';
import { runPerf, runUsage } from './usage';
import { runVoice } from './voice';

export interface Area {
  id: string;
  title: string;
  /** in the --quick run */
  quick: boolean;
  /** rough minutes (full, quick), including the owner's part */
  minutes: [number, number];
  /** needs Keeper itself running */
  app: boolean;
  /** what the owner may be asked to do */
  guided?: string;
  /** what may change on the Mac (always asked first) */
  changes?: string;
  run(ctx: Ctx, extra: { stub: { url: string; hits: () => number } }): Promise<void>;
}

export const AREAS: Area[] = [
  { id: 'island', title: 'Island (notch, menu bar, hang mode)', quick: true, minutes: [5, 2], app: true, guided: 'look at the Island; an app with long menus; an external display', run: (c) => runIsland(c) },
  { id: 'awake', title: 'Keep Awake', quick: true, minutes: [6, 1], app: true, guided: 'look at the menu-bar icon; closed-lid mode (password, close the lid)', changes: 'closed-lid mode: a sudoers rule for pmset and sleep turned off for a moment (only with your yes)', run: (c) => runAwake(c) },
  { id: 'stage', title: 'Stage', quick: true, minutes: [6, 2], app: true, changes: 'Dock, menu bar, desktop icons, alert volume, hidden apps, screen resolution: each for seconds, then put back (only with your yes)', run: (c) => runStage(c) },
  { id: 'helper', title: 'keeper-helper (native macOS methods)', quick: true, minutes: [4, 1], app: false, guided: 'a notification from another app; a call; a few key presses', run: (c) => runHelper(c) },
  { id: 'voice', title: 'Voice', quick: true, minutes: [7, 2], app: true, guided: 'say a sentence; hold the talk key and speak', run: (c) => runVoice(c) },
  { id: 'calendar', title: 'Calendar (the Mac’s calendars through EventKit)', quick: false, minutes: [4, 0], app: true, guided: 'allow calendar access; change an event in Calendar', changes: 'one test event added and removed again (only with your yes)', run: (c) => runCalendar(c) },
  { id: 'monitor', title: 'System monitor', quick: true, minutes: [2, 1], app: true, run: (c) => runMonitor(c) },
  { id: 'rdc', title: 'Remote desktops', quick: false, minutes: [2, 0], app: true, guided: 'open a test .rdp file (optional)', run: (c) => runRdc(c) },
  { id: 'tracks', title: 'Places & Tracks (Find My cache)', quick: false, minutes: [1, 0], app: true, run: (c) => runTracks(c) },
  { id: 'notes', title: 'Notes (Apple Notes, Bear; read only)', quick: false, minutes: [2, 0], app: false, guided: 'allow Automation for Notes', run: (c) => runNotes(c) },
  { id: 'link', title: 'Keeper Link and the mesh', quick: false, minutes: [3, 0], app: true, changes: 'the mesh helper LaunchDaemon (optional, only with your yes)', run: (c) => runLink(c) },
  { id: 'firewall', title: 'Firewall (pf, parse only)', quick: false, minutes: [1, 0], app: true, run: (c) => runFirewall(c) },
  { id: 'ambience', title: 'Ambience (live wallpaper, folder icons)', quick: false, minutes: [3, 0], app: true, guided: 'look at the desktop', changes: 'the desktop picture for a moment (optional, only with your yes)', run: (c) => runAmbience(c) },
  { id: 'catalog', title: 'Settings catalogue (read only)', quick: false, minutes: [2, 0], app: true, run: (c) => runCatalog(c) },
  { id: 'security', title: 'Security center, quick controls, app controls (read only)', quick: false, minutes: [2, 0], app: true, run: (c) => runSecurity(c) },
  { id: 'monorail', title: 'Monorail present (only when Monorail is installed)', quick: false, minutes: [3, 0], app: true, changes: 'Monorail’s focus mode, hidden apps and the Dock for a few seconds; Monorail’s settings.json is copied first and put back (only with your yes)', run: (c) => runMonorail(c) },
  { id: 'usage', title: 'Usage stats payload (never sent)', quick: true, minutes: [1, 1], app: true, run: (c, x) => runUsage(c, x.stub) },
  { id: 'perf', title: 'Performance (start-up, idle)', quick: true, minutes: [4, 1], app: true, run: (c) => runPerf(c) },
];

export const AREA_TITLES: Record<string, string> = {
  setup: 'Setup (prerequisites and builds)', system: 'The Mac', permissions: 'Privacy permissions', cleanup: 'Cleanup',
  ...Object.fromEntries(AREAS.map((a) => [a.id, a.title])),
};

/** Which areas run, from --quick, --only and --skip. */
export function chooseAreas(o: { quick: boolean; only: string[]; skip: string[] }): { areas: Area[]; unknown: string[] } {
  const known = new Set(AREAS.map((a) => a.id));
  const unknown = [...o.only, ...o.skip].filter((id) => !known.has(id));
  let list = o.only.length ? AREAS.filter((a) => o.only.includes(a.id)) : o.quick ? AREAS.filter((a) => a.quick) : AREAS.slice();
  list = list.filter((a) => !o.skip.includes(a.id));
  return { areas: list, unknown };
}
