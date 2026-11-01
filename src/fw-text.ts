// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Firewall rules in plain words.

import type { FwRule } from '../core/fw/rules';

const GROUP: Record<string, string> = { system: 'System processes', devtools: 'Developer tools', browsers: 'Web browsers', any: 'Any app' };

export function appText(a: FwRule['app']): string {
  if (a === 'any') return 'Any app';
  if (a.group) return GROUP[a.group] ?? a.group;
  const name = a.path ? a.path.split(/[\\/]/).filter(Boolean).find((p) => p.endsWith('.app'))?.replace(/\.app$/, '') ?? a.path.split(/[\\/]/).pop() : undefined;
  return name ?? (a.signer ? `Apps signed by ${a.signer}` : a.bundleId ?? 'An app');
}

/** "Zoom → zoom.us (and subdomains), port 443, TCP, outgoing" */
export function describeRuleTarget(r: FwRule): string {
  const where = r.host && r.host !== 'any'
    ? r.host.startsWith('=') ? r.host.slice(1) : r.host.startsWith('*.') ? `subdomains of ${r.host.slice(2)}` : `${r.host} and subdomains`
    : r.ip ? r.ip : 'anywhere';
  const bits = [`${appText(r.app)} → ${where}`];
  if (r.port) bits.push(`port ${r.port}`);
  if (r.proto && r.proto !== 'any') bits.push(r.proto.toUpperCase());
  if (r.direction !== 'out') bits.push(r.direction === 'in' ? 'incoming' : 'both ways');
  // Notes written by Keeper ("App → host") only repeat the rule; the person's own notes are shown.
  return bits.join(', ') + (r.note && !r.note.includes('→') ? ` — ${r.note}` : '');
}
