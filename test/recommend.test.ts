// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// 1.0 defaults: tiers for every part, Recommended per computer, presets and their old names.
import { describe, expect, it } from 'vitest';
import { choicePatch, currentPreset, FEATURES, featureStates, PRESETS, presetName, presetPatch, recommend, type ComputerContext } from '../core/features';
import { TIERS } from '../core/feature-tiers';
import { approvalsFor, approvalsLine } from '../core/permissions';
import { defaultSettings, type AllSettings } from '../core/settings';

const base = (): AllSettings => defaultSettings(['/home/a/Documents'], []);
const macLaptop: ComputerContext = { platform: 'darwin', battery: true, notch: true, memoryGb: 16, cores: 10, freeDiskGb: 200, devTools: [], docker: false };
const onFor = (ctx: ComputerContext) => {
  const s = { ...base(), ...presetPatch(base(), 'recommended', ctx) };
  return [...featureStates(s, ctx.platform).values()].filter((f) => f.on).map((f) => f.id);
};

describe('tiers', () => {
  it('every part has a tier, a setup group and plain words; followers name a real part', () => {
    const ids = new Set(FEATURES.map((f) => f.id));
    for (const f of FEATURES) {
      expect(TIERS[f.id], f.id).toBeDefined();
      expect(['recommended', 'offered', 'advanced']).toContain(f.tier);
      expect(f.setup, f.id).toBeTruthy();
      expect((f.plain ?? '').length, f.id).toBeGreaterThan(2);
      if (f.follows) expect(ids.has(f.follows), `${f.id} follows ${f.follows}`).toBe(true);
    }
    for (const id of Object.keys(TIERS)) expect(ids.has(id), id).toBe(true);
  });

  it('keeps the defaults from before 1.0 for upgrades', () => {
    expect(FEATURES.find((f) => f.id === 'mail')?.defaultBefore1).toBe(true);
    expect(FEATURES.find((f) => f.id === 'mail')?.defaultOn).toBe(false);
  });
});

describe('Recommended for this computer', () => {
  it('a typical Mac laptop gets about 44 parts, far fewer than before', () => {
    const n = onFor(macLaptop).length;
    expect(n).toBeGreaterThanOrEqual(38);
    expect(n).toBeLessThanOrEqual(50);
    const before = FEATURES.filter((f) => (f.defaultBefore1 ?? f.defaultOn) && (!f.platforms || f.platforms.includes('darwin'))).length;
    expect(n).toBeLessThan(before - 40);
  });

  it('turns on the developer bundle when coding tools are found, and containers with Docker', () => {
    const dev = onFor({ ...macLaptop, devTools: ['VS Code'], docker: true });
    for (const id of ['terminal', 'agentHub', 'devServers', 'usageTracker', 'islandUsage', 'agents', 'containers']) expect(dev, id).toContain(id);
    expect(onFor(macLaptop)).not.toContain('terminal');
    // Removing the chip keeps them off.
    expect(onFor({ ...macLaptop, devTools: ['VS Code'], declined: ['dev'] })).not.toContain('terminal');
  });

  it('AI parts only with an AI on this computer', () => {
    expect(onFor(macLaptop)).not.toContain('writingHelp');
    const ai = onFor({ ...macLaptop, localAI: 'apple' });
    for (const id of ['writingHelp', 'islandAsk', 'brain', 'assistant']) expect(ai, id).toContain(id);
  });

  it('text in pictures waits for a computer with enough memory', () => {
    expect(onFor(macLaptop)).toContain('ocr');
    expect(onFor({ ...macLaptop, memoryGb: 4 })).not.toContain('ocr');
    expect(onFor({ ...macLaptop, cores: 4 })).not.toContain('ocr');
  });

  it('per system: no second malware scanner on Windows, no mic dots on a Mac', () => {
    const win = onFor({ ...macLaptop, platform: 'win32', notch: false });
    expect(win).not.toContain('security');
    expect(win).toContain('micIndicator');
    expect(onFor(macLaptop)).toContain('security');
    expect(onFor(macLaptop)).not.toContain('micIndicator');
  });

  it('notes with a vault found, Monorail when installed', () => {
    expect(onFor({ ...macLaptop, notesFound: '/Users/a/Vault' })).toContain('notes');
    expect(onFor(macLaptop)).not.toContain('notes');
    expect(onFor({ ...macLaptop, monorail: true })).toContain('monorail');
  });

  it('nothing that needs an account, a second device or sends data is on', () => {
    const on = onFor(macLaptop);
    for (const id of ['mail', 'link', 'remote', 'tracks', 'semantic', 'usageStats']) expect(on, id).not.toContain(id);
    expect(on).toContain('login');
  });

  it('without knowing the computer, recommend() matches the new defaults', () => {
    for (const f of FEATURES) if (!f.always) expect(recommend(f), f.id).toBe(f.defaultOn);
  });
});

describe('presets', () => {
  it('are Recommended, Light, Files only and Everything, and the old names still work', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['Recommended', 'Light', 'Files only', 'Everything']);
    expect(presetName('balanced')).toBe('recommended');
    expect(presetName('minimal')).toBe('light');
    expect(presetPatch(base(), 'minimal')).toEqual(presetPatch(base(), 'light'));
  });

  it('a fresh install is on Recommended; a hand-made choice is Custom (no preset)', () => {
    const fresh = { ...base(), ...presetPatch(base(), 'recommended') };
    expect(currentPreset(fresh)).toBe('recommended');
    const s = { ...base(), ...choicePatch(base(), ['cleanup', 'mail']) };
    expect(currentPreset(s)).toBeUndefined();
  });

  it('Choose: exactly the parts picked, plus what they need', () => {
    const s = { ...base(), ...choicePatch(base(), ['islandPlanner']) };
    const on = [...featureStates(s, 'linux').values()].filter((f) => f.on).map((f) => f.id);
    expect(on).toEqual(expect.arrayContaining(['library', 'islandPlanner', 'island', 'planner', 'calendars']));
    expect(on).not.toContain('cleanup');
  });
});

describe('tiered approvals', () => {
  it('Recommended on a Mac asks for at most two things now', () => {
    const a = approvalsFor('darwin', onFor(macLaptop));
    expect(a.now.map((d) => d.id).sort()).toEqual(['fullDisk', 'screen']);
    expect(a.now.find((d) => d.id === 'fullDisk')?.optional).toBe(true);
    expect(a.restarts).toBe(1);
    expect(approvalsLine(a)).toBe('2 steps · about 1 minute · Keeper restarts once at the end');
    // One-click questions wait for first use; Camera and Location never come now.
    expect(a.onUse.map((d) => d.id)).toEqual(expect.arrayContaining(['calendars', 'notifications']));
    expect(a.now.map((d) => d.id)).not.toContain('camera');
  });

  it('Accessibility and Input Monitoring only when a part needs them up front', () => {
    expect(approvalsFor('darwin', ['keepAwake', 'writingHelp']).now.map((d) => d.id)).not.toContain('accessibility');
    expect(approvalsFor('darwin', ['dictation']).now.map((d) => d.id)).toContain('accessibility');
    expect(approvalsFor('darwin', ['stage']).now.map((d) => d.id)).toEqual(expect.arrayContaining(['accessibility', 'input', 'screen']));
  });

  it('Music only when it is running; nothing already allowed; nothing on Windows', () => {
    expect(approvalsFor('darwin', ['media']).onUse.map((d) => d.id)).not.toContain('automation.music');
    expect(approvalsFor('darwin', ['media'], { musicRunning: true }).onUse.map((d) => d.id)).toContain('automation.music');
    expect(approvalsFor('darwin', ['capture'], { allowed: new Set(['screen']) }).now).toEqual([]);
    expect(approvalsFor('win32', onFor({ ...macLaptop, platform: 'win32' })).now).toEqual([]);
  });
});
