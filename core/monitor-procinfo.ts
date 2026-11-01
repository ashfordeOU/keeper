// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The deeper parts of the process inspector: its environment with secrets
// hidden, its chain of parents, and who signed it (macOS codesign, Windows
// Authenticode). Pure parsers and rules; the service runs the commands.

export interface EnvVar {
  name: string;
  /** the value, or undefined while hidden */
  value?: string;
  /** looks like a password, token or key: hidden even when the rest is shown */
  secret: boolean;
}

/** Variables safe to show by default: they describe the setup, not the person. */
const SAFE = new Set(['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TERM_PROGRAM', 'PWD', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'NODE_ENV', 'PORT', 'HOST', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'COLORTERM', 'EDITOR', 'VISUAL', 'PYTHONPATH', 'VIRTUAL_ENV', 'CONDA_DEFAULT_ENV', 'GOPATH', 'JAVA_HOME', 'SystemRoot', 'COMPUTERNAME', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'OS', 'windir', 'ComSpec', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'USERPROFILE', 'SHLVL', 'XPC_SERVICE_NAME', '__CF_BUNDLE_IDENTIFIER']);
const SECRET = /(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|private|credential|auth|cookie|session|signature|bearer|_pat$|^pat_|dsn|webhook|database_url|connection_string|key$)/i;
const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|:\/\/[^:\s/]+:[^@\s/]+@|-----BEGIN [A-Z ]*PRIVATE KEY)/;

/** Is this variable a secret, judging by its name or what its value looks like? */
export function isSecretVar(name: string, value: string): boolean {
  return SECRET.test(name) || SECRET_VALUE.test(value);
}

/**
 * The environment as the inspector shows it. Hidden by default: only the safe
 * setup variables have values. With `reveal`, everything but secrets is shown;
 * secrets need `revealSecrets` too (a second, deliberate step).
 */
export function redactEnv(entries: [string, string][], opts: { reveal?: boolean; revealSecrets?: boolean } = {}): EnvVar[] {
  return entries
    .filter(([n]) => n)
    .map(([name, value]) => {
      const secret = isSecretVar(name, value);
      const show = secret ? !!(opts.reveal && opts.revealSecrets) : opts.reveal || SAFE.has(name);
      return { name, value: show ? value : undefined, secret };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** NUL-separated `KEY=value` pairs from /proc/<pid>/environ (or `ps eww` lines split by the caller). */
export function parseEnviron(raw: string): [string, string][] {
  return raw.split('\0').filter(Boolean).map((kv) => {
    const i = kv.indexOf('=');
    return i <= 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)];
  });
}

/**
 * macOS `ps -E -o command= -p <pid>` prints the command followed by the
 * environment. Words of the form NAME=value after the command are the variables.
 */
export function parsePsEnv(line: string, command: string): [string, string][] {
  const rest = line.startsWith(command) ? line.slice(command.length) : line;
  const out: [string, string][] = [];
  const re = /\s([A-Za-z_][A-Za-z0-9_]*)=(.*?)(?=\s[A-Za-z_][A-Za-z0-9_]*=|$)/g;
  for (const m of rest.matchAll(re)) out.push([m[1], m[2]]);
  return out;
}

// ---------------------------------------------------------------- parent chain

/** The process's parents up to the first process (launchd, systemd, init), nearest first. */
export function ancestors(pid: number, procs: { pid: number; ppid: number; name: string }[]): { pid: number; name: string }[] {
  const by = new Map(procs.map((p) => [p.pid, p]));
  const out: { pid: number; name: string }[] = [];
  let cur = by.get(pid)?.ppid;
  for (let i = 0; cur !== undefined && cur > 0 && i < 64; i++) {
    const p = by.get(cur);
    if (!p || out.some((x) => x.pid === cur)) break;
    out.push({ pid: p.pid, name: p.name });
    if (p.ppid === p.pid) break;
    cur = p.ppid;
  }
  return out;
}

// ---------------------------------------------------------------- signatures

export interface CodeSignature {
  /** signed and the signature checks out */
  valid: boolean;
  signed: boolean;
  /** "Developer ID Application: Example Ltd (ABCDE12345)", "Microsoft Windows", … */
  signer?: string;
  teamId?: string;
  identifier?: string;
  /** the chain, leaf first */
  authorities?: string[];
  /** macOS: hardened runtime, sandbox, notarised (stapled ticket) */
  hardenedRuntime?: boolean;
  sandboxed?: boolean;
  notarized?: boolean;
  /** Apple's own software, or part of Windows */
  platform?: boolean;
  /** what the system said when it was not valid */
  note?: string;
  /** Linux has no code signatures; the owning package (dpkg/rpm/pacman) says where it came from */
  source: 'codesign' | 'authenticode' | 'package' | 'none';
}

/** `codesign -dv --verbose=4 <path>` (stderr) plus `codesign --verify` result and entitlements text. */
export function parseCodesign(details: string, verified: boolean, entitlements = ''): CodeSignature {
  if (/code object is not signed/i.test(details)) return { valid: false, signed: false, source: 'codesign', note: 'Not signed' };
  const auths = [...details.matchAll(/^Authority=(.+)$/gm)].map((m) => m[1].trim());
  const team = details.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim();
  const flags = details.match(/flags=0x[0-9a-f]+\(([^)]*)\)/i)?.[1] ?? '';
  return {
    valid: verified, signed: auths.length > 0 || /Signature=adhoc/.test(details), signer: auths[0] ?? (/Signature=adhoc/.test(details) ? 'Ad hoc (no identity)' : undefined),
    teamId: team && team !== 'not set' ? team : undefined, identifier: details.match(/^Identifier=(.+)$/m)?.[1]?.trim(), authorities: auths.length ? auths : undefined,
    hardenedRuntime: /\bruntime\b/.test(flags), sandboxed: /com\.apple\.security\.app-sandbox/.test(entitlements) || undefined,
    notarized: /Notarization Ticket=stapled/i.test(details) || undefined, platform: /Software Signing$/.test(auths[0] ?? '') || /Platform identifier=/.test(details) || undefined,
    note: verified ? undefined : 'The signature does not check out (the app may have been changed after signing).', source: 'codesign',
  };
}

/** `Get-AuthenticodeSignature <path> | Select Status,StatusMessage,IsOSBinary,@{SignerCertificate.Subject}` as JSON. */
export function parseAuthenticode(json: string): CodeSignature {
  try {
    const j = JSON.parse(json) as { Status?: number | string; StatusMessage?: string; IsOSBinary?: boolean; Subject?: string; Issuer?: string };
    // Status: 0 Valid, 1 UnknownError, 2 NotSigned, 3 HashMismatch, 4 NotTrusted, 5 NotSupportedFileFormat, 6 Incompatible.
    const st = typeof j.Status === 'number' ? ['Valid', 'UnknownError', 'NotSigned', 'HashMismatch', 'NotTrusted', 'NotSupportedFileFormat', 'Incompatible'][j.Status] : j.Status;
    const cn = j.Subject?.match(/CN=("?)([^,"]+)\1/)?.[2];
    return {
      valid: st === 'Valid', signed: st !== 'NotSigned' && st !== 'NotSupportedFileFormat', signer: cn ?? j.Subject, authorities: [j.Subject, j.Issuer].filter((x): x is string => !!x),
      platform: j.IsOSBinary || undefined, note: st === 'Valid' ? undefined : j.StatusMessage || st, source: 'authenticode',
    };
  } catch {
    return { valid: false, signed: false, source: 'authenticode', note: 'Windows did not answer' };
  }
}

/** `dpkg -S`, `rpm -qf` or `pacman -Qo` output: the package that installed a file. */
export function parsePackageOwner(tool: 'dpkg' | 'rpm' | 'pacman', out: string): CodeSignature {
  const line = out.trim().split('\n')[0] ?? '';
  let pkg: string | undefined;
  if (tool === 'dpkg') pkg = /no path found|^dpkg/i.test(line) ? undefined : line.match(/^([^:\s]+(?::[a-z0-9]+)?):\s/)?.[1];
  else if (tool === 'rpm') pkg = /not owned|no such file/i.test(line) ? undefined : line || undefined;
  else pkg = line.match(/is owned by (\S+ \S+)/)?.[1];
  return pkg
    ? { valid: true, signed: true, signer: `Installed by the system package ${pkg}`, identifier: pkg, source: 'package' }
    : { valid: false, signed: false, source: 'package', note: 'Not installed by the system package manager (built locally, downloaded, or from an app bundle).' };
}
