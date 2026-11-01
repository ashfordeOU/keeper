// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's firewall: rules, profiles, alerts, the DNS filter with blocklists
// and encrypted DNS, traffic history and unusual-transfer warnings. Rules are
// decided by core/fw/rules.ts and put into the system by ./backends.ts.
// Nothing runs while every part is switched off; watching for new connections
// goes through the governor and slows down when the person is away.

import { app, dialog } from 'electron';
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import dns from 'node:dns';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import type { FwAlert, FwConnection, FwEvent, FwSettings, FwStatus } from '../../../core/api-fw';
import { CURATED_LISTS, DomainSet, IpSet, parseList, type ListInfo } from '../../../core/fw/blocklist';
import { UPSTREAMS, type QueryLogEntry, type Upstream } from '../../../core/fw/dns';
import { emptyHistory, isUnusual, prune, record, series, updateBaseline, type Baseline, type History } from '../../../core/fw/monitor';
import { decide, defaultFwState, exportRules, importRules, profileForNetwork, recordHit, ruleFromAlert, tidy, type AlertScope, type Conn, type FwRule, type FwState, type Mode, type Profile, type RuleGroup } from '../../../core/fw/rules';
import type { NetSample } from '../../../core/net/flows';
import { run } from '../../../core/platform';
import { poll } from '../governor';
import { backendFor, FW_TESTABLE, type Backend } from './backends';
import { Resolver } from './resolver';

const dir = () => path.join(app.getPath('userData'), 'firewall');
const file = (n: string) => path.join(dir(), n);
const STARTED = Date.now();

const DEFAULT_SETTINGS: FwSettings = {
  enforce: false, defaultBlock: false, alerts: false, dnsFilter: false, dnsPort: 5353, upstream: 'quad9-doh', customUpstreams: [],
  lists: CURATED_LISTS.map((l) => ({ ...l, enabled: false })), history: true, unusual: true, sounds: {}, soundByData: false,
};

let state: FwState = defaultFwState();
let settings: FwSettings = { ...DEFAULT_SETTINGS };
let domainRules: Record<string, 'allow' | 'deny'> = {};
let loaded = false;
let backend: Backend | undefined;
let enforcement: FwStatus['enforcement'] = { active: false, backend: '' };
let resolver: Resolver | undefined;
let dnsError: string | undefined;
let domains = new DomainSet();
let ips = new IpSet();
let listEntries = 0;
const queryLog: QueryLogEntry[] = [];
const pending = new Map<string, FwAlert>();
const recent: FwEvent[] = [];
const ipNames = new Map<string, string>();
let history: History = emptyHistory();
let baselines: Record<string, Baseline> = {};
let minuteBytes = new Map<string, number>();
let minuteAt = 0;
let deps: { alert: (title: string, detail: string) => void; broadcast: (ch: string, ...a: unknown[]) => void; sample: () => Promise<NetSample>; network?: () => Promise<{ ssid?: string; gateway?: string }> };
let stopWatch: (() => void) | undefined;
let stopBlocked: (() => void) | undefined;

// ---------------------------------------------------------------- storage

async function writeAtomic(p: string, data: string) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data, { mode: 0o600 });
  await fsp.rename(tmp, p);
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const s = JSON.parse(await fsp.readFile(file('state.json'), 'utf8'));
    state = { ...defaultFwState(), ...s.state };
    settings = { ...DEFAULT_SETTINGS, ...s.settings };
    // New curated lists appear; the person's choices for the old ones stay.
    const have = new Map(settings.lists.map((l) => [l.id, l]));
    settings.lists = [...CURATED_LISTS.map((l) => ({ ...l, ...have.get(l.id), url: l.url })), ...settings.lists.filter((l) => !CURATED_LISTS.some((c) => c.id === l.id))];
    domainRules = s.domainRules ?? {};
  } catch { /* first run */ }
  try { history = JSON.parse(await fsp.readFile(file('history.json'), 'utf8')); prune(history, Date.now()); } catch { /* none yet */ }
  try { baselines = JSON.parse(await fsp.readFile(file('baselines.json'), 'utf8')); } catch { /* none yet */ }
  // Rules "until Keeper quits" from an earlier run are over.
  for (const g of state.groups) g.rules = g.rules.filter((r) => r.until !== 'quit' || r.created >= STARTED);
}

let saveTimer: NodeJS.Timeout | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void writeAtomic(file('state.json'), JSON.stringify({ state, settings, domainRules }, null, 1)), 400);
}
async function saveHistory() {
  await writeAtomic(file('history.json'), JSON.stringify(history));
  await writeAtomic(file('baselines.json'), JSON.stringify(baselines));
}

function event(e: Omit<FwEvent, 't'>) {
  recent.unshift({ t: Date.now(), ...e });
  if (recent.length > 300) recent.length = 300;
  deps?.broadcast('fw-event', recent[0]);
}

const changeListeners = new Set<() => void>();
/** Called after every firewall change (profile switches included); returns a stop function. */
export function onFwChanged(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function changed() {
  save();
  resolver?.flush();
  deps?.broadcast('fw-changed');
  for (const fn of changeListeners) try { fn(); } catch { /* a listener's problem stays its own */ }
}

// ---------------------------------------------------------------- who is connecting

const DEVTOOLS = /^(node|python3?|ruby|go|cargo|rustc|java|dotnet|git|ssh|curl|wget|npm|pnpm|yarn|bun|deno|code|code helper.*|docker|kubectl|terraform|gradle|mvn|pip3?)(\.exe)?$/i;
const BROWSERS = /^(google chrome.*|chrome|chromium|firefox|safari|msedge|microsoft edge.*|brave.*|opera.*|vivaldi.*|arc|orion)(\.exe)?$/i;
const SYSTEM_PATH = /^(\/system\/|\/usr\/libexec\/|\/usr\/sbin\/|\/sbin\/|\/usr\/lib\/systemd\/|c:[\\/]windows[\\/])/i;
const signers = new Map<string, Promise<string | undefined>>();

/** Code signature of a program: macOS team id, Windows Authenticode signer, Linux package (cached). */
export function signerOf(p?: string): Promise<string | undefined> {
  if (!p || !existsSync(p)) return Promise.resolve(undefined);
  let s = signers.get(p);
  if (!s) {
    s = (async () => {
      if (process.platform === 'darwin') {
        const r = await run('/usr/bin/codesign', ['-dv', '--verbose=2', p.replace(/(\.app)\/Contents\/.*$/, '$1')], 5000);
        const out = r.stdout + r.stderr;
        return out.match(/TeamIdentifier=(\S+)/)?.[1]?.replace('not set', '') || out.match(/Authority=([^\n]+)/)?.[1] || undefined;
      }
      if (process.platform === 'win32') {
        const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const r = await run(ps, ['-NoProfile', '-NonInteractive', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${p.replace(/['‘’‚‛]/g, '$&$&')}').SignerCertificate.Subject`], 8000);
        return r.stdout.match(/CN=("[^"]+"|[^,]+)/)?.[1]?.replace(/"/g, '').trim() || undefined;
      }
      const r = await run('dpkg', ['-S', p], 4000);
      if (r.ok) return `deb:${r.stdout.split(':')[0]}`;
      const q = await run('rpm', ['-qf', '--qf', '%{NAME}', p], 4000);
      return q.ok ? `rpm:${q.stdout.trim()}` : undefined;
    })().catch(() => undefined);
    signers.set(p, s);
  }
  return s;
}

function appInfo(name: string, p?: string): Conn['app'] {
  const base = (p ? path.basename(p) : name).toLowerCase();
  return { path: p, name, system: !!p && SYSTEM_PATH.test(p), devtool: DEVTOOLS.test(base), browser: BROWSERS.test(base) };
}

// ---------------------------------------------------------------- DNS filter

function upstreamById(id: string): Upstream {
  return [...UPSTREAMS, ...settings.customUpstreams].find((u) => u.id === id) ?? UPSTREAMS[0];
}

/** What blocks a name: a host rule (deny), the person's domain list, or a blocklist. */
function nameBlockedBy(name: string): string | undefined {
  let h = name.toLowerCase();
  for (;;) {
    const v = domainRules[h];
    if (v === 'allow') return undefined;
    if (v === 'deny') return `your list (${h})`;
    const i = h.indexOf('.');
    if (i < 0) break;
    h = h.slice(i + 1);
  }
  // Host rules that deny for any app apply to everybody's DNS.
  for (const g of state.groups) if (g.enabled) for (const r of g.rules) {
    if (r.enabled && r.verdict === 'deny' && (r.app === 'any' || (r.app as { group?: string }).group === 'any') && r.host && r.host !== 'any' && !r.port) {
      const pat = r.host.replace(/^=/, '');
      if (name === pat || (!r.host.startsWith('=') && name.endsWith('.' + pat.replace(/^\*\./, '')))) return `rule in “${g.name}”`;
    }
  }
  const list = domains.match(name);
  return list ? settings.lists.find((l) => l.id === list)?.name ?? list : undefined;
}

async function loadLists() {
  const d = new DomainSet();
  const ip = new IpSet();
  let n = 0;
  for (const l of settings.lists.filter((x) => x.enabled)) {
    try {
      const text = await fsp.readFile(file(`lists/${l.id}.txt`), 'utf8');
      const p = parseList(text, l.format);
      d.add(p.domains, l.id);
      d.allow(p.allow);
      ip.add(p.cidrs, l.id);
      n += p.domains.length + p.cidrs.length;
    } catch { /* not downloaded yet */ }
  }
  domains = d;
  ips = ip;
  listEntries = n;
  resolver?.flush();
}

async function download(url: string): Promise<Buffer> {
  if (!/^https:\/\//i.test(url)) throw new Error('Lists and subscriptions are only fetched over https');
  const res = await fetch(url, { headers: { 'user-agent': `Keeper/${app.getVersion()}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 64 * 1024 * 1024) throw new Error('The list is too large');
  return buf;
}

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Refreshes enabled lists (daily through the governor, or when asked). A pinned checksum must match. */
async function updateLists(force = false) {
  for (const l of settings.lists.filter((x) => x.enabled)) {
    if (!force && l.updated && Date.now() - l.updated < 23 * 3600_000 && existsSync(file(`lists/${l.id}.txt`))) continue;
    try {
      const buf = await download(l.url);
      const sum = sha256(buf);
      if (l.sha256 && l.sha256 !== sum && (l as ListInfo & { pinned?: boolean }).pinned) throw new Error('The list changed and its checksum is pinned; accept the new version in Settings');
      const parsed = parseList(buf.toString('utf8'), l.format);
      if (!parsed.domains.length && !parsed.cidrs.length) throw new Error('The download had no entries');
      await writeAtomic(file(`lists/${l.id}.txt`), buf.toString('utf8'));
      Object.assign(l, { sha256: sum, updated: Date.now(), entries: parsed.domains.length + parsed.cidrs.length, error: undefined });
    } catch (e) {
      l.error = (e as Error).message;
    }
  }
  await loadLists();
  changed();
}

async function startResolver() {
  await resolver?.stop().catch(() => undefined);
  resolver = undefined;
  dnsError = undefined;
  if (!settings.dnsFilter) return;
  try {
    const r = new Resolver({
      port: settings.dnsPort,
      upstream: upstreamById(settings.upstream),
      blocked: nameBlockedBy,
      onLog: (e) => { queryLog.unshift(e); if (queryLog.length > 2000) queryLog.length = 2000; if (e.blockedBy) event({ kind: 'denied', host: e.name, message: `${e.name} blocked by ${e.blockedBy}` }); },
      onAnswer: (name, addrs) => { for (const a of addrs) ipNames.set(a, name); if (ipNames.size > 20_000) ipNames.delete(ipNames.keys().next().value!); },
      test: FW_TESTABLE && process.env.KEEPER_FW_TEST_CA ? { ca: await fsp.readFile(process.env.KEEPER_FW_TEST_CA), rejectUnauthorized: true } : undefined,
    });
    const port = await r.start();
    settings.dnsPort = port;
    resolver = r;
  } catch (e) {
    dnsError = (e as Error).message.includes('EACCES') ? `Port ${settings.dnsPort} needs the administrator; choose a port above 1024 or install the helper` : (e as Error).message;
  }
}

// ---------------------------------------------------------------- enforcement

async function resolveHosts(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const hosts = new Set(state.groups.flatMap((g) => g.rules).filter((r) => r.enabled && r.host && r.host !== 'any').map((r) => r.host!));
  for (const h of hosts) {
    const name = h.replace(/^=|^\*\./, '');
    const addrs = await Promise.all([dns.promises.resolve4(name).catch(() => []), dns.promises.resolve6(name).catch(() => [])]);
    out.set(h, addrs.flat());
  }
  return out;
}

async function applyNow() {
  if (!settings.enforce) return;
  backend ??= backendFor();
  const r = await backend.apply(state.groups, { defaultBlock: settings.defaultBlock, resolved: await resolveHosts() });
  enforcement = { active: r.ok, backend: backend.name, message: r.message, appliedAt: r.ok ? Date.now() : enforcement.appliedAt };
  event({ kind: r.ok ? 'applied' : 'error', message: r.message });
  watchBlocked();
}

function watchBlocked() {
  stopBlocked?.();
  stopBlocked = undefined;
  if (!settings.enforce || !settings.alerts) return;
  backend ??= backendFor();
  stopBlocked = backend.watchBlocked((a) => {
    const host = ipNames.get(a.remote);
    raise({ app: { ...appInfo(a.app ? path.basename(a.app) : 'Unknown app', a.app) }, direction: a.direction, host, ip: a.remote, port: a.remotePort ?? 0, proto: a.proto === 'udp' ? 'udp' : a.proto === 'icmp' ? 'icmp' : 'tcp' }, false);
  });
}

// ---------------------------------------------------------------- alerts

function alertKey(c: Conn) {
  return `${c.app.path ?? c.app.name}|${c.host ?? c.ip}|${c.port}|${c.direction}`;
}

function raise(c: Conn, monitorOnly: boolean) {
  const key = alertKey(c);
  const have = pending.get(key);
  if (have) { have.attempts++; return; }
  const d = decide(state, c, Date.now(), STARTED);
  if (d.verdict !== 'ask') { recordHit(d); if (d.verdict === 'deny' && monitorOnly) event({ kind: 'would-deny', app: c.app.name, host: c.host, ip: c.ip, port: c.port, ruleId: d.rule?.id, message: `${c.app.name} → ${c.host ?? c.ip}:${c.port} would have been blocked (${d.reason})` }); return; }
  if (pending.size >= 50) return; // never flood the screen; the rest show in the list
  const alert: FwAlert = { id: key, t: Date.now(), conn: c, monitorOnly, attempts: 1 };
  pending.set(key, alert);
  void signerOf(c.app.path).then((s) => { if (s) { alert.conn.app.signer = s; deps?.broadcast('fw-changed'); } });
  event({ kind: 'asked', app: c.app.name, host: c.host, ip: c.ip, port: c.port, message: `${c.app.name} wants to connect to ${c.host ?? c.ip}:${c.port}` });
  deps?.alert(`${c.app.name} wants to connect`, `${c.host ?? c.ip}:${c.port}${monitorOnly ? ' (seen, not held)' : ''}`);
  deps?.broadcast('fw-alert', alert);
}

// ---------------------------------------------------------------- watching

let lastKeys = new Set<string>();
async function watchOnce() {
  if (!deps) return;
  let s: NetSample;
  try { s = await deps.sample(); } catch { return; }
  const now = Date.now();
  // History: bytes per app since the last reading (rates × time).
  if (settings.history || settings.unusual) {
    const dt = 10;
    for (const a of s.apps) {
      const inB = Math.round((a.rateIn ?? 0) * dt);
      const outB = Math.round((a.rateOut ?? 0) * dt);
      if (settings.history) record(history, now, a.app, inB, outB);
      minuteBytes.set(a.app, (minuteBytes.get(a.app) ?? 0) + inB + outB);
    }
    if (now - minuteAt >= 60_000) {
      if (settings.unusual) for (const [appName, b] of minuteBytes) {
        const u = isUnusual(baselines[appName], b);
        if (u.unusual) { event({ kind: 'unusual', app: appName, bytes: b, message: `${appName} sent and received ${(b / 1e6).toFixed(0)} MB in a minute, about ${u.times}× its usual` }); deps.alert(`${appName} is using far more network than usual`, `${(b / 1e6).toFixed(0)} MB in the last minute`); }
        baselines[appName] = updateBaseline(baselines[appName], b);
      }
      minuteBytes = new Map();
      minuteAt = now;
    }
  }
  // Alerts (monitor): new outbound internet connections without a rule.
  if (settings.alerts) {
    const keys = new Set<string>();
    for (const f of s.flows) {
      if (!f.remote || f.scope !== 'internet' || f.state === 'LISTEN') continue;
      const host = f.host ?? ipNames.get(f.remote);
      const k = `${f.appPath ?? f.app}|${host ?? f.remote}|${f.remotePort}`;
      keys.add(k);
      if (lastKeys.has(k)) continue;
      raise({ app: appInfo(f.app, f.appPath), direction: 'out', host, ip: f.remote, port: f.remotePort ?? 0, proto: f.proto === 'UDP' ? 'udp' : 'tcp' }, !settings.enforce);
    }
    lastKeys = keys;
  }
  // Profiles that follow the network.
  if (state.autoSwitch && deps.network) {
    const p = profileForNetwork(state, await deps.network().catch(() => ({})));
    if (p && p !== state.activeProfile) { state.activeProfile = p; event({ kind: 'applied', message: `Switched to the “${state.profiles.find((x) => x.id === p)?.name}” profile for this network` }); changed(); void applyNow(); }
  }
}

function restartWatch() {
  stopWatch?.();
  stopWatch = undefined;
  // History and unusual-transfer warnings only run once the firewall is in use (enforcing rules,
  // asking about connections, filtering DNS or following networks): until then it costs nothing.
  const inUse = settings.enforce || settings.alerts || settings.dnsFilter || state.autoSwitch;
  if (inUse && (settings.alerts || settings.history || settings.unusual || state.autoSwitch)) {
    stopWatch = poll('fw.watch', { baseMs: 10_000, idleFactor: 3, maxMs: 60_000 }, () => watchOnce(), { feature: 'firewall' });
  }
}

// ---------------------------------------------------------------- the API

async function status(): Promise<FwStatus> {
  await load();
  backend ??= backendFor();
  return {
    platform: process.platform,
    caps: backend.caps(),
    state,
    settings,
    enforcement,
    dns: { running: !!resolver, port: resolver ? settings.dnsPort : undefined, upstream: settings.upstream, queries: resolver?.stats.queries ?? 0, blocked: resolver?.stats.blocked ?? 0, listsEntries: listEntries, error: dnsError, doqAvailable: false },
    pending: [...pending.values()].sort((a, b) => b.t - a.t),
    recent: recent.slice(0, 100),
    upstreams: [...UPSTREAMS, ...settings.customUpstreams, { id: 'doq-quad9', name: 'Quad9 over QUIC (not available yet)', kind: 'doq', address: 'dns.quad9.net:853' }],
  };
}

function group(id: string): RuleGroup {
  const g = state.groups.find((x) => x.id === id);
  if (!g) throw new Error('No such rule group');
  return g;
}

export const fwApi = {
  status,
  async setSettings(patch: Partial<FwSettings>) {
    await load();
    const before = { ...settings };
    settings = { ...settings, ...patch };
    if (patch.lists) await updateLists(false);
    if (before.dnsFilter !== settings.dnsFilter || before.upstream !== settings.upstream || (patch.dnsPort !== undefined && patch.dnsPort !== before.dnsPort)) await startResolver();
    if (before.enforce && !settings.enforce) { const r = await (backend ??= backendFor()).remove(); enforcement = { active: false, backend: backend.name, message: r.message }; }
    if ((!before.enforce && settings.enforce) || before.defaultBlock !== settings.defaultBlock) await applyNow();
    watchBlocked();
    restartWatch();
    changed();
    return status();
  },
  async setMode(mode: Mode) { await load(); state.mode = mode; changed(); event({ kind: 'applied', message: mode === 'alert' ? 'Asking about new connections' : mode === 'silent-allow' ? 'Quiet mode: allowing and remembering' : 'Quiet mode: denying' }); return status(); },
  async setProfile(id: string) { await load(); if (!state.profiles.some((p) => p.id === id)) throw new Error('No such profile'); state.activeProfile = id; changed(); await applyNow(); return status(); },
  async saveProfile(p: Profile) { await load(); const i = state.profiles.findIndex((x) => x.id === p.id); if (i >= 0) state.profiles[i] = p; else state.profiles.push(p); changed(); return status(); },
  async removeProfile(id: string) { await load(); if (state.profiles.length <= 1) throw new Error('Keep at least one profile'); state.profiles = state.profiles.filter((p) => p.id !== id); if (state.activeProfile === id) state.activeProfile = state.profiles[0].id; changed(); return status(); },
  async setAutoSwitch(on: boolean) { await load(); state.autoSwitch = on; restartWatch(); changed(); return status(); },
  async saveRule(groupId: string, rule: FwRule) {
    await load();
    const g = group(groupId);
    const i = g.rules.findIndex((r) => r.id === rule.id);
    if (i >= 0) g.rules[i] = rule; else g.rules.push(rule);
    changed();
    await applyNow();
    return status();
  },
  async removeRule(groupId: string, ruleId: string) { await load(); const g = group(groupId); g.rules = g.rules.filter((r) => r.id !== ruleId); changed(); await applyNow(); return status(); },
  async saveGroup(g: Omit<RuleGroup, 'rules'> & { rules?: FwRule[] }) {
    await load();
    const have = state.groups.find((x) => x.id === g.id);
    if (have) Object.assign(have, { ...g, rules: g.rules ?? have.rules }); else state.groups.push({ ...g, rules: g.rules ?? [] });
    changed();
    await applyNow();
    return status();
  },
  async removeGroup(id: string) { await load(); if (id === 'mine') throw new Error('“My rules” stays; you can turn it off'); state.groups = state.groups.filter((g) => g.id !== id); changed(); await applyNow(); return status(); },
  async subscribe(url: string, name?: string) {
    await load();
    const u = new URL(url);
    // A checksum after # (#sha256=…) pins the exact version; "#key=<base64 Ed25519>" checks a signature at <url>.sig.
    const pin = u.hash.match(/sha256=([0-9a-f]{64})/i)?.[1];
    const key = u.hash.match(/key=([A-Za-z0-9+/=_-]+)/)?.[1];
    u.hash = '';
    const g: RuleGroup = { id: `sub-${sha256(u.toString()).slice(0, 10)}`, name: name ?? u.hostname, enabled: true, source: { kind: 'subscription', url: u.toString(), sha256: pin, ...(key ? { publicKey: key } : {}) } as RuleGroup['source'], rules: [] };
    state.groups = state.groups.filter((x) => x.id !== g.id);
    state.groups.push(g);
    await refreshSubscription(g);
    changed();
    await applyNow();
    return status();
  },
  async refreshSubscriptions() { await load(); for (const g of state.groups) if (g.source.kind === 'subscription') await refreshSubscription(g); changed(); await applyNow(); return status(); },
  async tidy() { await load(); return tidy(state); },
  async exportRules(groupIds?: string[]) {
    await load();
    const r = await dialog.showSaveDialog({ defaultPath: 'Keeper firewall rules.json', filters: [{ name: 'Keeper rules', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, exportRules(state, groupIds));
    return r.filePath;
  },
  async importRules() {
    await load();
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Keeper rules', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const res = importRules(await fsp.readFile(r.filePaths[0], 'utf8'));
    let n = 0;
    for (const g of res.groups) {
      const id = state.groups.some((x) => x.id === g.id) ? `${g.id}-imported-${Date.now().toString(36)}` : g.id;
      state.groups.push({ ...g, id, source: { kind: 'local' } });
      n += g.rules.length;
    }
    for (const p of res.profiles) if (!state.profiles.some((x) => x.id === p.id)) state.profiles.push(p);
    changed();
    await applyNow();
    return { imported: n, problems: res.problems };
  },
  async answer(alertId: string, verdict: 'allow' | 'deny', scope: AlertScope, opts: { anyPort?: boolean; wholeDomain?: boolean; anyHost?: boolean } = {}) {
    await load();
    const a = pending.get(alertId);
    if (!a) return status();
    pending.delete(alertId);
    a.conn.app.signer ??= await signerOf(a.conn.app.path);
    if (scope !== 'once') {
      const r = ruleFromAlert(a.conn, verdict, scope, opts);
      r.note = `${a.conn.app.name} → ${a.conn.host ?? a.conn.ip}`;
      group('mine').rules.push(r);
      changed();
      await applyNow();
    }
    event({ kind: verdict === 'allow' ? 'allowed' : 'denied', app: a.conn.app.name, host: a.conn.host, ip: a.conn.ip, port: a.conn.port, message: `${verdict === 'allow' ? 'Allowed' : 'Denied'} ${a.conn.app.name} → ${a.conn.host ?? a.conn.ip}:${a.conn.port} ${scope === 'once' ? 'once' : scope === 'forever' ? 'always' : scope === 'quit' ? 'until Keeper quits' : 'for an hour'}` });
    return status();
  },
  async connections(): Promise<FwConnection[]> {
    await load();
    const s = await deps.sample();
    return s.flows.filter((f) => f.remote && f.state !== 'LISTEN').map((f) => {
      const host = f.host ?? ipNames.get(f.remote!);
      const c: Conn = { app: appInfo(f.app, f.appPath), direction: 'out', host, ip: f.remote!, port: f.remotePort ?? 0, proto: f.proto === 'UDP' ? 'udp' : 'tcp' };
      const d = decide(state, c, Date.now(), STARTED);
      const listed = (host && nameBlockedBy(host)) || ips.match(f.remote!);
      return { key: f.key, app: f.app, appPath: f.appPath, host, ip: f.remote, port: f.remotePort, proto: f.proto, country: f.country, asn: f.asn, service: f.service, rateIn: f.rateIn ?? 0, rateOut: f.rateOut ?? 0, bytesIn: f.bytesIn, bytesOut: f.bytesOut, decision: listed ? 'deny' : d.verdict, ruleId: d.rule?.id, reason: listed ? `On a blocklist (${listed})` : d.reason, path: f.path };
    });
  },
  async history(from: number, to: number, appName?: string) {
    await load();
    const points = series(history, from, to, { app: appName });
    const tier = to - from <= 24 * 3600_000 ? history.minute : to - from <= 90 * 86_400_000 ? history.hour : history.day;
    const totals = new Map<string, [number, number]>();
    for (const b of tier) if (b.t >= from && b.t <= to) for (const [k, v] of Object.entries(b.apps)) { const t = totals.get(k) ?? [0, 0]; t[0] += v[0]; t[1] += v[1]; totals.set(k, t); }
    return { points, apps: [...totals].map(([k, v]) => ({ app: k, inB: v[0], outB: v[1] })).sort((a, b) => b.inB + b.outB - (a.inB + a.outB)).slice(0, 30) };
  },
  async queryLog(limit = 500) { return queryLog.slice(0, limit); },
  async setDomain(domain: string, verdict: 'allow' | 'deny' | null) {
    await load();
    const d = domain.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
    if (!/^[a-z0-9_.-]+$/.test(d)) throw new Error('Not a domain');
    if (verdict) domainRules[d] = verdict; else delete domainRules[d];
    changed();
    return status();
  },
  async refreshLists() { await load(); await updateLists(true); return status(); },
  async addList(url: string, name?: string) {
    await load();
    const id = `custom-${sha256(url).slice(0, 8)}`;
    settings.lists = settings.lists.filter((l) => l.id !== id);
    settings.lists.push({ id, name: name ?? new URL(url).hostname, topic: 'custom', url, format: 'auto', description: 'Added by you', licence: 'See source', enabled: true });
    await updateLists(true);
    return status();
  },
  async apply() { await load(); await applyNow(); return status(); },
  async uninstall() { await load(); const r = await (backend ??= backendFor()).remove(); settings.enforce = false; enforcement = { active: false, backend: backend.name, message: r.message }; restartWatch(); changed(); return status(); },
  async testInject(c: Partial<Conn> & { host?: string; ip: string; port: number }) {
    if (!FW_TESTABLE || !process.env.KEEPER_FW_FAKE) throw new Error('Only in tests');
    await load();
    const appPath = (c.app as { path?: string } | undefined)?.path ?? '/usr/bin/curl';
    if (c.host) ipNames.set(c.ip, c.host);
    raise({ app: appInfo(path.basename(appPath), appPath), direction: 'out', host: c.host, ip: c.ip, port: c.port, proto: c.proto ?? 'tcp' }, !settings.enforce);
  },
};

async function refreshSubscription(g: RuleGroup) {
  if (g.source.kind !== 'subscription') return;
  const src = g.source as RuleGroup['source'] & { kind: 'subscription'; publicKey?: string };
  try {
    const buf = await download(src.url);
    const sum = sha256(buf);
    if (src.sha256 && src.sha256 !== sum) throw new Error('The subscription changed but its checksum is pinned; nothing was updated');
    if (src.publicKey) {
      const sig = await download(`${src.url}.sig`);
      const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(src.publicKey, 'base64')]), format: 'der', type: 'spki' });
      if (!edVerify(null, buf, key, Buffer.from(sig.toString('utf8').trim(), 'base64'))) throw new Error('The subscription’s signature does not match its key; nothing was updated');
    }
    const parsed = importRules(buf.toString('utf8'));
    // A subscription can only bring rules, never change modes or profiles.
    g.rules = parsed.groups.flatMap((x) => x.rules).map((r) => ({ ...r, id: `${g.id}-${r.id}` }));
    src.updated = Date.now();
    src.error = parsed.problems.length ? parsed.problems.slice(0, 3).join('; ') : undefined;
  } catch (e) {
    src.error = (e as Error).message;
  }
}

export async function initFirewall(d: typeof deps) {
  deps = d;
  await load();
  await loadLists();
  if (settings.dnsFilter) await startResolver();
  restartWatch();
  if (settings.enforce) watchBlocked();
  // Daily: lists and subscriptions (only when something is switched on).
  poll('fw.daily', { baseMs: 6 * 3600_000, pauseWhenLocked: true }, async () => {
    if (settings.lists.some((l) => l.enabled)) await updateLists(false);
    if (state.groups.some((g) => g.source.kind === 'subscription' && (!g.source.updated || Date.now() - g.source.updated > 23 * 3600_000))) await fwApi.refreshSubscriptions();
    prune(history, Date.now());
  }, { feature: 'firewall', now: false });
  poll('fw.saveHistory', { baseMs: 5 * 60_000, idleFactor: 2 }, () => saveHistory(), { feature: 'firewall', now: false });
}

export async function stopFirewall() {
  stopWatch?.();
  stopBlocked?.();
  await resolver?.stop().catch(() => undefined);
  await saveHistory().catch(() => undefined);
}

// ---------------------------------------------------------------- Keeper's own connections

/** Keeper's own outgoing connections obey its rules like any other app's, even where the system cannot enforce them. */
export async function ownConnectionDenied(host: string, port = 443): Promise<boolean> {
  await load();
  const c: Conn = { app: { path: process.execPath, name: 'Keeper' }, direction: 'out', host, ip: '0.0.0.0', port, proto: 'tcp' };
  if (decide(state, c, Date.now(), STARTED).verdict === 'deny') return true;
  return settings.dnsFilter && !!nameBlockedBy(host);
}

/** Blocks (or allows again) one of Keeper's own connections with an ordinary rule in “My rules”. */
export async function setOwnConnectionBlocked(host: string, blocked: boolean, note: string) {
  const id = `keeper-own-${host}`;
  if (blocked) {
    const rule: FwRule = { id, app: { path: process.execPath }, direction: 'out', host: `=${host}`, verdict: 'deny', enabled: true, note, created: Date.now() };
    await fwApi.saveRule('mine', rule);
  } else {
    await fwApi.removeRule('mine', id);
    // A rule the person made by hand for the same host is theirs: only Keeper's own is removed.
  }
}
