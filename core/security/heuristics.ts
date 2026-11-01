// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Built-in detection that needs no download: the EICAR test file, a small hash
// list, file-type sniffing, disguised extensions, macros in Office documents,
// scripts that fetch and run code or hide themselves, and miner-like processes.
// These are hints with a confidence attached; signature engines (ClamAV, YARA
// rule sets) do the heavy lifting.

import type { Detection, Severity } from './types';

/** The standard anti-malware test file: harmless, detected by every engine by design. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** SHA-256 of files known to be malicious (the EICAR file, plus whatever lists the person adds). */
export const BUILT_IN_HASHES: Record<string, string> = {
  '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f': 'Eicar-Test-Signature',
  '8b3f191819931d1f2cef7289239b5f77c00b079847b9c2636e56854d1e5eff71': 'Eicar-Test-Signature',
  '131f95c51cc819465fa1797f6ccacf9d494aaaff46fa3eac73ae63ffbdfd8267': 'Eicar-Test-Signature',
};

export function hasEicar(data: Buffer): boolean {
  // The file must start with the string (plus optional whitespace afterwards), as the standard defines.
  return data.length <= 128 && data.toString('latin1').startsWith(EICAR);
}

// ---------------------------------------------------------------- file types

export type Kind = 'pe' | 'elf' | 'macho' | 'script' | 'zip' | 'ole' | 'pdf' | 'dmg' | 'msi' | 'lnk' | 'other';

export function sniff(head: Buffer, name: string): Kind {
  const b = head;
  if (b[0] === 0x4d && b[1] === 0x5a) return 'pe';
  if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return 'elf';
  const m = b.length >= 4 ? b.readUInt32BE(0) : 0;
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(m)) return 'macho';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip';
  if (m === 0xd0cf11e0) return /\.msi$/i.test(name) ? 'msi' : 'ole';
  if (b.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (m === 0x4c000000) return 'lnk';
  if (b[0] === 0x23 && b[1] === 0x21) return 'script';
  if (/\.(dmg|iso|img)$/i.test(name)) return 'dmg';
  if (/\.(sh|bash|zsh|command|ps1|psm1|bat|cmd|vbs|vbe|js|jse|wsf|hta|applescript|scpt|py|pl|rb)$/i.test(name)) return 'script';
  return 'other';
}

/** Kinds Keeper always looks inside, and which real-time protection watches. */
export const RISKY = new Set<Kind>(['pe', 'elf', 'macho', 'script', 'zip', 'ole', 'pdf', 'dmg', 'msi', 'lnk']);

// ---------------------------------------------------------------- disguises

const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|jpe?g|png|gif|mp[34]|mov|zip|csv)$/i;
const RUN_EXT = /\.(exe|scr|com|pif|bat|cmd|vbs|vbe|js|jse|wsf|hta|msi|lnk|ps1|app|command|sh|jar|apk)$/i;

/** "invoice.pdf.exe", names padded with spaces before the real extension, or right-to-left override tricks. */
export function disguisedName(name: string, kind: Kind): string | undefined {
  if (/[\u202e\u202d\u200f]/.test(name)) return 'its name uses invisible characters that make it look like a different type of file';
  const stem = name.replace(RUN_EXT, '');
  if (stem !== name && DOC_EXT.test(stem)) return `it is named like a ${stem.match(DOC_EXT)![1].toUpperCase()} but is a program`;
  if (/\s{5,}\.\w+$/.test(name)) return 'its real extension is hidden behind spaces';
  if (DOC_EXT.test(name) && (kind === 'pe' || kind === 'elf' || kind === 'macho')) return `it is named like a document but is really a program`;
  return undefined;
}

// ---------------------------------------------------------------- macros

/** Office documents that carry macros (VBA): a common way malware arrives by email. */
export function hasMacros(data: Buffer, kind: Kind): boolean {
  const s = data.toString('latin1');
  if (kind === 'zip') return /vbaProject\.bin|vbaData\.xml/.test(s);
  if (kind === 'ole') return /_VBA_PROJECT|V\x00B\x00A\x00|\bAttribute VB_Name\b/.test(s);
  return false;
}

/** Macros that run by themselves and reach out: far more suspicious than macros alone. */
export function macroRedFlags(data: Buffer): string[] {
  const s = data.toString('latin1');
  const flags: string[] = [];
  if (/Auto_?Open|Document_Open|Workbook_Open/i.test(s)) flags.push('runs as soon as the document opens');
  if (/Shell\s*\(|WScript\.Shell|CreateObject\s*\(\s*"Shell/i.test(s)) flags.push('starts other programs');
  if (/URLDownloadToFile|XMLHTTP|WinHttp|Net\.WebClient/i.test(s)) flags.push('downloads from the internet');
  if (/powershell|cmd\.exe|mshta/i.test(s)) flags.push('calls system command tools');
  return flags;
}

// ---------------------------------------------------------------- scripts

const SCRIPT_FLAGS: [RegExp, string, Severity][] = [
  [/(curl|wget)[^|\n]{0,200}\|\s*(ba|z|)sh\b/i, 'downloads code and runs it straight away', 'high'],
  [/base64\s+(-d|--decode)[^|\n]{0,80}\|\s*(ba|z|)sh\b|echo\s+[A-Za-z0-9+/=]{200,}\s*\|\s*base64/i, 'decodes hidden code and runs it', 'high'],
  [/bash\s+-i\s+>&\s*\/dev\/tcp\/|nc\s+(-e|-c)\s+\/bin\/(ba)?sh|\/dev\/tcp\/\d+\.\d+\.\d+\.\d+\/\d+/i, 'opens a remote control connection (reverse shell)', 'critical'],
  [/powershell[^\n]{0,80}(-enc|-encodedcommand)\s+[A-Za-z0-9+/=]{40,}/i, 'runs hidden (encoded) PowerShell commands', 'high'],
  [/IEX\s*\(?\s*\(?\s*New-Object\s+Net\.WebClient\)?\.DownloadString|Invoke-Expression[^\n]{0,80}(DownloadString|Invoke-WebRequest|iwr)/i, 'downloads PowerShell code and runs it', 'high'],
  [/certutil(\.exe)?\s+[^\n]*-urlcache[^\n]*-f|bitsadmin(\.exe)?\s+\/transfer/i, 'misuses a Windows tool to download files', 'high'],
  [/mshta(\.exe)?\s+(https?:|javascript:|vbscript:)|rundll32(\.exe)?\s+[^\n]*javascript:|regsvr32(\.exe)?\s+[^\n]*\/i:https?:/i, 'misuses a Windows tool to run code from the internet', 'critical'],
  [/osascript\s+-e\s+[^\n]*with administrator privileges/i, 'asks for your administrator password through a script', 'medium'],
  [/launchctl\s+(load|bootstrap)|LaunchAgents\/[^\s]+\.plist|crontab\s+-|systemctl\s+--user\s+enable|reg(\.exe)?\s+add\s+[^\n]*\\Run\b|schtasks(\.exe)?\s+\/create/i, 'sets itself up to start automatically', 'medium'],
  [/xattr\s+-[rd]+\s+com\.apple\.quarantine|spctl\s+--master-disable|Set-MpPreference\s+-Disable/i, 'switches off protections built into the system', 'high'],
  [/security\s+find-generic-password|Login Data|logins\.json|key4\.db|Cookies\b.*sqlite|keychain-db/i, 'reaches for saved passwords or browser cookies', 'high'],
];

export function scriptRedFlags(text: string): { why: string; severity: Severity }[] {
  const out: { why: string; severity: Severity }[] = [];
  for (const [re, why, severity] of SCRIPT_FLAGS) if (re.test(text)) out.push({ why, severity });
  return out;
}

// ---------------------------------------------------------------- one file

export interface HeuristicInput {
  name: string;
  data: Buffer;
  /** where it is: programs in Downloads or temporary folders are more suspicious than in Applications */
  location?: 'downloads' | 'temp' | 'desktop' | 'documents' | 'apps' | 'other';
  /** the system says it is signed by a known developer */
  signed?: boolean;
}

const rank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Everything the built-in checks notice about one file. */
export function inspect(f: HeuristicInput, sha256?: string): Omit<Detection, 'path'>[] {
  const out: Omit<Detection, 'path'>[] = [];
  const kind = sniff(f.data.subarray(0, 16), f.name);
  if (hasEicar(f.data)) out.push({ engine: 'signature', name: 'Eicar-Test-Signature', severity: 'low', confidence: 'certain', sha256, why: 'This is the standard anti-malware test file. It is harmless; it is detected on purpose to show protection works.' });
  const known = sha256 ? BUILT_IN_HASHES[sha256] : undefined;
  if (known && !out.length) {
    const test = known.startsWith('Eicar');
    out.push({ engine: 'hash', name: known, severity: test ? 'low' : 'high', confidence: 'certain', sha256, why: test ? 'This is the standard anti-malware test file. It is harmless; it is detected on purpose to show protection works.' : 'Its fingerprint matches a known malicious file.' });
  }
  const disguise = disguisedName(f.name, kind);
  if (disguise) out.push({ engine: 'heuristic', name: 'Keeper.Heuristic.Disguised', severity: 'high', confidence: 'likely', sha256, why: `This file looks harmless but ${disguise}.` });
  if (kind === 'zip' || kind === 'ole') {
    if (hasMacros(f.data, kind)) {
      const flags = macroRedFlags(f.data);
      out.push({ engine: 'heuristic', name: flags.length ? 'Keeper.Heuristic.Macro.Suspicious' : 'Keeper.Heuristic.Macro', severity: flags.length >= 2 ? 'high' : flags.length ? 'medium' : 'low', confidence: flags.length >= 2 ? 'likely' : 'possible', sha256, why: flags.length ? `This document has macros that ${flags.join(', ')}.` : 'This document contains macros (small programs). Only enable them if you trust where it came from.' });
    }
  }
  if (kind === 'script' || (kind === 'other' && f.data.length < 2_000_000)) {
    const flags = scriptRedFlags(f.data.toString('utf8'));
    if (flags.length) {
      const worst = flags.reduce((a, b) => (rank[b.severity] > rank[a.severity] ? b : a));
      out.push({ engine: 'heuristic', name: 'Keeper.Heuristic.Script', severity: worst.severity, confidence: flags.length >= 2 ? 'likely' : 'possible', sha256, why: `This script ${flags.map((x) => x.why).join('; ')}.` });
    }
  }
  if ((kind === 'pe' || kind === 'elf' || kind === 'macho') && f.signed === false && (f.location === 'downloads' || f.location === 'temp')) {
    out.push({ engine: 'heuristic', name: 'Keeper.Heuristic.UnsignedProgram', severity: 'low', confidence: 'possible', sha256, why: 'A program from the internet that no developer has signed. Fine if you know where it came from; malware is often unsigned.' });
  }
  return out;
}

/** The detections worth acting on automatically (quarantine without asking). */
export function autoQuarantine(d: Pick<Detection, 'confidence' | 'severity' | 'name'>): boolean {
  // Signature and fingerprint matches are certain (the EICAR test file included, so protection can be seen working).
  if (d.confidence === 'certain') return true;
  return d.confidence === 'likely' && rank[d.severity] >= rank.critical;
}

// ---------------------------------------------------------------- processes

const MINER = /\b(xmrig|xmr-stak|minerd|cpuminer|cgminer|bfgminer|ethminer|nbminer|t-rex|lolminer|phoenixminer|nanominer)\b|stratum\+(tcp|ssl):\/\/|--donate-level|--randomx/i;

/** Programs that look like cryptocurrency miners (by name or command line), or that run from a temporary folder. */
export function suspiciousProcess(p: { name: string; command?: string; cpu?: number; path?: string }): string | undefined {
  if (MINER.test(`${p.name} ${p.command ?? ''}`)) return 'looks like a cryptocurrency miner';
  if (p.path && /^(\/tmp\/|\/var\/tmp\/|\/dev\/shm\/|C:\\Users\\[^\\]+\\AppData\\Local\\Temp\\|\/private\/var\/folders\/)/i.test(p.path) && (p.cpu ?? 0) > 50) return 'runs from a temporary folder and keeps the processor busy';
  return undefined;
}

// ---------------------------------------------------------------- persistence locations

export function persistenceLocations(platform: string, home: string): { kind: import('./types').PersistenceItem['kind']; dir: string }[] {
  if (platform === 'darwin') {
    return [
      { kind: 'launch-agent', dir: `${home}/Library/LaunchAgents` },
      { kind: 'launch-agent', dir: '/Library/LaunchAgents' },
      { kind: 'launch-daemon', dir: '/Library/LaunchDaemons' },
    ];
  }
  if (platform === 'win32') {
    return [{ kind: 'startup-folder', dir: `${home}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup` }];
  }
  return [
    { kind: 'systemd-user', dir: `${home}/.config/systemd/user` },
    { kind: 'autostart', dir: `${home}/.config/autostart` },
    { kind: 'systemd-system', dir: '/etc/systemd/system' },
  ];
}

/** What a persistence file runs, read from a plist, a systemd unit or a .desktop file. */
export function persistenceCommand(name: string, text: string): string | undefined {
  if (/\.plist$/i.test(name)) {
    const prog = text.match(/<key>Program<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    const args = [...(text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '').matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
    return prog ?? (args.length ? args.join(' ') : undefined);
  }
  if (/\.(service|timer)$/i.test(name)) return text.match(/^ExecStart=(.+)$/m)?.[1]?.trim();
  if (/\.desktop$/i.test(name)) return text.match(/^Exec=(.+)$/m)?.[1]?.trim();
  return undefined;
}
