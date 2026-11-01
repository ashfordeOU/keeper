// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Privacy & Security findings in Keeper's shared To do list and guided fixes:
// each finding becomes a guide finding (Keeper fixes it, opens the right
// settings page from the catalogue, or shows the Keeper page), and each fix
// Keeper can do itself is registered once. The basic protections (firewall,
// disk encryption…) are already registered by the guide's own sources.

import type { Finding as GuideFinding, Fix } from '../../../core/guide/types';
import type { Finding } from '../../../core/security/types';
import { registerAutoFix, registerFindings } from '../guide';
import * as sec from './index';

/** Catalogue topics (core/guide/links.ts) for findings whose fix is a settings page. */
function topicFor(id: string): string | undefined {
  if (id.startsWith('posture.autologin')) return 'users';
  if (id.startsWith('posture.screenlock')) return 'security';
  if (id.startsWith('posture.sharing')) return 'sharing';
  if (id.startsWith('posture.telemetry')) return 'diagnostics';
  if (id.startsWith('posture.wifi')) return 'wifi';
  if (id.startsWith('posture.roots') || id.startsWith('posture.kext')) return 'security';
  if (id === 'perm.screen') return 'screen';
  if (id === 'perm.accessibility') return 'accessibility';
  if (id === 'perm.input' || id === 'perm.files') return 'privacy';
  return undefined;
}

const PAGE: Record<string, string> = { 'open-permissions': 'watch', 'open-extensions': 'browsers', 'open-firewall': 'connections' };
const AUTO = new Set(['realtime-on', 'install-clamav', 'update-signatures', 'scan', 'quarantine', 'run']);

export function toGuide(f: Finding): GuideFinding | null {
  if (f.id.startsWith('protection.') || f.severity === 'info' || f.ignored) return null;
  const area: GuideFinding['area'] = f.area === 'posture' || f.area === 'malware' || f.area === 'persistence' ? 'security' : 'privacy';
  let fix: Fix;
  const steps = (f.fix?.steps ?? (f.fix ? [f.fix.label] : [])).map((text) => ({ text }));
  if (f.fix?.action && AUTO.has(f.fix.action)) fix = { kind: 'auto', action: `security.${f.fix.action}`, label: f.fix.label, needsAdmin: f.fix.action === 'install-clamav' || f.fix.action === 'run' };
  else if (f.fix?.action === 'open-startup') fix = { kind: 'page', route: { name: 'startup' }, label: f.fix.label };
  else if (f.fix?.action && PAGE[f.fix.action]) fix = { kind: 'page', route: { name: 'protection', arg: PAGE[f.fix.action] }, label: f.fix.label, highlight: f.id };
  else if (topicFor(f.id)) fix = { kind: 'open', link: topicFor(f.id)!, label: f.fix?.label, steps: steps.length ? steps : [{ text: f.why }] };
  else if (steps.length) fix = { kind: 'manual', steps };
  else fix = { kind: 'page', route: { name: 'protection', arg: f.area === 'posture' ? 'checks' : f.area === 'permissions' ? 'watch' : f.area }, highlight: f.id };
  return { id: `security:${f.id}`, source: 'security', area, severity: f.severity, title: f.title, why: f.why, impact: f.impact, fix };
}

export function registerSecurityGuide() {
  registerFindings('security', async () => {
    const o = await sec.overview();
    return o.findings.map(toGuide).filter((x): x is GuideFinding => !!x);
  });
  for (const action of AUTO) {
    registerAutoFix(`security.${action}`, {
      async preview(g) {
        const label = g.fix.kind === 'auto' ? g.fix.label : g.title;
        return { summary: `${label}: ${g.title}`, items: [], undoable: action === 'quarantine', needsAdmin: action === 'install-clamav' || action === 'run', warning: action === 'quarantine' ? 'The file is encrypted and removed; you can put it back from Privacy & Security → Malware.' : undefined };
      },
      async apply(g) {
        return sec.fix(g.id.replace(/^security:/, ''));
      },
    });
  }
}
