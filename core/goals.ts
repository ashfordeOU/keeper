// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Setup that starts from what the person wants: "What do you want Keeper for?"
// with eight picture cards; up to three picked. Their parts are added to the
// essentials Recommended picks for this computer. Afterwards, "Getting to know
// Keeper" shows one short tip a day on Home for a week: each can be put away,
// and the whole series switched off with one click.

import { FEATURES, featureOffered } from './features';

export type GoalId = 'files' | 'clean' | 'mail' | 'notes' | 'record' | 'focus' | 'private' | 'family';

export interface Goal {
  id: GoalId;
  title: string;
  line: string;
  icon: string;
  /** the parts it turns on (with what they need) */
  parts: string[];
}

export const GOALS: Goal[] = [
  { id: 'files', title: 'Find my files', line: 'Search by name, kind or what is inside.', icon: 'search', parts: ['library', 'sources', 'docText', 'ocr', 'places', 'quickSearch', 'launcher'] },
  { id: 'clean', title: 'Clean my computer', line: 'Free up space and keep it quick.', icon: 'broom', parts: ['cleanup', 'duplicates', 'space', 'history', 'guide', 'startupItems', 'health'] },
  { id: 'mail', title: 'Mail & calendar', line: 'Every account, one calm inbox.', icon: 'mail', parts: ['mail', 'calendars', 'alarms', 'planner', 'calendar'] },
  { id: 'notes', title: 'Notes', line: 'Write, link and keep a journal.', icon: 'document', parts: ['notes', 'journal', 'reader'] },
  { id: 'record', title: 'Record my screen', line: 'Screenshots, videos and presenting.', icon: 'video', parts: ['capture', 'studio', 'stage', 'drawOnScreen', 'photoEditor'] },
  { id: 'focus', title: 'Stay focused', line: 'Plan the day and block distractions.', icon: 'timer', parts: ['island', 'focus', 'focusBlock', 'timeTracking', 'planner'] },
  { id: 'private', title: 'Keep it private', line: 'See who can watch, and lock things up.', icon: 'shield', parts: ['protection', 'security', 'firewall', 'netwatch', 'lock'] },
  { id: 'family', title: 'Help a family member', line: 'See their screen when they ask.', icon: 'link', parts: ['link', 'remoteScreen', 'remoteHelp'] },
];

export const MAX_GOALS = 3;

/** Picks or unpicks a goal; a fourth pick is ignored (at most three). */
export function toggleGoal(list: GoalId[], id: GoalId): GoalId[] {
  if (list.includes(id)) return list.filter((g) => g !== id);
  return list.length >= MAX_GOALS ? list : [...list, id];
}

export function cleanGoals(v: unknown): GoalId[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((g): g is GoalId => GOALS.some((x) => x.id === g)))].slice(0, MAX_GOALS);
}

/** The parts to turn on: what Recommended picks here, plus each goal's parts this system can run. */
export function goalParts(recommended: string[], goals: GoalId[], platform: string): string[] {
  const out = new Set(recommended);
  for (const g of goals) {
    for (const id of GOALS.find((x) => x.id === g)?.parts ?? []) {
      const f = FEATURES.find((x) => x.id === id);
      if (f && featureOffered(f, platform)) out.add(id);
    }
  }
  return [...out];
}

/** "Picked for Find my files and Stay focused". */
export function goalsLine(goals: GoalId[]): string {
  const t = goals.map((g) => GOALS.find((x) => x.id === g)!.title);
  return t.length ? `Picked for ${t.length === 1 ? t[0] : `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`}` : 'The essentials, picked for this computer';
}

// ---------------------------------------------------------------- Getting to know Keeper

export interface Tip {
  id: string;
  title: string;
  text: string;
  /** a page to try it on */
  route?: string;
  action?: string;
  /** only for these goals (none: for everyone) */
  goals?: GoalId[];
}

/** One a day for a week, in this order (tips for goals not picked are skipped, and the rest fill in). */
export const TIPS: Tip[] = [
  { id: 'search', title: 'Search from anywhere', text: 'Press the Quick Search shortcut in any app and type what you remember.', action: 'Try it' },
  { id: 'help', title: 'Every page has a ?', text: 'It says what the page is for, with its guide. F1 works too.', action: 'Show me' },
  { id: 'fixit', title: 'One calm list', text: 'The Fix-it List gathers what is worth doing. Nothing else nags.', route: 'todo', action: 'Open it' },
  { id: 'focus', title: 'Hold notices while you focus', text: 'Start a focus timer and notices wait until you are done.', route: 'settings:general', action: 'See how', goals: ['focus'] },
  { id: 'clean', title: 'Free up space safely', text: 'Clean Up shows each item before it goes, and Undo brings it back.', route: 'cleanup', action: 'Open Clean Up', goals: ['clean', 'files'] },
  { id: 'mail', title: 'Snooze a mail', text: 'Put a mail away until the time you choose; it comes back on top.', route: 'mail', action: 'Open Mail', goals: ['mail'] },
  { id: 'notes', title: 'Link your notes', text: 'Type [[ in a note to link another one.', route: 'notes', action: 'Open Notes', goals: ['notes'] },
  { id: 'record', title: 'Copy text from the screen', text: 'Drag over any text on screen to copy it, even in a picture.', route: 'capture', action: 'Open Capture', goals: ['record'] },
  { id: 'private', title: 'Who can watch', text: 'Privacy & Security lists apps that can use the camera, microphone or screen.', route: 'security', action: 'Have a look', goals: ['private'] },
  { id: 'undo', title: 'Undo almost anything', text: 'Undo History lists every move, rename and removal, with Undo.', route: 'history', action: 'Open it' },
  { id: 'quiet', title: 'Quiet hours', text: 'Choose hours when notices wait, in Settings → General.', route: 'settings:general', action: 'Set them' },
];

export const TIP_DAYS = 7;

export interface TipsState {
  on: boolean;
  /** when the series started (setup finished); 0 = not started */
  start: number;
  /** tips put away */
  done: string[];
}

export const defaultTips = (): TipsState => ({ on: true, start: 0, done: [] });

export function normalizeTips(v: unknown): TipsState {
  const d = defaultTips();
  if (!v || typeof v !== 'object') return d;
  const r = v as Partial<TipsState>;
  return { on: r.on !== false, start: typeof r.start === 'number' && r.start >= 0 ? r.start : 0, done: Array.isArray(r.done) ? r.done.filter((x): x is string => typeof x === 'string').slice(0, 50) : [] };
}

/** The seven tips for these goals: two for everyone, the person's own goals', the rest for everyone, then others to fill the week. */
export function tipsFor(goals: GoalId[]): Tip[] {
  const mine = TIPS.filter((t) => t.goals?.some((g) => goals.includes(g)));
  const all = TIPS.filter((t) => !t.goals);
  const others = TIPS.filter((t) => t.goals && !mine.includes(t));
  const order = [all[0], all[1], ...mine, ...all.slice(2), ...others].filter((t, i, a) => a.indexOf(t) === i);
  return order.slice(0, TIP_DAYS);
}

/** Today's tip: a new one each day for a week from the start, unless it was put away. None once the week is over or the series is off. */
export function tipToday(s: TipsState, goals: GoalId[], now: number): Tip | null {
  if (!s.on || !s.start) return null;
  const day = Math.floor((now - s.start) / 86_400_000);
  if (day < 0 || day >= TIP_DAYS) return null;
  const tip = tipsFor(goals)[day];
  return tip && !s.done.includes(tip.id) ? tip : null;
}
