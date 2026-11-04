// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Monorail by Ashforde®, the scrolling window manager for macOS, as Keeper
// sees it: where it comes from, how a download is checked, what it publishes
// (state.json), the tools it offers through its local API, its shortcuts and
// slider bar (so Keeper can stay out of its way) and how its themes match ours.
//
// Pure: no Node or Electron here. electron/services/ashforde does the work.

import type { Rect } from '../island-place';

export const MONORAIL = {
  id: 'monorail',
  name: 'Monorail',
  repo: 'ashfordeOU/monorail',
  homepage: 'https://github.com/ashfordeOU/monorail',
  /** the identifier releases ship with today (kept from its MacSlider days) */
  bundleId: 'org.ashforde.macslider',
  /**
   * Every identifier a genuine Monorail can have: today's, the one it is moving to,
   * and the Mac App Store edition's. Keeper finds, opens and quits whichever is installed.
   */
  bundleIds: ['org.ashforde.macslider', 'org.ashforde.monorail', 'org.ashforde.monorail.appstore'],
  /** the identifiers its GitHub releases are signed with (the App Store edition never comes from there) */
  releaseBundleIds: ['org.ashforde.macslider', 'org.ashforde.monorail'],
  /** its earlier name; an old copy is replaced on install */
  legacyName: 'MacSlider',
  /** the name of the certificate its releases are signed with (self-signed) */
  signer: 'MacSlider Self-Signed',
  minMacOS: 13,
  platforms: ['darwin'] as NodeJS.Platform[],
  /** ~/Library/Application Support/<dir> */
  supportDir: 'Monorail',
  /** posted (distributed) whenever state.json changes */
  notification: 'org.ashforde.monorail.changed',
  defaultPort: 4767,
} as const;

/** Whether `id` is one of Monorail's identifiers (any edition). */
export const isMonorailBundleId = (id: string | undefined): boolean =>
  !!id && (MONORAIL.bundleIds as readonly string[]).includes(id);

/** Whether `id` is one a Monorail release from GitHub may be signed as. */
export const isReleaseBundleId = (id: string | undefined): boolean =>
  !!id && (MONORAIL.releaseBundleIds as readonly string[]).includes(id);

/** The Mac App Store edition, which the App Store keeps up to date. */
export const isAppStoreEdition = (id: string | undefined): boolean => id === 'org.ashforde.monorail.appstore';

/** The Spotlight query that finds any copy of Monorail. */
export const spotlightQuery = (): string =>
  MONORAIL.bundleIds.map((id) => `kMDItemCFBundleIdentifier == '${id}'`).join(' || ');

// ---------------------------------------------------------------- releases

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

export interface Release {
  tag_name: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  html_url?: string;
  assets: ReleaseAsset[];
}

/** "v1.2.0" → "1.2.0". */
export const versionOf = (tag: string) => tag.trim().replace(/^v/i, '');

/**
 * Negative when a is older than b, 0 when equal, positive when newer. Semantic
 * versions: a release is newer than its own pre-releases (1.2.0 > 1.2.0-beta.3),
 * and pre-release parts compare number by number (beta.10 > beta.9).
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const s = versionOf(v).replace(/\+.*$/, '');
    const i = s.indexOf('-');
    return { core: (i < 0 ? s : s.slice(0, i)).split('.'), pre: i < 0 ? [] : s.slice(i + 1).split('.') };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i++) {
    const d = (Number(x.core[i] ?? 0) || 0) - (Number(y.core[i] ?? 0) || 0);
    if (d) return d;
  }
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) + (y.pre.length ? 1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return +p - +q;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** The app archive and its checksum list in a release; both are needed to install. */
export function pickAssets(r: Release): { archive: ReleaseAsset; sums: ReleaseAsset } | null {
  const zip = (prefix: string) => r.assets.find((a) => a.name.startsWith(`${prefix}-`) && a.name.endsWith('.zip'));
  const archive = zip(MONORAIL.name) ?? zip(MONORAIL.legacyName);
  const sums = r.assets.find((a) => a.name === 'SHA256SUMS');
  return archive && sums ? { archive, sums } : null;
}

/** The SHA-256 listed for a file in `shasum -a 256` output ("<hex>  <name>" or "<hex> *<name>"). */
export function checksumFor(sums: string, file: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (m && (m[2] === file || m[2].split('/').pop() === file)) return m[1].toLowerCase();
  }
  return null;
}

/**
 * The newest usable release from a list (no drafts; pre-releases only when asked:
 * Keeper asks when the person follows Keeper's betas). A stable release beats its
 * own pre-releases.
 */
export function newestRelease(list: Release[], prerelease = false): Release | null {
  const ok = list.filter((r) => !r.draft && (prerelease || !r.prerelease) && pickAssets(r));
  ok.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  return ok[0] ?? null;
}

// ---------------------------------------------------------------- code signature

export interface Signature {
  identifier?: string;
  /** certificate chain, leaf first ("Authority=" lines) */
  authorities: string[];
  teamId?: string;
  adhoc: boolean;
}

/** Reads `codesign -dvv` output (it writes to stderr). */
export function parseCodesign(text: string): Signature {
  const sig: Signature = { authorities: [], adhoc: false };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const [k, ...rest] = line.split('=');
    const v = rest.join('=').trim();
    if (k === 'Identifier') sig.identifier = v;
    else if (k === 'Authority') sig.authorities.push(v);
    else if (k === 'TeamIdentifier' && v && v !== 'not set') sig.teamId = v;
    else if (k === 'Signature' && /adhoc/i.test(v)) sig.adhoc = true;
  }
  return sig;
}

/**
 * Whether a downloaded or installed copy is signed the way Monorail's
 * releases are: its own identifier, its own certificate, and (once Keeper
 * has seen it) the very same certificate as before.
 */
export function checkSignature(sig: Signature, certSha256: string | undefined, pinned: string | undefined): { ok: boolean; reason: string } {
  if (sig.adhoc) return { ok: false, reason: 'It is not signed with Monorail’s certificate (ad-hoc signature).' };
  if (!isReleaseBundleId(sig.identifier)) return { ok: false, reason: `It is signed as “${sig.identifier ?? 'nothing'}”, not as Monorail.` };
  if (sig.authorities[0] !== MONORAIL.signer) return { ok: false, reason: `It is signed by “${sig.authorities[0] ?? 'nobody'}”, not by Ashforde’s Monorail certificate.` };
  if (pinned && certSha256 && pinned.toLowerCase() !== certSha256.toLowerCase()) return { ok: false, reason: 'Its certificate is not the one your installed Monorail was signed with.' };
  return { ok: true, reason: pinned ? 'Signed with the same certificate as before.' : 'Signed with Monorail’s certificate.' };
}

// ---------------------------------------------------------------- state.json

export interface MonorailState {
  workspace: number;
  workspaceName: string;
  workspaceCount: number;
  profile: string;
  slide: number;
  slides: number;
  app?: string;
  title?: string;
  focusMode: boolean;
  /** newer Monorail versions (see docs/KEEPER-MONORAIL.md): presentation mode, Stay Awake, tiling paused */
  presenting?: boolean;
  awake?: boolean;
  paused?: boolean;
}

/** state.json, leniently; null when it is not Monorail's. */
export function parseState(text: string): MonorailState | null {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (typeof j.workspace !== 'number' || typeof j.slides !== 'number') return null;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    return {
      workspace: j.workspace,
      workspaceName: str(j.workspaceName) ?? `Workspace ${j.workspace}`,
      workspaceCount: typeof j.workspaceCount === 'number' ? j.workspaceCount : j.workspace,
      profile: str(j.profile) ?? '',
      slide: typeof j.slide === 'number' ? j.slide : 1,
      slides: j.slides,
      app: str(j.app),
      title: str(j.title),
      focusMode: j.focusMode === true,
      ...(typeof j.presenting === 'boolean' ? { presenting: j.presenting } : {}),
      ...(typeof j.awake === 'boolean' ? { awake: j.awake } : {}),
      ...(typeof j.paused === 'boolean' ? { paused: j.paused } : {}),
    };
  } catch {
    return null;
  }
}

/** One short line for the Island and the menu: "Work · slide 2 of 5". */
export function describeState(s: MonorailState): string {
  const name = s.workspaceName || `Workspace ${s.workspace}`;
  return `${name} · slide ${s.slide} of ${s.slides}${s.focusMode ? ' · focus' : ''}`;
}

// ---------------------------------------------------------------- its settings.json

/** The parts of Monorail's settings Keeper reads (all optional: older files lack them). */
export interface MonorailSettings {
  localAPI?: boolean;
  apiPort?: number;
  publishState?: boolean;
  theme?: string;
  sliderBar?: 'off' | 'whileMoving' | 'always' | string;
  sliderBarEdge?: 'top' | 'bottom';
  keymap?: Record<string, { keyCode: number; modifiers: number }[]>;
  appRules?: { bundleID: string; name: string; float: boolean; titleContains?: string; ruleID?: string }[];
  /** its own updater (on by default) */
  checkForUpdates?: boolean;
  installUpdatesAutomatically?: boolean;
  /** desktop pictures it sets */
  workspaceWallpapers?: Record<string, string>;
  driftWallpaper?: string;
  /** its Stay Awake and focus timer */
  awakeDefaultMinutes?: number;
  focusMinutes?: number;
}

/**
 * The changes Keeper makes to Monorail's settings when you connect them: the
 * local API (so Keeper and your AI tools can ask it things) and state.json
 * (so Keeper can follow it without asking). Nothing else is touched.
 */
export function connectPatch(s: MonorailSettings): Partial<MonorailSettings> {
  const p: Partial<MonorailSettings> = {};
  if (!s.localAPI) p.localAPI = true;
  if (!s.publishState) p.publishState = true;
  return p;
}

export const KEEPER_BUNDLE_ID = 'io.github.ashfordeou.keeper';

/** Keeper's small windows float over Monorail's strip instead of becoming a column. */
export const FLOAT_RULES: NonNullable<MonorailSettings['appRules']> = [
  { bundleID: KEEPER_BUNDLE_ID, name: 'Keeper — Quick Search', float: true, titleContains: 'Quick Search', ruleID: 'keeper-quick-search' },
  { bundleID: KEEPER_BUNDLE_ID, name: 'Keeper — Quick Terminal', float: true, titleContains: 'Quick Terminal', ruleID: 'keeper-quick-terminal' },
  { bundleID: KEEPER_BUNDLE_ID, name: 'Keeper — Capture', float: true, titleContains: 'Capture', ruleID: 'keeper-capture' },
];

/** Keeper's overlays and floating windows, each with a fixed title (electron/services/unmanaged.ts). */
export const OVERLAY_TITLES = {
  island: 'Keeper Island',
  clips: 'Keeper Clipboard',
  selection: 'Keeper Selection',
  popover: 'Keeper Glance',
  voice: 'Keeper Voice',
  cue: 'Keeper cue',
  inbox: 'Keeper Inbox card',
  launcher: 'Keeper Launcher',
  stage: 'Keeper Stage overlay',
  backdrop: 'Keeper Stage backdrop',
  widget: 'Keeper Widget',
  wallpaper: 'Keeper Wallpaper',
  quickConnect: 'Quick Connect — Keeper',
  guide: 'Keeper guide',
  sharing: 'Keeper — sharing this screen',
  blocked: 'Keeper — paused while you focus',
  ask: 'Keeper — new connection',
  pin: 'Keeper pinned picture',
  preview: 'Keeper capture preview',
  scrollBar: 'Keeper scrolling capture',
} as const;
export type OverlayKind = keyof typeof OVERLAY_TITLES;

/**
 * Monorail must never tile these: the Island sits in the notch, the rest float
 * where Keeper puts them. Added whenever Monorail is installed (its own float
 * switch only covers the windows above), and kept when that switch goes off.
 */
export const OVERLAY_RULES: NonNullable<MonorailSettings['appRules']> = (Object.entries(OVERLAY_TITLES) as [OverlayKind, string][])
  .filter(([k]) => k !== 'backdrop') // "Keeper Stage" below covers the overlay and the backdrop
  .map(([k, title]) => ({ bundleID: KEEPER_BUNDLE_ID, name: `Keeper — ${title.replace(/^Keeper\s*(—\s*)?/, '').replace(/ — Keeper$/, '')}`, float: true, titleContains: k === 'stage' ? 'Keeper Stage' : title, ruleID: `keeper-overlay-${k}` }));

/** Monorail's settings with every overlay rule present (idempotent; other rules stay as they are). */
export function withOverlayRules(s: MonorailSettings): MonorailSettings {
  const have = new Set((s.appRules ?? []).map((r) => r.ruleID));
  const add = OVERLAY_RULES.filter((r) => !have.has(r.ruleID));
  return add.length ? { ...s, appRules: [...(s.appRules ?? []), ...add] } : s;
}

/** The rules to add (those not there yet, matched by id). */
export function missingFloatRules(s: MonorailSettings): NonNullable<MonorailSettings['appRules']> {
  const have = new Set((s.appRules ?? []).map((r) => r.ruleID ?? `${r.bundleID}|${r.titleContains ?? ''}`));
  return FLOAT_RULES.filter((r) => !have.has(r.ruleID!) && !have.has(`${r.bundleID}|${r.titleContains}`));
}

/** Monorail's settings with Keeper's float rules added, or removed (`on` false). */
export function withFloatRules(s: MonorailSettings, on: boolean): MonorailSettings {
  const ids = new Set(FLOAT_RULES.map((r) => r.ruleID));
  const rest = (s.appRules ?? []).filter((r) => !ids.has(r.ruleID));
  return { ...s, appRules: on ? [...rest, ...FLOAT_RULES] : rest };
}

// ---------------------------------------------------------------- shortcuts

/** Monorail's modifier bits. */
export const MOD = { control: 1, option: 2, shift: 4, command: 8 } as const;

/** macOS virtual key codes → the key's name, as Electron accelerators spell it. */
const KEY_NAMES: Record<number, string> = {
  0: 'A', 1: 'S', 2: 'D', 3: 'F', 4: 'H', 5: 'G', 6: 'Z', 7: 'X', 8: 'C', 9: 'V', 11: 'B', 12: 'Q', 13: 'W', 14: 'E', 15: 'R',
  16: 'Y', 17: 'T', 18: '1', 19: '2', 20: '3', 21: '4', 22: '6', 23: '5', 24: '=', 25: '9', 26: '7', 27: '-', 28: '8', 29: '0',
  30: ']', 31: 'O', 32: 'U', 33: '[', 34: 'I', 35: 'P', 36: 'Return', 37: 'L', 38: 'J', 39: "'", 40: 'K', 41: ';', 42: '\\',
  43: ',', 44: '/', 45: 'N', 46: 'M', 47: '.', 48: 'Tab', 49: 'Space', 50: '`', 51: 'Backspace', 53: 'Escape',
  122: 'F1', 120: 'F2', 99: 'F3', 118: 'F4', 96: 'F5', 97: 'F6', 98: 'F7', 100: 'F8', 101: 'F9', 109: 'F10', 103: 'F11', 111: 'F12',
  115: 'Home', 119: 'End', 116: 'PageUp', 121: 'PageDown', 117: 'Delete', 123: 'Left', 124: 'Right', 125: 'Down', 126: 'Up',
};

// Monorail's default keys ("action:modifiers:keyCode"; co = ⌃⌥, cos = ⌃⌥⇧, coc = ⌃⌥⌘), used
// until its settings.json lists its own. Digits 1–9 switch workspaces (⌃⌥) and move windows (⌃⌥⇧).
const DEFAULT_KEYS = 'focusLeft:co:4 focusLeft:co:123 focusRight:co:37 focusRight:co:124 focusUp:co:40 focusUp:co:126 focusDown:co:38 focusDown:co:125 focusFirst:co:115 focusLast:co:119 moveLeft:cos:4 moveLeft:cos:123 moveRight:cos:37 moveRight:cos:124 moveUp:cos:40 moveUp:cos:126 moveDown:cos:38 moveDown:cos:125 cycleWidth:co:15 cycleWidthBackward:cos:15 narrower:co:27 wider:co:24 toggleFullWidth:co:3 center:co:8 consumeIntoLeft:co:33 consumeIntoRight:co:30 expelLeft:cos:33 expel:cos:30 toggleFloat:co:17 pinLeft:co:35 pinRight:cos:35 toggleTabbed:co:13 toggleTabbed:cos:17 cycleLayout:co:5 mainLarger:co:47 mainSmaller:co:43 makeMain:co:46 regroup:co:0 overview:co:31 overview:co:48 toggleNativeFullScreen:cos:3 windowSwitcher:co:49 sendToNextDisplay:co:2 sendToNextDisplay:co:45 retile:co:53 undo:co:6 setMark:cos:41 jumpToMark:co:41 toggleScratchpad:co:50 makeScratchpad:cos:50 nextProfile:co:29 toggleFocusMode:co:11 commandPalette:co:44 takeSnapshot:cos:1 toggleSticky:co:1 zoomTile:co:7 lastWindow:co:51 quickLaunch:co:32 pictureInPicture:co:34 radialMenu:co:14 balanceSizes:cos:24 workspaceBackAndForth:cos:51 moveToEmptyWorkspace:cos:45 focusAttention:cos:0 showDesktop:cos:2 screenshotSlide:cos:8 appOverview:cos:31 windowHints:co:9 resizeMode:cos:14 stripZoom:cos:6 presentationMode:cos:16 recordSlide:cos:9 redo:co:16 nextWorkspace:co:121 previousWorkspace:co:116 moveToNextWorkspace:cos:121 moveToPreviousWorkspace:cos:116 focusNextDisplay:cos:47 moveWorkspaceToNextDisplay:cos:43 cycleAppWindows:co:42 swapWithRecent:cos:48 rotateSlide:cos:5 flipSlide:cos:46 soloMode:cos:11 toggleGaps:cos:29 cheatSheet:cos:44 snapLeftHalf:coc:123 snapRightHalf:coc:124 snapTopHalf:coc:126 snapBottomHalf:coc:125 snapFirstThird:coc:2 snapCenterThird:coc:3 snapLastThird:coc:5 snapFirstTwoThirds:coc:14 snapLastTwoThirds:coc:17 snapTopLeft:coc:32 snapTopRight:coc:34 snapBottomLeft:coc:38 snapBottomRight:coc:40 snapMaximize:coc:36 snapCenter:coc:8 snapRestore:coc:51 togglePause:co:12';
const DIGITS = [18, 19, 20, 21, 23, 22, 26, 28, 25];
const MODS: Record<string, number> = { co: MOD.control | MOD.option, cos: MOD.control | MOD.option | MOD.shift, coc: MOD.control | MOD.option | MOD.command };

export interface KeyCombo {
  /** Monorail's modifier bits */
  mods: number;
  /** the key, as Electron spells it ("H", "Left", "Space") */
  key: string;
}

export const comboLabel = (c: KeyCombo) =>
  `${c.mods & MOD.control ? '⌃' : ''}${c.mods & MOD.option ? '⌥' : ''}${c.mods & MOD.shift ? '⇧' : ''}${c.mods & MOD.command ? '⌘' : ''}${c.key.length === 1 ? c.key.toUpperCase() : c.key}`;

/** Monorail's shortcuts: from its settings.json when it has them, its defaults otherwise. */
export function monorailShortcuts(s: MonorailSettings): (KeyCombo & { action: string })[] {
  const out: (KeyCombo & { action: string })[] = [];
  const add = (action: string, mods: number, code: number) => {
    const key = KEY_NAMES[code];
    if (key) out.push({ action, mods, key });
  };
  if (s.keymap && Object.keys(s.keymap).length) {
    for (const [action, list] of Object.entries(s.keymap)) for (const k of list ?? []) if (typeof k?.keyCode === 'number') add(action, Number(k.modifiers) || 0, k.keyCode);
    return out;
  }
  for (const item of DEFAULT_KEYS.split(' ')) {
    const [action, m, code] = item.split(':');
    add(action, MODS[m], Number(code));
  }
  DIGITS.forEach((code, i) => {
    add(`workspace${i + 1}`, MODS.co, code);
    add(`moveToWorkspace${i + 1}`, MODS.cos, code);
  });
  return out;
}

/** An Electron accelerator ("CommandOrControl+Shift+Space") as the keys it takes on a Mac. */
export function acceleratorCombo(acc: string): KeyCombo | null {
  const parts = acc.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  let mods = 0;
  for (const p of parts.slice(0, -1)) {
    const l = p.toLowerCase();
    if (['commandorcontrol', 'cmdorctrl', 'command', 'cmd', 'super', 'meta'].includes(l)) mods |= MOD.command;
    else if (['control', 'ctrl'].includes(l)) mods |= MOD.control;
    else if (['alt', 'option', 'altgr'].includes(l)) mods |= MOD.option;
    else if (l === 'shift') mods |= MOD.shift;
    else return null;
  }
  let key = parts[parts.length - 1];
  const alias: Record<string, string> = { enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', space: 'Space', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', plus: '=' };
  key = alias[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);
  return { mods, key };
}

/**
 * Every shortcut in Keeper's settings: any setting whose name ends in
 * "Shortcut", and every key combination in a group named "shortcuts" (the
 * vibes' next and previous keys, for example), at any depth.
 */
export function keeperAccelerators(settings: unknown, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { ...extra };
  const combo = (v: string) => v.includes('+') && /(command|cmd|control|ctrl|alt|option|shift|super|meta)\+/i.test(v);
  const walk = (o: unknown, at: string, depth: number, group: boolean) => {
    if (!o || typeof o !== 'object' || depth > 4) return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const name = at ? `${at}.${k}` : k;
      if (typeof v === 'string' && (/shortcut$/i.test(k) || group) && combo(v)) out[name] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, name, depth + 1, /shortcuts$/i.test(k));
    }
  };
  walk(settings, '', 0, false);
  return out;
}

export interface ShortcutClash {
  /** Keeper's setting, e.g. "island.captureShortcut" */
  keeper: string;
  accelerator: string;
  /** Monorail's action */
  monorail: string;
  label: string;
}

/** Keys both apps want; macOS gives them to whichever app registered first, so one of them silently stops working. */
export function findClashes(keeper: Record<string, string>, monorail: (KeyCombo & { action: string })[]): ShortcutClash[] {
  const out: ShortcutClash[] = [];
  for (const [setting, acc] of Object.entries(keeper)) {
    const c = acceleratorCombo(acc);
    if (!c) continue;
    for (const m of monorail) if (m.mods === c.mods && m.key.toUpperCase() === c.key.toUpperCase()) out.push({ keeper: setting, accelerator: acc, monorail: m.action, label: comboLabel(c) });
  }
  return out;
}

// ---------------------------------------------------------------- the slider bar and the Island

/**
 * Where Monorail's slider bar can appear on a screen, in Electron's screen
 * coordinates (top-left origin), or null when it never shows at the top.
 * Mirrors SliderBar.position: centred, half the screen wide (320–820 points),
 * 52 points tall, 6 points from the edge of the usable area.
 */
export function sliderBand(s: MonorailSettings, workArea: Rect): Rect | null {
  if (s.sliderBar === 'off' || s.sliderBarEdge !== 'top') return null;
  const width = Math.min(Math.max(workArea.width * 0.5, 320), 820);
  return { x: Math.round(workArea.x + (workArea.width - width) / 2), y: workArea.y + 6, width: Math.round(width), height: 52 };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Keeps the Island clear of the slider: an Island hanging below the menu bar
 * moves below the slider bar, and a panel that opens apart from the pill
 * starts below it. A pill in the menu bar stays put. The Island never takes
 * over Monorail's place, and nothing moves when the slider is at the bottom.
 */
export function avoidSlider<P extends { collapsed: Rect; expanded: Rect; reason: string }>(p: P, band: Rect | null): P {
  if (!band) return p;
  let { collapsed, expanded } = p;
  let moved = false;
  // A pill in the menu bar (beside or under the notch) never moves: the slider is below the menu bar.
  if (overlaps(collapsed, band) && collapsed.y >= band.y - 6) {
    const dy = band.y + band.height + 4 - collapsed.y;
    collapsed = { ...collapsed, y: collapsed.y + dy };
    expanded = { ...expanded, y: expanded.y + dy };
    moved = true;
  } else if (overlaps(expanded, band) && expanded.y < band.y + band.height) {
    // Only the open panel reaches the slider: start it below the slider, same height.
    const top = band.y + band.height + 4;
    if (expanded.y >= collapsed.y + collapsed.height - 1) {
      expanded = { ...expanded, y: top };
      moved = true;
    }
  }
  return moved ? { ...p, collapsed, expanded, reason: `${p.reason} It sits below Monorail’s slider bar, which is at the top of this screen.` } : p;
}

// ---------------------------------------------------------------- themes

/** Monorail's themes. */
export const MONORAIL_THEMES = ['vivid', 'ocean', 'sunset', 'forest', 'mono', 'ashforde', 'aurora', 'nord', 'dracula', 'solarized', 'rosePine', 'mint', 'lavender', 'ember', 'glacier', 'sand', 'spring', 'summer', 'autumn', 'winter', 'festive', 'synthwave', 'phosphor', 'paper', 'nebula', 'holographic', 'seasons'] as const;
export type MonorailTheme = (typeof MONORAIL_THEMES)[number];

/** The Monorail theme closest to each Keeper theme. */
const THEME_MATCH: Record<string, MonorailTheme> = {
  playful: 'vivid', minimal: 'mono', blossom: 'spring', steel: 'glacier', terminal: 'phosphor', midnight: 'nebula',
  ocean: 'ocean', forest: 'forest', sunset: 'sunset', paper: 'paper', academia: 'paper', neon: 'synthwave',
  candy: 'lavender', luxe: 'ashforde', zen: 'mint', retro: 'synthwave', contrast: 'mono', coffee: 'sand',
  fjord: 'nord', terracotta: 'ember', sage: 'mint', deepsea: 'ocean', dusk: 'rosePine', dune: 'sand',
  editorial: 'paper', solarpunk: 'spring', circuit: 'phosphor', champagne: 'ashforde', frost: 'winter',
  meadow: 'spring', summer: 'summer', autumn: 'autumn', festive: 'festive', blueprint: 'glacier', aurora: 'aurora',
  glass: 'holographic', inkwash: 'paper', amber: 'ember',
};

/** Monorail's theme for a Keeper theme; when Keeper follows the seasons, Monorail does too. */
export function monorailThemeFor(keeperTheme: string, seasons = false): MonorailTheme {
  if (seasons) return 'seasons';
  return THEME_MATCH[keeperTheme] ?? 'vivid';
}

// ---------------------------------------------------------------- tools (its local API, as MCP tools)

export interface MonorailTool {
  /** Monorail's own name; Keeper offers it as monorail_<name> */
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required: string[];
  method: 'GET' | 'POST';
  path: string;
  readOnly: boolean;
  /** closes windows or otherwise loses something */
  destructive?: boolean;
}

const t = (name: string, description: string, method: 'GET' | 'POST', path: string, properties: Record<string, unknown> = {}, required: string[] = [], destructive = false): MonorailTool =>
  ({ name, description, properties, required, method, path, readOnly: method === 'GET', destructive });

/** The tools `Monorail --mcp` offers, with the local API route each one calls. */
export const MONORAIL_TOOLS: MonorailTool[] = [
  t('get_state', 'The current workspace, profile, slide and focused window.', 'GET', '/state'),
  t('list_windows', 'Every window Monorail manages: id, app, title, workspace and slide.', 'GET', '/windows'),
  t('list_workspaces', 'Workspaces with their names and slides.', 'GET', '/workspaces'),
  t('get_history', 'Recent layout changes that can be undone, newest first.', 'GET', '/history'),
  t('get_insights', "Today's usage: switches, windows opened, focus minutes and goal, time per workspace and app.", 'GET', '/insights'),
  t('focus_window', 'Go to a window (scrolls the strip to show it).', 'POST', '/focus', { id: { type: 'integer', description: 'Window id from list_windows' } }, ['id']),
  t('move_window', 'Move a window to a workspace (1-based).', 'POST', '/move', { id: { type: 'integer' }, workspace: { type: 'integer' } }, ['id', 'workspace']),
  t('pair_windows', 'Put 2–6 windows together in one slide. layout: columns, stack, grid, mainLeft, mainTop, spiral or accordion.', 'POST', '/pair', { ids: { type: 'array', items: { type: 'integer' } }, layout: { type: 'string' } }, ['ids']),
  t('switch_workspace', 'Show a workspace (1-based).', 'POST', '/workspace', { number: { type: 'integer' } }, ['number']),
  t('perform_action', 'Run any Monorail action by name, e.g. focus-left, move-right, cycle-width, overview, regroup, focus-mode, balance, undo.', 'POST', '/action', { action: { type: 'string' } }, ['action']),
  t('apply_layout', 'Apply a saved layout by name.', 'POST', '/layout', { name: { type: 'string' } }, ['name']),
  t('open_app_pair', 'Open a saved app pair by name.', 'POST', '/pair-name', { name: { type: 'string' } }, ['name']),
  t('run_template', 'Start a workspace template by name.', 'POST', '/template', { name: { type: 'string' } }, ['name']),
  t('undo', 'Undo the last layout changes (steps defaults to 1).', 'POST', '/undo', { steps: { type: 'integer' } }),
  t('redo', 'Redo the last undone layout change.', 'POST', '/redo'),
  t('name_slide', 'Name the slide a window is in (empty name clears it).', 'POST', '/name-slide', { id: { type: 'integer' }, name: { type: 'string' } }, ['id', 'name']),
  t('set_slide_layout', "Change the layout of a window's slide (or the focused one): columns, stack, grid, mainLeft, mainTop, spiral, accordion or tabs.", 'POST', '/slide-layout', { id: { type: 'integer' }, layout: { type: 'string' } }, ['layout']),
  t('close_window', 'Close a window by id.', 'POST', '/close', { id: { type: 'integer' } }, ['id'], true),
  t('note_window', 'Attach a short note to a window (empty text clears it).', 'POST', '/note', { id: { type: 'integer' }, text: { type: 'string' } }, ['id', 'text']),
  t('notify', 'Show a short notice on screen.', 'POST', '/notify', { text: { type: 'string' } }, ['text']),
];

export const TOOL_PREFIX = 'monorail_';

/** In words, for the approval prompt: "close window 42 (Monorail)". */
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  const bare = name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name;
  const detail = Object.entries(args).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(', ');
  return `use Monorail: ${bare.replace(/_/g, ' ')}${detail ? ` (${detail})` : ''}`;
}

// ---------------------------------------------------------------- monorail:// links (work without the local API)

export type MonorailLink =
  | { kind: 'settings' | 'palette' | 'welcome' | 'pomodoro' }
  /** from: 'keeper' marks a change Keeper made by following its own mode (newer Monorail versions then leave the timer and the notice to Keeper; older ones ignore it) */
  | { kind: 'focus-mode' | 'presentation-mode'; on: boolean; from?: 'keeper' }
  | { kind: 'workspace'; n: number }
  | { kind: 'layout' | 'snapshot' | 'pair' | 'template' | 'profile' | 'launch' | 'focus-app' | 'notify'; arg: string };

export function monorailUrl(l: MonorailLink): string {
  switch (l.kind) {
    case 'focus-mode':
    case 'presentation-mode':
      return `monorail://${l.kind}/${l.on ? 'on' : 'off'}${l.from ? `?from=${l.from}` : ''}`;
    case 'workspace':
      return `monorail://workspace/${Math.max(1, Math.floor(l.n))}`;
    case 'settings':
    case 'palette':
    case 'welcome':
    case 'pomodoro':
      return `monorail://${l.kind}`;
    default:
      return `monorail://${l.kind}/${encodeURIComponent(l.arg)}`;
  }
}
