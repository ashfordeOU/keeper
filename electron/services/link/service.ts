// SPDX-License-Identifier: AGPL-3.0-or-later
// Installing the named tunnel as a system service, so it keeps running when
// Keeper is closed and starts with the computer. Needs an administrator, so
// the system's own password prompt is shown (pkexec, the macOS administrator
// dialog, or Windows' "Run as administrator"). Quick tunnels cannot be services.

import { execFile } from 'node:child_process';

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5 * 60_000, windowsHide: true }, (err, _out, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).split('\n')[0] || 'The system did not allow it'));
      else resolve();
    });
  });
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function installTunnelService(on: boolean, bin: string, token: string | undefined) {
  if (on && !token) throw new Error('A tunnel that keeps running needs a named tunnel and its token');
  const args = on ? ['service', 'install', token!] : ['service', 'uninstall'];
  if (process.platform === 'linux') return run('pkexec', [bin, ...args]);
  if (process.platform === 'darwin') {
    const cmd = [bin, ...args].map(shq).join(' ');
    return run('/usr/bin/osascript', ['-e', `do shell script ${JSON.stringify(cmd)} with administrator privileges`]);
  }
  if (process.platform === 'win32') {
    const ps = `$p = Start-Process -FilePath ${psq(bin)} -ArgumentList @(${args.map(psq).join(',')}) -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`;
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  }
  throw new Error('Not available on this system');
}
