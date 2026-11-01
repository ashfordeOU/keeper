// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Unattended access for your own devices: a small system service keeps Keeper
// Link listening while nobody is logged in (after a reboot, at the login
// screen), so your other devices can still reach this one.
//
// What gets installed, per system (pure: this file only writes the text and
// the exact commands; electron/services/screen/unattended.ts runs them under
// one administrator prompt through the elevate service):
//
// - Linux: a systemd system unit running Keeper's Link daemon as you (not
//   root), started at boot, restarted when it stops.
// - macOS: a LaunchDaemon (root, at boot) that runs the same daemon as you,
//   plus, for the login window, the Keeper helper as root. Screen capture of
//   the login window needs root and the helper; input there is limited by macOS.
// - Windows: a Windows service (LocalSystem) compiled from the C# below with
//   the .NET Framework compiler that ships with Windows. It listens for
//   session changes and starts Keeper's capture/input agent in the active
//   session with CreateProcessAsUser — as the signed-in person, or as SYSTEM
//   on the Winlogon desktop when the login screen or a UAC prompt is up.

export interface UnattendedPaths {
  /** the Electron/Keeper executable */
  exe: string;
  /** dist-electron/linkd.cjs (run with ELECTRON_RUN_AS_NODE=1) */
  daemon: string;
  /** Keeper's data folder for this person (holds link/) */
  dataDir: string;
  /** the account the daemon runs as */
  user: string;
  /** home folder of that account */
  home: string;
  /** macOS: the Keeper helper binary */
  helper?: string;
}

export const LINUX_UNIT = 'keeper-link.service';
export const LINUX_UNIT_PATH = `/etc/systemd/system/${LINUX_UNIT}`;
export const MAC_LABEL = 'com.ashforde.keeper.link';
export const MAC_PLIST_PATH = `/Library/LaunchDaemons/${MAC_LABEL}.plist`;
export const WIN_SERVICE = 'KeeperLink';

export interface Requirement {
  ok: boolean;
  reason?: string;
}

/**
 * Unattended access is for your own computers only: at least one paired
 * device must already have "Control this computer" and "Let it in without
 * asking" here.
 */
export function canEnableUnattended(devices: { id: string; name: string; permissions: { screenView?: boolean; screenControl?: boolean } }[], unattended: Record<string, boolean>): Requirement {
  const own = devices.filter((d) => d.permissions.screenControl && d.permissions.screenView && unattended[d.id]);
  if (own.length) return { ok: true };
  return { ok: false, reason: 'First give one of your devices “Control this computer” and turn on “Let it in without asking” for it.' };
}

const sdQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `"${s.replace(/(["\\])/g, '\\$1')}"`);

/** The systemd system unit (Linux). */
export function systemdUnit(p: UnattendedPaths): string {
  if (!/^[a-z_][a-z0-9_-]*\$?$/i.test(p.user)) throw new Error('That account name cannot be used in a service');
  return [
    '[Unit]',
    'Description=Keeper Link (unattended access for your own devices)',
    'Wants=network-online.target',
    'After=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${p.user}`,
    `Environment=ELECTRON_RUN_AS_NODE=1`,
    `Environment=HOME=${sdQuote(p.home)}`,
    `Environment=KEEPER_DATA_DIR=${sdQuote(p.dataDir)}`,
    `ExecStart=${sdQuote(p.exe)} ${sdQuote(p.daemon)} --unattended`,
    'Restart=always',
    'RestartSec=5',
    'NoNewPrivileges=yes',
    'ProtectSystem=full',
    'PrivateTmp=yes',
    'Nice=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The LaunchDaemon (macOS). */
export function launchdPlist(p: UnattendedPaths): string {
  const args = [p.exe, p.daemon, '--unattended', ...(p.helper ? ['--helper', p.helper] : [])];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>UserName</key>
  <string>${xml(p.user)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ELECTRON_RUN_AS_NODE</key>
    <string>1</string>
    <key>HOME</key>
    <string>${xml(p.home)}</string>
    <key>KEEPER_DATA_DIR</key>
    <string>${xml(p.dataDir)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardErrorPath</key>
  <string>/Library/Logs/Keeper/link.log</string>
</dict>
</plist>
`;
}

/** The Windows service, in C# for the compiler that ships with Windows (.NET Framework 4). */
export function windowsServiceSource(p: UnattendedPaths): string {
  const cs = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `// Keeper Link service: keeps your own devices able to reach this PC when nobody is signed in.
// Generated by Keeper. Runs as LocalSystem; starts Keeper's agent in the active session.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.ServiceProcess;

public class KeeperLinkService : ServiceBase {
  const string Exe = "${cs(p.exe)}";
  const string Daemon = "${cs(p.daemon)}";
  const string DataDir = "${cs(p.dataDir)}";
  Process daemon;
  IntPtr agent = IntPtr.Zero;

  public KeeperLinkService() {
    ServiceName = "${WIN_SERVICE}";
    CanHandleSessionChangeEvent = true;
    CanStop = true;
  }

  protected override void OnStart(string[] args) {
    StartDaemon();
    StartAgent();
  }

  protected override void OnStop() {
    StopAgent();
    try { if (daemon != null && !daemon.HasExited) daemon.Kill(); } catch {}
  }

  // Logon, logoff, lock, unlock, remote connect: the agent follows the active session.
  protected override void OnSessionChange(SessionChangeDescription d) {
    if (d.Reason == SessionChangeReason.SessionLogon || d.Reason == SessionChangeReason.SessionLogoff ||
        d.Reason == SessionChangeReason.ConsoleConnect || d.Reason == SessionChangeReason.SessionUnlock ||
        d.Reason == SessionChangeReason.SessionLock) {
      StopAgent();
      StartAgent();
    }
  }

  void StartDaemon() {
    var psi = new ProcessStartInfo(Exe, "\\"" + Daemon + "\\" --unattended") { UseShellExecute = false, CreateNoWindow = true };
    psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
    psi.EnvironmentVariables["KEEPER_DATA_DIR"] = DataDir;
    daemon = Process.Start(psi);
  }

  // The capture/input agent: as the signed-in person when there is one,
  // otherwise as SYSTEM on the Winlogon desktop (login screen and UAC prompts).
  void StartAgent() {
    uint session = WTSGetActiveConsoleSessionId();
    if (session == 0xFFFFFFFF) return;
    IntPtr token;
    string desktop = "winsta0\\\\default";
    if (!WTSQueryUserToken(session, out token)) {
      IntPtr self;
      if (!OpenProcessToken(Process.GetCurrentProcess().Handle, TOKEN_ALL_ACCESS, out self)) return;
      if (!DuplicateTokenEx(self, TOKEN_ALL_ACCESS, IntPtr.Zero, 2, 1, out token)) { CloseHandle(self); return; }
      CloseHandle(self);
      SetTokenInformation(token, 12 /* TokenSessionId */, ref session, 4);
      desktop = "winsta0\\\\Winlogon";
    }
    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(si);
    si.lpDesktop = desktop;
    PROCESS_INFORMATION pi;
    string cmd = "\\"" + Exe + "\\" --link-agent --session " + session;
    if (CreateProcessAsUser(token, null, cmd, IntPtr.Zero, IntPtr.Zero, false, CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, null, ref si, out pi)) {
      agent = pi.hProcess;
      CloseHandle(pi.hThread);
    }
    CloseHandle(token);
  }

  void StopAgent() {
    if (agent != IntPtr.Zero) { TerminateProcess(agent, 0); CloseHandle(agent); agent = IntPtr.Zero; }
  }

  public static void Main() { ServiceBase.Run(new KeeperLinkService()); }

  const uint TOKEN_ALL_ACCESS = 0xF01FF;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
  [DllImport("wtsapi32.dll", SetLastError = true)] static extern bool WTSQueryUserToken(uint session, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attrs, int level, int type, out IntPtr newToken);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr token, int cls, ref uint info, int len);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUser(IntPtr token, string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr p, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
}
`;
}

export interface Step {
  file: string;
  args: string[];
  admin: boolean;
}

/**
 * Install commands. `staged` is where the app already wrote the unit, plist
 * or C# source (in its own folder); the elevated commands copy it into place.
 */
export function installSteps(platform: string, staged: string, _p?: UnattendedPaths): Step[] {
  if (platform === 'linux') {
    return [
      { file: 'install', args: ['-m', '0644', '-o', 'root', '-g', 'root', staged, LINUX_UNIT_PATH], admin: true },
      { file: 'systemctl', args: ['daemon-reload'], admin: true },
      { file: 'systemctl', args: ['enable', '--now', LINUX_UNIT], admin: true },
    ];
  }
  if (platform === 'darwin') {
    return [
      { file: '/bin/mkdir', args: ['-p', '/Library/Logs/Keeper'], admin: true },
      { file: '/usr/bin/install', args: ['-m', '0644', '-o', 'root', '-g', 'wheel', staged, MAC_PLIST_PATH], admin: true },
      { file: '/bin/launchctl', args: ['bootstrap', 'system', MAC_PLIST_PATH], admin: true },
    ];
  }
  const exe = staged.replace(/\.cs$/i, '.exe');
  const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  return [
    { file: csc, args: ['/nologo', '/target:exe', `/out:${exe}`, '/reference:System.ServiceProcess.dll', staged], admin: true },
    { file: 'sc', args: ['create', WIN_SERVICE, `binPath=`, `"${exe}"`, 'start=', 'auto', 'DisplayName=', 'Keeper Link'], admin: true },
    { file: 'sc', args: ['description', WIN_SERVICE, 'Keeps your own devices able to reach this PC through Keeper Link when nobody is signed in.'], admin: true },
    { file: 'sc', args: ['failure', WIN_SERVICE, 'reset=', '86400', 'actions=', 'restart/5000/restart/5000/restart/30000'], admin: true },
    { file: 'sc', args: ['start', WIN_SERVICE], admin: true },
  ];
}

export function uninstallSteps(platform: string): Step[] {
  if (platform === 'linux') {
    return [
      { file: 'systemctl', args: ['disable', '--now', LINUX_UNIT], admin: true },
      { file: 'rm', args: ['-f', LINUX_UNIT_PATH], admin: true },
      { file: 'systemctl', args: ['daemon-reload'], admin: true },
    ];
  }
  if (platform === 'darwin') {
    return [
      { file: '/bin/launchctl', args: ['bootout', `system/${MAC_LABEL}`], admin: true },
      { file: '/bin/rm', args: ['-f', MAC_PLIST_PATH], admin: true },
    ];
  }
  return [
    { file: 'sc', args: ['stop', WIN_SERVICE], admin: true },
    { file: 'sc', args: ['delete', WIN_SERVICE], admin: true },
  ];
}

/** What the definition file is called while staged in Keeper's folder. */
export function stagedName(platform: string): string {
  return platform === 'linux' ? LINUX_UNIT : platform === 'darwin' ? `${MAC_LABEL}.plist` : 'KeeperLinkService.cs';
}

export function definition(platform: string, p: UnattendedPaths): string {
  return platform === 'linux' ? systemdUnit(p) : platform === 'darwin' ? launchdPlist(p) : windowsServiceSource(p);
}

/** What works without anyone logged in, per system, in plain words for the settings card. */
export function unattendedLimits(platform: string): string[] {
  if (platform === 'linux') return ['Files, terminals, commands, Wake-on-LAN and restarts work after a reboot, before anyone logs in.', 'The login screen itself cannot be shown: the display belongs to the login manager until someone logs in.'];
  if (platform === 'darwin') return ['Files, terminals and commands work after a restart, before anyone logs in.', 'Showing the login window needs the Keeper helper running as root and Screen Recording allowed; macOS may still block typing there.'];
  return ['Files, terminals and commands work before anyone signs in.', 'The sign-in screen and administrator (UAC) prompts can be seen and used: the service starts Keeper’s agent on the secure desktop.'];
}
