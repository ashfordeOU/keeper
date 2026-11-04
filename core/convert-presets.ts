// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Convert's presets: one click for the usual jobs, picked for the files you
// dropped. "Email-friendly" makes things small enough to send, "For the web"
// makes them light for a page, and "One archive" packs everything into a ZIP.
// Each preset is just a starting tool and its options, shown before it runs.

import type { ConvertOp } from './convert-types';

export type ConvertPresetId = 'email' | 'web' | 'archive';
export type PresetKind = 'video' | 'audio' | 'image' | 'pdf' | 'other';

export const CONVERT_PRESETS: { id: ConvertPresetId; name: string; line: string; icon: string }[] = [
  { id: 'email', name: 'Email-friendly', line: 'Small enough to send', icon: 'mail' },
  { id: 'web', name: 'For the web', line: 'Light and quick to load', icon: 'globe' },
  { id: 'archive', name: 'One archive', line: 'Everything in one ZIP', icon: 'zip' },
];

/** The kind most of the files are, so a mix of photos and one PDF still gets the photo settings. */
export function mainKind(kinds: PresetKind[]): PresetKind {
  const count = new Map<PresetKind, number>();
  for (const k of kinds) count.set(k, (count.get(k) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
}

/** The tool and options a preset starts with for these files; undefined when it has nothing for them. */
export function presetOp(id: ConvertPresetId, kinds: PresetKind[]): ConvertOp | undefined {
  if (id === 'archive' || kinds.length > 1 && new Set(kinds).size > 2) return id === 'archive' ? { tool: 'file.zip' } : undefined;
  const k = mainKind(kinds);
  if (id === 'email') {
    if (k === 'image') return { tool: 'image.resize', maxSide: 1600 };
    if (k === 'video') return { tool: 'video.compress', targetMb: 20 };
    if (k === 'pdf') return { tool: 'pdf.compress', quality: 70, maxSide: 1600 };
    if (k === 'audio') return { tool: 'audio.convert', format: 'mp3' };
    return { tool: 'file.zip' };
  }
  if (k === 'image') return { tool: 'image.convert', format: 'webp', quality: 80 };
  if (k === 'video') return { tool: 'video.convert', format: 'mp4', width: 1280 };
  if (k === 'pdf') return { tool: 'pdf.compress', quality: 75, maxSide: 2000 };
  if (k === 'audio') return { tool: 'audio.convert', format: 'm4a' };
  return undefined;
}
