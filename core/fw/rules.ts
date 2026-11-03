// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's firewall rules: which app may connect where. Pure: the same code
// decides in the app, in tests and in the command line, whatever enforces it.
//
// How a connection is decided (the documented order):
//   1. Rules that are switched off, expired, in a group that is off, or in a
//      group the active profile turns off, are ignored.
//   2. Of the rules that match, the most specific one wins. Specificity is
//      compared in this order, first difference decides:
//        a. priority: "high" before "normal"
//        b. who: one exact app (signature + path) > one app by signature or
//           path > a group of apps (system, developer tools…) > any app
//        c. where: one exact host > a domain with its subdomains (longer
//           domain first) > an address range (narrower first) > anywhere
//        d. port: one port > a range (narrower first) > any port
//        e. protocol: TCP/UDP/ICMP > any
//   3. When two equally specific rules disagree, "deny" wins, then "ask".
//      A rule can be limited to some profiles (Home, Work, Public Wi-Fi); in
//      other profiles it is ignored.
//   4. No rule: the mode decides — ask (alert), allow quietly (silent allow,
//      remembered for later), or deny quietly (silent deny).

import { familyOf, inPrefix, parseCidr, unmapV4 } from '../net/addr';

export type Direction = 'out' | 'in' | 'both';
export type Proto = 'tcp' | 'udp' | 'icmp' | 'any';
/** "ask" holds (or flags) the connection and asks, even in a quiet mode; systems only ever get allow and deny. */
export type RuleVerdict = 'allow' | 'deny' | 'ask';
export type Mode = 'alert' | 'silent-allow' | 'silent-deny';

/** Groups of apps a rule can name instead of one app. */
export type AppGroup = 'system' | 'devtools' | 'browsers' | 'any';

/** Who is connecting, as precisely as the system can say. */
export interface AppIdentity {
  /** full path of the program */
  path?: string;
  /** code signature: macOS team id / designated requirement, Windows Authenticode signer, Linux package that owns it */
  signer?: string;
  /** macOS bundle id, Windows package family name… */
  bundleId?: string;
  sha256?: string;
  /** a group instead of one app */
  group?: AppGroup;
}

export interface FwRule {
  id: string;
  /** who: one app, or a group, or any app */
  app: AppIdentity | 'any';
  direction: Direction;
  /** a host name; "example.com" also covers its subdomains, "=www.example.com" only that host */
  host?: string;
  /** an address or range in CIDR form */
  ip?: string;
  /** "443", "8000-8080" */
  port?: string;
  proto?: Proto;
  verdict: RuleVerdict;
  priority?: 'normal' | 'high';
  enabled: boolean;
  /** temporary: a time (ms) or "until Keeper quits" */
  until?: number | 'quit';
  /** only in these profiles (ids); none = every profile */
  profiles?: string[];
  note?: string;
  created: number;
  /** how often it decided a connection, and when last */
  hits?: number;
  lastUsed?: number;
}

export interface RuleGroup {
  id: string;
  name: string;
  enabled: boolean;
  /** local rules, or rules subscribed from an address and kept up to date */
  source: { kind: 'local' } | { kind: 'subscription'; url: string; sha256?: string; updated?: number; error?: string };
  rules: FwRule[];
}

export interface Profile {
  id: string;
  name: string;
  /** groups switched off while this profile is active (by id) */
  groupsOff: string[];
  /** a different mode for this profile, e.g. deny quietly on public Wi-Fi */
  mode?: Mode;
  /** switch to this profile automatically on these networks */
  auto?: { ssids?: string[]; gateways?: string[] };
}

export interface FwState {
  groups: RuleGroup[];
  profiles: Profile[];
  activeProfile: string;
  /** automatic profile switching by network */
  autoSwitch: boolean;
  mode: Mode;
}

/** One connection to decide. */
export interface Conn {
  app: AppIdentity & { system?: boolean; devtool?: boolean; browser?: boolean; name?: string };
  direction: 'out' | 'in';
  /** the host name it asked for, when known (from DNS) */
  host?: string;
  ip: string;
  port: number;
  proto: Exclude<Proto, 'any'>;
}

export interface Decision {
  verdict: RuleVerdict | 'ask';
  rule?: FwRule;
  group?: RuleGroup;
  /** why, in plain words */
  reason: string;
}

// ---------------------------------------------------------------- matching

const norm = (p?: string) => (p ?? '').replace(/\\/g, '/').toLowerCase();

export function appMatches(rule: FwRule['app'], c: Conn['app']): boolean {
  if (rule === 'any') return true;
  if (rule.group) {
    if (rule.group === 'any') return true;
    if (rule.group === 'system') return !!c.system;
    if (rule.group === 'devtools') return !!c.devtool;
    if (rule.group === 'browsers') return !!c.browser;
  }
  // Every identity the rule names must agree; a signer survives the app being moved or renamed.
  if (rule.signer && rule.signer !== c.signer) return false;
  if (rule.bundleId && rule.bundleId !== c.bundleId) return false;
  if (rule.sha256 && rule.sha256.toLowerCase() !== (c.sha256 ?? '').toLowerCase()) return false;
  if (rule.path && norm(rule.path) !== norm(c.path)) return false;
  return !!(rule.signer || rule.bundleId || rule.sha256 || rule.path);
}

/** "example.com" covers example.com and its subdomains; "=host" only that host; "*.example.com" only subdomains. */
export function hostMatches(pattern: string, host?: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase().replace(/\.$/, '');
  if (p.startsWith('=')) return h === p.slice(1);
  if (p.startsWith('*.')) return h.endsWith(p.slice(1));
  return h === p || h.endsWith('.' + p);
}

export function ipMatches(cidr: string, ip: string): boolean {
  const addr = unmapV4(ip);
  const c = parseCidr(cidr.includes('/') ? cidr : `${cidr}/${familyOf(cidr) === 6 ? 128 : 32}`);
  if (!c || familyOf(addr) !== c.family) return false;
  return inPrefix(addr, c.net, c.prefix);
}

export function parsePorts(spec?: string): { lo: number; hi: number } | null {
  if (!spec || spec === 'any' || spec === '*') return null;
  const m = spec.trim().match(/^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/);
  if (!m) throw new Error(`Not a port or range: ${spec}`);
  const lo = +m[1];
  const hi = m[2] ? +m[2] : lo;
  if (lo < 0 || hi > 65535 || lo > hi) throw new Error(`Not a port or range: ${spec}`);
  return { lo, hi };
}

/** Port range or null for "any"; a broken spec counts as "no match" instead of failing every decision. */
function safePorts(spec?: string): { lo: number; hi: number } | null | false {
  try { return parsePorts(spec); } catch { return false; }
}

export function ruleMatches(r: FwRule, c: Conn): boolean {
  if (safePorts(r.port) === false) return false;
  if (r.direction !== 'both' && r.direction !== c.direction) return false;
  if (r.proto && r.proto !== 'any' && r.proto !== c.proto) return false;
  if (!appMatches(r.app, c.app)) return false;
  if (r.host && r.host !== 'any' && !hostMatches(r.host, c.host)) return false;
  if (r.ip && !ipMatches(r.ip, c.ip)) return false;
  const p = safePorts(r.port);
  if (p && (c.port < p.lo || c.port > p.hi)) return false;
  return true;
}

/** A tuple compared left to right; larger is more specific. */
export function specificity(r: FwRule): number[] {
  const a = r.app;
  const who = a === 'any' || a.group === 'any' ? 0 : a.group ? 1 : (a.signer || a.bundleId || a.sha256) && a.path ? 3 : 2;
  let where = 0;
  if (r.host && r.host !== 'any') {
    const exact = r.host.startsWith('=');
    where = exact ? 3000 : 2000 + r.host.replace(/^\*\./, '').split('.').length;
  } else if (r.ip) {
    const c = parseCidr(r.ip.includes('/') ? r.ip : `${r.ip}/${familyOf(r.ip) === 6 ? 128 : 32}`);
    // A narrower range is more specific; v4 and v6 are put on one scale.
    where = c ? 1000 + (c.family === 4 ? c.prefix * 4 : c.prefix) : 1000;
  }
  const p = safePorts(r.port);
  const port = !p ? 0 : p.lo === p.hi ? 70000 : 70000 - (p.hi - p.lo);
  const proto = r.proto && r.proto !== 'any' ? 1 : 0;
  return [r.priority === 'high' ? 1 : 0, who, where, port, proto];
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function isLive(r: FwRule, now: number, quitAt?: number, profile?: string): boolean {
  if (!r.enabled) return false;
  if (profile && r.profiles?.length && !r.profiles.includes(profile)) return false;
  if (typeof r.until === 'number' && r.until <= now) return false;
  if (r.until === 'quit' && quitAt !== undefined && r.created < quitAt) return false;
  return true;
}

export function activeProfile(s: FwState): Profile | undefined {
  return s.profiles.find((p) => p.id === s.activeProfile) ?? s.profiles[0];
}

export function liveGroups(s: FwState): RuleGroup[] {
  const off = new Set(activeProfile(s)?.groupsOff ?? []);
  return s.groups.filter((g) => g.enabled && !off.has(g.id));
}

/** Equally specific rules that disagree: deny before ask before allow. */
const VERDICT_WEIGHT: Record<RuleVerdict, number> = { deny: 2, ask: 1, allow: 0 };

/** Decides one connection. `quitAt` = when Keeper last started (rules "until quit" from before are gone). */
export function decide(s: FwState, c: Conn, now = Date.now(), quitAt?: number): Decision {
  let best: { r: FwRule; g: RuleGroup; spec: number[] } | undefined;
  const profile = activeProfile(s)?.id;
  for (const g of liveGroups(s)) {
    for (const r of g.rules) {
      if (!isLive(r, now, quitAt, profile) || !ruleMatches(r, c)) continue;
      const spec = specificity(r);
      const d = best ? compare(spec, best.spec) : 1;
      if (d > 0 || (d === 0 && VERDICT_WEIGHT[r.verdict] > VERDICT_WEIGHT[best!.r.verdict])) best = { r, g, spec };
    }
  }
  if (best) return { verdict: best.r.verdict, rule: best.r, group: best.g, reason: `${best.r.verdict === 'allow' ? 'Allowed' : best.r.verdict === 'deny' ? 'Denied' : 'Asks first,'} by a rule in “${best.g.name}”` };
  const mode = activeProfile(s)?.mode ?? s.mode;
  if (mode === 'silent-allow') return { verdict: 'allow', reason: 'No rule; quiet mode allows it and remembers it for later' };
  if (mode === 'silent-deny') return { verdict: 'deny', reason: 'No rule; quiet mode denies it' };
  return { verdict: 'ask', reason: 'No rule yet' };
}

/** Counts a decision on its rule. */
export function recordHit(d: Decision, now = Date.now()) {
  if (!d.rule) return;
  d.rule.hits = (d.rule.hits ?? 0) + 1;
  d.rule.lastUsed = now;
}

// ---------------------------------------------------------------- profiles

/** The profile for the network the computer is on, when automatic switching is on. */
export function profileForNetwork(s: FwState, net: { ssid?: string; gateway?: string }): string | undefined {
  if (!s.autoSwitch) return undefined;
  for (const p of s.profiles) {
    if (net.ssid && p.auto?.ssids?.some((x) => x === net.ssid)) return p.id;
    if (net.gateway && p.auto?.gateways?.includes(net.gateway)) return p.id;
  }
  return undefined;
}

// ---------------------------------------------------------------- rules from an alert

export type AlertScope = 'once' | 'quit' | 'hour' | 'forever';

/** When a rule made for a while ends: an hour from now, when Keeper quits, or never. */
export function untilFor(scope: Exclude<AlertScope, 'once'>, now = Date.now()): FwRule['until'] {
  return scope === 'forever' ? undefined : scope === 'quit' ? 'quit' : now + 3600_000;
}

/** Which of the four lengths a rule has (an hour-long rule stays "hour" until it ends). */
export function scopeOf(r: Pick<FwRule, 'until'>): Exclude<AlertScope, 'once'> {
  return r.until === undefined ? 'forever' : r.until === 'quit' ? 'quit' : 'hour';
}

/** The rule behind a quick answer on an app (any host) or on one host of an app, from the live view or the menu bar. */
export function ruleForApp(target: { app: string; path?: string; signer?: string; host?: string; ip?: string }, verdict: RuleVerdict, scope: Exclude<AlertScope, 'once'>, opts: { profiles?: string[]; now?: number } = {}): FwRule {
  const now = opts.now ?? Date.now();
  const app: AppIdentity = target.signer ? { signer: target.signer, path: target.path } : { path: target.path ?? target.app };
  const host = target.host ? `=${target.host}` : undefined;
  return {
    id: `${appRuleId(target.path ?? target.app, target.host ?? target.ip)}-${now.toString(36)}`,
    app,
    direction: 'out',
    host,
    ip: host ? undefined : target.ip,
    verdict,
    enabled: true,
    until: untilFor(scope, now),
    profiles: opts.profiles?.length ? opts.profiles : undefined,
    created: now,
    note: `${target.app} → ${target.host ?? target.ip ?? 'anywhere'}`,
  };
}

/** A stable prefix for the quick rules of one app (and host), so a new answer replaces the old one. */
export function appRuleId(appPath: string, where?: string): string {
  let h = 0;
  for (const ch of `${appPath.toLowerCase()}|${(where ?? '*').toLowerCase()}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `q-${(h >>> 0).toString(36)}`;
}

/** The quick rule set for an app (or one of its hosts), if there is one, so the live view can show its answer. */
export function quickRuleFor(s: FwState, appPath: string, where?: string): FwRule | undefined {
  const prefix = `${appRuleId(appPath, where)}-`;
  for (const g of s.groups) for (const r of g.rules) if (r.id.startsWith(prefix)) return r;
  return undefined;
}

/** The rules a system can enforce right now: allow and deny only, live, and in the active profile. */
export function enforceableGroups(s: FwState, now = Date.now(), quitAt?: number): RuleGroup[] {
  const profile = activeProfile(s)?.id;
  return s.groups.map((g) => ({ ...g, rules: g.rules.filter((r) => r.verdict !== 'ask' && isLive(r, now, quitAt, profile)) }));
}

/** The rule an answer to an alert creates: this app, this host (or address) and port. */
export function ruleFromAlert(c: Conn, verdict: RuleVerdict, scope: Exclude<AlertScope, 'once'>, opts: { anyPort?: boolean; wholeDomain?: boolean; anyHost?: boolean } = {}, now = Date.now()): FwRule {
  const app: AppIdentity = c.app.signer ? { signer: c.app.signer, path: c.app.path } : { path: c.app.path };
  const host = opts.anyHost ? undefined : c.host ? (opts.wholeDomain ? registrable(c.host) : `=${c.host}`) : undefined;
  return {
    id: `r-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    app,
    direction: c.direction,
    host,
    ip: opts.anyHost || host ? undefined : c.ip,
    port: opts.anyPort ? undefined : String(c.port),
    proto: c.proto,
    verdict,
    enabled: true,
    until: scope === 'forever' ? undefined : scope === 'quit' ? 'quit' : now + 3600_000,
    created: now,
  };
}

const TWO_LABEL = /\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/;
/** "eu.api.example.co.uk" → "example.co.uk" (a small built-in list of two-part endings). */
export function registrable(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  const parts = h.split('.');
  return parts.slice(TWO_LABEL.test(h) ? -3 : -2).join('.');
}

// ---------------------------------------------------------------- tidy up

export interface TidyNote {
  ruleId: string;
  groupId: string;
  kind: 'invalid' | 'covered' | 'duplicate' | 'expired' | 'unused';
  message: string;
  /** the rule that makes this one unnecessary */
  by?: string;
}

/** True when every connection `inner` matches is matched by `outer` too. */
export function covers(outer: FwRule, inner: FwRule): boolean {
  if (outer.direction !== 'both' && outer.direction !== inner.direction) return false;
  if (outer.proto && outer.proto !== 'any' && outer.proto !== inner.proto) return false;
  const oa = outer.app;
  const ia = inner.app;
  if (oa !== 'any' && !(oa.group === 'any')) {
    if (ia === 'any') return false;
    if (oa.group) { if (ia.group !== oa.group) return false; }
    else {
      if (ia.group) return false;
      for (const k of ['path', 'signer', 'bundleId', 'sha256'] as const) if (oa[k] && norm(oa[k]) !== norm(ia[k])) return false;
    }
  }
  if (outer.host && outer.host !== 'any') {
    if (!inner.host || inner.host === 'any') return false;
    const ih = inner.host.replace(/^[=]|^\*\./, '');
    if (!hostMatches(outer.host, ih) || (outer.host.startsWith('=') && !inner.host.startsWith('='))) return false;
  }
  if (outer.ip) {
    if (!inner.ip) return false;
    const oc = parseCidr(outer.ip.includes('/') ? outer.ip : `${outer.ip}/32`);
    const ic = parseCidr(inner.ip.includes('/') ? inner.ip : `${inner.ip}/32`);
    if (!oc || !ic || oc.family !== ic.family || ic.prefix < oc.prefix || !inPrefix(ic.net, oc.net, oc.prefix)) return false;
  }
  const op = safePorts(outer.port);
  if (op === false) return false;
  if (op) {
    const ip = safePorts(inner.port);
    if (!ip || ip.lo < op.lo || ip.hi > op.hi) return false;
  }
  return true;
}

/** Problems worth tidying: broken rules, expired ones, exact duplicates, and rules a broader rule with the same answer already covers. */
export function tidy(s: FwState, now = Date.now(), unusedDays = 180): TidyNote[] {
  const out: TidyNote[] = [];
  const all = s.groups.flatMap((g) => g.rules.map((r) => ({ r, g })));
  for (const { r, g } of all) {
    try {
      parsePorts(r.port);
      if (r.ip && !parseCidr(r.ip.includes('/') ? r.ip : `${r.ip}/${familyOf(r.ip) === 6 ? 128 : 32}`)) throw new Error('Not an address or range');
      if (r.app !== 'any' && !r.app.group && !r.app.path && !r.app.signer && !r.app.bundleId && !r.app.sha256) throw new Error('Names no app');
    } catch (e) {
      out.push({ ruleId: r.id, groupId: g.id, kind: 'invalid', message: (e as Error).message });
      continue;
    }
    if (typeof r.until === 'number' && r.until <= now) out.push({ ruleId: r.id, groupId: g.id, kind: 'expired', message: 'Its time ran out' });
    else if (r.created < now - unusedDays * 86_400_000 && (!r.lastUsed || r.lastUsed < now - unusedDays * 86_400_000)) out.push({ ruleId: r.id, groupId: g.id, kind: 'unused', message: `Not used for ${unusedDays} days` });
  }
  const broken = new Set(out.filter((x) => x.kind === 'invalid').map((x) => x.ruleId));
  const valid = all.filter(({ r }) => !broken.has(r.id));
  const sig = (r: FwRule) => JSON.stringify([r.app, r.direction, r.host ?? '', r.ip ?? '', r.port ?? '', r.proto ?? 'any', r.verdict, r.priority ?? 'normal']);
  const seen = new Map<string, string>();
  for (const { r, g } of valid) {
    const k = sig(r);
    if (seen.has(k)) out.push({ ruleId: r.id, groupId: g.id, kind: 'duplicate', message: 'The same as another rule', by: seen.get(k) });
    else seen.set(k, r.id);
  }
  for (const { r: inner, g } of valid) {
    if (out.some((n) => n.ruleId === inner.id && n.kind === 'duplicate')) continue;
    for (const { r: outer } of valid) {
      if (outer === inner || outer.verdict !== inner.verdict || !outer.enabled || (outer.priority ?? 'normal') !== (inner.priority ?? 'normal')) continue;
      if (covers(outer, inner) && !covers(inner, outer)) {
        // Only redundant if no more specific opposite rule sits between them.
        const between = valid.some(({ r: x }) => x !== inner && x !== outer && x.verdict !== inner.verdict && x.enabled && covers(outer, x) && covers(x, inner));
        if (!between) {
          out.push({ ruleId: inner.id, groupId: g.id, kind: 'covered', message: 'A broader rule with the same answer already covers it', by: outer.id });
          break;
        }
      }
    }
  }
  return out;
}

/** Suggests one rule for several rules that differ only in port: "these 4 rules could be one". */
export function suggestMerges(rules: FwRule[]): { ids: string[]; merged: FwRule }[] {
  const groups = new Map<string, FwRule[]>();
  for (const r of rules) {
    if (!r.port || parsePorts(r.port)?.lo !== parsePorts(r.port)?.hi) continue;
    const k = JSON.stringify([r.app, r.direction, r.host ?? '', r.ip ?? '', r.proto ?? 'any', r.verdict]);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: { ids: string[]; merged: FwRule }[] = [];
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    const ports = list.map((r) => +r.port!).sort((a, b) => a - b);
    out.push({ ids: list.map((r) => r.id), merged: { ...list[0], id: `${list[0].id}-merged`, port: `${ports[0]}-${ports[ports.length - 1]}`, hits: 0 } });
  }
  return out;
}

// ---------------------------------------------------------------- import / export

export const EXPORT_FORMAT = 'keeper-firewall/1';

export function exportRules(s: FwState, groupIds?: string[]): string {
  const groups = s.groups.filter((g) => !groupIds || groupIds.includes(g.id)).map((g) => ({ ...g, rules: g.rules.map(({ hits: _h, lastUsed: _l, ...r }) => r) }));
  return JSON.stringify({ format: EXPORT_FORMAT, exported: new Date().toISOString(), groups, profiles: s.profiles }, null, 2);
}

/** Reads exported rules (or a subscription), checking every rule; bad rules are refused with a reason. */
export function importRules(text: string): { groups: RuleGroup[]; profiles: Profile[]; problems: string[] } {
  let data: { format?: string; groups?: unknown[]; profiles?: unknown[] };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a Keeper rules file');
  }
  if (data.format !== EXPORT_FORMAT) throw new Error('This is not a Keeper rules file');
  const problems: string[] = [];
  const groups: RuleGroup[] = [];
  for (const raw of (data.groups ?? []) as RuleGroup[]) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !Array.isArray(raw.rules)) { problems.push('A group without an id, name or rules was skipped'); continue; }
    const rules: FwRule[] = [];
    for (const r of raw.rules) {
      try {
        if (r.verdict !== 'allow' && r.verdict !== 'deny' && r.verdict !== 'ask') throw new Error('no allow/deny/ask');
        if (!['in', 'out', 'both'].includes(r.direction)) throw new Error('no direction');
        parsePorts(r.port);
        if (r.ip && !parseCidr(r.ip.includes('/') ? r.ip : `${r.ip}/${familyOf(r.ip) === 6 ? 128 : 32}`)) throw new Error('bad address');
        if (r.host && !/^[=*.a-z0-9_-]+$/i.test(r.host)) throw new Error('bad host');
        rules.push({ ...r, enabled: r.enabled !== false, created: typeof r.created === 'number' ? r.created : Date.now() });
      } catch (e) {
        problems.push(`Rule ${String(r?.id ?? '?')} in “${raw.name}” skipped: ${(e as Error).message}`);
      }
    }
    groups.push({ id: raw.id, name: raw.name, enabled: raw.enabled !== false, source: raw.source ?? { kind: 'local' }, rules });
  }
  const profiles = ((data.profiles ?? []) as Profile[]).filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string').map((p) => ({ ...p, groupsOff: Array.isArray(p.groupsOff) ? p.groupsOff : [] }));
  return { groups, profiles, problems };
}

export function defaultFwState(): FwState {
  return {
    groups: [{ id: 'mine', name: 'My rules', enabled: true, source: { kind: 'local' }, rules: [] }],
    profiles: [
      { id: 'home', name: 'Home', groupsOff: [] },
      { id: 'work', name: 'Work', groupsOff: [] },
      { id: 'public', name: 'Public Wi-Fi', groupsOff: [], mode: 'alert' },
    ],
    activeProfile: 'home',
    autoSwitch: false,
    mode: 'alert',
  };
}
