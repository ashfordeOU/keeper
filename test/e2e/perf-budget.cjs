// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper must stay light. Starts the built app (npm run build first) under a
// virtual display with a small home folder, waits until it has read
// everything, then measures a minute of doing nothing:
//
//   processor  all of Keeper's processes together, average, percent of one core
//   memory     proportional set size (shared pages divided fairly), all processes
//
// Linux only (reads /proc). Retries once, because a busy CI machine can spike.
// Usage: xvfb-run -a node test/e2e/perf-budget.cjs   (or set KEEPER_PERF_SECONDS)

// playwright-core is enough to drive Electron (no browsers to download).
const { _electron } = (() => { try { return require('playwright-core'); } catch { return require('playwright'); } })();
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUDGET = {
  // Measured 0.4–1.0 % with every default feature on; budget with room for slow CI machines.
  cpuPct: Number(process.env.KEEPER_PERF_CPU ?? 1.0),
  // Measured about 455 MB (PSS) with a 14,000-file library; +20 %.
  pssMB: Number(process.env.KEEPER_PERF_PSS_MB ?? 550),
};
const SECONDS = Number(process.env.KEEPER_PERF_SECONDS ?? 60);
const ROOT = path.resolve(__dirname, '..', '..');
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

function sample(root) {
  let cpu = 0;
  let pss = 0;
  // The launcher script is not part of Keeper.
  for (const pid of tree(root).filter((p) => p !== root)) {
    try {
      const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      cpu += (+f[11] + +f[12]) / 100;
      pss += +(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/Pss:\s+(\d+)/) ?? [0, 0])[1] * 1024;
    } catch { /* gone */ }
  }
  return { cpu, pss };
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
    await sleep(15_000);
    const a = sample(root);
    await sleep(SECONDS * 1000);
    const b = sample(root);
    return { cpuPct: ((b.cpu - a.cpu) / SECONDS) * 100, pssMB: b.pss / 1048576, files };
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(user, { recursive: true, force: true });
  }
}

(async () => {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await once();
    const ok = r.cpuPct <= BUDGET.cpuPct && r.pssMB <= BUDGET.pssMB;
    console.log(`perf budget (attempt ${attempt}): ${r.files} files, idle processor ${r.cpuPct.toFixed(2)}% (budget ${BUDGET.cpuPct}%), memory ${r.pssMB.toFixed(0)} MB (budget ${BUDGET.pssMB} MB) ${ok ? 'OK' : 'OVER'}`);
    if (ok) process.exit(0);
  }
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
