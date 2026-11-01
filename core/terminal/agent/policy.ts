// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which commands an agent may run on its own, which need the person's yes,
// and which are refused. The person's own allow and deny lists win; then a set
// of plain rules spots commands that delete, overwrite, run things as an
// administrator, pipe the internet into a shell, or push over someone's work.

export type Risk = 'safe' | 'ask' | 'deny';

export interface CommandPolicy {
  /** glob-like patterns (* matches anything) always allowed without asking */
  allow: string[];
  /** patterns always refused */
  deny: string[];
  /** ask before commands the rules below consider risky (default on) */
  askRisky: boolean;
  /** the folders agent terminals must stay in (empty: anywhere) */
  jail: string[];
}

export const DEFAULT_POLICY: CommandPolicy = { allow: [], deny: [], askRisky: true, jail: [] };

const RISKY: [RegExp, string][] = [
  [/\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+|--recursive\s+|--force\s+)+/, 'deletes files without asking (rm -r/-f)'],
  [/\b(?:Remove-Item|ri|rd|rmdir|del|erase)\b[^\n]*(?:-Recurse|\/s\b|-Force|\/q\b)/i, 'deletes files recursively'],
  [/\bgit\s+push\b[^\n]*(?:--force\b|-f\b|--force-with-lease\b|\+[\w./-]+)/, 'force-pushes over the remote branch'],
  [/\bgit\s+(?:reset\s+--hard|clean\s+-[a-zA-Z]*[fdx]|checkout\s+--\s|restore\s+--source|branch\s+-D|stash\s+(?:drop|clear)|filter-branch|rebase\b)/, 'can throw away local work in git'],
  [/(?:^|[;&|]\s*)(?:sudo|doas|pkexec|runas)\b|\bStart-Process\b[^\n]*-Verb\s+RunAs/i, 'runs as an administrator'],
  [/\b(?:curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish|python3?|node|iex|Invoke-Expression)\b/i, 'runs a script straight from the internet'],
  [/\b(?:mkfs(?:\.\w+)?|fdisk|parted|diskutil\s+(?:erase|partition|apfs\s+delete)|format\s+[a-z]:)/i, 'formats or partitions a disk'],
  [/\bdd\b[^\n]*\bof=\/dev\//, 'writes directly to a disk'],
  [/>\s*\/dev\/(?:sd|nvme|disk)\w*/, 'writes directly to a disk'],
  [/\bchmod\s+(?:-R\s+)?(?:777|a\+rwx)\b|\bchown\s+-R\b/, 'changes permissions broadly'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'a fork bomb'],
  [/\b(?:shutdown|reboot|halt|poweroff|Stop-Computer|Restart-Computer)\b/i, 'shuts down or restarts the computer'],
  [/\b(?:kill|pkill|killall)\s+(?:-9\s+|-KILL\s+)?(?:-1\b|1\b)/, 'kills every process'],
  [/\b(?:npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgh\s+release\s+create\b|\bdocker\s+push\b/, 'publishes something to the internet'],
  [/\b(?:DROP\s+(?:TABLE|DATABASE)|TRUNCATE\s+TABLE)\b/i, 'deletes database data'],
  [/\bterraform\s+(?:apply|destroy)\b|\bkubectl\s+(?:delete|apply)\b|\bhelm\s+(?:uninstall|delete)\b/, 'changes live infrastructure'],
  [/(?:^|\s)>\s*~?\/?(?:\.ssh|\.gnupg|\.aws)\//, 'overwrites keys or credentials'],
  [/\bhistory\s+-c\b|\bunset\s+HISTFILE\b/, 'hides what was run'],
];

const glob = (p: string) => new RegExp('^' + p.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

/** What happens with this command: run, ask the person, or refuse, and why. */
export function classifyCommand(command: string, policy: CommandPolicy = DEFAULT_POLICY): { risk: Risk; reasons: string[] } {
  const c = command.trim();
  for (const p of policy.deny) if (p.trim() && glob(p).test(c)) return { risk: 'deny', reasons: [`matches your blocked pattern “${p}”`] };
  for (const p of policy.allow) if (p.trim() && glob(p).test(c)) return { risk: 'safe', reasons: [] };
  const reasons = RISKY.filter(([re]) => re.test(c)).map(([, why]) => why);
  if (reasons.length && policy.askRisky) return { risk: 'ask', reasons: [...new Set(reasons)] };
  return { risk: 'safe', reasons: [...new Set(reasons)] };
}

const norm = (p: string, win: boolean) => {
  let s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (win) s = s.toLowerCase();
  return s || '/';
};

/** A folder is inside the jail (when one is set). */
export function insideJail(folder: string, jail: string[], win = false): boolean {
  if (!jail.length) return true;
  const f = norm(folder, win);
  return jail.some((j) => {
    const r = norm(j, win);
    return f === r || f.startsWith(r === '/' ? '/' : r + '/');
  });
}

/** Absolute paths a command mentions that fall outside the jail (an advisory check; shells can always reach further). */
export function pathsOutsideJail(command: string, jail: string[], home: string, win = false): string[] {
  if (!jail.length) return [];
  const found = command.match(/(?:^|[\s"'=])((?:~|[A-Za-z]:)?[\\/][^\s"'|;&<>]*)/g) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    let p = raw.replace(/^[\s"'=]/, '');
    if (p.startsWith('~')) p = home + p.slice(1);
    if (/^\/dev\/(?:null|stdout|stderr|tty)$/.test(p)) continue;
    if (!insideJail(p, jail, win)) out.push(p);
  }
  return [...new Set(out)];
}
