// SPDX-License-Identifier: AGPL-3.0-or-later
// keeper — the command-line side of Keeper. Same engine as the app, for
// terminals, servers and scripts. Read-only unless you pass --yes.

import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KIND_LABEL } from '../core/classify';
import { cleanTarget, measureTarget } from '../core/cleanup/engine';
import { fileCleanupGroups, largeFiles } from '../core/cleanup/files';
import { cacheTargets } from '../core/cleanup/targets';
import { extrasOf, findExactDuplicates, findFormatPairs } from '../core/duplicates';
import { formatBytes, formatDate, relativeTime, tildify } from '../core/format';
import { FileIndex, type IndexFolder } from '../core/indexer';
import { scanAgentSessions } from '../core/island';
import { defaultFolders, readDownloadSource, targetEnv, trashWithoutElectron } from '../core/platform';
import { defaultRules, describeAction, describeCondition, planRule } from '../core/rules';
import type { FileEntry } from '../core/types';

declare const __KEEPER_VERSION__: string | undefined;
// Filled in from package.json when the CLI is built.
const VERSION = typeof __KEEPER_VERSION__ === 'string' ? __KEEPER_VERSION__ : '0.0.0-dev';
const home = os.homedir();
const tty = process.stdout.isTTY;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const dim = c('2');
const green = c('32');
const yellow = c('33');
const cyan = c('36');

interface Args {
  cmd: string;
  rest: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (['in', 'limit', 'min'].includes(k) && argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (a === '-y') flags.yes = true;
    else if (a === '-h') flags.help = true;
    else rest.push(a);
  }
  return { cmd: rest.shift() ?? 'help', rest, flags };
}

function foldersFrom(flags: Args['flags']): IndexFolder[] {
  if (typeof flags.in === 'string') {
    return flags.in.split(',').map((p) => {
      const abs = path.resolve(p.replace(/^~/, home));
      return { path: abs, label: path.basename(abs) };
    });
  }
  return defaultFolders(home).filter((f) => existsSync(f.path));
}

async function buildIndex(flags: Args['flags'], withSources = false): Promise<FileIndex> {
  const idx = new FileIndex(null, foldersFrom(flags), [], withSources ? { readSource: readDownloadSource } : {});
  const spin = progress('Reading your folders');
  await idx.scan({ onProgress: (p) => spin(`${p.phase} (${p.done.toLocaleString()} files)`), showHidden: !!flags.hidden });
  spin.done(`${idx.files.size.toLocaleString()} files indexed`);
  return idx;
}

function progress(label: string) {
  let last = 0;
  const fn = (msg: string) => {
    if (!tty || Date.now() - last < 100) return;
    last = Date.now();
    process.stderr.write(`\r\x1b[K${dim(msg)}`);
  };
  fn.done = (msg: string) => {
    if (tty) process.stderr.write(`\r\x1b[K`);
    process.stderr.write(dim(`${msg}\n`));
  };
  fn(label);
  return fn;
}

const row = (f: FileEntry) => `${formatBytes(f.size).padStart(9)}  ${dim(formatDate(f.mtime).padEnd(13))} ${tildify(f.path, home)}${f.source ? dim(`  ← ${f.source.name}`) : ''}`;

function out(data: unknown, flags: Args['flags'], human: () => void) {
  if (flags.json) console.log(JSON.stringify(data, null, 2));
  else human();
}

// ---------------------------------------------------------------- commands

async function cmdSearch(a: Args) {
  const text = a.rest.join(' ');
  if (!text) throw new Error('Usage: keeper search "pdfs from last week over 5 MB"');
  const idx = await buildIndex(a.flags, true);
  const { parsed, hits } = idx.query(text);
  const limit = Number(a.flags.limit ?? 50);
  out({ explanation: parsed.explanation, chips: parsed.chips, results: hits.slice(0, limit).map((h) => h.file) }, a.flags, () => {
    console.log(cyan(parsed.explanation));
    console.log(dim(parsed.chips.map((ch) => `[${ch.label}]`).join(' ')) + '\n');
    for (const h of hits.slice(0, limit)) {
      console.log(row(h.file));
      if (h.snippet) console.log(dim(`           ${h.snippet}`));
    }
    console.log(dim(`\n${hits.length} match${hits.length === 1 ? '' : 'es'}${hits.length > limit ? `, showing ${limit}` : ''}`));
  });
}

async function cmdDupes(a: Args) {
  const idx = await buildIndex(a.flags);
  const spin = progress('Comparing files');
  const exact = await findExactDuplicates(idx.all(), { onProgress: (d, t) => spin(`Comparing files ${d}/${t}`), minSize: Number(a.flags.min ?? 1) });
  const pairs = findFormatPairs(idx.all(), new Set(exact.flatMap((g) => g.files.map((f) => f.path))));
  spin.done('Done');
  const groups = [...exact, ...pairs];
  const total = groups.reduce((n, g) => n + g.reclaimable, 0);
  out(groups, a.flags, () => {
    for (const g of groups.slice(0, Number(a.flags.limit ?? 30))) {
      console.log(`${bold(formatBytes(g.reclaimable))} ${dim(g.kind === 'pair' ? 'same photo, two formats' : 'identical copies')}`);
      for (const f of g.files) console.log(`  ${f.path === g.keep ? green('keep ') : yellow('trash')} ${tildify(f.path, home)}`);
    }
    console.log(`\n${groups.length} groups, ${bold(formatBytes(total))} can be freed.`);
  });
  if (a.flags.yes && a.flags.trash) {
    let freed = 0;
    for (const g of groups) for (const f of extrasOf(g)) if (await trashWithoutElectron(f.path)) freed += f.size;
    console.log(green(`Moved duplicates to the Trash, freeing ${formatBytes(freed)}.`));
  }
}

async function cmdScan(a: Args) {
  const targets = cacheTargets(targetEnv());
  const spin = progress('Measuring caches');
  const caches: { id: string; name: string; safety: string; size: number; count: number; description: string }[] = [];
  for (const t of targets) {
    if (t.mode === 'bin' && process.platform === 'win32') continue;
    spin(`Measuring ${t.name}`);
    const m = await measureTarget(t);
    if (m.size > 0) caches.push({ id: t.id, name: t.name, safety: t.safety, size: m.size, count: m.count, description: t.description });
  }
  spin.done('Caches measured');
  const idx = await buildIndex(a.flags);
  const cards = fileCleanupGroups(idx.all(), { dirExists: (p) => existsSync(p) && statSync(p).isDirectory() });
  const big = largeFiles(idx.all(), 500).slice(0, 10);
  const total = caches.reduce((n, x) => n + x.size, 0) + cards.reduce((n, x) => n + x.size, 0);
  out({ caches, cards: cards.map(({ items, ...g }) => ({ ...g, files: items?.map((f) => f.path) })), largeFiles: big }, a.flags, () => {
    console.log(bold('\nRebuildable clutter') + dim('  (deleted for good with `keeper clean`)'));
    for (const x of caches) console.log(`${formatBytes(x.size).padStart(9)}  ${x.name} ${dim(`[${x.safety}]`)}`);
    console.log(bold('\nYour files to review') + dim('  (always go to the Trash)'));
    for (const g of cards) console.log(`${formatBytes(g.size).padStart(9)}  ${g.name} ${dim(`${g.count} files`)}`);
    if (big.length) {
      console.log(bold('\nLargest files'));
      for (const f of big) console.log(row(f));
    }
    console.log(`\n${bold(formatBytes(total))} could be freed. Run ${cyan('keeper clean')} to clear safe caches.`);
  });
}

async function cmdClean(a: Args) {
  const all = cacheTargets(targetEnv()).filter((t) => t.mode === 'cache');
  const wanted = a.rest.length ? all.filter((t) => a.rest.includes(t.id)) : all.filter((t) => t.preselect);
  if (!wanted.length) throw new Error(`Unknown group. Choose from: ${all.map((t) => t.id).join(', ')}`);
  const dry = !a.flags.yes;
  let freed = 0;
  for (const t of wanted) {
    const r = await cleanTarget(t, { platform: process.platform, home }, { dryRun: dry });
    freed += r.freed;
    console.log(`${formatBytes(r.freed).padStart(9)}  ${t.name}${r.inUse ? dim(` (${r.inUse} in use, skipped)`) : ''}${r.denied ? dim(` (${r.denied} need admin rights)`) : ''}`);
  }
  console.log(dry ? `\n${bold(formatBytes(freed))} would be freed. Add ${cyan('--yes')} to clean.` : green(`\nFreed ${formatBytes(freed)}.`));
}

async function cmdStats(a: Args) {
  const idx = await buildIndex(a.flags, !!a.flags.sources);
  const totals = idx.totals();
  out({ totals, sources: idx.bySource() }, a.flags, () => {
    for (const [k, v] of Object.entries(totals)) if (v.count) console.log(`${KIND_LABEL[k as keyof typeof KIND_LABEL].padEnd(11)} ${String(v.count).padStart(7)}  ${formatBytes(v.size).padStart(9)}`);
    const src = idx.bySource();
    if (src.length) {
      console.log(bold('\nDownloaded from'));
      for (const s of src.slice(0, 15)) console.log(`${s.name.padEnd(20)} ${String(s.count).padStart(5)}  ${formatBytes(s.size).padStart(9)}`);
    }
  });
}

async function cmdRules(a: Args) {
  const idx = await buildIndex(a.flags);
  const rules = defaultRules(home);
  for (const r of rules) {
    const plan = planRule(idx.all(), r);
    console.log(`${bold(r.name)} ${dim(`(${r.id})`)}`);
    console.log(dim(`  when ${r.conditions.map(describeCondition).join(', ')} → ${describeAction(r.action)}`));
    for (const p of plan.slice(0, 5)) console.log(`  ${tildify(p.file.path, home)}${p.to ? dim(` → ${tildify(p.to, home)}`) : ''}`);
    if (plan.length > 5) console.log(dim(`  …and ${plan.length - 5} more`));
    if (!plan.length) console.log(dim('  nothing to do'));
  }
  console.log(dim('\nThis is a preview. Turn rules on in the Keeper app.'));
}

async function cmdAgents(a: Args) {
  const sessions = await scanAgentSessions(home);
  out(sessions, a.flags, () => {
    if (!sessions.length) return console.log(dim('No coding-agent sessions in the last few hours.'));
    const icon = { working: '●', waiting: yellow('▲'), done: green('✓'), stuck: c('31')('✕'), idle: '·' } as const;
    for (const s of sessions) console.log(`${icon[s.state]} ${bold(s.project)} ${dim(`${s.tool} · ${s.state} · ${relativeTime(s.updatedAt)}`)}\n   ${s.summary}`);
  });
}

function help() {
  console.log(`${bold('keeper')} ${VERSION} — find, understand and tidy your files

${bold('Usage')}
  keeper search <words>      Plain-English search: keeper search "screenshots with wifi password"
  keeper scan                What can be freed: caches, old installers, forgotten downloads, big files
  keeper clean [group…]      Clear rebuildable caches (preview unless --yes)
  keeper dupes               Exact duplicates and HEIC/JPEG pairs (--trash --yes to remove extras)
  keeper stats               Files per shelf and where downloads came from (--sources)
  keeper rules               Preview the automatic tidy-up rules
  keeper agents              Status of Claude Code / Codex sessions on this computer

${bold('Options')}
  --in <folders>   comma-separated folders instead of Desktop, Documents, Downloads, …
  --json           machine-readable output
  --limit <n>      how many results to show
  --hidden         include hidden files
  --yes, -y        actually make changes (everything else is a dry run)

Licensed under the GNU AGPL v3 or later.`);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.flags.version) return console.log(VERSION);
  if (a.flags.help) return help();
  switch (a.cmd) {
    case 'search': case 'find': return cmdSearch(a);
    case 'dupes': case 'duplicates': return cmdDupes(a);
    case 'scan': return cmdScan(a);
    case 'clean': return cmdClean(a);
    case 'stats': return cmdStats(a);
    case 'rules': return cmdRules(a);
    case 'agents': return cmdAgents(a);
    default: return help();
  }
}

main().catch((e) => {
  console.error(c('31')(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
