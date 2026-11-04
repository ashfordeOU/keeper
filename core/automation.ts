// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One list of what Keeper can be asked to do from outside: the `keeper do`
// command, keeper:// links, the Linux session bus (org.ashfordeou.Keeper.Actions),
// the PowerShell commands on Windows, AppleScript and Shortcuts on a Mac, and
// docs/AUTOMATION.md (made from this list, so the reference never drifts).
// Every action is a keeper:// link in the end: the running app (or the system,
// when Keeper is not running yet) opens it.

import { VERBS, type SendVerb } from './send-to';

export interface ActionArg {
  name: string;
  /** what to give it, in a few words */
  what: string;
  required?: boolean;
  /** used when it is left out */
  default?: string;
  /** a number between these */
  min?: number;
  max?: number;
}

export type ActionGroup = 'Find' | 'Catch and send' | 'Focus' | 'Screen' | 'Computer' | 'Pages';

export interface KeeperAction {
  id: string;
  title: string;
  /** what it does, one short sentence */
  what: string;
  group: ActionGroup;
  args: ActionArg[];
  /** the keeper:// link that does it */
  link(a: Record<string, string>): string;
  /** an example for the docs: argument values */
  example?: Record<string, string>;
}

const enc = encodeURIComponent;
const q = (pairs: [string, string | undefined][]) => {
  const s = pairs.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${enc(v!)}`).join('&');
  return s ? `?${s}` : '';
};

/** Send to… verbs as actions: words, a web link or a file go to a task, a note, an event… */
const sendActions: KeeperAction[] = VERBS.filter((v) => v.id !== 'device').map((v): KeeperAction => ({
  id: `send.${v.id}`,
  title: `Send to ${v.label}`,
  what: `${v.hint}.`,
  group: 'Catch and send',
  args: [
    { name: 'title', what: 'a short title', required: !v.needsFiles },
    { name: 'text', what: 'more words' },
    { name: 'url', what: 'a web link' },
    { name: 'path', what: 'a file (full path)', required: !!v.needsFiles },
    ...(v.id === 'event' ? [{ name: 'when', what: 'a day or time, like “friday 3pm”' }] : []),
  ],
  link: (a: Record<string, string>) => `keeper://send${q([['to', v.id], ['title', a.title], ['text', a.text], ['url', a.url], ['path', a.path], ['when', a.when]])}`,
  example: (v.needsFiles ? { path: '/Users/me/Documents/plan.pdf' } : v.id === 'event' ? { title: 'Lunch with Ana', when: 'friday 1pm' } : { title: 'Call the plumber' }) as Record<string, string>,
}));

export const ACTIONS: KeeperAction[] = [
  // Ids before "catch" are the ones the session bus has always had; their links stay the same.
  { id: 'ask', title: 'Ask Keeper', what: 'Ask about your files; the answer opens in Keeper.', group: 'Find', args: [{ name: 'question', what: 'your question', required: true }], link: (a) => `keeper://ask?q=${enc(a.question ?? '')}`, example: { question: 'when does my passport expire?' } },
  { id: 'search', title: 'Search files', what: 'Open Keeper with a search.', group: 'Find', args: [{ name: 'query', what: 'words to find', required: true }], link: (a) => `keeper://search?q=${enc(a.query ?? '')}`, example: { query: 'invoices from last month' } },
  { id: 'open-page', title: 'Open a Keeper page', what: 'Opens a page by name.', group: 'Pages', args: [{ name: 'page', what: 'home, health, cleanup, settings…', required: true }], link: (a) => `keeper://go?page=${enc(a.page ?? 'home')}`, example: { page: 'cleanup' } },
  { id: 'focus', title: 'Start a focus timer', what: 'Starts the focus timer; 0 minutes stops it.', group: 'Focus', args: [{ name: 'minutes', what: 'how long', default: '25', min: 0, max: 240 }], link: (a) => `keeper://focus?minutes=${enc(a.minutes || '25')}`, example: { minutes: '25' } },
  { id: 'lock-all', title: 'Lock folders', what: 'Locks again every folder unlocked in Keeper.', group: 'Computer', args: [], link: () => 'keeper://lock-all' },
  { id: 'automation', title: 'Run an automation', what: 'Runs one of your Automations by its name.', group: 'Computer', args: [{ name: 'name', what: 'the automation’s name', required: true }], link: (a) => `keeper://automation?name=${enc(a.name ?? '')}`, example: { name: 'Tidy downloads' } },
  { id: 'capture', title: 'Copy text from the screen', what: 'Select an area; its text is copied.', group: 'Screen', args: [], link: () => 'keeper://capture' },
  { id: 'awake', title: 'Keep the computer awake', what: 'Keeps the computer awake for a while.', group: 'Computer', args: [{ name: 'minutes', what: 'how long', default: '60', min: 1, max: 1440 }], link: (a) => `keeper://awake?on=true&minutes=${enc(a.minutes || '60')}`, example: { minutes: '90' } },
  { id: 'terminal', title: 'Open the Terminal', what: 'Opens Keeper’s Terminal, in a folder if you give one.', group: 'Computer', args: [{ name: 'cwd', what: 'a folder (full path)' }], link: (a) => `keeper://terminal${q([['cwd', a.cwd]])}` },
  { id: 'catch', title: 'Catch something', what: 'Puts words or a link in the Inbox to sort later; with nothing, opens the card.', group: 'Catch and send', args: [{ name: 'text', what: 'what to keep' }], link: (a) => `keeper://inbox${q([['text', a.text]])}`, example: { text: 'Ideas for the garden' } },
  ...sendActions,
  { id: 'screenshot', title: 'Take a screenshot', what: 'An area, a window or the whole screen.', group: 'Screen', args: [{ name: 'mode', what: 'area, window or full', default: 'area' }], link: (a) => `keeper://screenshot?mode=${enc(a.mode || 'area')}` },
  { id: 'dictation', title: 'Start or stop dictation', what: 'Starts dictation, or stops it when it is on.', group: 'Screen', args: [], link: () => 'keeper://dictation/toggle' },
  { id: 'stage', title: 'Stage mode on or off', what: 'A clean screen for presenting.', group: 'Screen', args: [], link: () => 'keeper://stage/toggle' },
  { id: 'settings', title: 'Open Settings', what: 'Opens Settings, at a section if you give one.', group: 'Pages', args: [{ name: 'section', what: 'general, appearance, accessibility…' }], link: (a) => `keeper://settings${a.section ? `/${enc(a.section)}` : ''}` },
];

export function actionById(id: string): KeeperAction | undefined {
  return ACTIONS.find((a) => a.id === id);
}

/** The link for an action and its arguments, or a plain message saying what is wrong. */
export function actionLink(id: string, args: Record<string, string | number | boolean | undefined>): { ok: true; link: string } | { ok: false; message: string } {
  const a = actionById(id);
  if (!a) return { ok: false, message: `No action called “${id}”. Run keeper do --list to see them.` };
  const plain: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== '' && v !== false) plain[k] = String(v);
  for (const k of Object.keys(plain)) if (!a.args.some((x) => x.name === k)) return { ok: false, message: `${a.title} does not take “${k}”. It takes: ${a.args.map((x) => x.name).join(', ') || 'nothing'}.` };
  for (const x of a.args) {
    if (x.required && !plain[x.name] && !(id.startsWith('send.') && (plain.path || plain.title || plain.text || plain.url))) return { ok: false, message: `${a.title} needs ${x.name} (${x.what}).` };
    if (plain[x.name] !== undefined && (x.min !== undefined || x.max !== undefined)) {
      const n = Number(plain[x.name]);
      if (!Number.isFinite(n) || (x.min !== undefined && n < x.min) || (x.max !== undefined && n > x.max)) return { ok: false, message: `${x.name} must be a number from ${x.min} to ${x.max}.` };
    }
  }
  if (plain.path && !/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(plain.path)) return { ok: false, message: 'Give the full path of the file.' };
  return { ok: true, link: a.link(plain) };
}

/** A keeper://send link back into what the window sends (null when it is not one). */
export function sendFromLink(url: string): { verb: SendVerb; title: string; text?: string; url?: string; path?: string; when?: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'keeper:' || (u.hostname || u.pathname.replace(/^\/+/, '')) !== 'send') return null;
  const to = u.searchParams.get('to') as SendVerb | null;
  if (!to || !VERBS.some((v) => v.id === to)) return null;
  const g = (k: string) => u.searchParams.get(k)?.slice(0, 4000) || undefined;
  const p = g('path');
  if (p && (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p) || /\0/.test(p))) return null;
  const title = g('title') ?? (p ? p.split(/[\\/]/).pop()! : g('text')?.split('\n')[0] ?? g('url') ?? '');
  if (!title) return null;
  return { verb: to, title, ...(g('text') ? { text: g('text') } : {}), ...(g('url') ? { url: g('url') } : {}), ...(p ? { path: p } : {}), ...(g('when') ? { when: g('when') } : {}) };
}

/** `keeper do focus --minutes 25` → id and arguments. */
export function parseDo(argv: string[]): { id: string; args: Record<string, string> } {
  const args: Record<string, string> = {};
  let id = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (k === 'json' || k === 'list') continue;
      if (v !== undefined) args[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
      else args[k] = 'true';
    } else if (!id) id = a;
    else {
      // `keeper do ask "when is…"`: a bare word fills the first argument.
      const first = actionById(id)?.args[0]?.name;
      if (first && !(first in args)) args[first] = a;
    }
  }
  return { id, args };
}

// ---------------------------------------------------------------- made from the list

/** The commands' reference for docs/AUTOMATION.md. */
export function automationDoc(): string {
  const out: string[] = [];
  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  for (const g of groups) {
    out.push(`### ${g}`, '', '| Action | What it does | Takes | Example |', '| --- | --- | --- | --- |');
    for (const a of ACTIONS.filter((x) => x.group === g)) {
      const takes = a.args.map((x) => `\`${x.name}\`${x.required ? '' : ' (optional)'}: ${x.what}`).join('<br>') || '—';
      const ex = `\`keeper do ${a.id}${Object.entries(a.example ?? {}).map(([k, v]) => ` --${k} ${/\s/.test(v) ? `"${v}"` : v}`).join('')}\``;
      out.push(`| **${a.id}** · ${a.title} | ${a.what} | ${takes} | ${ex} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

const psName = (a: KeeperAction) => {
  const verb = /^(Start|Open|Run|Lock|Take|Ask|Search|Catch|Send|Keep|Copy)\b/.exec(a.title)?.[1] ?? 'Invoke';
  const approved: Record<string, string> = { Start: 'Start', Open: 'Open', Run: 'Invoke', Lock: 'Lock', Take: 'New', Ask: 'Invoke', Search: 'Search', Catch: 'Add', Send: 'Send', Keep: 'Enable', Copy: 'Copy' };
  const noun = a.id.split(/[.-]/).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return `${approved[verb] ?? 'Invoke'}-Keeper${noun}`;
};

const cap = (n: string) => n[0].toUpperCase() + n.slice(1);
const HOLE = (n: string) => `KEEPERARG${n}END`;

/**
 * A PowerShell module (Keeper.psm1): one command per action. Each builds its
 * keeper:// link the same way as the list above (holes filled with the values,
 * escaped) and opens it; Keeper starts if it is not running.
 */
export function powershellModule(version: string): string {
  const lines = [
    `# Keeper ${version}: commands for PowerShell, made from Keeper's list of actions.`,
    '# Import-Module Keeper, then Get-Command -Module Keeper. Each command opens a keeper:// link; Keeper starts if it is not running.',
    '',
    'function Open-KeeperLink([string]$Link) { Start-Process $Link }',
    'function Get-KeeperEscaped([string]$Value) { if ($Value) { [uri]::EscapeDataString($Value) } else { "" } }',
    '',
  ];
  const names: string[] = [];
  const map: string[] = [];
  for (const a of ACTIONS) {
    const n = psName(a);
    names.push(n);
    map.push(`'${a.id}' = '${n}'`);
    const params = a.args.map((x) => `[Parameter(Mandatory=$${x.required && !a.id.startsWith('send.') ? 'true' : 'false'})][string]$${cap(x.name)}${x.default ? ` = '${x.default}'` : ''}`);
    let link = a.link(Object.fromEntries(a.args.map((x) => [x.name, HOLE(x.name)])));
    for (const x of a.args) link = link.split(HOLE(x.name)).join(`$(Get-KeeperEscaped $${cap(x.name)})`);
    lines.push(`# ${a.what}`, `function ${n} {`, `  param(${params.join(', ')})`, `  Open-KeeperLink "${link.replace(/`/g, '``').replace(/"/g, '`"')}"`, '}', '');
  }
  lines.push(
    '# Any action by its id, e.g. Invoke-KeeperAction focus @{ minutes = 25 }',
    'function Invoke-KeeperAction {',
    '  param([Parameter(Mandatory)][string]$Action, [hashtable]$Arguments = @{})',
    `  $commands = @{ ${map.join('; ')} }`,
    '  if (-not $commands.ContainsKey($Action)) { throw "No action called $Action" }',
    '  & $commands[$Action] @Arguments',
    '}',
    '',
    `Export-ModuleMember -Function Invoke-KeeperAction, ${names.join(', ')}`,
    '',
  );
  return lines.join('\r\n');
}

export const powershellCommandName = psName;

/** An AppleScript line that runs an action (Keeper answers keeper:// links it is sent). */
export function appleScriptFor(id: string, args: Record<string, string> = {}): string {
  const r = actionLink(id, args);
  if (!r.ok) throw new Error(r.message);
  return `tell application "Keeper" to open location "${r.link.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
