// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Help while typing and after a command fails, for people and agents alike:
//
//   quick fixes   a failed command's output → likely next commands
//                 (install what was not found, free a port, pull before push…)
//   problems      file:line:col in compiler, linter and test output → links
//   suggestions   completions from history, commands on PATH, git branches
//                 and the subcommands of common tools
//   .env          a folder's variables, when the profile asks for them
//
// All pure: the terminal window supplies the text and shows the results.

export interface QuickFix {
  label: string;
  /** typed into the terminal (not run unless the person presses Enter) */
  command: string;
}

const INSTALL: Record<string, Record<string, string>> = {
  darwin: { default: 'brew install {pkg}' },
  linux: { apt: 'sudo apt install {pkg}', dnf: 'sudo dnf install {pkg}', pacman: 'sudo pacman -S {pkg}', default: 'sudo apt install {pkg}' },
  win32: { default: 'winget install {pkg}' },
};

/** Packages that provide a command, where the name differs. */
const PROVIDES: Record<string, string> = { rg: 'ripgrep', fd: 'fd-find', python: 'python3', pip: 'python3-pip', node: 'nodejs', convert: 'imagemagick', ffprobe: 'ffmpeg', http: 'httpie', btm: 'bottom' };

/** Likely next commands after a failure. */
export function quickFixes(command: string, exitCode: number | undefined, output: string, platform: string, linuxPm = 'apt'): QuickFix[] {
  if (!exitCode) return [];
  const out: QuickFix[] = [];
  const tail = output.split('\n').slice(-60).join('\n');
  const cmd = command.trim();
  const add = (label: string, c: string) => { if (!out.some((x) => x.command === c)) out.push({ label, command: c }); };

  // Command not found: install it (or a close match).
  const nf = /(?:command not found:\s*|:\s*command not found|is not recognized as (?:an internal or external command|the name of a cmdlet)[^\n]*?)\s*['"]?([\w.+-]+)?/i.exec(tail)
    ?? /^(?:bash|zsh|sh|fish): (?:command not found: )?([\w.+-]+)(?:: command not found)?/im.exec(tail);
  if (nf) {
    const name = (nf[1] || cmd.split(/\s+/)[0] || '').replace(/['"]/g, '');
    if (name) {
      const pkg = PROVIDES[name] ?? name;
      const table = INSTALL[platform] ?? INSTALL.linux;
      add(`Install ${pkg}`, (table[platform === 'linux' ? linuxPm : 'default'] ?? table.default).replace('{pkg}', pkg));
    }
  }
  // A port in use: show and stop what holds it, then run again.
  const port = /(?:EADDRINUSE|address already in use|port (?:is )?already in use)[^\d]*?(?::|port\s)(\d{2,5})/i.exec(tail) ?? /(?:listen|bind)[^\n]*?:(\d{2,5})[^\n]*?(?:in use|EADDRINUSE)/i.exec(tail);
  if (port) {
    const p = port[1];
    if (platform === 'win32') add(`Stop what uses port ${p}`, `Get-NetTCPConnection -LocalPort ${p} | ForEach-Object { Stop-Process -Id $_.OwningProcess }`);
    else add(`Stop what uses port ${p}`, `kill $(lsof -t -i :${p})`);
    add('Run it again', cmd);
  }
  // git: no upstream, rejected push, typo'd subcommand.
  const up = /git push --set-upstream (\S+) (\S+)/.exec(tail);
  if (up) add('Push and set the upstream', `git push --set-upstream ${up[1]} ${up[2]}`);
  if (/\[rejected\][^\n]*\(fetch first\)|Updates were rejected because the remote contains work|non-fast-forward/i.test(tail)) add('Pull (rebase) first', 'git pull --rebase');
  const typo = /git: '([\w-]+)' is not a git command[\s\S]*?The most similar commands? (?:is|are)\s+([\w-]+)/.exec(tail);
  if (typo) add(`Did you mean git ${typo[2]}?`, cmd.replace(new RegExp(`\\b${typo[1]}\\b`), typo[2]));
  const pr = /(https:\/\/\S+\/(?:pull\/new|merge_requests\/new)\S*)/.exec(tail);
  if (pr) add('Open a pull request', platform === 'win32' ? `start ${pr[1]}` : platform === 'darwin' ? `open ${pr[1]}` : `xdg-open ${pr[1]}`);
  // Missing modules and scripts.
  const py = /ModuleNotFoundError: No module named '([\w.]+)'/.exec(tail);
  if (py) add(`pip install ${py[1].split('.')[0]}`, `python3 -m pip install ${py[1].split('.')[0]}`);
  const node = /Cannot find module '([^'./][^']*)'/.exec(tail);
  if (node) add(`npm install ${node[1].split('/').slice(0, node[1].startsWith('@') ? 2 : 1).join('/')}`, `npm install ${node[1].split('/').slice(0, node[1].startsWith('@') ? 2 : 1).join('/')}`);
  if (/npm ERR! Missing script:|npm error Missing script:/i.test(tail)) add('List the scripts', 'npm run');
  // Permission denied: the same as administrator (the person decides).
  if (/permission denied|EACCES|Operation not permitted/i.test(tail) && platform !== 'win32' && !/^sudo\b/.test(cmd)) add('Run as administrator', `sudo ${cmd}`);
  if (/Permission denied[^\n]*\.(?:sh|py)\b|: Permission denied$/m.test(tail) && /^\.\/\S+/.test(cmd)) add('Make it runnable', `chmod +x ${cmd.split(/\s+/)[0]}`);
  return out.slice(0, 4);
}

export interface Problem {
  file: string;
  line: number;
  col?: number;
  /** where in the text line the link sits */
  start: number;
  end: number;
}

const PROBLEM_RES: RegExp[] = [
  // tsc / MSBuild: path(12,5): error
  /((?:[A-Za-z]:)?[\w./\\@~+-]+\.[A-Za-z0-9]+)\((\d+),(\d+)\)/g,
  // Python tracebacks
  /File "([^"]+)", line (\d+)/g,
  // gcc, clang, rustc, go, eslint (unix), jest, many more: path:12:5 or path:12
  /((?:[A-Za-z]:)?(?:[\w.@~+-]+[/\\])*[\w.@~+-]+\.[A-Za-z0-9]{1,8}):(\d+)(?::(\d+))?/g,
  // Java / Kotlin stack frames: (File.java:12)
  /\(([\w$]+\.(?:java|kt|scala|groovy)):(\d+)\)/g,
];

/** file:line:col references in one line of output (no duplicates, URLs skipped). */
export function findProblems(text: string): Problem[] {
  const out: Problem[] = [];
  for (const re of PROBLEM_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      if (/[a-z]+:\/\/\S*$/i.test(text.slice(0, start + 1)) || /^https?:/i.test(m[1])) continue;
      if (out.some((p) => start < p.end && start + m![0].length > p.start)) continue;
      out.push({ file: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : undefined, start, end: start + m[0].length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Abbreviated or full git commit ids standing alone in a line. */
export function findGitHashes(text: string): { hash: string; start: number; end: number }[] {
  const out: { hash: string; start: number; end: number }[] = [];
  const re = /(?<![\w/.-])([0-9a-f]{7,40})(?![\w/.-])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (/[a-f]/.test(m[1]) && /\d/.test(m[1])) out.push({ hash: m[1], start: m.index, end: m.index + m[1].length });
  return out;
}

/** A command to open a file at a line in the person's editor ({file} {line} {col}), or undefined for the system default. */
export function editorLine(template: string | undefined, file: string, line: number, col = 1): string | undefined {
  if (!template?.trim()) return undefined;
  return template.replace(/\{file\}/g, file).replace(/\{line\}/g, String(line)).replace(/\{col\}/g, String(col));
}

/** KEY=value lines (with quotes, export, comments and ${VAR} from earlier lines). */
export function parseDotEnv(text: string, base: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    const q = v[0];
    if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) {
      v = v.slice(1, v.lastIndexOf(q));
      if (q === '"') v = v.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else v = v.replace(/\s+#.*$/, '');
    if (q !== "'") v = v.replace(/\$\{(\w+)\}|\$(\w+)/g, (_s, a, b) => out[a ?? b] ?? base[a ?? b] ?? '');
    out[m[1]] = v;
  }
  return out;
}

/** Subcommands of common tools, for suggestions. */
const SPECS: Record<string, string[]> = {
  git: ['add', 'bisect', 'blame', 'branch', 'checkout', 'cherry-pick', 'clone', 'commit', 'diff', 'fetch', 'init', 'log', 'merge', 'mv', 'pull', 'push', 'rebase', 'remote', 'reset', 'restore', 'revert', 'rm', 'show', 'stash', 'status', 'switch', 'tag', 'worktree'],
  npm: ['install', 'run', 'test', 'start', 'ci', 'update', 'outdated', 'audit', 'init', 'exec', 'publish', 'uninstall', 'ls', 'version'],
  pnpm: ['install', 'add', 'run', 'test', 'dev', 'build', 'update', 'remove', 'dlx', 'exec'],
  yarn: ['install', 'add', 'run', 'test', 'dev', 'build', 'upgrade', 'remove', 'dlx'],
  docker: ['build', 'compose', 'exec', 'images', 'logs', 'ps', 'pull', 'push', 'rm', 'rmi', 'run', 'start', 'stop', 'system'],
  kubectl: ['apply', 'config', 'delete', 'describe', 'exec', 'get', 'logs', 'port-forward', 'rollout', 'scale'],
  cargo: ['add', 'build', 'check', 'clippy', 'doc', 'fmt', 'new', 'run', 'test', 'update'],
  go: ['build', 'fmt', 'generate', 'get', 'install', 'mod', 'run', 'test', 'vet'],
  python3: ['-m', '-c', '-V'],
  brew: ['install', 'uninstall', 'upgrade', 'update', 'list', 'search', 'info', 'services', 'doctor', 'cleanup'],
  claude: ['mcp', 'config', 'update', '--continue', '--resume', '-p'],
  codex: ['exec', 'login', 'mcp', 'resume', '--model'],
  keeper: ['search', 'ask', 'term', 'hub', 'mcp', 'clean', 'dupes', 'link', 'sync', 'backup'],
};

/** Completions for what is typed so far, best first. */
export function suggest(line: string, ctx: { history?: string[]; commands?: string[]; branches?: string[] }, limit = 8): string[] {
  const typed = line.replace(/^\s+/, '');
  if (!typed) return [...new Set((ctx.history ?? []).slice().reverse())].slice(0, limit);
  const out: string[] = [];
  const push = (s: string) => { if (s !== typed && s.startsWith(typed) && !out.includes(s)) out.push(s); };
  // Whole commands from history first (most recent first).
  for (const h of (ctx.history ?? []).slice().reverse()) push(h);
  const words = typed.split(/\s+/);
  const last = words[words.length - 1];
  const head = words.slice(0, -1).join(' ');
  const join = (w: string) => (head ? `${head} ${w}` : w);
  if (words.length === 1) for (const c of [...Object.keys(SPECS), ...(ctx.commands ?? [])]) if (c.startsWith(last)) push(join(c));
  if (words.length === 2) for (const sub of SPECS[words[0]] ?? []) if (sub.startsWith(last)) push(join(sub));
  if (words[0] === 'git' && ['checkout', 'switch', 'merge', 'rebase', 'branch', 'push', 'pull'].includes(words[1] ?? '') && words.length >= 3) for (const b of ctx.branches ?? []) if (b.startsWith(last)) push(join(b));
  return out.slice(0, limit);
}

/** Recent commands matching a filter (contiguous by default, fuzzy when asked), newest first, no repeats. */
export function recentCommands(history: string[], filter: string, fuzzy = false, limit = 50): string[] {
  const f = filter.toLowerCase();
  const fz = (s: string) => {
    let i = 0;
    for (const ch of s.toLowerCase()) if (ch === f[i]) i++;
    return i === f.length;
  };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of history.slice().reverse()) {
    const c = h.trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    if (!f || (fuzzy ? fz(c) : c.toLowerCase().includes(f))) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
