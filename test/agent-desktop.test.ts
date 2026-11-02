// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// agent-desktop as the computer-use tools' accessibility engine: its JSON
// envelope, its tree in Keeper's shape, stale refs, and falling back to the
// system scripts. The fixtures are the examples in agent-desktop's README and
// docs/json-output.md (v1.0.2, envelope 2.5).

import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, app: { getAppPath: () => '/nowhere', getPath: () => os.tmpdir() } }));
// The built-in engine's scripts: answer "null" (the app says nothing), without starting anything.
const builtinCalls: string[][] = [];
vi.mock('node:child_process', async (orig) => {
  const real = await orig<typeof import('node:child_process')>();
  return {
    ...real,
    spawn: (cmd: string, args: string[]) => {
      builtinCalls.push([cmd, ...args.filter((a) => a.length < 40)]);
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void };
      child.stdout = new EventEmitter();
      child.kill = () => undefined;
      setTimeout(() => { child.stdout.emit('data', Buffer.from('null')); child.emit('close', 0); }, 1);
      return child;
    },
  };
});
// The same on macOS (osascript through run) and Windows (the PowerShell host).
vi.mock('../core/platform', async (orig) => ({
  ...(await orig<typeof import('../core/platform')>()),
  run: async (file: string, args: string[]) => { builtinCalls.push([file, ...args.filter((a) => a.length < 40)]); return { ok: true, stdout: 'null', stderr: '' }; },
}));
vi.mock('../electron/services/ps-host', () => ({
  psRun: async () => { builtinCalls.push(['powershell']); return { ok: true, stdout: 'null', stderr: '' }; },
}));

import {
  actionArgs, AgentDesktop, AgentDesktopError, counterpart, findAgentDesktop, mapSnapshot, MaybeDelivered, parseEnvelope, unwrap, type AdSnapshot, type Runner,
} from '../electron/services/agent-desktop';
import { pressElement, resetAgentDesktop, setAccessibilityEngine, setElementValue, uiTree } from '../electron/services/computer-os';
import { normalizeComputerPolicy, uiTreeText } from '../core/computer';
import { marksFromAx } from '../core/cu/marks';

const README_SNAPSHOT = `{
  "version": "2.5",
  "ok": true,
  "command": "snapshot",
  "data": {
    "app": "Finder",
    "window": { "id": "w-204749", "title": "Downloads" },
    "snapshot_id": "s8f3k2p9",
    "ref_count": 59,
    "complete": true,
    "tree": {
      "role": "window",
      "name": "Downloads",
      "children": [
        { "role": "treeitem", "name": "Documents", "ref_id": "@s8f3k2p9:e8", "available_actions": ["Click"] }
      ]
    }
  }
}`;

const STALE = `{
  "version": "2.5",
  "ok": false,
  "command": "click",
  "error": {
    "code": "STALE_REF",
    "message": "@s8f3k2p9:e7 not found in current RefMap",
    "suggestion": "Re-run a snapshot to obtain fresh refs, then retry with the new ref",
    "recovery": { "strategy": "refresh_snapshot_then_retry_original", "retryable": true, "requires_fresh_snapshot": true },
    "disposition": { "delivery": "not_delivered", "retry": "safe" }
  }
}`;

const CLICKED = '{"version":"2.5","ok":true,"command":"click","data":{"action":"click","disposition":{"delivery":"delivered_unverified","retry":"unsafe"}}}';

/** A settings window like the docs' System Settings example, with bounds. */
function settings(id: string, extra: Partial<AdSnapshot['tree']>[] = []): AdSnapshot {
  return {
    app: 'System Settings', window: { id: 'w-4521', title: 'General' }, snapshot_id: id, ref_count: 3, complete: true,
    tree: {
      role: 'window', name: 'General', bounds: { x: 100, y: 50, width: 800, height: 600 },
      children: [
        { ref_id: `@${id}:e1`, role: 'button', name: 'About', states: ['focused'], bounds: { x: 120, y: 80, width: 80, height: 24 } },
        { role: 'group', children: [
          { role: 'statictext', name: 'Name' },
          { ref_id: `@${id}:e2`, role: 'textfield', value: 'Mac', bounds: { x: 220, y: 120, width: 200, height: 22 } },
          { ref_id: `@${id}:e3`, role: 'textfield', name: 'Password', value: 'hunter2', states: ['secure'], bounds: { x: 220, y: 150, width: 200, height: 22 } },
          { ref_id: `@${id}:e4`, role: 'button', name: 'Apply', states: ['disabled'], bounds: { x: 430, y: 120, width: 60, height: 22 } },
        ] },
        ...extra,
      ],
    } as AdSnapshot['tree'],
  };
}
const env = (data: unknown, command = 'snapshot') => JSON.stringify({ version: '2.5', ok: true, command, data });

describe('agent-desktop envelope', () => {
  it('reads the README snapshot and the docs’ STALE_REF error', () => {
    const s = unwrap(parseEnvelope<AdSnapshot>(README_SNAPSHOT));
    expect(s.snapshot_id).toBe('s8f3k2p9');
    expect(s.tree.children?.[0].ref_id).toBe('@s8f3k2p9:e8');
    try {
      unwrap(parseEnvelope(STALE));
      throw new Error('no throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AgentDesktopError);
      expect((e as AgentDesktopError).code).toBe('STALE_REF');
      expect((e as AgentDesktopError).safe).toBe(true);
    }
  });
  it('takes the envelope after a log line, and refuses what is not one', () => {
    expect(parseEnvelope(`warning: something\n${CLICKED}\n`).command).toBe('click');
    expect(() => parseEnvelope('')).toThrow(AgentDesktopError);
    expect(() => parseEnvelope('{"hello":1}')).toThrow(/unexpected/);
    expect(() => parseEnvelope('{"version":"2.5","ok":false,"command":"click"}')).toThrow(/without saying why/);
  });
  it('an error with unknown delivery is not safe to repeat', () => {
    const e = new AgentDesktopError('x', 'TIMEOUT', { delivery: 'unknown', retry: 'unknown' });
    expect(e.safe).toBe(false);
  });
});

describe('agent-desktop tree → Keeper’s controls', () => {
  it('keeps Keeper’s path ids, the refs beside them, bounds, disabled and hidden secrets', () => {
    const m = mapSnapshot(settings('sAAA1111'));
    expect(m.root.id).toBe('w0');
    expect([...m.refs]).toEqual([['w0/0', '@sAAA1111:e1'], ['w0/1/1', '@sAAA1111:e2'], ['w0/1/2', '@sAAA1111:e3'], ['w0/1/3', '@sAAA1111:e4']]);
    const about = m.root.children![0];
    expect(about).toMatchObject({ id: 'w0/0', role: 'button', name: 'About', x: 120, y: 80, width: 80, height: 24, enabled: true, actionable: true });
    const group = m.root.children![1];
    expect(group.children![2].value).toBeUndefined(); // secure field
    expect(group.children![1].value).toBe('Mac');
    expect(group.children![3].enabled).toBe(false);
    expect(group.actionable).toBeUndefined();
    // What the AI reads: an unnamed field with a ref is listed too.
    const text = uiTreeText(m.root, (x, y) => ({ x, y }));
    expect(text).toContain('[w0/1/1] textfield = “Mac” @320,131');
    expect(text).toContain('[w0/1/3] button Apply @460,131 (disabled)');
    expect(text).not.toContain('hunter2');
  });
  it('marks include elements agent-desktop says can be acted on, whatever their role', () => {
    const m = mapSnapshot(settings('sAAA1111', [{ ref_id: '@sAAA1111:e5', role: 'disclosure', name: 'Advanced', bounds: { x: 120, y: 300, width: 90, height: 20 } }, { ref_id: '@sAAA1111:e6', role: 'scrollarea', bounds: { x: 100, y: 50, width: 800, height: 600 } }]));
    const { marks } = marksFromAx(m.root, { width: 2000, height: 2000 });
    expect(marks.map((x) => x.name)).toContain('Advanced');
    expect(marks.some((x) => x.role === 'scrollarea')).toBe(false);
  });
  it('finds the same control in a fresh snapshot: by place in the tree, or by role and label', () => {
    const old = mapSnapshot(settings('sOLD00001'));
    const fresh = mapSnapshot(settings('sNEW00001'));
    expect(counterpart(fresh, old.root.children![0])).toBe('@sNEW00001:e1');
    // The window gained a control in front: the same button moved in the tree.
    const moved = mapSnapshot({ ...settings('sNEW00002'), tree: { ...settings('sNEW00002').tree, children: [{ ref_id: '@sNEW00002:e9', role: 'link', name: 'Help' }, ...settings('sNEW00002').tree.children!] } });
    expect(counterpart(moved, old.root.children![0])).toBe('@sNEW00002:e1');
    // Gone: nothing to press.
    const gone = mapSnapshot({ ...settings('sNEW00003'), tree: { role: 'window', children: [] } });
    expect(counterpart(gone, old.root.children![0])).toBeUndefined();
  });
  it('builds action arguments with options before "--", so text starting with "-" stays text', () => {
    expect(actionArgs('click', '@s8f3k2p9:e5')).toEqual(['click', '--timeout-ms', '5000', '--', '@s8f3k2p9:e5']);
    expect(actionArgs('set-value', '@s8f3k2p9:e2', { text: '--headed' })).toEqual(['set-value', '--timeout-ms', '5000', '--', '@s8f3k2p9:e2', '--headed']);
    expect(actionArgs('scroll', '@s8f3k2p9:e1', { direction: 'up', amount: 99 })).toEqual(['scroll', '--timeout-ms', '5000', '--direction', 'up', '--amount', '30', '--', '@s8f3k2p9:e1']);
    expect(() => actionArgs('click', '@e5')).toThrow(/Not an agent-desktop ref/);
    expect(() => actionArgs('click', '@s1:e1; rm -rf /')).toThrow();
  });
  it('finds the bundled program, a development copy or KEEPER_AGENT_DESKTOP, never one on PATH', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'keeper-ad-'));
    try {
      mkdirSync(path.join(dir, 'res', 'agent-desktop'), { recursive: true });
      writeFileSync(path.join(dir, 'res', 'agent-desktop', 'agent-desktop'), '');
      mkdirSync(path.join(dir, 'bin'));
      writeFileSync(path.join(dir, 'bin', 'agent-desktop'), '');
      expect(findAgentDesktop({ resourcesPath: path.join(dir, 'res'), env: {}, platform: 'linux' })).toBe(path.join(dir, 'res', 'agent-desktop', 'agent-desktop'));
      expect(findAgentDesktop({ env: { PATH: path.join(dir, 'bin') }, platform: 'linux' })).toBeNull();
      expect(findAgentDesktop({ env: { KEEPER_AGENT_DESKTOP: path.join(dir, 'bin', 'agent-desktop') }, platform: 'linux' })).toBe(path.join(dir, 'bin', 'agent-desktop'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** A stand-in program: answers by command, records what it was asked. */
function fake(answers: Record<string, (args: string[]) => string | 'timeout'>) {
  const calls: string[][] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const run: Runner = async (_bin, args, o) => {
    calls.push(args);
    envs.push(o.env);
    const a = answers[args[0]]?.(args) ?? '';
    if (a === 'timeout') return { stdout: '', code: null, timedOut: true };
    return { stdout: a, code: 0, timedOut: false };
  };
  return { calls, envs, run };
}

const homes: string[] = [];
afterAll(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });
const home = () => { const h = mkdtempSync(path.join(os.tmpdir(), 'keeper-adhome-')); homes.push(h); return path.join(h, 'state'); };

describe('agent-desktop calls', () => {
  it('snapshots with bounds and a private state folder of its own', async () => {
    const f = fake({ snapshot: () => env(settings('sAAA1111')) });
    const h = home();
    const a = new AgentDesktop({ bin: 'x', home: h, run: f.run, env: { AGENT_DESKTOP_SESSION: 'terminal', PATH: '/bin' } });
    const t = await a.snapshot({ maxDepth: 12 });
    expect(t.refs.size).toBe(4);
    expect(f.calls[0]).toEqual(['snapshot', '--compact', '--include-bounds', '--max-depth', '12', '--timeout-ms', '4000']);
    expect(f.envs[0].AGENT_DESKTOP_HOME).toBe(h);
    expect(f.envs[0].AGENT_DESKTOP_SESSION).toBeUndefined();
    expect(f.calls.flat()).not.toContain('--headed');
  });
  it('a stale ref is found again in one fresh snapshot and pressed once', async () => {
    let snaps = 0;
    const f = fake({
      snapshot: () => env(settings(`sNEW0000${++snaps}`)),
      click: (args) => (args.at(-1) === '@sOLD00001:e1' ? STALE : CLICKED),
    });
    const a = new AgentDesktop({ bin: 'x', run: f.run });
    const old = mapSnapshot(settings('sOLD00001'));
    const r = await a.act('click', '@sOLD00001:e1', old.root.children![0]);
    expect(r.fresh?.snapshotId).toBe('sNEW00001');
    expect(f.calls.map((c) => c[0])).toEqual(['click', 'snapshot', 'click']);
    expect(f.calls[2].at(-1)).toBe('@sNEW00001:e1');
  });
  it('never repeats an action that may have landed', async () => {
    const uncertain = '{"version":"2.5","ok":false,"command":"click","error":{"code":"APP_UNRESPONSIVE","message":"x","disposition":{"delivery":"delivery_uncertain","retry":"unsafe"}}}';
    const f = fake({ click: () => uncertain, snapshot: () => env(settings('sNEW00001')) });
    const a = new AgentDesktop({ bin: 'x', run: f.run });
    await expect(a.act('click', '@sOLD00001:e1', mapSnapshot(settings('sOLD00001')).root.children![0])).rejects.toMatchObject({ code: 'APP_UNRESPONSIVE' });
    expect(f.calls.map((c) => c[0])).toEqual(['click']);
  });
  it('a timeout is an error of unknown delivery', async () => {
    const f = fake({ click: () => 'timeout' });
    const a = new AgentDesktop({ bin: 'x', run: f.run });
    await expect(a.act('click', '@s1:e1', undefined)).rejects.toMatchObject({ code: 'TIMEOUT', safe: false });
  });
});

describe('computer-os: agent-desktop first, the system scripts after', () => {
  beforeEach(() => {
    builtinCalls.length = 0;
    setAccessibilityEngine('auto');
  });

  it('lists controls and presses and fills them through agent-desktop', async () => {
    const f = fake({ snapshot: () => env(settings('sAAA1111')), click: () => CLICKED, 'set-value': () => '{"version":"2.5","ok":true,"command":"set-value","data":{"action":"set-value"}}' });
    resetAgentDesktop(new AgentDesktop({ bin: 'x', run: f.run }));
    const root = await uiTree(6);
    expect(root?.children?.[0].name).toBe('About');
    expect(await pressElement('w0/0')).toBe(true);
    expect(await setElementValue('w0/1/1', '-5 kg')).toBe(true);
    expect(f.calls.map((c) => c[0])).toEqual(['snapshot', 'click', 'set-value']);
    expect(f.calls[2].slice(-2)).toEqual(['@sAAA1111:e2', '-5 kg']);
    expect(builtinCalls).toEqual([]);
  });

  it('a control without a ref, or one agent-desktop cannot press, is clicked at its centre by the caller', async () => {
    const unsupported = '{"version":"2.5","ok":false,"command":"click","error":{"code":"ACTION_NOT_SUPPORTED","message":"no press","disposition":{"delivery":"not_delivered","retry":"safe"}}}';
    const f = fake({ snapshot: () => env(settings('sAAA1111')), click: () => unsupported });
    resetAgentDesktop(new AgentDesktop({ bin: 'x', run: f.run }));
    await uiTree();
    expect(await pressElement('w0/1')).toBe(false); // the group has no ref
    expect(await pressElement('w0/0')).toBe(false);
    expect(builtinCalls).toEqual([]); // ids from agent-desktop's tree never go to the scripts
  });

  it('a press that may have landed is reported, not repeated', async () => {
    const f = fake({ snapshot: () => env(settings('sAAA1111')), click: () => 'timeout' });
    resetAgentDesktop(new AgentDesktop({ bin: 'x', run: f.run }));
    await uiTree();
    await expect(pressElement('w0/0')).rejects.toBeInstanceOf(MaybeDelivered);
  });

  it('a stale ref that cannot be found again asks the AI to read the controls again', async () => {
    let n = 0;
    const f = fake({ snapshot: () => (n++ === 0 ? env(settings('sOLD00001')) : env({ ...settings('sNEW00001'), tree: { role: 'window', children: [] } })), click: () => STALE });
    resetAgentDesktop(new AgentDesktop({ bin: 'x', run: f.run }));
    await uiTree();
    await expect(pressElement('w0/0')).rejects.toThrow(/ui_tree again/);
  });

  it('falls back to the system scripts when agent-desktop fails, and leaves it alone for a while', async () => {
    const f = fake({ snapshot: () => 'timeout' });
    resetAgentDesktop(new AgentDesktop({ bin: 'x', run: f.run }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await uiTree()).toBeUndefined();
    expect(builtinCalls.length).toBe(1);
    await uiTree();
    expect(f.calls.length).toBe(1); // paused: straight to the scripts
    expect(builtinCalls.length).toBe(2);
    // The ids now come from the scripts' tree, so presses go there too.
    expect(await pressElement('w0/0')).toBe(false);
    expect(builtinCalls.length).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a window agent-desktop cannot pick falls back for that call only', async () => {
    const ambiguous = '{"version":"2.5","ok":false,"command":"snapshot","error":{"code":"AMBIGUOUS_TARGET","message":"several windows","disposition":{"delivery":"not_delivered","retry":"safe"}}}';
    let n = 0;
    const f = fake({ snapshot: () => (n++ === 0 ? ambiguous : env(settings('sAAA1111'))) });
    resetAgentDesktop(new AgentDesktop({ bin: 'x', run: f.run }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await uiTree()).toBeUndefined();
    expect((await uiTree())?.name).toBe('General');
    warn.mockRestore();
  });

  it('no program, or the Built-in setting: only the system scripts', async () => {
    resetAgentDesktop(null);
    await uiTree();
    expect(builtinCalls.length).toBe(1);
    const f = fake({ snapshot: () => env(settings('sAAA1111')) });
    resetAgentDesktop(new AgentDesktop({ bin: 'x', run: f.run }));
    setAccessibilityEngine('builtin');
    await uiTree();
    expect(f.calls).toEqual([]);
    expect(builtinCalls.length).toBe(2);
  });

  it('the setting defaults to Automatic', () => {
    expect(normalizeComputerPolicy({}).accessibilityEngine).toBe('auto');
    expect(normalizeComputerPolicy({ accessibilityEngine: 'builtin' }).accessibilityEngine).toBe('builtin');
    expect(normalizeComputerPolicy({ accessibilityEngine: 'other' }).accessibilityEngine).toBe('auto');
  });
});
