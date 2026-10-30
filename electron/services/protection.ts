// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks that the security built into the operating system is switched on.
// Keeper is not an antivirus; it only reports what the OS already has.

import { promises as fsp } from 'node:fs';
import { powershell, run } from '../../core/platform';
import type { ProtectionCheck, ProtectionReport } from '../../core/types';

type Check = Omit<ProtectionCheck, 'weight'> & { weight?: number };

async function mac(): Promise<Check[]> {
  const [gk, fw, sip, fv, au] = await Promise.all([
    run('/usr/sbin/spctl', ['--status']),
    run('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate']),
    run('/usr/bin/csrutil', ['status']),
    run('/usr/bin/fdesetup', ['status']),
    run('/usr/bin/defaults', ['read', '/Library/Preferences/com.apple.SoftwareUpdate', 'CriticalUpdateInstall']),
  ]);
  let xprotect: Check = { id: 'xprotect', name: 'XProtect', description: 'Malware signatures built into macOS.', status: 'unknown' };
  for (const p of ['/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist', '/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist']) {
    try {
      const st = await fsp.stat(p);
      const days = Math.round((Date.now() - st.mtimeMs) / 86_400_000);
      xprotect = { ...xprotect, status: days < 60 ? 'ok' : 'warn', detail: `Definitions updated ${days} day${days === 1 ? '' : 's'} ago` };
      break;
    } catch {
      /* try the next location */
    }
  }
  return [
    { id: 'gatekeeper', name: 'Gatekeeper', description: 'Only lets apps from identified developers open.', status: /enabled/.test(gk.stdout) ? 'ok' : 'off', fix: 'Run “sudo spctl --master-enable” or reset in System Settings → Privacy & Security', weight: 3 },
    xprotect,
    { id: 'sip', name: 'System Integrity Protection', description: 'Stops anything from changing system files.', status: /enabled/.test(sip.stdout) ? 'ok' : sip.ok ? 'off' : 'unknown', fix: 'Turn on from Recovery mode with “csrutil enable”', weight: 3 },
    { id: 'firewall', name: 'Firewall', description: 'Blocks unwanted incoming connections.', status: /enabled|State = [12]/.test(fw.stdout) ? 'ok' : 'off', fix: 'System Settings → Network → Firewall', weight: 2 },
    { id: 'filevault', name: 'FileVault', description: 'Encrypts your disk so a lost Mac does not leak your files.', status: /On/.test(fv.stdout) ? 'ok' : 'off', fix: 'System Settings → Privacy & Security → FileVault', weight: 2 },
    { id: 'updates', name: 'Security updates', description: 'Installs security responses and system data files automatically.', status: au.stdout.trim() === '0' ? 'off' : 'ok', fix: 'System Settings → General → Software Update → Automatic Updates', weight: 2 },
  ];
}

async function windows(): Promise<Check[]> {
  const r = await powershell(`$o=@{}
try { $d=Get-MpComputerStatus; $o.av=$d.AntivirusEnabled; $o.rt=$d.RealTimeProtectionEnabled; $o.sig=$d.AntivirusSignatureLastUpdated.ToString('o') } catch {}
try { $o.fw=@(Get-NetFirewallProfile | Where-Object { $_.Enabled -eq 'True' }).Count; $o.fwt=@(Get-NetFirewallProfile).Count } catch {}
try { $o.uac=(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System).EnableLUA } catch {}
try { $o.ss=(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer -ErrorAction Stop).SmartScreenEnabled } catch {}
try { $o.bl=(Get-CimInstance -Namespace root\\cimv2\\security\\microsoftvolumeencryption -ClassName Win32_EncryptableVolume -Filter "DriveLetter='C:'" -ErrorAction Stop).ProtectionStatus } catch {}
try { $o.wu=(Get-Service wuauserv).StartType.ToString() } catch {}
$o | ConvertTo-Json -Compress`, 45_000);
  let o: Record<string, unknown> = {};
  try { o = JSON.parse(r.stdout || '{}'); } catch { /* keep unknown */ }
  const sigDays = typeof o.sig === 'string' ? Math.round((Date.now() - Date.parse(o.sig)) / 86_400_000) : undefined;
  return [
    { id: 'defender', name: 'Microsoft Defender', description: 'Antivirus built into Windows.', status: o.av === true ? 'ok' : o.av === false ? 'off' : 'unknown', fix: 'Windows Security → Virus & threat protection', weight: 3 },
    { id: 'realtime', name: 'Real-time protection', description: 'Scans files as they are opened or downloaded.', status: o.rt === true ? 'ok' : o.rt === false ? 'off' : 'unknown', fix: 'Windows Security → Virus & threat protection settings', weight: 3 },
    { id: 'signatures', name: 'Virus definitions', description: 'How recently Defender learned about new threats.', status: sigDays === undefined ? 'unknown' : sigDays <= 7 ? 'ok' : 'warn', detail: sigDays !== undefined ? `Updated ${sigDays} day${sigDays === 1 ? '' : 's'} ago` : undefined, fix: 'Windows Security → Protection updates', weight: 2 },
    { id: 'firewall', name: 'Firewall', description: 'Blocks unwanted incoming connections.', status: o.fw === undefined ? 'unknown' : o.fw === o.fwt ? 'ok' : (o.fw as number) > 0 ? 'warn' : 'off', detail: o.fwt ? `${o.fw} of ${o.fwt} network profiles on` : undefined, fix: 'Windows Security → Firewall & network protection', weight: 2 },
    { id: 'uac', name: 'User Account Control', description: 'Asks before apps make system-wide changes.', status: o.uac === 1 ? 'ok' : o.uac === 0 ? 'off' : 'unknown', fix: 'Control Panel → User Accounts → Change User Account Control settings', weight: 2 },
    { id: 'smartscreen', name: 'SmartScreen', description: 'Warns before running unrecognised downloads.', status: o.ss === 'Off' ? 'off' : o.ss ? 'ok' : 'unknown', fix: 'Windows Security → App & browser control', weight: 1 },
    { id: 'bitlocker', name: 'Device encryption', description: 'Encrypts your disk so a lost PC does not leak your files.', status: o.bl === 1 ? 'ok' : o.bl === 0 ? 'off' : 'unknown', detail: o.bl === undefined ? 'Needs administrator rights to check' : undefined, fix: 'Settings → Privacy & security → Device encryption', weight: 2 },
    { id: 'updates', name: 'Windows Update', description: 'Installs security fixes as they come out.', status: o.wu === 'Disabled' ? 'off' : o.wu ? 'ok' : 'unknown', fix: 'Settings → Windows Update', weight: 2 },
  ];
}

async function linux(): Promise<Check[]> {
  const [ufw, fwd, nft, crypt, sb, aa, se, unattended, dnfAuto] = await Promise.all([
    run('ufw', ['status']), run('firewall-cmd', ['--state']), run('nft', ['list', 'ruleset']), run('lsblk', ['-o', 'TYPE', '-n']),
    run('mokutil', ['--sb-state']), run('aa-enabled', []), run('getenforce', []),
    fsp.access('/etc/apt/apt.conf.d/20auto-upgrades').then(() => true, () => false), run('systemctl', ['is-enabled', 'dnf-automatic.timer']),
  ]);
  const firewallOn = /Status: active/.test(ufw.stdout) || /running/.test(fwd.stdout) || /chain .*\{[\s\S]*?(drop|reject)/.test(nft.stdout);
  return [
    { id: 'firewall', name: 'Firewall', description: 'Blocks unwanted incoming connections.', status: firewallOn ? 'ok' : ufw.ok || fwd.ok || nft.ok ? 'off' : 'unknown', fix: 'Run “sudo ufw enable” (or enable firewalld)', weight: 2 },
    { id: 'encryption', name: 'Disk encryption', description: 'Encrypts your disk so a lost computer does not leak your files.', status: /crypt/.test(crypt.stdout) ? 'ok' : crypt.ok ? 'off' : 'unknown', fix: 'Can only be set up when installing, or with LUKS tools', weight: 2 },
    { id: 'secureboot', name: 'Secure Boot', description: 'Only lets trusted code start the computer.', status: /enabled/.test(sb.stdout) ? 'ok' : /disabled/.test(sb.stdout) ? 'off' : 'unknown', fix: 'Turn on in your computer’s firmware settings', weight: 1 },
    { id: 'mac', name: 'App confinement', description: 'AppArmor or SELinux limits what apps can reach.', status: /Yes/.test(aa.stdout) || /Enforcing/.test(se.stdout) ? 'ok' : /Permissive/.test(se.stdout) ? 'warn' : aa.ok || se.ok ? 'off' : 'unknown', weight: 2 },
    { id: 'updates', name: 'Automatic security updates', description: 'Installs security fixes as they come out.', status: unattended || /enabled/.test(dnfAuto.stdout) ? 'ok' : 'warn', fix: 'Install unattended-upgrades (Debian/Ubuntu) or dnf-automatic (Fedora)', weight: 2 },
  ];
}

export async function checkProtection(): Promise<ProtectionReport> {
  const checks = (process.platform === 'darwin' ? await mac() : process.platform === 'win32' ? await windows() : await linux()).map((c) => ({ ...c, weight: c.weight ?? 1 }));
  const known = checks.filter((c) => c.status !== 'unknown');
  const total = known.reduce((n, c) => n + c.weight, 0);
  const got = known.reduce((n, c) => n + c.weight * (c.status === 'ok' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
  return { score: total ? Math.round((got / total) * 100) : 0, checks, checkedAt: Date.now() };
}
