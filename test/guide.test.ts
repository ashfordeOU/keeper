// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { mergeFindings, snooze, sortFindings, summarize, verifyResult, WEEK } from '../core/guide/aggregate';
import { backupFindings, FLOWS, flowAsFinding, lockFindings, networkFindings, protectionFindings, searchHowTo, spaceFindings, startupFindings, updateFindings } from '../core/guide/builtin';
import { progress, startFlow, stepFlow } from '../core/guide/flow';
import { desktopFrom, LINKS, resolveLink, topics, type Os } from '../core/guide/links';
import { fillTerms, GUIDE_LANGS, GUIDE_UI, gt, guideLang, osTerm } from '../core/guide/strings';
import type { Finding, Fix } from '../core/guide/types';

const GB = 1024 ** 3;
const OSES: Os[] = ['darwin', 'win32', 'linux'];

function linksIn(fix: Fix): string[] {
  const out: string[] = [];
  if (fix.kind === 'open') out.push(fix.link);
  const steps = fix.kind === 'auto' ? [] : fix.steps ?? [];
  for (const s of steps) if (s.link) out.push(s.link);
  return out;
}

describe('deep-link catalog', () => {
  it('has no duplicate (topic, system, desktop) entries', () => {
    const keys = LINKS.map((l) => `${l.topic}|${l.os}|${l.desktop ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('every fallback names a topic that exists', () => {
    const t = new Set(topics());
    for (const l of LINKS) if (l.fallback) expect(t.has(l.fallback), `${l.topic} → ${l.fallback}`).toBe(true);
  });
  it('uses only the expected link kinds per system', () => {
    for (const l of LINKS) {
      if (l.os === 'darwin') expect(l.url).toMatch(/^x-apple\.systempreferences:/);
      if (l.os === 'win32') expect(l.url).toMatch(/^(ms-settings:|windowsdefender:)/);
      if (l.os === 'linux') expect(l.cmd?.[0]).toMatch(/^(gnome-control-center|systemsettings)$/);
    }
  });
  it('resolves every topic on every system (falling back to the settings app)', () => {
    for (const os of OSES) for (const d of ['gnome', 'kde', 'other'] as const) for (const t of topics()) {
      expect(resolveLink(t, os, d), `${t} on ${os}/${d}`).toBeDefined();
    }
  });
  it('picks the exact page where there is one', () => {
    expect(resolveLink('camera', 'darwin')?.url).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
    expect(resolveLink('camera', 'win32')?.url).toBe('ms-settings:privacy-webcam');
    expect(resolveLink('storageSense', 'win32')?.url).toBe('ms-settings:storagepolicies');
    expect(resolveLink('firewall', 'linux', 'kde')?.cmd).toEqual(['systemsettings', 'kcm_firewall']);
    // GNOME has no firewall page: Network, the closest.
    expect(resolveLink('firewall', 'linux', 'gnome')?.topic).toBe('network');
  });
  it('every link a built-in fix or flow uses exists for its system', () => {
    const fixes: { os: Os; fix: Fix }[] = [];
    for (const os of OSES) {
      for (const f of FLOWS) { const ff = flowAsFinding(f, os); if (ff) fixes.push({ os, fix: ff.fix }); }
      for (const c of ['filevault', 'firewall', 'gatekeeper', 'updates', 'defender', 'bitlocker', 'smartscreen', 'encryption'])
        for (const f of protectionFindings([{ id: c, name: c, description: '', status: 'off' }], os)) fixes.push({ os, fix: f.fix });
      for (const f of spaceFindings({ platform: os, phoneBackups: { bytes: 9 * GB, count: 2 }, storageSense: false })) fixes.push({ os, fix: f.fix });
    }
    for (const { os, fix } of fixes) for (const l of linksIn(fix)) {
      const own = LINKS.some((x) => x.topic === l && x.os === os);
      expect(own || resolveLink(l, os, 'gnome') !== undefined, `${l} on ${os}`).toBe(true);
    }
  });
  it('tells desktops apart', () => {
    expect(desktopFrom({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe('gnome');
    expect(desktopFrom({ XDG_CURRENT_DESKTOP: 'KDE' })).toBe('kde');
    expect(desktopFrom({})).toBe('other');
  });
});

describe('the guide speaks ten languages', () => {
  it('every guide label has all ten', () => {
    for (const [k, v] of Object.entries(GUIDE_UI)) for (const l of GUIDE_LANGS) expect(v[l], `${k}.${l}`).toBeTruthy();
  });
  it('fills placeholders and system terms, falling back to English', () => {
    expect(gt('stepOf', 'de', { n: 2, total: 5 })).toBe('Schritt 2 von 5');
    expect(osTerm('mac.privacySecurity', 'fr')).toBe('Confidentialité et sécurité');
    expect(osTerm('mac.fileVault', 'hi')).toBe('FileVault');
    expect(fillTerms('Open {term:win.storageSense}', 'es')).toBe('Open “Sensor de almacenamiento”');
    expect(guideLang('pt')).toBe('pt-BR');
    expect(guideLang('zh-cn')).toBe('zh-CN');
    expect(guideLang('xx')).toBe('en');
  });
});

describe('findings', () => {
  it('space: low disk, a full Trash, phone backups, old videos, Storage Sense', () => {
    const f = spaceFindings({ platform: 'win32', disk: { free: 4 * GB, total: 500 * GB }, trash: { bytes: 12 * GB, count: 40 }, phoneBackups: { bytes: 30 * GB, count: 3 }, oldVideos: { bytes: 20 * GB, count: 9 }, storageSense: false, cleanable: 8 * GB });
    expect(f.map((x) => x.id)).toEqual(['space:low', 'space:trash', 'space:phone-backups', 'space:old-videos', 'space:storage-sense']);
    expect(f[0].severity).toBe('critical');
    expect(f[1].fix).toEqual({ kind: 'auto', action: 'emptyTrash', label: 'Empty the Recycle Bin' });
    expect(spaceFindings({ platform: 'darwin', disk: { free: 300 * GB, total: 500 * GB }, trash: { bytes: 100, count: 1 } })).toEqual([]);
  });
  it('protection: only what is off or not fully on, with a fix per system', () => {
    const f = protectionFindings([
      { id: 'filevault', name: 'FileVault', description: 'Encrypts your disk.', status: 'off' },
      { id: 'gatekeeper', name: 'Gatekeeper', description: 'x', status: 'ok' },
      { id: 'updates', name: 'Automatic updates', description: 'x', status: 'warn' },
    ], 'darwin');
    expect(f.map((x) => [x.id, x.severity])).toEqual([['protection:filevault', 'high'], ['protection:updates', 'low']]);
    expect(f[0].fix.kind).toBe('open');
  });
  it('updates, startup, backups, network, locked folders', () => {
    expect(updateFindings({ state: 'available', version: '0.2.0' })[0].fix.kind).toBe('page');
    expect(updateFindings({ state: 'none' })).toEqual([]);
    expect(startupFindings([1, 2, 3].map((i) => ({ id: `${i}`, name: `${i}`, enabled: true, impact: 'high', scope: 'user' })))[0].fix).toMatchObject({ kind: 'auto', action: 'disableHeavyStartup' });
    expect(backupFindings({ jobs: 0 })[0].id).toBe('backup:none');
    expect(backupFindings({ jobs: 1, check321: { ok: false, copies: 2, kinds: 1, offsite: false, advice: ['Add a cloud copy'] } })[0].id).toBe('backup:321');
    expect(networkFindings({ vpnUp: true, v6Leak: true, dnsOutside: ['192.168.1.1'] }).map((x) => x.id)).toEqual(['network:v6-leak', 'network:dns-leak']);
    expect(networkFindings({ vpnUp: false, v6Leak: true, dnsOutside: [] })).toEqual([]);
    expect(lockFindings([{ path: '/a', since: Date.now() - 2 * 3600_000 }, { path: '/b', since: Date.now() }])[0].title).toMatch(/^1 locked folder has/);
  });
});

describe('the To do list', () => {
  const mk = (id: string, severity: Finding['severity'], impactBytes?: number): Finding => ({ id, source: 't', area: 'space', severity, title: id, why: '', impactBytes, fix: { kind: 'manual', steps: [] } });
  it('sorts by severity, then by space freed', () => {
    expect(sortFindings([mk('a', 'low', 1), mk('b', 'high'), mk('c', 'low', 9 * GB), mk('d', 'critical')]).map((f) => f.id)).toEqual(['d', 'b', 'c', 'a']);
  });
  it('applies snooze, ignore and done; a snooze ends; a "done" that comes back reopens', () => {
    const now = 1_000_000_000_000;
    const states = { a: snooze(undefined, now), b: { ignored: true }, c: { doneAt: now - 10_000 }, d: { doneAt: now - 3600_000 } };
    const v = mergeFindings([mk('a', 'high'), mk('b', 'high'), mk('c', 'high'), mk('d', 'high'), mk('e', 'low')], states, now);
    const st = Object.fromEntries(v.map((f) => [f.id, f.status]));
    expect(st).toEqual({ a: 'snoozed', b: 'ignored', c: 'done', d: 'open', e: 'open' });
    expect(mergeFindings([mk('a', 'high')], states, now + WEEK + 1)[0].status).toBe('open');
    expect(summarize(v)).toMatchObject({ open: 2, byArea: { space: 2 }, top: { id: 'd' } });
  });
  it('a finding a checker no longer reports is done', () => {
    expect(verifyResult('x', [mk('y', 'low')])).toBe('done');
    expect(verifyResult('y', [mk('y', 'low')])).toBe('still-needed');
  });
});

describe('walking through the steps', () => {
  it('next, skip, back, check', () => {
    let s = startFlow([{ text: '1' }, { text: '2' }, { text: '3' }]);
    s = stepFlow(s, { type: 'next' });
    s = stepFlow(s, { type: 'skip' });
    expect(s).toMatchObject({ index: 2, steps: ['done', 'skipped', 'todo'] });
    s = stepFlow(s, { type: 'back' });
    expect(s.index).toBe(1);
    s = stepFlow(s, { type: 'goto', index: 2 });
    s = stepFlow(s, { type: 'check' });
    expect(s).toMatchObject({ steps: ['done', 'skipped', 'done'], verified: 'checking' });
    expect(progress(s)).toBe(1);
    s = stepFlow(s, { type: 'checked', result: 'still-needed' });
    expect(s.verified).toBe('still-needed');
    s = stepFlow(s, { type: 'restart' });
    expect(s).toEqual({ index: 0, steps: ['todo', 'todo', 'todo'] });
  });
});

describe('How do I…?', () => {
  it('maps common goals to guided flows', () => {
    expect(searchHowTo('How do I free up space?')[0].flow.id).toBe('free-space');
    expect(searchHowTo('stop apps watching my camera')[0].flow.id).toBe('camera-access');
    expect(searchHowTo('encrypt my disk')[0].flow.id).toBe('encrypt-disk');
    expect(searchHowTo('back up my photos')[0].flow.id).toBe('backup-photos');
    expect(searchHowTo('block trackers')[0].flow.id).toBe('block-trackers');
    expect(searchHowTo('zzzz')).toEqual([]);
  });
  it('every flow has a fix on every system', () => {
    for (const f of FLOWS) for (const os of OSES) expect(flowAsFinding(f, os), `${f.id} on ${os}`).toBeDefined();
  });
});
