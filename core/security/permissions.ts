// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Who can watch what: reading each system's own record of which apps may use
// the camera, microphone, screen, location, files and so on.
//
//   macOS    the TCC databases (user and system), read with sqlite3
//   Windows  CapabilityAccessManager's ConsentStore in the registry (with last-used times)
//   Linux    Flatpak's permission store, app manifests, and PipeWire for what is in use now

import type { PermissionGrant, PrivacyService } from './types';

// ---------------------------------------------------------------- macOS TCC

const TCC: Record<string, PrivacyService> = {
  kTCCServiceCamera: 'camera',
  kTCCServiceMicrophone: 'microphone',
  kTCCServiceScreenCapture: 'screen',
  kTCCServiceLocation: 'location',
  kTCCServiceAddressBook: 'contacts',
  kTCCServiceCalendar: 'calendars',
  kTCCServiceReminders: 'reminders',
  kTCCServicePhotos: 'photos',
  kTCCServicePhotosAdd: 'photos',
  kTCCServiceSystemPolicyAllFiles: 'files',
  kTCCServiceSystemPolicyDesktopFolder: 'files',
  kTCCServiceSystemPolicyDocumentsFolder: 'files',
  kTCCServiceSystemPolicyDownloadsFolder: 'files',
  kTCCServiceSystemPolicyRemovableVolumes: 'files',
  kTCCServiceSystemPolicyNetworkVolumes: 'files',
  kTCCServiceAccessibility: 'accessibility',
  kTCCServiceListenEvent: 'input',
  kTCCServicePostEvent: 'input',
  kTCCServiceAppleEvents: 'automation',
  kTCCServiceBluetoothAlways: 'bluetooth',
};

/**
 * Rows from `sqlite3 -separator '|' TCC.db "select service, client, client_type, auth_value, last_modified from access"`.
 * auth_value: 0 denied, 1 unknown, 2 allowed, 3 limited. last_modified is seconds since 1970.
 */
export function parseTcc(text: string): PermissionGrant[] {
  const out: PermissionGrant[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [service, client, , auth, modified] = line.split('|');
    if (!service || !client || !service.startsWith('kTCCService')) continue;
    const a = Number(auth);
    out.push({
      app: client,
      path: client.startsWith('/') ? client : undefined,
      service: TCC[service] ?? 'other',
      raw: service,
      allowed: a === 2 || a === 3,
      lastUsed: Number(modified) > 0 ? Number(modified) * 1000 : undefined,
      source: 'tcc',
    });
  }
  return out;
}

/** What a TCC service is called in System Settings → Privacy & Security, to open the right pane. */
export function macSettingsPane(service: PrivacyService): string {
  const anchor: Partial<Record<PrivacyService, string>> = {
    camera: 'Privacy_Camera', microphone: 'Privacy_Microphone', screen: 'Privacy_ScreenCapture', location: 'Privacy_LocationServices',
    contacts: 'Privacy_Contacts', calendars: 'Privacy_Calendars', reminders: 'Privacy_Reminders', photos: 'Privacy_Photos',
    files: 'Privacy_AllFiles', accessibility: 'Privacy_Accessibility', input: 'Privacy_ListenEvent', automation: 'Privacy_Automation', bluetooth: 'Privacy_Bluetooth',
  };
  return `x-apple.systempreferences:com.apple.preference.security?${anchor[service] ?? 'Privacy'}`;
}

/** tccutil can only reset (forget) a grant, which makes the app ask again; it needs the bundle id. */
export function tccutilArgs(service: string, bundleId: string): string[] | null {
  if (!/^kTCCService[A-Za-z]+$/.test(service) || !/^[A-Za-z0-9.-]+$/.test(bundleId)) return null;
  return ['reset', service.replace(/^kTCCService/, ''), bundleId];
}

// ---------------------------------------------------------------- Windows ConsentStore

const CAPABILITY: Record<string, PrivacyService> = {
  webcam: 'camera', microphone: 'microphone', location: 'location', contacts: 'contacts', appointments: 'calendars',
  picturesLibrary: 'photos', documentsLibrary: 'files', broadFileSystemAccess: 'files', bluetooth: 'bluetooth', bluetoothSync: 'bluetooth',
  userNotificationListener: 'notifications', graphicsCaptureProgrammatic: 'screen', graphicsCaptureWithoutBorder: 'screen', radios: 'bluetooth',
};

/** Windows FILETIME (100 ns since 1601) as ms since 1970. */
export function fileTimeToMs(v: bigint | number): number {
  const n = typeof v === 'bigint' ? v : BigInt(Math.round(v));
  if (n <= 0n) return 0;
  return Number(n / 10_000n - 11_644_473_600_000n);
}

/**
 * Output of `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore /s`.
 * Keys look like ...\ConsentStore\webcam\NonPackaged\C:#Program Files#Zoom#bin#Zoom.exe
 * (desktop apps, path with # for \) or ...\ConsentStore\webcam\Microsoft.WindowsCamera_8wekyb3d8bbwe (Store apps).
 */
export function parseConsentStoreGrants(text: string): PermissionGrant[] {
  const byKey = new Map<string, { cap: string; app: string; path?: string; value?: string; start?: number; stop?: number }>();
  let cur: { cap: string; app: string; path?: string; value?: string; start?: number; stop?: number } | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const key = line.match(/\\ConsentStore\\([^\\]+)(?:\\(NonPackaged))?(?:\\(.+))?$/i);
    if (/^HKEY_/i.test(line) && key) {
      const [, cap, nonPackaged, rest] = key;
      if (!rest || (nonPackaged === undefined && rest.includes('\\'))) { cur = undefined; continue; }
      const app = nonPackaged ? rest.replace(/#/g, '\\') : rest;
      cur = { cap, app, path: nonPackaged ? app : undefined };
      byKey.set(line, cur);
      continue;
    }
    if (!cur) continue;
    const v = line.trim().match(/^(\w+)\s+REG_\w+\s+(.+)$/);
    if (!v) continue;
    if (v[1] === 'Value') cur.value = v[2].trim();
    else if (v[1] === 'LastUsedTimeStart') cur.start = fileTimeToMs(BigInt(v[2].trim()));
    else if (v[1] === 'LastUsedTimeStop') cur.stop = fileTimeToMs(BigInt(v[2].trim()));
  }
  const out: PermissionGrant[] = [];
  for (const g of byKey.values()) {
    const name = g.path ? g.path.split('\\').pop()!.replace(/\.exe$/i, '') : g.app.replace(/_[a-z0-9]{13}$/, '');
    out.push({
      app: name,
      path: g.path,
      service: CAPABILITY[g.cap] ?? 'other',
      raw: g.cap,
      allowed: g.value ? /^allow$/i.test(g.value) : true,
      lastUsed: Math.max(g.start ?? 0, g.stop ?? 0) || undefined,
      inUse: (g.start ?? 0) > 0 && g.stop === 0,
      source: 'consent-store',
    });
  }
  return out;
}

// ---------------------------------------------------------------- Linux Flatpak & PipeWire

/** `flatpak permissions` (Table Object App Permissions Data, tab or space separated). */
export function parseFlatpakPermissions(text: string): PermissionGrant[] {
  const out: PermissionGrant[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(/\t+|\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cols.length < 4 || /^Table$/i.test(cols[0])) continue;
    const [table, object, app, perms] = cols;
    if (!/^[\w.-]+\.[\w.-]+$/.test(app)) continue;
    const service: PrivacyService =
      table === 'devices' && object === 'camera' ? 'camera'
        : table === 'devices' && /speakers|microphone/.test(object) ? 'microphone'
          : table === 'location' ? 'location'
            : table === 'screenshot' || table === 'screencast' ? 'screen'
              : table === 'notifications' ? 'notifications'
                : table === 'background' ? 'other'
                  : 'other';
    out.push({ app, service, raw: `${table}/${object}`, allowed: /yes|EXACT|NEIGHBORHOOD|CITY|COUNTRY|always/i.test(perms) && !/^no$/i.test(perms), source: 'flatpak' });
  }
  return out;
}

/** `flatpak info --show-permissions <app>`: broad static rights (devices=all reaches every camera; filesystems=home/host reaches your files). */
export function parseFlatpakStatic(app: string, text: string): PermissionGrant[] {
  const out: PermissionGrant[] = [];
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.split(';').filter(Boolean) ?? [];
  const devices = get('devices');
  const fs = get('filesystems');
  const sockets = get('sockets');
  if (devices.includes('all')) out.push({ app, service: 'camera', raw: 'devices=all', allowed: true, source: 'flatpak' });
  if (sockets.includes('pulseaudio')) out.push({ app, service: 'microphone', raw: 'sockets=pulseaudio', allowed: true, source: 'flatpak' });
  if (fs.some((f) => /^(host|home)(:rw)?$/.test(f))) out.push({ app, service: 'files', raw: `filesystems=${fs.join(';')}`, allowed: true, source: 'flatpak' });
  if (sockets.includes('x11') && !sockets.includes('wayland')) out.push({ app, service: 'input', raw: 'sockets=x11', allowed: true, source: 'flatpak' });
  return out;
}

/** `pw-dump` JSON: capture streams that are running right now (who is using the camera or microphone). */
export function parsePwDump(json: string): PermissionGrant[] {
  let nodes: { type?: string; info?: { state?: string; props?: Record<string, unknown> } }[] = [];
  try {
    nodes = JSON.parse(json);
  } catch {
    return [];
  }
  const out: PermissionGrant[] = [];
  for (const n of nodes) {
    const p = n.info?.props ?? {};
    const cls = String(p['media.class'] ?? '');
    if (n.type !== 'PipeWire:Interface:Node' || !/^Stream\/Input\/(Audio|Video)$/.test(cls)) continue;
    const app = String(p['application.name'] ?? p['application.process.binary'] ?? p['node.name'] ?? 'Unknown');
    out.push({ app, service: cls.endsWith('Video') ? 'camera' : 'microphone', raw: cls, allowed: true, inUse: n.info?.state === 'running', lastUsed: Date.now(), source: 'pipewire' });
  }
  return out;
}

// ---------------------------------------------------------------- summary

export const SERVICE_LABEL: Record<PrivacyService, string> = {
  camera: 'Camera', microphone: 'Microphone', screen: 'Screen recording', location: 'Location', contacts: 'Contacts', calendars: 'Calendars',
  reminders: 'Reminders', photos: 'Photos', files: 'Files and folders', accessibility: 'Control of your computer (Accessibility)',
  input: 'Keyboard and mouse monitoring', automation: 'Control of other apps', bluetooth: 'Bluetooth', notifications: 'Notifications', other: 'Other',
};

/** The rights that let an app see or hear you, or act as you: shown first. */
export const SENSITIVE: PrivacyService[] = ['camera', 'microphone', 'screen', 'input', 'accessibility', 'files', 'location'];

/** Groups grants by service, allowed apps first, most recently used first. */
export function byService(grants: PermissionGrant[]): { service: PrivacyService; label: string; allowed: PermissionGrant[]; denied: PermissionGrant[] }[] {
  const map = new Map<PrivacyService, PermissionGrant[]>();
  for (const g of grants) (map.get(g.service) ?? map.set(g.service, []).get(g.service)!).push(g);
  const order = [...SENSITIVE, ...(Object.keys(SERVICE_LABEL) as PrivacyService[]).filter((s) => !SENSITIVE.includes(s))];
  return order.filter((s) => map.has(s)).map((s) => {
    const list = map.get(s)!.sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
    return { service: s, label: SERVICE_LABEL[s], allowed: list.filter((g) => g.allowed), denied: list.filter((g) => !g.allowed) };
  });
}
