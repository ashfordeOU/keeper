// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Running one command for an agent and knowing exactly where its output starts
// and ends, and how it ended, in any shell. The command is wrapped so the
// shell prints two invisible marks (a private escape code the terminal does not
// show) around it, carrying a random value only this run knows. The echoed
// command line contains the marks as plain text, never the real escape code,
// so the echo can never be mistaken for the end. cmd.exe cannot print escape
// codes, so it gets plain marker lines instead.

export type ShellFamily = 'posix' | 'fish' | 'powershell' | 'cmd';

const OSC = 6973;

/** Which family a shell program belongs to, from its file name. */
export function shellFamily(file: string, kind?: string): ShellFamily {
  const base = file.split(/[\\/]/).pop()?.toLowerCase().replace(/\.exe$/, '') ?? '';
  if (kind === 'powershell' || base === 'pwsh' || base === 'powershell') return 'powershell';
  if (kind === 'cmd' || base === 'cmd') return 'cmd';
  if (base === 'fish') return 'fish';
  return 'posix';
}

export function newNonce(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(rand() * 32)];
  return s;
}

/** The text to type (ending with Enter) to run `command` with marks around it. */
export function wrapCommand(command: string, family: ShellFamily, nonce: string): string {
  const cmd = command.replace(/\r?\n$/, '');
  switch (family) {
    case 'fish':
      return ` printf '\\x1b]${OSC};S;${nonce}\\x07'; begin; ${cmd}\nend; printf '\\x1b]${OSC};D;${nonce};%s\\x07' $status\r`;
    case 'powershell':
      return ` $global:LASTEXITCODE = $null; Write-Host -NoNewline "$([char]27)]${OSC};S;${nonce}$([char]7)"; ${cmd}\n$__k = if ($?) { if ($null -ne $global:LASTEXITCODE) { $global:LASTEXITCODE } else { 0 } } else { if ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 } }; Write-Host -NoNewline "$([char]27)]${OSC};D;${nonce};$__k$([char]7)"\r`;
    case 'cmd':
      // %^ERRORLEVEL% is expanded when the echo runs, not when the line is read.
      return `echo KSTART_${nonce}& ${cmd} & call echo KDONE_${nonce}_%^ERRORLEVEL%\r`;
    default:
      // A leading space keeps it out of most shells' history; the braces let the command span lines.
      return ` printf '\\033]${OSC};S;${nonce}\\007'; { ${cmd}\n}; printf '\\033]${OSC};D;${nonce};%s\\007' "$?"\r`;
  }
}

export interface Marked {
  /** the output had the start mark */
  started: boolean;
  /** the command finished and printed its exit code */
  done: boolean;
  exitCode?: number;
  /** raw output between the marks (or from the start mark to now) */
  body: string;
}

/** Finds this run's marks in raw output received since the command was typed. */
export function findMarks(raw: string, nonce: string): Marked {
  const startOsc = `\x1b]${OSC};S;${nonce}\x07`;
  const doneOsc = new RegExp(`\\x1b\\]${OSC};D;${nonce};(-?\\d+)\\x07`);
  const startPlain = new RegExp(`(?:^|\\n)KSTART_${nonce}\\r?\\n`);
  const donePlain = new RegExp(`(?:^|\\n)KDONE_${nonce}_(-?\\d+)\\r?(?:\\n|$)`);
  let start = raw.indexOf(startOsc);
  let startEnd = start >= 0 ? start + startOsc.length : -1;
  if (start < 0) {
    const m = startPlain.exec(raw);
    if (m) {
      start = m.index;
      startEnd = m.index + m[0].length;
    }
  }
  if (start < 0) return { started: false, done: false, body: '' };
  const rest = raw.slice(startEnd);
  const d = doneOsc.exec(rest) ?? donePlain.exec(rest);
  if (!d) return { started: true, done: false, body: rest };
  return { started: true, done: true, exitCode: Number(d[1]), body: rest.slice(0, d.index) };
}

/** Variables that stop programs from opening pagers or asking questions nobody will answer. */
export function agentEnv(opts: { ci?: boolean } = {}): Record<string, string> {
  return {
    PAGER: 'cat', GIT_PAGER: 'cat', MANPAGER: 'cat', SYSTEMD_PAGER: 'cat', AWS_PAGER: '', PSQL_PAGER: 'cat', LESS: '-FRX',
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', DEBIAN_FRONTEND: 'noninteractive', HOMEBREW_NO_AUTO_UPDATE: '1',
    PIP_NO_INPUT: '1', POWERSHELL_UPDATECHECK: 'Off', KEEPER_AGENT: '1',
    ...(opts.ci ? { CI: '1' } : {}),
  };
}

/** Named keys an agent can send: C-c, Enter, Up, Tab, Escape, F1… and plain text. */
export function keySequence(key: string): string | undefined {
  const k = key.trim();
  const ctrl = /^(?:C|Ctrl|Control)-(.)$/i.exec(k);
  if (ctrl) {
    const ch = ctrl[1].toUpperCase();
    if (ch >= '@' && ch <= '_') return String.fromCharCode(ch.charCodeAt(0) - 64);
    if (ch === '?') return '\x7f';
    return undefined;
  }
  const alt = /^(?:M|Alt|Meta)-(.)$/i.exec(k);
  if (alt) return '\x1b' + alt[1];
  const named: Record<string, string> = {
    enter: '\r', return: '\r', tab: '\t', 'shift-tab': '\x1b[Z', escape: '\x1b', esc: '\x1b', space: ' ', backspace: '\x7f', delete: '\x1b[3~',
    up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', home: '\x1b[H', end: '\x1b[F', pageup: '\x1b[5~', pagedown: '\x1b[6~', insert: '\x1b[2~',
    f1: '\x1bOP', f2: '\x1bOQ', f3: '\x1bOR', f4: '\x1bOS', f5: '\x1b[15~', f6: '\x1b[17~', f7: '\x1b[18~', f8: '\x1b[19~', f9: '\x1b[20~', f10: '\x1b[21~', f11: '\x1b[23~', f12: '\x1b[24~',
  };
  return named[k.toLowerCase()];
}
