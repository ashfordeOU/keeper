// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the window (and the CLI, AI abilities and browser extension) can ask of Cues.

import type { CueFilter, CueSort } from './dashboard';
import type { Cue, CueAnchor, CueTemplate, FrontContext, SnoozeChoice } from './model';

export interface CueSettings {
  /** where the Markdown files live (empty: Documents/Keeper Cues) */
  folder: string;
  /** pop up beside the app or page; otherwise a quiet Island bubble only */
  popup: boolean;
  /** also show in the Island */
  island: boolean;
  /** a system notification when a timed cue is due */
  notify: boolean;
  /** minutes before the same cue pops up again in the same place */
  cooldownMin: number;
  /** offer to leave a cue after time spent on a page (browser extension) */
  captureHint: boolean;
  hintAfterMin: number;
  hintEveryMin: number;
  /** copying a link switches the Island composer to a link cue */
  linkOnCopy: boolean;
  /** Tab completes phrases learnt from your cues */
  suggestions: boolean;
  /** global shortcut that opens the composer attached to what is in front */
  shortcut: string;
  /** in the menu bar / tray menu */
  tray: boolean;
  /** card text size on the dashboard, in points */
  textSize: number;
}

export function defaultCueSettings(): CueSettings {
  return {
    folder: '', popup: true, island: true, notify: true, cooldownMin: 10, captureHint: false, hintAfterMin: 3, hintEveryMin: 60,
    linkOnCopy: true, suggestions: true, shortcut: 'CommandOrControl+Alt+K', tray: true, textSize: 14,
  };
}

export function normalizeCueSettings(s: Partial<CueSettings> | undefined): CueSettings {
  const d = defaultCueSettings();
  const x = { ...d, ...(s ?? {}) };
  x.cooldownMin = Math.max(0, Math.min(24 * 60, Number(x.cooldownMin) || 0));
  x.hintAfterMin = Math.max(1, Math.min(120, Number(x.hintAfterMin) || d.hintAfterMin));
  x.hintEveryMin = Math.max(5, Math.min(24 * 60, Number(x.hintEveryMin) || d.hintEveryMin));
  x.textSize = Math.max(9, Math.min(28, Number(x.textSize) || d.textSize));
  return x;
}

export interface CueState {
  cues: Cue[];
  templates: CueTemplate[];
  settings: CueSettings;
  folder: string;
  /** what is in front right now (and the anchors offered for it) */
  front?: FrontContext;
  offered: CueAnchor[];
  /** cues showing for what is in front */
  showing: string[];
  /** where front-window changes come from on this computer, in plain words */
  watcher: string;
  /** a browser with the extension is linked (so page and site cues work) */
  browserLinked: boolean;
}

export interface CueInput {
  text?: string;
  title?: string;
  body?: string;
  type?: Cue['type'];
  items?: string[];
  url?: string;
  files?: string[];
  due?: number | null;
  repeat?: Cue['repeat'] | null;
  anchors?: CueAnchor[];
  /** attach to what is in front: 'app' | 'site' | 'page' | 'title' */
  attach?: CueAnchor['kind'][];
  show?: Cue['show'];
  tags?: string[];
  pinned?: boolean;
}

export interface CuesApi {
  state(): Promise<CueState>;
  list(o?: { filter?: CueFilter; q?: string; sort?: CueSort }): Promise<Cue[]>;
  create(input: CueInput): Promise<Cue>;
  update(id: string, patch: CueInput & { items?: string[] }): Promise<Cue>;
  toggleItem(id: string, itemId: string): Promise<Cue>;
  skipItem(id: string, itemId: string): Promise<Cue>;
  complete(id: string): Promise<Cue>;
  reopen(id: string): Promise<Cue>;
  snooze(id: string, choice: SnoozeChoice | number): Promise<Cue>;
  remove(id: string): Promise<void>;
  restore(id: string): Promise<Cue>;
  purge(id: string): Promise<void>;
  /** the cue popup closed it for now */
  dismiss(id: string): Promise<void>;
  templates(): Promise<CueTemplate[]>;
  saveTemplate(t: Partial<CueTemplate> & { name: string; items: string[] }): Promise<CueTemplate>;
  removeTemplate(id: string): Promise<void>;
  /** start a reusable checklist, attached to what is in front when asked */
  startTemplate(id: string, o?: { skip?: number[]; attach?: CueAnchor['kind'][] }): Promise<Cue>;
  /** a draft from typed words (for the composer preview) */
  parse(text: string): Promise<import('./model').CueDraft>;
  suggest(typed: string): Promise<string>;
  settings(): Promise<CueSettings>;
  setSettings(patch: Partial<CueSettings>): Promise<CueSettings>;
  /** opens the composer (the Island, or the popup beside the window) */
  compose(o?: { text?: string; attach?: CueAnchor['kind'][] }): Promise<void>;
  openFolder(): Promise<void>;
  exportMarkdown(): Promise<string | null>;
  /** share the cues folder with your devices through Keeper Sync */
  syncWithDevices(): Promise<{ ok: boolean; message: string }>;
  /** for the popup window: what to show */
  popup(): Promise<{ cues: Cue[]; front?: FrontContext; compose?: { text?: string; attach?: CueAnchor['kind'][] } }>;
  closePopup(): Promise<void>;
  /** opens the Cues page in Keeper (a cue when given) */
  openPage(id?: string): Promise<void>;
  /** the page in front, as the browser extension reports it */
  reportPage(url: string, title: string): Promise<void>;
}
