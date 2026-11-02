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
  /** Keeper already showed the system's question once; another Allow goes to the settings page */
  askedOnce?: boolean;
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
  mac({ id: 'screen', name: 'Screen & System Audio Recording', why: 'Lets Keeper take screenshots and recordings (Studio too), copy text from the screen, record a meeting’s sound and share this screen with your devices.', features: ['capture', 'studio', 'meetings', 'stage', 'remoteScreen', 'rdcHosting', 'aiAgents'], how: 'prompt', restart: true, steps: 'macOS asks: choose “Open System Settings”, switch on Keeper, then choose “Later” and use Restart Keeper here.', settingsUrl: `${MAC}?Privacy_ScreenCapture`, revoke: MAC_REVOKE('Screen & System Audio Recording') }),
  mac({ id: 'input', name: 'Input Monitoring', why: 'Lets Keeper notice the hold-to-talk key for dictation, show your keystrokes on Stage and see when you press mute in a call.', features: ['dictationHold', 'displayKeys', 'islandCalls', 'stage'], how: 'prompt', restart: true, steps: 'macOS asks: choose “Open System Settings”, switch on Keeper under Input Monitoring, then restart Keeper here.', settingsUrl: `${MAC}?Privacy_ListenEvent`, revoke: MAC_REVOKE('Input Monitoring') }),
  mac({ id: 'microphone', name: 'Microphone', why: 'Used only while you dictate, record a meeting, a voice note or a Studio recording with the microphone on, or check your microphone in the Island.', features: ['dictation', 'meetings', 'studio', 'notes', 'islandPrompter', 'remoteScreen', 'micIndicator'], how: 'prompt', steps: 'macOS asks: choose “Allow”.', settingsUrl: `${MAC}?Privacy_Microphone`, revoke: MAC_REVOKE('Microphone') }),
  mac({ id: 'camera', name: 'Camera', why: 'Used by the Island’s mirror, to check how you look before a call, and by Studio recordings with the camera on.', features: ['island', 'studio'], how: 'prompt', steps: 'macOS asks: choose “Allow”.', settingsUrl: `${MAC}?Privacy_Camera`, revoke: MAC_REVOKE('Camera') }),
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
  mac({ id: 'filesFolders', name: 'Files and folders', why: 'macOS asks once for each of Desktop, Documents and Downloads (and for removable and network disks) the first time Keeper looks inside. Full Disk Access answers all of them at once.', features: ['library'], how: 'info', steps: 'When macOS asks whether Keeper may access files in a folder, choose “Allow”. Or switch on Full Disk Access above and these questions do not appear.', settingsUrl: `${MAC}?Privacy_FilesAndFolders`, revoke: MAC_REVOKE('Files & Folders') }),
  mac({ id: 'keychain', name: 'Keychain', why: 'Keeper keeps your mail passwords, AI keys and device keys in the macOS keychain (“Keeper Safe Storage”). After an update macOS may ask once more.', features: ['mail', 'assistant', 'brain', 'link', 'lock', 'remote', 'sync', 'keeperMesh'], how: 'test', steps: 'When macOS asks about “Keeper Safe Storage”, type your login password and choose “Always Allow”. If you chose Deny, press Try again here.', revoke: 'Keychain Access → login → “Keeper Safe Storage” → Access Control: remove Keeper. Keeper then cannot read what it saved.' }),
  mac({ id: 'admin', name: 'Administrator password', why: 'A few changes ask for your Mac password each time: installing Keeper Mesh’s network service and changing startup items for every user. Keeper never keeps it.', features: ['keeperMesh', 'startupItems', 'unattendedAccess'], how: 'info', steps: 'When macOS asks for an administrator password, check that the message names Keeper, then type it.', revoke: 'Nothing is kept: each approval is for one change.' }),
  mac({ id: 'loginItem', name: 'Open at login', why: 'Starts Keeper quietly in the menu bar when you log in.', features: ['login'], how: 'action', steps: 'Keeper adds itself; macOS may show a note that a login item was added.', settingsUrl: 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension', revoke: 'System Settings → General → Login Items & Extensions: remove Keeper, or switch off Start at login in Keeper’s Settings → Features.' }),

  // ---------------------------------------------------------------- Windows
  win({ id: 'microphone', name: 'Microphone', why: 'Used only while you dictate, record a meeting, a voice note or a Studio recording with the microphone on, or check your microphone.', features: ['dictation', 'meetings', 'studio', 'notes', 'islandPrompter', 'remoteScreen'], how: 'settings', steps: 'Settings opens at Privacy & security → Microphone: switch on “Microphone access” and “Let desktop apps access your microphone”.', settingsUrl: 'ms-settings:privacy-microphone', revoke: 'Settings → Privacy & security → Microphone: switch off “Let desktop apps access your microphone”.' }),
  win({ id: 'camera', name: 'Camera', why: 'Used by the Island’s mirror, to check how you look before a call, and by Studio recordings with the camera on.', features: ['island', 'studio'], how: 'settings', steps: 'Settings opens at Privacy & security → Camera: switch on “Camera access” and “Let desktop apps access your camera”.', settingsUrl: 'ms-settings:privacy-webcam', revoke: 'Settings → Privacy & security → Camera: switch off “Let desktop apps access your camera”.' }),
  win({ id: 'location', name: 'Location', why: 'Lets the Toolbox fill in where you are.', features: ['tools'], how: 'settings', steps: 'Settings opens at Privacy & security → Location: switch on “Location services” and “Let desktop apps access your location”.', settingsUrl: 'ms-settings:privacy-location', revoke: 'Settings → Privacy & security → Location: switch off “Let desktop apps access your location”.' }),
  win({ id: 'notifications', name: 'Notifications', why: 'Lets alarms, timers, calendar alerts and health alerts reach you.', features: ['alarms', 'calendars', 'health', 'cues', 'focus'], how: 'settings', steps: 'Settings opens at System → Notifications: switch on Notifications, and Keeper in the list.', settingsUrl: 'ms-settings:notifications', revoke: 'Settings → System → Notifications: switch off Keeper.' }),
  win({ id: 'admin', name: 'Administrator approval', why: 'A few changes need it each time: firewall rules, Keeper Mesh’s network adapter and startup items for every user. Windows asks then; Keeper never runs as administrator all the time.', features: ['firewall', 'keeperMesh', 'startupItems'], how: 'info', steps: 'When Windows asks “Do you want to allow this app to make changes?”, check that it names Keeper by Ashforde and choose Yes.', revoke: 'Nothing is kept: each approval is for one change.' }),
  win({ id: 'keychain', name: 'Credential storage', why: 'Keeper keeps your mail passwords, AI keys and device keys encrypted with your Windows account (DPAPI), so only you can read them on this computer.', features: ['mail', 'assistant', 'brain', 'link', 'lock', 'remote', 'sync', 'keeperMesh'], how: 'test', steps: 'Nothing to do: it works when you are signed in to Windows. If Keeper says it can’t read its saved passwords, press Try again.', revoke: 'Remove an account or key in Keeper; signing in as another Windows user cannot read them.' }),
  win({ id: 'loginItem', name: 'Open at login', why: 'Starts Keeper quietly in the system tray when you sign in.', features: ['login'], how: 'action', steps: 'Keeper adds itself to your startup apps.', settingsUrl: 'ms-settings:startupapps', revoke: 'Settings → Apps → Startup: switch Keeper off, or switch off Open at login in Keeper’s Settings → Features.' }),
  win({ id: 'firewall', name: 'Firewall', why: 'The first time Keeper answers your other devices, Windows Defender Firewall asks whether it may use the network.', features: ['link', 'keeperMesh', 'remote', 'linkDirect'], how: 'info', steps: 'When Windows Security asks, tick “Private networks” (home and work) and choose “Allow”. Public networks are best left off.', settingsUrl: 'windowsdefender://network/', revoke: 'Windows Security → Firewall & network protection → Allow an app through firewall: untick Keeper.' }),

  // ---------------------------------------------------------------- Linux
  lin({ id: 'keychain', name: 'Keyring', why: 'Keeper keeps your mail passwords, AI keys and device keys in your desktop’s keyring (GNOME Keyring or KWallet). Without one, Keeper keeps them only until it quits.', features: ['mail', 'assistant', 'brain', 'link', 'lock', 'remote', 'sync', 'keeperMesh'], how: 'test', steps: 'If Test says there is no keyring: install gnome-keyring (or KWallet on KDE), log out and in again, then press Test. If it is locked, unlock it with your login password.', revoke: 'Seahorse (Passwords and Keys) or KWallet Manager: delete the “Keeper” entries.' }),
  lin({ id: 'loginItem', name: 'Open at login', why: 'Starts Keeper quietly in the tray when you log in.', features: ['login'], how: 'action', steps: 'Keeper adds a start-up entry to ~/.config/autostart.', revoke: 'Your desktop’s Startup Applications: remove Keeper, or switch off Open at login in Keeper’s Settings → Features.' }),
  lin({ id: 'portal.screencast', name: 'Screen sharing', why: 'Lets Keeper take screenshots and recordings (Studio too) and share this screen on Wayland; the desktop asks each time unless you let it remember.', features: ['capture', 'studio', 'meetings', 'remoteScreen', 'stage'], how: 'test', steps: 'Press Test: your desktop asks which screen to share; pick one and choose Share (tick “Remember” if it offers).', revoke: 'Your desktop’s Settings → Privacy (or Apps → Keeper): remove the screen sharing permission. Nothing is kept unless you chose to remember.' }),
  lin({ id: 'portal.remotedesktop', name: 'Remote control', why: 'Lets your other devices move the pointer and type on this computer on Wayland.', features: ['remoteScreen', 'rdcHosting', 'waylandControl', 'unattendedAccess'], how: 'test', steps: 'Press Test: your desktop asks to allow remote interaction; choose Allow.', revoke: 'Your desktop’s Settings → Privacy → Remote desktop, or end the session.' }),
  lin({ id: 'portal.location', name: 'Location', why: 'Lets the Toolbox fill in where you are.', features: ['tools'], how: 'test', steps: 'Press Test: if your desktop asks, choose Allow. Location services must be on in Settings → Privacy.', revoke: 'Settings → Privacy → Location services: switch off Keeper or location services.' }),
  lin({ id: 'portal.camera', name: 'Camera', why: 'Used by the Island’s mirror and by Studio recordings with the camera on.', features: ['island', 'studio'], how: 'test', steps: 'Press Test: if your desktop asks, choose Allow.', revoke: 'Settings → Privacy → Camera: switch off Keeper.' }),
  lin({ id: 'inputGroup', name: 'Notice a held key', why: 'Lets Keeper notice the hold-to-talk key and show keystrokes on Stage under Wayland, by reading /dev/input.', features: ['dictationHold', 'displayKeys', 'stage'], how: 'info', restart: true, steps: 'In a terminal run: sudo usermod -aG input $USER — then log out and in again. Only do this if you use these features: any app you run can then read the keyboard.', revoke: 'sudo gpasswd -d $USER input, then log out and in again.' }),
  lin({ id: 'atspi', name: 'Read other apps’ windows', why: 'Lets Keeper read other apps’ notifications and controls for the Island and AI agents.', features: ['notifyMirror', 'aiAgents', 'dictation'], how: 'test', steps: 'On GNOME, switch on Settings → Accessibility → any assistive feature, or run: gsettings set org.gnome.desktop.interface toolkit-accessibility true', revoke: 'gsettings set org.gnome.desktop.interface toolkit-accessibility false' }),
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

// ---------------------------------------------------------------- asking twice

/**
 * macOS shows the question for these only once per app (and reads a dismissed
 * one as "not yet", not "turned off"), so a second Allow must open their
 * System Settings page instead of asking into the void.
 */
export const ASKED_ONCE_ONLY = new Set(['accessibility', 'screen', 'input']);

/** Shown on those rows after a round trip to System Settings changed nothing. */
export const STALE_HINT = 'Already switched on in System Settings? macOS may still hold an older copy’s approval: select Keeper there, press −, then + and choose Keeper again.';

/**
 * What Allow does now: show the system's question, or go straight to the
 * settings page (turned off, or one of the ask-once permissions asked before).
 */
export function requestRoute(platform: PermPlatform, def: Pick<PermissionDef, 'id' | 'how'>, state: PermState | undefined, askedOnce: boolean): 'prompt' | 'settings' | 'other' {
  if (def.how !== 'prompt') return def.how === 'settings' || def.how === 'info' ? 'settings' : 'other';
  if (platform !== 'darwin') return 'settings';
  if (state === 'denied') return 'settings';
  if (askedOnce && ASKED_ONCE_ONLY.has(def.id)) return 'settings';
  return 'prompt';
}

/** After the question: open the settings page too when the answer is still not yes (ask-once permissions only). */
export function openPaneAfterPrompt(platform: PermPlatform, id: string, stateAfter: PermState | undefined): boolean {
  return platform === 'darwin' && ASKED_ONCE_ONLY.has(id) && stateAfter !== 'allowed';
}

/** The button on a row. */
export function allowLabel(it: Pick<PermissionItem, 'how' | 'state' | 'askedOnce' | 'id'>, platform: string): string {
  if (it.id === 'keychain') return 'Try again';
  if (it.how === 'test') return 'Test';
  if (it.how === 'action') return 'Turn on';
  const pane = platform === 'darwin' ? 'Open System Settings' : 'Open Settings';
  if (it.state === 'denied' || it.how === 'settings') return pane;
  if (platform === 'darwin' && it.askedOnce && ASKED_ONCE_ONLY.has(it.id)) return pane;
  return 'Allow';
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
export function buildReport(platform: PermPlatform, raw: Record<string, RawPermission>, featuresOn: Set<string>, featureName: (id: string) => string, o: { helper: boolean; restartPending?: Set<string>; now?: number; details?: Record<string, string>; asked?: Record<string, number> } = { helper: true }): PermissionsReport {
  const items = catalogueFor(platform).map((def): PermissionItem => {
    const s = itemState(def, raw[def.id], featuresOn);
    const askedOnce = !!o.asked?.[def.id];
    const stale = askedOnce && platform === 'darwin' && ASKED_ONCE_ONLY.has(def.id) && (s.state === 'missing' || s.state === 'notNeeded') ? STALE_HINT : undefined;
    return { ...def, ...s, detail: o.details?.[def.id] ?? s.detail ?? stale, usedBy: s.usedBy.map(featureName), restartNeeded: s.state === 'allowed' && !!o.restartPending?.has(def.id), askedOnce };
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

// ---------------------------------------------------------------- tiers (first-run setup)

/**
 * Approvals worth doing up front: the System Settings pages that are painful to visit
 * in the middle of a task. Each lists the parts that need it straight away (others
 * that use it only for an extra ask on first use). `optional` ones are offered, not pushed.
 */
const SETUP_NOW: Partial<Record<PermPlatform, Record<string, { features?: string[]; optional?: boolean }>>> = {
  darwin: {
    accessibility: { features: ['dictation', 'notifyMirror', 'stage', 'remoteScreen', 'rdcHosting', 'unattendedAccess', 'aiAgents'] },
    screen: {},
    input: { features: ['dictationHold', 'displayKeys', 'stage'] },
    fullDisk: { optional: true },
  },
};

/** Never asked up front: only when the part that needs them is used. */
const NEVER_NOW = new Set(['location', 'camera', 'portal.location', 'portal.camera']);

export interface SetupApprovals {
  /** do now, in this order (System Settings pages) */
  now: (PermissionDef & { optional?: boolean; usedBy: string[] })[];
  /** asked by the system the first time the part is used: nothing to do now */
  onUse: (PermissionDef & { usedBy: string[] })[];
  /** of `now`, how many need Keeper to restart */
  restarts: number;
}

/**
 * Which approvals the chosen parts need, tiered: "now" only for the parts that are on
 * and need a System Settings page; "when you first use it" for one-click questions.
 * Approvals no chosen part needs are left out. Automation: Music only when Music is running.
 */
export function approvalsFor(platform: PermPlatform, on: Iterable<string>, o: { musicRunning?: boolean; allowed?: Set<string> } = {}): SetupApprovals {
  const chosen = new Set(on);
  const now: SetupApprovals['now'] = [];
  const onUse: SetupApprovals['onUse'] = [];
  for (const def of catalogueFor(platform)) {
    const usedBy = def.features.filter((f) => chosen.has(f));
    if (!usedBy.length || def.how === 'info') continue;
    if (def.id === 'automation.music' && !o.musicRunning) continue;
    if (def.id === 'loginItem' || def.id === 'keychain' || def.id === 'localNetwork') continue; // done by Keeper itself, or explained where it happens
    const tier = SETUP_NOW[platform]?.[def.id];
    const needNow = tier && !NEVER_NOW.has(def.id) && (!tier.features || tier.features.some((f) => chosen.has(f)));
    if (needNow) {
      if (!o.allowed?.has(def.id)) now.push({ ...def, optional: tier.optional, usedBy });
    } else if (!o.allowed?.has(def.id)) onUse.push({ ...def, usedBy });
  }
  return { now, onUse, restarts: now.filter((d) => d.restart).length };
}

/** "2 steps · about 1 minute · Keeper restarts once at the end" */
export function approvalsLine(a: SetupApprovals): string {
  const n = a.now.length;
  if (!n) return 'Nothing to do now';
  const mins = Math.max(1, Math.round((n * 25) / 60));
  return `${n} ${n === 1 ? 'step' : 'steps'} · about ${mins} ${mins === 1 ? 'minute' : 'minutes'}${a.restarts ? ' · Keeper restarts once at the end' : ''}`;
}
