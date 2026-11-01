// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which project the editor or terminal in front is working on, and its file
// and symbol names (opt-in: Dictation → Settings → Spell my project's names).
// Cheap: the front window's process and its child shells' working folders
// (Linux /proc, macOS lsof), or a project folder named in the window title;
// then `git ls-files` and one `git grep` of declarations, cached for 5 minutes.
// Names only; no file contents are kept.

import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { folderFromTitle, gitRootOf, rankTerms, termsFromFiles, termsFromSymbols } from '../../../core/voice/code-terms';
import { powershell, run } from '../../../core/platform';

const cache = new Map<string, { at: number; terms: string[] }>();
const hasGit = (d: string) => existsSync(path.join(d, '.git'));

/** Child processes of a process, a few levels down (shells inside terminals and editors). */
function descendants(pid: number, pairs: [number, number][], depth = 3): number[] {
  const out: number[] = [];
  let level = [pid];
  for (let i = 0; i < depth && level.length; i++) {
    level = pairs.filter(([, pp]) => level.includes(pp)).map(([p]) => p);
    out.push(...level);
  }
  return out;
}

async function front(): Promise<{ pid?: number; title: string }> {
  if (process.platform === 'linux') {
    const id = (await run('xdotool', ['getactivewindow'], 2000)).stdout.trim();
    if (!id) return { title: '' };
    const pid = Number((await run('xdotool', ['getwindowpid', id], 2000)).stdout.trim()) || undefined;
    return { pid, title: (await run('xdotool', ['getwindowname', id], 2000)).stdout.trim() };
  }
  if (process.platform === 'darwin') {
    const r = await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to get unix id of first process whose frontmost is true'], 2000);
    return { pid: Number(r.stdout.trim()) || undefined, title: '' };
  }
  const r = await powershell(`Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public class KeeperFw { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p); [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); }
'@
$h = [KeeperFw]::GetForegroundWindow(); $p = 0; [KeeperFw]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null; $sb = New-Object Text.StringBuilder 512; [KeeperFw]::GetWindowText($h, $sb, 512) | Out-Null; "$p\`t$($sb.ToString())"`, 5000);
  const [p, ...t] = r.stdout.trim().split('\t');
  return { pid: Number(p) || undefined, title: t.join('\t') };
}

/** Working folders of the front process and the shells under it, deepest first. */
async function cwds(pid: number): Promise<string[]> {
  if (process.platform === 'linux') {
    const pairs: [number, number][] = [];
    for (const d of await fsp.readdir('/proc').catch(() => [] as string[])) {
      if (!/^\d+$/.test(d)) continue;
      const st = await fsp.readFile(`/proc/${d}/stat`, 'utf8').catch(() => '');
      const pp = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]);
      if (pp) pairs.push([Number(d), pp]);
    }
    const out: string[] = [];
    for (const p of [...descendants(pid, pairs).reverse(), pid]) { const c = await fsp.readlink(`/proc/${p}/cwd`).catch(() => ''); if (c) out.push(c); }
    return out;
  }
  if (process.platform === 'darwin') {
    const ps = await run('/bin/ps', ['-Ao', 'pid=,ppid='], 3000);
    const pairs = ps.stdout.split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter((x) => x.length === 2) as [number, number][];
    const pids = [...descendants(pid, pairs).reverse(), pid].slice(0, 40);
    const r = await run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')], 3000);
    return r.stdout.split('\n').filter((l) => l.startsWith('n/')).map((l) => l.slice(1));
  }
  return [];
}

/** Project folders under the usual places, for matching a window title. */
async function knownProjects(): Promise<string[]> {
  const home = os.homedir();
  const roots = [home, ...['code', 'src', 'dev', 'projects', 'Projects', 'workspace', 'repos', 'git', 'Developer', 'Documents/GitHub', 'source/repos'].map((r) => path.join(home, r))];
  const out: string[] = [];
  for (const r of roots) for (const n of await fsp.readdir(r).catch(() => [] as string[])) { const d = path.join(r, n); if (hasGit(d)) out.push(d); }
  return out;
}

/** The git project of the window in front, if it can be told cheaply. */
export async function frontProject(): Promise<string | undefined> {
  const f = await front().catch(() => ({ title: '' }) as { pid?: number; title: string });
  const home = os.homedir();
  if (f.pid) for (const c of await cwds(f.pid).catch(() => [])) {
    if (c === '/' || c === home) continue;
    const root = gitRootOf(c, hasGit);
    if (root) return root;
  }
  if (f.title) return folderFromTitle(f.title, await knownProjects());
  return undefined;
}

/** File and symbol names of a project (cached for five minutes). */
export async function projectTerms(root: string, max = 60): Promise<string[]> {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.terms;
  const ls = await run('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], 3000);
  const grep = await run('git', ['-C', root, 'grep', '--untracked', '-I', '-o', '-E', '(function|class|interface|type|enum|struct|trait|def|fn|func|const|protocol|record)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]{3,}', '--', '*.ts', '*.tsx', '*.js', '*.py', '*.go', '*.rs', '*.swift', '*.java', '*.kt', '*.cs', '*.rb', '*.c', '*.h', '*.cpp'], 3000);
  // what you are working on: changed and new files, and the last few commits
  const st = await run('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], 3000);
  const log = await run('git', ['-C', root, 'log', '-n', '15', '--name-only', '--format='], 3000);
  const nowFiles = new Set(st.stdout.split('\n').map((l) => l.slice(3).split(' -> ').pop()!.trim()).filter(Boolean));
  const recentFiles = new Set(log.stdout.split('\n').map((l) => l.trim()).filter((f) => f && !nowFiles.has(f)));
  const lines = grep.stdout.split('\n').slice(0, 30_000);
  const strip = (l: string) => l.slice(l.indexOf(':') + 1);
  const namesIn = (set: Set<string>) => [...new Set([...termsFromFiles([...set].map((f) => path.basename(f))), ...termsFromSymbols(lines.filter((l) => set.has(l.slice(0, l.indexOf(':')))).map(strip))])];
  const terms = rankTerms(termsFromFiles(ls.stdout.split('\n').filter(Boolean)), termsFromSymbols(lines.map(strip)), max, namesIn(recentFiles), namesIn(nowFiles));
  cache.set(root, { at: Date.now(), terms });
  return terms;
}
