// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The owl's glance: readings become cards, settings stay sane.
import { describe, expect, it } from 'vitest';
import { defaultGlanceSettings, GLANCE_CARDS, glanceCards, glanceTooltip, normalizeGlanceSettings, TIPS, type GlanceInputs } from '../core/glance';

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
  it('hover is on by default only on macOS; eight quick actions', () => {
    expect(defaultGlanceSettings('darwin').hover).toBe(true);
    expect(defaultGlanceSettings('win32').hover).toBe(false);
    expect(defaultGlanceSettings('linux').actions).toEqual(['quickSearch', 'screenshot', 'captureText', 'keepAwake', 'dictation', 'stage', 'cleanup', 'terminal']);
  });
  it('drops unknown cards and actions and duplicates', () => {
    const s = normalizeGlanceSettings({ cards: ['weather', 'bogus' as never, 'weather', 'tip'], actions: ['terminal', 'nope' as never], hover: 'yes' as never }, 'darwin');
    expect(s).toEqual({ cards: ['weather', 'tip'], actions: ['terminal'], hover: true });
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
