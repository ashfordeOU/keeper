// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every system permission Keeper's features can use, on each system: why it
// is needed, which features use it, what Allow does and what to click, and
// how to take it back. The main process reads each one's live state (see
// electron/services/permissions.ts); these plain functions turn that into
// what the Permissions screen shows, and walk through "Allow all".

export type PermPlatform = 'darwin' | 'win32' | 'linux';

/** What Allow does: shows the system's own question, opens the exact settings page, runs a check, or turns something on. */
export type PermHow = 'prompt' | 'settings' | 'test' | 'action' | 'info';

export interface PermissionDef {
  id: string;
  platform: PermPlatform;
  name: string;
  /** one line: why Keeper asks */
  why: string;
  /** feature ids (core/features.ts); the permission is needed while any of them is on */
  features: string[];
  how: PermHow;
  /** what the person clicks in the system's question or settings page */
  steps: string;
  /** System Settings / ms-settings: page */
  settingsUrl?: string;
  /** takes effect only after Keeper restarts */
  restart?: boolean;
  /** how to take it back */
  revoke: string;
}

/** The live answer for one permission, as the main process reads it. */
export type RawPermission = 'authorized' | 'denied' | 'notDetermined' | 'restricted' | 'limited' | 'notRunning' | 'unknown' | 'unavailable';

/** What the screen shows. */
export type PermState = 'allowed' | 'missing' | 'denied' | 'notNeeded' | 'unknown' | 'unavailable' | 'info';

export interface PermissionItem extends PermissionDef {
  state: PermState;
  /** one line about the state (why it cannot be checked, what is missing) */
  detail?: string;
  /** the features that use it and are on now, by name */
  usedBy: string[];
  /** allowed since Keeper started, and Keeper must restart before it takes effect */
  restartNeeded?: boolean;
}

export interface PermissionsReport {
  platform: PermPlatform;
  items: PermissionItem[];
  /** keeper-helper answered (macOS); without it some items cannot be checked */
  helper: boolean;
  checkedAt: number;
}

export interface PermissionsApi {
  list(): Promise<PermissionsReport>;
  /** shows the system's question where there is one, or opens the exact settings page */
  request(id: string): Promise<{ ok: boolean; opened?: 'prompt' | 'settings' | 'test' | 'action'; message?: string }>;
  openSettings(id: string): Promise<boolean>;
  /** Linux and local network: runs a check and says what it found */
  test(id: string): Promise<{ ok: boolean; message: string }>;
  /** restarts Keeper; the session (and the Permissions screen) comes back */
  restart(): Promise<void>;
}

const MAC = 'x-apple.systempreferences:com.apple.preference.security';

const mac = (d: Omit<PermissionDef, 'platform'>): PermissionDef => ({ ...d, platform: 'darwin' });
const win = (d: Omit<PermissionDef, 'platform'>): PermissionDef => ({ ...d, platform: 'win32' });
const lin = (d: Omit<PermissionDef, 'platform'>): PermissionDef => ({ ...d, platform: 'linux' });

const MAC_REVOKE = (pane: string) => `System Settings → Privacy & Security → ${pane}: switch Keeper off (or select it and press −).`;

export const PERMISSIONS: PermissionDef[] = [
  // ---------------------------------------------------------------- macOS
  mac({ id: 'accessibility', name: 'Accessibility', why: 'Lets Keeper type dictated text, show other apps’ notifications in the Island, tidy windows for Stage, and be controlled from your other devices.', features: ['dictation', 'notifyMirror', 'stage', 'remoteScreen', 'rdcHosting', 'unattendedAccess', 'aiAgents', 'keepAwake', 'writingHelp'], how: 'prompt', steps: 'macOS asks: choose “Open System Settings”, then switch on Keeper under Accessibility.', settingsUrl: `${MAC}?Privacy_Accessibility`, revoke: MAC_REVOKE('Accessibility') }),
  mac({ id: 'screen', name: 'Screen & System Audio Recording', why: 'Lets Keeper take screenshots and recordings, copy text from the screen, record a meeting’s sound and share this screen with your devices.', features: ['capture', 'meetings', 'stage', 'remoteScreen', 'rdcHosting', 'aiAgents'], how: 'prompt', restart: true, steps: 'macOS asks: choose “Open System Settings”, switch on Keeper, then choose “Later” and use Restart Keeper here.', settingsUrl: `${MAC}?Privacy_ScreenCapture`, revoke: MAC_REVOKE('Screen & System Audio Recording') }),
  mac({ id: 'input', name: 'Input Monitoring', why: 'Lets Keeper notice the hold-to-talk key for dictation, show your keystrokes on Stage and see when you press mute in a call.', features: ['dictationHold', 'displayKeys', 'islandCalls', 'stage'], how: 'prompt', restart: true, steps: 'macOS asks: choose “Open System Settings”, switch on Keeper under Input Monitoring, then restart Keeper here.', settingsUrl: `${MAC}?Privacy_ListenEvent`, revoke: MAC_REVOKE('Input Monitoring') }),
  mac({ id: 'microphone', name: 'Microphone', why: 'Used only while you dictate, record a meeting or a voice note, or check your microphone in the Island.', features: ['dictation', 'meetings', 'notes', 'islandPrompter', 'remoteScreen', 'micIndicator'], how: 'prompt', steps: 'macOS asks: choose “Allow”.', settingsUrl: `${MAC}?Privacy_Microphone`, revoke: MAC_REVOKE('Microphone') }),
  mac({ id: 'camera', name: 'Camera', why: 'Used only by the Island’s mirror, to check how you look before a call.', features: ['island'], how: 'prompt', steps: 'macOS asks: choose “Allow”.', settingsUrl: `${MAC}?Privacy_Camera`, revoke: MAC_REVOKE('Camera') }),
  mac({ id: 'fullDisk', name: 'Full Disk Access', why: 'Lets Keeper see where downloads came from in Mail and Safari, read which apps hold other permissions, and include protected folders in the library.', features: ['sources', 'protection', 'security', 'notifyMirror', 'tracks'], how: 'settings', steps: 'System Settings opens at Full Disk Access: switch on Keeper (if it is not listed, press + and choose Keeper in Applications).', settingsUrl: `${MAC}?Privacy_AllFiles`, revoke: MAC_REVOKE('Full Disk Access') }),
  mac({ id: 'automation.systemevents', name: 'Automation: System Events', why: 'Lets Keeper hide and show apps for Stage, read the front window for Cues and run quick controls.', features: ['stage', 'cues', 'quickControls', 'aiAgents', 'appControls'], how: 'prompt', steps: 'macOS asks whether Keeper may control “System Events”: choose “Allow”.', settingsUrl: `${MAC}?Privacy_Automation`, revoke: MAC_REVOKE('Automation → Keeper → System Events') }),
  mac({ id: 'automation.finder', name: 'Automation: Finder', why: 'Lets Keeper hide desktop icons for Stage, set folder icons, and eject or open places in Finder.', features: ['stage', 'folderIcons', 'places', 'wallpaper'], how: 'prompt', steps: 'macOS asks whether Keeper may control “Finder”: choose “Allow”.', settingsUrl: `${MAC}?Privacy_Automation`, revoke: MAC_REVOKE('Automation → Keeper → Finder') }),
  mac({ id: 'automation.music', name: 'Automation: Music', why: 'Lets the Island show and control what is playing in Music.', features: ['media'], how: 'prompt', steps: 'Music opens in the background and macOS asks whether Keeper may control it: choose “Allow”.', settingsUrl: `${MAC}?Privacy_Automation`, revoke: MAC_REVOKE('Automation → Keeper → Music') }),
  mac({ id: 'automation.notes', name: 'Automation: Notes', why: 'Lets Notes Everywhere read and write your Apple Notes.', features: ['notesSync'], how: 'prompt', steps: 'Notes opens in the background and macOS asks whether Keeper may control it: choose “Allow”.', settingsUrl: `${MAC}?Privacy_Automation`, revoke: MAC_REVOKE('Automation → Keeper → Notes') }),
  mac({ id: 'notifications', name: 'Notifications', why: 'Lets alarms, timers, calendar alerts and health alerts reach you when Keeper is in the background.', features: ['alarms', 'calendars', 'health', 'cues', 'focus'], how: 'prompt', steps: 'macOS asks: choose “Allow”.', settingsUrl: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension', revoke: 'System Settings → Notifications → Keeper: switch off “Allow notifications”.' }),
  mac({ id: 'calendars', name: 'Calendars', why: 'Lets the Island show your next meeting and its link from the calendars on this Mac.', features: ['calendar'], how: 'prompt', steps: 'macOS asks: choose “Allow Full Access”.', settingsUrl: `${MAC}?Privacy_Calendars`, revoke: MAC_REVOKE('Calendars') }),
  mac({ id: 'reminders', name: 'Reminders', why: 'Lets the Island list and check off your reminders.', features: ['calendar', 'islandTodos'], how: 'prompt', steps: 'macOS asks: choose “Allow Full Access”.', settingsUrl: `${MAC}?Privacy_Reminders`, revoke: MAC_REVOKE('Reminders') }),
  mac({ id: 'location', name: 'Location', why: 'Lets the Toolbox fill in where you are; Weather and Places & Tracks work from places you add without it.', features: ['tools'], how: 'prompt', steps: 'macOS asks: choose “Allow”. If nothing appears, switch on Location Services and Keeper in System Settings.', settingsUrl: `${MAC}?Privacy_LocationServices`, revoke: MAC_REVOKE('Location Services') }),
  mac({ id: 'localNetwork', name: 'Local Network', why: 'Lets Keeper find and reach your other devices, servers and shared folders on this network.', features: ['link', 'network', 'keeperMesh', 'remote', 'remoteDesktops'], how: 'test', steps: 'Keeper looks for devices on the network; if macOS asks, choose “Allow”.', settingsUrl: `${MAC}?Privacy_LocalNetwork`, revoke: MAC_REVOKE('Local Network') }),
  mac({ id: 'loginItem', name: 'Open at login', why: 'Starts Keeper quietly in the menu bar when you log in.', features: ['login'], how: 'action', steps: 'Keeper adds itself; macOS may show a note that a login item was added.', settingsUrl: 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension', revoke: 'System Settings → General → Login Items & Extensions: remove Keeper, or switch off Start at login in Keeper’s Settings → Features.' }),

  // ---------------------------------------------------------------- Windows
  win({ id: 'microphone', name: 'Microphone', why: 'Used only while you dictate, record a meeting or a voice note, or check your microphone.', features: ['dictation', 'meetings', 'notes', 'islandPrompter', 'remoteScreen'], how: 'settings', steps: 'Settings opens at Privacy & security → Microphone: switch on “Microphone access” and “Let desktop apps access your microphone”.', settingsUrl: 'ms-settings:privacy-microphone', revoke: 'Settings → Privacy & security → Microphone: switch off “Let desktop apps access your microphone”.' }),
  win({ id: 'camera', name: 'Camera', why: 'Used only by the Island’s mirror, to check how you look before a call.', features: ['island'], how: 'settings', steps: 'Settings opens at Privacy & security → Camera: switch on “Camera access” and “Let desktop apps access your camera”.', settingsUrl: 'ms-settings:privacy-webcam', revoke: 'Settings → Privacy & security → Camera: switch off “Let desktop apps access your camera”.' }),
  win({ id: 'location', name: 'Location', why: 'Lets the Toolbox fill in where you are.', features: ['tools'], how: 'settings', steps: 'Settings opens at Privacy & security → Location: switch on “Location services” and “Let desktop apps access your location”.', settingsUrl: 'ms-settings:privacy-location', revoke: 'Settings → Privacy & security → Location: switch off “Let desktop apps access your location”.' }),
  win({ id: 'notifications', name: 'Notifications', why: 'Lets alarms, timers, calendar alerts and health alerts reach you.', features: ['alarms', 'calendars', 'health', 'cues', 'focus'], how: 'settings', steps: 'Settings opens at System → Notifications: switch on Notifications, and Keeper in the list.', settingsUrl: 'ms-settings:notifications', revoke: 'Settings → System → Notifications: switch off Keeper.' }),
  win({ id: 'admin', name: 'Administrator approval', why: 'A few changes need it each time: firewall rules, Keeper Mesh’s network adapter and startup items for every user. Windows asks then; Keeper never runs as administrator all the time.', features: ['firewall', 'keeperMesh', 'startupItems'], how: 'info', steps: 'When Windows asks “Do you want to allow this app to make changes?”, check that it names Keeper by Ashforde and choose Yes.', revoke: 'Nothing is kept: each approval is for one change.' }),
  win({ id: 'firewall', name: 'Firewall', why: 'The first time Keeper answers your other devices, Windows Defender Firewall asks whether it may use the network.', features: ['link', 'keeperMesh', 'remote', 'linkDirect'], how: 'info', steps: 'When Windows Security asks, tick “Private networks” (home and work) and choose “Allow”. Public networks are best left off.', settingsUrl: 'windowsdefender://network/', revoke: 'Windows Security → Firewall & network protection → Allow an app through firewall: untick Keeper.' }),

  // ---------------------------------------------------------------- Linux
  lin({ id: 'portal.screencast', name: 'Screen sharing (portal)', why: 'Lets Keeper take screenshots and recordings and share this screen on Wayland; the desktop asks each time unless you let it remember.', features: ['capture', 'meetings', 'remoteScreen', 'stage'], how: 'test', steps: 'Press Test: your desktop asks which screen to share; pick one and choose Share (tick “Remember” if it offers).', revoke: 'Your desktop’s Settings → Privacy (or Apps → Keeper): remove the screen sharing permission. Nothing is kept unless you chose to remember.' }),
  lin({ id: 'portal.remotedesktop', name: 'Remote control (portal)', why: 'Lets your other devices move the pointer and type on this computer on Wayland.', features: ['remoteScreen', 'rdcHosting', 'waylandControl', 'unattendedAccess'], how: 'test', steps: 'Press Test: your desktop asks to allow remote interaction; choose Allow.', revoke: 'Your desktop’s Settings → Privacy → Remote desktop, or end the session.' }),
  lin({ id: 'portal.location', name: 'Location (portal)', why: 'Lets the Toolbox fill in where you are.', features: ['tools'], how: 'test', steps: 'Press Test: if your desktop asks, choose Allow. Location services must be on in Settings → Privacy.', revoke: 'Settings → Privacy → Location services: switch off Keeper or location services.' }),
  lin({ id: 'portal.camera', name: 'Camera (portal)', why: 'Used only by the Island’s mirror.', features: ['island'], how: 'test', steps: 'Press Test: if your desktop asks, choose Allow.', revoke: 'Settings → Privacy → Camera: switch off Keeper.' }),
  lin({ id: 'inputGroup', name: 'Keyboard access (input group)', why: 'Lets Keeper notice the hold-to-talk key and show keystrokes on Stage under Wayland, by reading /dev/input.', features: ['dictationHold', 'displayKeys', 'stage'], how: 'info', restart: true, steps: 'In a terminal run: sudo usermod -aG input $USER — then log out and in again. Only do this if you use these features: any app you run can then read the keyboard.', revoke: 'sudo gpasswd -d $USER input, then log out and in again.' }),
  lin({ id: 'atspi', name: 'Accessibility bus (AT-SPI)', why: 'Lets Keeper read other apps’ notifications and controls for the Island and AI agents.', features: ['notifyMirror', 'aiAgents', 'dictation'], how: 'test', steps: 'On GNOME, switch on Settings → Accessibility → any assistive feature, or run: gsettings set org.gnome.desktop.interface toolkit-accessibility true', revoke: 'gsettings set org.gnome.desktop.interface toolkit-accessibility false' }),
];

export function catalogueFor(platform: string): PermissionDef[] {
  return PERMISSIONS.filter((p) => p.platform === platform);
}

/** macOS answers (TCC, EventKit, CoreLocation, Apple events) as one word. */
export function rawFromMac(v: unknown): RawPermission {
  switch (v) {
    case true: case 'authorized': case 'granted': case 'fullAccess': case 'allowed': case 'authorizedAlways': case 'authorizedWhenInUse': case 'provisional': case 'ephemeral': return 'authorized';
    case false: case 'denied': return 'denied';
    case 'notDetermined': case 'not-determined': return 'notDetermined';
    case 'restricted': return 'restricted';
    case 'writeOnly': case 'limited': return 'limited';
    case 'notRunning': return 'notRunning';
    case 'unavailable': return 'unavailable';
    default: return 'unknown';
  }
}

/** AEDeterminePermissionToAutomateTarget's answer. */
export function rawFromAppleEvents(status: number): RawPermission {
  if (status === 0) return 'authorized';
  if (status === -1743) return 'denied';
  if (status === -1744) return 'notDetermined';
  if (status === -600) return 'notRunning';
  return 'unknown';
}

/** A CapabilityAccessManager ConsentStore value (Windows): the switch for everyone and the one for desktop apps. */
export function rawFromConsent(global: string | null, desktop: string | null): RawPermission {
  if (global === 'Deny' || desktop === 'Deny') return 'denied';
  if (global === 'Allow' && (desktop === 'Allow' || desktop === null)) return 'authorized';
  if (global === null && desktop === null) return 'unknown';
  return 'notDetermined';
}

/** The value of one entry in `reg query … /v Name` output, or null. */
export function regValue(out: string, name: string): string | null {
  const m = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+REG_\\w+\\s+(.*?)\\s*$`, 'mi').exec(out);
  return m ? m[1] : null;
}

/** `id -nG` lists the person's groups. */
export function inInputGroup(groups: string): boolean {
  return groups.split(/\s+/).includes('input');
}

/** Which portals the desktop offers, from `gdbus introspect` of /org/freedesktop/portal/desktop. */
export function portalsFrom(introspect: string): Set<string> {
  const out = new Set<string>();
  for (const m of introspect.matchAll(/interface\s+org\.freedesktop\.portal\.(\w+)/g)) out.add(m[1]);
  return out;
}

const STATE_DETAIL: Partial<Record<RawPermission, string>> = {
  restricted: 'Blocked by a profile or parental controls on this computer.',
  limited: 'Only partly allowed: Keeper needs full access.',
  notRunning: 'Not checked yet: Allow opens the app in the background and asks.',
  unavailable: 'This desktop does not offer it.',
};

/**
 * One permission's state: not needed while every feature that uses it is
 * off; otherwise allowed, not yet, or turned off. Items that cannot be read
 * (local network, notifications without the helper) say so.
 */
export function itemState(def: PermissionDef, raw: RawPermission | undefined, featuresOn: Set<string>): { state: PermState; detail?: string; usedBy: string[] } {
  const usedBy = def.features.filter((f) => featuresOn.has(f));
  if (def.how === 'info') return { state: raw === 'authorized' ? 'allowed' : usedBy.length ? 'info' : 'notNeeded', usedBy };
  if (raw === 'authorized') return { state: 'allowed', usedBy };
  if (!usedBy.length) return { state: 'notNeeded', usedBy };
  switch (raw) {
    case 'denied': case 'restricted': return { state: 'denied', detail: STATE_DETAIL[raw], usedBy };
    case 'notDetermined': case 'limited': case 'notRunning': return { state: 'missing', detail: STATE_DETAIL[raw], usedBy };
    case 'unavailable': return { state: 'unavailable', detail: STATE_DETAIL.unavailable, usedBy };
    default: return { state: 'unknown', detail: 'macOS does not let apps read this one; Allow asks again or opens the settings page.', usedBy };
  }
}

/** Builds the screen's list from the catalogue, the live answers and the features that are on. */
export function buildReport(platform: PermPlatform, raw: Record<string, RawPermission>, featuresOn: Set<string>, featureName: (id: string) => string, o: { helper: boolean; restartPending?: Set<string>; now?: number; details?: Record<string, string> } = { helper: true }): PermissionsReport {
  const items = catalogueFor(platform).map((def): PermissionItem => {
    const s = itemState(def, raw[def.id], featuresOn);
    return { ...def, ...s, detail: o.details?.[def.id] ?? s.detail, usedBy: s.usedBy.map(featureName), restartNeeded: s.state === 'allowed' && !!o.restartPending?.has(def.id) };
  });
  return { platform, items, helper: o.helper, checkedAt: o.now ?? Date.now() };
}

export const STATE_LABEL: Record<PermState, string> = {
  allowed: 'Allowed', missing: 'Not yet', denied: 'Turned off', notNeeded: 'Not needed', unknown: 'Can’t be checked', unavailable: 'Not available', info: 'Asked when needed',
};

export function summarize(items: PermissionItem[]): { allowed: number; todo: number; notNeeded: number; restart: boolean } {
  return {
    allowed: items.filter((i) => i.state === 'allowed').length,
    todo: items.filter((i) => i.state === 'missing' || i.state === 'denied').length,
    notNeeded: items.filter((i) => i.state === 'notNeeded').length,
    restart: items.some((i) => i.restartNeeded),
  };
}

// ---------------------------------------------------------------- Allow all

/** What "Allow all" walks through, in order: everything needed and not yet allowed that Keeper can ask for or open. */
export function allowAllQueue(items: PermissionItem[]): string[] {
  return items.filter((i) => (i.state === 'missing' || i.state === 'denied' || (i.state === 'unknown' && i.how !== 'info')) && i.how !== 'info').map((i) => i.id);
}

/** The next one to do: the first in the queue not yet allowed and not skipped; null when done. */
export function nextInQueue(queue: string[], items: PermissionItem[], skipped: Set<string>): string | null {
  for (const id of queue) {
    if (skipped.has(id)) continue;
    const it = items.find((i) => i.id === id);
    if (!it || it.state === 'allowed' || it.state === 'notNeeded') continue;
    return id;
  }
  return null;
}

/** Which of the queue became allowed (for the mac test kit and the summary at the end). */
export function newlyAllowed(before: PermissionItem[], after: PermissionItem[]): string[] {
  const was = new Map(before.map((i) => [i.id, i.state]));
  return after.filter((i) => i.state === 'allowed' && was.get(i.id) !== 'allowed').map((i) => i.id);
}
