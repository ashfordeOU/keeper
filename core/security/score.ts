// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One number for how things stand, the three things most worth doing next, and
// the findings built from permissions, browsers, connections, malware and
// persistence.

import type { AppPrivacy } from './trackers';
import type { BrowserProfile, Detection, Finding, PermissionGrant, PersistenceItem, Severity } from './types';
import { SERVICE_LABEL } from './permissions';

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const COST: Record<Severity, number> = { info: 0, low: 2, medium: 6, high: 14, critical: 30 };

export function score(findings: Finding[]): number {
  let s = 100;
  for (const x of findings) if (!x.ignored) s -= COST[x.severity];
  return Math.max(0, Math.min(100, s));
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => Number(!!a.ignored) - Number(!!b.ignored) || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.title.localeCompare(b.title));
}

export function topActions(findings: Finding[], n = 3): Finding[] {
  return sortFindings(findings).filter((x) => !x.ignored && x.severity !== 'info').slice(0, n);
}

export function scoreLabel(s: number): string {
  return s >= 90 ? 'Well protected' : s >= 70 ? 'A few things to look at' : s >= 50 ? 'Needs attention' : 'At risk';
}

// ---------------------------------------------------------------- findings from each area

export function permissionFindings(grants: PermissionGrant[]): Finding[] {
  const out: Finding[] = [];
  const allowed = (svc: PermissionGrant['service']) => [...new Set(grants.filter((g) => g.allowed && g.service === svc).map((g) => g.app))];
  for (const [svc, sev] of [['screen', 'low'], ['input', 'low'], ['accessibility', 'low'], ['files', 'info']] as const) {
    const apps = allowed(svc);
    if (apps.length) out.push({ id: `perm.${svc}`, area: 'permissions', severity: sev, title: `${apps.length} app${apps.length > 1 ? 's' : ''} can use ${SERVICE_LABEL[svc].toLowerCase()}`, why: svc === 'screen' ? 'They can see everything on your screen, including passwords as you type them.' : svc === 'input' ? 'They can see every key you press.' : svc === 'accessibility' ? 'They can click, type and read other apps as if they were you.' : 'They can open any file you can.', detail: apps.slice(0, 12).join(', '), fix: { label: 'Review who has access', action: 'open-permissions', arg: svc } });
  }
  for (const g of grants.filter((x) => x.inUse && (x.service === 'camera' || x.service === 'microphone'))) {
    out.push({ id: `perm.inuse.${g.service}.${g.app}`, area: 'permissions', severity: 'info', title: `${g.app} is using the ${g.service} right now`, why: 'Shown so nothing watches or listens without you knowing.' });
  }
  return out;
}

export function browserFindings(profiles: BrowserProfile[]): Finding[] {
  const out: Finding[] = [];
  for (const p of profiles) {
    for (const e of p.extensions.filter((x) => x.enabled && x.risk >= 35)) {
      out.push({ id: `browser.ext.${p.browser}.${e.id}`, area: 'browsers', severity: e.knownBad ? 'critical' : e.risk >= 60 ? 'high' : 'medium', title: `${p.browser}: the extension “${e.name}” ${e.knownBad ? 'is known to be malicious' : 'has broad access'}`, why: `It ${e.reasons.slice(0, 3).join(', ')}. Remove it unless you rely on it and trust its maker.`, detail: `${p.profile} · ${e.id}`, fix: { label: 'Open the extensions page', action: 'open-extensions', arg: p.browser } });
    }
    if (p.doh === 'off') out.push({ id: `browser.doh.${p.browser}.${p.profile}`, area: 'browsers', severity: 'info', title: `${p.browser} looks up addresses without encryption`, why: 'Your network and internet provider can see every site name you visit. Secure DNS hides it.' });
  }
  return out;
}

export function connectionFindings(apps: AppPrivacy[], listeners: { app: string; port: number; address: string }[]): Finding[] {
  const out: Finding[] = [];
  for (const a of apps) {
    if (a.cleartext.length) out.push({ id: `conn.clear.${a.app}`, area: 'connections', severity: 'medium', title: `${a.app} sends data without encryption`, why: 'Anyone on the same network or along the way can read it.', detail: a.cleartext.map((c) => `${c.protocol} to ${c.host}:${c.port}`).join(', ') });
    if (a.trackers.length >= 2) out.push({ id: `conn.track.${a.app}`, area: 'connections', severity: 'info', title: `${a.app} talks to ${a.trackers.length} tracking services`, why: 'Advertising and analytics companies learn what you do in it.', detail: a.trackers.map((t) => t.owner).join(', '), fix: { label: 'Block trackers with the firewall', action: 'open-firewall' } });
  }
  const exposed = listeners.filter((l) => l.address === '*' || l.address === '0.0.0.0' || l.address === '::');
  if (exposed.length) out.push({ id: 'conn.listen', area: 'connections', severity: 'low', title: `${exposed.length} program${exposed.length > 1 ? 's accept' : ' accepts'} connections from other computers`, why: 'Anything on your network can try to connect to them. Fine for things you share on purpose.', detail: exposed.map((l) => `${l.app} on port ${l.port}`).join(', ') });
  return out;
}

export function malwareFindings(o: { active: Detection[]; realtime: boolean; engines: { clamav?: { installed: boolean; signatureAgeDays?: number } }; lastFullScan?: number }): Finding[] {
  const out: Finding[] = [];
  for (const d of o.active) out.push({ id: `mal.${d.sha256 ?? d.path}`, area: 'malware', severity: d.severity, title: `${d.name} found in ${d.path.split(/[\\/]/).pop()}`, why: d.why, detail: d.path, fix: { label: 'Quarantine it', action: 'quarantine', arg: d.path } });
  if (!o.realtime) out.push({ id: 'mal.realtime', area: 'malware', severity: 'medium', title: 'Real-time protection is off', why: 'New downloads are not checked as they arrive.', fix: { label: 'Turn it on', action: 'realtime-on' } });
  const c = o.engines.clamav;
  if (!c?.installed) out.push({ id: 'mal.clamav', area: 'malware', severity: 'info', title: 'The ClamAV signature engine is not installed', why: 'Keeper’s built-in checks catch common tricks; ClamAV adds millions of known-malware signatures.', fix: { label: 'Set it up', action: 'install-clamav' } });
  else if ((c.signatureAgeDays ?? 0) > 7) out.push({ id: 'mal.signatures', area: 'malware', severity: 'medium', title: `Malware signatures are ${c.signatureAgeDays} days old`, why: 'New threats appear every day.', fix: { label: 'Update now', action: 'update-signatures' } });
  if (!o.lastFullScan || Date.now() - o.lastFullScan > 30 * 86_400_000) out.push({ id: 'mal.scan', area: 'malware', severity: 'low', title: o.lastFullScan ? 'No full scan in over a month' : 'This computer has not been fully scanned yet', why: 'A full scan finds anything that arrived before protection was on.', fix: { label: 'Scan now', action: 'scan', arg: 'full' } });
  return out;
}

export function persistenceFindings(items: PersistenceItem[], known: Set<string>): Finding[] {
  return items.filter((i) => !known.has(i.id)).map((i) => ({
    id: `persist.${i.id}`,
    area: 'persistence' as const,
    severity: (i.signed === false ? 'medium' : 'low') as Severity,
    title: `New item set to start automatically: ${i.name}`,
    why: 'Malware often installs itself to run at every start. If you just installed something, this is probably it.',
    detail: [i.command, i.location, i.signer ? `signed by ${i.signer}` : i.signed === false ? 'not signed' : undefined].filter(Boolean).join(' · '),
    fix: { label: 'Review startup items', action: 'open-startup' },
  }));
}

/** A plain report to save or share. */
export function reportText(o: { score: number; findings: Finding[]; at: number; host: string }): string {
  const lines = [`Keeper by Ashforde® — Privacy & Security report`, `${new Date(o.at).toISOString()} · ${o.host}`, '', `Score: ${o.score}/100 (${scoreLabel(o.score)})`, ''];
  for (const x of sortFindings(o.findings)) {
    lines.push(`[${x.severity.toUpperCase()}]${x.ignored ? ' (ignored)' : ''} ${x.title}`);
    lines.push(`  ${x.why}`);
    if (x.detail) lines.push(`  ${x.detail}`);
    if (x.fix) lines.push(`  Fix: ${x.fix.label}`);
    lines.push('');
  }
  lines.push('No security tool can promise to catch everything. Keeper layers several engines and checks; keep your system updated and be careful with what you open.');
  return lines.join('\n');
}

/** Fills in each fix's kind and the probe that verifies it, for the shared guided-fix layer. */
export function normalizeFindings(findings: Finding[]): Finding[] {
  return findings.map((x) => {
    if (!x.fix) return { ...x, verify: x.verify ?? x.area };
    const kind = x.fix.kind ?? (x.fix.settings ? 'open' : x.fix.action?.startsWith('open-') ? 'keeper-page' : x.fix.action ? 'auto' : 'manual');
    return { ...x, verify: x.verify ?? x.area, fix: { ...x.fix, kind } };
  });
}
