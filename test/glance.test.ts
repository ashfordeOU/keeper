// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The owl's glance: readings become cards, settings stay sane.
import { describe, expect, it } from 'vitest';
import { awakeRow, defaultGlanceSettings, GLANCE_ACTIONS, GLANCE_CARDS, glanceCards, glanceLayout, glanceStatus, glanceTiles, glanceTooltip, middleTruncate, moreActions, normalizeGlanceSettings, shortBytes, shortRates, shortTemp, TIPS, type GlanceInputs } from '../core/glance';

const NOW = Date.parse('2026-11-01T10:00:00Z');
const full: GlanceInputs = {
  now: NOW,
  weather: { place: 'Tallinn', temp: 6.6, units: 'c', summary: 'Overcast', nowcast: 'Rain starting in about 20 minutes' },
  disk: { total: 1000 * 1024 ** 3, free: 40 * 1024 ** 3, name: 'Main disk' },
  system: { cpu: 12.4, memUsed: 30 * 1024 ** 3, memTotal: 36 * 1024 ** 3, battery: { percent: 41, charging: false, minutesLeft: 95 } },
  network: { downBps: 3 * 1024 ** 2, upBps: 2048, wifi: 'Studio', online: true },
  awake: { on: true, until: NOW + 42 * 60_000, reason: 'Rendering' },
  usage: [{ label: 'Assistant · Weekly', percent: 64 }, { label: 'Assistant · 5-hour', percent: 93, resetsAt: NOW + 3600_000 }],
  next: { title: 'Design review', start: NOW + 25 * 60_000, link: 'https://meet.example.com/abc' },
  tipIndex: 2,
};

describe('glance cards', () => {
  it('maps each reading to a card that opens the right place', () => {
    const cards = glanceCards(full, [...GLANCE_CARDS]);
    expect(cards.map((c) => c.id)).toEqual([...GLANCE_CARDS]);
    const by = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(by.weather).toMatchObject({ value: '7°C', detail: 'Rain starting in about 20 minutes', open: 'weather' });
    expect(by.storage).toMatchObject({ value: '40.0 GB free', detail: 'of 1000 GB', bar: 96, tone: 'bad', open: 'space' });
    expect(by.system.value).toBe('CPU 12%');
    expect(by.system.detail).toBe('memory 83% · battery 41%, 1 h 35 min left');
    expect(by.network).toMatchObject({ value: '↓ 3.0 MB/s ↑ 2 KB/s', detail: 'Studio', open: 'netactivity' });
    expect(by.awake).toMatchObject({ value: '42 min left', detail: 'Rendering', open: 'action:keepAwake' });
    expect(by.usage).toMatchObject({ value: '93% used', bar: 93, tone: 'bad' });
    expect(by.calendar).toMatchObject({ value: 'Design review', detail: 'In 25 min', open: 'link:https://meet.example.com/abc' });
    expect(by.tip.value).toBe(TIPS[2]);
  });
  it('leaves out what it cannot say, and follows the chosen order', () => {
    const cards = glanceCards({ now: NOW, awake: { on: false } }, ['tip', 'awake', 'weather', 'storage']);
    expect(cards.map((c) => c.id)).toEqual(['tip', 'awake']);
    expect(cards[1]).toMatchObject({ value: 'Off' });
    expect(glanceCards({ ...full, next: { title: 'Old', start: NOW - 3600_000 } }, ['calendar'])).toEqual([]);
    expect(glanceCards({ now: NOW, network: { online: false } }, ['network'])[0]).toMatchObject({ value: 'No connection', detail: 'Offline', tone: 'bad' });
  });
  it('a tooltip for trays without hover', () => {
    const t = glanceTooltip(glanceCards(full, ['storage', 'awake', 'tip']));
    expect(t.split('\n')).toEqual(['Keeper', 'Main disk: 40.0 GB free (of 1000 GB)', 'Keep Awake: 42 min left (Rendering)']);
  });
});

describe('glance settings', () => {
  it('hover is on by default only on macOS; four quick actions; every part shows; no tip', () => {
    expect(defaultGlanceSettings('darwin').hover).toBe(true);
    expect(defaultGlanceSettings('win32').hover).toBe(false);
    expect(defaultGlanceSettings('linux').actions).toEqual(['quickSearch', 'screenshot', 'captureText', 'clipboard']);
    expect(defaultGlanceSettings('linux').sections).toEqual({ stats: true, actions: true, downloads: true });
    expect(defaultGlanceSettings('linux').cards).not.toContain('tip');
  });
  it('drops unknown cards and actions and duplicates', () => {
    const s = normalizeGlanceSettings({ cards: ['weather', 'bogus' as never, 'weather', 'tip'], actions: ['terminal', 'nope' as never], hover: 'yes' as never }, 'darwin');
    expect(s).toEqual({ cards: ['weather', 'tip'], actions: ['terminal'], sections: { stats: true, actions: true, downloads: true }, hover: true });
  });
  it('keeps the first four of an older, longer list of buttons; the rest go under More', () => {
    const s = normalizeGlanceSettings({ actions: ['quickSearch', 'screenshot', 'captureText', 'keepAwake', 'dictation', 'stage', 'cleanup', 'terminal'] }, 'linux');
    expect(s.actions).toEqual(['quickSearch', 'screenshot', 'captureText', 'keepAwake']);
    const more = moreActions(s);
    expect(more).toContain('terminal');
    expect(more.some((a) => s.actions.includes(a))).toBe(false);
    expect([...s.actions, ...more].sort()).toEqual([...GLANCE_ACTIONS].sort());
  });
  it('Keep Awake is left out of More while its switch shows', () => {
    const s = normalizeGlanceSettings({ actions: ['terminal'] }, 'linux');
    expect(moreActions(s)).not.toContain('keepAwake');
    expect(moreActions({ ...s, cards: ['storage'] })).toContain('keepAwake');
  });
  it('parts can be switched off; a part that is off is left out of the view', () => {
    const s = normalizeGlanceSettings({ sections: { stats: false, downloads: false } as never }, 'linux');
    expect(s.sections).toEqual({ stats: false, actions: true, downloads: false });
    const v = glanceLayout(full, s, { list: [{ name: 'a.pdf', path: '/a.pdf', size: 1 }], total: 1 });
    expect(v.tiles).toEqual([]);
    expect(v.recent).toEqual([]);
    expect(v.actions).toEqual(s.actions);
    expect(v.awake).toBeDefined();
  });
});

describe('AI usage from the tracker', () => {
  it('the tracker\'s card wins over the coding tools\' files and opens the Usage page', () => {
    const [card] = glanceCards({ ...full, aiUsage: { value: 'CX 3%  +2', detail: 'Codex Plus Weekly, resets in 22h', usedPercent: 97, tone: 'bad' } }, ['usage']);
    expect(card).toMatchObject({ id: 'usage', title: 'AI usage', value: 'CX 3%  +2', bar: 97, tone: 'bad', open: 'aiusage' });
  });
  it('someone who had switched the old menu-bar item off does not get the card', async () => {
    const { defaultSettings, mergeSettings } = await import('../core/settings');
    const off = mergeSettings(defaultSettings([], []), { features: { usageMenuBar: false, notes: true } });
    expect(off.features).toEqual({ notes: true });
    expect(off.glance?.cards).not.toContain('usage');
    expect(off.glance?.cards).toContain('weather');
    const on = mergeSettings(defaultSettings([], []), { features: { usageMenuBar: true }, glance: { cards: ['usage', 'tip'] } });
    expect(on.features).toEqual({});
    expect(on.glance?.cards).toEqual(['usage', 'tip']);
  });
});

describe('short formats that fit a tile', () => {
  it('bytes: whole numbers from 10, one decimal below', () => {
    expect(shortBytes(95.7 * 1024 ** 3)).toBe('96 GB');
    expect(shortBytes(926 * 1024 ** 3)).toBe('926 GB');
    expect(shortBytes(5.24 * 1024 ** 3)).toBe('5.2 GB');
    expect(shortBytes(2 * 1024 ** 3)).toBe('2 GB');
    expect(shortBytes(512 * 1024 ** 2)).toBe('512 MB');
    expect(shortBytes(1.43 * 1024 ** 4)).toBe('1.4 TB');
    expect(shortBytes(3000)).toBe('2.9 KB');
    expect(shortBytes(200)).toBe('1 KB');
    expect(shortBytes(0)).toBe('0 KB');
  });
  it('rates: both directions in the larger one\'s unit', () => {
    expect(shortRates(34 * 1024, 2 * 1024)).toBe('↓34 ↑2 KB/s');
    expect(shortRates(3.1 * 1024 ** 2, 200 * 1024)).toBe('↓3.1 ↑0.2 MB/s');
    expect(shortRates(25 * 1024 ** 2, 0)).toBe('↓25 ↑0 MB/s');
    expect(shortRates(300, 40)).toBe('↓300 ↑40 B/s');
    expect(shortRates(0, 0)).toBe('↓0 ↑0 B/s');
  });
  it('temperature', () => {
    expect(shortTemp(6.6, 'c')).toBe('7°C');
    expect(shortTemp(44.2, 'f')).toBe('44°F');
  });
  it('file names are cut in the middle and keep their type', () => {
    expect(middleTruncate('Quarterly report.pdf', 30)).toBe('Quarterly report.pdf');
    const cut = middleTruncate('holiday-photos-lisbon-summer-2026-original-resolution-export.zip', 30);
    expect([...cut].length).toBeLessThanOrEqual(30);
    expect(cut.startsWith('holiday-photos')).toBe(true);
    expect(cut.endsWith('export.zip')).toBe(true);
    expect(cut).toContain('…');
    const noExt = middleTruncate('a'.repeat(50), 20);
    expect([...noExt].length).toBe(20);
  });
});

describe('tiles, the Keep Awake row and the status line', () => {
  it('four tiles with short values and one bar where there is an amount', () => {
    const tiles = glanceTiles({ ...full, disk: { total: 926 * 1024 ** 3, free: 95.7 * 1024 ** 3, name: 'Main disk' }, network: { downBps: 34 * 1024, upBps: 2 * 1024, online: true } }, [...GLANCE_CARDS]);
    expect(tiles.map((t) => t.id)).toEqual(['weather', 'storage', 'system', 'network']);
    const by = Object.fromEntries(tiles.map((t) => [t.id, t]));
    expect(by.weather).toMatchObject({ label: 'Tallinn', value: '7°C', sub: 'Overcast' });
    expect(by.weather.bar).toBeUndefined();
    expect(by.storage).toMatchObject({ value: '96 GB free', sub: 'of 926 GB', bar: 90, tone: 'warn' });
    expect(by.system).toMatchObject({ value: 'CPU 12%', sub: 'Memory 83%', bar: 83 });
    expect(by.network).toMatchObject({ value: '↓34 ↑2 KB/s', sub: 'Online' });
    for (const t of tiles) expect(t.value.length).toBeLessThanOrEqual(14);
  });
  it('tiles follow the chosen ones; the Keep Awake row says how it stands', () => {
    expect(glanceTiles(full, ['network', 'weather']).map((t) => t.id)).toEqual(['weather', 'network']);
    expect(awakeRow({ now: NOW, awake: { on: false } })).toEqual({ on: false, text: 'Off, the computer can sleep' });
    expect(awakeRow(full)).toEqual({ on: true, text: '42 min left · Rendering' });
    expect(awakeRow({ now: NOW, awake: { on: true } })).toEqual({ on: true, text: 'On until you turn it off' });
    expect(awakeRow({ now: NOW })).toBeUndefined();
  });
  it('the status line: all good, or the one thing that most needs attention', () => {
    expect(glanceStatus({ now: NOW, disk: { total: 100, free: 50, name: 'Main disk' }, network: { online: true } })).toEqual({ tone: 'ok', text: 'All good' });
    expect(glanceStatus({ now: NOW, disk: { total: 100, free: 10, name: 'Main disk' } })).toMatchObject({ tone: 'warn', text: 'Main disk is getting full', open: 'space' });
    expect(glanceStatus({ now: NOW, disk: { total: 100, free: 10, name: 'Main disk' }, network: { online: false } })).toMatchObject({ tone: 'bad', text: 'No internet connection' });
    expect(glanceStatus({ now: NOW, system: { cpu: 95, memUsed: 1, memTotal: 10 } })).toMatchObject({ tone: 'warn', text: 'The computer is busy' });
    expect(glanceStatus({ now: NOW, system: { cpu: 5, memUsed: 1, memTotal: 10, battery: { percent: 8, charging: false } } })).toMatchObject({ tone: 'bad', text: 'Battery is low (8%)' });
    expect(glanceStatus({ now: NOW, system: { cpu: 5, memUsed: 1, memTotal: 10, battery: { percent: 8, charging: true } } }).text).toBe('All good');
    expect(glanceStatus(full)).toMatchObject({ tone: 'bad', text: 'Main disk is almost full' });
  });
  it('the view puts usage, the next event and the tip in rows', () => {
    const s = normalizeGlanceSettings({ cards: [...GLANCE_CARDS] }, 'linux');
    const v = glanceLayout(full, s, { list: [], total: 5 });
    expect(v.rows.map((r) => r.id)).toEqual(['usage', 'calendar', 'tip']);
    expect(v.tiles).toHaveLength(4);
    expect(v.moreRecent).toBe(5);
    expect(v.cards.map((c) => c.id)).toEqual([...GLANCE_CARDS]);
  });
});
