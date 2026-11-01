// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What AI agents may do in Keeper, beyond reading. Every action has a
// permission the person sets: off, ask each time, or allowed. Ask is the
// default for anything that changes something; Keeper then shows who wants to
// do what, and nothing happens until the person says yes. Files only ever go
// to the Trash, and every change is recorded in History so it can be undone.

import type { ToolSpec } from './providers';

export type Permission = 'off' | 'ask' | 'allow';

export interface ActionSpec extends ToolSpec {
  /** reads only (no approval needed unless the person says so) */
  readOnly: boolean;
  /** can lose something (Trash, quitting an app) */
  destructive?: boolean;
  /** default permission */
  default: Permission;
  /** plain words for the permissions list */
  label: string;
  group: 'files' | 'system' | 'keeper' | 'clipboard' | 'tasks';
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const str = (description: string) => ({ type: 'string', description });

export const ACTIONS: ActionSpec[] = [
  { name: 'move_files', label: 'Move files', group: 'files', readOnly: false, default: 'ask', description: 'Move files or folders into another folder (created if missing). Recorded in Keeper\'s History and undoable.', parameters: obj({ paths: { type: 'array', items: { type: 'string' } }, to: str('destination folder') }, ['paths', 'to']) },
  { name: 'rename_file', label: 'Rename files', group: 'files', readOnly: false, default: 'ask', description: 'Rename one file or folder (new name only, not a path). Undoable.', parameters: obj({ path: str('file to rename'), name: str('new name') }, ['path', 'name']) },
  { name: 'tag_files', label: 'Tag files', group: 'files', readOnly: false, default: 'ask', description: 'Add tags to files (Keeper tags, and Finder tags on macOS).', parameters: obj({ paths: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } } }, ['paths', 'tags']) },
  { name: 'trash_files', label: 'Send files to the Trash', group: 'files', readOnly: false, destructive: true, default: 'ask', description: 'Send files to the system Trash (never deleted outright). Protected and excluded folders are refused.', parameters: obj({ paths: { type: 'array', items: { type: 'string' } } }, ['paths']) },
  { name: 'create_folder', label: 'Create folders', group: 'files', readOnly: false, default: 'ask', description: 'Create a new folder inside an existing one.', parameters: obj({ in: str('parent folder'), name: str('folder name') }, ['in', 'name']) },
  { name: 'open_path', label: 'Open files and apps', group: 'files', readOnly: false, default: 'ask', description: 'Open a file with its app, a folder in the file manager, or an application.', parameters: obj({ path: str('file, folder or app') }, ['path']) },
  { name: 'undo_last', label: 'Undo its own changes', group: 'keeper', readOnly: false, default: 'allow', description: 'Undo the most recent change this agent made through Keeper.', parameters: obj({}) },
  { name: 'run_automation', label: 'Run automations', group: 'keeper', readOnly: false, default: 'ask', description: 'Run one of the person\'s saved Keeper automations (rules) now. list_automations shows them.', parameters: obj({ id: str('automation id') }, ['id']) },
  { name: 'list_automations', label: 'See automations', group: 'keeper', readOnly: true, default: 'allow', description: 'The person\'s saved automations (rules) with what each does.', parameters: obj({}) },
  { name: 'focus_timer', label: 'Focus timer', group: 'keeper', readOnly: false, default: 'ask', description: 'Start, extend or stop the focus timer in Keeper\'s Island. start counts down `minutes` (25 by default); stopwatch counts up; extend adds `minutes` (5 by default). A session can be for a task (its id from tasks_list): the focused minutes are logged on it.', parameters: obj({ action: { type: 'string', enum: ['start', 'stopwatch', 'extend', 'stop'] }, minutes: { type: 'integer', minimum: 1, maximum: 240 }, task: str('task id (optional)') }, ['action']) },
  { name: 'tasks_list', label: 'See tasks', group: 'tasks', readOnly: true, default: 'allow', description: 'The person\'s tasks (Keeper\'s Reminders and Planner). view: today (planned or due today, plus unfinished ones from earlier days), inbox (no day), overdue, upcoming (next 14 days), week, all (open tasks). Each task has id, title, plannedFor (yyyy-mm-dd), due (ISO time), priority 0–3, project, repeat (RRULE), steps and notes.', parameters: obj({ view: { type: 'string', enum: ['today', 'inbox', 'overdue', 'upcoming', 'week', 'all'] }, project: str('only this project'), includeDone: { type: 'boolean' } }) },
  { name: 'task_add', label: 'Add tasks', group: 'tasks', readOnly: false, default: 'ask', description: 'Add a task. Either `text` in plain words ("call Ana tomorrow 3pm !! #work every Monday": ! to !!! set priority, #word a project, dates, times and repeats are understood) or `title` with fields. Fields given explicitly win over the words.', parameters: obj({ text: str('the task in plain words'), title: str('title'), notes: str('notes'), plannedFor: str('day yyyy-mm-dd'), due: str('due time, ISO 8601'), priority: { type: 'integer', minimum: 0, maximum: 3 }, project: str('project'), rrule: str('repeat rule, e.g. FREQ=WEEKLY;BYDAY=MO'), steps: { type: 'array', items: { type: 'string' } } }) },
  { name: 'task_update', label: 'Change tasks', group: 'tasks', readOnly: false, default: 'ask', description: 'Change a task (id from tasks_list). Only the fields given change; null clears plannedFor, due or rrule. steps replaces the whole list.', parameters: obj({ id: str('task id'), title: str('title'), notes: str('notes'), plannedFor: { type: ['string', 'null'], description: 'day yyyy-mm-dd, or null for the Inbox' }, due: { type: ['string', 'null'], description: 'ISO 8601 time, or null' }, priority: { type: 'integer', minimum: 0, maximum: 3 }, project: str('project ("" clears it)'), rrule: { type: ['string', 'null'] }, steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, done: { type: 'boolean' } } } } }, ['id']) },
  { name: 'task_complete', label: 'Check off tasks', group: 'tasks', readOnly: false, default: 'ask', description: 'Check a task off (a repeating one rolls on to its next date), or open it again with done: false.', parameters: obj({ id: str('task id'), done: { type: 'boolean' } }, ['id']) },
  { name: 'task_delete', label: 'Delete tasks', group: 'tasks', readOnly: false, destructive: true, default: 'ask', description: 'Delete a task (from its account too, for synced lists).', parameters: obj({ id: str('task id') }, ['id']) },
  { name: 'island_notes_read', label: 'Read Island notes', group: 'tasks', readOnly: true, default: 'ask', description: 'The quick notes kept in Keeper\'s Island (newest first), optionally only those containing the query words.', parameters: obj({ query: str('words to look for'), limit: { type: 'integer', maximum: 50 } }) },
  { name: 'island_notes_append', label: 'Write Island notes', group: 'tasks', readOnly: false, default: 'ask', description: 'Add text to the end of an Island note: today\'s Today pad unless a note id is given.', parameters: obj({ text: str('text to add'), note: str('note id (optional)') }, ['text']) },
  { name: 'insights_get', label: 'See Insights', group: 'tasks', readOnly: true, default: 'allow', description: 'Tasks done and focus minutes today and this week, the last seven days, and the hours of the day the person gets most done.', parameters: obj({}) },
  { name: 'set_setting', label: 'Change Keeper settings', group: 'keeper', readOnly: false, default: 'ask', description: 'Turn a Keeper feature on or off. Allowed keys: appearance (light|dark|system), showHidden (true|false), island.enabled, brain.semantic, theme.', parameters: obj({ key: str('setting key'), value: { description: 'new value' } }, ['key', 'value']) },
  { name: 'clipboard_read', label: 'Read the clipboard', group: 'clipboard', readOnly: true, default: 'ask', description: 'Read the text on the clipboard.', parameters: obj({}) },
  { name: 'clipboard_write', label: 'Write the clipboard', group: 'clipboard', readOnly: false, default: 'ask', description: 'Put text on the clipboard.', parameters: obj({ text: str('text to copy') }, ['text']) },
  { name: 'system_snapshot', label: 'See how the computer is doing', group: 'system', readOnly: true, default: 'allow', description: 'Processor, memory, disk space, battery and the busiest processes right now.', parameters: obj({}) },
  { name: 'list_processes', label: 'See running programs', group: 'system', readOnly: true, default: 'allow', description: 'Running processes sorted by processor or memory use.', parameters: obj({ sort: { type: 'string', enum: ['cpu', 'memory'] }, limit: { type: 'integer', maximum: 100 } }) },
  { name: 'why_slow', label: 'Explain slowness', group: 'system', readOnly: true, default: 'allow', description: 'Diagnose why the computer feels slow: heavy programs, memory pressure, a full disk, many startup items. Returns findings and suggested fixes.', parameters: obj({}) },
  { name: 'quit_app', label: 'Quit programs', group: 'system', readOnly: false, destructive: true, default: 'ask', description: 'Ask a program to quit (gracefully). System processes and Keeper itself are refused.', parameters: obj({ pid: { type: 'integer' }, force: { type: 'boolean' } }, ['pid']) },
  { name: 'suspend_app', label: 'Pause programs', group: 'system', readOnly: false, default: 'ask', description: 'Pause (or resume) a program so it stops using the processor.', parameters: obj({ pid: { type: 'integer' }, resume: { type: 'boolean' } }, ['pid']) },
];

export const ACTION_NAMES = new Set(ACTIONS.map((a) => a.name));

export function actionSpec(name: string): ActionSpec | undefined {
  return ACTIONS.find((a) => a.name === name);
}

/** The permission in force for one action: the person's choice, or the default. */
export function permissionFor(name: string, perms: Record<string, Permission> | undefined, enabled: boolean): Permission {
  const a = actionSpec(name);
  if (!a || !enabled) return 'off';
  const p = perms?.[name];
  return p === 'off' || p === 'ask' || p === 'allow' ? p : a.default;
}

/** Actions an agent can see (anything not switched off). */
export function visibleActions(perms: Record<string, Permission> | undefined, enabled: boolean): ActionSpec[] {
  return ACTIONS.filter((a) => permissionFor(a.name, perms, enabled) !== 'off');
}

const short = (p: unknown) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? String(p ?? '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** One sentence for the approval prompt: who wants to do what. */
export function describeAction(name: string, args: Record<string, unknown>): string {
  const files = (v: unknown) => {
    const l = list(v);
    return l.length === 1 ? `“${short(l[0])}”` : `${l.length} items (${l.slice(0, 3).map(short).join(', ')}${l.length > 3 ? '…' : ''})`;
  };
  switch (name) {
    case 'move_files': return `move ${files(args.paths)} to ${String(args.to ?? '')}`;
    case 'rename_file': return `rename “${short(args.path)}” to “${String(args.name ?? '')}”`;
    case 'tag_files': return `tag ${files(args.paths)} with ${list(args.tags).map((t) => '#' + t).join(' ')}`;
    case 'trash_files': return `send ${files(args.paths)} to the Trash`;
    case 'create_folder': return `create the folder “${String(args.name ?? '')}” in ${String(args.in ?? '')}`;
    case 'open_path': return `open ${String(args.path ?? '')}`;
    case 'run_automation': return `run the automation “${String(args.id ?? '')}”`;
    case 'focus_timer': return args.action === 'stop' ? 'stop the focus timer' : args.action === 'stopwatch' ? 'start a focus stopwatch' : args.action === 'extend' ? `add ${Number(args.minutes) || 5} minutes to the focus timer` : `start a ${Number(args.minutes) || 25}-minute focus timer`;
    case 'task_add': return `add the task “${String(args.title ?? args.text ?? '').slice(0, 80)}”`;
    case 'task_update': return `change the task ${String(args.id ?? '')}${args.title ? ` (“${String(args.title).slice(0, 60)}”)` : ''}: ${Object.keys(args).filter((k) => k !== 'id').join(', ') || 'nothing'}`;
    case 'task_complete': return args.done === false ? `open the task ${String(args.id ?? '')} again` : `check off the task ${String(args.id ?? '')}`;
    case 'task_delete': return `delete the task ${String(args.id ?? '')}`;
    case 'island_notes_read': return 'read your Island notes';
    case 'island_notes_append': return `add ${String(args.text ?? '').length} characters to ${args.note ? 'an Island note' : 'today’s note in the Island'}`;
    case 'set_setting': return `change the setting ${String(args.key ?? '')} to ${JSON.stringify(args.value)}`;
    case 'clipboard_read': return 'read your clipboard';
    case 'clipboard_write': return `copy ${String(args.text ?? '').length} characters to your clipboard`;
    case 'quit_app': return `${args.force ? 'force quit' : 'quit'} the program with process id ${Number(args.pid)}`;
    case 'suspend_app': return `${args.resume ? 'resume' : 'pause'} the program with process id ${Number(args.pid)}`;
    case 'undo_last': return 'undo its last change';
    default: return name.replace(/_/g, ' ');
  }
}

/** Settings agents may change, and how each value is checked. */
export const SETTABLE: Record<string, (v: unknown) => boolean> = {
  appearance: (v) => v === 'light' || v === 'dark' || v === 'system',
  showHidden: (v) => typeof v === 'boolean',
  'island.enabled': (v) => typeof v === 'boolean',
  'brain.semantic': (v) => typeof v === 'boolean',
  theme: (v) => typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v),
};

// ---------------------------------------------------------------- slowness

export interface SystemSnapshot {
  cpuPercent: number;
  cores: number;
  memUsed: number;
  memTotal: number;
  swapUsed?: number;
  diskFree?: number;
  diskTotal?: number;
  battery?: { percent: number; charging: boolean };
  startupItems?: number;
  top: { pid: number; name: string; cpu: number; memory: number }[];
}

export interface Finding {
  severity: 'info' | 'warn' | 'bad';
  text: string;
  /** a fix the agent can offer (performed only with the person's approval) */
  fix?: { tool: string; args: Record<string, unknown>; label: string };
}

const GB = 1024 ** 3;

/** Plain findings from a snapshot: what is wrong, how bad, and what would help. */
export function diagnose(s: SystemSnapshot): Finding[] {
  const out: Finding[] = [];
  const mem = s.memTotal ? s.memUsed / s.memTotal : 0;
  if (s.cpuPercent >= 85) out.push({ severity: 'bad', text: `The processor is ${Math.round(s.cpuPercent)}% busy.` });
  else if (s.cpuPercent >= 60) out.push({ severity: 'warn', text: `The processor is fairly busy (${Math.round(s.cpuPercent)}%).` });
  for (const p of s.top.filter((p) => p.cpu >= 50).slice(0, 3)) {
    out.push({ severity: p.cpu >= 90 ? 'bad' : 'warn', text: `${p.name} is using ${Math.round(p.cpu)}% of a processor core.`, fix: { tool: 'suspend_app', args: { pid: p.pid }, label: `Pause ${p.name}` } });
  }
  if (mem >= 0.9 || (s.swapUsed ?? 0) > 2 * GB) out.push({ severity: 'bad', text: `Memory is nearly full (${Math.round(mem * 100)}% used${s.swapUsed ? `, ${(s.swapUsed / GB).toFixed(1)} GB swapped to disk` : ''}).` });
  else if (mem >= 0.8) out.push({ severity: 'warn', text: `Memory is ${Math.round(mem * 100)}% used.` });
  const hog = [...s.top].sort((a, b) => b.memory - a.memory)[0];
  if (hog && s.memTotal && hog.memory / s.memTotal >= 0.2) out.push({ severity: 'warn', text: `${hog.name} holds ${(hog.memory / GB).toFixed(1)} GB of memory.`, fix: { tool: 'quit_app', args: { pid: hog.pid }, label: `Quit ${hog.name}` } });
  if (s.diskTotal && s.diskFree !== undefined) {
    const free = s.diskFree / s.diskTotal;
    if (free < 0.05 || s.diskFree < 5 * GB) out.push({ severity: 'bad', text: `The disk is almost full (${(s.diskFree / GB).toFixed(1)} GB free). The system slows down without room for swap and caches. Keeper's Clean Up can help.` });
    else if (free < 0.12) out.push({ severity: 'warn', text: `Disk space is getting low (${(s.diskFree / GB).toFixed(0)} GB free).` });
  }
  if ((s.startupItems ?? 0) >= 15) out.push({ severity: 'warn', text: `${s.startupItems} programs start with the computer; turning some off in Keeper's Startup Items speeds up start-up.` });
  if (s.battery && !s.battery.charging && s.battery.percent <= 15) out.push({ severity: 'info', text: `The battery is at ${s.battery.percent}%; some computers slow down to save power.` });
  if (!out.length) out.push({ severity: 'info', text: 'Nothing stands out: the processor, memory and disk all have room.' });
  return out;
}
