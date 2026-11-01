// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where each system keeps a setting: links that open the exact page.
//
//   macOS 13+   x-apple.systempreferences: URLs (System Settings). The pane list
//               follows the published Ventura/Sonoma pane identifiers; older
//               com.apple.preference.security?Privacy_* anchors still open the
//               Privacy & Security subpanes.
//   Windows     ms-settings: URIs from Microsoft's "Launch Windows Settings"
//               reference, plus windowsdefender: for Windows Security.
//   Linux       gnome-control-center <panel> and KDE systemsettings <module>;
//               these vary by version, so each has a fallback to the panel's parent.
//
// Every link has a fallback, ending at the settings app itself.

export type Os = 'darwin' | 'win32' | 'linux';
export type Desktop = 'gnome' | 'kde' | 'other';

export interface DeepLink {
  /** what it opens, shared across systems: 'camera', 'storage', … */
  topic: string;
  os: Os;
  /** Linux only: the desktop it is for */
  desktop?: Desktop;
  /** a URL handed to the system (x-apple.systempreferences:, ms-settings:, windowsdefender:) */
  url?: string;
  /** a program to run (Linux settings apps) */
  cmd?: string[];
  /** where the person ends up, for the guide's text */
  label: string;
  /** the topic to try when this one is not there (older system, other desktop) */
  fallback?: string;
  /** how sure we are: in the system maker's documentation, a published pane list, or untested */
  source: 'docs' | 'pane-list' | 'untested';
}

const MAC_SEC = 'x-apple.systempreferences:com.apple.preference.security';
const mac = (topic: string, url: string, label: string, fallback?: string, source: DeepLink['source'] = 'pane-list'): DeepLink => ({ topic, os: 'darwin', url, label, fallback, source });
const win = (topic: string, uri: string, label: string, fallback?: string): DeepLink => ({ topic, os: 'win32', url: uri, label, fallback, source: 'docs' });
const gnome = (topic: string, panel: string, label: string, fallback?: string): DeepLink => ({ topic, os: 'linux', desktop: 'gnome', cmd: ['gnome-control-center', panel], label, fallback, source: 'untested' });
const kde = (topic: string, module: string, label: string, fallback?: string): DeepLink => ({ topic, os: 'linux', desktop: 'kde', cmd: ['systemsettings', module], label, fallback, source: 'untested' });

export const LINKS: DeepLink[] = [
  // ---------------------------------------------------------------- macOS
  mac('settings', 'x-apple.systempreferences:', 'System Settings'),
  mac('privacy', 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension', 'System Settings → Privacy & Security', 'settings'),
  mac('camera', `${MAC_SEC}?Privacy_Camera`, 'Privacy & Security → Camera', 'privacy'),
  mac('microphone', `${MAC_SEC}?Privacy_Microphone`, 'Privacy & Security → Microphone', 'privacy'),
  mac('screen', `${MAC_SEC}?Privacy_ScreenCapture`, 'Privacy & Security → Screen Recording', 'privacy'),
  mac('fullDisk', `${MAC_SEC}?Privacy_AllFiles`, 'Privacy & Security → Full Disk Access', 'privacy'),
  mac('accessibility', `${MAC_SEC}?Privacy_Accessibility`, 'Privacy & Security → Accessibility', 'privacy'),
  mac('location', `${MAC_SEC}?Privacy_LocationServices`, 'Privacy & Security → Location Services', 'privacy'),
  mac('inputMonitoring', `${MAC_SEC}?Privacy_ListenEvent`, 'Privacy & Security → Input Monitoring', 'privacy'),
  mac('automation', `${MAC_SEC}?Privacy_Automation`, 'Privacy & Security → Automation', 'privacy'),
  mac('contacts', `${MAC_SEC}?Privacy_Contacts`, 'Privacy & Security → Contacts', 'privacy'),
  mac('calendars', `${MAC_SEC}?Privacy_Calendars`, 'Privacy & Security → Calendars', 'privacy'),
  mac('photos', `${MAC_SEC}?Privacy_Photos`, 'Privacy & Security → Photos', 'privacy'),
  mac('filesFolders', `${MAC_SEC}?Privacy_FilesAndFolders`, 'Privacy & Security → Files and Folders', 'privacy'),
  mac('encryption', `${MAC_SEC}?FileVault`, 'Privacy & Security → FileVault', 'privacy'),
  mac('security', 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension', 'Privacy & Security → Security', 'settings'),
  // Firewall moved under Network in macOS 13; the anchor is untested, so it falls back to Network.
  mac('firewall', 'x-apple.systempreferences:com.apple.Network-Settings.extension?Firewall', 'Network → Firewall', 'network', 'untested'),
  mac('network', 'x-apple.systempreferences:com.apple.Network-Settings.extension', 'System Settings → Network', 'settings', 'untested'),
  mac('loginItems', 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension', 'General → Login Items', 'settings'),
  mac('updates', 'x-apple.systempreferences:com.apple.Software-Update-Settings.extension', 'General → Software Update', 'settings'),
  mac('storage', 'x-apple.systempreferences:com.apple.settings.Storage', 'General → Storage', 'settings'),
  mac('sharing', 'x-apple.systempreferences:com.apple.Sharing-Settings.extension', 'General → Sharing', 'settings'),
  mac('lockScreen', 'x-apple.systempreferences:com.apple.Lock-Screen-Settings.extension', 'System Settings → Lock Screen', 'settings'),
  mac('users', 'x-apple.systempreferences:com.apple.Users-Groups-Settings.extension', 'System Settings → Users & Groups', 'settings'),
  mac('backup', 'x-apple.systempreferences:com.apple.Time-Machine-Settings.extension', 'General → Time Machine', 'settings'),
  mac('wifi', 'x-apple.systempreferences:com.apple.wifi-settings-extension', 'System Settings → Wi-Fi', 'settings'),
  mac('vpn', 'x-apple.systempreferences:com.apple.NetworkExtensionSettingsUI.NESettingsUIExtension', 'System Settings → VPN', 'settings'),
  mac('battery', 'x-apple.systempreferences:com.apple.Battery-Settings.extension', 'System Settings → Battery', 'settings'),
  mac('notifications', 'x-apple.systempreferences:com.apple.Notifications-Settings.extension', 'System Settings → Notifications', 'settings'),

  // Quick Controls: settings apps may not change on a Mac.
  mac('bluetooth', 'x-apple.systempreferences:com.apple.BluetoothSettings', 'System Settings → Bluetooth', 'settings', 'untested'),
  mac('airdrop', 'x-apple.systempreferences:com.apple.AirDrop-Handoff-Settings.extension', 'General → AirDrop & Handoff', 'settings', 'untested'),
  mac('findMy', 'x-apple.systempreferences:com.apple.systempreferences.AppleIDSettings', 'System Settings → Apple Account → iCloud → Find My Mac', 'settings', 'untested'),
  // ---------------------------------------------------------------- Windows (Microsoft's ms-settings reference)
  win('settings', 'ms-settings:', 'Settings'),
  win('privacy', 'ms-settings:privacy', 'Settings → Privacy & security', 'settings'),
  win('camera', 'ms-settings:privacy-webcam', 'Privacy & security → Camera', 'privacy'),
  win('microphone', 'ms-settings:privacy-microphone', 'Privacy & security → Microphone', 'privacy'),
  win('screen', 'ms-settings:privacy-graphicscaptureprogrammatic', 'Privacy & security → Screenshots and apps', 'privacy'),
  win('fullDisk', 'ms-settings:privacy-broadfilesystemaccess', 'Privacy & security → File system', 'privacy'),
  win('location', 'ms-settings:privacy-location', 'Privacy & security → Location', 'privacy'),
  win('contacts', 'ms-settings:privacy-contacts', 'Privacy & security → Contacts', 'privacy'),
  win('calendars', 'ms-settings:privacy-calendar', 'Privacy & security → Calendar', 'privacy'),
  win('photos', 'ms-settings:privacy-pictures', 'Privacy & security → Pictures', 'privacy'),
  win('filesFolders', 'ms-settings:privacy-documents', 'Privacy & security → Documents', 'privacy'),
  win('diagnostics', 'ms-settings:privacy-feedback', 'Privacy & security → Diagnostics & feedback', 'privacy'),
  win('activityHistory', 'ms-settings:privacy-activityhistory', 'Privacy & security → Activity history', 'privacy'),
  win('notifications', 'ms-settings:notifications', 'System → Notifications', 'settings'),
  win('encryption', 'ms-settings:deviceencryption', 'Privacy & security → Device encryption', 'security'),
  win('security', 'windowsdefender:', 'Windows Security', 'securitySettings'),
  win('securitySettings', 'ms-settings:windowsdefender', 'Privacy & security → Windows Security', 'settings'),
  win('firewall', 'windowsdefender://network', 'Windows Security → Firewall & network protection', 'security'),
  win('loginItems', 'ms-settings:startupapps', 'Apps → Startup', 'settings'),
  win('updates', 'ms-settings:windowsupdate', 'Windows Update', 'settings'),
  win('storage', 'ms-settings:storagesense', 'System → Storage', 'settings'),
  win('storageSense', 'ms-settings:storagepolicies', 'System → Storage → Storage Sense', 'storage'),
  win('storageCleanup', 'ms-settings:storagerecommendations', 'System → Storage → Cleanup recommendations', 'storage'),
  win('sharing', 'ms-settings:crossdevice', 'System → Nearby sharing', 'settings'),
  win('remoteDesktop', 'ms-settings:remotedesktop', 'System → Remote Desktop', 'settings'),
  win('lockScreen', 'ms-settings:signinoptions', 'Accounts → Sign-in options', 'settings'),
  win('users', 'ms-settings:otherusers', 'Accounts → Other users', 'settings'),
  win('backup', 'ms-settings:sync', 'Accounts → Windows backup', 'settings'),
  win('wifi', 'ms-settings:network-wifi', 'Network & internet → Wi-Fi', 'network'),
  win('network', 'ms-settings:network-status', 'Network & internet', 'settings'),
  win('vpn', 'ms-settings:network-vpn', 'Network & internet → VPN', 'network'),
  win('proxy', 'ms-settings:network-proxy', 'Network & internet → Proxy', 'network'),
  win('battery', 'ms-settings:batterysaver', 'System → Power & battery', 'power'),
  win('power', 'ms-settings:powersleep', 'System → Power', 'settings'),
  win('apps', 'ms-settings:appsfeatures', 'Apps → Installed apps', 'settings'),

  win('bluetooth', 'ms-settings:bluetooth', 'Bluetooth & devices', 'settings'),
  win('airplane', 'ms-settings:network-airplanemode', 'Network & internet → Airplane mode', 'network'),
  win('findMy', 'ms-settings:findmydevice', 'Privacy & security → Find my device', 'privacy'),
  // ---------------------------------------------------------------- Linux: GNOME
  gnome('settings', '', 'Settings'),
  gnome('privacy', 'privacy', 'Settings → Privacy', 'settings'),
  gnome('camera', 'camera', 'Settings → Privacy → Camera', 'privacy'),
  gnome('microphone', 'microphone', 'Settings → Privacy → Microphone', 'privacy'),
  gnome('location', 'location', 'Settings → Privacy → Location', 'privacy'),
  gnome('screen', 'privacy', 'Settings → Privacy', 'settings'),
  gnome('fullDisk', 'applications', 'Settings → Apps', 'settings'),
  gnome('filesFolders', 'applications', 'Settings → Apps', 'settings'),
  gnome('lockScreen', 'screen-lock', 'Settings → Privacy → Screen Lock', 'privacy'),
  gnome('sharing', 'sharing', 'Settings → Sharing', 'settings'),
  gnome('remoteDesktop', 'sharing', 'Settings → Sharing', 'settings'),
  gnome('users', 'user-accounts', 'Settings → Users', 'settings'),
  gnome('network', 'network', 'Settings → Network', 'settings'),
  gnome('wifi', 'wifi', 'Settings → Wi-Fi', 'network'),
  gnome('vpn', 'network', 'Settings → Network → VPN', 'settings'),
  gnome('battery', 'power', 'Settings → Power', 'settings'),
  gnome('power', 'power', 'Settings → Power', 'settings'),
  gnome('notifications', 'notifications', 'Settings → Notifications', 'settings'),
  gnome('apps', 'applications', 'Settings → Apps', 'settings'),
  gnome('storage', 'privacy', 'Settings → Privacy → File History & Trash', 'settings'),
  gnome('bluetooth', 'bluetooth', 'Settings → Bluetooth', 'settings'),
  // ---------------------------------------------------------------- Linux: KDE Plasma
  kde('settings', '', 'System Settings'),
  kde('privacy', 'kcm_recentFiles', 'System Settings → Recent Files', 'settings'),
  kde('firewall', 'kcm_firewall', 'System Settings → Firewall', 'settings'),
  kde('network', 'kcm_networkmanagement', 'System Settings → Connections', 'settings'),
  kde('wifi', 'kcm_networkmanagement', 'System Settings → Connections', 'settings'),
  kde('vpn', 'kcm_networkmanagement', 'System Settings → Connections', 'settings'),
  kde('lockScreen', 'kcm_screenlocker', 'System Settings → Screen Locking', 'settings'),
  kde('users', 'kcm_users', 'System Settings → Users', 'settings'),
  kde('loginItems', 'kcm_autostart', 'System Settings → Autostart', 'settings'),
  kde('notifications', 'kcm_notifications', 'System Settings → Notifications', 'settings'),
  kde('battery', 'kcm_powerdevilprofilesconfig', 'System Settings → Energy Saving', 'settings'),
  kde('power', 'kcm_powerdevilprofilesconfig', 'System Settings → Energy Saving', 'settings'),
  kde('bluetooth', 'kcm_bluetooth', 'System Settings → Bluetooth', 'settings'),
];

/** The link for a topic on this system, following fallbacks. Undefined when even the settings app has no link. */
export function resolveLink(topic: string, os: Os, desktop: Desktop = 'other', seen = new Set<string>()): DeepLink | undefined {
  if (seen.has(topic)) return undefined;
  seen.add(topic);
  const candidates = LINKS.filter((l) => l.topic === topic && l.os === os);
  const pick = os === 'linux'
    ? candidates.find((l) => l.desktop === desktop) ?? (desktop === 'other' ? candidates.find((l) => l.desktop === 'gnome') : undefined)
    : candidates[0];
  if (pick) return pick;
  // No page for this topic here: try the closest one other systems name as its fallback.
  const fb = LINKS.find((l) => l.topic === topic && l.fallback)?.fallback;
  return fb ? resolveLink(fb, os, desktop, seen) : topic === 'settings' ? undefined : resolveLink('settings', os, desktop, seen);
}

/** Every topic named anywhere in the catalog. */
export function topics(): string[] {
  return [...new Set(LINKS.map((l) => l.topic))];
}

/** Which Linux desktop is running, from XDG_CURRENT_DESKTOP. */
export function desktopFrom(env: Record<string, string | undefined>): Desktop {
  const d = (env.XDG_CURRENT_DESKTOP ?? env.DESKTOP_SESSION ?? '').toLowerCase();
  if (/kde|plasma/.test(d)) return 'kde';
  if (/gnome|unity|ubuntu|pop|budgie|cinnamon/.test(d)) return 'gnome';
  return 'other';
}
