// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's tools: which exist, the deck (up to four pinned at the top of the
// open Island, the rest in More), the person's own order and choice of which to
// offer, and the live slot an activity borrows while it runs. Pure.

export const ISLAND_TOOLS = [
  { id: 'home', label: 'Home', icon: 'home', feature: 'island' },
  { id: 'ask', label: 'Ask', icon: 'sparkle', feature: 'islandAsk' },
  { id: 'shelf', label: 'Shelf', icon: 'archive', feature: 'island' },
  { id: 'clipboard', label: 'Clipboard', icon: 'clipboard', feature: 'clipboard' },
  { id: 'focus', label: 'Timer', icon: 'timer', feature: 'island' },
  // The id stays 'calendar' (settings and shortcuts name it); the deck calls it Week.
  { id: 'calendar', label: 'Week', icon: 'calendar', feature: 'island' },
  { id: 'cues', label: 'Cues', icon: 'pin', feature: 'cues' },
  { id: 'reminders', label: 'Tasks', icon: 'listCheck', feature: 'islandTodos' },
  // The planner's week of tasks (Calendar's events are the Week tool).
  { id: 'week', label: 'Planner', icon: 'columns', feature: 'islandPlanner' },
  { id: 'insights', label: 'Insights', icon: 'chart', feature: 'islandInsights' },
  { id: 'notes', label: 'Notes', icon: 'note', feature: 'islandNotes' },
  { id: 'weather', label: 'Weather', icon: 'sun', feature: 'island' },
  { id: 'system', label: 'System', icon: 'cpu', feature: 'island' },
  { id: 'usage', label: 'AI Usage', icon: 'graph', feature: 'islandUsage' },
  { id: 'sales', label: 'Sales', icon: 'coin', feature: 'islandSales' },
  { id: 'stocks', label: 'Stocks', icon: 'chart', feature: 'islandStocks' },
  { id: 'convert', label: 'Convert', icon: 'ruler', feature: 'island' },
  { id: 'emoji', label: 'Emoji', icon: 'smile', feature: 'island' },
  { id: 'prompter', label: 'Prompter', icon: 'prompter', feature: 'islandPrompter' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'bolt', feature: 'island' },
  { id: 'agents', label: 'Agents', icon: 'terminal', feature: 'island' },
  { id: 'controls', label: 'Controls', icon: 'settings', feature: 'island' },
  { id: 'camera', label: 'Mirror', icon: 'camera', feature: 'island' },
  // Wallpaper, vibes and ambient sound (src/wallpaper/IslandVibes.tsx).
  { id: 'vibes', label: 'Vibes', icon: 'palette', feature: 'vibes' },
] as const;

export type IslandToolId = (typeof ISLAND_TOOLS)[number]['id'];

/**
 * Offered in More by default (pinned tools are always offered). Tools whose feature is off are left out
 * wherever this is used. Before the deck these were all tabs; four of them now sit in More.
 */
export const DEFAULT_ON: IslandToolId[] = ISLAND_TOOLS.map((t) => t.id);

/** At most this many tools are pinned to the deck; everything else is in More. A cap, not a number to fill. */
export const DECK_MAX = 4;

/** The deck a new person starts with: Home, Shelf, Week (the calendar) and Timer. */
export const DEFAULT_DECK: IslandToolId[] = ['home', 'shelf', 'calendar', 'focus'];

const KNOWN = new Set<string>(ISLAND_TOOLS.map((t) => t.id));
export const isIslandTool = (id: unknown): id is IslandToolId => typeof id === 'string' && KNOWN.has(id);

/** A deck read from settings: known tools, each once, at most DECK_MAX. */
export function cleanDeck(v: unknown): IslandToolId[] {
  if (!Array.isArray(v)) return [];
  const out: IslandToolId[] = [];
  for (const id of v) if (isIslandTool(id) && !out.includes(id) && out.length < DECK_MAX) out.push(id);
  return out;
}

/**
 * The deck for settings from before it (or a damaged one). Someone who never changed the tabs gets the new
 * default deck. Someone who ordered their tabs keeps their first choices: the first four tools they show,
 * in their order. Someone who only hid tabs gets the default deck less what they hid, topped up from the
 * tools they kept, in their order.
 */
export function migrateDeck(order: string[] | undefined, off: string[] | undefined): IslandToolId[] {
  const shown = orderedTools(order, off);
  if (order?.some(isIslandTool)) return shown.slice(0, DECK_MAX);
  if (!off) return [...DEFAULT_DECK];
  const deck = DEFAULT_DECK.filter((id) => shown.includes(id));
  for (const id of shown) if (deck.length < DECK_MAX && !deck.includes(id)) deck.push(id);
  return deck;
}

/** The pinned tools that can show here (in deck order), never more than DECK_MAX. */
export function deckTools(deck: string[] | undefined, available?: (id: IslandToolId) => boolean): IslandToolId[] {
  return cleanDeck(deck).filter((id) => !available || available(id));
}

/**
 * Pins a tool. With a free place it goes at the end (or at `at`); with the deck full it takes the place of
 * `replace`, and without one nothing changes: the deck never grows past DECK_MAX on its own.
 */
export function pinTool(deck: string[] | undefined, id: string, o: { at?: number; replace?: string } = {}): IslandToolId[] {
  const cur = cleanDeck(deck);
  if (!isIslandTool(id)) return cur;
  if (cur.includes(id)) return o.at === undefined ? cur : moveInDeck(cur, id, o.at);
  if (o.replace !== undefined) {
    const i = cur.indexOf(o.replace as IslandToolId);
    if (i < 0) return cur;
    const next = [...cur];
    next[i] = id;
    return next;
  }
  if (cur.length >= DECK_MAX) return cur;
  const next = [...cur];
  next.splice(o.at === undefined ? next.length : Math.max(0, Math.min(next.length, o.at)), 0, id);
  return next;
}

export function unpinTool(deck: string[] | undefined, id: string): IslandToolId[] {
  return cleanDeck(deck).filter((x) => x !== id);
}

/** Moves a pinned tool to another place in the deck (left, right, or dragged). */
export function moveInDeck(deck: string[] | undefined, id: string, to: number): IslandToolId[] {
  const cur = cleanDeck(deck);
  const from = cur.indexOf(id as IslandToolId);
  if (from < 0) return cur;
  cur.splice(from, 1);
  cur.splice(Math.max(0, Math.min(cur.length, to)), 0, id as IslandToolId);
  return cur;
}

/** The tools More offers: every tool shown (not turned off) and available, recent ones first, then by name. */
export function moreTools(off: string[] | undefined, recent: string[] = [], available?: (id: IslandToolId) => boolean, label: (id: IslandToolId) => string = (id) => ISLAND_TOOLS.find((t) => t.id === id)!.label): { recent: IslandToolId[]; rest: IslandToolId[] } {
  const shown = orderedTools(undefined, off, available);
  const r = recent.filter((id): id is IslandToolId => shown.includes(id as IslandToolId)).filter((id, i, a) => a.indexOf(id) === i).slice(0, 6);
  const rest = shown.filter((id) => !r.includes(id)).sort((a, b) => label(a).localeCompare(label(b)));
  return { recent: r, rest };
}

/** A tool just opened goes to the front of the recent list (kept short). */
export function addRecentTool(recent: string[] | undefined, id: string, max = 6): string[] {
  return [id, ...(recent ?? []).filter((x) => x !== id)].slice(0, max);
}

/** What a live activity's slot opens: one of the tools, or (for things without a tool, like a recording) its card. */
export type LiveSlot = { kind: 'tool'; tool: IslandToolId; activity: string; icon: string; color?: string; title: string } | { kind: 'card'; activity: string; icon: string; color?: string; title: string };

/** Activity kinds and the tool that shows them in full. Kinds mapped to null open their own card instead. */
const LIVE_TOOL: Partial<Record<string, IslandToolId | null>> = {
  music: 'home',
  'agent-waiting': 'agents',
  'agent-stuck': 'agents',
  'agent-working': 'agents',
  timer: 'focus',
  copied: 'clipboard',
  recording: null,
};

/** The tool that shows an activity in full (music → Home, a timer → Timer, an agent → Agents), or null. */
export function toolForActivity(kind: string): IslandToolId | null {
  return LIVE_TOOL[kind] ?? null;
}

/**
 * The deck's live slot: the most important activity going on whose view is not pinned borrows a place
 * before More (music while Home is not pinned, an agent at work, a timer, a recording). None when every
 * such activity's view is already pinned. Leaves when the activity ends.
 */
export function liveSlot(acts: readonly { id: string; kind: string; priority: number; icon: string; color?: string; title: string }[], deck: readonly string[], available?: (id: IslandToolId) => boolean): LiveSlot | null {
  let best: LiveSlot | null = null;
  let bestP = -Infinity;
  for (const a of acts) {
    if (!(a.kind in LIVE_TOOL) || a.priority <= bestP) continue;
    const tool = LIVE_TOOL[a.kind];
    if (tool) {
      if (deck.includes(tool) || (available && !available(tool))) continue;
      best = { kind: 'tool', tool, activity: a.id, icon: a.icon, color: a.color, title: a.title };
    } else best = { kind: 'card', activity: a.id, icon: a.icon, color: a.color, title: a.title };
    bestP = a.priority;
  }
  return best;
}

/**
 * The tools to show, in the person's order: tools they ordered first, then any
 * new tools (in their default place), minus the ones turned off. Unknown ids are dropped.
 */
export function orderedTools(order: string[] | undefined, off: string[] | undefined, available?: (id: IslandToolId) => boolean): IslandToolId[] {
  const known = new Set<string>(ISLAND_TOOLS.map((t) => t.id));
  const hidden = new Set(off ?? ISLAND_TOOLS.filter((t) => !DEFAULT_ON.includes(t.id)).map((t) => t.id));
  const seen = new Set<string>();
  const out: IslandToolId[] = [];
  for (const id of [...(order ?? []), ...ISLAND_TOOLS.map((t) => t.id)]) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    if (hidden.has(id) || (available && !available(id as IslandToolId))) continue;
    out.push(id as IslandToolId);
  }
  return out;
}

/** Moves a tool one place left or right (or to an index) in the full order. */
export function moveTool(order: string[] | undefined, id: string, to: number): string[] {
  const full = orderedTools(order, []);
  const from = full.indexOf(id as IslandToolId);
  if (from < 0) return full;
  const next = [...full];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, id as IslandToolId);
  return next;
}

export function toggleTool(off: string[] | undefined, id: string, on: boolean): string[] {
  const base = off ?? ISLAND_TOOLS.filter((t) => !DEFAULT_ON.includes(t.id)).map((t) => t.id);
  return on ? base.filter((x) => x !== id) : [...new Set([...base, id])];
}
