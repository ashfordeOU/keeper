// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Things Keeper already does, as commands in Quick Search: screenshots,
// recording, keep awake, Stage, dictation, focus, locking folders, Wi-Fi and
// Bluetooth. Each is a keeper:// link the app already answers, or one of a
// few named jobs the main process runs; each shows only while its part is on.
// The Toolbox's tools are commands here too ("JSON formatter", "Hashes"):
// the Toolbox is no longer a sidebar page, so Quick Search is their way in.

import { TOOLBOX } from '../tool-catalog';

export interface LaunchAction {
  id: string;
  title: string;
  /** more words it is found by */
  words: string;
  icon: string;
  /** the part that must be on for it to show */
  feature?: string;
  /** a keeper:// link the app handles */
  link?: string;
  /** a job the main process runs (see electron/services/launcher.ts) */
  run?: 'clips' | 'selection' | 'pasteQueue' | 'plainPaste' | 'wifiOn' | 'wifiOff' | 'bluetoothOn' | 'bluetoothOff' | 'hideIsland';
  /** only on these systems */
  platforms?: string[];
  /** a Toolbox tool (core/tool-catalog.ts id without `toolbox:`), opened on the Toolbox page */
  tool?: string;
}

export const LAUNCH_ACTIONS: LaunchAction[] = [
  { id: 'shot-area', title: 'Take a screenshot of an area', words: 'capture screen grab snip', icon: 'screenshot', feature: 'capture', link: 'keeper://screenshot?mode=area' },
  { id: 'shot-window', title: 'Take a screenshot of a window', words: 'capture screen grab', icon: 'screenshot', feature: 'capture', link: 'keeper://screenshot?mode=window' },
  { id: 'shot-full', title: 'Take a screenshot of the whole screen', words: 'capture screen grab full', icon: 'screenshot', feature: 'capture', link: 'keeper://screenshot?mode=full' },
  { id: 'copy-text', title: 'Copy text from the screen', words: 'ocr read text capture', icon: 'text', feature: 'capture', link: 'keeper://capture' },
  { id: 'record', title: 'Record the screen', words: 'video capture recording', icon: 'video', feature: 'capture', link: 'keeper://record?mode=full' },
  { id: 'color', title: 'Pick a colour from the screen', words: 'color picker eyedropper hex', icon: 'palette', feature: 'capture', link: 'keeper://color' },
  { id: 'studio', title: 'Start or stop a Studio recording', words: 'record video screen studio', icon: 'video', feature: 'studio', link: 'keeper://studio/record' },
  { id: 'awake-hour', title: 'Keep the computer awake for an hour', words: 'caffeine no sleep stay awake', icon: 'coffee', feature: 'keepAwake', link: 'keeper://awake?for=60m' },
  { id: 'awake-toggle', title: 'Keep awake on or off', words: 'caffeine no sleep stay awake toggle', icon: 'coffee', feature: 'keepAwake', link: 'keeper://awake/toggle' },
  { id: 'awake-off', title: 'Let the computer sleep again', words: 'keep awake off sleep', icon: 'coffee', feature: 'keepAwake', link: 'keeper://awake/off' },
  { id: 'stage', title: 'Tidy the screen for presenting', words: 'stage present hide windows desktop clean screen', icon: 'eye', feature: 'stage', link: 'keeper://stage/toggle' },
  { id: 'dictate', title: 'Start or stop dictation', words: 'voice speak type dictate', icon: 'mic', feature: 'dictation', link: 'keeper://dictation/toggle' },
  { id: 'meeting', title: 'Record a meeting', words: 'transcribe notes call', icon: 'mic', feature: 'meetings', link: 'keeper://meeting/start' },
  { id: 'focus', title: 'Focus for 25 minutes', words: 'timer pomodoro concentrate', icon: 'timer', feature: 'focus', link: 'keeper://focus?minutes=25' },
  { id: 'focus-stop', title: 'Stop the focus timer', words: 'timer pomodoro end', icon: 'timer', feature: 'focus', link: 'keeper://focus?minutes=0' },
  { id: 'lock-all', title: 'Lock every unlocked folder', words: 'locked folders encrypt secure', icon: 'lock', feature: 'lock', link: 'keeper://lock-all' },
  { id: 'cue', title: 'New cue for this app', words: 'note reminder checklist', icon: 'pin', feature: 'cues', link: 'keeper://cue' },
  { id: 'terminal', title: 'Open a terminal', words: 'shell console command line', icon: 'terminal', feature: 'terminal', link: 'keeper://terminal' },
  { id: 'clips', title: 'Clipboard history', words: 'copy paste clips', icon: 'clipboard', feature: 'clipboard', run: 'clips' },
  { id: 'paste-queue', title: 'Paste one by one', words: 'paste queue clipboard several next', icon: 'clipboard', feature: 'clipboard', run: 'pasteQueue' },
  { id: 'plain-paste', title: 'Paste as plain text', words: 'paste without formatting clipboard', icon: 'text', feature: 'clipboard', run: 'plainPaste' },
  { id: 'selection', title: 'Actions for selected text', words: 'translate rewrite define selection', icon: 'sparkle', feature: 'selectionBar', run: 'selection' },
  { id: 'hide-island', title: 'Hide or show the Island', words: 'notch island hide', icon: 'island', feature: 'island', run: 'hideIsland' },
  { id: 'wifi-on', title: 'Turn Wi-Fi on', words: 'wireless network wifi', icon: 'globe', feature: 'quickControls', run: 'wifiOn' },
  { id: 'wifi-off', title: 'Turn Wi-Fi off', words: 'wireless network wifi', icon: 'globe', feature: 'quickControls', run: 'wifiOff' },
  { id: 'bt-on', title: 'Turn Bluetooth on', words: 'bluetooth radio', icon: 'link', feature: 'quickControls', run: 'bluetoothOn' },
  { id: 'bt-off', title: 'Turn Bluetooth off', words: 'bluetooth radio', icon: 'link', feature: 'quickControls', run: 'bluetoothOff' },
  { id: 'cleanup', title: 'Clean up space', words: 'junk cache free space', icon: 'broom', feature: 'cleanup', link: 'keeper://clean' },
  { id: 'settings', title: 'Keeper Settings', words: 'preferences options', icon: 'settings', link: 'keeper://settings' },
];

/** Each Toolbox tool as a Quick Search command that opens it. */
export const TOOL_ACTIONS: LaunchAction[] = TOOLBOX.map((t) => {
  const id = t.id.slice('toolbox:'.length);
  return { id: `tool-${id}`, title: t.name, words: `${t.desc} ${t.words ?? ''} toolbox tool`.toLowerCase(), icon: t.icon, feature: t.feature ?? 'tools', tool: id };
});

/** The actions that apply here, given which parts are on. */
export function availableActions(on: (feature: string) => boolean, platform: string): LaunchAction[] {
  return [...LAUNCH_ACTIONS, ...TOOL_ACTIONS].filter((a) => (!a.feature || on(a.feature)) && (!a.platforms || a.platforms.includes(platform)));
}
