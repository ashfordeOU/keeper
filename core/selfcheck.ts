// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Check Keeper, and a problem report with nothing private in it. The self-check
// turns plain facts (can Keeper save, is the library read, are the permissions
// its parts need given, are its own processes and downloaded parts healthy,
// did it stop unexpectedly) into green or amber rows, each amber one with a
// Fix. The problem report is a zip of Keeper's own logs, last-moments notes and
// settings, with home folders, names, e-mail addresses, keys and tokens taken
// out, shown in full before it is saved. Nothing is sent: the person attaches
// it to an e-mail or an issue. Pure: electron/services/selfcheck.ts gathers.

export type CheckState = 'ok' | 'amber';

export interface CheckFix {
  label: string;
  /** a Keeper page ("settings:privacy"), or an action the main process runs */
  route?: string;
  action?: string;
}

export interface CheckRow {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  fix?: CheckFix;
}

export interface SelfCheckFacts {
  /** Keeper can write in its data folder */
  dataWritable: boolean;
  /** free space on the disk Keeper keeps its data on */
  dataFreeBytes?: number;
  index?: { files: number; indexing: boolean; folders: number };
  permissions?: { id: string; name: string; state: string; usedBy: string[] }[];
  parts?: { id: string; name: string; wanted: boolean; state: string }[];
  components?: { id: string; name: string; state: string; error?: string; neededBy: string[] }[];
  keychain?: 'ok' | 'locked' | 'none';
  /** unexpected stops in the last seven days */
  crashes7d?: number;
}

const GB = 1024 ** 3;
const list = (names: string[]) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`);

/** The rows, in a fixed order. */
export function selfCheckRows(f: SelfCheckFacts): CheckRow[] {
  const rows: CheckRow[] = [];
  rows.push(f.dataWritable
    ? { id: 'data', label: 'Saving', state: 'ok', detail: 'Keeper can save its settings and lists.' }
    : { id: 'data', label: 'Saving', state: 'amber', detail: 'Keeper can’t save in its data folder. The disk may be full or read-only.', fix: { label: 'Free up space', route: 'cleanup' } });
  if (f.dataFreeBytes !== undefined) {
    rows.push(f.dataFreeBytes >= 2 * GB
      ? { id: 'space', label: 'Room on the disk', state: 'ok', detail: `${Math.floor(f.dataFreeBytes / GB)} GB free.` }
      : { id: 'space', label: 'Room on the disk', state: 'amber', detail: 'Under 2 GB free: updates and downloads may fail.', fix: { label: 'Free up space', route: 'cleanup' } });
  }
  if (f.index) {
    const i = f.index;
    rows.push(i.indexing
      ? { id: 'index', label: 'Your library', state: 'ok', detail: 'Reading your folders now.' }
      : i.files > 0 || i.folders === 0
        ? { id: 'index', label: 'Your library', state: 'ok', detail: `${i.files.toLocaleString('en-GB')} file${i.files === 1 ? '' : 's'} known.` }
        : { id: 'index', label: 'Your library', state: 'amber', detail: 'No files found in your folders yet.', fix: { label: 'Read them again', action: 'rescan' } });
  }
  if (f.permissions) {
    const missing = f.permissions.filter((p) => (p.state === 'missing' || p.state === 'denied') && p.usedBy.length);
    rows.push(missing.length
      ? { id: 'permissions', label: 'Permissions', state: 'amber', detail: `${list(missing.map((p) => p.name))} ${missing.length === 1 ? 'is' : 'are'} not allowed yet.`, fix: { label: 'Allow', route: 'settings:privacy' } }
      : { id: 'permissions', label: 'Permissions', state: 'ok', detail: 'Everything your parts need is allowed.' });
  }
  if (f.parts) {
    const wanted = f.parts.filter((p) => p.wanted);
    const down = wanted.filter((p) => p.state === 'failed' || p.state === 'off' || p.state === 'waiting');
    rows.push(down.length
      ? { id: 'parts', label: 'Keeper’s helpers', state: 'amber', detail: `${list(down.map((p) => p.name))} ${down.length === 1 ? 'is' : 'are'} not running.`, fix: { label: 'Start again', action: `restart:${down[0].id}` } }
      : { id: 'parts', label: 'Keeper’s helpers', state: 'ok', detail: wanted.length ? `${list(wanted.map((p) => p.name))} ${wanted.length === 1 ? 'is' : 'are'} running.` : 'Nothing extra needs to run.' });
  }
  if (f.components) {
    const needed = f.components.filter((c) => c.neededBy.length);
    // Not downloaded yet is fine (it comes on first use); a failed check or an old copy is not.
    const bad = needed.filter((c) => c.state === 'error' || c.state === 'outdated');
    const ready = needed.filter((c) => ['installed', 'bundled', 'dev'].includes(c.state)).length;
    rows.push(bad.length
      ? { id: 'components', label: 'Downloaded parts', state: 'amber', detail: `${list(bad.map((c) => c.name))} ${bad.length === 1 ? 'needs' : 'need'} downloading again.`, fix: { label: 'Download', action: `component:${bad[0].id}` } }
      : { id: 'components', label: 'Downloaded parts', state: 'ok', detail: ready ? `${ready} checked and ready; the rest come when first used.` : 'They come when first used.' });
  }
  if (f.keychain) {
    rows.push(f.keychain === 'locked'
      ? { id: 'keychain', label: 'Passwords', state: 'amber', detail: 'The keychain didn’t open, so saved sign-ins can’t be read.', fix: { label: 'Try again', action: 'keychain' } }
      : { id: 'keychain', label: 'Passwords', state: 'ok', detail: f.keychain === 'ok' ? 'Kept in the system’s keychain.' : 'No keychain here: sign-ins are kept until Keeper quits.' });
  }
  if (f.crashes7d !== undefined) {
    rows.push(f.crashes7d > 0
      ? { id: 'crashes', label: 'Unexpected stops', state: 'amber', detail: `Keeper stopped unexpectedly ${f.crashes7d === 1 ? 'once' : `${f.crashes7d} times`} this week.`, fix: { label: 'Make a problem report', action: 'report' } }
      : { id: 'crashes', label: 'Unexpected stops', state: 'ok', detail: 'None this week.' });
  }
  return rows;
}

/** "All 8 checks look good" or "2 things to look at". */
export function checkSummary(rows: CheckRow[]): string {
  const amber = rows.filter((r) => r.state === 'amber').length;
  return amber ? `${amber} thing${amber === 1 ? '' : 's'} to look at` : `All ${rows.length} checks look good`;
}

// ---------------------------------------------------------------- redaction

export interface RedactContext {
  /** the home folder ("/Users/ana", "C:\\Users\\ana") */
  home?: string;
  /** the account's user name */
  user?: string;
  /** the computer's name */
  host?: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Takes out what could identify the person or open their accounts: the home
 * folder (shown as ~), other people's home folders, the user and computer
 * names, e-mail addresses, keys and tokens (API keys, bearer tokens, JWTs,
 * "password=…"), long secrets, IP and hardware addresses.
 */
export function redact(text: string, ctx: RedactContext = {}): string {
  let t = text;
  if (ctx.home && ctx.home.length > 3) {
    const forms = new Set([ctx.home, ctx.home.replace(/\\/g, '/'), ctx.home.replace(/\//g, '\\'), ctx.home.replace(/\\/g, '\\\\')]);
    for (const h of [...forms].sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(esc(h), 'gi'), '~');
  }
  // Anyone else's home folder.
  t = t.replace(/(\/Users\/|\/home\/|[A-Za-z]:\\{1,2}Users\\{1,2})[^/\\\s"'<>]+/g, (_m, p: string) => `${p}<user>`);
  // Bounded, so a long run of letters with no @ stays quick.
  t = t.replace(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g, '<email>');
  t = t.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,4096}/gi, '$1 <secret>');
  t = t.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '<secret>');
  t = t.replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '<secret>');
  t = t.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '<secret>');
  t = t.replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '<secret>');
  t = t.replace(/\bAKIA[0-9A-Z]{16}\b/g, '<secret>');
  t = t.replace(/((?:password|passwd|pwd|token|secret|api[_-]?key|apikey|auth|session|cookie)["']?\s*[:=]\s*["']?)([^"'\s,&;}]+)/gi, '$1<secret>');
  t = t.replace(/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, '<secret>');
  t = t.replace(/\b[A-Za-z0-9+_-]{40,}={0,2}/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? '<secret>' : m));
  t = t.replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '<mac>');
  t = t.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) => (m === '127.0.0.1' || m === '0.0.0.0' ? m : '<ip>'));
  if (ctx.user && ctx.user.length >= 3) t = t.replace(new RegExp(`(^|[^A-Za-z0-9])${esc(ctx.user)}(?![A-Za-z0-9])`, 'gi'), '$1<user>');
  if (ctx.host && ctx.host.length >= 3) t = t.replace(new RegExp(`(^|[^A-Za-z0-9])${esc(ctx.host)}(?![A-Za-z0-9])`, 'gi'), '$1<computer>');
  return t;
}

export interface ReportFile {
  name: string;
  /** what it is, in a few words */
  what: string;
  text: string;
}

/** The about file: what Keeper is, on what, and what the self-check said. */
export function aboutText(o: { version: string; platform: string; release: string; arch: string; partsOn: string[]; rows: CheckRow[]; at: Date }): string {
  return [
    `Keeper ${o.version}`,
    `System: ${o.platform} ${o.release} (${o.arch})`,
    `Made: ${o.at.toISOString()}`,
    '',
    `Check Keeper: ${checkSummary(o.rows)}`,
    ...o.rows.map((r) => `  ${r.state === 'ok' ? '✓' : '!'} ${r.label}: ${r.detail}`),
    '',
    `Parts on (${o.partsOn.length}): ${o.partsOn.join(', ')}`,
    '',
    'Names, folders, e-mail addresses, keys and tokens were taken out before saving. Nothing was sent.',
  ].join('\n');
}

/** Every file of the report, redacted. Files over 2 MB are cut to their last 2 MB. */
export function reportFiles(parts: ReportFile[], ctx: RedactContext): ReportFile[] {
  const MAX = 2 * 1024 * 1024;
  return parts.map((p) => {
    const text = redact(p.text, ctx);
    return { ...p, text: text.length > MAX ? `[the first part was left out]\n${text.slice(-MAX)}` : text };
  });
}

/** keeper-problem-report-2026-11-04.zip */
export const reportName = (at: Date) => `keeper-problem-report-${at.toISOString().slice(0, 10)}.zip`;
