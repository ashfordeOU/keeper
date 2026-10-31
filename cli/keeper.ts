// SPDX-License-Identifier: AGPL-3.0-or-later
// keeper — the command-line side of Keeper. Same engine as the app, for
// terminals, servers and scripts. Read-only unless you pass --yes.

import { cmdLink } from './link';
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
import { defaultFolders, readDownloadSource, readDownloadSources, targetEnv, trashWithoutElectron } from '../core/platform';
import { defaultRules, describeAction, describeCondition, planRule } from '../core/rules';
import type { FileEntry } from '../core/types';
import type { BrainHit, BrainStatus } from '../core/brain-contract';
import { connectToApp, offlineBrain } from '../core/brain/client';
import { serveLines } from '../core/brain/mcp';

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
  const idx = new FileIndex(null, foldersFrom(flags), [], withSources ? { readSource: readDownloadSource, readSources: readDownloadSources } : {});
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

function brainRow(h: BrainHit): string {
  return `${tildify(h.path, home)}  ${dim(`${formatBytes(h.size)} · ${relativeTime(h.mtime)}${h.why ? ` · ${h.why.join('+')}` : ''}`)}${h.snippet ? `\n           ${dim(h.snippet)}` : ''}`;
}

/** Searches Keeper's brain: inside files and by meaning (through the app, or its saved index). */
async function brainSearch(a: Args, text: string) {
  const limit = Number(a.flags.limit ?? 20);
  const mode = a.flags.semantic || a.flags.meaning ? 'meaning' : a.flags.words ? 'words' : 'hybrid';
  const app = await connectToApp();
  let hits: BrainHit[];
  if (app) {
    hits = (await app.call('keeper/search', { query: text, limit, mode })) as BrainHit[];
    app.close();
  } else {
    const off = await offlineBrain(undefined, { semantic: mode !== 'words' });
    if (!off) throw new Error('Keeper has not built its brain on this computer yet. Open the Keeper app once, or search without --brain.');
    hits = await off.brain.search({ query: text, limit, mode });
  }
  out(hits, a.flags, () => {
    for (const h of hits) console.log(brainRow(h));
    console.log(dim(`\n${hits.length} result${hits.length === 1 ? '' : 's'}${app ? '' : ' (Keeper is not running: searched the last saved index)'}`));
  });
}

async function cmdSearch(a: Args) {
  const text = a.rest.join(' ');
  if (!text) throw new Error('Usage: keeper search "pdfs from last week over 5 MB"');
  if (a.flags.semantic || a.flags.meaning || a.flags.brain || a.flags.words) return brainSearch(a, text);
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

/** Ask a question with the AI chosen in Keeper; it searches and reads through the brain. */
async function cmdAsk(a: Args) {
  const question = a.rest.join(' ');
  if (!question) throw new Error('Usage: keeper ask "when does my passport expire?"');
  // --plain: only the answer, as one block of text (for Shortcuts, Siri and scripts).
  const plain = !!a.flags.plain;
  const app = await connectToApp();
  if (app && plain) {
    const r = (await app.call('keeper/ask', { question })) as { answer: string };
    app.close();
    process.stdout.write(r.answer.trim() + '\n');
    return;
  }
  if (app) {
    let streamed = false;
    const r = (await app.call('keeper/ask', { question }, (method, params) => {
      if (method === 'keeper/delta' && !a.flags.json) { process.stdout.write((params as { text: string }).text); streamed = true; }
      if (method === 'keeper/step' && !a.flags.json && tty) process.stderr.write(dim(`  ${(params as { summary: string }).summary}\n`));
    })) as { answer: string; sources: BrainHit[]; provider: string };
    app.close();
    out(r, a.flags, () => {
      if (!streamed) process.stdout.write(r.answer);
      console.log('\n');
      if (r.sources.length) console.log(dim('Sources:\n' + r.sources.slice(0, 8).map((s) => `  ${tildify(s.path, home)}`).join('\n')));
    });
    return;
  }
  const off = await offlineBrain();
  if (!off) throw new Error('Keeper is not running and has no saved index yet. Open the Keeper app.');
  if (plain) {
    process.stdout.write((await off.brain.ask(question)).answer.trim() + '\n');
    return;
  }
  const r = await off.brain.ask(question, { onDelta: a.flags.json ? undefined : (t) => process.stdout.write(t) });
  out({ answer: r.answer, sources: r.sources }, a.flags, () => console.log('\n\n' + dim(r.sources.map((s) => `  ${tildify(s.path, home)}`).join('\n'))));
}

/**
 * Keeper as an agent for editors that speak the Agent Client Protocol (stdio).
 * Each prompt goes to Keeper's assistant in the running app (or the saved index).
 */
async function cmdAcp() {
  const { AcpAgent } = await import('../core/brain/acp');
  const write = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
  const agent = new AcpAgent({
    version: VERSION,
    newId: () => Math.random().toString(36).slice(2, 12),
    ask: async (question, o) => {
      const prior = (o.history as { q: string; a: string }[] | undefined) ?? [];
      const withContext = prior.length ? `${prior.slice(-3).map((t) => `Earlier question: ${t.q}\nYour answer: ${t.a}`).join('\n\n')}\n\nNow: ${question}` : question;
      const app = await connectToApp();
      let answer: string;
      if (app) {
        const r = (await app.call('keeper/ask', { question: withContext }, (method, params) => { if (method === 'keeper/delta') o.onDelta((params as { text: string }).text); })) as { answer: string };
        app.close();
        answer = r.answer;
      } else {
        const off = await offlineBrain();
        if (!off) throw new Error('Keeper is not running and has no saved index yet. Open the Keeper app.');
        answer = (await off.brain.ask(withContext, { onDelta: o.onDelta, signal: o.signal })).answer;
      }
      return { answer, history: [...prior, { q: question, a: answer }] };
    },
  }, (method, params) => write({ jsonrpc: '2.0', method, params }));
  let buf = '';
  process.stdin.setEncoding('utf8');
  await new Promise<void>((resolve) => {
    process.stdin.on('data', (c: string) => {
      buf += c;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
        void agent.handle(msg).then((r) => r && write(r));
      }
    });
    process.stdin.on('end', () => setTimeout(resolve, 300));
  });
}

/** MCP over stdio for AI apps: proxies to the running app, or serves the saved index read-only. */
async function cmdMcp() {
  const app = await connectToApp();
  if (app) {
    const send = app.raw((line) => process.stdout.write(line + '\n'));
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => {
      buf += c;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) send(line);
      }
    });
    await new Promise<void>((r) => process.stdin.on('end', () => { if (buf.trim()) send(buf); setTimeout(r, 200); }));
    app.close();
    return;
  }
  const off = await offlineBrain();
  if (!off) {
    process.stderr.write('Keeper is not running and has no saved index yet. Open the Keeper app once.\n');
    process.exit(1);
  }
  await serveLines(off.server, process.stdin, (line) => process.stdout.write(line + '\n'));
}

async function cmdBrain(a: Args) {
  const app = await connectToApp();
  let st: BrainStatus;
  if (app) {
    st = (await app.call('keeper/status')) as BrainStatus;
    app.close();
  } else {
    const off = await offlineBrain(undefined, { semantic: false });
    if (!off) throw new Error('Keeper has not built its brain on this computer yet. Open the Keeper app once.');
    st = off.brain.status();
  }
  out(st, a.flags, () => {
    console.log(`${bold('Keeper brain')} ${dim(app ? '(app running)' : '(app not running: last saved index)')}`);
    console.log(`  files            ${st.files.toLocaleString()}`);
    console.log(`  with text read   ${st.withText.toLocaleString()}`);
    console.log(`  passages         ${(st.passages ?? 0).toLocaleString()}`);
    console.log(`  meaning search   ${st.semantic}${st.semantic === 'ready' ? ` · ${st.embedded.toLocaleString()} done, ${st.pending.toLocaleString()} waiting` : ''}`);
  });
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
  console.log(`${bold('keeper')} ${VERSION} — Keeper by Ashforde® — find, understand and tidy your files

${bold('Usage')}
  keeper search <words>      Plain-English search: keeper search "screenshots with wifi password"
  keeper scan                What can be freed: caches, old installers, forgotten downloads, big files
  keeper clean [group…]      Clear rebuildable caches (preview unless --yes)
  keeper dupes               Exact duplicates and HEIC/JPEG pairs (--trash --yes to remove extras)
  keeper stats               Files per shelf and where downloads came from (--sources)
  keeper rules               Preview the automatic tidy-up rules
  keeper agents              Status of Claude Code / Codex sessions on this computer
  keeper ask <question>      Ask about your files with the AI chosen in Keeper (cites files)
  keeper search --semantic   Search Keeper's brain by meaning (--brain: words inside files too)
  keeper brain               What Keeper's brain has read
  keeper mcp                 Serve Keeper to AI apps over MCP (stdio)
  keeper acp                 Keeper as an agent for editors (Agent Client Protocol, stdio)
  keeper ask --plain "…"     Just the answer, as text (for Shortcuts and Siri)
  keeper link [status|devices|invite|pair|send|check|forward]
                             Keeper Link: your paired devices, files and ports between them
  keeper sync [status|pause|resume]
                             Folders synced between your devices, backups and mirrors
  keeper backup list|run|restore [name] [--snapshot S] [--to DIR] [--include a,b]
  keeper backup list|restore|verify --from <folder>
                             Open a backup straight from a drive or folder, without the app

${bold('Options')}
  --in <folders>   comma-separated folders instead of Desktop, Documents, Downloads, …
  --json           machine-readable output
  --limit <n>      how many results to show
  --hidden         include hidden files
  --yes, -y        actually make changes (everything else is a dry run)

Licensed under the GNU AGPL v3 or later.`);
}

// ---------------------------------------------------------------- sync and backups

async function appCall<T>(method: string, ...args: unknown[]): Promise<T> {
  const app = await connectToApp();
  if (!app) throw new Error('Keeper is not running. Open the Keeper app, or use `keeper backup restore --from <folder>` to restore without it.');
  try {
    return (await app.call(`keeper/sync.${method}`, { args })) as T;
  } finally {
    app.close();
  }
}

async function cmdSync(a: Args) {
  const sub = a.rest[0] ?? 'status';
  if (sub === 'pause' || sub === 'resume') {
    await appCall('setPaused', sub === 'pause');
    return console.log(sub === 'pause' ? 'Sync and backups paused.' : 'Sync and backups resumed.');
  }
  if (sub !== 'status') throw new Error('Usage: keeper sync status | pause | resume');
  const ov = await appCall<import('../core/api-sync').SyncOverview>('overview');
  out(ov, a.flags, () => {
    console.log(`${bold(ov.deviceName)}${ov.paused ? dim(' (paused)') : ''} · ${ov.peers.filter((p) => p.online).length}/${ov.peers.length} devices online`);
    for (const f of ov.folders) console.log(`  ${f.label.padEnd(24)} ${f.state.padEnd(9)} ${String(f.files).padStart(7)} files  ${formatBytes(f.bytes).padStart(9)}  ${dim(f.peers.map((p) => `${p.name}${p.online ? '' : ' (offline)'}`).join(', ') || 'no devices')}`);
    for (const b of ov.backups) console.log(`  ${dim('backup')} ${b.name.padEnd(24)} ${b.state.padEnd(8)} ${b.lastRun ? relativeTime(b.lastRun) : 'never'}${b.lastMessage ? dim(` · ${b.lastMessage}`) : ''}`);
    for (const m of ov.mirrors) console.log(`  ${dim('mirror')} ${m.name.padEnd(24)} ${m.state.padEnd(8)} ${m.lastRun ? relativeTime(m.lastRun) : 'never'}`);
    if (!ov.check321.ok) console.log(dim(`\n${ov.check321.advice[0]}`));
  });
}

async function askSecret(prompt: string): Promise<string> {
  const env = process.env.KEEPER_BACKUP_PASSWORD;
  if (env) return env;
  if (!process.stdin.isTTY) throw new Error('Set KEEPER_BACKUP_PASSWORD, or run this in a terminal to type the password.');
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const on = (c: string) => {
      if (c === '\r' || c === '\n' || c === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', on);
        process.stdout.write('\n');
        resolve(s);
      } else if (c === '\u0003') process.exit(130);
      else if (c === '\u007f') s = s.slice(0, -1);
      else s += c;
    };
    process.stdin.on('data', on);
  });
}

async function cmdBackup(a: Args) {
  const sub = a.rest[0] ?? 'list';
  // Disaster recovery: straight from a backup folder (a drive, a NAS share, a synced cloud folder), no app needed.
  if (typeof a.flags.from === 'string') {
    const { BackupRepo } = await import('../core/sync/backup');
    const { FolderStore } = await import('../core/sync/ports');
    const secret = await askSecret('Backup password or recovery key: ');
    const recovery = /^[0-9A-Za-z]{4}(-?[0-9A-Za-z]{4}){7}$/.test(secret.trim());
    const repo = await BackupRepo.open(new FolderStore(a.flags.from), recovery ? { recovery: secret } : { password: secret });
    const snaps = await repo.snapshots();
    if (sub === 'list') {
      return out(snaps, a.flags, () => {
        for (const s of snaps) console.log(`  ${s.name}  ${new Date(s.time).toLocaleString()}  ${s.stats.files.toLocaleString()} files  ${formatBytes(s.stats.bytes)}  ${dim(s.host)}`);
      });
    }
    if (sub === 'restore') {
      const name = typeof a.flags.snapshot === 'string' ? a.flags.snapshot : snaps[0]?.name;
      if (!name) throw new Error('This backup has no snapshots yet.');
      const to = typeof a.flags.to === 'string' ? a.flags.to : path.join(home, 'Restored', name.slice(0, 10));
      const include = typeof a.flags.include === 'string' ? a.flags.include.split(',') : undefined;
      const spin = progress('Restoring');
      const r = await repo.restore(name, to, { include, onProgress: (p) => spin(`${p.files} files, ${formatBytes(p.bytes)}`) });
      spin.done('Restored');
      return console.log(`Restored ${r.files.toLocaleString()} files (${formatBytes(r.bytes)}) to ${to}${r.skipped.length ? dim(` · ${r.skipped.length} already there, left alone`) : ''}`);
    }
    if (sub === 'verify') {
      const r = await repo.verify({ full: !!a.flags.full });
      return console.log(r.ok ? `The backup is fine (${r.checked} pieces checked).` : `Problems:\n  ${r.problems.join('\n  ')}`);
    }
    throw new Error('With --from: keeper backup list | restore | verify --from <folder>');
  }
  const ov = await appCall<import('../core/api-sync').SyncOverview>('overview');
  const find = (q?: string) => {
    const b = q ? ov.backups.find((x) => x.id === q || x.name.toLowerCase() === q.toLowerCase()) : ov.backups[0];
    if (!b) throw new Error(q ? `No backup called “${q}”. See: keeper backup list` : 'No backups set up yet. Add one in Keeper → Sync & Backup.');
    return b;
  };
  if (sub === 'list') {
    return out(ov.backups, a.flags, () => {
      for (const b of ov.backups) console.log(`  ${b.name.padEnd(28)} → ${b.destLabel}  ${dim(`${b.schedule} · last ${b.lastRun ? relativeTime(b.lastRun) : 'never'}${b.lastMessage ? ` · ${b.lastMessage}` : ''}`)}`);
      if (!ov.backups.length) console.log(dim('No backups set up yet.'));
    });
  }
  if (sub === 'run') {
    const b = find(a.rest[1]);
    await appCall('runBackup', b.id);
    return console.log(`Backing up “${b.name}” now; see progress in Keeper.`);
  }
  if (sub === 'restore') {
    const b = find(a.rest[1]);
    const snaps = await appCall<{ name: string; time: number }[]>('snapshots', b.id);
    const name = typeof a.flags.snapshot === 'string' ? a.flags.snapshot : snaps[0]?.name;
    if (!name) throw new Error('This backup has no snapshots yet.');
    const r = await appCall<{ files: number; bytes: number; target: string }>('restore', b.id, name, { target: typeof a.flags.to === 'string' ? a.flags.to : undefined, include: typeof a.flags.include === 'string' ? a.flags.include.split(',') : undefined });
    return console.log(`Restored ${r.files.toLocaleString()} files (${formatBytes(r.bytes)}) to ${r.target}`);
  }
  throw new Error('Usage: keeper backup list | run [name] | restore [name] [--snapshot S] [--to DIR] [--include a,b]');
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
    case 'ask': return cmdAsk(a);
    case 'mcp': return cmdMcp();
    case 'acp': return cmdAcp();
    case 'brain': return cmdBrain(a);
    case 'sync': return cmdSync(a);
    case 'backup': case 'backups': return cmdBackup(a);
    case 'link': return cmdLink(a.rest, a.flags, (d, human) => out(d, a.flags, human));
    default: return help();
  }
}

main().catch((e) => {
  console.error(c('31')(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
