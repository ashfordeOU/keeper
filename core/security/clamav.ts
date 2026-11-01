// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// ClamAV (GPL-2.0, run as a separate program): building its command lines and
// reading its answers. Keeper uses clamdscan when the clamd daemon is running
// (fast: signatures stay loaded) and clamscan otherwise; freshclam keeps the
// signatures current.

import type { Detection } from './types';

export interface ClamPaths {
  clamscan?: string;
  clamdscan?: string;
  freshclam?: string;
  /** where Keeper keeps its own signature database when the system has none */
  database?: string;
}

/** Arguments for scanning paths; one line per infected file comes back. */
export function clamscanArgs(paths: string[], o: { database?: string; daemon?: boolean; maxFileMb?: number; archives?: boolean } = {}): string[] {
  const safe = paths.filter((p) => typeof p === 'string' && p.length > 0 && !p.startsWith('-'));
  if (o.daemon) return ['--no-summary', '--infected', '--fdpass', '--multiscan', '--stdout', ...safe];
  const max = Math.max(1, Math.min(4000, Math.round(o.maxFileMb ?? 200)));
  return [
    '--no-summary', '--infected', '--stdout', '--recursive', '--cross-fs=no',
    `--max-filesize=${max}M`, `--max-scansize=${max * 4}M`,
    ...(o.archives === false ? ['--scan-archive=no'] : ['--max-recursion=16', '--max-files=10000']),
    '--detect-pua=yes',
    ...(o.database ? [`--database=${o.database}`] : []),
    '--', ...safe,
  ];
}

/** freshclam updating Keeper's own database folder (no system config needed). */
export function freshclamArgs(database: string, configFile?: string): string[] {
  return [`--datadir=${database}`, ...(configFile ? [`--config-file=${configFile}`] : []), '--stdout', '--quiet', '--no-warnings'];
}

/** A minimal freshclam.conf, so updates work without a system-wide configuration. */
export function freshclamConfig(database: string, owner?: string): string {
  // freshclam started as root switches to its own user, which may not reach Keeper's folder; keep the files ours.
  const own = owner && /^[A-Za-z0-9._-]+$/.test(owner) ? `DatabaseOwner ${owner}\n` : '';
  return `DatabaseDirectory ${database}\n${own}DatabaseMirror database.clamav.net\nDNSDatabaseInfo current.cvd.clamav.net\nConnectTimeout 30\nReceiveTimeout 60\nChecks 0\n`;
}

/** Lines like "/path/file: Eicar-Signature FOUND" (archives: "/path/a.zip: Win.Test.EICAR_HDB-1 FOUND"). */
export function parseClamOutput(text: string): Pick<Detection, 'path' | 'name' | 'engine' | 'severity' | 'confidence' | 'why'>[] {
  const out: Pick<Detection, 'path' | 'name' | 'engine' | 'severity' | 'confidence' | 'why'>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(.*): (.+) FOUND$/);
    if (!m) continue;
    const name = m[2].trim();
    const pua = /^PUA\./.test(name);
    const test = /eicar/i.test(name);
    out.push({
      path: m[1],
      name,
      engine: 'clamav',
      severity: test ? 'low' : pua ? 'medium' : 'high',
      confidence: pua ? 'likely' : 'certain',
      why: test ? 'This is the standard anti-malware test file. It is harmless; it is detected on purpose to show protection works.' : pua ? 'A potentially unwanted program: adware, bundled toolbars or similar.' : 'ClamAV recognises this file as malware.',
    });
  }
  return out;
}

/** "ClamAV 1.4.1/27450/Mon Oct 28 08:35:00 2026" → engine, signature version and date. */
export function parseClamVersion(text: string): { engine?: string; signatures?: number; date?: number } {
  const m = text.trim().match(/^ClamAV ([\d.]+)(?:\/(\d+)\/(.+))?$/);
  if (!m) return {};
  const date = m[3] ? Date.parse(m[3]) : NaN;
  return { engine: m[1], signatures: m[2] ? Number(m[2]) : undefined, date: Number.isNaN(date) ? undefined : date };
}
