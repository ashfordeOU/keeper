// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Island+: the window's view of calls, levels, other apps' notifications,
// more coding agents and the small extras (pinned usage, low-disk warning,
// hide for a minute). Types, defaults and small pure helpers.

import type { IslandSettings } from './api';

export interface IslandPlusStatus {
  platform: NodeJS.Platform;
  notify: { mode: string; how: string; problem?: string; fragile: boolean; canDismiss: boolean };
  hud: { on: boolean; how: string; replaces: false; why: string };
  calls: { on: boolean; perApp: boolean; how: string };
  agents: { statusDir: string; hooks: { id: string; name: string; installed: boolean; available: boolean; file: string }[] };
  ocr: { system: boolean; engines: string[] };
}

export interface IslandPlusApi {
  status(): Promise<IslandPlusStatus>;
  /** mute or unmute the call's microphone (the way chosen in Settings) */
  callMute(muted: boolean): Promise<{ muted: boolean; how: string }>;
  /** end the call view (the app keeps the call) */
  callDismiss(): Promise<void>;
  /** hide the Island for a while (Alt/Option-click) */
  hideFor(minutes: number): Promise<void>;
  /** set up or remove an editor's status hooks so its agents show in the Island */
  installAgentHooks(id: string): Promise<{ ok: boolean; message: string }>;
  removeAgentHooks(id: string): Promise<{ ok: boolean; message: string }>;
  /** ask for the macOS permission notifications need (opens System Settings) */
  openNotifyPermission(): Promise<void>;
  /** a test notification through the mirror path (Settings → Island → Notifications) */
  testNotification(): Promise<void>;
  /** start a break now (short or long) */
  startBreak(long: boolean): Promise<void>;
  /** set the focus length from the ruler and start */
  focusFor(minutes: number): Promise<void>;
  /** shuffle and repeat for the player, where the player allows */
  mediaMode(what: 'shuffle' | 'repeat'): Promise<void>;
  /** open the tool launcher (the Island's Tools button) */
  openLauncher(): Promise<void>;
  /** opens a page in Keeper's window (the low-disk banner's Clean Up) */
  showPage(route: string): Promise<void>;
}

export const PLUS_DEFAULTS = {
  notifyBlock: [] as string[],
  notifyDismiss: false,
  hudBrightnessKeys: false,
  callMute: 'system' as 'system' | 'app',
  usagePin: false,
  lyricsOffApps: [] as string[],
  glow: true,
  cornerRadius: 26,
  shadow: true,
  lowDiskGb: 10,
  altHideMinutes: 1,
  longBreakEvery: 4,
  longBreakMin: 15,
};

export function plusSetting<K extends keyof typeof PLUS_DEFAULTS>(s: Partial<IslandSettings> | undefined, k: K): (typeof PLUS_DEFAULTS)[K] {
  const v = (s as Record<string, unknown> | undefined)?.[k];
  return (v === undefined || v === null ? PLUS_DEFAULTS[k] : v) as (typeof PLUS_DEFAULTS)[K];
}

/** Low disk: warn once when free space drops below the threshold, again only after it recovered. */
export function lowDiskAlert(freeBytes: number, thresholdGb: number, warned: boolean): { alert: boolean; warned: boolean } {
  if (!thresholdGb || !Number.isFinite(freeBytes)) return { alert: false, warned: false };
  const low = freeBytes < thresholdGb * 1e9;
  if (low && !warned) return { alert: true, warned: true };
  // Recovered with some margin before the next warning.
  if (!low && freeBytes > thresholdGb * 1.1e9) return { alert: false, warned: false };
  return { alert: false, warned };
}

/** Lyrics for this player? (per-app switch) */
export function lyricsFor(app: string | undefined, off: string[] | undefined): boolean {
  if (!app || !off?.length) return true;
  const a = app.toLowerCase();
  return !off.some((x) => x.trim() && a.includes(x.trim().toLowerCase()));
}

/** The average colour of artwork pixels (RGBA), lifted so it glows on black; null when too dark or grey. */
export function glowColor(px: Uint8ClampedArray | Uint8Array): string | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 16) {
    const a = px[i + 3];
    if (a < 128) continue;
    const max = Math.max(px[i], px[i + 1], px[i + 2]);
    const min = Math.min(px[i], px[i + 1], px[i + 2]);
    // Colourful pixels count more than greys.
    const w = 1 + (max - min) / 32;
    r += px[i] * w; g += px[i + 1] * w; b += px[i + 2] * w; n += w;
  }
  if (!n) return null;
  r /= n; g /= n; b /= n;
  const max = Math.max(r, g, b);
  if (max < 24 || max - Math.min(r, g, b) < 18) return null;
  const k = 220 / max;
  return `rgb(${Math.round(Math.min(255, r * k))}, ${Math.round(Math.min(255, g * k))}, ${Math.round(Math.min(255, b * k))})`;
}
