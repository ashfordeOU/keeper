// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Downloadable parts of Keeper (core/components.ts) and add-on apps, for the
// interface: Settings → Features, a feature's own page, first-use prompts and
// the welcome tour (window.keeper.components; event "components-changed").

import type { AddonRow, ComponentId, ComponentInfo } from './components';

export interface AddonInfo extends AddonRow {
  name: string;
  description: string;
  /** bytes: the installed app's size, or the latest release's download */
  size?: number;
  homepage?: string;
}

export interface ComponentsApi {
  /** every part, with its state, size and what needs it */
  list(): Promise<ComponentInfo[]>;
  /** the same, with exact sizes from this version's manifest (asks the network once; estimates offline) */
  sizes(): Promise<ComponentInfo[]>;
  download(id: ComponentId): Promise<ComponentInfo[]>;
  cancel(id: ComponentId): Promise<ComponentInfo[]>;
  /** "Free up space": removes the downloaded copy */
  remove(id: ComponentId): Promise<ComponentInfo[]>;
  removeAll(): Promise<ComponentInfo[]>;
  /** "Download everything for offline use" */
  downloadAll(): Promise<ComponentInfo[]>;
  /**
   * Downloads what these features need (the welcome tour's preset, a first use).
   * Resolves when everything is in. `partly: false` skips parts a feature needs only for one tool.
   */
  ensureFor(featureIds: string[], o?: { partly?: boolean }): Promise<ComponentInfo[]>;
  /** the person switched this feature on themselves: fetch what it needs, and install its add-on app */
  switchedOn(featureId: string): Promise<ComponentInfo[]>;
  /** runs the part once (ffmpeg -version, rclone version) */
  check(id: ComponentId): Promise<{ ok: boolean; output: string; path?: string; source?: string }>;
  /** add-on apps (Monorail on macOS), next to the components */
  addons(): Promise<AddonInfo[]>;
  addonAction(id: string, action: 'install' | 'update' | 'open' | 'uninstall'): Promise<AddonInfo[]>;
}
