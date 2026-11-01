// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's tools: which exist, their default order, and the person's own
// order and choice of which to show.

export const ISLAND_TOOLS = [
  { id: 'home', label: 'Home', icon: 'home', feature: 'island' },
  { id: 'ask', label: 'Ask', icon: 'sparkle', feature: 'islandAsk' },
  { id: 'shelf', label: 'Shelf', icon: 'archive', feature: 'island' },
  { id: 'clipboard', label: 'Clipboard', icon: 'clipboard', feature: 'clipboard' },
  { id: 'focus', label: 'Timers', icon: 'timer', feature: 'island' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', feature: 'island' },
  { id: 'cues', label: 'Cues', icon: 'pin', feature: 'cues' },
  { id: 'reminders', label: 'Tasks', icon: 'listCheck', feature: 'islandTodos' },
  { id: 'week', label: 'Week', icon: 'columns', feature: 'islandPlanner' },
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

/** Shown by default; the rest can be added in Settings → Island → Tools. */
export const DEFAULT_ON: IslandToolId[] = ['home', 'ask', 'shelf', 'clipboard', 'focus', 'calendar', 'cues', 'reminders', 'week', 'insights', 'notes', 'weather', 'system', 'usage', 'convert', 'emoji', 'agents', 'controls', 'camera', 'vibes'];

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
