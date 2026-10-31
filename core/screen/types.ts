// SPDX-License-Identifier: AGPL-3.0-or-later
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
  | { t: 'start'; sid: string; control: boolean; quality: Quality; name: string; prefer?: 'auto' | 'frames' }
  | { t: 'hello'; displays: HostDisplay[]; display: string; os: string; control: boolean; controlNote?: string }
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
  | { t: 'bye'; reason: string };
