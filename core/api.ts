// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The contract between the interface and the main process. The preload script
// exposes exactly this object as `window.keeper`; the demo build fakes it.

import type { PimApi } from './api-pim';
import type { AgentSession, CalendarEvent, ClipItem, FocusState, LyricLine } from './island';
import type { CaptureEntry, CaptureOptions, PickedColor } from './capture';
import type { RenamePreview, RenameStep } from './rename';
import type { Place, Weather } from './weather';
import type { ConvertCapabilities, ConvertJob, ConvertResult } from './convert-types';
import type { AwakeTrigger } from './awake';
import type { KeeperApiX } from './api-x';
import type { PlacesApi } from './api-places';
import type { UsageApi } from './api-usage';
import type { FeaturesApi } from './api-features';
import type { AshfordeApi } from './api-ashforde';
import type { RemoteApi } from './api-remote';
import type { PlatformApi } from './api-platform';
import type { MemoryStats } from './memory';
import type { LockApi } from './api-lock';
import type { LinkApi } from './api-link';
import type { AccessApi } from './api-access';
import type { MeshApi } from './mesh/types';
import type { ScreenApi } from './api-screen';
import type { BrainApi, BrainDelta, BrainStep } from './api-brain';
import type { AbilitiesApi } from './api-abilities';
import type { AgentsApi, ApprovalRequest, AuditItem } from './api-agents';
import type { ProcsApi } from './api-procs';
import type { IslandToolsApi } from './api-island-tools';
import type { NetApi } from './api-net';
import type { FwApi } from './api-fw';
import type { SyncApi } from './api-sync';
import type { NoteSyncApi } from './api-notesync';
import type { TerminalApi } from './api-terminal';
import type { AgentTermApi } from './api-agentterm';
import type { GuideApi } from './api-guide';
import type { ControlsApi } from './api-controls';
import type { PreviewApi } from './previewTypes';
import type { WidgetConfig } from './widgets';
import type {
  AiMessage, AiProvider, AiReply, AppInfo, CleanResult, CleanupEntry, CleanupGroup, DiskInfo, DuplicateGroup, FileEntry, FileKind,
  JournalEntry, ParsedQuery, Progress, ProtectionReport, Rule, RulePlanItem, SearchHit, Settings, SpaceNode, StartupItem,
} from './types';

export interface SystemInfo {
  platform: 'win32' | 'darwin' | 'linux';
  arch: string;
  osVersion: string;
  appVersion: string;
  home: string;
  sep: string;
}

export interface LibraryStatus {
  indexing: boolean;
  files: number;
  lastScan: number;
  ocrPending: number;
  /** while reading the folders: files found so far, and about how many there were last time (0: first time) */
  found?: number;
  expected?: number;
  /** filling in details after reading (text, pictures, download sources, meaning) */
  background?: BackgroundWork;
}

export interface BackgroundWork {
  /** items left */
  pending: number;
  state: 'working' | 'waiting' | 'idle';
  /** why it waits ("Paused on battery: continues when plugged in") */
  reason?: string;
  /** "Speed up now" is on until then (0: not) */
  boostedUntil?: number;
}

export interface BrowseEntry {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  kind: FileKind | 'folder';
  ext: string;
  hidden: boolean;
  /** a placeholder whose contents live only in the cloud (iCloud, OneDrive, Dropbox… on demand) */
  cloudOnly?: boolean;
}

export interface NowPlaying {
  app: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  playing: boolean;
  position: number;
  duration: number;
  canShuffle?: boolean;
  shuffle?: boolean;
  repeat?: boolean;
}

export interface IslandAlert {
  id: string;
  kind: 'download' | 'screenshot' | 'focus' | 'agent' | 'battery' | 'info' | 'notification' | 'cue' | 'call' | 'disk' | 'reminder' | 'update';
  /** a cue's id (Done/Snooze in the banner), or what a hint is about */
  ref?: string;
  title: string;
  /** the app a mirrored notification came from */
  app?: string;
  detail?: string;
  path?: string;
  at: number;
}

export interface KeepAwakeOptions {
  /** stay awake for this many minutes */
  minutes?: number;
  /** stay awake until this time (epoch ms) */
  until?: number;
  /** while an app with this name is running */
  whileApp?: string;
  /** while this file is still growing (a download in progress) */
  whileFile?: string;
  /** only while on mains power */
  onlyOnPower?: boolean;
  /** let the screen turn off but keep the computer running */
  allowDisplaySleep?: boolean;
  /** end the session when battery drops below this percent */
  stopBelowBattery?: number;
}

export interface KeepAwakeState {
  on: boolean;
  since?: number;
  until?: number;
  reason?: string;
  options?: KeepAwakeOptions;
}

export interface HealthReport {
  cpuPercent: number;
  cores: number;
  cpuModel: string;
  /**
   * free is total − used, where used is what the system's own monitor calls used
   * (macOS: App Memory + Wired + Compressed, not total − free pages). The rest when known.
   */
  memory: Pick<MemoryStats, 'total' | 'pressure' | 'cached' | 'compressed' | 'swapUsed'> & { free: number };
  uptimeSec: number;
  loadAvg: number[];
  battery?: { percent: number; charging: boolean; health?: number; cycles?: number };
  processes: { pid: number; name: string; cpu: number; memory: number }[];
  /** apps or services currently preventing sleep */
  awakeBlockers: string[];
  /** local servers listening on a port (dev servers, databases) */
  listening: { port: number; pid: number; name: string }[];
}

export interface CaptureResult {
  text: string;
  /** decoded QR code / barcode, when the area contained one */
  code?: string;
  /** barcode format of `code`: QR_CODE, EAN_13, CODE_128, … */
  codeFormat?: string;
  image?: string;
}

export interface RecordState {
  recording: boolean;
  since?: number;
  mode?: 'full' | 'window' | 'area';
  path?: string;
  error?: string;
}

export interface ShelfView {
  id: string;
  name: string;
  color: string;
  pinned?: boolean;
  items: FileEntry[];
}

export interface DevicesState {
  /** 0–100 */
  volume?: number;
  muted?: boolean;
  /** displays whose brightness Keeper can change */
  monitors: { id: string; name: string; brightness?: number; external: boolean }[];
  /** wireless devices that report their charge */
  bluetooth: { name: string; percent: number }[];
  /** the helper used for external monitors, or why it is missing */
  ddc?: string;
}

export type ShelfAction = 'zip' | 'copyText' | 'moveTo' | 'copyTo' | 'script' | 'upload' | 'copyPaths' | 'resize';

export interface UploadSettings {
  kind: 'none' | 'webdav' | 's3';
  /** WebDAV folder URL, or the S3 endpoint (https://s3.eu-west-1.amazonaws.com, https://<account>.r2.cloudflarestorage.com, …) */
  url: string;
  username: string;
  bucket: string;
  region: string;
  /** S3 access key id (the secret is kept in the keychain) */
  accessKeyId: string;
  /** folder inside the bucket or server */
  prefix: string;
  /** S3: how long shared links work */
  expiresHours: number;
  /** WebDAV: public base URL for links, if the server publishes uploads somewhere else */
  publicUrl: string;
}

export interface ScriptAction {
  id: string;
  name: string;
  /** a command; {files} {file} {dir} are filled in */
  command: string;
}

export interface IslandState {
  /** items of the active shelf (kept for older views) */
  shelf: FileEntry[];
  shelves: ShelfView[];
  activeShelf: string;
  closedShelves: { id: string; name: string; color: string; count: number }[];
  devices?: DevicesState;
  /** reasons automatic keep-awake is on */
  awakeTriggers?: string[];
  /** Keep Awake is switched on in Settings → Features (its controls show) */
  awakeAvailable?: boolean;
  /** hidden by the user or because an app is full screen */
  hidden?: boolean;
  clips: ClipItem[];
  focus: FocusState;
  keepAwake: KeepAwakeState;
  weather?: Weather;
  battery?: { percent: number; charging: boolean };
  /** remaining ms until the next break reminder, when break reminders are on */
  breakIn?: number;
  /** a screen recording is running */
  recording?: { since: number };
  agents: AgentSession[];
  events: CalendarEvent[];
  nowPlaying?: NowPlaying;
  lyrics?: LyricLine[];
  micInUse?: string[];
  /** apps using a camera (Windows and Linux; macOS shows its own light) */
  camInUse?: string[];
  /** countdown timers from Alarms (running: endsAt; paused: leftMs) */
  countdowns?: { id: string; label: string; endsAt?: number; leftMs?: number; durationMs: number }[];
  /** tasks whose reminder rang and wait for Done or Snooze */
  dueReminders?: { id: string; title: string; at: number }[];
  alerts: IslandAlert[];
  /** Monorail's workspace and slide, when it is installed and switched on (Settings → Ashforde apps) */
  monorail?: import('./ashforde/monorail').MonorailState;
  /** Stage mode while it is on or counting down (core/stage) */
  stage?: import('./stage/private').IslandStage;
  // ---- Island+ (calls, levels, cues, usage beside the pill; see electron/services/island-plus.ts)
  /** a call in progress: which app, since when, muted or not */
  call?: import('./island-calls').CallState;
  /** the last volume or brightness change, shown for a moment */
  hud?: import('./island-hud').HudEvent;
  /** cues for the app or page in front */
  cueHere?: { id: string; title: string; count: number };
  /** the AI allowance closest to its limit, pinned beside the pill when asked */
  usagePin?: { tool: string; label: string; percent: number };
  /** an AI limit running out or used up (the usage tracker), shown as a ring activity */
  usageAlert?: { id: string; title: string; detail: string; left: number; urgency: 'running-out' | 'used-up' };
  /** where other apps' notifications come from here, and why not when they cannot */
  notifyMode?: { mode: string; problem?: string };
}

export interface IslandPlacementPreview {
  platform: string;
  desktop?: string;
  macModel?: string;
  wayland: boolean;
  xwayland: boolean;
  displays: { info: import('./island-place').DisplayInfo; placement: import('./island-place').Placement; primary: boolean; label: string }[];
  wanted: number[];
}

export interface IslandSettings {
  enabled: boolean;
  /** which screen edge the island sits on */
  edge: 'top' | 'left' | 'right';
  /** which screens get an Island: the main one, every one, the one with the pointer, or the laptop's own */
  displays: 'primary' | 'all' | 'mouse' | 'builtin';
  buddy: boolean;
  clipboard: boolean;
  agents: boolean;
  lyrics: boolean;
  calendarUrl: string;
  dictationShortcut: string;
  /** an OpenAI-compatible /audio/transcriptions endpoint (Groq, OpenAI, a local whisper server) */
  dictationUrl: string;
  dictationModel: string;
  soundOnAgent: boolean;
  weather: boolean;
  place: Place | null;
  units: 'metric' | 'imperial';
  /** remind to take a break every N minutes of activity (0 = off) */
  breakEvery: number;
  /** strip tracking parameters (utm_, fbclid, …) from links you copy */
  cleanLinks: boolean;
  /** shortcut for "copy text from an area of the screen" */
  captureShortcut: string;
  /** play an alert when a download finishes / a screenshot is taken */
  downloadAlerts: boolean;
  /** clipboard picker that pastes into the app in front */
  pasteShortcut: string;
  /** open the shelf from anywhere */
  shelfShortcut: string;
  /** open the Island's Tasks with the new-task field ready, from anywhere */
  taskShortcut?: string;
  /** black and white: no colours in the Island (artwork, accents and activities in greys) */
  monochrome?: boolean;
  hideShortcut: string;
  awakeShortcut: string;
  /** open the shelf when a file is dragged to the top edge of the screen */
  edgeDrop: boolean;
  clipMax: number;
  /** forget unpinned, unfiled clips after this many days (0 = keep) */
  clipRetentionDays: number;
  /** never record copies made in these apps (password managers…) */
  clipIgnoreApps: string[];
  /** look up page titles of copied links (sends a request to that site) */
  clipFetchTitles: boolean;
  /** paste as plain text from the picker */
  clipPlainPaste: boolean;
  awakeTriggers: AwakeTrigger[];
  /** keep an external drive from sleeping by touching a hidden file */
  driveKeepAwake: { path: string; seconds: number } | null;
  /** Linux: show other apps' notifications in the Island */
  notifyMirror: boolean;
  /** only these apps (empty = all) */
  notifyApps: string[];
  hideInFullscreen: boolean;
  upload: UploadSettings;
  scriptActions: ScriptAction[];
  /** how big the Island is */
  size?: 'compact' | 'normal' | 'large';
  /** on Macs with a notch, grow out of it in the same black */
  blendNotch?: boolean;
  /** where the camera is ('auto' follows the screen's rotation) */
  cameraEdge?: 'auto' | 'top' | 'left' | 'right' | 'bottom';
  /** move to the side when a tablet is turned and the camera is on a long edge */
  followCamera?: boolean;
  /** draw a small camera dot in the middle of the pill on screens without a notch */
  cameraDot?: boolean;
  /** move the Island by hand, in points */
  offsetX?: number;
  offsetY?: number;
  /** Linux on Wayland: run Keeper through XWayland so the Island can stay on top and in place */
  x11OnWayland?: boolean;
  /** show dots while the camera or microphone is in use */
  privacyDots?: boolean;
  /** activity kinds not to show in the pill */
  activitiesOff?: string[];
  /** open the Island when the pointer rests on it (tap or click always works) */
  hoverOpen?: boolean;
  /** how long the pointer rests before it opens, in ms */
  hoverDelayMs?: number;
  /** the Island's tools in the person's order, and the ones turned off (see core/island-tools/tools.ts) */
  toolOrder?: string[];
  toolsOff?: string[];
  /** a shortcut that opens the Island from anywhere */
  openShortcut?: string;
  /** a sound while focusing: off, white, pink or brown noise, or rain */
  focusSound?: 'off' | 'white' | 'pink' | 'brown' | 'rain';
  focusVolume?: number;
  /** copy files dropped on the shelf into a folder, kept for a number of days */
  shelfKeepCopies?: boolean;
  shelfFolder?: string;
  shelfRetentionDays?: number;
  /** let the Island's player answer the keyboard's media keys */
  mediaKeys?: boolean;
  // ---- Island+ settings (all optional; defaults in core/island-plus.ts)
  /** never mirror notifications from these apps */
  notifyBlock?: string[];
  /** macOS: close the system banner after Keeper shows it */
  notifyDismiss?: boolean;
  /** macOS: hear the brightness keys (needs Input Monitoring) */
  hudBrightnessKeys?: boolean;
  /** how the call's mute button mutes: the system microphone, or the call app's own shortcut */
  callMute?: 'system' | 'app';
  /** the AI usage closest to its limit as a small ring beside the pill */
  usagePin?: boolean;
  /** apps whose music shows no lyrics */
  lyricsOffApps?: string[];
  /** a soft glow in the colour of what is playing */
  glow?: boolean;
  /** corner roundness of the open Island, 0–40 points */
  cornerRadius?: number;
  /** the Island's shadow */
  shadow?: boolean;
  /** warn when the start-up disk has less than this many GB free (0 = never) */
  lowDiskGb?: number;
  /** Alt/Option-click hides the Island for this many minutes */
  altHideMinutes?: number;
  /** focus: a long break after every N rounds, for this many minutes */
  longBreakEvery?: number;
  longBreakMin?: number;
  /** alerts: inside the notch or pill (default), or as a banner dropping below it */
  alertStyle?: 'notch' | 'banner';
  /** also show low-priority alerts (guide findings, general information); otherwise they wait on To do and in the tray */
  alertsInfo?: boolean;
}

export interface KeeperApi extends KeeperApiX {
  /** tabs and windows that survive crashes */
  session: import('./api-session').SessionApi;
  /** Keeper's own processes and services */
  svc: import('./api-session').SvcApi;
  /** the Island's tools: Ask, AI usage, sales, stocks, notes, to-dos, teleprompter, shortcuts */
  islandTools: IslandToolsApi;
  places: PlacesApi;
  /** Places & Tracks: where your things, people and activities have been */
  tracks: import('./tracks/api').TracksApi;
  /** Keeper's own use of the computer */
  usage: UsageApi;
  /** switch parts of Keeper on and off */
  features: FeaturesApi;
  /** anonymous usage stats: the switch, exactly what is sent, and the install ID */
  usageStats: import('./telemetry').UsageStatsApi;
  permissions: import('./permissions').PermissionsApi;
  /** AI usage and subscriptions: limits left per account, warnings, the menu-bar pop-over */
  aiUsage: import('./api-ai-usage').AiUsageApi;
  /** Keeper's sister apps by Ashforde (Monorail on macOS) */
  ashforde: AshfordeApi;
  /** Keep Awake: sessions, triggers, closed-lid mode, statistics */
  awake: import('./api-awake').AwakeApi;
  /** dictation anywhere and meeting recording (core/voice) */
  voice: import('./voice/types').VoiceApi;
  /** Stage mode: a clean screen for recording, presenting and screenshots; external monitor inputs */
  stage: import('./stage/types').StageApi;
  /** Cloud & servers: cloud services, servers, home servers, NAS boxes and other computers */
  remote: RemoteApi;
  platform: PlatformApi;
  /** hands places, forecasts, events, addresses and numbers to the person's own apps (core/native-apps.ts) */
  native: import('./native-apps').NativeAppsApi;
  lock: LockApi;
  /** Keeper Link: paired devices, files between them, ports, the phone companion and the tunnel */
  link: LinkApi;
  /** Keeper Mesh: a WireGuard network between your paired devices */
  mesh: MeshApi;
  /** remote screens: watch and control other Keeper devices, phones on this screen, Wake-on-LAN */
  screen: ScreenApi;
  /** remote access between your own devices: help mode, fleet, remote actions, terminals, audit log, unattended access */
  access: AccessApi;
  /** Remote Desktops: saved connections by RDP, VNC, SSH and more, and letting others reach this computer */
  rdc: import('./rdc/api').RdcApi;
  /** sync between your devices, backups to drives and cloud services, mirrors */
  sync: SyncApi;
  /** Notes Everywhere: notes from every notes app in one hub */
  notesync: NoteSyncApi;
  /** Keeper's brain: passage index, meaning search, the AI harness and the AI apps it serves */
  brain: BrainApi;
  /** abilities any AI can use: the web, pictures, code, memory, schedules, personas, projects, teams */
  abilities: AbilitiesApi;
  /** AI agents: services and costs, permissions and approvals, the gateway, skills, learning, the knowledge graph */
  agents: AgentsApi;
  /** computer use: Keeper's browser for AIs, private desktops, plans, saved sign-ins, workflows */
  cu: import('./api-cu').CuApi;
  /** the process manager and services in Health */
  procs: ProcsApi;
  /** the system monitor: live readings, long-term history, dev servers, agents, sensors, menu-bar readings, the tool launcher */
  sysmon: import('./api-sysmon').SysmonApi;
  /** the owl's glance in the menu bar (tray): cards, quick actions, newest downloads */
  glance: import('./glance').GlanceApi;
  /** Cues: notes, checklists, links and files tied to an app, a site, a page or a time */
  cues: import('./cues/api').CuesApi;
  /** Island+: calls, levels, other apps' notifications, more agents */
  islandx: import('./island-plus').IslandPlusApi;
  /** Mail, calendars, reminders, alarms and contacts */
  pim: PimApi;
  /** Notes: vaults of Markdown files, links, search, canvas, bases, publishing */
  notes: import('./api-notes').NotesApi;
  /** Network Activity (who talks to whom, which way) and VPN connections */
  net: NetApi;
  /** Keeper's firewall: rules, alerts, DNS filter, history */
  fw: FwApi;
  /** the terminal: shells, profiles, sessions that outlive the window, remote files */
  terminal: TerminalApi;
  /** agents' own terminals and the hub where agents of every kind work together */
  agentterm: AgentTermApi;
  /** guided fixes: the To do list, settings deep links and step-by-step help */
  guide: GuideApi;
  /** Quick Controls: system network, firewall, privacy and security switches */
  controls: ControlsApi;
  /** System Settings+: the catalogue of system settings */
  catalog: import('./api-settingsplus').CatalogApi;
  /** per-app controls */
  appctl: import('./api-settingsplus').AppCtlApi;
  /** tabs and site settings in browsers linked through Keeper's extension */
  browserTabs: import('./api-settingsplus').BrowserTabsApi;
  /** universal file previews */
  preview: PreviewApi;
  /** saved workflows and the outside engines the file kit can use */
  filekit: import('./api-filekit').FileKitApi;
  /** video, audio, picture, PDF and file tools; results always go to a new folder */
  convert: {
    run(job: ConvertJob): Promise<ConvertResult>;
    capabilities(): Promise<ConvertCapabilities>;
    /** how long a video or audio file is, in seconds */
    duration(path: string): Promise<number | null>;
    /** how many pages a PDF has */
    pageCount(path: string): Promise<number | null>;
    /** codecs, size, frame rate and details of a video or audio file */
    mediaInfo(path: string): Promise<import('./media-ops').MediaInfo>;
    /** the fields of a PDF form */
    /** iPhone and iPad backups on this computer */
    phoneBackups(): Promise<{ folders: string[]; backups: import('./phone-backups').PhoneBackup[] }>;
    /** external displays and their brightness, contrast and volume (DDC/CI) */
    displays(): Promise<{ displays: import('./display-control').DisplayInfo[]; note?: string }>;
    setDisplay(id: string, control: import('./display-control').DisplayControl, value: number): Promise<void>;
    /** small JPEG data URLs of every page, for the visual organizer */
    pdfThumbs(path: string): Promise<string[]>;
    pdfFields(path: string): Promise<{ name: string; type: string; value: string; options?: string[] }[]>;
    /** saves a web page as a PDF (in Downloads unless a folder is given); returns the file */
    webToPdf(url: string, o: { pageSize: 'a4' | 'letter'; onePage: boolean; outDir?: string }): Promise<string>;
    /** saves a video (or its sound) from a web page into Downloads/Keeper Videos; progress arrives as 'download-video' */
    downloadVideo(o: { url: string; quality: 'best' | '1080' | '720' | 'audio'; playlist?: boolean; cookiesFrom?: 'chrome' | 'firefox' | 'safari' | 'edge' | 'brave'; subtitles?: boolean; folder?: string }): Promise<string[]>;
    cancelDownload(): Promise<void>;
    /** saves a voice recording (base64 of the recorded bytes) under Music/Keeper Recordings; returns the file */
    saveRecording(base64: string, ext: string): Promise<string>;
  };
  system: {
    info(): Promise<SystemInfo>;
    disks(): Promise<DiskInfo[]>;
    health(): Promise<HealthReport>;
    killProcess(pid: number): Promise<boolean>;
    ejectAll(): Promise<{ ejected: string[]; failed: string[] }>;
    wifiNetworks(): Promise<{ ssid: string; password?: string }[]>;
    openExternal(url: string): Promise<void>;
  };
  capture: {
    /** lets the user drag over an area of the screen and returns the text (and any QR code) in it */
    text(): Promise<CaptureResult | null>;
    /** reads text from an image currently on the clipboard */
    clipboardImage(): Promise<CaptureResult | null>;
    /** reads text (and codes) from an image or PDF file */
    readFile(path: string): Promise<CaptureResult>;
    /** saves a screenshot of the whole screen, a chosen window or a dragged area; returns its path */
    screenshot(mode?: 'full' | 'window' | 'area'): Promise<string | null>;
    record(mode?: 'full' | 'window' | 'area', opts?: { mic?: boolean; systemAudio?: boolean; countdown?: number }): Promise<RecordState>;
    stopRecording(): Promise<string | null>;
    recordState(): Promise<RecordState>;
    /** pick a colour from anywhere on screen; it is copied as hex */
    color(): Promise<PickedColor | null>;
    /** the last 20 picked colours, newest first */
    colors(): Promise<string[]>;
    history(): Promise<CaptureEntry[]>;
    removeHistory(id: string): Promise<void>;
    clearHistory(): Promise<void>;
    options(): Promise<CaptureOptions>;
    setOptions(patch: Partial<CaptureOptions>): Promise<CaptureOptions>;
    /** opens a link read from a QR code (http and https only) */
    openLink(url: string): Promise<void>;
  };
  weather: {
    get(force?: boolean): Promise<Weather | null>;
    search(name: string): Promise<Place[]>;
  };
  widgets: {
    list(): Promise<WidgetConfig[]>;
    save(widget: WidgetConfig): Promise<WidgetConfig[]>;
    remove(id: string): Promise<WidgetConfig[]>;
    /** images in a folder, for the photo widget */
    photos(folder: string): Promise<string[]>;
    /** the widget this window shows (inside a widget window) */
    current(): Promise<WidgetConfig | null>;
    /** arrange mode: every widget can be dragged and snaps to edges and neighbours */
    arrange?(on: boolean): Promise<boolean>;
    arranging?(): Promise<boolean>;
    /** the colour "tinted" widgets use (from the wallpaper's palette), or null for the theme's accent */
    tint?(): Promise<string | null>;
  };
  /** live wallpaper, vibes, ambient sound and folder icons */
  ambience: import('./scenes/api').AmbienceApi;
  settings: {
    get(): Promise<Settings & { island: IslandSettings }>;
    set(patch: Partial<Settings & { island: Partial<IslandSettings> }>): Promise<Settings & { island: IslandSettings }>;
    /** AI keys are stored under the connection's id (see core/brain/config.ts) */
    setSecret(name: AiProvider | 'dictation' | 'upload' | (string & {}), value: string): Promise<boolean>;
    hasSecret(name: AiProvider | 'dictation' | 'upload' | (string & {})): Promise<boolean>;
    pickFolder(): Promise<string | null>;
    pickFiles(opts?: { title?: string; extensions?: string[] }): Promise<string[]>;
  };
  library: {
    status(): Promise<LibraryStatus>;
    rescan(): Promise<void>;
    /** Background reading at full speed for half an hour, even on battery ("Speed up now"). */
    speedUp(): Promise<void>;
    totals(): Promise<Record<FileKind, { count: number; size: number }>>;
    recent(n: number, kind?: FileKind | 'screenshot' | 'download'): Promise<FileEntry[]>;
    list(opts: { kind?: FileKind; screenshot?: boolean; root?: string; source?: string; tag?: string; sort?: 'name' | 'date' | 'size' | 'kind'; desc?: boolean; limit?: number }): Promise<FileEntry[]>;
    search(text: string, limit?: number): Promise<{ parsed: ParsedQuery; hits: SearchHit[] }>;
    bySource(): Promise<{ id: string; name: string; count: number; size: number; latest: number }[]>;
    tags(): Promise<{ tag: string; count: number }[]>;
    setTags(path: string, tags: string[]): Promise<void>;
    inspect(path: string): Promise<FileEntry | null>;
    readText(paths: string[]): Promise<{ path: string; text: string }[]>;
    largeFiles(minMb: number): Promise<FileEntry[]>;
  };
  files: {
    browse(dir: string, showHidden?: boolean): Promise<BrowseEntry[]>;
    thumbnail(path: string, size: number): Promise<string | null>;
    icon(path: string): Promise<string | null>;
    open(path: string): Promise<void>;
    openWith(path: string): Promise<void>;
    reveal(path: string): Promise<void>;
    copyPaths(paths: string[]): Promise<void>;
    copyText(text: string): Promise<void>;
    trash(paths: string[], title?: string): Promise<CleanResult>;
    move(paths: string[], dir: string): Promise<CleanResult>;
    copy(paths: string[], dir: string): Promise<CleanResult>;
    rename(path: string, name: string): Promise<string>;
    previewRename(paths: string[], steps: RenameStep[]): Promise<RenamePreview[]>;
    applyRename(paths: string[], steps: RenameStep[]): Promise<CleanResult>;
    newFolder(dir: string, name: string): Promise<string>;
    compress(paths: string[]): Promise<string>;
    startDrag(paths: string[]): void;
    /** a full-size image as a data URL, for the editor (library folders only) */
    readImage(path: string): Promise<string>;
    /** saves a PNG; an existing image's path saves next to it as "name (edited).png". Returns the saved path. */
    writeImage(path: string, dataUrl: string): Promise<string>;
    copyImage(dataUrl: string): Promise<void>;
    /** the real path of a file dropped from the system (desktop app only) */
    pathOf?(file: File): string;
  };
  duplicates: {
    scan(opts?: { similar?: boolean; threshold?: number }): Promise<DuplicateGroup[]>;
  };
  cleanup: {
    scan(): Promise<CleanupGroup[]>;
    clean(groups: { id: string; paths?: string[] }[]): Promise<CleanResult>;
    /** what is inside a group (or a folder within it), for the advanced view */
    details(id: string, dir?: string): Promise<CleanupEntry[]>;
  };
  space: {
    tree(path: string): Promise<SpaceNode>;
  };
  startup: {
    list(): Promise<StartupItem[]>;
    toggle(id: string, enabled: boolean): Promise<StartupItem[]>;
  };
  apps: {
    list(): Promise<AppInfo[]>;
    uninstall(id: string): Promise<CleanResult>;
  };
  protection: {
    check(): Promise<ProtectionReport>;
  };
  /** Privacy & Security: permissions, browsers, connections, posture, malware protection */
  security: import('./api-security').SecurityApi;
  rules: {
    list(): Promise<Rule[]>;
    save(rule: Rule): Promise<Rule[]>;
    remove(id: string): Promise<Rule[]>;
    plan(id: string): Promise<RulePlanItem[]>;
    run(id: string): Promise<CleanResult>;
  };
  history: {
    list(): Promise<JournalEntry[]>;
    undo(id: string): Promise<{ restored: number; failed: string[] }>;
  };
  ai: {
    ask(history: AiMessage[]): Promise<AiReply>;
  };
  island: {
    state(): Promise<IslandState>;
    addToShelf(paths: string[]): Promise<void>;
    removeFromShelf(path: string): Promise<void>;
    clearShelf(): Promise<void>;
    copyClip(id: string): Promise<void>;
    pinClip(id: string): Promise<void>;
    removeClip(id: string): Promise<void>;
    clearClips(): Promise<void>;
    /** start a countdown, a stopwatch, pause, resume, add minutes (extend) or stop; a session can be for a task */
    focus(action: 'start' | 'stopwatch' | 'pause' | 'resume' | 'stop' | 'extend', minutes?: number, task?: { taskId?: string; taskTitle?: string }): Promise<FocusState>;
    keepAwake(on: boolean, options?: KeepAwakeOptions): Promise<KeepAwakeState>;
    presentation(on: boolean): Promise<boolean>;
    media(action: 'toggle' | 'next' | 'previous' | 'seek', value?: number): Promise<void>;
    openAgent(id: string): Promise<void>;
    transcribe(audio: ArrayBuffer, mime: string): Promise<string>;
    typeText(text: string): Promise<void>;
    dismiss(alertId: string): Promise<void>;
    setExpanded(expanded: boolean): void;
    /** the pointer is over the closed pill: take clicks there, let them through elsewhere */
    setInteractive?(on: boolean): void;
    /** the closed pill's size, so the window covers nothing else */
    setSize(width: number, height: number): void;
    createShelf(name?: string): Promise<void>;
    selectShelf(id: string): Promise<void>;
    renameShelf(id: string, name: string): Promise<void>;
    setShelfColor(id: string, color: string): Promise<void>;
    pinShelf(id: string): Promise<void>;
    closeShelf(id: string): Promise<void>;
    reopenShelf(id: string): Promise<void>;
    moveShelfItem(from: number, to: number): Promise<void>;
    renameShelfItem(path: string, name: string): Promise<void>;
    /** runs an action on the active shelf's files (or the given paths) */
    shelfAction(action: ShelfAction, arg?: string, paths?: string[]): Promise<{ message: string; link?: string }>;
    updateClip(id: string, patch: { note?: string }): Promise<void>;
    toggleClipCollection(id: string, name: string): Promise<void>;
    /** puts a clip on the clipboard and pastes it into the app in front */
    pasteClip(id: string, plain?: boolean): Promise<void>;
    exportClips(): Promise<string | null>;
    importClips(): Promise<number>;
    openClips(): Promise<void>;
    closeClips(): void;
    openShelf(): Promise<void>;
    /** opens the Island on one of its tabs ("reminders", "reminders:new" focuses the new-task field) */
    openTab?(tab: string): Promise<void>;
    hide(hidden: boolean): Promise<void>;
    setVolume(value: number): Promise<void>;
    setMuted(muted: boolean): Promise<void>;
    setBrightness(monitorId: string, value: number): Promise<void>;
    refreshDevices(): Promise<DevicesState>;
    /** what the automatic keep-awake rules see right now */
    awakeStatus(): Promise<{ active: string[]; snapshot: Record<string, unknown> }>;
    /** where this Island window sits and what it fits around (notch, bars, camera) */
    layout(): Promise<import('./island-place').Placement | null>;
    /** every screen, what was detected on it, and where the Island goes; for Settings */
    placementPreview(): Promise<IslandPlacementPreview>;
    /** with KEEPER_ISLAND_LOG=1: each requested and actual Island window rectangle (diagnostics, the Mac test) */
    placeLog(): Promise<{ at: number; display: number; why: string; want: { x: number; y: number; width: number; height: number }; got: { x: number; y: number; width: number; height: number } }[]>;
  };
  on(channel: 'progress', cb: (p: Progress) => void): () => void;
  on(channel: 'library-changed' | 'island-changed', cb: () => void): () => void;
  on(channel: 'navigate', cb: (route: string) => void): () => void;
  on(channel: 'dictation', cb: (state: 'start' | 'stop') => void): () => void;
  on(channel: 'palette', cb: () => void): () => void;
  on(channel: 'toggle-inspector' | 'toggle-sidebar', cb: () => void): () => void;
  /** a feature needs a system permission now (the window points to Settings → Permissions) */
  on(channel: 'permission-needed', cb: (p: { id: string; feature?: string }) => void): () => void;
  /** the tool launcher was shown again (focus the search box); the menu-bar pop-over's live reading */
  on(channel: 'launcher-shown', cb: () => void): () => void;
  on(channel: 'sysmon-live', cb: (r: import('./monitor-tray').LiveReading) => void): () => void;
  on(channel: 'glance', cb: (v: import('./glance').GlanceView) => void): () => void;
  on(channel: 'settings-changed', cb: (settings: Settings & { island: IslandSettings }) => void): () => void;
  on(channel: 'widgets-changed', cb: () => void): () => void;
  /** Cues changed (any window), and the cue popup should look again */
  on(channel: 'cues-changed' | 'cue-popup', cb: () => void): () => void;
  on(channel: 'widgets-arrange', cb: (on: boolean) => void): () => void;
  on(channel: 'ambience-changed', cb: () => void): () => void;
  on(channel: 'wallpaper-policy', cb: (p: import('./scenes/policy').RenderPolicy) => void): () => void;
  on(channel: 'wallpaper-frame', cb: () => void): () => void;
  on(channel: 'places-changed', cb: () => void): () => void;
  on(channel: 'tracks-changed', cb: () => void): () => void;
  on(channel: 'features-changed', cb: () => void): () => void;
  on(channel: 'ashforde-changed', cb: () => void): () => void;
  on(channel: 'awake-changed', cb: (s: import('./api-awake').AwakeStatus) => void): () => void;
  on(channel: 'voice-state', cb: (s: import('./voice/types').DictationState, meeting?: import('./voice/types').MeetingLive, offer?: import('./voice/types').MeetingOffer) => void): () => void;
  on(channel: 'voice-meeting', cb: (m: import('./voice/types').MeetingLive | null) => void): () => void;
  on(channel: 'voice-level', cb: (level: number) => void): () => void;
  on(channel: 'voice-download', cb: (d: { size: string; fraction: number } | null) => void): () => void;
  on(channel: 'voice-settings', cb: (s: import('./voice/types').VoiceSettings) => void): () => void;
  on(channel: 'voice-meetings-changed', cb: () => void): () => void;
  on(channel: 'voice-capture', cb: (c: { mic: boolean; deviceId?: string; system: boolean }) => void): () => void;
  on(channel: 'voice-sound', cb: (kind: 'start' | 'stop' | 'cancel') => void): () => void;
  on(channel: 'stage-changed', cb: (s: import('./stage/types').StageStatus) => void): () => void;
  on(channel: 'resilience', cb: (e: { kind: 'reloaded' | 'service-restarted'; reason?: string; name?: string }) => void): () => void;
  on(channel: 'svc-changed', cb: () => void): () => void;
  on(channel: 'remote-changed', cb: () => void): () => void;
  on(channel: 'fw-changed', cb: () => void): () => void;
  on(channel: 'fw-alert', cb: (a: import('./api-fw').FwAlert) => void): () => void;
  on(channel: 'fw-event', cb: (e: import('./api-fw').FwEvent) => void): () => void;
  on(channel: 'controls-changed', cb: () => void): () => void;
  on(channel: 'catalog-changed', cb: () => void): () => void;
  on(channel: 'browsers-changed', cb: () => void): () => void;
  on(channel: 'guide-changed', cb: (s: import('./guide/types').GuideSummary) => void): () => void;
  on(channel: 'notes-changed', cb: (e: { vault: string; paths: string[] }) => void): () => void;
  on(channel: 'guide-mini', cb: (id: string) => void): () => void;
  on(channel: 'pim-changed', cb: (kind: string, extra?: unknown) => void): () => void;
  on(channel: 'pim-ring', cb: (r: import('./api-pim').Ring) => void): () => void;
  on(channel: 'pim-ring-stop', cb: (id: string) => void): () => void;
  on(channel: 'remote-status', cb: (s: import('./remote/types').ConnStatus) => void): () => void;
  on(channel: 'remote-transfer', cb: (t: import('./remote/types').Transfer) => void): () => void;
  on(channel: 'remote-saved', cb: (r: { id: string; path: string; conflict?: boolean; error?: string }) => void): () => void;
  on(channel: 'locks-changed', cb: () => void): () => void;
  on(channel: 'brain-status', cb: (s: import('./brain-contract').BrainStatus) => void): () => void;
  on(channel: 'brain-delta', cb: (d: BrainDelta) => void): () => void;
  on(channel: 'agent-approval', cb: (a: ApprovalRequest) => void): () => void;
  on(channel: 'agent-approval-done', cb: (id: string) => void): () => void;
  on(channel: 'agent-audit', cb: (e: AuditItem) => void): () => void;
  on(channel: 'computer-state', cb: (s: import('./api-agents').ComputerState) => void): () => void;
  on(channel: 'cu-changed', cb: () => void): () => void;
  on(channel: 'computer-stopped', cb: (reason: string) => void): () => void;
  on(channel: 'brain-step', cb: (d: BrainStep) => void): () => void;
  on(channel: 'lock-progress', cb: (p: import('./vault').VaultProgress & { target: string }) => void): () => void;
  on(channel: 'island-open', cb: (tab: string) => void): () => void;
  on(channel: 'term-data', cb: (id: string, data: string, at: number) => void): () => void;
  on(channel: 'term-event', cb: (id: string, ev: import('./terminal/types').ShellEvent) => void): () => void;
  on(channel: 'term-exit', cb: (id: string, code: number, signal?: number) => void): () => void;
  on(channel: 'term-sessions', cb: (s: import('./terminal/types').SessionInfo[]) => void): () => void;
  on(channel: 'term-settings', cb: (s: import('./terminal/types').TerminalSettings) => void): () => void;
  on(channel: 'term-trigger', cb: (id: string, triggerId: string, line: string) => void): () => void;
  on(channel: 'term-notes', cb: (key: string, text: string) => void): () => void;
  on(channel: 'term-open', cb: (q: Record<string, string>) => void): () => void;
  on(channel: 'security-event', cb: (e: import('./security/types').SecurityEvent) => void): () => void;
  on(channel: 'security-scan', cb: (p: import('./security/types').ScanProgress) => void): () => void;
  on(channel: 'agentterm-changed', cb: () => void): () => void;
  on(channel: 'island-layout', cb: (p: import('./island-place').Placement) => void): () => void;
  on(channel: 'link-changed', cb: () => void): () => void;
  on(channel: 'mesh-changed', cb: (exit: { name: string; since: number } | null) => void): () => void;
  on(channel: 'mesh-invite', cb: (i: import('./mesh/types').MeshInvite) => void): () => void;
  on(channel: 'notesync-changed', cb: () => void): () => void;
  on(channel: 'screen-state', cb: (s: import('./api-screen').ScreenState) => void): () => void;
  on(channel: 'screen-ask', cb: (a: { id: string; name: string; control: boolean }) => void): () => void;
  on(channel: 'screen-signal', cb: (sid: string, m: Record<string, unknown>) => void): () => void;
  on(channel: 'screen-frame', cb: (sid: string, f: { header: import('./screen/frames').FrameHeader; jpeg: Uint8Array }) => void): () => void;
  on(channel: 'screen-ended', cb: (sid: string, reason: string) => void): () => void;
  on(channel: 'screen-android-progress', cb: (fraction: number) => void): () => void;
  on(channel: 'link-transfer', cb: (p: import('./api-link').LinkTransfer) => void): () => void;
  on(channel: 'link-pair', cb: (p: import('./api-link').PairPrompt) => void): () => void;
  on(channel: 'link-offer', cb: (o: import('./api-link').FileOffer) => void): () => void;
  on(channel: 'link-companion', cb: (c: { id: string; name: string }) => void): () => void;
  on<K extends keyof import('./rdc/api').RdcEvents>(channel: K, cb: import('./rdc/api').RdcEvents[K]): () => void;
  on(channel: 'navigate-tab', cb: (r: { name: string; arg?: string; q?: string }) => void): () => void;
}
