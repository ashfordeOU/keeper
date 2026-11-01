// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  MONORAIL, MONORAIL_TOOLS, acceleratorCombo, avoidSlider, checkSignature, checksumFor, compareVersions, connectPatch, describeState, describeToolCall,
  findClashes, keeperAccelerators, missingFloatRules, monorailShortcuts, monorailThemeFor, monorailUrl, newestRelease, parseCodesign, parseState,
  pickAssets, sliderBand, withFloatRules, MOD, type Release,
} from '../core/ashforde/monorail';
import { ASHFORDE_APPS, offeredOn } from '../core/ashforde/apps';
import { featureDef, featureStates, wanted } from '../core/features';
import { activitiesFrom, transientsFrom } from '../core/island-activities';
import { THEMES } from '../core/themes';
import { defaultSettings } from '../core/settings';

const rel = (tag: string, extra: Partial<Release> = {}): Release => ({
  tag_name: tag,
  assets: [
    { name: `Monorail-${tag.replace(/^v/, '')}.zip`, browser_download_url: `https://example.invalid/${tag}.zip` },
    { name: `Monorail-${tag.replace(/^v/, '')}.dmg`, browser_download_url: `https://example.invalid/${tag}.dmg` },
    { name: 'SHA256SUMS', browser_download_url: `https://example.invalid/${tag}/SHA256SUMS` },
  ],
  ...extra,
});

describe('Monorail releases', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.1.0', '1.1.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);
  });

  it('picks the zip and the checksum list, also from the earlier name', () => {
    const r = pickAssets(rel('v1.1.0'))!;
    expect(r.archive.name).toBe('Monorail-1.1.0.zip');
    expect(r.sums.name).toBe('SHA256SUMS');
    const legacy = pickAssets({ tag_name: 'v0.9.0', assets: [{ name: 'MacSlider-0.9.0.zip', browser_download_url: 'x' }, { name: 'SHA256SUMS', browser_download_url: 'y' }] });
    expect(legacy?.archive.name).toBe('MacSlider-0.9.0.zip');
    expect(pickAssets({ tag_name: 'v1', assets: [{ name: 'Monorail-1.zip', browser_download_url: 'x' }] })).toBeNull();
  });

  it('chooses the newest finished release with an app', () => {
    const list = [rel('v1.0.4'), rel('v1.2.0', { prerelease: true }), rel('v1.1.0'), rel('v1.3.0', { draft: true }), { tag_name: 'v9.0.0', assets: [] }];
    expect(newestRelease(list)?.tag_name).toBe('v1.1.0');
    expect(newestRelease(list, true)?.tag_name).toBe('v1.2.0');
  });

  it('reads checksums in shasum format', () => {
    const hex = 'a'.repeat(64);
    const sums = `${'b'.repeat(64)}  Monorail-1.1.0.dmg\n${hex}  Monorail-1.1.0.zip\n`;
    expect(checksumFor(sums, 'Monorail-1.1.0.zip')).toBe(hex);
    expect(checksumFor(`${hex.toUpperCase()} *dist/Monorail-1.1.0.zip`, 'Monorail-1.1.0.zip')).toBe(hex);
    expect(checksumFor(sums, 'Other.zip')).toBeNull();
  });
});

describe('Monorail signature', () => {
  const out = `Executable=/Applications/Monorail.app/Contents/MacOS/Monorail
Identifier=org.ashforde.macslider
Format=app bundle with Mach-O universal (x86_64 arm64)
Authority=MacSlider Self-Signed
Signed Time=31 Oct 2026 at 10:00:00
TeamIdentifier=not set`;

  it('parses codesign output', () => {
    const s = parseCodesign(out);
    expect(s.identifier).toBe(MONORAIL.bundleId);
    expect(s.authorities).toEqual(['MacSlider Self-Signed']);
    expect(s.teamId).toBeUndefined();
    expect(s.adhoc).toBe(false);
    expect(parseCodesign('Identifier=x\nSignature=adhoc').adhoc).toBe(true);
  });

  it('accepts only Monorail’s own certificate, and the pinned one once known', () => {
    const s = parseCodesign(out);
    expect(checkSignature(s, 'abc', undefined).ok).toBe(true);
    expect(checkSignature(s, 'abc', 'ABC').ok).toBe(true);
    expect(checkSignature(s, 'abc', 'def').ok).toBe(false);
    expect(checkSignature({ ...s, identifier: 'com.evil.app' }, 'abc', undefined).ok).toBe(false);
    expect(checkSignature({ ...s, authorities: ['Someone Else'] }, 'abc', undefined).ok).toBe(false);
    expect(checkSignature({ ...s, adhoc: true }, 'abc', undefined).ok).toBe(false);
  });
});

describe('Monorail state and settings', () => {
  it('parses state.json leniently', () => {
    const st = parseState(JSON.stringify({ workspace: 2, workspaceName: 'Writing', workspaceCount: 3, profile: 'Default', slide: 1, slides: 4, app: 'Safari', focusMode: true }))!;
    expect(st.workspaceName).toBe('Writing');
    expect(describeState(st)).toBe('Writing · slide 1 of 4 · focus');
    expect(parseState('{"workspace":1}')).toBeNull();
    expect(parseState('not json')).toBeNull();
    expect(parseState('{"workspace":3,"slides":2}')?.workspaceName).toBe('Workspace 3');
  });

  it('connects by turning on only the local API and the state file', () => {
    expect(connectPatch({})).toEqual({ localAPI: true, publishState: true });
    expect(connectPatch({ localAPI: true, publishState: true })).toEqual({});
  });

  it('adds and removes Keeper’s float rules without touching others', () => {
    const mine = { bundleID: 'com.apple.Safari', name: 'Safari', float: false };
    const added = withFloatRules({ appRules: [mine] }, true);
    expect(added.appRules?.[0]).toEqual(mine);
    expect(missingFloatRules(added)).toEqual([]);
    expect(missingFloatRules({ appRules: [mine] }).length).toBe(3);
    expect(withFloatRules(added, false).appRules).toEqual([mine]);
    // idempotent
    expect(withFloatRules(added, true).appRules?.length).toBe(added.appRules?.length);
  });
});

describe('shortcuts', () => {
  it('reads Electron accelerators as Mac keys', () => {
    expect(acceleratorCombo('CommandOrControl+Shift+Space')).toEqual({ mods: MOD.command | MOD.shift, key: 'Space' });
    expect(acceleratorCombo('Control+Alt+H')).toEqual({ mods: MOD.control | MOD.option, key: 'H' });
    expect(acceleratorCombo('Hyper+X')).toBeNull();
  });

  it('knows Monorail’s defaults, including workspace digits', () => {
    const d = monorailShortcuts({});
    expect(d.find((k) => k.action === 'focusLeft' && k.key === 'H')?.mods).toBe(MOD.control | MOD.option);
    expect(d.find((k) => k.action === 'workspace1')?.key).toBe('1');
    expect(d.find((k) => k.action === 'snapMaximize')?.key).toBe('Return');
  });

  it('uses the keymap from its settings when there is one', () => {
    const custom = monorailShortcuts({ keymap: { focusLeft: [{ keyCode: 0, modifiers: MOD.command | MOD.shift }] } });
    expect(custom).toEqual([{ action: 'focusLeft', mods: MOD.command | MOD.shift, key: 'A' }]);
  });

  it('finds keys both apps want', () => {
    const keeper = keeperAccelerators({ quickSearchShortcut: 'CommandOrControl+Shift+Space', island: { captureShortcut: 'Control+Alt+B', enabled: true }, nested: { list: ['a+b'] } });
    expect(keeper).toEqual({ quickSearchShortcut: 'CommandOrControl+Shift+Space', 'island.captureShortcut': 'Control+Alt+B' });
    const clashes = findClashes(keeper, monorailShortcuts({}));
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ keeper: 'island.captureShortcut', monorail: 'toggleFocusMode', label: '⌃⌥B' });
  });

  it('Keeper’s default shortcuts do not clash with Monorail’s defaults', () => {
    expect(findClashes(keeperAccelerators(defaultSettings([], [])), monorailShortcuts({}))).toEqual([]);
  });
});

describe('the slider bar and the Island', () => {
  const work = { x: 0, y: 25, width: 1512, height: 920 };
  const placement = { collapsed: { x: 656, y: 0, width: 200, height: 32 }, expanded: { x: 556, y: 0, width: 400, height: 300 }, reason: 'Hangs from the notch.' };

  it('only takes room when the slider is at the top', () => {
    expect(sliderBand({}, work)).toBeNull();
    expect(sliderBand({ sliderBarEdge: 'bottom' }, work)).toBeNull();
    expect(sliderBand({ sliderBarEdge: 'top', sliderBar: 'off' }, work)).toBeNull();
    const b = sliderBand({ sliderBarEdge: 'top', sliderBar: 'always' }, work)!;
    expect(b).toEqual({ x: 378, y: 31, width: 756, height: 52 });
  });

  it('opens the Island’s panel below the slider instead of over it', () => {
    const band = sliderBand({ sliderBarEdge: 'top' }, work);
    const p = avoidSlider(placement, band);
    expect(p.collapsed).toEqual(placement.collapsed);
    // The panel starts at the top of the window (y 0), above the slider's bottom: it is moved below the slider.
    expect(avoidSlider({ ...placement, expanded: { ...placement.expanded, y: 32 } }, band).expanded.y).toBe(31 + 52 + 4);
    expect(p.reason).toBe(placement.reason);
    expect(avoidSlider(placement, null)).toBe(placement);
  });

  it('moves a pill that would sit on the slider (no notch, below the menu bar)', () => {
    const band = sliderBand({ sliderBarEdge: 'top' }, work)!;
    const below = { collapsed: { x: 656, y: 30, width: 200, height: 32 }, expanded: { x: 556, y: 30, width: 400, height: 300 }, reason: 'Below the menu bar.' };
    const p = avoidSlider(below, band);
    expect(p.collapsed.y).toBe(band.y + band.height + 4);
    expect(p.expanded.y - p.collapsed.y).toBe(0);
    expect(p.reason).toMatch(/slider bar/);
  });
});

describe('themes, links and tools', () => {
  it('gives every Keeper theme a Monorail theme', () => {
    for (const t of THEMES) expect(monorailThemeFor(t.id)).toBeTruthy();
    expect(monorailThemeFor('fjord')).toBe('nord');
    expect(monorailThemeFor('playful', true)).toBe('seasons');
    expect(monorailThemeFor('no-such-theme')).toBe('vivid');
  });

  it('builds monorail:// links', () => {
    expect(monorailUrl({ kind: 'focus-mode', on: true })).toBe('monorail://focus-mode/on');
    expect(monorailUrl({ kind: 'workspace', n: 2.7 })).toBe('monorail://workspace/2');
    expect(monorailUrl({ kind: 'layout', arg: 'Deep Work' })).toBe('monorail://layout/Deep%20Work');
    expect(monorailUrl({ kind: 'palette' })).toBe('monorail://palette');
  });

  it('offers every tool of Monorail’s MCP server, reads as read-only', () => {
    const names = MONORAIL_TOOLS.map((t) => t.name);
    for (const n of ['get_state', 'list_windows', 'list_workspaces', 'focus_window', 'move_window', 'pair_windows', 'switch_workspace', 'perform_action', 'apply_layout', 'open_app_pair', 'run_template', 'undo', 'redo', 'get_history', 'name_slide', 'set_slide_layout', 'close_window', 'note_window', 'notify', 'get_insights']) expect(names).toContain(n);
    expect(MONORAIL_TOOLS.filter((t) => t.readOnly).every((t) => t.method === 'GET')).toBe(true);
    expect(MONORAIL_TOOLS.find((t) => t.name === 'close_window')?.destructive).toBe(true);
    expect(describeToolCall('monorail_move_window', { id: 4, workspace: 2 })).toBe('use Monorail: move window (id 4, workspace 2)');
  });
});

describe('the feature switch and the Island', () => {
  it('is off by default and only offered on macOS', () => {
    const s = defaultSettings([], []);
    expect(featureDef('monorail')?.defaultOn).toBe(false);
    expect(featureStates(s, 'darwin').get('monorail')?.on).toBe(false);
    expect(wanted({ ...s, features: { monorail: true } }, 'monorail', 'darwin')).toBe(true);
    expect(wanted({ ...s, features: { monorail: true } }, 'monorail', 'linux')).toBe(false);
    expect(wanted({ ...s, features: { monorail: true } }, 'monorail', 'win32')).toBe(false);
    const m = ASHFORDE_APPS.find((a) => a.id === 'monorail')!;
    expect(offeredOn(m, 'darwin')).toBe(true);
    expect(offeredOn(m, 'linux')).toBe(false);
    expect(m.elsewhere).toMatch(/Windows and Linux/);
  });

  it('shows a short note when Monorail changes workspace', () => {
    const base = { shelf: [], shelves: [], activeShelf: '', closedShelves: [], clips: [], focus: { mode: 'idle', focusMin: 25, breakMin: 5, endsAt: 0 }, keepAwake: { on: false }, agents: [], events: [], alerts: [] } as never;
    const m = { workspace: 1, workspaceName: 'Work', workspaceCount: 3, profile: '', slide: 1, slides: 3, focusMode: false };
    const now = 1_000_000;
    expect(transientsFrom({ ...(base as object), monorail: m } as never, { ...(base as object), monorail: m } as never, now)).toEqual([]);
    const t = transientsFrom({ ...(base as object), monorail: m } as never, { ...(base as object), monorail: { ...m, workspace: 2, workspaceName: 'Writing' } } as never, now);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: 'workspace', title: 'Writing', trailing: '1/3' });
    expect(activitiesFrom({ ...(base as object), monorail: m } as never, now).some((a) => a.kind === 'workspace')).toBe(false);
  });
});
