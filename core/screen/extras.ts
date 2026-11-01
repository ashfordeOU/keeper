// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The extra powers of a remote screen session, as pure rules: which display
// (one, all, or the one with the pointer), a single window, codec order and
// encoder hints, a lossless mode for text, system sound per OS, blanking the
// host screen and blocking its local input, drawing on the host screen,
// inviting a second viewer, and which shortcuts go through.

import type { HostDisplay } from './types';

// ---------------------------------------------------------------- displays

export type DisplayMode = 'one' | 'all' | 'follow';

/** The display under a point (in OS points), or the nearest one. */
export function displayAt(displays: HostDisplay[], x: number, y: number): HostDisplay | undefined {
  const inside = displays.find((d) => x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height);
  if (inside) return inside;
  let best: HostDisplay | undefined;
  let bestD = Infinity;
  for (const d of displays) {
    const dx = Math.max(d.x - x, 0, x - (d.x + d.width));
    const dy = Math.max(d.y - y, 0, y - (d.y + d.height));
    const dist = dx * dx + dy * dy;
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

/** "Follow the pointer": switch only when the pointer has been on another display for a moment (no flicker at edges). */
export function followDecision(current: string | undefined, under: string | undefined, since: number, now: number, holdMs = 400): { switchTo?: string; since: number } {
  if (!under || under === current) return { since: now };
  if (now - since >= holdMs) return { switchTo: under, since: now };
  return { since };
}

/** The box around all displays (for "all displays"). */
export function allBounds(displays: HostDisplay[]): { x: number; y: number; width: number; height: number } {
  if (!displays.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...displays.map((d) => d.x));
  const y = Math.min(...displays.map((d) => d.y));
  const r = Math.max(...displays.map((d) => d.x + d.width));
  const b = Math.max(...displays.map((d) => d.y + d.height));
  return { x, y, width: r - x, height: b - y };
}

/**
 * A 0..1 position over the "all displays" picture → the display it lands on
 * and the 0..1 position inside it (what the injector expects). Null in a gap
 * between displays.
 */
export function mapFromAll(displays: HostDisplay[], fx: number, fy: number): { display: HostDisplay; x: number; y: number } | null {
  const box = allBounds(displays);
  const px = box.x + fx * box.width;
  const py = box.y + fy * box.height;
  const d = displays.find((x) => px >= x.x && px < x.x + x.width && py >= x.y && py < x.y + x.height);
  if (!d) return null;
  return { display: d, x: (px - d.x) / d.width, y: (py - d.y) / d.height };
}

/** Where each display's picture goes when all are drawn on one canvas, in canvas pixels. */
export function allLayout(displays: HostDisplay[], canvasWidth: number): { id: string; x: number; y: number; w: number; h: number }[] {
  const box = allBounds(displays);
  const k = canvasWidth / box.width;
  return displays.map((d) => ({ id: d.id, x: Math.round((d.x - box.x) * k), y: Math.round((d.y - box.y) * k), w: Math.round(d.width * k), h: Math.round(d.height * k) }));
}

// ---------------------------------------------------------------- picture

export type CodecPref = 'auto' | 'h264' | 'vp9' | 'av1';

/** Puts the preferred codec first (for RTCRtpTransceiver.setCodecPreferences); keeps everything else. */
export function orderCodecs<T extends { mimeType: string }>(codecs: T[], pref: CodecPref): T[] {
  if (pref === 'auto') return codecs;
  const want = `video/${pref === 'h264' ? 'H264' : pref.toUpperCase()}`.toLowerCase();
  return [...codecs.filter((c) => c.mimeType.toLowerCase() === want), ...codecs.filter((c) => c.mimeType.toLowerCase() !== want)];
}

export interface EncodingPlan {
  /** MediaStreamTrack.contentHint */
  contentHint: 'detail' | 'text' | 'motion';
  degradationPreference: 'maintain-resolution' | 'maintain-framerate' | 'balanced';
  /** RTCRtpEncodingParameters */
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
  /** ask for the hardware encoder (Chromium picks it when it can) */
  hardware: boolean;
}

/**
 * Lossless text: full resolution always, a high bitrate cap and low frame
 * rate, so letters stay sharp (it is "visually lossless", not bit-exact).
 */
export function encodingPlan(o: { lossless: boolean; bitrate: number; fps: number; scale: number; hardware: boolean }): EncodingPlan {
  if (o.lossless) return { contentHint: 'text', degradationPreference: 'maintain-resolution', maxBitrate: Math.max(o.bitrate, 20_000_000), maxFramerate: Math.min(o.fps, 15), scaleResolutionDownBy: 1, hardware: o.hardware };
  return { contentHint: 'detail', degradationPreference: 'balanced', maxBitrate: o.bitrate, maxFramerate: o.fps, scaleResolutionDownBy: Math.max(1, 1 / Math.max(0.1, o.scale)), hardware: o.hardware };
}

/** Chromium switches that let it use the graphics card's encoder (set before the app is ready). */
export function hardwareEncodeSwitches(platform: string): string[] {
  if (platform === 'linux') return ['VaapiVideoEncoder', 'VaapiVideoDecoder'];
  if (platform === 'win32') return ['MediaFoundationH264Encoding'];
  return [];
}

// ---------------------------------------------------------------- sound

export interface AudioPlan {
  how: 'loopback' | 'pipewire-monitor' | 'screencapturekit' | 'none';
  note: string;
}

/** How the host can send its sound. `macMajor` is the macOS version (13 = Ventura). */
export function audioPlan(platform: string, macMajor = 0): AudioPlan {
  if (platform === 'win32') return { how: 'loopback', note: 'System sound is sent with the picture.' };
  if (platform === 'linux') return { how: 'pipewire-monitor', note: 'The sound card’s monitor (PipeWire or PulseAudio) is sent with the picture.' };
  if (platform === 'darwin' && macMajor >= 13) return { how: 'screencapturekit', note: 'System sound is sent through macOS screen capture (needs Screen Recording).' };
  return { how: 'none', note: 'This Mac cannot share its sound (macOS 13 or later is needed).' };
}

/** On Linux the monitor of the default output appears as an audio input whose label starts with "Monitor of". */
export function pickMonitorDevice(devs: { kind: string; deviceId: string; label: string }[]): string | null {
  const m = devs.find((d) => d.kind === 'audioinput' && /^monitor of /i.test(d.label)) ?? devs.find((d) => d.kind === 'audioinput' && /monitor/i.test(d.label));
  return m?.deviceId ?? null;
}

// ---------------------------------------------------------------- privacy on the host

export interface PrivacyPlan {
  /** the host screen can go dark for people in the room while the picture still goes to the viewer */
  blank: boolean;
  blankNote?: string;
  /** the host's own keyboard and mouse can be blocked during control */
  block: boolean;
  blockNote?: string;
}

export function privacyPlan(platform: string): PrivacyPlan {
  if (platform === 'win32') return { blank: true, block: true };
  if (platform === 'darwin') return { blank: true, block: false, blockNote: 'macOS does not let apps block the keyboard and mouse.' };
  return { blank: false, blankNote: 'Linux has no way to hide a window from screen capture, so the screen cannot be blanked.', block: false, blockNote: 'Blocking local input needs administrator rights on Linux.' };
}

// ---------------------------------------------------------------- drawing on the host screen

export interface Stroke {
  id: string;
  /** 0..1 points across the shared display */
  points: [number, number][];
  color: string;
  width: number;
}

const COLORS = new Set(['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000']);

/** A stroke from the viewer, clamped and limited; null when it is not one. */
export function sanitizeStroke(s: unknown): Stroke | null {
  if (!s || typeof s !== 'object') return null;
  const x = s as Record<string, unknown>;
  if (!Array.isArray(x.points) || !x.points.length) return null;
  const points: [number, number][] = [];
  for (const p of x.points.slice(0, 2000)) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    points.push([Math.max(0, Math.min(1, p[0])), Math.max(0, Math.min(1, p[1]))]);
  }
  if (!points.length) return null;
  return { id: String(x.id ?? '').replace(/[^\w-]/g, '').slice(0, 24) || 's', points, color: COLORS.has(String(x.color)) ? String(x.color) : '#ff3b30', width: Math.max(1, Math.min(24, Number(x.width) || 4)) };
}

// ---------------------------------------------------------------- a second viewer

export interface ViewerInvite {
  token: string;
  /** the device invited, or '' for whoever brings the token */
  device: string;
  expires: number;
}

export function inviteValid(inv: ViewerInvite | undefined, device: string, token: string, now = Date.now()): boolean {
  return !!inv && inv.expires > now && inv.token.length >= 16 && inv.token === token && (!inv.device || inv.device === device);
}

// ---------------------------------------------------------------- shortcuts

export interface Passthrough {
  /** Alt+Tab / ⌘Tab go to the remote computer */
  appSwitch: boolean;
  /** the Windows / Command key goes to the remote computer */
  meta: boolean;
  /** function keys F1–F12 go to the remote computer */
  fkeys: boolean;
}

export const DEFAULT_PASSTHROUGH: Passthrough = { appSwitch: true, meta: true, fkeys: true };

/** Whether a key the viewer pressed goes to the remote computer or stays here. */
export function passes(e: { code: string; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }, p: Passthrough): boolean {
  if ((e.code === 'Tab' && (e.altKey || e.metaKey)) && !p.appSwitch) return false;
  if ((e.code === 'MetaLeft' || e.code === 'MetaRight' || e.code === 'OSLeft' || e.code === 'OSRight') && !p.meta) return false;
  if (/^F([1-9]|1[0-2])$/.test(e.code) && !p.fkeys) return false;
  return true;
}
