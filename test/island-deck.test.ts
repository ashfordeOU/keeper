// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The open Island's deck: the cap of four, pinning and unpinning, settings from before it, More and the live slot.
import { describe, expect, it } from 'vitest';
import { DECK_MAX, DEFAULT_DECK, ISLAND_TOOLS, addRecentTool, cleanDeck, deckTools, liveSlot, migrateDeck, moreTools, moveInDeck, pinTool, unpinTool } from '../core/island-tools/tools';
import { defaultSettings, mergeSettings } from '../core/settings';

const act = (kind: string, priority: number, id = kind) => ({ id, kind, priority, icon: 'x', title: kind, color: '#fff' });

describe('deck', () => {
  it('starts as Home, Shelf, Week and Timer, and the calendar is called Week', () => {
    expect(DEFAULT_DECK).toEqual(['home', 'shelf', 'calendar', 'focus']);
    expect(ISLAND_TOOLS.find((t) => t.id === 'calendar')?.label).toBe('Week');
    expect(ISLAND_TOOLS.find((t) => t.id === 'focus')?.label).toBe('Timer');
    // The planner's week of tasks has its own name, so two tools are never both "Week".
    expect(ISLAND_TOOLS.filter((t) => t.label === 'Week')).toHaveLength(1);
  });

  it('never holds more than four, unknown or twice', () => {
    expect(cleanDeck(['home', 'home', 'nope', 'shelf', 'notes', 'ask', 'agents', 'focus'])).toEqual(['home', 'shelf', 'notes', 'ask']);
    expect(cleanDeck('home')).toEqual([]);
    expect(pinTool(['home', 'shelf', 'calendar', 'focus'], 'notes')).toEqual(['home', 'shelf', 'calendar', 'focus']);
    expect(pinTool(['home', 'shelf', 'calendar', 'focus'], 'notes').length).toBe(DECK_MAX);
  });

  it('pins at the end, at a place, or in place of another; unpins; moves', () => {
    expect(pinTool(['home'], 'notes')).toEqual(['home', 'notes']);
    expect(pinTool(['home', 'shelf'], 'notes', { at: 0 })).toEqual(['notes', 'home', 'shelf']);
    expect(pinTool(['home', 'shelf', 'calendar', 'focus'], 'notes', { replace: 'shelf' })).toEqual(['home', 'notes', 'calendar', 'focus']);
    expect(pinTool(['home', 'shelf', 'calendar', 'focus'], 'notes', { replace: 'agents' })).toEqual(['home', 'shelf', 'calendar', 'focus']);
    expect(pinTool(['home', 'shelf'], 'shelf', { at: 0 })).toEqual(['shelf', 'home']);
    expect(pinTool(['home'], 'bogus')).toEqual(['home']);
    expect(unpinTool(['home', 'shelf'], 'home')).toEqual(['shelf']);
    expect(moveInDeck(['home', 'shelf', 'calendar'], 'calendar', 0)).toEqual(['calendar', 'home', 'shelf']);
    expect(moveInDeck(['home', 'shelf'], 'home', 9)).toEqual(['shelf', 'home']);
    expect(moveInDeck(['home', 'shelf'], 'home', -1)).toEqual(['home', 'shelf']);
  });

  it('leaves out pinned tools that cannot show here', () => {
    expect(deckTools(['home', 'clipboard', 'focus'], (id) => id !== 'clipboard')).toEqual(['home', 'focus']);
    expect(deckTools(undefined)).toEqual([]);
  });
});

describe('deck migration', () => {
  it('gives someone who never changed the tabs the new deck', () => {
    expect(migrateDeck(undefined, undefined)).toEqual(DEFAULT_DECK);
  });
  it('keeps the first choices of someone who ordered their tabs', () => {
    expect(migrateDeck(['notes', 'agents', 'home'], undefined)).toEqual(['notes', 'agents', 'home', 'ask']);
    expect(migrateDeck(['notes', 'agents', 'home', 'clipboard', 'ask'], ['agents'])).toEqual(['notes', 'home', 'clipboard', 'ask']);
  });
  it('takes out what someone hid and tops up from what they kept', () => {
    expect(migrateDeck(undefined, ['shelf'])).toEqual(['home', 'calendar', 'focus', 'ask']);
    expect(migrateDeck([], [])).toEqual(DEFAULT_DECK);
  });
  it('runs once when settings from before the deck are read, and a saved deck is kept', () => {
    const base = defaultSettings([], []);
    const old = mergeSettings(base, { island: { ...base.island, deck: undefined, toolOrder: ['clipboard', 'notes', 'home', 'shelf', 'focus'] } });
    expect(old.island.deck).toEqual(['clipboard', 'notes', 'home', 'shelf']);
    const fresh = mergeSettings(base, { island: { ...base.island, deck: undefined } });
    expect(fresh.island.deck).toEqual(DEFAULT_DECK);
    const saved = mergeSettings(base, { island: { ...base.island, deck: ['agents'], toolOrder: ['clipboard'] } });
    expect(saved.island.deck).toEqual(['agents']);
    const bad = mergeSettings(base, { island: { ...base.island, deck: ['agents', 'agents', 'x', 'home', 'shelf', 'focus', 'notes'] } });
    expect(bad.island.deck).toEqual(['agents', 'home', 'shelf', 'focus']);
  });
});

describe('More', () => {
  it('offers the shown tools, recent ones first and the rest by name', () => {
    const m = moreTools(['sales'], ['notes', 'sales', 'notes', 'emoji'], (id) => id !== 'stocks');
    expect(m.recent).toEqual(['notes', 'emoji']);
    expect(m.rest).not.toContain('sales');
    expect(m.rest).not.toContain('stocks');
    expect(m.rest).not.toContain('notes');
    const labels = m.rest.map((id) => ISLAND_TOOLS.find((t) => t.id === id)!.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });
  it('keeps a short recent list, newest first', () => {
    expect(addRecentTool(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(addRecentTool(['a', 'b', 'c', 'd', 'e', 'f'], 'g')).toEqual(['g', 'a', 'b', 'c', 'd', 'e']);
  });
});

describe('live slot', () => {
  it('lends a place to the most important live activity whose view is not pinned', () => {
    const acts = [act('music', 60), act('agent-working', 64, 'agent-1'), act('timer', 72)];
    expect(liveSlot(acts, ['home', 'shelf', 'calendar'])).toMatchObject({ kind: 'tool', tool: 'focus', activity: 'timer' });
    expect(liveSlot(acts, DEFAULT_DECK)).toMatchObject({ kind: 'tool', tool: 'agents', activity: 'agent-1' });
    expect(liveSlot([act('music', 60)], ['shelf'])).toMatchObject({ kind: 'tool', tool: 'home' });
  });
  it('none when every live view is pinned, or nothing is live', () => {
    expect(liveSlot([act('music', 60), act('timer', 72)], DEFAULT_DECK)).toBeNull();
    expect(liveSlot([], DEFAULT_DECK)).toBeNull();
    expect(liveSlot([act('rain', 10), act('paused-music', 20)], [])).toBeNull();
  });
  it('a recording has no tool: its slot opens the recording’s card, and it outranks the rest', () => {
    expect(liveSlot([act('recording', 95), act('timer', 72)], [])).toMatchObject({ kind: 'card', activity: 'recording' });
  });
  it('skips a tool that cannot show here', () => {
    expect(liveSlot([act('agent-waiting', 88)], DEFAULT_DECK, (id) => id !== 'agents')).toBeNull();
  });
});
