// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// keeper — the command-line side of Keeper. Same engine as the app, for
// terminals, servers and scripts. Read-only unless you pass --yes.

import { cmdLink } from './link';
import { cmdRemote } from './remote';
import { cmdMesh } from './mesh';
import { cmdRdc } from './rdc';
import { cmdAgentsRunning, cmdContainers, cmdDev, cmdHistory, cmdVolume, cmdKill, cmdPorts, cmdProcess, cmdPs, cmdSensors, cmdTop, MONITOR_HELP } from './monitor';
import { cmdDisplay, cmdStage } from './stage';
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
import { scanAgentSessions } from '../core/island-scan';
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

/** `keeper awake` flags that take a value (`--for 2h`, `--while-app Zoom`). */
const AWAKE_VALUE_FLAGS = ['for', 'until', 'minutes', 'while-app', 'while-file', 'while-folder', 'while-cpu', 'while-usb', 'while-wifi', 'while-drive', 'end-below'];
/** `keeper rdc` flags that take a value (`--name "Office PC"`, `--via-link Desk`). */
const RDC_VALUE_FLAGS = ['name', 'folder', 'format', 'ports', 'password', 'via-link', 'port', 'timeout'];

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      // `keeper tool …` takes --key value for every option (put options after the files).
      else if (argv[i + 1] && !argv[i + 1].startsWith('--') && (['in', 'limit', 'min'].includes(k) || (['ps', 'top', 'history'].includes(argv[0]) && ['sort', 'hours'].includes(k)) || argv[0] === 'tool' || argv[0] === 'convert' || (argv[0] === 'awake' && AWAKE_VALUE_FLAGS.includes(k)) || (argv[0] === 'tracks' && ['from', 'to', 'format', 'out'].includes(k)) || (argv[0] === 'rdc' && RDC_VALUE_FLAGS.includes(k)) || (argv[0] === 'stage' && ['preset', 'minutes', 'for'].includes(k)) || (['cues', 'cue'].includes(argv[0]) && ['app', 'site', 'page', 'title', 'filter', 'q'].includes(k)) || (['dictation', 'dictate', 'meeting', 'meetings'].includes(argv[0]) && ['title', 'id', 'format', 'query'].includes(k)))) flags[k] = argv[++i];
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

/**
 * keeper term … / keeper hub …: the same tools agents use, from a shell or a
 * script (as the person, or as an agent when KEEPER_AGENT_TOKEN is set).
 *   keeper term run "npm test"        keeper term list        keeper term read <id>
 *   keeper hub agents                 keeper hub send <agent> <text>
 *   keeper hub post <room> <text>     keeper hub tasks        keeper hub <tool> --args '{"…":…}'
 */
async function cmdAgentTool(kind: 'term' | 'hub', a: Args) {
  const [sub, ...rest] = a.rest;
  if (!sub) throw new Error(kind === 'term' ? 'Usage: keeper term run "<command>" | list | read <id> | close <id> | <tool> --args \'{json}\'' : 'Usage: keeper hub agents | send <agent> <text> | post <room> <text> | inbox | tasks | <tool> --args \'{json}\'');
  const alias: Record<string, string> = { agents: 'list_agents', ls: 'list', task: 'post_task' };
  const name = `${kind}_${alias[sub] ?? sub}`;
  let args: Record<string, unknown> = {};
  if (typeof a.flags.args === 'string') args = JSON.parse(a.flags.args);
  else if (name === 'term_run') args = { session: typeof a.flags.session === 'string' ? a.flags.session : 'new', command: rest.join(' ') };
  else if (['term_read', 'term_close', 'term_snapshot'].includes(name)) args = { session: rest[0] };
  else if (name === 'term_write') args = { session: rest[0], text: rest.slice(1).join(' ') + '\r' };
  else if (name === 'hub_send') args = { to: rest[0], text: rest.slice(1).join(' ') };
  else if (name === 'hub_post') args = { room: rest[0], text: rest.slice(1).join(' ') };
  else if (name === 'hub_read') args = { room: rest[0] };
  else if (name === 'hub_post_task') args = { title: rest.join(' ') };
  else if (['hub_claim'].includes(name)) args = { task_id: rest[0] };
  else if (name === 'hub_complete') args = { task_id: rest[0], result: rest.slice(1).join(' ') };
  const app = await connectToApp();
  if (!app) throw new Error('Keeper is not running. Open the Keeper app first.');
  const r = (await app.call('keeper/agent-tool', { name, args, agent: process.env.KEEPER_AGENT_TOKEN, session: process.env.KEEPER_SESSION })) as { text: string; isError?: boolean; structured?: unknown };
  app.close();
  out(r.structured ?? r, a.flags, () => console.log(r.text));
  if (r.isError) process.exitCode = 1;
}

/** MCP over stdio for AI apps: proxies to the running app, or serves the saved index read-only. */
async function cmdMcp() {
  const app = await connectToApp();
  if (app) {
    // Requests still waiting for their answer: when the agent closes its end, finish these first
    // (a screenshot or a question to the AI can take a while).
    const waiting = new Set<string>();
    const idOf = (line: string): string | undefined => {
      try {
        const m = JSON.parse(line) as { id?: string | number; method?: string };
        return m.id !== undefined && m.id !== null ? String(m.id) : undefined;
      } catch {
        return undefined;
      }
    };
    let drained: (() => void) | null = null;
    const send = app.raw((line) => {
      process.stdout.write(line + '\n');
      const id = idOf(line);
      if (id !== undefined) waiting.delete(id);
      if (!waiting.size) drained?.();
    });
    const forward = (line: string) => {
      const id = idOf(line);
      if (id !== undefined && /"method"\s*:/.test(line)) waiting.add(id);
      send(line);
    };
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => {
      buf += c;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) forward(line);
      }
    });
    await new Promise<void>((r) => process.stdin.on('end', () => {
      if (buf.trim()) forward(buf);
      const done = () => setTimeout(r, 50);
      if (!waiting.size) return done();
      drained = done;
      // Never hang for ever on an answer that will not come.
      setTimeout(done, 300_000).unref();
    }));
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

/** Every Convert tool from the command line, with the same engine as the app (pages are drawn with poppler when installed). */
async function cmdTool(a: Args) {
  const { TOOL_INFO } = await import('../core/convert-types');
  // keeper convert <files…> --to <format>: any file to another format.
  if (typeof a.flags.to === 'string' || (a.rest[0] && !(a.rest[0] in TOOL_INFO) && a.rest[0] !== 'list' && existsSync(a.rest[0]))) {
    const { targetsFor } = await import('../core/filekit/matrix');
    if (typeof a.flags.to !== 'string') {
      const t = targetsFor(path.extname(a.rest[0]).slice(1));
      return out(t, a.flags, () => console.log(t.length ? `${path.basename(a.rest[0])} can become:\n${t.map((x) => `  ${x.format.padEnd(8)} ${x.label}${x.engine ? dim(` (uses ${x.engine})`) : ''}`).join('\n')}\n\nkeeper convert ${a.rest[0]} --to ${t[0]?.format ?? 'pdf'}` : 'Keeper cannot convert this kind of file yet'));
    }
    a.rest.unshift('convert.to');
    a.flags.format = a.flags.to;
    delete a.flags.to;
  }
  const [name, ...files] = a.rest;
  if (!name || name === 'list') {
    const rows = Object.entries(TOOL_INFO).map(([id, t]) => ({ id, category: t.category, label: t.label, description: t.description }));
    return out(rows, a.flags, () => {
      let cat = '';
      for (const r of rows) {
        if (r.category !== cat) console.log(`\n${bold(r.category)}`);
        cat = r.category;
        console.log(`  ${r.id.padEnd(20)} ${r.label} — ${dim(r.description)}`);
      }
    });
  }
  if (!(name in TOOL_INFO)) throw new Error(`No tool called ${name}; see keeper tool list`);
  if (a.flags.help) return console.log(`${name}: ${TOOL_INFO[name as keyof typeof TOOL_INFO].description}\nOptions are passed as --key value, e.g. --format mp3, --words "a,b", --password secret, --out ./folder`);
  if (!files.length) throw new Error(`Usage: keeper tool ${name} <files…> [--option value]`);
  // Options: numbers and booleans become numbers and booleans; --json '{…}' sets anything else.
  const op: Record<string, unknown> = { tool: name };
  for (const [k, v] of Object.entries(a.flags)) {
    if (['json', 'out', 'yes'].includes(k)) continue;
    op[k] = v === true ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : v;
  }
  if (typeof a.flags.json === 'string') Object.assign(op, JSON.parse(a.flags.json));
  const { Converter } = await import('../electron/services/convert');
  const conv = new Converter({ modelsDir: path.join(os.homedir(), '.cache', 'keeper', 'models'), onProgress: tty ? (f, phase) => process.stderr.write(`\r${dim(`${phase} ${Math.round(f * 100)}%`)}   `) : undefined });
  const r = await conv.run({ op: op as never, inputs: files.map((f) => path.resolve(f)), outDir: typeof a.flags.out === 'string' ? path.resolve(a.flags.out) : undefined });
  if (tty) process.stderr.write('\r\x1b[K');
  out(r, a.flags, () => {
    if (r.message) console.log(r.message);
    for (const o of r.outputs) console.log(o);
    for (const c of r.checksums ?? []) console.log(`${c.hash}  ${c.path}`);
    for (const f of r.failed ?? []) console.log(`${f.path}: ${f.reason}`);
    if (r.details) console.log(r.details);
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
  keeper agents              Status of Claude Code / Codex sessions on this computer (--running: every agent and model server running now)
  keeper convert <files> --to <format>
                             Any file to another format: keeper convert notes.epub --to pdf
                             (without --to: what the file can become)
  keeper tool list           Every conversion tool (video, audio, pictures, PDF, documents, files)
  keeper tool <name> <files> Run one: keeper tool pdf.redact contract.pdf --words "Jane Doe"
                             options as --key value (see keeper tool <name> --help); results go to a new folder
  keeper ask <question>      Ask about your files with the AI chosen in Keeper (cites files)
  keeper search --semantic   Search Keeper's brain by meaning (--brain: words inside files too)
  keeper brain               What Keeper's brain has read
  keeper mcp                 Serve Keeper to AI apps over MCP (stdio)
  keeper acp                 Keeper as an agent for editors (Agent Client Protocol, stdio)
  keeper term run "<cmd>"    Run in an agent terminal; also list, read <id>, close <id>, write <id> <text>
  keeper hub agents          The agent hub: agents, send <agent> <text>, post <room> <text>, inbox, tasks
  keeper ask --plain "…"     Just the answer, as text (for Shortcuts and Siri)
  keeper link [status|devices|invite|pair|send|check|forward]
  keeper remote [list|connect|help|exec|ssh-proxy|wake|send|forward|screenshot|info|lock|sleep|restart|log]
                             Keeper Link: your paired devices, files and ports between them
  keeper rdc list|connect <name|uri> [--external]|add <uri> [--name …]|import <file>|export|probe <host>
  keeper rdc host status|enable rdp|enable vnc|disable …|forward <name> --via-link <device>
                             Remote Desktops: RDP, VNC, SSH and more, from any terminal
  keeper mesh [up|down|status|peers|ip [device]|ping <device>|exit-node <device|off>|routes advertise <cidr>|rules …]
                             Keeper Mesh: a WireGuard network between your devices
  keeper sync [status|pause|resume]
                             Folders synced between your devices, backups and mirrors
  keeper stage [on|off|toggle|status|extend|presets|journal|detect|support] [--preset Recording] [--now]
  keeper display [list] | set ID brightness 60 | inputs ID | input ID 0x11 | up|down brightness|volume
  keeper cues [list|add <text>|done ID|snooze ID 1h|search <words>|templates|run ID] [--app A] [--site S] [--filter overdue]
                             Notes and checklists that come back in an app, on a site or at a time
  keeper awake [on|off|toggle|status|extend|blockers|stats] [--for 2h | --until 18:30] [--while-app Name]
  keeper dictation [start|stop|toggle|cancel|status|history|stats] [--query words]
  keeper meeting [start|stop|pause|resume|live|list|export|notes] [--title T] [--id ID] [--format md|srt|vtt|txt]
  keeper ambience [status|vibes|vibe <name>|next|prev|surprise|scenes|scene <id>|pause|play|sound rain=0.6|stop|sleep <min>|still|restore]
                             Wallpaper, vibes and ambient sound
              [--while-file path] [--while-cpu 50] [--while-audio] [--allow-display-sleep] [--closed-lid]
  keeper tracks import <file>…           add GPX, FIT, TCX, KML, GeoJSON, Google Timeline or Apple Health files
  keeper tracks list                      your activities and tracks
  keeper tracks export --from D --to D --format gpx|kml|geojson|csv [--out file]
  keeper tracks where <device>            where a device, item or person was last seen
  keeper fw [status|rules|alerts|log [n]|profile [id]|silent allow|deny|off]
  keeper fw allow|deny <host or address> [port] [--app /path]
                             The firewall: its state, rules, alerts and quick rules
  keeper backup list|run|restore [name] [--snapshot S] [--to DIR] [--include a,b]
  keeper backup list|restore|verify --from <folder>
                             Open a backup straight from a drive or folder, without the app
${MONITOR_HELP}
${bold('Options')}
  --in <folders>   comma-separated folders instead of Desktop, Documents, Downloads, …
  --json           machine-readable output
  --limit <n>      how many results to show
  --hidden         include hidden files
  --yes, -y        actually make changes (everything else is a dry run)

Free to use. Source-available under the PolyForm Shield License 1.0.0 — see LICENSE.md.`);
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

/** keeper awake [on|off|toggle|status|extend|blockers|stats] [--for 2h] [--until 18:30] [--while-app Zoom] [--allow-display-sleep] [--closed-lid] … */
/** keeper cues list | add <text> [--app A] [--site S] | done <id> | snooze <id> [1h] | search <words> | templates | run <id> */
async function cmdCues(a: Args) {
  const app = await connectToApp();
  if (!app) throw new Error('Keeper is not running. Open the Keeper app first.');
  let r: unknown;
  try {
    r = await app.call('keeper/cues', { cmd: a.rest[0] ?? 'list', args: a.rest.slice(1), ...a.flags });
  } finally {
    app.close();
  }
  out(r, a.flags, () => {
    type Row = { id: string; title: string; places?: string[]; due?: string; done?: boolean; name?: string; steps?: number };
    const list: Row[] = Array.isArray(r) ? (r as Row[]) : [r as Row];
    if (!list.length) return console.log('No cues.');
    for (const x of list) {
      if (x.name) { console.log(`  ${x.id}  ${bold(x.name)}${dim(` · ${x.steps ?? 0} steps`)}`); continue; }
      const where = [...(x.places ?? []), x.due ? `due ${new Date(x.due).toLocaleString()}` : ''].filter(Boolean).join(' · ');
      console.log(`  ${x.id}  ${x.done ? dim(x.title) : bold(x.title)}${where ? dim(` · ${where}`) : ''}`);
    }
  });
}

// ---------------------------------------------------------------- voice (dictation and meetings; VOICE)
async function cmdVoice(a: Args, kind: 'dictation' | 'meeting') {
  const app = await connectToApp();
  if (!app) throw new Error('Keeper is not running. Open the Keeper app first.');
  const sub = a.rest[0] ?? (kind === 'dictation' ? 'toggle' : 'live');
  const cmd = kind === 'dictation' ? sub : sub === 'list' ? 'meetings' : `meeting-${sub}`;
  let r: unknown;
  try {
    r = await app.call('keeper/voice', { cmd, ...a.flags });
  } finally {
    app.close();
  }
  out(r, a.flags, () => {
    if (typeof r === 'string') return void process.stdout.write(r);
    if (sub === 'history') for (const t of r as { at: number; app?: string; text: string }[]) console.log(`${dim(relativeTime(t.at))} ${bold(t.app ?? '')} ${t.text}`);
    else if (sub === 'list') for (const m of r as { id: string; title: string; startedAt: number; durationMs: number }[]) console.log(`${m.id.padEnd(22)} ${relativeTime(m.startedAt).padEnd(14)} ${String(Math.round(m.durationMs / 60_000)).padStart(3)} min  ${m.title}`);
    else if (sub === 'stats') { const s = r as { words: number; takes: number; minutesSaved: number }; console.log(`${s.words} words in ${s.takes} takes · about ${Math.round(s.minutesSaved)} min saved`); }
    else if (sub === 'live' && r && typeof r === 'object') { const m = r as { title: string; utterances: { text: string; track: string }[] }; console.log(bold(m.title)); for (const u of m.utterances) console.log(`  ${u.track === 'mic' ? 'You' : 'Others'}: ${u.text}`); }
    else if (r === null) console.log(kind === 'meeting' ? 'Nothing is being recorded.' : 'Done.');
    else { const x = r as { phase?: string; title?: string; id?: string }; console.log(x.phase ? `Dictation: ${x.phase}` : x.title ? `${x.title}${x.id ? dim(` (${x.id})`) : ''}` : 'Done.'); }
  });
}

async function cmdAwake(a: Args) {
  const app = await connectToApp();
  if (!app) throw new Error('Keeper is not running. Open the Keeper app first.');
  let r: unknown;
  try {
    r = await app.call('keeper/awake', { cmd: a.rest[0] ?? 'status', ...a.flags });
  } finally {
    app.close();
  }
  out(r, a.flags, () => {
    const cmd = a.rest[0] ?? 'status';
    if (cmd === 'blockers') {
      const b = r as { list: { who: string; what: string; why?: string }[]; source: string; error?: string };
      if (b.error) console.log(dim(b.error));
      for (const x of b.list) console.log(`  ${x.who.padEnd(24)} ${x.what}${x.why ? dim(` · ${x.why}`) : ''}`);
      if (!b.list.length) console.log('Nothing is keeping this computer awake.');
      return;
    }
    if (cmd === 'stats') {
      const s = r as { sessions: number; totalMs: number; longestMs: number };
      console.log(`${s.sessions} sessions · ${Math.round(s.totalMs / 3_600_000 * 10) / 10} h awake in total · longest ${Math.round(s.longestMs / 60_000)} min`);
      return;
    }
    const s = r as import('../core/api-awake').AwakeStatus;
    if (!s.on) console.log(`${bold('Keep Awake')} is off${s.matching.length ? dim(` · triggers matching: ${s.matching.join(', ')}`) : ''}`);
    else {
      const left = s.session?.endsAt ? ` · ${Math.max(0, Math.round((s.session.endsAt - Date.now()) / 60_000))} min left` : '';
      console.log(`${bold('Keeping awake')} · ${s.session?.reason}${left}`);
      console.log(dim(`  held by ${s.holds.join(', ')}${s.closedDisplay ? ' · lid may be closed' : ''}`));
    }
  });
}

/** keeper tracks import <file>… | list | export --from --to --format gpx [--out f] | where <device> (asks the running app; locations stay encrypted there) */
async function cmdTracks(a: Args) {
  const app = await connectToApp();
  if (!app) throw new Error('Keeper is not running. Open the Keeper app first (Places & Tracks keeps your locations encrypted inside it).');
  const cmd = a.rest[0] ?? 'list';
  let r: unknown;
  try {
    r = await app.call('keeper/tracks', { cmd, args: a.rest.slice(1), cwd: process.cwd(), from: a.flags.from, to: a.flags.to, format: a.flags.format ?? 'gpx', out: a.flags.out });
  } finally {
    app.close();
  }
  if (cmd === 'export' && !a.flags.out && !a.flags.json) {
    process.stdout.write((r as { text: string }).text);
    return;
  }
  out(r, a.flags, () => {
    if (cmd === 'list') {
      const list = r as { name: string; sport: string; start: number; stats: { distanceM: number; movingS: number; elapsedS: number } }[];
      if (!list.length) console.log(dim('No tracks yet. keeper tracks import <file>'));
      for (const t of list) console.log(`${formatDate(t.start)}  ${bold(t.name)}  ${dim(t.sport)}  ${(t.stats.distanceM / 1000).toFixed(1)} km  ${Math.round((t.stats.movingS || t.stats.elapsedS) / 60)} min`);
    } else if (cmd === 'import') {
      const x = r as { imported: { file: string; format: string; tracks: number; visits: number; points: number; photos: number; warnings: string[] }[]; skipped: number };
      for (const i of x.imported) console.log(`${green('✓')} ${i.file} ${dim(`(${i.format})`)}: ${i.tracks} tracks, ${i.visits} visits, ${i.points} positions, ${i.photos} photos${i.warnings.length ? yellow(` · ${i.warnings[0]}`) : ''}`);
      if (x.skipped) console.log(dim(`${x.skipped} already there`));
    } else if (cmd === 'where') {
      const list = r as { name: string; lat: number; lon: number; t: number; place?: string; battery?: number }[];
      if (!list.length) console.log(dim('Nothing by that name. Live sharing may be off.'));
      for (const p of list) console.log(`${bold(p.name)}  ${p.place ?? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`}  ${dim(relativeTime(p.t))}${p.battery !== undefined ? `  ${Math.round(p.battery)}%` : ''}`);
    } else console.log(JSON.stringify(r, null, 2));
  });
}

/** keeper fw status|rules|alerts|log [n]|profile [id]|silent [allow|deny|off]|allow|deny <host|address> [port] [--app path] */
async function cmdFw(a: Args) {
  const app = await connectToApp();
  if (!app) throw new Error('Keeper is not running. Open the Keeper app first.');
  let r: unknown;
  try {
    const args = [...a.rest.slice(1)];
    if (typeof a.flags.app === 'string') args.push('--app', a.flags.app);
    r = await app.call('keeper/fw', { cmd: a.rest[0] ?? 'status', args });
  } finally {
    app.close();
  }
  out(r, a.flags, () => {
    const cmd = a.rest[0] ?? 'status';
    if (cmd === 'status') {
      const s = r as { mode: string; profile: string; enforcement: { active: boolean; backend: string; message?: string }; dns: { running: boolean; port?: number; blocked: number; queries: number }; pending: number };
      console.log(`${bold('Firewall')} · mode ${s.mode} · profile ${s.profile}`);
      console.log(`  Enforcement: ${s.enforcement.active ? `on (${s.enforcement.backend})` : 'off — watching only'}${s.enforcement.message ? dim(` · ${s.enforcement.message}`) : ''}`);
      console.log(`  DNS filter: ${s.dns.running ? `on, port ${s.dns.port} · ${s.dns.blocked}/${s.dns.queries} blocked` : 'off'}`);
      if (s.pending) console.log(`  ${s.pending} connection${s.pending === 1 ? '' : 's'} waiting for an answer (keeper fw alerts)`);
    } else if (cmd === 'rules') {
      for (const g of r as { group: string; enabled: boolean; rules: { verdict: string; app: unknown; host?: string; ip?: string; port?: string; enabled: boolean }[] }[]) {
        console.log(`${bold(g.group)}${g.enabled ? '' : dim(' (off)')}`);
        for (const x of g.rules) console.log(`  ${x.verdict === 'deny' ? 'deny ' : 'allow'} ${typeof x.app === 'string' ? 'any app' : JSON.stringify(x.app)} → ${x.host ?? x.ip ?? 'anywhere'}${x.port ? `:${x.port}` : ''}${x.enabled ? '' : dim(' (off)')}`);
      }
    } else console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
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

/** keeper ambience status|vibes|vibe <name>|next|prev|surprise|scenes|scene <id> [palette]|pause|play|sound rain=0.6 cafe=0.3|stop|sleep <min>|still|restore */
async function cmdAmbience(a: Args) {
  const app = await connectToApp();
  if (!app) throw new Error('Keeper is not running. Open the Keeper app first.');
  let r: unknown;
  try {
    r = await app.call('keeper/ambience', { cmd: a.rest[0] ?? 'status', args: a.rest.slice(1) });
  } finally {
    app.close();
  }
  out(r, a.flags, () => {
    if (Array.isArray(r)) {
      for (const x of r as { id: string; name: string; active?: boolean; category?: string }[]) console.log(`  ${x.active ? bold('●') : ' '} ${x.name.padEnd(22)} ${dim(x.category ?? x.id)}`);
      return;
    }
    const s = r as { vibe?: string | null; wallpaper?: string; playing?: boolean; strategy?: string; sound?: string; ok?: boolean; error?: string; how?: string };
    if (s.ok !== undefined && s.wallpaper === undefined) return console.log(s.ok ? `Desktop picture set${s.how ? dim(` (${s.how})`) : ''}` : `Could not: ${s.error}`);
    console.log(`${bold('Wallpaper')} ${s.wallpaper} ${dim(`· ${s.playing ? 'playing' : 'off or paused'} · ${s.strategy}`)}`);
    console.log(`${bold('Vibe')}      ${s.vibe ?? dim('none')}`);
    console.log(`${bold('Sound')}     ${s.sound}`);
  });
}

/** Ends the process once everything printed has been written (a pipe would otherwise be cut short); the Windows PowerShell helper would keep it open. */
function exitWhenFlushed() {
  process.stdout.write('', () => process.exit(process.exitCode ?? 0));
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.flags.version) return console.log(VERSION);
  if (a.flags.help) return help();
  switch (a.cmd) {
    case 'search': case 'find': return cmdSearch(a);
    case 'tool': case 'convert': return cmdTool(a);
    case 'dupes': case 'duplicates': return cmdDupes(a);
    case 'scan': return cmdScan(a);
    case 'clean': return cmdClean(a);
    case 'stats': return cmdStats(a);
    case 'rules': return cmdRules(a);
    case 'agents': return a.flags.running ? cmdAgentsRunning(a.rest, a.flags, (d, human) => out(d, a.flags, human)) : cmdAgents(a);
    // System monitor (cli/monitor.ts).
    case 'ps': return cmdPs(a.rest, a.flags, (d, human) => out(d, a.flags, human)).then(exitWhenFlushed);
    case 'top': return cmdTop(a.rest, a.flags, (d, human) => out(d, a.flags, human)).then(exitWhenFlushed);
    case 'kill': return cmdKill(a.rest, a.flags, (d, human) => out(d, a.flags, human)).then(exitWhenFlushed);
    case 'process': return cmdProcess(a.rest, a.flags, (d, human) => out(d, a.flags, human)).then(exitWhenFlushed);
    case 'ports': return cmdPorts(a.rest, a.flags, (d, human) => out(d, a.flags, human)).then(exitWhenFlushed);
    case 'dev': return cmdDev(a.rest, a.flags, (d, human) => out(d, a.flags, human)).then(exitWhenFlushed);
    case 'containers': return cmdContainers(a.rest, a.flags, (d, human) => out(d, a.flags, human)).then(exitWhenFlushed);
    case 'volume': return cmdVolume(a.rest, a.flags, (d, human) => out(d, a.flags, human)).then(exitWhenFlushed);
    case 'sensors': return cmdSensors(a.rest, a.flags, (d, human) => out(d, a.flags, human));
    case 'history': return cmdHistory(a.rest, a.flags, (d, human) => out(d, a.flags, human));
    case 'ask': return cmdAsk(a);
    case 'mcp': return cmdMcp();
    // Native messaging host for Keeper's browser extension (started by the browser, not by people).
    case 'browser-host': return (await import('./browser-host')).browserHost();
    case 'term': return cmdAgentTool('term', a);
    case 'hub': return cmdAgentTool('hub', a);
    case 'acp': return cmdAcp();
    case 'brain': return cmdBrain(a);
    case 'sync': return cmdSync(a);
    case 'fw': case 'firewall': return cmdFw(a);
    case 'tracks': case 'places': return cmdTracks(a);
    case 'awake': case 'caffeinate': return cmdAwake(a);
    case 'dictation': case 'dictate': return cmdVoice(a, 'dictation');
    case 'meeting': case 'meetings': return cmdVoice(a, 'meeting');
    case 'cues': case 'cue': return cmdCues(a);
    case 'stage': return cmdStage(a.rest, a.flags, (d, human) => out(d, a.flags, human));
    case 'display': case 'displays': return cmdDisplay(a.rest, a.flags, (d, human) => out(d, a.flags, human));
    case 'ambience': return cmdAmbience(a);
    case 'backup': case 'backups': return cmdBackup(a);
    case 'link': return cmdLink(a.rest, a.flags, (d, human) => out(d, a.flags, human));
    // `keeper remote …` reads its own arguments so `exec <device> -- <command>` stays intact.
    case 'remote': return cmdRemote(process.argv.slice(3).filter((x) => x !== '--json'), (d, human) => out(d, a.flags, human));
    case 'mesh': return cmdMesh(a.rest, a.flags, (d, human) => out(d, a.flags, human));
    case 'rdc': case 'remote-desktop': return cmdRdc(a.rest, a.flags, (d, human) => out(d, a.flags, human));
    default: return help();
  }
}

main().catch((e) => {
  console.error(c('31')(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
