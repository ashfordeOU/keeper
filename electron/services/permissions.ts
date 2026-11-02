// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reads and asks for the system permissions Keeper's features use (the
// catalogue is core/permissions.ts). The Permissions screen asks for the list
// about once a second while it is open, and on window focus; nothing here runs
// on its own.
//
//   macOS    a short-lived keeper-helper answers `permissions.status` (a fresh
//            process sees a permission granted since Keeper started, which is
//            how "restart needed" is told apart), plus Electron's own media and
//            Accessibility checks, a Full Disk Access probe and the login item
//   Windows  the CapabilityAccessManager ConsentStore and the notification switch
//   Linux    the desktop portals on D-Bus, the input group and the AT-SPI bus
//
// Features that need a permission mid-task call permissionNeeded()
// (./permission-nudge.ts): the open windows point to the right row.

import { app, Notification, shell, systemPreferences } from 'electron';
import dgram from 'node:dgram';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { featureDef, featureStates } from '../../core/features';
import { buildReport, catalogueFor, inInputGroup, portalsFrom, rawFromConsent, rawFromMac, regValue, type PermissionsReport, type PermPlatform, type RawPermission } from '../../core/permissions';
import { run } from '../../core/platform';
import { markCleanExit } from '../resilience';
import { settings } from '../store';
import { HelperClient } from './platform/helper-client';
import { helperPath } from './platform/mac';

const PLATFORM = (['darwin', 'win32', 'linux'].includes(process.platform) ? process.platform : 'linux') as PermPlatform;

// ---------------------------------------------------------------- macOS

/** One question to a fresh keeper-helper (TCC answers are cached per process, so a new one sees changes). */
async function helperOnce<T>(method: string, params: unknown = {}, timeoutMs = 8000): Promise<T | null> {
  const p = helperPath();
  if (!p) return null;
  const c = new HelperClient(p, [], 0);
  try {
    return await c.call<T>(method, params, { timeoutMs });
  } catch {
    return null;
  } finally {
    c.stop();
  }
}

async function fullDiskAccess(): Promise<RawPermission> {
  // Folders only readable with Full Disk Access; one that exists and opens says yes.
  const home = os.homedir();
  const probes = ['Library/Safari', 'Library/Mail', 'Library/Application Support/com.apple.TCC/TCC.db', 'Library/Messages'];
  let seen = false;
  for (const rel of probes) {
    const p = path.join(home, rel);
    try {
      const st = await fsp.stat(p);
      seen = true;
      if (st.isDirectory()) await fsp.readdir(p);
      else (await fsp.open(p, 'r')).close();
      return 'authorized';
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM' || (e as NodeJS.ErrnoException).code === 'EACCES') return seen ? 'denied' : 'notDetermined';
    }
  }
  return seen ? 'notDetermined' : 'unknown';
}

/** Which permissions that need a restart were missing when Keeper started. */
let startMissing: Set<string> | null = null;
let lastLocalNetwork: RawPermission = 'unknown';

async function macRaw(): Promise<{ raw: Record<string, RawPermission>; helper: boolean }> {
  const h = await helperOnce<Record<string, string>>('permissions.status');
  const raw: Record<string, RawPermission> = {};
  for (const [k, v] of Object.entries(h ?? {})) raw[k] = rawFromMac(v);
  const media = (t: 'microphone' | 'camera' | 'screen') => { try { return rawFromMac(systemPreferences.getMediaAccessStatus(t).replace('not-determined', 'notDetermined')); } catch { return 'unknown' as RawPermission; } };
  raw.microphone = media('microphone');
  raw.camera = media('camera');
  raw.screen ??= media('screen');
  raw.accessibility ??= systemPreferences.isTrustedAccessibilityClient(false) ? 'authorized' : 'notDetermined';
  raw.fullDisk = await fullDiskAccess();
  raw.loginItem = app.getLoginItemSettings().openAtLogin ? 'authorized' : 'notDetermined';
  raw.localNetwork = lastLocalNetwork;
  return { raw, helper: !!h };
}

// ---------------------------------------------------------------- Windows

const CONSENT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore';

async function consent(cap: string): Promise<RawPermission> {
  const q = async (key: string) => regValue((await run('reg', ['query', key, '/v', 'Value'], 5000).catch(() => ({ stdout: '' }))).stdout, 'Value');
  const machine = await q(`HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\${cap}`);
  if (machine === 'Deny') return 'restricted';
  return rawFromConsent(await q(`${CONSENT}\\${cap}`), await q(`${CONSENT}\\${cap}\\NonPackaged`));
}

async function winRaw(): Promise<Record<string, RawPermission>> {
  const [microphone, camera, location] = await Promise.all([consent('microphone'), consent('webcam'), consent('location')]);
  const toast = regValue((await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', '/v', 'ToastEnabled'], 5000).catch(() => ({ stdout: '' }))).stdout, 'ToastEnabled');
  return { microphone, camera, location, notifications: toast === '0x0' ? 'denied' : 'authorized' };
}

// ---------------------------------------------------------------- Linux

let linuxCache: { at: number; raw: Record<string, RawPermission>; details: Record<string, string> } | null = null;

async function linuxRaw(): Promise<{ raw: Record<string, RawPermission>; details: Record<string, string> }> {
  // Portals and groups change rarely: read them at most every 5 seconds.
  if (linuxCache && Date.now() - linuxCache.at < 5000) return linuxCache;
  const raw: Record<string, RawPermission> = {};
  const details: Record<string, string> = {};
  const intro = await run('gdbus', ['introspect', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop'], 4000).catch(() => ({ ok: false, stdout: '' }));
  const portals = portalsFrom(intro.stdout);
  for (const [id, iface] of [['portal.screencast', 'ScreenCast'], ['portal.remotedesktop', 'RemoteDesktop'], ['portal.location', 'Location'], ['portal.camera', 'Camera']] as const) {
    if (!intro.ok) { raw[id] = 'unavailable'; details[id] = 'No desktop portal is running (xdg-desktop-portal). Keeper uses X11 tools instead where it can.'; continue; }
    raw[id] = portals.has(iface) ? 'unknown' : 'unavailable';
    details[id] = portals.has(iface) ? 'Your desktop asks when Keeper first uses it. Press Test to see the question now.' : `This desktop’s portal has no ${iface}.`;
  }
  const groups = await run('id', ['-nG'], 3000).catch(() => ({ stdout: '' }));
  raw.inputGroup = inInputGroup(groups.stdout) ? 'authorized' : 'notDetermined';
  if (raw.inputGroup !== 'authorized') details.inputGroup = 'Not in the input group. On X11 Keeper does not need it.';
  const a11y = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.a11y.Bus'], 3000).catch(() => ({ ok: false, stdout: '' }));
  raw.atspi = /true/.test(a11y.stdout) ? 'authorized' : a11y.ok ? 'notDetermined' : 'unknown';
  if (raw.atspi !== 'authorized') details.atspi = a11y.ok ? 'The accessibility bus is not running.' : 'Could not ask D-Bus.';
  linuxCache = { at: Date.now(), raw, details };
  return linuxCache;
}

// ---------------------------------------------------------------- the list

function featuresOn(): Set<string> {
  const st = featureStates(settings(), PLATFORM);
  const login = (() => { try { return app.getLoginItemSettings().openAtLogin; } catch { return false; } })();
  const on = new Set([...st.values()].filter((f) => f.on).map((f) => f.id));
  if (login) on.add('login');
  return on;
}

export async function listPermissions(): Promise<PermissionsReport> {
  let raw: Record<string, RawPermission> = {};
  let details: Record<string, string> = {};
  let helper = true;
  if (PLATFORM === 'darwin') ({ raw, helper } = await macRaw());
  else if (PLATFORM === 'win32') raw = await winRaw();
  else ({ raw, details } = await linuxRaw());
  if (PLATFORM === 'darwin' && !helper) {
    for (const id of ['input', 'calendars', 'reminders', 'location', 'notifications', 'automation.systemevents', 'automation.finder', 'automation.music', 'automation.notes']) if (!raw[id]) details[id] = 'Keeper’s macOS helper is not in this build, so this cannot be checked; Allow opens the settings page.';
  }
  // Restart-only permissions: allowed now but missing when Keeper started.
  const restartIds = catalogueFor(PLATFORM).filter((d) => d.restart).map((d) => d.id);
  if (!startMissing) startMissing = new Set(restartIds.filter((id) => raw[id] !== 'authorized'));
  const restartPending = new Set([...startMissing].filter((id) => raw[id] === 'authorized'));
  return buildReport(PLATFORM, raw, featuresOn(), (id) => featureDef(id)?.name ?? id, { helper, restartPending, details });
}

// ---------------------------------------------------------------- asking

async function openUrl(url: string): Promise<boolean> {
  // Tests: write what would open instead of opening it.
  const stub = process.env.KEEPER_PERMISSIONS_OPEN_STUB;
  if (stub) { await fsp.appendFile(stub, JSON.stringify({ url }) + '\n'); return true; }
  try { await shell.openExternal(url); return true; } catch { return false; }
}

export async function openPermissionSettings(id: string): Promise<boolean> {
  const def = catalogueFor(PLATFORM).find((d) => d.id === id);
  return def?.settingsUrl ? openUrl(def.settingsUrl) : false;
}

const AUTOMATION_APPS: Record<string, string> = {
  'automation.systemevents': 'com.apple.systemevents', 'automation.finder': 'com.apple.finder', 'automation.music': 'com.apple.Music', 'automation.notes': 'com.apple.Notes',
};

/** Sends one mDNS question: on macOS 15 and later that is what makes macOS ask about the local network. */
function pokeLocalNetwork(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    // A PTR question for _services._dns-sd._udp.local
    const q = Buffer.from('000000000001000000000000095f7365727669636573075f646e732d7364045f756470056c6f63616c00000c0001', 'hex');
    const done = (ok: boolean, message: string) => { try { s.close(); } catch { /* closed */ } resolve({ ok, message }); };
    s.on('error', (e) => { lastLocalNetwork = /EHOSTUNREACH|ENETUNREACH|EPERM|EACCES/.test(String((e as NodeJS.ErrnoException).code)) ? 'denied' : lastLocalNetwork; done(false, `The network said no (${(e as NodeJS.ErrnoException).code ?? e.message}). If you turned Local Network off for Keeper, switch it back on in System Settings.`); });
    s.send(q, 5353, '224.0.0.251', (err) => {
      if (err) { lastLocalNetwork = /EHOSTUNREACH|ENETUNREACH|EPERM/.test(String((err as NodeJS.ErrnoException).code)) ? 'denied' : 'unknown'; done(false, `Could not reach the local network (${(err as NodeJS.ErrnoException).code ?? err.message}).`); return; }
      setTimeout(() => done(true, 'Keeper looked for devices on the network. If macOS asked, your answer is kept; it cannot be read back, so this row stays “Can’t be checked”.'), 600);
    });
  });
}

export async function testPermission(id: string): Promise<{ ok: boolean; message: string }> {
  if (id === 'localNetwork') return pokeLocalNetwork();
  if (PLATFORM === 'linux') {
    linuxCache = null;
    if (id === 'portal.screencast' || id === 'portal.remotedesktop') {
      // Opening a portal session shows the desktop's own question; the capture code does the real work.
      const iface = id === 'portal.screencast' ? 'ScreenCast' : 'RemoteDesktop';
      const r = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop', '--method', `org.freedesktop.portal.${iface}.CreateSession`, `{'session_handle_token': <'keepertest${Date.now()}'>, 'handle_token': <'keeper${Date.now()}'>}`], 8000).catch((e) => ({ ok: false, stdout: '', stderr: String(e) }));
      return r.ok ? { ok: true, message: `The ${iface} portal answered. The desktop asks you the first time Keeper shares or controls the screen.` } : { ok: false, message: `The ${iface} portal did not answer: ${(r.stderr || 'not available').split('\n')[0]}` };
    }
    if (id === 'portal.camera') {
      const r = await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop', '--method', 'org.freedesktop.DBus.Properties.Get', 'org.freedesktop.portal.Camera', 'IsCameraPresent'], 4000).catch(() => ({ ok: false, stdout: '' }));
      return r.ok ? { ok: true, message: /true/.test(r.stdout) ? 'A camera is present; the desktop asks the first time the mirror opens.' : 'The portal answered, but it sees no camera.' } : { ok: false, message: 'The camera portal did not answer.' };
    }
    if (id === 'portal.location') {
      const r = await run('gdbus', ['introspect', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop'], 4000).catch(() => ({ ok: false, stdout: '' }));
      return portalsFrom(r.stdout).has('Location') ? { ok: true, message: 'The location portal is there; the desktop asks the first time it is used.' } : { ok: false, message: 'This desktop has no location portal.' };
    }
    if (id === 'atspi') {
      const st = await linuxRaw();
      return st.raw.atspi === 'authorized' ? { ok: true, message: 'The accessibility bus is running.' } : { ok: false, message: st.details.atspi ?? 'The accessibility bus is not running.' };
    }
    if (id === 'inputGroup') {
      const st = await linuxRaw();
      return st.raw.inputGroup === 'authorized' ? { ok: true, message: 'You are in the input group.' } : { ok: false, message: 'You are not in the input group yet (log out and in again after adding yourself).' };
    }
  }
  return { ok: false, message: 'Nothing to test for this one.' };
}

export async function requestPermission(id: string): Promise<{ ok: boolean; opened?: 'prompt' | 'settings' | 'test' | 'action'; message?: string }> {
  const def = catalogueFor(PLATFORM).find((d) => d.id === id);
  if (!def) return { ok: false, message: 'Unknown permission' };
  if (process.env.KEEPER_PERMISSIONS_OPEN_STUB) { await fsp.appendFile(process.env.KEEPER_PERMISSIONS_OPEN_STUB, JSON.stringify({ request: id }) + '\n'); return { ok: true, opened: def.how === 'info' ? 'settings' : def.how }; }
  if (def.how === 'test') { const t = await testPermission(id); return { ok: t.ok, opened: 'test', message: t.message }; }
  if (def.how === 'action' && id === 'loginItem') {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    return { ok: app.getLoginItemSettings().openAtLogin, opened: 'action' };
  }
  if (PLATFORM === 'darwin' && def.how === 'prompt') {
    const before = (await listPermissions()).items.find((i) => i.id === id)?.state;
    // Asked once already and turned off: only System Settings can change it now.
    if (before === 'denied') return { ok: await openPermissionSettings(id), opened: 'settings' };
    if (id === 'microphone' || id === 'camera') {
      const ok = await systemPreferences.askForMediaAccess(id).catch(() => false);
      return { ok, opened: 'prompt' };
    }
    if (id === 'accessibility') {
      systemPreferences.isTrustedAccessibilityClient(true);
      return { ok: true, opened: 'prompt' };
    }
    if (id.startsWith('automation.')) {
      // The target must be running for macOS to ask; open it in the background first.
      const bundle = AUTOMATION_APPS[id];
      if (bundle !== 'com.apple.finder') await run('/usr/bin/open', ['-g', '-j', '-b', bundle], 8000).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1200));
    }
    if (id === 'notifications') {
      const r = await helperOnce<Record<string, string>>('permissions.request', { id }, 60_000);
      // Without the helper, showing one notification is what makes macOS ask.
      if (!r && Notification.isSupported()) new Notification({ title: 'Keeper', body: 'Notifications are on: alarms, timers and alerts can reach you.', silent: true }).show();
      return { ok: true, opened: 'prompt' };
    }
    const r = await helperOnce<Record<string, string>>('permissions.request', { id }, id === 'location' ? 70_000 : 60_000);
    // Calendars allowed here: the calendar service reads them now, not at its next look.
    if (r && id === 'calendars') void import('./pim').then((m) => m.systemCalendarsChanged()).catch(() => undefined);
    if (!r) return { ok: await openPermissionSettings(id), opened: 'settings', message: 'Keeper’s macOS helper is not in this build: System Settings is open instead.' };
    return { ok: true, opened: 'prompt' };
  }
  return { ok: await openPermissionSettings(id), opened: 'settings' };
}

export function restartKeeper() {
  // A clean exit, so the windows and tabs come back as they were (not as after a crash).
  markCleanExit();
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--safe-mode' && a !== '--hidden') });
  app.exit(0);
}

export { permissionNeeded } from './permission-nudge';
