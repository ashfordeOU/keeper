// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Modes (core/modes.ts): presets over ordinary settings, add-ons that stack,
// the person's changes kept per mode, the preview, and the timed Focus session.
import { describe, expect, it } from 'vitest';
import { FEATURES, featureStates, NAV_GROUPS, wanted, type ComputerContext } from '../core/features';
import { ADDONS, badgeText, cleanAddons, getAt, MANAGED, MODES, modeBaseline, modeDef, modeKey, modeOf, modeSettings, modeTitle, normalizeModeState, normalizeSession, overrideCount, overridesOf, previewLine, previewSwitch, resetModePatch, sessionLeft, sessionSidebar, setAt, SETTING_WORDS, settingWords, startSession, suggestMode, switchPatch, withMode, type ModeChoice } from '../core/modes';
import { changedSettings, jargonIn, resetPatch, settingDef } from '../core/settings-schema';
import { defaultSettings, mergeSettings, type AllSettings } from '../core/settings';

const ctx: ComputerContext = { platform: 'linux', battery: true, memoryGb: 16, cores: 8, devTools: [], docker: false };
const fresh = (): AllSettings => defaultSettings(['/home/a/Documents'], []);
const go = (s: AllSettings, to: ModeChoice, now = 1000) => ({ ...s, ...switchPatch(s, to, ctx, now, 'linux') }) as AllSettings;
const onIds = (s: AllSettings) => new Set([...featureStates(s, 'linux').values()].filter((f) => f.on).map((f) => f.id));

describe('the modes themselves', () => {
  it('has the seven bases plus Standard, and the add-ons', () => {
    expect(MODES.map((m) => m.id)).toEqual(['standard', 'simple', 'focus', 'pro', 'researcher', 'creator', 'writer', 'family']);
    expect(ADDONS.map((a) => a.id)).toEqual(['lowVision', 'motor', 'dyslexia', 'screenReader', 'privacyMax']);
  });

  it('names only real parts, sidebar sections and settings', () => {
    const ids = new Set(FEATURES.map((f) => f.id));
    const groups = new Set(NAV_GROUPS.map((g) => g.id));
    const s = fresh();
    for (const m of [...MODES, ...ADDONS]) {
      for (const id of [...m.on, ...m.off]) expect(ids.has(id), `${m.id}: ${id}`).toBe(true);
      // a mode never switches the person's own choices (Help mode, usage stats…)
      for (const id of [...m.on, ...m.off]) expect(FEATURES.find((f) => f.id === id)?.ownChoice, `${m.id}: ${id}`).toBeFalsy();
      expect(m.on.filter((id) => m.off.includes(id)), m.id).toEqual([]);
      if (m.signature) expect(ids.has(m.signature.part), `${m.id} signature`).toBe(true);
      for (const p of Object.keys(m.settings)) {
        // every path is an ordinary setting (notices and tips arrive with the notification center)
        const top = p.split('.')[0];
        expect(top in s || ['notices', 'helpButton', 'tips'].includes(top), `${m.id}: ${p}`).toBe(true);
      }
    }
    for (const m of MODES) for (const g of m.sidebar ?? []) expect(groups.has(g), `${m.id}: ${g}`).toBe(true);
  });

  it('uses plain, short words', () => {
    for (const m of [...MODES, ...ADDONS]) {
      for (const t of [m.name, m.line, m.signature?.name ?? '', m.signature?.line ?? '']) expect(jargonIn(t), `${m.id}: ${t}`).toEqual([]);
      expect(m.name.split(' ').length, m.id).toBeLessThanOrEqual(2);
      expect(m.line.split(' ').length, m.id).toBeLessThanOrEqual(14);
    }
    for (const p of MANAGED) if (p !== 'sidebarHidden' && !p.startsWith('notices.delivery.')) expect(SETTING_WORDS[p], p).toBeDefined();
  });

  it('Standard is Keeper as it comes', () => {
    const s = fresh();
    const next = withMode(s, { base: 'standard', addons: [] }, ctx);
    for (const p of MANAGED) expect(getAt(next, p), p).toEqual(getAt(s, p));
  });

  it('keeps the sidebar of the narrow modes to a few sections', () => {
    for (const m of MODES) if (m.sidebar) expect(m.sidebar.length, m.id).toBeLessThanOrEqual(4);
    expect(modeSettings({ base: 'simple', addons: [] }).sidebarHidden).toContain('section:computer');
    // Pro shows every section; only Weather (not a daily destination) leaves the sidebar outside Standard.
    expect(modeSettings({ base: 'pro', addons: [] }).sidebarHidden).toEqual(['nav:weather']);
    expect(modeSettings({ base: 'standard', addons: [] }).sidebarHidden).toEqual([]);
  });
  it('Weather and Places & Tracks are Standard’s; the advanced readings are Pro’s', () => {
    for (const m of MODES.filter((x) => x.id !== 'standard')) {
      expect(m.off, m.id).toContain('tracks');
      expect(modeSettings({ base: m.id, addons: [] }).sidebarHidden, m.id).toContain('nav:weather');
      expect(m.off, m.id).not.toContain('weather');
    }
    const pro = MODES.find((m) => m.id === 'pro')!;
    expect(pro.on).toEqual(expect.arrayContaining(['monitorHistory', 'monitorTray', 'displayKeys']));
    for (const m of MODES.filter((x) => x.id !== 'standard' && x.id !== 'pro')) expect(m.off, m.id).toContain('monitorHistory');
  });
});

describe('switching', () => {
  it('Simple turns the heavy and technical parts off and makes the text larger', () => {
    const s = go(fresh(), { base: 'simple', addons: [] });
    const on = onIds(s);
    for (const id of ['terminal', 'firewall', 'studio', 'widgets']) expect(on.has(id), id).toBe(false);
    for (const id of ['library', 'mail', 'calendars', 'bigButtons']) expect(on.has(id), id).toBe(true);
    expect(s.a11y?.textScale).toBe(1.1);
    expect(s.mode.base).toBe('simple');
    expect(s.mode.since).toBe(1000);
  });

  it('Pro is compact, shows every setting and turns on the technical parts', () => {
    const s = go(fresh(), { base: 'pro', addons: [] });
    expect(s.density).toBe('compact');
    expect(s.settingsAdvanced).toBe(true);
    for (const id of ['terminal', 'devServers', 'processes', 'settingsCatalog']) expect(onIds(s).has(id), id).toBe(true);
  });

  it('a part a mode turns on brings what it needs', () => {
    const s = go(fresh(), { base: 'family', addons: [] });
    expect(wanted(s, 'remoteScreen', 'linux')).toBe(true);
    expect(onIds(s).has('remoteScreen')).toBe(true);
    expect(wanted(s, 'link', 'linux')).toBe(true);
  });

  it('add-ons stack on any base, and text size takes the larger', () => {
    const s = go(fresh(), { base: 'writer', addons: ['dyslexia', 'privacyMax'] });
    expect(s.font).toBe('rounded');
    expect(s.ai.provider).toBe('ollama');
    expect(onIds(s).has('weather')).toBe(false);
    expect(onIds(s).has('offlineCheck')).toBe(true);
    expect(s.a11y?.textScale).toBe(1.1);
    const big = go(fresh(), { base: 'family', addons: ['lowVision'] });
    expect(big.a11y?.textScale).toBe(1.5);
    const fam = go(fresh(), { base: 'family', addons: ['dyslexia'] });
    expect(fam.a11y?.textScale).toBe(1.25);
    expect(modeTitle({ base: 'writer', addons: ['privacyMax', 'dyslexia'] })).toBe('Writer + Easier reading + Privacy-max');
  });

  it('never touches the person’s own choices: usage stats, crash reports, opening at login', () => {
    let s = fresh();
    s = { ...s, features: { ...s.features, usageStats: true, login: true } };
    for (const m of MODES) {
      const n = go(s, { base: m.id, addons: ['privacyMax'] });
      expect(n.features.usageStats, m.id).toBe(true);
      expect(n.features.login, m.id).toBe(true);
    }
  });

  it('the person always wins: their changes are kept for the mode and come back', () => {
    let s = go(fresh(), { base: 'focus', addons: [] });
    // In Focus they turn Widgets on and pick a bigger text size.
    s = { ...s, features: { ...s.features, widgets: true }, a11y: { ...s.a11y!, textScale: 1.25 } };
    expect(overrideCount(overridesOf(s, ctx, 'linux'))).toBe(2);
    s = go(s, { base: 'pro', addons: [] }, 2000);
    expect(s.features.widgets).not.toBe(true);
    expect(s.a11y?.textScale).toBe(1);
    expect(s.mode.overrides.focus.features.widgets).toBe(true);
    s = go(s, { base: 'focus', addons: [] }, 3000);
    expect(s.features.widgets).toBe(true);
    expect(s.a11y?.textScale).toBe(1.25);
  });

  it('a change made in Standard before any mode is kept too', () => {
    let s = fresh();
    s = { ...s, density: 'compact', sidebarHidden: ['section:tidy'] };
    s = go(s, { base: 'simple', addons: [] });
    expect(s.density).toBe('comfortable');
    s = go(s, { base: 'standard', addons: [] });
    expect(s.density).toBe('compact');
    expect(s.sidebarHidden).toEqual(['section:tidy']);
  });

  it('switching to the mode you are in changes nothing', () => {
    const s = go(fresh(), { base: 'creator', addons: [] });
    const patch = switchPatch(s, { base: 'creator', addons: [] }, ctx, s.mode.since, 'linux');
    expect(Object.keys(patch)).toEqual([]);
  });

  it('reset puts the mode back as it comes', () => {
    let s = go(fresh(), { base: 'writer', addons: [] });
    s = { ...s, font: 'mono' };
    s = { ...s, ...resetModePatch(s, ctx, 5) } as AllSettings;
    expect(s.font).toBe('serif');
  });

  it('survives a round trip through the settings file, and bad values fall back', () => {
    const s = go(fresh(), { base: 'researcher', addons: ['screenReader'] });
    const back = mergeSettings(fresh(), JSON.parse(JSON.stringify(s)));
    expect(back.mode).toEqual(s.mode);
    expect(normalizeModeState({ base: 'wizard', addons: ['x', 'privacyMax'], overrides: { 'nope+x': {}, focus: { features: { widgets: true, ghost: true }, settings: { density: 'compact', secret: 1 } } } })).toEqual({ base: 'standard', addons: ['privacyMax'], overrides: { focus: { features: { widgets: true }, settings: { density: 'compact' } } }, since: 0 });
    expect(cleanAddons(['privacyMax', 'lowVision', 'lowVision'])).toEqual(['lowVision', 'privacyMax']);
    expect(modeKey({ base: 'writer', addons: ['privacyMax', 'dyslexia'] })).toBe('writer+dyslexia+privacyMax');
  });
});

describe('the preview', () => {
  it('says what turns on and off, the settings, the sidebar and that data stays', () => {
    const p = previewSwitch(fresh(), { base: 'simple', addons: [] }, ctx, 'linux');
    expect(p.turnsOff.length).toBeGreaterThan(3);
    expect(p.turnsOn).toContain('Big buttons on Today');
    expect(p.settings.find((x) => x.path === 'a11y.textScale')?.to).toBe('110%');
    expect(p.sidebar).toBe(2);
    expect(previewLine(p)).toMatch(/^Turns on \d+ parts? and off \d+\. Your data stays\.$/);
    expect(previewLine({ ...p, turnsOn: [], turnsOff: [] })).toBe('No parts change. Your data stays.');
    expect(settingWords('notices.delivery.mail', 'batched')).toEqual({ label: 'Mail notices', to: 'Batched' });
  });

  it('counts the changes kept and the ones that come back', () => {
    let s = go(fresh(), { base: 'writer', addons: [] });
    s = { ...s, font: 'mono' };
    expect(previewSwitch(s, { base: 'pro', addons: [] }, ctx, 'linux').kept).toBe(1);
    s = go(s, { base: 'pro', addons: [] });
    expect(previewSwitch(s, { base: 'writer', addons: [] }, ctx, 'linux').restored).toBe(1);
  });
});

describe('Changed and Reset compare against the mode', () => {
  it('a value the mode set is not a change; one the person changed is, and Reset goes back to the mode', () => {
    let s = go(fresh(), { base: 'pro', addons: [] });
    const density = settingDef('density')!;
    expect(changedSettings(s).some((d) => d.id === 'density')).toBe(false);
    s = { ...s, density: 'comfortable' };
    expect(changedSettings(s).some((d) => d.id === 'density')).toBe(true);
    s = { ...s, ...resetPatch(s, [density]) } as AllSettings;
    expect(s.density).toBe('compact');
    expect(modeBaseline(fresh(), 'density').managed).toBe(false);
  });
});

describe('setup goals suggest a mode', () => {
  it('points the obvious way and stays Standard otherwise', () => {
    expect(suggestMode([])).toBe('standard');
    expect(suggestMode(['files', 'clean'])).toBe('standard');
    expect(suggestMode(['record', 'files'])).toBe('creator');
    expect(suggestMode(['focus'])).toBe('focus');
    expect(suggestMode(['family', 'record'])).toBe('family');
    expect(suggestMode(['notes'])).toBe('writer');
    for (const g of ['files', 'clean', 'mail', 'notes', 'record', 'focus', 'private', 'family']) expect(modeDef(suggestMode([g]))).toBeDefined();
  });
});

describe('Focus as a timed session', () => {
  it('runs for the minutes asked, within limits, and ends by itself', () => {
    const s = startSession(50, 0);
    expect(s.until).toBe(50 * 60_000);
    expect(sessionLeft(s, 10 * 60_000)).toBe(40);
    expect(sessionLeft(s, 50 * 60_000)).toBe(0);
    expect(startSession(1, 0).until).toBe(5 * 60_000);
    expect(startSession(999, 0).until).toBe(240 * 60_000);
    expect(normalizeSession(s, 60 * 60_000)).toBeNull();
    expect(normalizeSession(s, 1)).toEqual(s);
    expect(normalizeSession({ mode: 'party', start: 0, until: 9e15 })).toBeNull();
  });

  it('shows Focus’s sidebar and its badge only while it runs; nothing saved changes', () => {
    const s = startSession(25, 0);
    expect(sessionSidebar(s, 1000)).toEqual(modeDef('focus')!.sidebar);
    expect(sessionSidebar(s, 26 * 60_000)).toBeNull();
    expect(badgeText({ base: 'pro', addons: [] }, s, 60_000)).toBe('Focus · 24 min');
    expect(badgeText({ base: 'pro', addons: ['privacyMax'] }, null)).toBe('Pro + Privacy-max');
  });

  it('modeOf reads a missing mode as Standard', () => {
    expect(modeOf({} as AllSettings)).toEqual({ base: 'standard', addons: [], overrides: {}, since: 0 });
    expect(setAt({ a: { b: 1 } }, 'a.c', 2)).toEqual({ a: { b: 1, c: 2 } });
  });
});

describe('the docs page', () => {
  it('docs/MODES.md says what each mode changes, made from this data', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { modesDoc } = await import('../core/modes');
    const file = path.resolve(__dirname, '../docs/MODES.md');
    const text = fs.readFileSync(file, 'utf8');
    const block = `<!-- modes:start -->\n${modesDoc()}<!-- modes:end -->`;
    // MODES_DOC=write rewrites the block from the data.
    if (process.env.MODES_DOC === 'write') fs.writeFileSync(file, text.replace(/<!-- modes:start -->[\s\S]*<!-- modes:end -->/, block));
    expect(fs.readFileSync(file, 'utf8')).toContain(block);
  });
});
