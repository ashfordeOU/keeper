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

// ---------------------------------------------------------------- input sources (VCP 0x60)

/** The MCCS input-source code (VCP 0x60). */
export const VCP_INPUT = 0x60;

/** Names of the standard MCCS input-source values. Monitors may use others (shown as "Input 0x.."). */
export const INPUT_NAMES: Record<number, string> = {
  0x01: 'VGA 1', 0x02: 'VGA 2', 0x03: 'DVI 1', 0x04: 'DVI 2', 0x05: 'Composite 1', 0x06: 'Composite 2', 0x07: 'S-Video 1', 0x08: 'S-Video 2',
  0x09: 'Tuner 1', 0x0a: 'Tuner 2', 0x0b: 'Tuner 3', 0x0c: 'Component 1', 0x0d: 'Component 2', 0x0e: 'Component 3',
  0x0f: 'DisplayPort 1', 0x10: 'DisplayPort 2', 0x11: 'HDMI 1', 0x12: 'HDMI 2', 0x1b: 'USB-C', 0x19: 'Thunderbolt', 0x1a: 'Thunderbolt 2',
};

/** The inputs offered when a monitor does not list its own (the common ones). */
export const COMMON_INPUTS = [0x0f, 0x10, 0x11, 0x12, 0x1b, 0x03, 0x01];

export const inputLabel = (code: number) => INPUT_NAMES[code] ?? `Input 0x${code.toString(16).padStart(2, '0')}`;

/** Input codes from an MCCS capabilities string: "…vcp(10 12 60(0F 11 12) 62)…". */
export function inputsFromCapabilities(caps: string): number[] {
  const vcp = caps.match(/vcp\((.*)\)/i)?.[1] ?? caps;
  const m = vcp.match(/(?:^|[\s(])60\s*\(([^)]*)\)/i);
  if (!m) return [];
  return [...new Set(m[1].trim().split(/\s+/).filter((x) => /^[0-9a-f]{1,2}$/i.test(x)).map((x) => parseInt(x, 16)))];
}

/** `ddcutil capabilities`: "Feature: 60 (Input Source)\n Values:\n 0f: DisplayPort-1\n 11: HDMI-1". */
export function inputsFromDdcutilCapabilities(out: string): number[] {
  const block = out.match(/Feature:\s*60\b[^\n]*\n([\s\S]*?)(?:\n\s*Feature:|$)/i)?.[1] ?? '';
  return [...new Set([...block.matchAll(/^\s+([0-9a-f]{2}):/gim)].map((m) => parseInt(m[1], 16)))];
}

/** `ddcutil getvcp 60 --brief`: "VCP 60 SNC x0f" → 15. */
export function parseDdcutilInput(out: string): number | undefined {
  const m = out.match(/VCP\s+60\s+\S+\s+x?([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) & 0xff : undefined;
}

/** Steps a level by a delta, kept within 0–100. */
export const stepLevel = (cur: number | undefined, delta: number) => Math.max(0, Math.min(100, Math.round((cur ?? 50) + delta)));
