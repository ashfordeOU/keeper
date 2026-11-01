// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote screens between Keeper devices: what a session is, what the viewer
// sends (input), and how the picture is tuned. Shared by the app, its tests and
// the phone page.

export type Quality = 'auto' | 'speed' | 'balanced' | 'sharp';

export interface QualityPreset {
  /** bits per second the encoder aims for */
  bitrate: number;
  /** frames per second */
  fps: number;
  /** 1 = full size, 0.5 = half each way */
  scale: number;
}

export const QUALITY: Record<Exclude<Quality, 'auto'>, QualityPreset> = {
  speed: { bitrate: 1_200_000, fps: 30, scale: 0.6 },
  balanced: { bitrate: 4_000_000, fps: 30, scale: 1 },
  sharp: { bitrate: 10_000_000, fps: 24, scale: 1 },
};

/** One screen of the host, in its own pixels and in points (what the OS calls the logical size). */
export interface HostDisplay {
  id: string;
  label: string;
  /** position and size in points, as the OS lays out displays (may be negative) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** device pixels per point */
  scale: number;
  primary: boolean;
}

/** How the picture travels: peer to peer (WebRTC) or as still frames inside the Link channel. */
export type ScreenPath = 'p2p' | 'frames';

export type SessionState = 'asking' | 'connecting' | 'live' | 'ended' | 'refused';

export interface ScreenSession {
  id: string;
  /** the other side: a paired device id, or 'phone:<companion id>' */
  peer: string;
  peerName: string;
  /** this device shows its screen (host) or watches another (viewer) */
  role: 'host' | 'viewer';
  control: boolean;
  state: SessionState;
  path?: ScreenPath;
  display?: string;
  started: number;
  /** set when it ended, with why */
  ended?: { at: number; reason: string };
  /** a one-time help session with someone who is not paired */
  help?: boolean;
  /** joined someone else's session, view-only */
  joined?: boolean;
}

/** Viewer → host. Positions are 0..1 across the shared display so window size and DPI never matter. */
export type InputEvent =
  | { t: 'move'; x: number; y: number }
  | { t: 'down' | 'up'; x: number; y: number; button: 0 | 1 | 2 }
  | { t: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { t: 'key'; code: string; key?: string; down: boolean; mods?: Mods }
  | { t: 'text'; text: string }
  | { t: 'combo'; combo: SpecialCombo };

export interface Mods {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/** Key combinations a viewer cannot type because its own computer would catch them. */
export type SpecialCombo = 'ctrl-alt-del' | 'alt-tab' | 'cmd-tab' | 'win' | 'cmd-space' | 'lock' | 'print' | 'task-manager' | 'show-desktop';

export const SPECIAL_COMBOS: { id: SpecialCombo; label: string; os?: string[] }[] = [
  { id: 'ctrl-alt-del', label: 'Ctrl+Alt+Del', os: ['win32', 'linux'] },
  { id: 'task-manager', label: 'Task Manager / Force Quit' },
  { id: 'alt-tab', label: 'Switch apps (Alt+Tab)', os: ['win32', 'linux'] },
  { id: 'cmd-tab', label: 'Switch apps (⌘Tab)', os: ['darwin'] },
  { id: 'win', label: 'Start menu / Activities', os: ['win32', 'linux'] },
  { id: 'cmd-space', label: 'Spotlight (⌘Space)', os: ['darwin'] },
  { id: 'show-desktop', label: 'Show desktop' },
  { id: 'lock', label: 'Lock the screen' },
  { id: 'print', label: 'Screenshot' },
];

/** Messages on the session's control stream (both ways). */
export type ControlMessage =
  /** viewer → host, first message: what it asks for */
  | { t: 'start'; sid: string; control: boolean; quality: Quality; name: string; prefer?: 'auto' | 'frames'; join?: { sid: string; token: string }; help?: boolean }
  | { t: 'hello'; displays: HostDisplay[]; display: string; os: string; control: boolean; controlNote?: string; extras?: HostExtras }
  | { t: 'input'; events: InputEvent[] }
  | { t: 'ack'; seq: number }
  | { t: 'clipget' }
  | { t: 'display'; id: string }
  | { t: 'quality'; q: Quality }
  | { t: 'sdp'; type: 'offer' | 'answer'; sdp: string; fingerprint: string }
  | { t: 'ice'; candidate: string; mid?: string | null; index?: number | null }
  | { t: 'path'; path: ScreenPath }
  | { t: 'chat'; text: string; at: number }
  | { t: 'clip'; text: string }
  | { t: 'control'; on: boolean }
  | { t: 'stats'; fps: number; kbps: number; rtt?: number }
  /** host → viewer: the person here gave or took back control (help sessions, and any session) */
  | { t: 'grant'; control: boolean }
  /** viewer → host: one display, all displays, or the one with the pointer */
  | { t: 'mode'; mode: 'one' | 'all' | 'follow' }
  /** viewer → host: send only this window ('' = the whole screen again) */
  | { t: 'window'; id: string }
  /** viewer → host: picture settings */
  | { t: 'tune'; codec?: 'auto' | 'h264' | 'vp9' | 'av1'; lossless?: boolean; hardware?: boolean; audio?: boolean }
  /** viewer → host: darken the host screen / block the host's own keyboard and mouse while in control */
  | { t: 'privacy'; blank?: boolean; block?: boolean }
  /** viewer → host: a stroke to draw on the host screen; clear removes them all */
  | { t: 'draw'; stroke?: unknown; clear?: boolean }
  /** host → viewer: where the host's pointer is (0..1), for the cursor overlay */
  | { t: 'cursor'; x: number; y: number }
  /** voice chat: either side offers it, both must turn it on */
  | { t: 'voice'; on: boolean }
  /** viewer → host: let this device (or whoever has the token) watch too, view-only */
  | { t: 'invite'; device: string }
  /** host → viewer: the invite to pass on */
  | { t: 'invited'; device: string; token: string }
  /** viewer → host: swap roles (the host then views the viewer) */
  | { t: 'switch' }
  /** viewer → host: restart the computer; the viewer reconnects when it is back */
  | { t: 'reboot' }
  /** host → viewer: a file from the viewer was printed, or not */
  | { t: 'printed'; name: string; ok: boolean; error?: string }
  | { t: 'bye'; reason: string };

/** What the host can do in this session, for the viewer's menus. */
export interface HostExtras {
  audio: boolean;
  audioNote?: string;
  blank: boolean;
  blankNote?: string;
  block: boolean;
  blockNote?: string;
  windows: { id: string; name: string }[];
  /** unattended service installed: reboot-and-reconnect comes back before login */
  unattended: boolean;
  /** this is a help session (no files, no terminal) */
  help?: boolean;
  /** other viewers watching the same screen */
  viewers?: number;
}
