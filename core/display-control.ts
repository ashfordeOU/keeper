// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// External display controls over DDC/CI: the VCP codes every monitor speaks
// and reading the answers of the per-OS tools.

export type DisplayControl = 'brightness' | 'contrast' | 'volume';

/** MCCS VCP codes. */
export const VCP: Record<DisplayControl, number> = { brightness: 0x10, contrast: 0x12, volume: 0x62 };

export interface DisplayInfo {
  id: string;
  name: string;
  external: boolean;
  /** 0–100 where known; undefined when the display did not answer */
  brightness?: number;
  contrast?: number;
  volume?: number;
}

export const toPercent = (cur: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : undefined);
export const fromPercent = (pct: number, max = 100) => Math.max(0, Math.min(max, Math.round((Math.max(0, Math.min(100, pct)) / 100) * max)));

/** ddcutil getvcp --brief: "VCP 12 C 50 100" → { cur: 50, max: 100 }. */
export function parseDdcutilBrief(out: string): { cur: number; max: number } | null {
  const m = out.match(/VCP\s+[0-9A-Fa-f]+\s+C\s+(\d+)\s+(\d+)/);
  return m ? { cur: +m[1], max: +m[2] } : null;
}

/** ddcutil detect --brief: display numbers and monitor names. */
export function parseDdcutilDetect(out: string): { n: string; name: string }[] {
  return [...out.matchAll(/Display (\d+)[\s\S]*?Monitor:\s*([^\n]+)/g)].map((m) => ({ n: m[1], name: m[2].split(':').slice(1).join(' ').trim() || `Display ${m[1]}` }));
}

/** The m1ddc name of a control. */
export const m1ddcName = (c: DisplayControl) => (c === 'brightness' ? 'luminance' : c);
/** The ddcctl flag of a control. */
export const ddcctlFlag = (c: DisplayControl) => (c === 'brightness' ? '-b' : c === 'contrast' ? '-c' : '-v');
