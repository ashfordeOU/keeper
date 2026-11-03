// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Site and server monitors: runs the checks (web pages, ports, ping, DNS) on
// the governor's schedule, keeps a day of checks and 30 days of hourly
// summaries in <userData>/monitors.json, and tells the Island, the system and
// phone alerts when one goes down, comes back, or its certificate is about to
// expire. With no monitor switched on there is no timer at all.

import { app } from 'electron';
import { execFile } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { promises as fsp, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import type { TLSSocket } from 'node:tls';
import type { MonitorDetail, MonitorsApi, MonitorsOverview, MonitorView } from '../../core/api-monitors';
import {
  due, emptyHistory, errorWords, judgeDns, judgeHttp, monitorListText, monitorProblems, newMonitor, nextWake, parseMonitorList, parsePing, pingArgs, record, responseSeries,
  spanWords, startRuntime, step, typicalMs, uptime, type CheckResult, type MonitorHistory, type MonitorRuntime, type SiteMonitor,
} from '../../core/site-monitor';
import { featureOn, onFeature } from './features';
import { poll, pollNow } from './governor';
import { phoneAlert } from './phone-alerts';

const FEATURE = 'monitors';
const POLL = 'monitors.check';

interface Stored {
  monitors: SiteMonitor[];
  history: Record<string, MonitorHistory>;
  rt: Record<string, MonitorRuntime>;
  lastRun: Record<string, number>;
}

let data: Stored | null = null;
let stopPoll: (() => void) | undefined;
const checking = new Set<string>();
let deps: { broadcast: (channel: string) => void; alert: (title: string, detail: string) => void } = { broadcast: () => undefined, alert: () => undefined };

const file = () => path.join(app.getPath('userData'), 'monitors.json');

function load(): Stored {
  if (data) return data;
  let d: Partial<Stored> = {};
  try { d = JSON.parse(readFileSync(file(), 'utf8')); } catch { /* none yet */ }
  const monitors = (Array.isArray(d.monitors) ? d.monitors : []).filter((m) => m && typeof m.id === 'string' && !monitorProblems(m).length).map((m) => newMonitor(m, m.created));
  data = { monitors, history: d.history ?? {}, rt: d.rt ?? {}, lastRun: d.lastRun ?? {} };
  return data;
}

let saveTimer: NodeJS.Timeout | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!data) return;
    const tmp = `${file()}.tmp`;
    void fsp.writeFile(tmp, JSON.stringify(data)).then(() => fsp.rename(tmp, file())).catch(() => undefined);
  }, 1500);
  saveTimer.unref?.();
}

// ---------------------------------------------------------------- the checks

const ua = () => `Keeper/${app.getVersion()} (site check; https://keeper.ashforde.org)`;

function httpCheck(m: SiteMonitor, url = m.target, hops = 0, started = performance.now()): Promise<CheckResult> {
  return new Promise((resolve) => {
    let u: URL;
    try { u = new URL(url); } catch { resolve({ at: Date.now(), ok: false, message: 'The address is not valid' }); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', agent: false, timeout: m.timeout * 1000, headers: { 'user-agent': ua(), accept: 'text/html,*/*;q=0.8', 'cache-control': 'no-cache' } }, (res) => {
      const status = res.statusCode ?? 0;
      const sock = res.socket as TLSSocket;
      let certExpires: number | undefined;
      try {
        const c = typeof sock.getPeerCertificate === 'function' ? sock.getPeerCertificate() : undefined;
        if (c?.valid_to) certExpires = Date.parse(c.valid_to);
      } catch { /* not https */ }
      const loc = res.headers.location;
      if (status >= 300 && status < 400 && loc && hops < 5) {
        res.resume();
        void httpCheck(m, new URL(loc, u).toString(), hops + 1, started).then((r) => {
          // The first certificate (the address that was asked for) is the one that matters.
          resolve(certExpires !== undefined && r.tlsDays === undefined && r.ok ? { ...r, tlsDays: Math.floor((certExpires - Date.now()) / 86_400_000) } : r);
        });
        return;
      }
      const ms = performance.now() - started;
      if (!m.keyword) {
        res.destroy();
        resolve(judgeHttp(m, { status, ms, certExpires }));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => {
        body += d;
        if (body.length > 2_000_000) res.destroy();
      });
      const done = () => resolve(judgeHttp(m, { status, ms, certExpires, body }));
      res.on('end', done);
      res.on('close', done);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })));
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ at: Date.now(), ok: false, message: errorWords(e.code, e.message) }));
    req.end();
  });
}

function tcpCheck(m: SiteMonitor): Promise<CheckResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const sock = net.connect({ host: m.target, port: m.port ?? 0 });
    const end = (r: CheckResult) => { sock.destroy(); resolve(r); };
    sock.setTimeout(m.timeout * 1000, () => end({ at: Date.now(), ok: false, message: errorWords('TIMEOUT') }));
    sock.once('connect', () => end({ at: Date.now(), ok: true, ms: Math.round(performance.now() - start) }));
    sock.once('error', (e: NodeJS.ErrnoException) => end({ at: Date.now(), ok: false, message: errorWords(e.code, e.message) }));
  });
}

function pingCheck(m: SiteMonitor): Promise<CheckResult> {
  const { cmd, args } = pingArgs(process.platform, m.target, m.timeout);
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: (m.timeout + 3) * 1000, windowsHide: true }, (err, stdout) => {
      const ms = parsePing(String(stdout ?? ''));
      if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') resolve({ at: Date.now(), ok: false, unsupported: true, message: 'Ping is not available on this computer' });
      else if (!err && ms !== undefined) resolve({ at: Date.now(), ok: true, ms: Math.round(ms) });
      else resolve({ at: Date.now(), ok: false, message: 'No reply' });
    });
  });
}

async function dnsCheck(m: SiteMonitor): Promise<CheckResult> {
  const r = new Resolver({ timeout: m.timeout * 1000, tries: 1 });
  const start = performance.now();
  try {
    const t = m.dnsType ?? 'A';
    const answers: string[] = t === 'A' ? await r.resolve4(m.target)
      : t === 'AAAA' ? await r.resolve6(m.target)
        : t === 'CNAME' ? await r.resolveCname(m.target)
          : t === 'MX' ? (await r.resolveMx(m.target)).sort((a, b) => a.priority - b.priority).map((x) => x.exchange)
            : (await r.resolveTxt(m.target)).map((x) => x.join(''));
    return judgeDns(m, answers, performance.now() - start);
  } catch (e) {
    return { at: Date.now(), ok: false, ms: Math.round(performance.now() - start), message: errorWords((e as NodeJS.ErrnoException).code, (e as Error).message) };
  }
}

async function runCheck(m: SiteMonitor): Promise<CheckResult> {
  // Keeper's own firewall rules apply to its checks too.
  if (m.kind === 'http' || m.kind === 'tcp') {
    const host = m.kind === 'http' ? new URL(m.target).hostname : m.target;
    const port = m.kind === 'tcp' ? m.port ?? 0 : m.target.startsWith('https:') ? 443 : 80;
    const { ownConnectionDenied } = await import('./fw');
    if (await ownConnectionDenied(host, port).catch(() => false)) return { at: Date.now(), ok: false, message: 'Keeper’s firewall blocks this host' };
  }
  return m.kind === 'http' ? httpCheck(m) : m.kind === 'tcp' ? tcpCheck(m) : m.kind === 'ping' ? pingCheck(m) : dnsCheck(m);
}

async function check(m: SiteMonitor): Promise<CheckResult> {
  const d = load();
  checking.add(m.id);
  deps.broadcast('monitors-changed');
  let r: CheckResult;
  try { r = await runCheck(m); } catch (e) { r = { at: Date.now(), ok: false, message: errorWords(undefined, (e as Error).message) }; }
  finally { checking.delete(m.id); }
  // It may have been removed while the check ran.
  if (!d.monitors.some((x) => x.id === m.id)) return r;
  d.lastRun[m.id] = r.at;
  if (r.unsupported) {
    // Paused, with the reason on its row; nothing goes into its uptime.
    d.monitors = d.monitors.map((x) => (x.id === m.id ? { ...x, on: false } : x));
    d.rt[m.id] = step(d.rt[m.id] ?? startRuntime(true, r.at), r, m).rt;
    save();
    schedule();
    deps.broadcast('monitors-changed');
    return r;
  }
  d.history[m.id] = record(d.history[m.id] ?? emptyHistory(), r);
  const { rt, events } = step(d.rt[m.id] ?? startRuntime(true, r.at), r, m);
  d.rt[m.id] = rt;
  if (m.alerts) for (const e of events) tell(m, e);
  save();
  deps.broadcast('monitors-changed');
  return r;
}

function tell(m: SiteMonitor, e: ReturnType<typeof step>['events'][number]) {
  if (e.kind === 'down') {
    deps.alert(`${m.name} is down`, e.message);
    phoneAlert('monitors', `${m.name} is down`, e.message, { urgent: true });
  } else if (e.kind === 'up') {
    deps.alert(`${m.name} is back up`, `It was down for ${spanWords(e.downFor)}`);
    phoneAlert('monitors', `${m.name} is back up`, `It was down for ${spanWords(e.downFor)}`, { good: true });
  } else {
    const when = e.days === 0 ? 'today' : e.days === 1 ? 'tomorrow' : `in ${e.days} days`;
    deps.alert(`${m.name}: certificate expires ${when}`, 'Renew it before visitors see a warning.');
    phoneAlert('monitors', `${m.name}: certificate expires ${when}`, 'Renew it before visitors see a warning.', { urgent: e.days <= 3 });
  }
}

/** One look: every monitor that is due, a few at a time. */
async function tick() {
  if (!featureOn(FEATURE)) return;
  const d = load();
  const list = due(d.monitors, d.lastRun).filter((m) => !checking.has(m.id));
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map((m) => check(m)));
}

/** Starts the schedule while a monitor is on; none on, no timer. */
function schedule() {
  const d = load();
  const any = featureOn(FEATURE) && d.monitors.some((m) => m.on);
  if (!any) { stopPoll?.(); stopPoll = undefined; return; }
  if (stopPoll) return;
  // Monitors keep watching while the screen is locked: that is when a server going down matters most.
  stopPoll = poll(POLL, () => {
    const wake = nextWake(load().monitors, load().lastRun) ?? 60_000;
    return { baseMs: wake, idleFactor: 1, pauseWhenLocked: false, maxMs: Math.max(wake, 60_000) };
  }, tick, { feature: FEATURE, now: true });
}

// ---------------------------------------------------------------- the API

function view(m: SiteMonitor, now = Date.now()): MonitorView {
  const d = load();
  const h = d.history[m.id] ?? emptyHistory();
  return {
    ...m, rt: m.on ? d.rt[m.id] ?? startRuntime(true, m.created) : { ...(d.rt[m.id] ?? startRuntime(false)), state: 'paused' },
    uptime24: uptime(h, now - 86_400_000), uptime7: uptime(h, now - 7 * 86_400_000), uptime30: uptime(h, now - 30 * 86_400_000), typicalMs: typicalMs(h), checking: checking.has(m.id),
  };
}

async function overview(): Promise<MonitorsOverview> {
  const monitors = load().monitors.map((m) => view(m));
  const counts = { up: 0, down: 0, pending: 0, paused: 0 };
  for (const m of monitors) counts[m.rt.state]++;
  return { monitors, counts };
}

export const monitorsApi: MonitorsApi = {
  overview,
  async detail(id) {
    const d = load();
    const m = d.monitors.find((x) => x.id === id);
    if (!m) throw new Error('That monitor is gone.');
    const h = d.history[id] ?? emptyHistory();
    return { monitor: view(m), series: responseSeries(h), recent: h.recent.slice(-20).reverse() } satisfies MonitorDetail;
  },
  async save(p) {
    const d = load();
    const problems = monitorProblems(p);
    if (problems.length) throw new Error(problems[0]);
    const old = p.id ? d.monitors.find((x) => x.id === p.id) : undefined;
    const m = newMonitor({ ...old, ...p, created: old?.created }, Date.now());
    if (old) {
      d.monitors = d.monitors.map((x) => (x.id === m.id ? m : x));
      // What it checks changed: the old history no longer says anything about it.
      if (old.kind !== m.kind || old.target !== m.target || old.port !== m.port) { delete d.history[m.id]; d.rt[m.id] = startRuntime(m.on); }
    } else {
      if (d.monitors.length >= 200) throw new Error('Keeper watches up to 200 monitors.');
      d.monitors.push(m);
      d.rt[m.id] = startRuntime(m.on);
    }
    delete d.lastRun[m.id];
    save();
    schedule();
    if (m.on && featureOn(FEATURE)) pollNow(POLL);
    deps.broadcast('monitors-changed');
    return view(m);
  },
  async remove(id) {
    const d = load();
    d.monitors = d.monitors.filter((m) => m.id !== id);
    delete d.history[id]; delete d.rt[id]; delete d.lastRun[id];
    save();
    schedule();
    deps.broadcast('monitors-changed');
    return overview();
  },
  async setOn(id, on) {
    const d = load();
    d.monitors = d.monitors.map((m) => (m.id === id ? { ...m, on } : m));
    d.rt[id] = { ...startRuntime(on), ...(on ? {} : { last: d.rt[id]?.last }) };
    if (on) delete d.lastRun[id];
    save();
    schedule();
    if (on) pollNow(POLL);
    deps.broadcast('monitors-changed');
    return overview();
  },
  async checkNow(id) {
    const m = load().monitors.find((x) => x.id === id);
    if (!m) throw new Error('That monitor is gone.');
    return check(m);
  },
  async importList(text) {
    const d = load();
    const { monitors, skipped } = parseMonitorList(text);
    const key = (m: SiteMonitor) => `${m.kind}|${m.target.toLowerCase()}|${m.port ?? ''}|${m.dnsType ?? ''}`;
    const have = new Set(d.monitors.map(key));
    const fresh = monitors.filter((m) => !have.has(key(m))).slice(0, Math.max(0, 200 - d.monitors.length));
    for (const m of fresh) { d.monitors.push(m); d.rt[m.id] = startRuntime(true); }
    save();
    schedule();
    if (fresh.length) pollNow(POLL);
    deps.broadcast('monitors-changed');
    return { added: fresh.length, skipped: [...skipped, ...monitors.filter((m) => have.has(key(m))).map((m) => `${m.target} (already there)`)] };
  },
  async exportList() {
    return monitorListText(load().monitors);
  },
};

export function startMonitors(d: typeof deps) {
  deps = d;
  onFeature(FEATURE, (on) => {
    if (!on) { stopPoll?.(); stopPoll = undefined; return; }
    schedule();
  }, { now: true });
}
