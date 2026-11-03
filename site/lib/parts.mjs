// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Build your Keeper" on the home page: the parts you can switch on, what each one
// downloads the first time it is switched on, and what runs while it is on.
// Sizes are approximate, from docs/COMPONENTS.md (the core installer and the three
// downloadable pieces, measured on a Linux x64 build; a Mac's are a little smaller).
// Pure: used by site.js in the browser and by test/site.test.ts.

/** The core installer, approximately (MB). */
export const CORE_MB = 185;

/** Pieces downloaded once, when the first part that needs them is switched on. */
export const PIECES = {
  video: { name: 'Video tools', mb: 30 },
  ai: { name: 'On-device AI', mb: 19 },
  cloud: { name: 'Cloud connections', mb: 31 },
};

/** The parts, in the order of the grid. `runs` is what keeps running while it is on. */
export const PARTS = [
  { id: 'files', name: 'Files', on: true, shot: 'home', runs: 'Watches your folders for new files', needs: [] },
  { id: 'island', name: 'Island', on: true, shot: 'island-expanded', runs: 'A small bar at the top of the screen', needs: [] },
  { id: 'tidy', name: 'Tidy', on: true, shot: 'space', runs: 'Nothing until you scan', needs: [] },
  { id: 'privacy', name: 'Privacy & Security', on: true, shot: 'privacy', runs: 'Checks new downloads', needs: [] },
  { id: 'awake', name: 'Keep Awake', on: true, shot: 'awake', runs: 'Only during a session', needs: [] },
  { id: 'mail', name: 'Mail & Calendar', on: false, shot: 'island-expanded', runs: 'Checks your mail', needs: [] },
  { id: 'notes', name: 'Notes', on: false, shot: 'notes', runs: 'Nothing in the background', needs: [] },
  { id: 'studio', name: 'Studio', on: false, shot: 'stage', runs: 'Only while you record', needs: ['video'] },
  { id: 'ai', name: 'AI', on: false, shot: 'dictation', runs: 'Only when you ask', needs: ['ai', 'video'] },
  { id: 'sync', name: 'Sync & Backup', on: false, shot: 'devices', runs: 'Syncs on a schedule', needs: ['cloud'] },
  { id: 'devices', name: 'Devices', on: false, shot: 'devices', runs: 'Waits for your other devices', needs: [] },
  { id: 'desktop', name: 'Desktop', on: false, shot: 'ambience', runs: 'Widgets and wallpaper on screen', needs: [] },
];

/** The ids switched on by default. */
export const defaultOn = () => PARTS.filter((p) => p.on).map((p) => p.id);

/** Flip one part in a list of ids that are on; returns a new list in grid order. */
export function toggle(on, id) {
  const set = new Set(on);
  if (set.has(id)) set.delete(id); else set.add(id);
  return PARTS.filter((p) => set.has(p.id)).map((p) => p.id);
}

/**
 * What a choice of parts costs: the core, each piece downloaded later (counted once even
 * when several parts need it), the total, and what keeps running.
 */
export function estimate(on) {
  const chosen = PARTS.filter((p) => on.includes(p.id));
  const keys = [...new Set(chosen.flatMap((p) => p.needs))].sort();
  const pieces = keys.map((k) => ({ id: k, ...PIECES[k] }));
  const extra = pieces.reduce((n, p) => n + p.mb, 0);
  return {
    core: CORE_MB,
    pieces,
    extra,
    total: CORE_MB + extra,
    count: chosen.length,
    runs: chosen.map((p) => ({ id: p.id, name: p.name, runs: p.runs })),
  };
}
