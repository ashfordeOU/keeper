// SPDX-License-Identifier: AGPL-3.0-or-later
// Finding the shells on this computer: /etc/shells and PATH on macOS and Linux;
// Command Prompt, both PowerShells, every WSL distribution and Git's bash on
// Windows. The parsing is pure; the caller supplies file reads and lookups.

import path from 'node:path';
import type { ShellInfo } from './types';

const NAMES: Record<string, string> = {
  bash: 'Bash', zsh: 'Zsh', fish: 'Fish', sh: 'sh', dash: 'Dash', ksh: 'KornShell', tcsh: 'tcsh', csh: 'csh',
  nu: 'Nushell', elvish: 'Elvish', xonsh: 'Xonsh', pwsh: 'PowerShell', oil: 'Oil', ysh: 'YSH', ion: 'Ion',
};

/** Lines of /etc/shells → unique absolute paths, comments and blanks removed. */
export function parseEtcShells(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line.startsWith('/') && !out.includes(line)) out.push(line);
  }
  return out;
}

/** `wsl.exe -l -q` prints UTF-16LE (sometimes with a BOM and NULs); returns the distribution names. */
export function parseWslList(out: Buffer | string): string[] {
  let text: string;
  if (typeof out === 'string') text = out;
  else {
    const looksUtf16 = out.length >= 2 && (out[1] === 0 || (out[0] === 0xff && out[1] === 0xfe));
    text = looksUtf16 ? out.toString('utf16le') : out.toString('utf8');
  }
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !/^Windows Subsystem for Linux/i.test(s) && !/has no installed distributions/i.test(s));
}

/** `where.exe name` output → the first existing path. */
export function parseWhere(out: string): string | undefined {
  return out.split(/\r?\n/).map((s) => s.trim()).find((s) => /^[A-Za-z]:\\/.test(s) || s.startsWith('\\\\'));
}

export interface UnixDeps {
  etcShells?: string;
  /** directories on PATH */
  path: string[];
  exists: (p: string) => boolean;
  loginShell?: string;
}

export function unixShells(d: UnixDeps): ShellInfo[] {
  const seen = new Map<string, ShellInfo>();
  const add = (file: string) => {
    const base = path.posix.basename(file);
    if (!NAMES[base] || !d.exists(file)) return;
    // One entry per shell name, preferring the login shell's own path, then /bin over /usr/bin.
    const prev = seen.get(base);
    if (prev && !(d.loginShell === file)) return;
    seen.set(base, { id: base, label: NAMES[base], file, args: base === 'pwsh' || base === 'nu' ? [] : ['-l'], kind: 'posix' });
  };
  if (d.loginShell) add(d.loginShell);
  for (const s of parseEtcShells(d.etcShells ?? '')) add(s);
  for (const dir of d.path) for (const name of Object.keys(NAMES)) add(path.posix.join(dir, name));
  const list = [...seen.values()];
  // The login shell first, then by name.
  return list.sort((a, b) => (a.file === d.loginShell ? -1 : b.file === d.loginShell ? 1 : a.label.localeCompare(b.label)));
}

export interface WindowsDeps {
  systemRoot: string;
  programFiles: string[];
  exists: (p: string) => boolean;
  /** output of `wsl.exe -l -q`, if WSL is installed */
  wsl?: Buffer | string;
  /** path of pwsh.exe from `where`, if found */
  pwsh?: string;
}

export function windowsShells(d: WindowsDeps): ShellInfo[] {
  const out: ShellInfo[] = [];
  const winps = `${d.systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const pwsh = d.pwsh ?? d.programFiles.map((p) => `${p}\\PowerShell\\7\\pwsh.exe`).find(d.exists);
  if (pwsh) out.push({ id: 'pwsh', label: 'PowerShell 7', file: pwsh, args: ['-NoLogo'], kind: 'powershell' });
  if (d.exists(winps)) out.push({ id: 'powershell', label: 'Windows PowerShell', file: winps, args: ['-NoLogo'], kind: 'powershell' });
  out.push({ id: 'cmd', label: 'Command Prompt', file: `${d.systemRoot}\\System32\\cmd.exe`, args: [], kind: 'cmd' });
  for (const distro of d.wsl ? parseWslList(d.wsl) : []) {
    out.push({ id: `wsl:${distro}`, label: `${distro} (WSL)`, file: `${d.systemRoot}\\System32\\wsl.exe`, args: ['-d', distro], kind: 'wsl', detail: distro });
  }
  for (const pf of d.programFiles) {
    const gitBash = `${pf}\\Git\\bin\\bash.exe`;
    if (d.exists(gitBash)) {
      out.push({ id: 'git-bash', label: 'Git Bash', file: gitBash, args: ['--login', '-i'], kind: 'posix' });
      break;
    }
  }
  const msys = 'C:\\msys64\\usr\\bin\\bash.exe';
  if (d.exists(msys)) out.push({ id: 'msys2', label: 'MSYS2', file: msys, args: ['--login', '-i'], kind: 'posix' });
  const cygwin = 'C:\\cygwin64\\bin\\bash.exe';
  if (d.exists(cygwin)) out.push({ id: 'cygwin', label: 'Cygwin', file: cygwin, args: ['--login', '-i'], kind: 'posix' });
  return out;
}

/** The kind of quoting to use for a shell file. */
export function shellKindOf(file: string): 'posix' | 'cmd' | 'powershell' {
  const b = file.toLowerCase().split(/[\\/]/).pop() ?? '';
  if (b === 'cmd.exe' || b === 'cmd') return 'cmd';
  if (b.startsWith('powershell') || b.startsWith('pwsh')) return 'powershell';
  return 'posix';
}
