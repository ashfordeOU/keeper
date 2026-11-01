// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Other apps by Ashforde® that Keeper can install, keep up to date and work
// with. Each one is off until you switch it on, and only offered on the
// systems it runs on.

import { MONORAIL } from './monorail';

export interface AshfordeAppDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  homepage: string;
  repo: string;
  platforms: NodeJS.Platform[];
  /** shown where the app is not offered yet */
  elsewhere: string;
  /** what working together gives you, for Settings */
  together: string[];
  /** system permissions the app asks for, with why */
  permissions: { topic: string; why: string }[];
}

export const ASHFORDE_APPS: AshfordeAppDef[] = [
  {
    id: MONORAIL.id,
    name: MONORAIL.name,
    tagline: 'Scrolling window manager for macOS',
    description: 'Lays your windows out side by side on an endless strip you slide through, with workspaces, pairs, layouts and a slider bar.',
    homepage: MONORAIL.homepage,
    repo: MONORAIL.repo,
    platforms: [...MONORAIL.platforms],
    elsewhere: 'Monorail runs on macOS for now. Coming when Monorail supports Windows and Linux.',
    together: [
      'Your workspace and slide in the Island and the menu',
      'Monorail actions in Keeper’s command palette',
      'Focus sessions and presentation mode switch Monorail’s along with Keeper’s',
      'Your AI tools can arrange windows through Keeper (with your permission)',
      'Monorail can follow Keeper’s theme',
      'Keeper’s small windows float above the strip; the Island stays clear of the slider bar',
      'Keeper warns when both apps want the same shortcut',
    ],
    permissions: [{ topic: 'accessibility', why: 'Monorail moves and resizes other apps’ windows, which macOS allows only with Accessibility access.' }],
  },
];

export const ashfordeApp = (id: string) => ASHFORDE_APPS.find((a) => a.id === id);

export const offeredOn = (a: AshfordeAppDef, platform: string) => a.platforms.includes(platform as NodeJS.Platform);
