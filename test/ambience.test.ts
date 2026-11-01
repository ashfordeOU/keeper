// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Wallpaper, vibes, ambient sound, folder icons and the new widget helpers.
import { describe, expect, it } from 'vitest';
import { audible, describeMix, gainFor, normalizeMix, normalizeSound, sleepFade, sleepLeft } from '../core/scenes/ambient';
import { clampParams, describeSource, normalizeSource, paletteById, paletteFloats, PALETTES, sceneSource, SCENES, surprise } from '../core/scenes/catalog';
import { linuxDesktop, linuxGetCommand, linuxSetCommands, macSetScript, pathFromUri, unquoteGsettings, windowsSetScript } from '../core/scenes/desktop-cmds';
import { desktopIniWithIcon, directoryFileWithIcon, fileUri, folderIconSvg, gioSetArgs, gioUnsetArgs, normalizeIconRecords, parseGioIcon, pngsToIco, upsertRecord, type FolderIconRecord } from '../core/scenes/folder-icons';
import { paletteFromPixels } from '../core/scenes/palette';
import { frameInterval, renderPolicy, stillRefreshMs, strategyFor } from '../core/scenes/policy';
import { fragmentFor, SHADER_IDS } from '../core/scenes/shaders';
import { DEFAULT_CONDITIONS, type Conditions } from '../core/governor';
import { luminance, parseColor, themeById, themePalette } from '../core/themes';
import { applyVibeSound, applyVibeWallpaper, defaultAmbience, describeRule, normalizeAmbience, normalizeVibe, presetRules, ruleMatch, scheduledVibe, scheduleStep, STARTER_VIBES, stepVibe, sunEvents, wallpaperFor, type ScheduleContext, type VibeRule } from '../core/vibes';
import { normalizeWidgets, presetBounds, quoteOfDay, QUOTES, seasonInfo, shapeRadius, snapBounds, WIDGET_KINDS, yearProgress, newWidget } from '../core/widgets';
import { brownNoise, events, pinkNoise, seeded, whiteNoise } from '../src/lib/ambient-audio';

const C = (p: Partial<Conditions> = {}): Conditions => ({ ...DEFAULT_CONDITIONS, ...p });
const W = { enabled: true, fps: 30 as const, quality: 'balanced' as const, pauseOnBattery: false, saveOnBattery: true, pauseInFullscreen: true, pauseOnLowPower: true };

describe('scenes catalogue', () => {
  it('every scene has a shader, a known palette and a category', () => {
    for (const s of SCENES) {
      expect(SHADER_IDS).toContain(s.id);
      expect(PALETTES.some((p) => p.id === s.palette)).toBe(true);
    }
    expect(SCENES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(SCENES.map((s) => s.category)).size).toBe(6);
  });
  it('shaders are complete GLSL ES 1.0 programs with constant loop bounds', () => {
    for (const id of SHADER_IDS) {
      const f = fragmentFor(id);
      expect(f).toMatch(/vec3 scene\(vec2 uv, vec2 p\)/);
      expect(f).toMatch(/void main\(\)/);
      expect(f.split('{').length).toBe(f.split('}').length);
      for (const m of f.matchAll(/for \(int \w+ = 0; \w+ < (\w+);/g)) expect(m[1]).toMatch(/^\d+$/);
      // WebGL 1 has no dynamic array indexing on uniforms outside loops, no texture lookups here, and no 'texture(' (GLSL 3).
      expect(f).not.toMatch(/\btexture\(/);
    }
  });
  it('controls are clamped and bad sources are repaired', () => {
    expect(clampParams({ speed: 9, intensity: -1, scale: 0, grain: Number.NaN })).toMatchObject({ speed: 3, intensity: 0, scale: 0.25, grain: 0.15 });
    expect(normalizeSource({ kind: 'scene', scene: 'nope' })).toMatchObject({ kind: 'scene', scene: 'aurora' });
    expect(normalizeSource({ kind: 'web', url: 'file:///etc/passwd' })).toEqual({ kind: 'none' });
    expect(normalizeSource({ kind: 'web', url: 'https://example.com' })).toEqual({ kind: 'web', url: 'https://example.com' });
    expect(normalizeSource({ kind: 'folder', path: '/p', interval: 1 })).toMatchObject({ interval: 10, shuffle: true, motion: 'still' });
    expect(normalizeSource({ kind: 'image', path: '/a.jpg', motion: 'parallax' })).toMatchObject({ motion: 'still' });
    expect(describeSource({ kind: 'video', path: '/x/y/clip.mp4', muted: true })).toBe('Video · clip.mp4');
  });
  it('surprise never repeats the current scene and palette', () => {
    const cur = sceneSource('aurora', 'polar');
    let i = 0;
    const seq = [0, 0, 0.5, 0.5, 0.1];
    const s = surprise(() => seq[i++ % seq.length], cur);
    expect(s.kind).toBe('scene');
    expect(s.kind === 'scene' && s.scene === 'aurora' && s.palette === 'polar').toBe(false);
  });
  it('palettes become 12 floats for the shader', () => {
    const f = paletteFloats(['#ff0000', '#00ff00', '#0000ff', '#ffffff']);
    expect(f).toHaveLength(12);
    expect(f.slice(0, 3)).toEqual([1, 0, 0]);
    expect(paletteById('missing').id).toBe(PALETTES[0].id);
  });
});

describe('palettes from photos and themes', () => {
  it('finds the four colours of a picture, darkest first', () => {
    const cols = [[10, 10, 10], [200, 30, 30], [30, 200, 30], [240, 240, 240]];
    const px: number[] = [];
    for (let i = 0; i < 400; i++) { const c = cols[i % 4]; px.push(c[0], c[1], c[2], 255); }
    const p = paletteFromPixels(px, { step: 1 });
    expect(p[0]).toBe('#0a0a0a');
    expect(p[3]).toBe('#f0f0f0');
    expect(p.slice(1, 3).sort()).toEqual(['#1ec81e', '#c81e1e'].sort());
  });
  it('a theme gives four solid colours sorted by lightness', () => {
    const p = themePalette(themeById('playful'), 'dark');
    expect(p).toHaveLength(4);
    const l = p.map((c) => luminance(parseColor(c)!));
    expect([...l].sort((a, b) => a - b)).toEqual(l);
  });
});

describe('render policy', () => {
  it('runs normally at the chosen rate', () => {
    expect(renderPolicy(W, C(), { fullscreen: false })).toEqual({ run: true, fps: 30, scale: 0.75, reason: undefined });
  });
  it('stops when nobody can see it', () => {
    expect(renderPolicy(W, C({ locked: true }), { fullscreen: false }).run).toBe(false);
    expect(renderPolicy(W, C({ suspended: true }), { fullscreen: false }).run).toBe(false);
    expect(renderPolicy(W, C(), { fullscreen: true }).reason).toBe('An app is in full screen');
    expect(renderPolicy({ ...W, pauseInFullscreen: false }, C(), { fullscreen: true }).run).toBe(true);
    expect(renderPolicy(W, C(), { fullscreen: false, occluded: true }).run).toBe(false);
    expect(renderPolicy(W, C(), { fullscreen: false }, true).run).toBe(false);
    expect(renderPolicy({ ...W, enabled: false }, C(), { fullscreen: false }).reason).toBe('Paused by you');
    expect(renderPolicy(W, C({ thermal: 'serious' }), { fullscreen: false }).run).toBe(false);
  });
  it('battery and low power: pause or save energy', () => {
    expect(renderPolicy({ ...W, pauseOnBattery: true }, C({ onBattery: true }), { fullscreen: false }).run).toBe(false);
    const save = renderPolicy({ ...W, fps: 60 }, C({ onBattery: true }), { fullscreen: false });
    expect(save).toMatchObject({ run: true, fps: 30, scale: 0.5 });
    expect(renderPolicy(W, C({ lowPower: true }), { fullscreen: false }).reason).toBe('Low power mode is on');
    expect(renderPolicy({ ...W, pauseOnLowPower: false }, C({ lowPower: true }), { fullscreen: false })).toMatchObject({ run: true, scale: 0.5 });
  });
  it('slows down in minimal mode and while away', () => {
    expect(renderPolicy(W, C({ mode: 'minimal' }), { fullscreen: false })).toMatchObject({ fps: 15, scale: 0.5 });
    expect(renderPolicy(W, C({ idleSec: 600 }), { fullscreen: false }).fps).toBe(15);
    expect(renderPolicy(W, C({ idleSec: 600, mode: 'performance' }), { fullscreen: false }).fps).toBe(30);
  });
  it('picks how to reach the desktop on each system', () => {
    expect(strategyFor({ platform: 'darwin' })).toBe('desktop-window');
    expect(strategyFor({ platform: 'win32' })).toBe('workerw');
    expect(strategyFor({ platform: 'win32' }, true)).toBe('still');
    expect(strategyFor({ platform: 'linux', sessionType: 'x11', x11Display: true })).toBe('desktop-window');
    expect(strategyFor({ platform: 'linux', sessionType: 'wayland', x11Display: true })).toBe('still');
    expect(strategyFor({ platform: 'linux', waylandDisplay: true, x11Display: true })).toBe('still');
    expect(strategyFor({ platform: 'linux' })).toBe('still');
    expect(strategyFor({ platform: 'freebsd' })).toBe('off');
    expect(stillRefreshMs(sceneSource('aurora'))).toBe(30 * 60_000);
    expect(stillRefreshMs({ kind: 'image', path: '/a', motion: 'still' })).toBeNull();
    expect(frameInterval(0)).toBe(Infinity);
  });
});

describe('ambient sound', () => {
  it('mixes are tidied', () => {
    expect(normalizeMix({ rain: 2, cafe: -1, bogus: 1, waves: 0.333 })).toEqual({ rain: 1, waves: 0.33 });
    expect(normalizeSound({ playing: 'yes', master: 5 })).toMatchObject({ playing: false, master: 1 });
    expect(audible({ playing: true, mix: { rain: 0.5 }, master: 0.5 })).toBe(true);
    expect(audible({ playing: true, mix: {}, master: 0.5 })).toBe(false);
    expect(describeMix({ cafe: 0.3, rain: 0.8 })).toBe('Rain + Café');
    expect(describeMix({})).toBe('Silence');
  });
  it('levels follow a perceptual curve', () => {
    expect(gainFor(1, 1)).toBe(1);
    expect(gainFor(0.5, 1)).toBe(0.25);
    expect(gainFor(2, -1)).toBe(0);
  });
  it('the sleep timer fades over its last minute', () => {
    expect(sleepLeft(null)).toBeNull();
    expect(sleepFade(null, 0)).toBe(1);
    expect(sleepFade(1000_000, 0)).toBe(1);
    expect(sleepFade(30_000, 0)).toBe(0.5);
    expect(sleepFade(10, 20)).toBe(0);
  });
  it('sound makers are deterministic and bounded', () => {
    const a = pinkNoise(5000, seeded(3));
    const b = pinkNoise(5000, seeded(3));
    expect(a).toEqual(b);
    for (const d of [a, whiteNoise(5000, seeded(1)), brownNoise(5000, seeded(2))]) expect(Math.max(...d.map(Math.abs))).toBeLessThan(1.2);
    const drops = events(48_000, 48_000, 20, seeded(5), 'drop');
    expect(drops.filter((x) => x !== 0).length).toBeGreaterThan(100);
    expect(events(48_000, 48_000, 2, seeded(5), 'chirp').some((x) => x !== 0)).toBe(true);
  });
});

describe('folder icons', () => {
  it('desktop.ini keeps everything else and replaces old icon keys', () => {
    const before = '[.ShellClassInfo]\r\nIconFile=old.ico\r\nIconIndex=0\r\nInfoTip=Mine\r\n[ViewState]\r\nMode=4\r\n';
    const after = desktopIniWithIcon(before, 'C:\\k\\i.ico');
    expect(after).toContain('InfoTip=Mine');
    expect(after).toContain('[ViewState]\r\nMode=4');
    expect(after).toContain('IconResource=C:\\k\\i.ico,0');
    expect(after).not.toMatch(/IconFile|IconIndex/);
    expect(desktopIniWithIcon(null, 'x.ico')).toBe('[.ShellClassInfo]\r\nIconResource=x.ico,0\r\n');
    expect(desktopIniWithIcon('[Other]\r\nA=1', 'x.ico')).toBe('[Other]\r\nA=1\r\n\r\n[.ShellClassInfo]\r\nIconResource=x.ico,0\r\n');
  });
  it('KDE .directory gets Icon=', () => {
    expect(directoryFileWithIcon('[Desktop Entry]\nIcon=folder-red\nName=X\n', '/k/i.png')).toBe('[Desktop Entry]\nName=X\nIcon=/k/i.png\n');
    expect(directoryFileWithIcon(null, '/k/i.png')).toBe('[Desktop Entry]\nIcon=/k/i.png\n');
  });
  it('GIO arguments and output', () => {
    expect(fileUri('/home/a b/x.png')).toBe('file:///home/a%20b/x.png');
    expect(gioSetArgs('/d', '/i.png')).toEqual(['set', '/d', 'metadata::custom-icon', 'file:///i.png']);
    expect(gioUnsetArgs('/d')).toEqual(['set', '-t', 'unset', '/d', 'metadata::custom-icon']);
    expect(parseGioIcon('uri: file:///d\nattributes:\n  metadata::custom-icon: file:///i.png\n')).toBe('file:///i.png');
    expect(parseGioIcon('attributes:\n')).toBeNull();
  });
  it('makes a valid ICO header around PNGs', () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const ico = pngsToIco([{ png, size: 256 }, { png, size: 32 }]);
    const v = new DataView(ico.buffer);
    expect(v.getUint16(2, true)).toBe(1);
    expect(v.getUint16(4, true)).toBe(2);
    expect(ico[6]).toBe(0);
    expect(ico[22]).toBe(32);
    expect(v.getUint32(6 + 12, true)).toBe(6 + 32);
    expect(ico.length).toBe(6 + 32 + 14);
  });
  it('the SVG escapes text and rejects bad colours', () => {
    const svg = folderIconSvg({ pattern: 'stripes', color: 'red;}<script>', color2: '#fff', symbol: '<b>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;b');
    expect(svg).toContain('#4f7cff');
  });
  it('the restore list keeps the very first original', () => {
    const r = (prev: string): FolderIconRecord => ({ folder: '/f', appliedAt: 1, spec: { pattern: 'solid', color: '#000', color2: '#fff', symbol: '' }, iconFile: '/i', platform: 'linux', previous: { gioIcon: prev } });
    const list = upsertRecord(upsertRecord([], r('orig')), r('keeper-made'));
    expect(list).toHaveLength(1);
    expect(list[0].previous.gioIcon).toBe('orig');
    expect(normalizeIconRecords([r('a'), r('b'), { bad: 1 }])).toHaveLength(1);
  });
});

describe('desktop picture commands', () => {
  it('knows the desktops', () => {
    expect(linuxDesktop('ubuntu:GNOME')).toBe('gnome');
    expect(linuxDesktop('KDE')).toBe('kde');
    expect(linuxDesktop('X-Cinnamon')).toBe('cinnamon');
    expect(linuxDesktop('XFCE')).toBe('xfce');
    expect(linuxDesktop('', '')).toBe('other');
  });
  it('uses the portal first on Wayland, the desktop’s own setting first on X11', () => {
    const w = linuxSetCommands('gnome', '/a b.png', true);
    expect(w[0].file).toBe('gdbus');
    expect(w[0].args).toContain('file:///a%20b.png');
    expect(linuxSetCommands('gnome', '/a.png', false)[0]).toEqual({ file: 'gsettings', args: ['set', 'org.gnome.desktop.background', 'picture-uri', 'file:///a.png'] });
    expect(linuxSetCommands('kde', '/a.png', false)[0].file).toBe('plasma-apply-wallpaperimage');
    expect(linuxGetCommand('kde')).toBeNull();
  });
  it('reads values back', () => {
    expect(pathFromUri(unquoteGsettings("'file:///home/me/My%20Pic.jpg'\n"))).toBe('/home/me/My Pic.jpg');
    expect(pathFromUri('/plain.png')).toBe('/plain.png');
  });
  it('quotes paths safely for PowerShell and AppleScript', () => {
    expect(windowsSetScript("C:\\it's.png")).toContain("'C:\\it''s.png'");
    expect(macSetScript('/a "b".png')).toContain('POSIX file "/a \\"b\\".png"');
  });
});

describe('vibes', () => {
  it('defaults and repairs', () => {
    const d = defaultAmbience();
    expect(d.vibes.length).toBe(STARTER_VIBES.length);
    expect(d.wallpaper.enabled).toBe(false);
    const n = normalizeAmbience({ vibes: [{ id: 'x', name: '  ', wallpaper: { kind: 'scene', scene: 'rain' } }, { name: 'no id' }], activeVibe: 'gone', schedule: { enabled: true, rules: [{ id: 'r', vibe: 'x', when: { kind: 'time', from: '9:00', to: '10:00' } }, { id: 'r2', vibe: 'x', when: { kind: 'sun', from: 'sunset', offsetMin: 999 } }, { id: 'r3', vibe: 'missing', when: { kind: 'focus' } }] }, wallpaper: { fps: 7 } });
    expect(n.vibes).toHaveLength(1);
    expect(n.vibes[0].name).toBe('Vibe');
    expect(n.activeVibe).toBeNull();
    expect(n.schedule.rules).toEqual([{ id: 'r2', vibe: 'x', enabled: true, when: { kind: 'sun', from: 'sunset', offsetMin: 240 } }]);
    expect(n.wallpaper.fps).toBe(30);
    expect(normalizeAmbience(null).vibes.length).toBe(STARTER_VIBES.length);
    expect(normalizeVibe({ id: 'v', emoji: '🌧️🌧️🌧️' })!.emoji.length).toBeLessThanOrEqual(4);
  });
  it('steps through vibes and wraps', () => {
    const vs = STARTER_VIBES;
    expect(stepVibe(vs, null, 1)!.id).toBe(vs[0].id);
    expect(stepVibe(vs, vs[vs.length - 1].id, 1)!.id).toBe(vs[0].id);
    expect(stepVibe(vs, vs[0].id, -1)!.id).toBe(vs[vs.length - 1].id);
    expect(stepVibe([], null, 1)).toBeNull();
  });
  it('applies a vibe’s wallpaper and sound, and leaves alone what it does not set', () => {
    const d = defaultAmbience();
    const rainy = STARTER_VIBES.find((v) => v.id === 'rainy')!;
    const w = applyVibeWallpaper({ ...d.wallpaper, perDisplay: { 2: sceneSource('snow') } }, rainy);
    expect(w.default).toEqual(rainy.wallpaper);
    expect(w.perDisplay).toEqual({});
    expect(applyVibeWallpaper(d.wallpaper, { ...rainy, wallpaper: null, perDisplay: undefined })).toBe(d.wallpaper);
    expect(applyVibeSound({ ...d.sound, sleepAt: 5 }, rainy)).toMatchObject({ playing: true, mix: { rain: 0.8, wind: 0.2 }, sleepAt: 5 });
    expect(wallpaperFor({ default: sceneSource('aurora'), perDisplay: { 7: { kind: 'none' } } }, 7)).toEqual({ kind: 'none' });
  });
});

describe('the schedule', () => {
  const at = (h: number, m = 0, day = 15) => new Date(2026, 5, day, h, m).getTime(); // 15 June 2026 is a Monday
  const ctx = (now: number, p: Partial<ScheduleContext> = {}): ScheduleContext => ({ now, place: null, manualSun: { sunrise: '07:00', sunset: '19:00' }, onBattery: false, batteryPercent: null, focusActive: false, ...p });
  const rule = (when: VibeRule['when'], vibe = 'v', id = 'r'): VibeRule => ({ id, vibe, enabled: true, when });

  it('time rules, overnight and by weekday', () => {
    const work = rule({ kind: 'time', from: '09:00', to: '17:00', days: [1, 2, 3, 4, 5] });
    expect(ruleMatch(work, ctx(at(10))).on).toBe(true);
    expect(ruleMatch(work, ctx(at(17))).on).toBe(false);
    expect(ruleMatch(work, ctx(at(10, 0, 14))).on).toBe(false); // Sunday
    const night = rule({ kind: 'time', from: '22:00', to: '06:00', days: [1] });
    expect(ruleMatch(night, ctx(at(23))).on).toBe(true);
    expect(ruleMatch(night, ctx(at(3, 0, 16))).on).toBe(true); // started Monday night
    expect(ruleMatch(night, ctx(at(3, 0, 15))).on).toBe(false); // started Sunday night
    expect(ruleMatch(night, ctx(at(23))).key).not.toBe(ruleMatch(night, ctx(at(23, 0, 22))).key);
  });
  it('sun rules with manual times and an offset', () => {
    const evening = rule({ kind: 'sun', from: 'sunset', offsetMin: -30 });
    expect(ruleMatch(evening, ctx(at(18, 40))).on).toBe(true);
    expect(ruleMatch(evening, ctx(at(18, 20))).on).toBe(false);
    expect(ruleMatch(evening, ctx(at(3))).on).toBe(true);
    expect(ruleMatch(evening, ctx(at(8))).on).toBe(false);
    const day = rule({ kind: 'sun', from: 'sunrise', offsetMin: 0 });
    expect(ruleMatch(day, ctx(at(12))).on).toBe(true);
  });
  it('sun rules from a real place, including midnight sun', () => {
    const london = { lat: 51.5, lon: -0.12 };
    const ev = sunEvents({ now: Date.UTC(2026, 5, 15, 12), place: london, manualSun: { sunrise: '07:00', sunset: '19:00' } });
    expect(ev.length).toBe(6);
    const day = rule({ kind: 'sun', from: 'sunrise', offsetMin: 0 });
    expect(ruleMatch(day, ctx(Date.UTC(2026, 5, 15, 12), { place: london })).on).toBe(true);
    expect(ruleMatch(day, ctx(Date.UTC(2026, 5, 15, 23, 30), { place: london })).on).toBe(false);
    const tromso = { lat: 69.65, lon: 18.96 };
    expect(ruleMatch(day, ctx(Date.UTC(2026, 5, 21, 23), { place: tromso })).on).toBe(true);
  });
  it('battery and focus rules', () => {
    const low = rule({ kind: 'battery', below: 30 });
    expect(ruleMatch(low, ctx(at(10), { onBattery: true, batteryPercent: 25 })).on).toBe(true);
    expect(ruleMatch(low, ctx(at(10), { onBattery: true, batteryPercent: 50 })).on).toBe(false);
    expect(ruleMatch(low, ctx(at(10), { onBattery: false, batteryPercent: 10 })).on).toBe(false);
    expect(ruleMatch(rule({ kind: 'battery', below: null }), ctx(at(10), { onBattery: true })).on).toBe(true);
    expect(ruleMatch(rule({ kind: 'focus' }), ctx(at(10), { focusActive: true })).on).toBe(true);
  });
  it('first matching rule wins, with a fallback', () => {
    const s = { rules: [rule({ kind: 'focus' }, 'deep', 'a'), rule({ kind: 'time', from: '00:00', to: '23:59', days: [0, 1, 2, 3, 4, 5, 6] }, 'day', 'b')], fallback: 'calm' };
    expect(scheduledVibe(s, ctx(at(10), { focusActive: true })).vibe).toBe('deep');
    expect(scheduledVibe(s, ctx(at(10))).vibe).toBe('day');
    expect(scheduledVibe({ ...s, rules: [] }, ctx(at(10))).vibe).toBe('calm');
    expect(scheduledVibe({ rules: [{ ...s.rules[0], enabled: false }], fallback: null }, ctx(at(10), { focusActive: true })).vibe).toBeNull();
  });
  it('a vibe chosen by hand holds until the next boundary', () => {
    const sched = { ...defaultAmbience().schedule, enabled: true, rules: [rule({ kind: 'time', from: '09:00', to: '17:00', days: [0, 1, 2, 3, 4, 5, 6] }, 'work')] };
    const first = scheduleStep(sched, ctx(at(9, 1)), null);
    expect(first.switchTo).toBe('work');
    // The person switched by hand at 10:00; the next look, still inside the same stretch, changes nothing.
    expect(scheduleStep(sched, ctx(at(10)), first.key).switchTo).toBeNull();
    // At 17:00 the stretch ends (no fallback: nothing to switch to, but the key moves on).
    const after = scheduleStep(sched, ctx(at(17, 1)), first.key);
    expect(after.switchTo).toBeNull();
    expect(after.key).toBe('none');
    // Next morning: the rule applies again.
    expect(scheduleStep(sched, ctx(at(9, 1, 16)), after.key).switchTo).toBe('work');
    expect(scheduleStep({ ...sched, enabled: false }, ctx(at(9, 1)), null).switchTo).toBeNull();
  });
  it('presets and descriptions', () => {
    const vs = STARTER_VIBES;
    const dn = presetRules('day-night', vs);
    expect(dn.map((r) => r.vibe)).toEqual(['morning', 'evening']);
    expect(describeRule(dn[1], vs)).toBe('Evening · from sunset until sunrise');
    expect(describeRule(presetRules('work-week', vs)[0], vs)).toBe('Deep work · 09:00–17:30, weekdays');
    expect(describeRule(presetRules('battery', vs)[0], vs)).toBe('Battery saver · on battery');
  });
});

describe('new widget kinds and arranging', () => {
  it('has the new kinds, each with an icon size', () => {
    for (const k of ['day', 'year', 'season', 'world', 'quote'] as const) expect(WIDGET_KINDS.some((x) => x.kind === k)).toBe(true);
    expect(newWidget('world', { x: 0, y: 0 }).options.places?.length).toBe(4);
    expect(normalizeWidgets([{ id: 'a', kind: 'quote', bounds: { x: 0, y: 0, width: 1, height: 1 } }])[0].style.shape).toBe('card');
  });
  it('size presets and shapes', () => {
    expect(presetBounds('clock', 'L', { x: 1, y: 2 })).toEqual({ x: 1, y: 2, width: 308, height: 308 });
    const c = presetBounds('weather', 'M', { x: 0, y: 0 }, 'circle');
    expect(c.width).toBe(c.height);
    expect(presetBounds('weather', 'M', { x: 0, y: 0 }, 'pill').height).toBeLessThanOrEqual(Math.round(300 / 2.2));
    expect(shapeRadius({ shape: 'circle', radius: 10 }, { width: 100, height: 100 })).toBe('50%');
    expect(shapeRadius({ shape: 'pill', radius: 10 }, { width: 300, height: 80 })).toBe(40);
    expect(shapeRadius({ radius: 10 }, { width: 1, height: 1 })).toBe(10);
  });
  it('quote of the day is stable for a day and changes the next', () => {
    const d1 = new Date(2026, 0, 5, 9).getTime();
    expect(quoteOfDay(d1)).toBe(quoteOfDay(d1 + 3600_000 * 10));
    expect(quoteOfDay(d1)).not.toBe(quoteOfDay(d1 + 86_400_000));
    expect(QUOTES).toContain(quoteOfDay(d1));
    expect(quoteOfDay(d1, ['only'])).toBe('only');
    expect(quoteOfDay(d1, ['', '  '])).toBe(quoteOfDay(d1));
  });
  it('year progress and seasons', () => {
    const y = yearProgress(new Date(2026, 6, 2, 12).getTime());
    expect(y.year).toBeGreaterThan(0.49);
    expect(y.year).toBeLessThan(0.51);
    expect(y.dayOfYear).toBe(183);
    expect(y.daysInYear).toBe(365);
    expect(y.day).toBeCloseTo(0.5, 2);
    const s = seasonInfo(new Date(2026, 6, 1).getTime());
    expect(s.season).toBe('summer');
    expect(s.next).toBe('autumn');
    expect(seasonInfo(new Date(2026, 6, 1).getTime(), 'south').season).toBe('winter');
    expect(seasonInfo(new Date(2026, 0, 10).getTime()).season).toBe('winter');
  });
  it('snaps to the screen edges, the centre and neighbours', () => {
    const area = { x: 0, y: 25, width: 1440, height: 875 };
    expect(snapBounds({ x: 9, y: 30, width: 200, height: 100 }, [], area)).toMatchObject({ x: 16, y: 41 });
    expect(snapBounds({ x: 610, y: 400, width: 200, height: 100 }, [], area).x).toBe(620);
    const other = { x: 100, y: 100, width: 200, height: 150 };
    expect(snapBounds({ x: 305, y: 104, width: 120, height: 80 }, [other], area)).toMatchObject({ x: 312, y: 100 });
    expect(snapBounds({ x: 500, y: 500, width: 100, height: 100 }, [other], area)).toMatchObject({ x: 500, y: 500 });
    expect(snapBounds({ x: 2000, y: -50, width: 100, height: 100 }, [], area)).toMatchObject({ x: 1340, y: 25 });
  });
});
