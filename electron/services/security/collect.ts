// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Gathering what the Privacy & Security page shows, from the system itself:
// app permissions, browsers and their extensions, posture checks and the
// places programs register to start automatically. Each reader fails soft: a
// missing tool or permission becomes "not available here", never an error.

import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { powershell, run } from '../../../core/platform';
import { BROWSERS, chromiumExtension, firefoxDoh, parseChromiumLocalState, parseChromiumPreferences, parseFirefoxExtensions, parseFirefoxProfilesIni, type KnownBad } from '../../../core/security/browsers';
import { persistenceCommand, persistenceLocations } from '../../../core/security/heuristics';
import { parseConsentStoreGrants, parseFlatpakPermissions, parseFlatpakStatic, parsePwDump, parseTcc } from '../../../core/security/permissions';
import { linuxPosture, macAddedRoots, macAnalytics, macAutoLogin, macKexts, macScreenLock, macSharing, macWifi, windowsPosture, type LinuxPosture, type WinPosture } from '../../../core/security/posture';
import type { BrowserProfile, Finding, PermissionGrant, PersistenceItem } from '../../../core/security/types';

const home = () => os.homedir();
const read = (p: string) => fsp.readFile(p, 'utf8').catch(() => undefined);

// ---------------------------------------------------------------- permissions

export interface PermissionsResult {
  grants: PermissionGrant[];
  /** why some of it could not be read (e.g. macOS needs Full Disk Access for the system list) */
  notes: string[];
}

export async function readPermissions(): Promise<PermissionsResult> {
  const notes: string[] = [];
  const grants: PermissionGrant[] = [];
  if (process.platform === 'darwin') {
    const q = 'select service, client, client_type, auth_value, last_modified from access';
    for (const db of [path.join(home(), 'Library/Application Support/com.apple.TCC/TCC.db'), '/Library/Application Support/com.apple.TCC/TCC.db']) {
      const r = await run('/usr/bin/sqlite3', ['-readonly', '-separator', '|', db, q], 10_000);
      if (r.ok) grants.push(...parseTcc(r.stdout));
      else if (/authorization denied|unable to open/i.test(r.stderr)) notes.push(db.startsWith('/Library') ? 'The system-wide list (screen recording, full disk access, accessibility) needs Full Disk Access for Keeper. Grant it in System Settings → Privacy & Security → Full Disk Access to see everything.' : 'Your own permissions list could not be read.');
    }
  } else if (process.platform === 'win32') {
    for (const hive of ['HKCU', 'HKLM']) {
      const r = await run('reg.exe', ['query', `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore`, '/s'], 20_000);
      if (r.ok) grants.push(...parseConsentStoreGrants(r.stdout));
    }
  } else {
    const fp = await run('flatpak', ['permissions'], 10_000);
    if (fp.ok) grants.push(...parseFlatpakPermissions(fp.stdout));
    const apps = await run('flatpak', ['list', '--app', '--columns=application'], 10_000);
    if (apps.ok) {
      for (const app of apps.stdout.split('\n').map((s) => s.trim()).filter((s) => /^[\w.-]+\.[\w.-]+$/.test(s)).slice(0, 80)) {
        const info = await run('flatpak', ['info', '--show-permissions', app], 8_000);
        if (info.ok) grants.push(...parseFlatpakStatic(app, info.stdout));
      }
    }
    const pw = await run('pw-dump', [], 8_000);
    if (pw.ok) grants.push(...parsePwDump(pw.stdout));
    if (!fp.ok && !pw.ok) notes.push('Apps installed from your distribution’s packages are not sandboxed and can reach the camera, microphone and your files. Flatpak and Snap apps have their own permissions, listed here when present.');
  }
  return { grants, notes };
}

// ---------------------------------------------------------------- browsers

async function chromiumProfiles(name: string, root: string, known: KnownBad): Promise<BrowserProfile[]> {
  const ls = await read(path.join(root, 'Local State'));
  if (ls === undefined) return [];
  const { profiles, doh } = parseChromiumLocalState(ls);
  const out: BrowserProfile[] = [];
  for (const p of profiles.slice(0, 20)) {
    const dir = path.join(root, p.dir);
    if (!existsSync(dir)) continue;
    const prefs = parseChromiumPreferences((await read(path.join(dir, 'Secure Preferences'))) ?? '{}');
    const prefs2 = parseChromiumPreferences((await read(path.join(dir, 'Preferences'))) ?? '{}');
    const settings = { ...prefs2.settings, ...prefs.settings };
    const extensions: BrowserProfile['extensions'] = [];
    const extDir = path.join(dir, 'Extensions');
    for (const id of await fsp.readdir(extDir).catch(() => [] as string[])) {
      if (!/^[a-p]{32}$/.test(id)) continue;
      const versions = await fsp.readdir(path.join(extDir, id)).catch(() => [] as string[]);
      const v = versions.sort().pop();
      const manifest = v ? await read(path.join(extDir, id, v, 'manifest.json')) : undefined;
      const e = chromiumExtension(id, manifest, settings[id], known);
      if (e) extensions.push(e);
    }
    const login = await fsp.stat(path.join(dir, 'Login Data')).catch(() => undefined);
    out.push({ browser: name, engine: 'chromium', profile: p.name, path: dir, extensions, savedPasswords: !!login && login.size > 40_960, signedInSync: prefs2.signedIn || prefs.signedIn, doh });
  }
  return out;
}

async function firefoxProfiles(root: string, known: KnownBad): Promise<BrowserProfile[]> {
  const ini = await read(path.join(root, 'profiles.ini'));
  if (ini === undefined) return [];
  const out: BrowserProfile[] = [];
  for (const p of parseFirefoxProfilesIni(ini).slice(0, 20)) {
    const dir = p.relative ? path.join(root, p.path) : p.path;
    if (!existsSync(dir)) continue;
    const extensions = parseFirefoxExtensions((await read(path.join(dir, 'extensions.json'))) ?? '{}', known);
    const logins = await fsp.stat(path.join(dir, 'logins.json')).catch(() => undefined);
    const prefs = (await read(path.join(dir, 'prefs.js'))) ?? '';
    out.push({ browser: 'Firefox', engine: 'firefox', profile: p.name, path: dir, extensions, savedPasswords: !!logins && logins.size > 200, signedInSync: /services\.sync\.username/.test(prefs), doh: firefoxDoh(prefs) });
  }
  return out;
}

export async function readBrowsers(known: KnownBad = {}): Promise<BrowserProfile[]> {
  const out: BrowserProfile[] = [];
  for (const b of BROWSERS) {
    const root = b.root(home(), process.platform, process.env);
    if (!root || !existsSync(root)) continue;
    try {
      if (b.engine === 'chromium') out.push(...(await chromiumProfiles(b.name, root, known)));
      else if (b.engine === 'firefox') out.push(...(await firefoxProfiles(root, known)));
      else out.push({ browser: b.name, engine: 'webkit', profile: 'Default', path: root, extensions: [], savedPasswords: false });
    } catch {
      /* a profile Keeper cannot read is skipped */
    }
  }
  return out;
}

// ---------------------------------------------------------------- posture

export async function readPosture(): Promise<Finding[]> {
  if (process.platform === 'darwin') {
    const [auto, lock, launch, wifi, roots, kexts, analytics] = await Promise.all([
      run('/usr/bin/defaults', ['read', '/Library/Preferences/com.apple.loginwindow', 'autoLoginUser']),
      run('/usr/sbin/sysadminctl', ['-screenLock', 'status']),
      run('/bin/launchctl', ['list']),
      run('/usr/sbin/system_profiler', ['SPAirPortDataType', '-json'], 20_000),
      run('/usr/bin/security', ['find-certificate', '-a', '/Library/Keychains/System.keychain']),
      run('/usr/bin/kmutil', ['showloaded', '--list-only'], 20_000),
      run('/usr/bin/defaults', ['read', '/Library/Application Support/CrashReporter/DiagnosticMessagesHistory.plist', 'AutoSubmit']),
    ]);
    return [...macAutoLogin(auto.stdout, auto.ok), ...macScreenLock(`${lock.stdout}\n${lock.stderr}`), ...macSharing(launch.stdout), ...macWifi(wifi.stdout), ...macAddedRoots(roots.stdout), ...macKexts(kexts.stdout), ...macAnalytics(analytics.ok ? analytics.stdout : '')];
  }
  if (process.platform === 'win32') {
    const r = await powershell(`$o=@{}
try { $o.autoLogon=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -ErrorAction Stop).AutoAdminLogon } catch {}
try { $o.rdp=(Get-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -ErrorAction Stop).fDenyTSConnections } catch {}
try { $o.admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or ((whoami /groups) -match 'S-1-5-32-544') } catch {}
try { $o.telemetry=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\DataCollection' -ErrorAction Stop).AllowTelemetry } catch {}
try { $o.screenSaverSecure=(Get-ItemProperty 'HKCU:\\Control Panel\\Desktop' -ErrorAction Stop).ScreenSaverIsSecure } catch {}
try { $o.inactivity=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -ErrorAction Stop).InactivityTimeoutSecs } catch {}
try { $o.shares=@(Get-SmbShare -ErrorAction Stop | ForEach-Object { $_.Name }) } catch {}
try { $w=netsh wlan show interfaces; $o.wifiAuth=(($w | Select-String '^\\s*Authentication\\s*:\\s*(.+)$').Matches | Select-Object -First 1).Groups[1].Value; $o.wifiName=(($w | Select-String '^\\s*SSID\\s*:\\s*(.+)$').Matches | Select-Object -First 1).Groups[1].Value } catch {}
try { $o.recentRoots=@(Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.NotBefore -gt (Get-Date).AddDays(-120) } | ForEach-Object { $_.Subject }) } catch {}
$o | ConvertTo-Json -Compress`, 45_000);
    let o: WinPosture = {};
    try {
      o = JSON.parse(r.stdout || '{}');
    } catch {
      /* nothing readable */
    }
    return windowsPosture(o);
  }
  const [ssh, sshd, smb, vnc, xrdp, groups, lock, whoopsie, apport, wifi, tainted] = await Promise.all([
    run('systemctl', ['is-active', 'ssh']), run('systemctl', ['is-active', 'sshd']), run('systemctl', ['is-active', 'smbd']),
    run('systemctl', ['is-active', 'x11vnc']), run('systemctl', ['is-active', 'xrdp']), run('id', ['-Gn']),
    run('gsettings', ['get', 'org.gnome.desktop.screensaver', 'lock-enabled']), run('systemctl', ['is-active', 'whoopsie']), run('systemctl', ['is-active', 'apport']),
    run('nmcli', ['-t', '-f', 'ACTIVE,SSID,SECURITY', 'dev', 'wifi']), read('/proc/sys/kernel/tainted'),
  ]);
  const gdm = (await read('/etc/gdm3/custom.conf')) ?? (await read('/etc/gdm/custom.conf')) ?? '';
  const lightdm = (await read('/etc/lightdm/lightdm.conf')) ?? '';
  const active = wifi.ok ? wifi.stdout.split('\n').find((l) => l.startsWith('yes:')) : undefined;
  const localCerts = await fsp.readdir('/usr/local/share/ca-certificates').catch(() => [] as string[]);
  const o: LinuxPosture = {
    sshActive: /^active/.test(ssh.stdout) || /^active/.test(sshd.stdout),
    sambaActive: /^active/.test(smb.stdout),
    vncOrRdp: /^active/.test(vnc.stdout) || /^active/.test(xrdp.stdout),
    autologin: /^\s*AutomaticLoginEnable\s*=\s*true/im.test(gdm) || /^\s*autologin-user\s*=\s*\S+/m.test(lightdm),
    groups: groups.stdout,
    lockEnabled: lock.ok ? lock.stdout : undefined,
    crashReports: /^active/.test(whoopsie.stdout) || /^active/.test(apport.stdout),
    wifi: active ? { ssid: active.split(':')[1] ?? '', security: active.split(':').slice(2).join(':') } : undefined,
    localCerts: localCerts.filter((n) => /\.(crt|pem)$/.test(n)),
    tainted: tainted ? Number(tainted.trim()) : undefined,
  };
  return linuxPosture(o);
}

// ---------------------------------------------------------------- persistence

/** Every place programs register to start automatically, with what each runs. */
export async function readPersistence(): Promise<Omit<PersistenceItem, 'firstSeen'>[]> {
  const out: Omit<PersistenceItem, 'firstSeen'>[] = [];
  for (const loc of persistenceLocations(process.platform, home())) {
    for (const name of await fsp.readdir(loc.dir).catch(() => [] as string[])) {
      if (name.startsWith('.') || /\.(wants|requires|d)$/.test(name)) continue;
      const full = path.join(loc.dir, name);
      const st = await fsp.lstat(full).catch(() => undefined);
      if (!st || st.isDirectory()) continue;
      // Default systemd units shipped by packages are symlinks into /usr/lib; only real files are local changes.
      if (loc.kind === 'systemd-system' && st.isSymbolicLink()) continue;
      const text = st.size < 256 * 1024 ? (await read(full)) ?? '' : '';
      out.push({ id: `${loc.kind}:${full}`, kind: loc.kind, name, command: persistenceCommand(name, text), location: full });
    }
  }
  if (process.platform === 'win32') {
    const r = await powershell(`$o=@()
foreach ($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce') { try { $p=Get-ItemProperty $k -ErrorAction Stop; $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $o+=@{k='run-key';n=$_.Name;c=[string]$_.Value;l=$k} } } catch {} }
try { Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' -and $_.State -ne 'Disabled' } | ForEach-Object { $o+=@{k='scheduled-task';n=$_.TaskName;c=(($_.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join '; ');l=$_.TaskPath} } } catch {}
$o | ConvertTo-Json -Compress`, 45_000);
    try {
      const rows = JSON.parse(r.stdout || '[]');
      for (const x of Array.isArray(rows) ? rows : [rows]) if (x?.n) out.push({ id: `${x.k}:${x.l}\\${x.n}`, kind: x.k, name: x.n, command: x.c, location: x.l });
    } catch {
      /* none readable */
    }
  } else if (process.platform !== 'darwin') {
    const cron = await run('crontab', ['-l']);
    if (cron.ok) for (const line of cron.stdout.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))) out.push({ id: `cron:${line.trim()}`, kind: 'cron', name: line.trim().split(/\s+/).slice(5).join(' ').slice(0, 60) || 'cron job', command: line.trim(), location: 'crontab' });
  }
  return out;
}

/** Who signed a program (macOS codesign / Windows Authenticode); undefined when unknown. */
export async function signerOf(file: string): Promise<{ signed: boolean; signer?: string } | undefined> {
  if (!file || !existsSync(file)) return undefined;
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/codesign', ['-dv', '--verbose=2', file], 10_000);
    if (/not signed/i.test(r.stderr)) return { signed: false };
    const auth = r.stderr.match(/^Authority=(.+)$/m)?.[1];
    return { signed: r.ok, signer: auth };
  }
  if (process.platform === 'win32') {
    const r = await powershell(`$s=Get-AuthenticodeSignature -LiteralPath '${file.replace(/['‘’‚‛]/g, '$&$&')}'; @{status=[string]$s.Status;signer=[string]$s.SignerCertificate.Subject} | ConvertTo-Json -Compress`, 15_000);
    try {
      const o = JSON.parse(r.stdout);
      return { signed: o.status === 'Valid', signer: o.signer?.match(/CN=([^,]+)/)?.[1] };
    } catch {
      return undefined;
    }
  }
  return undefined;
}
