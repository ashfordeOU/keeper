// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The firewall in the browser demo: a Mac with a few rules, alerts waiting,
// live connections around the world and a month of history.

import type { FwAlert, FwApi, FwConnection, FwEvent, FwSettings, FwStatus } from '../core/api-fw';
import { CURATED_LISTS } from '../core/fw/blocklist';
import { UPSTREAMS, type QueryLogEntry } from '../core/fw/dns';
import { capabilities } from '../core/fw/enforce';
import { decide, defaultFwState, ruleFromAlert, tidy, type Conn, type FwRule, type FwState } from '../core/fw/rules';

export function mockFw(emit: (ch: string, ...a: unknown[]) => void): { fw: FwApi } {
  const now = Date.now();
  const r = (p: Partial<FwRule>): FwRule => ({ id: `d${Math.random().toString(36).slice(2, 8)}`, app: 'any', direction: 'out', verdict: 'allow', enabled: true, created: now - 30 * 86_400_000, hits: Math.floor(Math.random() * 400), lastUsed: now - Math.floor(Math.random() * 86_400_000), ...p });
  const state: FwState = {
    ...defaultFwState(),
    groups: [
      { id: 'mine', name: 'My rules', enabled: true, source: { kind: 'local' }, rules: [
        r({ app: { path: '/Applications/Safari.app/Contents/MacOS/Safari', signer: 'Apple' }, verdict: 'allow', note: 'Safari → anywhere' }),
        r({ app: { path: '/Applications/Zoom.app/Contents/MacOS/zoom.us', signer: 'BJ4HAAB9B3' }, host: 'zoom.us', verdict: 'allow', note: 'Zoom → zoom.us' }),
        r({ app: { path: '/Applications/Zoom.app/Contents/MacOS/zoom.us', signer: 'BJ4HAAB9B3' }, verdict: 'deny', note: 'Zoom → everything else' }),
        r({ app: 'any', host: 'doubleclick.net', verdict: 'deny', note: 'No ad network' }),
        r({ app: { group: 'devtools' }, port: '22', verdict: 'allow', note: 'Developer tools → SSH' }),
        r({ app: { path: '/usr/local/bin/node' }, host: 'registry.npmjs.org', verdict: 'allow', until: now + 40 * 60_000, note: 'node → npm (for an hour)' }),
      ] },
      { id: 'sub-telemetry', name: 'Community: no telemetry', enabled: true, source: { kind: 'subscription', url: 'https://example.org/keeper/no-telemetry.json', updated: now - 3 * 3600_000 }, rules: [r({ host: 'telemetry.example.net', verdict: 'deny' }), r({ host: 'metrics.example.com', verdict: 'deny' })] },
    ],
    profiles: [
      { id: 'home', name: 'Home', groupsOff: [], auto: { ssids: ['Home-5G'] } },
      { id: 'cafe', name: 'Public Wi-Fi', groupsOff: [], mode: 'silent-deny', auto: { ssids: ['Café Lumière'] } },
      { id: 'work', name: 'Work', groupsOff: ['sub-telemetry'], auto: { gateways: ['10.20.0.1'] } },
    ],
    activeProfile: 'home',
    autoSwitch: true,
  };
  const settings: FwSettings = { enforce: true, defaultBlock: false, alerts: true, dnsFilter: true, dnsPort: 53, upstream: 'quad9-doh', customUpstreams: [], lists: CURATED_LISTS.map((l, i) => ({ ...l, enabled: i < 3, entries: i < 3 ? [121_000, 168_000, 312_000][i] : undefined, updated: i < 3 ? now - 5 * 3600_000 : undefined })), history: true, unusual: true, sounds: {}, soundByData: false };
  const conn = (app: string, path: string, host: string, ip: string, port = 443): Conn => ({ app: { name: app, path, browser: /Chrome|Firefox/.test(app) }, direction: 'out', host, ip, port, proto: 'tcp' });
  const alerts: FwAlert[] = [
    { id: 'a1', t: now - 40_000, conn: conn('Notion', '/Applications/Notion.app/Contents/MacOS/Notion', 'api.segment.io', '52.34.12.8'), service: 'Segment (analytics)', country: 'US', asn: 'AS16509 Amazon', reverse: 'ec2-52-34-12-8.us-west-2.compute.amazonaws.com', monitorOnly: true, attempts: 3 },
    { id: 'a2', t: now - 300_000, conn: { ...conn('python3.12', '/opt/homebrew/bin/python3.12', 'pypi.org', '151.101.0.223'), app: { name: 'python3.12', path: '/opt/homebrew/bin/python3.12', devtool: true } }, service: 'Python packages', country: 'US', asn: 'AS54113 Fastly', monitorOnly: true, attempts: 1 },
  ];
  const events: FwEvent[] = [
    { t: now - 20_000, kind: 'denied', app: 'Zoom', host: 'logfiles.zoom.us', port: 443, message: 'Zoom → logfiles.zoom.us:443 denied by “My rules”' },
    { t: now - 90_000, kind: 'denied', host: 'ad.doubleclick.net', message: 'ad.doubleclick.net blocked by your rule' },
    { t: now - 400_000, kind: 'unusual', app: 'Dropbox', bytes: 2.1e9, message: 'Dropbox sent and received 2100 MB in a minute, about 40× its usual' },
    { t: now - 3600_000, kind: 'applied', message: 'Switched to the “Home” profile for this network' },
  ];
  const conns: FwConnection[] = [
    ['Safari', 'apple.com', '17.253.144.10', 'US', 'AS714 Apple'], ['Safari', 'www.bbc.co.uk', '151.101.0.81', 'GB', 'AS54113 Fastly'], ['Spotify', 'audio-ak.spotifycdn.com', '23.215.0.1', 'SE', 'AS20940 Akamai'],
    ['Zoom', 'zoom.us', '170.114.52.2', 'US', 'AS30103 Zoom'], ['Zoom', 'logfiles.zoom.us', '3.235.69.1', 'US', 'AS14618 Amazon'], ['Dropbox', 'client.dropbox.com', '162.125.6.20', 'US', 'AS19679 Dropbox'],
    ['Mail', 'imap.fastmail.com', '103.168.172.47', 'AU', 'AS48159 Fastmail'], ['Telegram', 'telegram.org', '149.154.167.99', 'NL', 'AS62041 Telegram'], ['Notion', 'www.notion.so', '104.18.22.110', 'DE', 'AS13335 Cloudflare'],
    ['Slack', 'wss-primary.slack.com', '54.239.31.1', 'JP', 'AS16509 Amazon'], ['Safari', 'news.ycombinator.com', '209.216.230.207', 'US', 'AS21581'], ['Steam', 'steamcdn-a.akamaihd.net', '104.92.1.2', 'BR', 'AS20940 Akamai'],
  ].map(([app, host, ip, country, asn], i) => {
    const c = conn(app, `/Applications/${app}.app`, host, ip);
    const d = decide(state, c);
    return { key: `k${i}`, app, appPath: c.app.path, host, ip, port: 443, proto: 'TCP', country, asn, rateIn: Math.random() * 400_000, rateOut: Math.random() * 40_000, decision: host.includes('logfiles') ? 'deny' : d.verdict === 'ask' ? 'allow' : d.verdict, ruleId: d.rule?.id, reason: d.reason, path: i % 4 === 0 ? 'vpn' : 'direct' };
  });
  const log: QueryLogEntry[] = ['apple.com', 'ad.doubleclick.net', 'www.bbc.co.uk', 'telemetry.example.net', 'imap.fastmail.com', 'cdn.segment.com', 'api.github.com'].map((n, i) => ({ t: now - i * 41_000, name: n, type: 'A', ms: 4 + i * 3, blockedBy: /doubleclick|telemetry|segment/.test(n) ? (n.includes('doubleclick') ? 'your rule' : 'Multi PRO (ads, trackers, telemetry)') : undefined, answer: /doubleclick|telemetry|segment/.test(n) ? undefined : ['17.253.144.10'], cached: i % 3 === 0 }));
  const status = async (): Promise<FwStatus> => ({
    platform: 'darwin', caps: capabilities('darwin'), state, settings,
    enforcement: { active: true, backend: 'Packet filter (pf)', message: 'Rules are in the system packet filter', appliedAt: now - 3600_000 },
    dns: { running: true, port: 53, upstream: settings.upstream, queries: 18_412, blocked: 3_207, listsEntries: 601_000, doqAvailable: false },
    pending: alerts, recent: events, upstreams: UPSTREAMS,
  });
  const changed = async () => { emit('fw-changed'); return status(); };
  const fw: FwApi = {
    status,
    async setSettings(p) { Object.assign(settings, p); return changed(); },
    async setMode(m) { state.mode = m; return changed(); },
    async setProfile(id) { state.activeProfile = id; return changed(); },
    async saveProfile(p) { const i = state.profiles.findIndex((x) => x.id === p.id); if (i >= 0) state.profiles[i] = p; else state.profiles.push(p); return changed(); },
    async removeProfile(id) { state.profiles = state.profiles.filter((p) => p.id !== id); return changed(); },
    async setAutoSwitch(on) { state.autoSwitch = on; return changed(); },
    async saveRule(g, rule) { const grp = state.groups.find((x) => x.id === g)!; const i = grp.rules.findIndex((x) => x.id === rule.id); if (i >= 0) grp.rules[i] = rule; else grp.rules.push(rule); return changed(); },
    async removeRule(g, id) { const grp = state.groups.find((x) => x.id === g)!; grp.rules = grp.rules.filter((x) => x.id !== id); return changed(); },
    async saveGroup(g) { const have = state.groups.find((x) => x.id === g.id); if (have) Object.assign(have, g); else state.groups.push({ ...g, rules: g.rules ?? [] }); return changed(); },
    async removeGroup(id) { state.groups = state.groups.filter((g) => g.id !== id); return changed(); },
    async subscribe(url, name) { state.groups.push({ id: `sub-${state.groups.length}`, name: name ?? new URL(url).hostname, enabled: true, source: { kind: 'subscription', url, updated: Date.now() }, rules: [] }); return changed(); },
    refreshSubscriptions: changed,
    async tidy() { return tidy(state); },
    async exportRules() { return '/Users/demo/Downloads/Keeper firewall rules.json'; },
    async importRules() { return { imported: 0, problems: [] }; },
    async answer(id, verdict, scope, opts) {
      const i = alerts.findIndex((a) => a.id === id);
      if (i >= 0) { const [a] = alerts.splice(i, 1); if (scope !== 'once') state.groups[0].rules.push({ ...ruleFromAlert(a.conn, verdict, scope, opts), note: `${a.conn.app.name} → ${a.conn.host}` }); events.unshift({ t: Date.now(), kind: verdict === 'allow' ? 'allowed' : 'denied', app: a.conn.app.name, host: a.conn.host, message: `${verdict === 'allow' ? 'Allowed' : 'Denied'} ${a.conn.app.name} → ${a.conn.host}` }); }
      return changed();
    },
    async connections() { return conns.map((c) => ({ ...c, rateIn: c.rateIn * (0.6 + Math.random() * 0.8) })); },
    async history(from, to, app) {
      const step = to - from <= 86_400_000 ? 60_000 : to - from <= 90 * 86_400_000 ? 3600_000 : 86_400_000;
      const pts = [];
      for (let t = Math.floor(from / step) * step; t <= to; t += step * Math.max(1, Math.ceil((to - from) / step / 300))) {
        const h = new Date(t).getHours();
        const day = h > 8 && h < 23 ? 1 : 0.15;
        pts.push({ t, inB: Math.round(step / 1000 * 90_000 * day * (0.5 + Math.random()) * (app ? 0.3 : 1)), outB: Math.round(step / 1000 * 9_000 * day * (0.5 + Math.random()) * (app ? 0.3 : 1)) });
      }
      return { points: pts, apps: ['Safari', 'Spotify', 'Dropbox', 'Zoom', 'Mail', 'Slack', 'Telegram'].map((a, i) => ({ app: a, inB: 9e9 / (i + 1), outB: 6e8 / (i + 1) })) };
    },
    async queryLog() { return log; },
    async setDomain() { return changed(); },
    refreshLists: changed,
    async addList(url, name) { settings.lists.push({ id: `c${settings.lists.length}`, name: name ?? url, topic: 'custom', url, format: 'auto', description: 'Added by you', licence: 'See source', enabled: true }); return changed(); },
    apply: changed,
    async uninstall() { settings.enforce = false; return changed(); },
  };
  return { fw };
}
