// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every place in Keeper that messages send people to ("Add your key in Settings → AI & Brain"),
// with the page it opens. A message naming one gets an Open button (src/state.tsx toasts);
// test/settings-links.test.ts checks that no message names a place that does not exist.

export interface SettingsLink {
  /** the words in messages after "Settings → " (or the whole path for pages outside Settings) */
  label: string;
  /** the page: "settings:<section id>" or another route */
  route: string;
}

export const SETTINGS_LINKS: SettingsLink[] = [
  // The sections of Settings (core/settings-schema.ts), then older names that still lead there.
  { label: 'Settings → General', route: 'settings:general' },
  { label: 'Settings → Shortcuts', route: 'settings:general#shortcuts' },
  { label: 'Settings → Files & search', route: 'settings:files' },
  { label: 'Settings → The Island', route: 'settings:island' },
  { label: 'Settings → Privacy & permissions', route: 'settings:privacy' },
  { label: 'Settings → Battery and speed', route: 'settings:battery' },
  { label: 'Settings → Devices', route: 'settings:devices' },
  { label: 'Settings → About', route: 'settings:about' },
  // Only in builds with Keeper Pro switched on.
  { label: 'Settings → Account & Pro', route: 'settings:account' },
  { label: 'Settings → Changed', route: 'settings:changed' },
  { label: 'Settings → Appearance', route: 'settings:appearance' },
  { label: 'Settings → Accessibility', route: 'settings:accessibility' },
  { label: 'Settings → Features', route: 'settings:features' },
  { label: 'Settings → Sidebar', route: 'settings:sidebar' },
  { label: 'Settings → Locked folders', route: 'settings:locked' },
  { label: 'Settings → Menu bar', route: 'settings:menubar' },
  { label: 'Settings → Tray', route: 'settings:menubar' },
  { label: 'Settings → Mail & Calendar', route: 'settings:pim' },
  { label: 'Settings → Open with', route: 'settings:open-with' },
  { label: 'Settings → AI & Brain', route: 'settings:brain' },
  { label: 'Settings → AI', route: 'settings:brain' },
  { label: 'Settings → Permissions', route: 'settings:permissions' },
  { label: 'Settings → Works with your computer', route: 'settings:platform' },
  { label: 'Settings → Keeper Mesh', route: 'settings:mesh' },
  { label: 'Settings → Ashforde apps', route: 'settings:ashforde' },
  { label: 'Settings → Privacy', route: 'settings:privacy' },
  { label: 'Settings → Performance', route: 'settings:usage' },
  { label: 'Settings → System monitor', route: 'settings:monitor' },
  { label: 'Settings → Updates', route: 'settings:updates' },
  { label: 'Settings → Island', route: 'island' },
  { label: 'Agents → Abilities', route: 'agents:abilities' },
  { label: 'Agents → Schedules', route: 'agents:schedules' },
  { label: 'Agents → Permissions', route: 'agents:permissions' },
  { label: 'Places & Tracks → Settings', route: 'tracks:settings' },
];

/** The Keeper place a message points to, if it names one ("…in Settings → AI & Brain."). */
export function linkInMessage(text: string): SettingsLink | undefined {
  // Longest first, so "Settings → AI & Brain" wins over "Settings → AI".
  const sorted = [...SETTINGS_LINKS].sort((a, b) => b.label.length - a.label.length);
  for (const l of sorted) {
    const i = text.indexOf(l.label);
    if (i < 0) continue;
    // The system's own settings ("System Settings → Privacy", "Windows Settings → …") are not Keeper's.
    const before = text.slice(Math.max(0, i - 8), i);
    if (/(System |Windows |macOS |desktop’s |desktop's )$/.test(before)) continue;
    const after = text[i + l.label.length];
    if (after && /[A-Za-z]/.test(after)) continue;
    return l;
  }
  return undefined;
}
