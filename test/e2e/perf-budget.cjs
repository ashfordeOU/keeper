// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper must stay light. Starts the built app (npm run build first) under a
// virtual display with a small home folder, waits until it has read
// everything, then measures a minute of doing nothing:
//
//   processor  all of Keeper's processes together, average, percent of one core
//   memory     proportional set size (PSS: shared pages divided between the processes
//              that map them) and private memory (pages only Keeper's processes map),
//              all processes. PSS moves with whatever else shares the same libraries,
//              so both are checked. Private memory still counts library pages no other
//              process happens to map, so the anonymous part (heaps, caches: what Keeper
//              itself allocates) is logged too; it is the figure to compare between runs.
//
// The log lists each process (renderers by the windows they show) with both figures.
// Linux only (reads /proc). Retries once, because a busy CI machine can spike.
// Usage: xvfb-run -a node test/e2e/perf-budget.cjs   (or set KEEPER_PERF_SECONDS)
//        KEEPER_PERF_MODE=minimal …               the Minimal resource mode (checks slow
//                                                 down, no graphics card)
//        KEEPER_PERF_JSON=file                    also appends each run's figures as JSON
//
// For scale (docs/RESILIENCE.md, same machine and method): Dolphin idles at
// about 0.01 % and 68 MB, GNOME Files at about 0.08 % and 228 MB.

// playwright-core is enough to drive Electron (no browsers to download).
const { _electron } = (() => { try { return require('playwright-core'); } catch { return require('playwright'); } })();
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODE = process.env.KEEPER_PERF_MODE === 'minimal' ? 'minimal' : 'balanced';
const BUDGET = {
  // Target 0.5 %. Measured (2,000 files, after two minutes to settle, medians of three):
  // 0.24–0.31 % by default (was 0.40–0.44 %) and 0.20–0.22 % in Minimal mode (was 0.27–0.38 %);
  // a busy machine read up to 0.83 % once, so the budget stays where it was (the test retries once).
  cpuPct: Number(process.env.KEEPER_PERF_CPU ?? (MODE === 'minimal' ? 0.5 : 0.6)),
  // Memory, measured with the old and new builds run in turn on one quiet machine (three runs
  // each; on a busier machine PSS and private memory read lower, because more of Electron's
  // library pages are shared with other processes):
  //                   PSS          private      anonymous
  //   default before  382–473 MB   244–308 MB   259–261 MB
  //   default now     420–448 MB   280–305 MB   204–228 MB
  //   Minimal before  471–483 MB   306–318 MB   259–271 MB
  //   Minimal now     328–400 MB   213–265 MB   184–219 MB
  // Anonymous memory (what Keeper allocates itself) is the steady one, so it has the tight
  // budget; PSS and private memory have room for the spread between machines.
  pssMB: Number(process.env.KEEPER_PERF_PSS_MB ?? (MODE === 'minimal' ? 440 : 500)),
  privMB: Number(process.env.KEEPER_PERF_PRIV_MB ?? (MODE === 'minimal' ? 300 : 340)),
  anonMB: Number(process.env.KEEPER_PERF_ANON_MB ?? (MODE === 'minimal' ? 245 : 255)),
};
const SECONDS = Number(process.env.KEEPER_PERF_SECONDS ?? 60);
// Keeper finishes its first-start work (thumbnails, sources, the meaning index) in the
// minutes after the library is read; idle is measured after that.
const SETTLE = Number(process.env.KEEPER_PERF_SETTLE ?? 120);
// KEEPER_PERF_ROOT runs another build (a copy of an older one, to compare against).
const ROOT = process.env.KEEPER_PERF_ROOT ? path.resolve(process.env.KEEPER_PERF_ROOT) : path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform !== 'linux') {
  console.log('perf budget: Linux only, skipped');
  process.exit(0);
}
if (!process.env.DISPLAY) {
  console.log('perf budget: no display (run under xvfb-run), skipped');
  process.exit(0);
}

function tree(root) {
  const kids = new Map();
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8');
      const ppid = +st.slice(st.lastIndexOf(')') + 2).split(' ')[1];
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(+p);
    } catch { /* gone */ }
  }
  const out = [];
  const walk = (p) => { out.push(p); for (const c of kids.get(p) ?? []) walk(c); };
  walk(root);
  return out;
}

// Proportional set size (shared pages divided between the processes that map them) and
// private memory (pages only this process maps: what quitting it would give back), in bytes.
function memOf(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const kb = (k) => +(s.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) ?? [0, 0])[1] * 1024;
    return { pss: kb('Pss'), priv: kb('Private_Clean') + kb('Private_Dirty'), anon: kb('Anonymous') };
  } catch {
    return { pss: 0, priv: 0, anon: 0 };
  }
}

function sample(root) {
  let cpu = 0;
  let pss = 0;
  let priv = 0;
  let anon = 0;
  const each = new Map();
  // The launcher script is not part of Keeper.
  for (const pid of tree(root).filter((p) => p !== root)) {
    try {
      const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      cpu += (+f[11] + +f[12]) / 100;
      each.set(pid, (+f[11] + +f[12]) / 100);
      const m = memOf(pid);
      pss += m.pss;
      priv += m.priv;
      anon += m.anon;
    } catch { /* gone */ }
  }
  return { cpu, pss, priv, anon, each };
}

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-perf-'));
  const words = 'invoice budget report photo trip notes plan draft meeting receipt project'.split(' ');
  let n = 0;
  for (const d of ['Documents', 'Downloads', 'Desktop', 'Pictures']) {
    for (let s = 0; s < 10; s++) {
      const dir = path.join(home, d, `${words[s % words.length]}-${s}`);
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 50; i++) {
        const ext = ['txt', 'md', 'pdf', 'jpg', 'zip', 'csv'][i % 6];
        fs.writeFileSync(path.join(dir, `${words[i % words.length]} ${i}.${ext}`), ext === 'txt' || ext === 'md' || ext === 'csv' ? words.join(' ').repeat(5) : 'x'.repeat(200));
        n++;
      }
    }
  }
  return { home, files: n };
}

async function once() {
  const { home, files } = makeHome();
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-perf-cfg-'));
  if (MODE === 'minimal') fs.writeFileSync(path.join(user, 'settings.json'), JSON.stringify({ resourceMode: 'minimal' }));
  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules', '.bin', 'electron'),
    args: [ROOT, '--no-sandbox', `--user-data-dir=${user}`],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: user, NODE_OPTIONS: '' },
  });
  try {
    const root = app.process().pid;
    let win;
    for (let i = 0; i < 240 && !win; i++) {
      for (const w of app.windows()) if (/view=app|index\.html$/.test(w.url()) && (await w.$('.sidebar').catch(() => null))) win = w;
      if (!win) await sleep(250);
    }
    if (!win) throw new Error('the main window never appeared');
    // Wait until the library is read and the text in documents is too.
    for (let i = 0; i < 360; i++) {
      const st = await win.evaluate(() => window.keeper.library.status());
      if (!st.indexing && st.files >= files * 0.9 && !st.ocrPending) break;
      await sleep(500);
    }
    await sleep(SETTLE * 1000);
    const a = sample(root);
    await sleep(SECONDS * 1000);
    const b = sample(root);
    // Which process holds what, for the log (renderers are named by the page they show).
    const info = await app.evaluate(({ app: a, webContents }) => ({
      metrics: a.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, name: m.serviceName || m.name || '' })),
      pages: webContents.getAllWebContents().map((w) => ({ pid: w.getOSProcessId(), url: w.getURL() })),
    }));
    const pageOf = (pid) => info.pages.filter((p) => p.pid === pid).map((p) => new URL(p.url).searchParams.get('view') || 'page').join('+');
    const known = new Set(info.metrics.map((m) => m.pid));
    const others = tree(root).filter((p) => p !== root && !known.has(p)).map((pid) => {
      let name = 'process';
      try { name = path.basename(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').find((x) => /\.cjs$/.test(x)) ?? fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()); } catch { /* gone */ }
      return { pid, type: 'Child', name };
    });
    const procs = [...info.metrics, ...others].map((m) => {
      const mem = memOf(m.pid);
      const name = m.type === 'Tab' ? pageOf(m.pid) : m.name;
      return { type: m.type, name, pssMB: mem.pss / 1048576, privMB: mem.priv / 1048576, anonMB: mem.anon / 1048576, cpuPct: (((b.each.get(m.pid) ?? 0) - (a.each.get(m.pid) ?? 0)) / SECONDS) * 100 };
    });
    const parts = procs.map((p) => `${p.type}${p.name ? ` (${p.name})` : ''} ${p.pssMB.toFixed(0)}/${p.privMB.toFixed(0)} MB ${p.cpuPct.toFixed(2)}%`);
    return { cpuPct: ((b.cpu - a.cpu) / SECONDS) * 100, pssMB: b.pss / 1048576, privMB: b.priv / 1048576, anonMB: b.anon / 1048576, files, parts, procs };
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(user, { recursive: true, force: true });
  }
}

(async () => {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await once();
    const ok = r.cpuPct <= BUDGET.cpuPct && r.pssMB <= BUDGET.pssMB && r.privMB <= BUDGET.privMB && r.anonMB <= BUDGET.anonMB;
    console.log(`  per process, proportional/private memory and processor: ${r.parts.join(' · ')}`);
    if (process.env.KEEPER_PERF_JSON) fs.appendFileSync(process.env.KEEPER_PERF_JSON, JSON.stringify({ mode: MODE, attempt, cpuPct: r.cpuPct, pssMB: r.pssMB, privMB: r.privMB, anonMB: r.anonMB, procs: r.procs }) + '\n');
    console.log(`perf budget (${MODE}, attempt ${attempt}): ${r.files} files, idle processor ${r.cpuPct.toFixed(2)}% (budget ${BUDGET.cpuPct}%), memory ${r.pssMB.toFixed(0)} MB proportional (budget ${BUDGET.pssMB} MB), ${r.privMB.toFixed(0)} MB private (budget ${BUDGET.privMB} MB), ${r.anonMB.toFixed(0)} MB anonymous (budget ${BUDGET.anonMB} MB) ${ok ? 'OK' : 'OVER'}`);
    if (ok) process.exit(0);
  }
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
