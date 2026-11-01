// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Command-line options for the Mac test run (run.sh passes them through).

export interface Args {
  quick: boolean;
  only: string[];
  skip: string[];
  dryRun: boolean;
  /** dry run, but drive the real Keeper (useful on Linux to check the app calls) */
  realApp: boolean;
  record: boolean;
  guided: boolean;
  screen: boolean;
  out: string;
  answers?: string;
  runDir?: string;
  packOnly?: string;
  keepTemp: boolean;
  list: boolean;
  help: boolean;
  raw: string[];
}

export const USAGE = `Keeper Mac test run

  ./scripts/mac-test/run.sh [options]

  --quick              a 15-minute smoke test (the most important checks only)
  --only <a,b,…>       only these areas (see --list)
  --skip <a,b,…>       everything except these areas
  --record             also record the whole screen to a video (off by default)
  --no-guided          automatic checks only: no questions, nothing to do by hand
  --no-screen          no whole-screen pictures (Keeper's own windows are still pictured)
  --out <folder>       where the .zip goes (default: your Desktop)
  --keep-temp          keep the throwaway home folder afterwards (for debugging)
  --list               list the areas and stop
  --dry-run            prove the flow without a Mac: macOS commands answer from fixtures
  --real-app           with --dry-run: drive the real Keeper too (Linux, under xvfb)
  --answers <file>     answers for the questions, from a JSON file ({"key": "y", "*": "skip"})
  -h, --help           this help
`;

export function parseArgs(argv: string[]): Args {
  const a: Args = { quick: false, only: [], skip: [], dryRun: false, realApp: false, record: false, guided: true, screen: true, out: '', keepTemp: false, list: false, help: false, raw: argv.slice() };
  const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const val = () => {
      if (x.includes('=')) return x.slice(x.indexOf('=') + 1);
      const v = argv[++i];
      if (v === undefined) throw new Error(`${x} needs a value`);
      return v;
    };
    const flag = x.split('=')[0];
    switch (flag) {
      case '--quick': a.quick = true; break;
      case '--only': a.only.push(...list(val())); break;
      case '--skip': a.skip.push(...list(val())); break;
      case '--dry-run': a.dryRun = true; break;
      case '--real-app': a.realApp = true; break;
      case '--record': a.record = true; break;
      case '--no-guided': a.guided = false; break;
      case '--no-screen': a.screen = false; break;
      case '--out': a.out = val(); break;
      case '--answers': a.answers = val(); break;
      case '--run-dir': a.runDir = val(); break;
      case '--pack-only': a.packOnly = val(); break;
      case '--keep-temp': a.keepTemp = true; break;
      case '--list': a.list = true; break;
      case '-h': case '--help': a.help = true; break;
      case '--skip-build': case '--skip-setup': break; // read by run.sh
      default: throw new Error(`Unknown option ${x} (try --help)`);
    }
  }
  return a;
}
