// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// One Keeper per person, whichever copy starts; test runs apart; helpers never become apps.

import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { handOver, handOverCommand, holdInstanceLock, instancePaths, releaseInstanceLock, runningInstance, type Handover } from '../electron/instance';

const dirs: string[] = [];
afterEach(() => { releaseInstanceLock(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('one Keeper per person', () => {
  it('the lock does not depend on the data folder; test runs have their own', () => {
    const a = instancePaths({}, 'darwin', '/Users/sam', 501);
    const b = instancePaths({ KEEPER_USERDATA: '/elsewhere' }, 'darwin', '/Users/sam', 501);
    expect(a).toEqual(b);
    expect(a.dir).toBe('/Users/sam/Library/Caches/io.github.ashfordeou.keeper');
    const t = instancePaths({ KEEPER_MACTEST_HOME: '/Users/sam/keeper-mac-test/home' }, 'darwin', '/Users/sam', 501);
    expect(t.file).not.toBe(a.file);
    expect(t.socket).not.toBe(a.socket);
    expect(t.dir.startsWith('/Users/sam/keeper-mac-test/home')).toBe(true);
    expect(instancePaths({}, 'darwin', '/Users/ana', 502).socket).not.toBe(a.socket);
    expect(instancePaths({ LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local' }, 'win32', 'C:\\Users\\sam').socket).toMatch(/^\\\\\.\\pipe\\keeper-[0-9a-f]{16}$/);
    expect(instancePaths({ XDG_RUNTIME_DIR: '/run/user/1000' }, 'linux', '/home/sam', 1000).dir).toBe('/run/user/1000/keeper-instance');
    for (const p of [a, t]) expect(p.socket.length).toBeLessThan(104);
  });

  it('a later start hands its command line to the running Keeper', async () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kinst-'));
    dirs.push(dir);
    const p = { dir, file: path.join(dir, 'instance-x.json'), socket: path.join(dir, 'k.sock') };
    const got: Handover[] = [];
    expect(runningInstance(p)).toBeUndefined();
    holdInstanceLock((h) => got.push(h), p);
    expect(JSON.parse(readFileSync(p.file, 'utf8')).pid).toBe(process.pid);
    await new Promise((r) => setTimeout(r, 100));
    // The later start is another process (handOver itself waits synchronously, so it cannot run in this one).
    const [exe, args] = handOverCommand(p, { argv: ['keeper', 'keeper://search?q=tax'], cwd: '/' });
    const code = await new Promise<number>((r) => execFile(exe, args, (e) => r(e ? 1 : 0)));
    expect(code).toBe(0);
    expect(got).toEqual([{ argv: ['keeper', 'keeper://search?q=tax'], cwd: '/' }]);
    releaseInstanceLock(p);
    expect(readdirSync(dir)).not.toContain('instance-x.json');
    // Nobody listening any more: a stale lock is taken over, not obeyed.
    expect(handOver(p, { argv: [], cwd: '/' })).toBe(false);
  });

  it('every Keeper program started as a helper runs as plain Node (no second Dock icon or app)', () => {
    const root = path.resolve(__dirname, '../electron');
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') && files.push(path.join(d, e.name)); };
    walk(root);
    const offenders: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/(spawn|execFile|execFileSync|spawnSync)\(process\.execPath[\s\S]{0,600}?\)/g)) {
        // The watchdog's relaunch of Keeper itself is meant to be the app.
        if (/watchdog\.ts$/.test(f)) continue;
        const around = s.slice(Math.max(0, m.index! - 400), m.index! + m[0].length + 400);
        if (!/ELECTRON_RUN_AS_NODE/.test(around)) offenders.push(`${path.relative(root, f)}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
