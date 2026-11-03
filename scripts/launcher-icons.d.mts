// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Types for launcher-icons.mjs, so the tests can import it.

export const BADGES: { page: string; color: string; glyph: string }[];
export function badgeSvg(iconSvg: string, badge: { color: string; glyph: string }): string;
export function icns(entries: [string, Buffer][]): Buffer;
export function ico(images: [number, Buffer][]): Buffer;
export function makeIcons(badge: { color: string; glyph: string }, iconSvg: string): Promise<{ png: Buffer; ico: Buffer; icns: Buffer }>;
