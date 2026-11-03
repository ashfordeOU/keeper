// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode: a clean screen for recording, presenting and screenshots. Every
// switch is its own toggle; presets group them. Pure types shared by the app,
// the tests, the command line and the browser demo.

export type StageOs = 'darwin' | 'win32' | 'linux';

export type BackdropKind = 'off' | 'solid' | 'gradient' | 'blur';
export type SpotlightMode = 'off' | 'spotlight' | 'highlight';
export type KeystrokeMode = 'off' | 'shortcuts' | 'all';

/** An app Stage hides or quits while it is on (and brings back afterwards). */
export interface StageAppRule {
  name: string;
  action: 'hide' | 'quit';
  /** open a quit app again when Stage ends */
  reopen?: boolean;
}

export interface StageSwitches {
  // desktop and apps
  hideDesktopIcons: boolean;
  /** the Dock (macOS) or taskbar (Windows) or dock/panel (Linux) hides until you point at it */
  hideDock: boolean;
  hideOtherApps: boolean;
  /** macOS: the whole menu bar hides until you point at it; elsewhere see the support table */
  hideMenuBar: boolean;
  apps: StageAppRule[];
  // notifications and sound
  dnd: boolean;
  muteAlerts: boolean;
  pauseMusic: boolean;
  // look
  backdrop: { kind: BackdropKind; color: string; color2: string };
  /** put an enlarged pointer back to the normal size */
  neutralCursor: boolean;
  spotlight: { mode: SpotlightMode; size: 's' | 'm' | 'l'; dim: number };
  clicks: boolean;
  keystrokes: KeystrokeMode;
  // behaviour
  keepAwake: boolean;
  /** switch the main screen to this size while on ("keep" = leave it) */
  resolution: { mode: 'keep' | 'set'; width: number; height: number };
  /** the clipboard history shows nothing while on */
  cleanClipboard: boolean;
  /** the Island hides the shelf, calendar titles, notifications and clipboard while on */
  hidePrivate: boolean;
  /** Keeper's own windows stay out of screenshots and recordings (macOS, Windows) */
  keepKeeperOut: boolean;
}

export type SwitchId = Exclude<keyof StageSwitches, 'apps'> | 'apps';

export interface StagePreset {
  id: string;
  name: string;
  /** one of the three that come with Keeper (can be edited, not removed) */
  builtIn?: boolean;
  switches: StageSwitches;
  /** a 3-2-1 countdown before it starts, in seconds (0 = none) */
  countdown: number;
  /** end by itself after this many minutes (0 = no limit) */
  limitMin: number;
  /** a global shortcut that starts this preset (empty = none) */
  shortcut: string;
}

export interface StageAutoSettings {
  /** which preset starts when the screen is being captured */
  preset: string;
  /** PipeWire screen-cast streams (Linux; reliable) */
  streams: boolean;
  /** known screen-recorder apps running or in front (heuristic) */
  apps: boolean;
  /** Keeper's own screen recorder */
  keeperRecorder: boolean;
  /** more apps to treat as recorders */
  extraApps: string[];
  /** end Stage when capture stops (only when it started by itself) */
  stopWhenDone: boolean;
}

export interface DisplayKeySettings {
  /** route the shortcuts below to external monitors over DDC/CI */
  enabled: boolean;
  brightnessUp: string;
  brightnessDown: string;
  volumeUp: string;
  volumeDown: string;
  /** also take over the keyboard's volume keys while an external monitor answers */
  mediaVolumeKeys: boolean;
  /** "all" external displays or one display id */
  target: string;
  step: number;
}

export interface StageSettings {
  /** the preset the shortcut, the tray and the Island start */
  preset: string;
  presets: StagePreset[];
  /** starts or stops Stage with the chosen preset */
  shortcut: string;
  /** apps that always stay on screen (recorders and call apps are added automatically) */
  keep: string[];
  auto: StageAutoSettings;
  /** where Stage shows up */
  surfaces: { tray: boolean; island: boolean; shortcut: boolean };
  displayKeys: DisplayKeySettings;
  /** Draw on screen: its shortcut, pen colours and how ink behaves (core/stage/draw.ts) */
  draw: import('./draw').DrawSettings;
}

// ---------------------------------------------------------------- how each switch works on each system

/** built: works; partial: works with limits (see note); guide: Keeper opens the right settings; none: not possible */
export type Support = 'built' | 'partial' | 'guide' | 'none';

export interface SwitchInfo {
  id: SwitchId;
  label: string;
  group: 'Desktop and apps' | 'Notifications and sound' | 'Look' | 'Behaviour';
  desc: string;
  support: Record<StageOs, { how: Support; note?: string }>;
}

// ---------------------------------------------------------------- the journal

/** A setting Keeper reads, changes and puts back. Every kind has a reader and a writer (core/stage/targets.ts). */
export type ValueTarget =
  | { t: 'mac-defaults'; domain: string; key: string; type: 'bool' | 'float' | 'int'; after?: 'Finder' | 'Dock' | 'SystemUIServer' }
  | { t: 'mac-osa'; prop: 'dock-autohide' | 'menubar-autohide' | 'alert-volume' }
  | { t: 'gsettings'; schema: string; key: string }
  | { t: 'gnome-ext'; uuid: string }
  | { t: 'xfconf'; channel: string; prop: string; type: 'int' | 'bool' }
  | { t: 'kde-panel'; qdbus: string }
  | { t: 'win-reg'; path: string; name: string; type: 'DWORD' | 'String'; after?: 'cursors' }
  | { t: 'win-taskbar' }
  | { t: 'win-desktop-icons' };

/** Something Stage changed that is not a plain setting. */
export type ActionTarget =
  | { t: 'apps-hidden'; ids: string[]; how: 'mac' | 'win' | 'x11'; /** macOS: each app's bundle id, in the order of ids ('' when it has none) */ bundles?: string[] }
  | { t: 'apps-quit'; apps: { name: string; path?: string }[] }
  | { t: 'music-paused'; player?: string }
  | { t: 'display-mode'; display: string; prior: { width: number; height: number; refresh?: number; modeId?: string }; how: 'mac' | 'win' | 'xrandr' | 'wlr' }
  | { t: 'awake' }
  | { t: 'focus' };

export interface JournalEntry {
  /** order of application; reverting goes from the highest down */
  seq: number;
  switch: SwitchId;
  label: string;
  target: ValueTarget | ActionTarget;
  /** value before Stage changed it (settings only) */
  prior?: string;
  /** value Stage set (settings only); a different current value means the person changed it, so it is left alone */
  applied?: string;
  /** written before the change is made; "applied" once it worked */
  state: 'pending' | 'applied';
  at: number;
}

export interface StageJournal {
  /** Keeper's process id while it was on (a different, dead pid means Keeper crashed) */
  pid: number;
  startedAt: number;
  preset: string;
  entries: JournalEntry[];
}

/** What reverting one entry did. */
export interface RevertResult {
  label: string;
  outcome: 'restored' | 'left' | 'failed' | 'skipped';
  note?: string;
}

// ---------------------------------------------------------------- live status

export interface StageCapture {
  /** something seems to be capturing the screen right now */
  active: boolean;
  /** what was seen ("PipeWire screen cast: GNOME Shell", "OBS is running") */
  sources: { label: string; reliable: boolean }[];
  /** how detection works here, in one line */
  method: string;
}

export interface StageStatus {
  on: boolean;
  /** making its changes right now */
  starting?: boolean;
  /** counting down before it starts */
  countdownEndsAt?: number;
  preset?: string;
  presetName?: string;
  since?: number;
  endsAt?: number;
  /** "Shortcut", "Island", "Screen capture: OBS is running", "Presentation mode" */
  reason?: string;
  /** started by itself because the screen is being captured */
  auto: boolean;
  /** each change made, in order */
  applied: { switch: SwitchId; label: string; ok: boolean; note?: string }[];
  /** what happened the last time it ended (restored, left alone because you changed it…) */
  lastRevert?: RevertResult[];
  /** set once after Keeper put things back from a crash */
  recovered?: string;
  notices: string[];
  capture?: StageCapture;
  platform: string;
}

export interface StageDisplayMode { width: number; height: number; refresh?: number; hidpi?: boolean; current?: boolean; id?: string }

export interface StageApi {
  status(): Promise<StageStatus>;
  start(preset?: string, opts?: { reason?: string; skipCountdown?: boolean }): Promise<StageStatus>;
  stop(): Promise<StageStatus>;
  toggle(preset?: string): Promise<StageStatus>;
  extend(minutes: number): Promise<StageStatus>;
  settings(): Promise<StageSettings>;
  setSettings(patch: Partial<StageSettings>): Promise<StageSettings>;
  savePreset(p: StagePreset): Promise<StageSettings>;
  removePreset(id: string): Promise<StageSettings>;
  /** how each switch works on this system */
  support(): Promise<SwitchInfo[]>;
  /** what Stage changed and still has to put back */
  journal(): Promise<StageJournal | null>;
  /** what capture detection sees right now */
  detect(): Promise<StageCapture>;
  /** sizes the main screen can switch to */
  modes(): Promise<StageDisplayMode[]>;
  /** running apps, for the hide/quit and stays-on-screen lists */
  apps(): Promise<string[]>;
  /** show one overlay for a few seconds so you can see it ("spotlight", "clicks", "keys", "countdown", "backdrop") */
  preview(what: 'spotlight' | 'clicks' | 'keys' | 'countdown' | 'backdrop'): Promise<boolean>;
  /** input sources an external display offers (DDC/CI VCP 0x60) */
  displayInputs(id: string): Promise<{ current?: number; inputs: { code: number; label: string }[]; note?: string }>;
  setDisplayInput(id: string, code: number): Promise<void>;
  /** what each overlay window draws now (diagnostics and tests) */
  overlays(): Promise<{ display: number; state: unknown }[]>;
  /** the tray menu's Stage items, as text */
  tray(): Promise<string[]>;
  /** Draw on screen: start (true), finish (false) or switch (nothing); returns whether it is on */
  draw(on?: boolean): Promise<boolean>;
  /** what each drawing sheet holds now (diagnostics and tests) */
  drawState(): Promise<{ on: boolean; sheets: { display: number; state: unknown }[] }>;
}
