// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Site and server monitors: a web page (status, a word on the page, the
// certificate's expiry), a TCP port, ping and a DNS name, each checked on its
// own interval. Pure: what a monitor is, importing a plain list, judging a
// check, when it counts as down or up again, and uptime and response times
// from the kept history. electron/services/site-monitor.ts runs the checks.

export type MonitorKind = 'http' | 'tcp' | 'ping' | 'dns';
export type DnsType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT';

export interface SiteMonitor {
  id: string;
  name: string;
  kind: MonitorKind;
  /** http: the address; tcp, ping, dns: the host name or address */
  target: string;
  /** tcp: the port */
  port?: number;
  /** http: a word or phrase that must be on the page (or must not, with keywordAbsent) */
  keyword?: string;
  keywordAbsent?: boolean;
  /** http: answers that count as up, e.g. "200-399" (the default) or "200,204" */
  expect?: string;
  /** dns: the record type, and a value the answer must include */
  dnsType?: DnsType;
  dnsExpect?: string;
  /** seconds between checks */
  interval: number;
  /** seconds before a check gives up */
  timeout: number;
  /** http: warn this many days before the certificate expires (0: never) */
  tlsDays: number;
  /** paused monitors are not checked */
  on: boolean;
  /** tell the Island, the system and phone alerts when it goes down or comes back */
  alerts: boolean;
  created: number;
}

export const INTERVALS = [30, 60, 300, 900, 3600];
export const KIND_LABEL: Record<MonitorKind, string> = { http: 'Website', tcp: 'Port', ping: 'Ping', dns: 'DNS name' };

/** Checks that fail this many times in a row make a monitor "down" (one blip is not an outage). */
export const DOWN_AFTER = 2;

export function newMonitor(p: Partial<SiteMonitor> & Pick<SiteMonitor, 'kind' | 'target'>, now = Date.now()): SiteMonitor {
  return {
    id: p.id ?? `m${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: p.name?.trim() || defaultName(p.kind, p.target, p.port),
    kind: p.kind,
    target: p.target.trim(),
    ...(p.port !== undefined ? { port: p.port } : {}),
    ...(p.keyword ? { keyword: p.keyword, keywordAbsent: !!p.keywordAbsent } : {}),
    ...(p.expect ? { expect: p.expect } : {}),
    ...(p.kind === 'dns' ? { dnsType: p.dnsType ?? 'A', ...(p.dnsExpect ? { dnsExpect: p.dnsExpect } : {}) } : {}),
    interval: INTERVALS.includes(p.interval ?? 0) ? p.interval! : 300,
    timeout: Math.max(2, Math.min(60, Math.round(p.timeout ?? 10))),
    tlsDays: p.kind === 'http' ? Math.max(0, Math.min(90, Math.round(p.tlsDays ?? 14))) : 0,
    on: p.on !== false,
    alerts: p.alerts !== false,
    created: p.created ?? now,
  };
}

export function defaultName(kind: MonitorKind, target: string, port?: number): string {
  if (kind === 'http') {
    try { return new URL(target).host; } catch { return target; }
  }
  return kind === 'tcp' && port ? `${target}:${port}` : target;
}

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const isHost = (h: string) => HOST.test(h) || IPV4.test(h) || /^[0-9a-f:]+$/i.test(h) && h.includes(':');

/** What is wrong with a monitor, in plain words; empty when it can be saved. */
export function monitorProblems(m: Partial<SiteMonitor>): string[] {
  const out: string[] = [];
  const t = (m.target ?? '').trim();
  if (m.kind === 'http') {
    try {
      const u = new URL(t);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') out.push('A website address starts with https://');
    } catch { out.push('Enter the full address, like https://example.com'); }
    if (m.expect && !parseExpect(m.expect)) out.push('Answers look like 200-399 or 200,204.');
  } else if (m.kind === 'tcp' || m.kind === 'ping' || m.kind === 'dns') {
    if (!isHost(t)) out.push('Enter a host name like example.com or an address like 192.168.1.10.');
    if (m.kind === 'tcp' && !(Number.isInteger(m.port) && m.port! > 0 && m.port! < 65536)) out.push('Enter a port between 1 and 65535.');
  } else out.push('Choose what to check.');
  return out;
}

/** "200-399,418" → ranges; undefined when it does not parse. */
export function parseExpect(s: string): [number, number][] | undefined {
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  const out: [number, number][] = [];
  for (const p of parts) {
    const m = /^(\d{3})(?:\s*-\s*(\d{3}))?$/.exec(p);
    if (!m) return undefined;
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    if (a < 100 || b > 599 || b < a) return undefined;
    out.push([a, b]);
  }
  return out;
}

// ---------------------------------------------------------------- import

/**
 * A plain list, one per line: a web address, "host:port", "tcp host port",
 * "ping host", "dns host [TYPE]", optionally after a name and a comma
 * ("Shop, https://shop.example"). Blank lines and # comments are skipped.
 */
export function parseMonitorList(text: string, now = Date.now()): { monitors: SiteMonitor[]; skipped: string[] } {
  const monitors: SiteMonitor[] = [];
  const skipped: string[] = [];
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    let name: string | undefined;
    let rest = line;
    const comma = /^([^,]+),\s*(.+)$/.exec(line);
    if (comma && !/^https?:\/\//i.test(line)) { name = comma[1].trim(); rest = comma[2].trim(); }
    const m = guessMonitor(rest);
    if (!m) { skipped.push(raw.trim()); continue; }
    const mon = newMonitor({ ...m, name, id: `m${now.toString(36)}${(n++).toString(36)}` }, now);
    if (monitorProblems(mon).length) skipped.push(raw.trim());
    else monitors.push(mon);
  }
  return { monitors, skipped };
}

function guessMonitor(s: string): Pick<SiteMonitor, 'kind' | 'target' | 'port' | 'dnsType'> | undefined {
  const words = s.split(/\s+/);
  const w0 = words[0].toLowerCase();
  if (/^https?:\/\//i.test(s)) return { kind: 'http', target: words[0] };
  if (w0 === 'ping' && words[1]) return { kind: 'ping', target: words[1] };
  if (w0 === 'dns' && words[1]) {
    const t = (words[2] ?? 'A').toUpperCase();
    return { kind: 'dns', target: words[1], dnsType: (['A', 'AAAA', 'CNAME', 'MX', 'TXT'].includes(t) ? t : 'A') as DnsType };
  }
  if ((w0 === 'tcp' || w0 === 'port') && words[1]) {
    const hp = /^(.+):(\d+)$/.exec(words[1]);
    return hp ? { kind: 'tcp', target: hp[1], port: Number(hp[2]) } : words[2] ? { kind: 'tcp', target: words[1], port: Number(words[2]) } : undefined;
  }
  const tcp = /^tcp:\/\/([^/:]+):(\d+)\/?$/i.exec(s) ?? /^([^\s/:]+):(\d+)$/.exec(s);
  if (tcp) return { kind: 'tcp', target: tcp[1], port: Number(tcp[2]) };
  // A bare domain is a website.
  if (words.length === 1 && HOST.test(s) && s.includes('.') && !IPV4.test(s)) return { kind: 'http', target: `https://${s}` };
  if (words.length === 1 && IPV4.test(s)) return { kind: 'ping', target: s };
  return undefined;
}

/** The list back as text, in the same form the import reads. */
export function monitorListText(list: SiteMonitor[]): string {
  return list.map((m) => {
    const t = m.kind === 'http' ? m.target : m.kind === 'tcp' ? `tcp ${m.target}:${m.port}` : m.kind === 'ping' ? `ping ${m.target}` : `dns ${m.target} ${m.dnsType ?? 'A'}`;
    return m.name && m.name !== defaultName(m.kind, m.target, m.port) ? `${m.name.replace(/,/g, ' ')}, ${t}` : t;
  }).join('\n');
}

// ---------------------------------------------------------------- judging a check

export interface CheckResult {
  at: number;
  ok: boolean;
  /** response time */
  ms?: number;
  /** http status, or the DNS answer */
  status?: number;
  /** what went wrong, or a note (the DNS answer) */
  message?: string;
  /** days until the certificate expires */
  tlsDays?: number;
  /** this computer cannot run this kind of check (no ping program): not an outage */
  unsupported?: boolean;
}

/** A finished web request, judged: status, the word on the page, the certificate. */
export function judgeHttp(m: SiteMonitor, r: { status: number; body?: string; ms: number; certExpires?: number }, now = Date.now()): CheckResult {
  const ranges = parseExpect(m.expect || '200-399') ?? [[200, 399]];
  const tlsDays = r.certExpires !== undefined ? Math.floor((r.certExpires - now) / 86_400_000) : undefined;
  const base = { at: now, ms: Math.round(r.ms), status: r.status, ...(tlsDays !== undefined ? { tlsDays } : {}) };
  if (!ranges.some(([a, b]) => r.status >= a && r.status <= b)) return { ...base, ok: false, message: `The site answered ${r.status}${STATUS_WORDS[r.status] ? ` (${STATUS_WORDS[r.status]})` : ''}` };
  if (m.keyword) {
    const found = (r.body ?? '').toLowerCase().includes(m.keyword.toLowerCase());
    if (found === !!m.keywordAbsent) return { ...base, ok: false, message: m.keywordAbsent ? `“${m.keyword}” is on the page` : `“${m.keyword}” is not on the page` };
  }
  if (tlsDays !== undefined && tlsDays < 0) return { ...base, ok: false, message: 'The certificate has expired' };
  return { ...base, ok: true };
}

const STATUS_WORDS: Record<number, string> = { 401: 'sign-in needed', 403: 'refused', 404: 'not found', 429: 'too many requests', 500: 'server error', 502: 'bad gateway', 503: 'unavailable', 504: 'gateway timeout' };

/** A network error as plain words. */
export function errorWords(code: string | undefined, message = ''): string {
  switch (code) {
    case 'ENOTFOUND': case 'EAI_AGAIN': return 'The name could not be found';
    case 'ECONNREFUSED': return 'Nothing answers on that port';
    case 'ECONNRESET': return 'The connection was cut';
    case 'ETIMEDOUT': case 'TIMEOUT': return 'No answer in time';
    case 'EHOSTUNREACH': case 'ENETUNREACH': return 'The host cannot be reached';
    case 'CERT_HAS_EXPIRED': return 'The certificate has expired';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT': case 'SELF_SIGNED_CERT_IN_CHAIN': return 'The certificate is self-signed';
    case 'ERR_TLS_CERT_ALTNAME_INVALID': return 'The certificate is for another name';
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE': case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY': return 'The certificate cannot be checked';
    case 'ENODATA': return 'The name has no such record';
    default: return message ? message.replace(/\s+/g, ' ').slice(0, 120) : 'The check failed';
  }
}

/** The round trip from a ping's output (macOS, Linux, Windows), in milliseconds. */
export function parsePing(out: string): number | undefined {
  const m = /time[=<]\s*([\d.,]+)\s*ms/i.exec(out) ?? /Zeit[=<]\s*([\d.,]+)\s*ms/i.exec(out) ?? /temps[=<]\s*([\d.,]+)\s*ms/i.exec(out);
  if (!m) return undefined;
  const v = Number(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
}

/** The ping command for this system: one packet, waiting at most `timeout` seconds. */
export function pingArgs(platform: string, host: string, timeout: number): { cmd: string; args: string[] } {
  const v6 = host.includes(':');
  if (platform === 'win32') return { cmd: 'ping', args: ['-n', '1', '-w', String(timeout * 1000), ...(v6 ? ['-6'] : []), host] };
  if (platform === 'darwin') return v6 ? { cmd: '/sbin/ping6', args: ['-c', '1', host] } : { cmd: '/sbin/ping', args: ['-c', '1', '-t', String(timeout), host] };
  return { cmd: 'ping', args: ['-c', '1', '-W', String(timeout), ...(v6 ? ['-6'] : []), host] };
}

/** A DNS answer judged against what was expected. */
export function judgeDns(m: SiteMonitor, answers: string[], ms: number, now = Date.now()): CheckResult {
  if (!answers.length) return { at: now, ok: false, ms: Math.round(ms), message: 'The name has no such record' };
  const shown = answers.slice(0, 3).join(', ');
  if (m.dnsExpect && !answers.some((a) => a.toLowerCase().includes(m.dnsExpect!.toLowerCase()))) return { at: now, ok: false, ms: Math.round(ms), message: `Answer changed: ${shown}` };
  return { at: now, ok: true, ms: Math.round(ms), message: shown };
}

// ---------------------------------------------------------------- state

export type MonitorState = 'up' | 'down' | 'pending' | 'paused';

export interface MonitorRuntime {
  state: MonitorState;
  /** failures in a row */
  fails: number;
  /** since when it is in this state */
  since: number;
  last?: CheckResult;
  /** the day a certificate warning was last sent (yyyy-mm-dd) */
  tlsWarned?: string;
}

export type MonitorEvent = { kind: 'down'; message: string } | { kind: 'up'; downFor: number } | { kind: 'tls'; days: number };

/** The next state after a check, and what to tell the person (if anything). */
export function step(rt: MonitorRuntime, r: CheckResult, m: Pick<SiteMonitor, 'tlsDays'>): { rt: MonitorRuntime; events: MonitorEvent[] } {
  // A check this computer cannot make says nothing about the server.
  if (r.unsupported) return { rt: { ...rt, state: 'paused', fails: 0, since: r.at, last: r }, events: [] };
  const events: MonitorEvent[] = [];
  const fails = r.ok ? 0 : rt.fails + 1;
  let state = rt.state;
  let since = rt.since;
  if (r.ok && rt.state !== 'up') {
    if (rt.state === 'down') events.push({ kind: 'up', downFor: r.at - rt.since });
    state = 'up';
    since = r.at;
  } else if (!r.ok && fails >= DOWN_AFTER && rt.state !== 'down') {
    events.push({ kind: 'down', message: r.message ?? 'The check failed' });
    state = 'down';
    since = r.at;
  } else if (!r.ok && rt.state === 'pending' && fails < DOWN_AFTER) {
    state = 'pending';
  }
  let tlsWarned = rt.tlsWarned;
  const day = new Date(r.at).toISOString().slice(0, 10);
  if (r.tlsDays !== undefined && m.tlsDays > 0 && r.tlsDays >= 0 && r.tlsDays <= m.tlsDays && tlsWarned !== day) {
    events.push({ kind: 'tls', days: r.tlsDays });
    tlsWarned = day;
  }
  return { rt: { state, fails, since, last: r, tlsWarned }, events };
}

export const startRuntime = (on: boolean, now = Date.now()): MonitorRuntime => ({ state: on ? 'pending' : 'paused', fails: 0, since: now });

// ---------------------------------------------------------------- history

/** Raw checks for the last day; older ones are kept as hourly summaries for 30 days. */
export interface MonitorHistory {
  recent: CheckResult[];
  hours: { h: number; n: number; ok: number; msSum: number; msN: number }[];
}

export const emptyHistory = (): MonitorHistory => ({ recent: [], hours: [] });
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function record(h: MonitorHistory, r: CheckResult, now = r.at): MonitorHistory {
  const recent = [...h.recent, r];
  const hours = h.hours.map((x) => ({ ...x }));
  // Checks older than a day move into their hour's summary.
  while (recent.length && recent[0].at < now - DAY) {
    const old = recent.shift()!;
    const hh = Math.floor(old.at / HOUR) * HOUR;
    let b = hours.find((x) => x.h === hh);
    if (!b) { b = { h: hh, n: 0, ok: 0, msSum: 0, msN: 0 }; hours.push(b); hours.sort((a, c) => a.h - c.h); }
    b.n++;
    if (old.ok) b.ok++;
    if (old.ms !== undefined) { b.msSum += old.ms; b.msN++; }
  }
  return { recent: recent.slice(-3000), hours: hours.filter((x) => x.h >= now - 30 * DAY) };
}

/** Share of checks that were up since a time, in percent (undefined with no checks). */
export function uptime(h: MonitorHistory, since: number): number | undefined {
  let n = 0;
  let ok = 0;
  for (const r of h.recent) if (r.at >= since) { n++; if (r.ok) ok++; }
  for (const b of h.hours) if (b.h >= since) { n += b.n; ok += b.ok; }
  return n ? Math.round((ok / n) * 10000) / 100 : undefined;
}

/** Response times for a chart: the last day in `buckets` steps (null where no check answered). */
export function responseSeries(h: MonitorHistory, now = Date.now(), buckets = 48): { t: number; ms: number | null; ok: boolean | null }[] {
  const span = DAY / buckets;
  const start = now - DAY;
  const out = Array.from({ length: buckets }, (_, i) => ({ t: start + i * span, sum: 0, n: 0, any: 0, bad: 0 }));
  for (const r of h.recent) {
    const i = Math.floor((r.at - start) / span);
    if (i < 0 || i >= buckets) continue;
    out[i].any++;
    if (!r.ok) out[i].bad++;
    if (r.ok && r.ms !== undefined) { out[i].sum += r.ms; out[i].n++; }
  }
  return out.map((b) => ({ t: b.t, ms: b.n ? Math.round(b.sum / b.n) : null, ok: b.any ? b.bad === 0 : null }));
}

/** Median response time of the last day's good checks. */
export function typicalMs(h: MonitorHistory): number | undefined {
  const v = h.recent.filter((r) => r.ok && r.ms !== undefined).map((r) => r.ms!).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : undefined;
}

/** Monitors that should be checked now. */
export function due(list: SiteMonitor[], lastRun: Record<string, number | undefined>, now = Date.now()): SiteMonitor[] {
  return list.filter((m) => m.on && (lastRun[m.id] === undefined || now - lastRun[m.id]! >= m.interval * 1000 - 2000));
}

/** How long the scheduler may sleep: until the next monitor is due, at least 15 s. */
export function nextWake(list: SiteMonitor[], lastRun: Record<string, number | undefined>, now = Date.now()): number | undefined {
  const on = list.filter((m) => m.on);
  if (!on.length) return undefined;
  const waits = on.map((m) => (lastRun[m.id] === undefined ? 0 : lastRun[m.id]! + m.interval * 1000 - now));
  return Math.max(15_000, Math.min(...waits));
}

/** "2 h 5 min" */
export function spanWords(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `${Math.round(h / 24)} days`;
}
