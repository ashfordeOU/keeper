// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Light apps: Keeper Mail, Keeper Notes, Keeper Files… each started on its own
// (`Keeper --keeper-solo=mail`) for someone who wants just that part, not all of
// Keeper. A light app runs only what its page needs; the library, the Island,
// widgets, the menu bar icon, the system monitor, sync, Keeper Link and the AI
// stay off. It is the same program as Keeper, with the same settings, accounts,
// keychain and updates (docs/SOLO.md).
//
//   • Keeper is open already: the app icon just opens its page in a window of
//     Keeper's (no second process).
//   • A light app is open and another app icon is used: the same light app adds
//     that part (one process; Mail and Calendar share their service anyway).
//   • A light app is open and Keeper itself is started: the light app saves,
//     stops its services, lets go of its locks and starts Keeper, which opens the
//     same windows again. Never two processes with the same services.
//
// No Electron here: electron/solo/main.ts does the work.

import { LAUNCHERS, launcherDef, launcherPage, SOLO_SWITCH, type LauncherDef } from './launchers';
import { featureOfRoute, pageOf, type NavRoute } from './nav';

export { SOLO_SWITCH };

/** What a light app can run. Everything else of Keeper stays off. */
export type SoloService = 'pim' | 'notes' | 'library' | 'studio' | 'terminal' | 'rdc';

export interface SoloServiceDef {
  id: SoloService;
  /** plain words, for the docs and the Processes page */
  name: string;
}

export const SOLO_SERVICES: SoloServiceDef[] = [
  { id: 'pim', name: 'Mail, calendars, reminders and alarms' },
  { id: 'notes', name: 'Notes vaults' },
  { id: 'library', name: 'The library of your files' },
  { id: 'studio', name: 'Studio recording and editing' },
  { id: 'terminal', name: 'Terminals' },
  { id: 'rdc', name: 'Remote Desktops' },
];

/** What a light app never starts (Keeper itself does, when it is open). */
export const STAYS_OFF = [
  'the library index (except in Keeper Files)',
  'the Island',
  'desktop widgets',
  'the menu bar or tray icon',
  'the system monitor',
  'sync and backups',
  'Keeper Link and remote screens',
  'the AI brain and agents',
  'automations and Quick Search',
  'global shortcuts',
] as const;

/** Every part of Keeper's suite that a light app leaves to Keeper (core/suite.ts roles). */
export const SOLO_NEVER_PARTS = ['island', 'widgets'] as const;

/** The app icon named by `--keeper-solo=<id>` (or `--keeper-solo <id>`); anything else is ignored. */
export function soloFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = a.startsWith(`${SOLO_SWITCH}=`) ? a.slice(SOLO_SWITCH.length + 1) : a === SOLO_SWITCH ? argv[i + 1] : undefined;
    if (v === undefined) continue;
    const id = String(v).trim().toLowerCase();
    return launcherDef(id) ? id : undefined;
  }
  return undefined;
}

/** The app icon whose window shows this page (Mail for `mail`, Files for `browse`), if any. */
export function soloAppOfPage(page: string | undefined): LauncherDef | undefined {
  if (!page) return undefined;
  return LAUNCHERS.find((l) => launcherPage(l) === page);
}

export interface SoloPlan {
  /** the app icons this process serves */
  apps: string[];
  /** their pages (what their windows show) */
  pages: string[];
  /** the services to start, each once, in a fixed order */
  services: SoloService[];
  /** whether the graphics card is used (Studio records and exports with it); the others draw in software */
  gpu: boolean;
}

/**
 * What a light app serving `apps` runs. Unknown ids and apps whose feature is off are left out
 * (`featureOn` answers for core/features.ts). Mail and Calendar share one service, started once.
 */
export function soloPlan(apps: readonly string[], featureOn: (id: string) => boolean = () => true): SoloPlan {
  const defs = [...new Set(apps)].map((a) => launcherDef(a)).filter((l): l is LauncherDef => !!l && featureOn(l.feature));
  const wanted = new Set(defs.flatMap((l) => l.services));
  const services = SOLO_SERVICES.map((s) => s.id).filter((s) => wanted.has(s));
  return { apps: defs.map((l) => l.page), pages: defs.map(launcherPage), services, gpu: wanted.has('studio') };
}

/** The services one more app adds to a running light app (nothing when they run already). */
export function servicesToAdd(running: readonly SoloService[], app: string): SoloService[] {
  const l = launcherDef(app);
  if (!l) return [];
  return l.services.filter((s) => !running.includes(s));
}

/** How an app icon's start goes. */
export type SoloStart =
  /** Keeper (or a light app) is running: hand the request to it, and stop */
  | 'hand-over'
  /** start Keeper itself instead (light apps switched off, or a part of Keeper is still running) */
  | 'keeper'
  /** start as a light app */
  | 'solo';

export function soloStart(o: { app: string | undefined; running: boolean; enabled: boolean; partRunning: boolean; safeMode?: boolean }): SoloStart {
  if (o.running) return 'hand-over';
  if (!o.app || !o.enabled || o.partRunning || o.safeMode) return 'keeper';
  return 'solo';
}

/** What a later start asks of a running light app. */
export type SoloRequest =
  /** another app icon (or a page an app icon has): added to this light app */
  | { kind: 'add'; app: string }
  /** anything else (Keeper itself, a link, a file, another page): Keeper takes over */
  | { kind: 'keeper' };

/**
 * A later start's command line, as a running light app sees it. Only app icons and their
 * pages stay in the light app; Keeper's own start (with or without --hidden), its links and
 * files, and every other page need Keeper.
 */
export function soloRequestOf(argv: readonly string[], pageOf: (argv: readonly string[]) => string | undefined): SoloRequest {
  const solo = soloFromArgv(argv);
  if (solo) return { kind: 'add', app: solo };
  const page = pageOf(argv);
  const app = soloAppOfPage(page);
  if (app) return { kind: 'add', app: app.page };
  return { kind: 'keeper' };
}

/** The switch that tells Keeper which windows a light app had open when it took over: `--keeper-reopen=mail,notes`. */
export const REOPEN_SWITCH = '--keeper-reopen';

/** The pages named by `--keeper-reopen=…` (only pages app icons show). */
export function reopenFromArgv(argv: readonly string[]): string[] {
  const a = argv.find((x) => x.startsWith(`${REOPEN_SWITCH}=`));
  if (!a) return [];
  const pages = a.slice(REOPEN_SWITCH.length + 1).split(',').map((p) => p.trim().toLowerCase());
  return [...new Set(pages.filter((p) => !!soloAppOfPage(p)))];
}

/**
 * Keeper's command line when it takes over from a light app: what the later start asked for
 * (its links, files, --hidden…), without any light-app switch, plus the windows to open again.
 * `request` is the later start's arguments after the program (and a development copy's folder).
 */
export function takeOverArgs(request: readonly string[], openPages: readonly string[]): string[] {
  const out = request.filter((a, i) => !(a.startsWith(`${SOLO_SWITCH}=`) || a === SOLO_SWITCH || (i > 0 && request[i - 1] === SOLO_SWITCH) || a.startsWith(`${REOPEN_SWITCH}=`)));
  const pages = [...new Set(openPages.filter((p) => !!soloAppOfPage(p)))];
  return pages.length ? [...out, `${REOPEN_SWITCH}=${pages.join(',')}`] : out;
}

/**
 * Whether a route stays in a light app's window that shows `windowPage`: places in its own page
 * and the pages of the same part (Keeper Files goes anywhere in the library). Any other page goes
 * to its own app icon's window, or to Keeper.
 */
export function soloKeepsRoute(windowPage: string, r: NavRoute): boolean {
  const app = soloAppOfPage(windowPage);
  if (!app) return true;
  const page = pageOf(r);
  if (page?.id === windowPage) return true;
  const feature = featureOfRoute(r.name);
  if (feature === app.feature) return true;
  return !page && !feature;
}

/** A light app's windows are named after it ("Keeper Mail"), in the Dock, the taskbar and window lists. */
export function soloWindowTitle(app: string): string {
  return launcherDef(app)?.name ?? 'Keeper';
}

/** Windows: the app ID a light app's windows group under on the taskbar (its shortcut carries the same). */
export function soloAppUserModelId(app: string): string | undefined {
  return launcherDef(app)?.bundleId;
}

/** What a light app's windows can ask (absent, or failing, in Keeper itself). */
export interface SoloInfo {
  /** the app icons this light app serves ("mail") */
  apps: string[];
  /** their names ("Keeper Mail") */
  names: string[];
}

export interface SoloApi {
  /** null in Keeper itself */
  info(): Promise<SoloInfo | null>;
  /** starts Keeper itself, which takes over these windows (optionally on a page: "settings:accounts") */
  openKeeper(route?: string): Promise<void>;
}
