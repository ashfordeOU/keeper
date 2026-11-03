#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notarizes a signed Developer ID Keeper.app, tracked by its submission ID so the same app is
// never sent to Apple twice. build/after-sign.cjs runs it for every Developer ID build (the core
// and the full edition, in the release workflow and locally), after signing and before
// electron-builder makes the dmg and zip from the app:
//
//   node scripts/notarize-mac.mjs --app release/mac-arm64/Keeper.app --version 1.0.1 --arch arm64 \
//     --edition core [--commit <sha>] [--dir .notary] [--budget-minutes 300 | --deadline <epoch s>]
//
// 1. The app is zipped (ditto -c -k --keepParent) into <dir>/zips and its SHA-256 computed.
// 2. A record in <dir> ({ id, sha256, version, arch, edition, commit, submittedAt, status }) for
//    this exact zip means Apple already has it: no submission, wait on that ID. A record for the
//    same version, processor, edition and commit whose zip is still in <dir>/zips (a re-run: the
//    fresh signature differs byte for byte) puts that very app back in place and waits on its ID.
// 3. Otherwise `notarytool history` is asked for a submission of this zip's name (a submit whose
//    answer was lost), and only then `notarytool submit --no-wait` sends it, once. The record is
//    written before any waiting, and the ID printed in the log and the job summary.
// 4. `notarytool wait` / `notarytool info` until Accepted, Invalid or Rejected, or until the
//    budget (default 300 minutes, or the --deadline the workflow set at the start of the job) is
//    spent. A network error while waiting is retried with backoff and never resubmits.
// 5. Accepted: the ticket is stapled to the app. Invalid or Rejected: `notarytool log` is printed
//    and it stops (never retried). Budget spent: it stops naming the ID; a re-run waits on it.
//
// Credentials: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID from the environment; they
// are passed to notarytool and never printed. macOS only (ditto, xcrun). The decision logic is
// exported for test/notarize-mac.test.ts, which runs it with a stand-in for xcrun.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DIR = path.join(ROOT, '.notary');
export const DEFAULT_BUDGET_MINUTES = 300;
const FINAL = new Set(['Accepted', 'Invalid', 'Rejected']);
/** Errors that waiting longer cannot fix: wrong credentials, an ID Apple does not know. */
const FATAL = /HTTP status code: 40[13]|Unable to authenticate|invalid credentials|does not exist or does not belong|Could not find the submission|No submission with id/i;

export class NotaryError extends Error {}

/** The name the zip is sent under; `notarytool history` finds a lost submission by it. */
export function submissionName({ version, arch, edition, sha256 }) {
  return `Keeper-${version}-${arch}-${edition}-${sha256.slice(0, 12)}.zip`;
}

const recordFile = (r) => `${r.version}-${r.arch}-${r.edition}-${r.sha256.slice(0, 12)}.json`;

/** Every record in dir (unreadable files are skipped). */
export function readRecords(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    try {
      const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (r && typeof r.id === 'string' && typeof r.sha256 === 'string') out.push(r);
    } catch {
      /* not a record */
    }
  }
  return out;
}

export function writeRecord(dir, record) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, recordFile(record));
  writeFileSync(`${file}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  return file;
}

/** Where the zip that was sent for a record is kept (named as Apple knows it). */
export const zipPath = (dir, record) => path.join(dir, 'zips', submissionName(record));

/**
 * What to do with this app (pure). `wait`: Apple already has these exact bytes. `restore`: a
 * re-run of the same commit; put the app that was sent back in place and wait on its ID. `submit`:
 * nothing matches (`superseded` names a submission for this commit whose app is gone).
 */
export function decide({ sha256, version, arch, edition, commit, records, hasZip }) {
  const latest = (list) => [...list].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))[0];
  const same = records.filter((r) => r.version === version && r.arch === arch);
  const exact = latest(same.filter((r) => r.sha256 === sha256));
  if (exact) return { action: 'wait', record: exact };
  const earlier = commit ? same.filter((r) => r.edition === edition && r.commit === commit) : [];
  const restorable = latest(earlier.filter((r) => hasZip(r)));
  if (restorable) return { action: 'restore', record: restorable };
  return { action: 'submit', superseded: latest(earlier) };
}

/** The status in notarytool's JSON output, or undefined. */
export function parseStatus(text) {
  try {
    const j = JSON.parse(String(text).trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? String(text));
    return typeof j.status === 'string' ? j.status : undefined;
  } catch {
    const m = /^\s*status:\s*(Accepted|Invalid|Rejected|In Progress)\s*$/im.exec(String(text));
    return m?.[1];
  }
}

const parseJson = (text) => {
  try {
    return JSON.parse(String(text).trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? '');
  } catch {
    return undefined;
  }
};

/** Backoff after the nth network error in a row: 30 s, 1, 2, 4, 8 minutes, then 10 minutes. */
export const backoffMs = (n) => Math.min(30_000 * 2 ** Math.max(0, n - 1), 600_000);

/**
 * Waits on one submission until Apple decides or the deadline passes; never submits.
 * Returns { status } with Accepted, Invalid, Rejected or 'timeout'.
 */
export async function waitForResult({ id, deadline, notarytool, now = Date.now, sleep, log = () => {}, chunkMs = 60 * 60_000 }) {
  let failures = 0;
  for (;;) {
    const left = deadline - now();
    if (!(left > 0)) return { status: 'timeout' };
    const minutes = Math.max(1, Math.floor(Math.min(left, chunkMs) / 60_000));
    const w = await notarytool(['wait', id, '--timeout', `${minutes}m`, '--output-format', 'json']);
    let status = parseStatus(w.stdout);
    let out = `${w.stdout}\n${w.stderr}`;
    if (!FINAL.has(status ?? '')) {
      const i = await notarytool(['info', id, '--output-format', 'json']);
      status = parseStatus(i.stdout) ?? status;
      out += `\n${i.stdout}\n${i.stderr}`;
    }
    if (status && FINAL.has(status)) return { status };
    if (FATAL.test(out)) throw new NotaryError(`notarytool refused submission ${id}: ${out.trim().split('\n').filter(Boolean).pop()}`);
    if (status) {
      failures = 0;
      log(`Submission ${id}: ${status}`);
      continue;
    }
    failures++;
    const pause = Math.min(backoffMs(failures), Math.max(0, deadline - now()));
    log(`Submission ${id}: no answer from Apple (network, try ${failures}); asking again in ${Math.round(pause / 1000)} s, without sending again`);
    await sleep(pause);
  }
}

/** Runs a command; resolves { code, stdout, stderr } (never rejects on a non-zero exit). */
export function runCommand(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` }));
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function sha256File(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

/**
 * The whole flow for one app. `run(cmd, args)` runs ditto and xcrun (a stand-in in tests);
 * `credentials` are appended to every notarytool call and never logged.
 */
export async function notarizeApp({
  app, version, arch, edition, commit = '', dir = DEFAULT_DIR, deadline, credentials, run = runCommand,
  now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log, summary = () => {},
}) {
  if (!existsSync(app)) throw new NotaryError(`no app at ${app}`);
  const notarytool = (args) => run('xcrun', ['notarytool', ...args, ...credentials]);
  mkdirSync(path.join(dir, 'zips'), { recursive: true });

  // 1. The zip Apple gets, and its hash.
  for (const f of readdirSync(path.join(dir, 'zips')).filter((n) => n.startsWith('sending-'))) rmSync(path.join(dir, 'zips', f), { force: true });
  const tmp = path.join(dir, 'zips', `sending-${process.pid}.zip`);
  const z = await run('ditto', ['-c', '-k', '--keepParent', app, tmp]);
  if (z.code !== 0) throw new NotaryError(`ditto could not zip ${app}: ${z.stderr.trim()}`);
  const sha256 = await sha256File(tmp);
  log(`${path.basename(app)} (${edition}, ${arch}): SHA-256 ${sha256}`);

  // 2. A submission for it already?
  const choice = decide({ sha256, version, arch, edition, commit, records: readRecords(dir), hasZip: (r) => existsSync(zipPath(dir, r)) });
  let record;
  if (choice.action === 'wait') {
    record = choice.record;
    rmSync(tmp, { force: true });
    log(`Apple already has this exact app: submission ${record.id} (sent ${record.submittedAt}); waiting on it, nothing is sent`);
  } else if (choice.action === 'restore') {
    record = choice.record;
    rmSync(tmp, { force: true });
    log(`This commit's ${edition} app was sent before as submission ${record.id} (${record.submittedAt}); putting that app back and waiting on it, nothing is sent`);
    rmSync(app, { recursive: true, force: true });
    const x = await run('ditto', ['-x', '-k', zipPath(dir, record), path.dirname(app)]);
    if (x.code !== 0 || !existsSync(app)) throw new NotaryError(`could not put back the app of submission ${record.id}: ${x.stderr.trim()}`);
  } else {
    // 3. Send it once, unless history shows it was sent and the answer was lost.
    if (choice.superseded) log(`::warning title=Notarization::submission ${choice.superseded.id} for this commit cannot be reused (its app is no longer in ${dir}); this newly signed app gets its own submission`);
    const name = submissionName({ version, arch, edition, sha256 });
    // Kept under the name notarytool sends it as, so a re-run can put this very app back.
    const zip = zipPath(dir, { version, arch, edition, sha256 });
    renameSync(tmp, zip);
    let id;
    for (let t = 1; ; t++) {
      const h = await notarytool(['history', '--output-format', 'json']);
      const list = parseJson(h.stdout)?.history;
      if (Array.isArray(list)) {
        id = list.filter((s) => s.name === name).sort((a, b) => String(b.createdDate).localeCompare(String(a.createdDate)))[0]?.id;
        break;
      }
      if (FATAL.test(`${h.stdout}\n${h.stderr}`) || t >= 3) throw new NotaryError(`notarytool history did not answer, so nothing was sent (a re-run tries again): ${h.stderr.trim().split('\n').pop() ?? ''}`);
      await sleep(backoffMs(t));
    }
    if (id) log(`Apple already has ${name} as submission ${id} (its answer was lost); waiting on it, nothing is sent`);
    else {
      const s = await notarytool(['submit', zip, '--no-wait', '--output-format', 'json']);
      id = parseJson(s.stdout)?.id;
      if (s.code !== 0 || typeof id !== 'string') throw new NotaryError(`notarytool submit failed; nothing is recorded, and a re-run looks for ${name} in notarytool history before sending again: ${s.stderr.trim().split('\n').pop() ?? ''}`);
    }
    record = { id, sha256, version, arch, edition, commit, submittedAt: new Date(now()).toISOString(), status: 'In Progress' };
    const file = writeRecord(dir, record);
    log(`Notarization submission ${id} recorded in ${path.relative(process.cwd(), file)}`);
  }
  log(`::notice title=Notarization ${edition} ${arch}::submission ${record.id}`);
  summary(`- Notarization, ${edition} edition, ${arch}: submission \`${record.id}\` (${choice.action === 'submit' ? 'sent in this run' : 'sent before; waited on, not sent again'})`);

  // 4. Wait.
  const { status } = await waitForResult({ id: record.id, deadline, notarytool, now, sleep, log });
  if (status === 'timeout') {
    throw new NotaryError(`Apple has not finished submission ${record.id} within the notarization budget. Re-run the failed job: it waits on ${record.id} again and sends nothing new (xcrun notarytool info ${record.id} shows where it stands).`);
  }
  writeRecord(dir, { ...record, status });
  if (status !== 'Accepted') {
    const l = await notarytool(['log', record.id]);
    log(`notarytool log ${record.id}:\n${l.stdout || l.stderr}`);
    throw new NotaryError(`Apple's answer for submission ${record.id} is ${status} (log above); it is not sent again. Fix what the log names and release a new commit.`);
  }

  // 5. Staple (the ticket comes from Apple's servers: retried, it sends nothing).
  log(`Submission ${record.id}: Accepted; stapling the ticket to ${path.basename(app)}`);
  for (let t = 1; ; t++) {
    const s = await run('xcrun', ['stapler', 'staple', app]);
    if (s.code === 0) break;
    if (t >= 6) throw new NotaryError(`stapler could not staple submission ${record.id}'s ticket: ${s.stdout}${s.stderr}`.trim());
    log(`stapler: no ticket yet (try ${t}); trying again`);
    await sleep(backoffMs(t));
  }
  const v = await run('xcrun', ['stapler', 'validate', app]);
  if (v.code !== 0) throw new NotaryError(`the stapled ticket does not validate: ${v.stdout}${v.stderr}`.trim());
  return { id: record.id, sha256: record.sha256, status, action: choice.action };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new NotaryError(`unexpected ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}

/** The deadline in ms: --deadline / KEEPER_NOTARY_DEADLINE (epoch seconds), else now + the budget. */
export function deadlineFrom(o, env, now = Date.now()) {
  const at = Number(o.deadline ?? env.KEEPER_NOTARY_DEADLINE);
  if (Number.isFinite(at) && at > 0) return at * 1000;
  const minutes = Number(o['budget-minutes'] ?? env.KEEPER_NOTARY_BUDGET_MINUTES ?? DEFAULT_BUDGET_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new NotaryError('the notarization budget must be a number of minutes');
  return now + minutes * 60_000;
}

async function main(argv) {
  const o = args(argv);
  for (const k of ['app', 'version', 'arch', 'edition']) if (!o[k]) throw new NotaryError(`--${k} is required`);
  const env = process.env;
  const missing = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].filter((k) => !env[k]);
  if (missing.length) throw new NotaryError(`${missing.join(', ')} not set`);
  const summaryFile = env.GITHUB_STEP_SUMMARY;
  const r = await notarizeApp({
    app: path.resolve(o.app), version: o.version, arch: o.arch, edition: o.edition, commit: o.commit ?? env.KEEPER_NOTARY_COMMIT ?? '',
    dir: path.resolve(o.dir ?? env.KEEPER_NOTARY_DIR ?? DEFAULT_DIR), deadline: deadlineFrom(o, env),
    credentials: ['--apple-id', env.APPLE_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', env.APPLE_TEAM_ID],
    summary: (line) => summaryFile && appendFileSync(summaryFile, `${line}\n`),
  });
  console.log(`✓ ${path.basename(o.app)}: notarized (submission ${r.id}) and stapled`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(process.env.GITHUB_ACTIONS ? `::error title=Notarization::${msg}` : `notarize-mac: ${msg}`);
    process.exitCode = 1;
  });
}
