// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { FEATURES } from '../core/features';
import { allowAllQueue, allowLabel, buildReport, catalogueFor, inInputGroup, itemState, newlyAllowed, nextInQueue, openPaneAfterPrompt, PERMISSIONS, portalsFrom, rawFromAppleEvents, rawFromConsent, rawFromMac, regValue, requestRoute, summarize, type RawPermission } from '../core/permissions';

const ids = new Set(FEATURES.map((f) => f.id));

describe('the permission catalogue', () => {
  it('covers what the owner asked for on macOS', () => {
    const mac = catalogueFor('darwin').map((p) => p.id);
    for (const id of ['accessibility', 'screen', 'input', 'microphone', 'camera', 'fullDisk', 'automation.systemevents', 'automation.finder', 'automation.music', 'automation.notes', 'notifications', 'calendars', 'reminders', 'location', 'localNetwork', 'loginItem']) expect(mac).toContain(id);
  });
  it('covers Windows and Linux', () => {
    expect(catalogueFor('win32').map((p) => p.id)).toEqual(['microphone', 'camera', 'location', 'notifications', 'admin', 'firewall']);
    expect(catalogueFor('linux').map((p) => p.id)).toEqual(['portal.screencast', 'portal.remotedesktop', 'portal.location', 'portal.camera', 'inputGroup', 'atspi']);
  });
  it('every entry is complete and names real features', () => {
    const seen = new Set<string>();
    for (const p of PERMISSIONS) {
      const key = `${p.platform}:${p.id}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
      expect(p.why.length, key).toBeGreaterThan(20);
      expect(p.steps.length, key).toBeGreaterThan(10);
      expect(p.revoke.length, key).toBeGreaterThan(10);
      expect(p.features.length, key).toBeGreaterThan(0);
      for (const f of p.features) expect(ids.has(f), `${key} → ${f}`).toBe(true);
      if (p.how === 'settings') expect(p.settingsUrl, key).toBeTruthy();
      if (p.platform === 'darwin' && p.settingsUrl) expect(p.settingsUrl).toMatch(/^x-apple\.systempreferences:/);
      if (p.platform === 'win32' && p.settingsUrl) expect(p.settingsUrl).toMatch(/^(ms-settings|windowsdefender):/);
    }
  });
  it('names every feature that records the screen, the microphone or the camera', () => {
    // Studio records all three; the meeting recorder the screen's sound and the microphone.
    const needs: Record<string, string[]> = { screen: ['capture', 'studio', 'meetings', 'remoteScreen'], microphone: ['dictation', 'meetings', 'studio'], camera: ['island', 'studio'], 'portal.screencast': ['capture', 'studio'], 'portal.camera': ['studio'] };
    for (const p of PERMISSIONS) for (const f of needs[p.id] ?? []) expect(p.features, `${p.platform}:${p.id} → ${f}`).toContain(f);
    expect(PERMISSIONS.filter((p) => /camera/.test(p.id)).every((p) => /Studio/.test(p.why))).toBe(true);
  });
  it('marks the ones that need a restart', () => {
    expect(catalogueFor('darwin').filter((p) => p.restart).map((p) => p.id).sort()).toEqual(['input', 'screen']);
  });
});

describe('reading the system’s answers', () => {
  it('maps macOS answers', () => {
    expect(rawFromMac('granted')).toBe('authorized');
    expect(rawFromMac(true)).toBe('authorized');
    expect(rawFromMac('not-determined')).toBe('notDetermined');
    expect(rawFromMac('writeOnly')).toBe('limited');
    expect(rawFromMac('restricted')).toBe('restricted');
    expect(rawFromMac(undefined)).toBe('unknown');
    expect(rawFromAppleEvents(0)).toBe('authorized');
    expect(rawFromAppleEvents(-1743)).toBe('denied');
    expect(rawFromAppleEvents(-1744)).toBe('notDetermined');
    expect(rawFromAppleEvents(-600)).toBe('notRunning');
  });
  it('maps the Windows ConsentStore', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Software\\...\\microphone\r\n    Value    REG_SZ    Allow\r\n';
    expect(regValue(out, 'Value')).toBe('Allow');
    expect(regValue('nothing', 'Value')).toBeNull();
    expect(rawFromConsent('Allow', 'Allow')).toBe('authorized');
    expect(rawFromConsent('Allow', null)).toBe('authorized');
    expect(rawFromConsent('Allow', 'Deny')).toBe('denied');
    expect(rawFromConsent(null, null)).toBe('unknown');
  });
  it('reads Linux groups and portals', () => {
    expect(inInputGroup('alex wheel input audio')).toBe(true);
    expect(inInputGroup('alex inputs')).toBe(false);
    const p = portalsFrom('node /org/freedesktop/portal/desktop {\n  interface org.freedesktop.portal.ScreenCast {\n  };\n  interface org.freedesktop.portal.Camera {\n');
    expect([...p]).toEqual(['ScreenCast', 'Camera']);
  });
});

describe('what the screen shows', () => {
  const def = catalogueFor('darwin').find((p) => p.id === 'microphone')!;
  it('not needed while its features are off, unless already allowed', () => {
    expect(itemState(def, 'notDetermined', new Set()).state).toBe('notNeeded');
    expect(itemState(def, 'authorized', new Set()).state).toBe('allowed');
  });
  it('allowed, not yet, turned off, can’t be checked', () => {
    const on = new Set(['dictation']);
    const s = (r: RawPermission) => itemState(def, r, on).state;
    expect(s('authorized')).toBe('allowed');
    expect(s('notDetermined')).toBe('missing');
    expect(s('denied')).toBe('denied');
    expect(s('restricted')).toBe('denied');
    expect(s('unknown')).toBe('unknown');
    expect(itemState(def, 'notDetermined', on).usedBy).toEqual(['dictation']);
  });
  it('builds a report with names and restart flags', () => {
    const r = buildReport('darwin', { screen: 'authorized', microphone: 'denied' }, new Set(['capture', 'dictation']), (id) => id.toUpperCase(), { helper: true, restartPending: new Set(['screen']), now: 1 });
    const screen = r.items.find((i) => i.id === 'screen')!;
    expect(screen.restartNeeded).toBe(true);
    expect(screen.usedBy).toEqual(['CAPTURE']);
    expect(summarize(r.items).restart).toBe(true);
    expect(summarize(r.items).todo).toBeGreaterThan(0);
  });
});

describe('Allow all', () => {
  const on = new Set(FEATURES.map((f) => f.id));
  const report = (raw: Record<string, RawPermission>) => buildReport('darwin', raw, on, (x) => x, { helper: true });
  it('walks the missing ones in order and moves on when each is allowed', () => {
    const raw: Record<string, RawPermission> = { accessibility: 'authorized', screen: 'notDetermined', microphone: 'denied', camera: 'authorized' };
    const before = report(raw);
    const q = allowAllQueue(before.items);
    expect(q).not.toContain('accessibility');
    expect(q[0]).toBe('screen');
    expect(q).toContain('microphone');
    expect(nextInQueue(q, before.items, new Set())).toBe('screen');
    const after = report({ ...raw, screen: 'authorized' });
    expect(nextInQueue(q, after.items, new Set())).toBe(q[1]);
    expect(nextInQueue(q, after.items, new Set(q.slice(1)))).toBeNull();
    expect(newlyAllowed(before.items, after.items)).toEqual(['screen']);
  });
  it('leaves out explanations (Windows administrator, firewall)', () => {
    const w = buildReport('win32', {}, on, (x) => x, { helper: true });
    expect(allowAllQueue(w.items)).not.toContain('admin');
    expect(allowAllQueue(w.items)).not.toContain('firewall');
  });
});

describe('asking once, then System Settings (macOS)', () => {
  const def = (id: string) => catalogueFor('darwin').find((d) => d.id === id)!;
  it('asks the first time, opens the settings page after', () => {
    expect(requestRoute('darwin', def('accessibility'), 'missing', false)).toBe('prompt');
    expect(requestRoute('darwin', def('accessibility'), 'missing', true)).toBe('settings');
    expect(requestRoute('darwin', def('screen'), 'missing', true)).toBe('settings');
    expect(requestRoute('darwin', def('input'), 'unknown', true)).toBe('settings');
    // The others say "turned off" themselves once answered; asked before but not turned off still asks.
    expect(requestRoute('darwin', def('microphone'), 'missing', true)).toBe('prompt');
    expect(requestRoute('darwin', def('microphone'), 'denied', true)).toBe('settings');
    expect(requestRoute('darwin', def('fullDisk'), 'missing', false)).toBe('settings');
  });
  it('opens the page when the question left it off', () => {
    expect(openPaneAfterPrompt('darwin', 'screen', 'missing')).toBe(true);
    expect(openPaneAfterPrompt('darwin', 'screen', 'allowed')).toBe(false);
    expect(openPaneAfterPrompt('darwin', 'microphone', 'missing')).toBe(false);
    expect(openPaneAfterPrompt('win32', 'screen', 'missing')).toBe(false);
  });
  it('the report remembers it and the button says where it goes', () => {
    const r = buildReport('darwin', { accessibility: 'notDetermined', screen: 'notDetermined' }, new Set(['dictation', 'capture']), (x) => x, { helper: true, asked: { accessibility: 1 } });
    const ax = r.items.find((i) => i.id === 'accessibility')!;
    const sc = r.items.find((i) => i.id === 'screen')!;
    expect(ax.askedOnce).toBe(true);
    expect(ax.detail).toMatch(/press −, then \+/);
    expect(allowLabel(ax, 'darwin')).toBe('Open System Settings');
    expect(sc.askedOnce).toBe(false);
    expect(allowLabel(sc, 'darwin')).toBe('Allow');
    expect(allowLabel({ ...sc, state: 'denied' }, 'win32')).toBe('Open Settings');
  });
});
