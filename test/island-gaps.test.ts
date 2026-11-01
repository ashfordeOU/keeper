// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { callTimer, detectCall, parsePactlSourceOutputs, parseRegMicStarts } from '../core/island-calls';
import { backlightPercent, burstSchedule, hudChange, hudIcon, isBacklightEvent, pactlEventKind, parsePactlVolume } from '../core/island-hud';
import { isOwnNotification, mirrorSupport, NotifyDeduper, parseMacBanner, parseToastXml, parseWinListenerLine, prettyAppId, wantNotification, wpnRowsToNotes } from '../core/island-notify';
import { addEditorHooks, agentName, geminiSessionState, hookScriptSh, messageDirState, parseStatusFile, removeEditorHooks, stateForEvent } from '../core/island-agents';
import { scanMoreAgents } from '../core/island-scan';
import { costWindows, dailyWindows, geminiReplies, opencodeReply, report } from '../core/island-tools/usage-more';
import { enhanceForOcr, isDarkBackground, otsu, pickEngine, psmFor, scaleFor, tesseractParams, toGray } from '../core/ocr-tune';
import { newFocus, rulerMinutes, startBreak, startFocus, tickFocus, type FocusState } from '../core/island';

const NOW = new Date(2026, 9, 31, 12, 0, 0).getTime();

describe('notifications from other apps', () => {
  it('reads Windows toasts, listener lines and the toast history', () => {
    expect(parseToastXml('<toast><visual><binding template="ToastGeneric"><text>Ana</text><text>Lunch at 1? &amp; bring &lt;cake&gt;</text></binding></visual></toast>')).toEqual({ title: 'Ana', body: 'Lunch at 1? & bring <cake>' });
    expect(parseToastXml('<toast/>')).toBeNull();
    expect(prettyAppId('Microsoft.WindowsTerminal_8wekyb3d8bbwe!App')).toBe('Windows Terminal');
    expect(prettyAppId('com.squirrel.slack.slack')).toBe('Slack');
    expect(prettyAppId('C:\\Program Files\\Signal\\Signal.exe')).toBe('Signal');
    expect(parseWinListenerLine('{"error":"denied"}')).toEqual({ error: 'denied' });
    expect(parseWinListenerLine('{"id":7,"appId":"com.squirrel.slack.slack","texts":["#general","Deploy done"]}')).toMatchObject({ app: 'Slack', title: '#general', body: 'Deploy done', key: 'win:7' });
    expect(parseWinListenerLine('garbage')).toBeNull();
    const ft = (BigInt(NOW) + 11_644_473_600_000n) * 10_000n;
    const r = wpnRowsToNotes([
      { Id: 3, PrimaryId: 'Microsoft.Teams', Payload: Buffer.from('<toast><visual><binding><text>Sam</text><text>Call me</text></binding></visual></toast>'), ArrivalTime: ft, Type: 'toast' },
      { Id: 2, PrimaryId: 'x', Payload: '<tile/>', Type: 'tile' },
      { Id: 1, PrimaryId: 'old', Payload: '<toast><text>old</text></toast>' },
    ], 1);
    expect(r.lastId).toBe(3);
    expect(r.notes).toEqual([{ app: 'Teams', appId: 'Microsoft.Teams', title: 'Sam', body: 'Call me', at: NOW, key: 'wpn:3' }]);
  });
  it('reads macOS banners, filters apps and drops repeats', () => {
    expect(parseMacBanner({ texts: ['Messages', 'Ana', 'See you soon'] })).toEqual({ app: 'Messages', title: 'Ana', body: 'See you soon', key: undefined });
    expect(parseMacBanner({ app: 'Mail', title: 'Invoice', body: 'Attached', id: 'x1' })).toMatchObject({ key: 'mac:x1' });
    expect(parseMacBanner({ texts: [] })).toBeNull();
    expect(wantNotification('Slack', [])).toBe(true);
    expect(wantNotification('Slack', ['mail'])).toBe(false);
    expect(wantNotification('Slack', [], ['slack'])).toBe(false);
    expect(isOwnNotification({ app: 'Keeper', title: 'x', body: '' })).toBe(true);
    const d = new NotifyDeduper(10_000);
    const n = { app: 'Mail', title: 'Hi', body: 'there' };
    expect(d.fresh(n, NOW)).toBe(true);
    expect(d.fresh(n, NOW + 2000)).toBe(false);
    expect(d.fresh(n, NOW + 20_000)).toBe(true);
    expect(d.fresh({ ...n, key: 'k' }, NOW + 50_000)).toBe(true);
    expect(d.fresh({ ...n, key: 'k', title: 'other' }, NOW + 50_001)).toBe(false);
    expect(mirrorSupport('darwin').fragile).toBe(true);
    expect(mirrorSupport('linux').suppress).toBe(false);
  });
});

describe('calls', () => {
  it('finds a call app or a browser call, keeps its start time', () => {
    const c = detectCall({ micApps: ['zoom.us'], now: NOW })!;
    expect(c).toMatchObject({ app: 'Zoom', id: 'zoom', since: NOW, mute: 'both' });
    const later = detectCall({ micApps: ['zoom.us'], prev: { ...c, muted: true }, now: NOW + 60_000 })!;
    expect(later.since).toBe(NOW);
    expect(later.muted).toBe(true);
    expect(detectCall({ micApps: ['Google Chrome'], titles: ['Meet - abc-defg-hij - Google Chrome'], now: NOW })).toMatchObject({ app: 'Google Meet in Chrome', id: 'meet' });
    expect(detectCall({ micApps: ['firefox'], titles: ['Inbox'], now: NOW })).toMatchObject({ app: 'A call in Firefox', mute: 'system' });
    expect(detectCall({ micApps: ['Audacity'], now: NOW })).toBeUndefined();
    expect(detectCall({ micApps: [], now: NOW })).toBeUndefined();
    expect(callTimer(3_723_000)).toBe('1:02:03');
    expect(callTimer(65_000)).toBe('1:05');
  });
  it('reads the Windows microphone start times and PipeWire streams', () => {
    const ft = (BigInt(NOW) + 11_644_473_600_000n) * 10_000n;
    const reg = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\C:#Users#a#AppData#Roaming#Zoom#bin#Zoom.exe',
      `    LastUsedTimeStart    REG_QWORD    0x${ft.toString(16)}`,
      '    LastUsedTimeStop    REG_QWORD    0x0',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\MSTeams_8wekyb3d8bbwe',
      `    LastUsedTimeStart    REG_QWORD    0x${ft.toString(16)}`,
      '    LastUsedTimeStop    REG_QWORD    0x1d9',
    ].join('\r\n');
    expect(parseRegMicStarts(reg)).toEqual([{ app: 'Zoom', since: NOW }]);
    const pactl = 'Source Output #12\n\tMute: no\n\tProperties:\n\t\tapplication.name = "Firefox"\n\t\tapplication.process.binary = "firefox"\nSource Output #13\n\tMute: yes\n\tProperties:\n\t\tapplication.name = "Visualizer"\n\t\tstream.capture.sink = "true"\n';
    expect(parsePactlSourceOutputs(pactl)).toEqual([{ app: 'Firefox', binary: 'firefox', muted: false }]);
  });
});

describe('volume and brightness feedback', () => {
  it('shows real changes only', () => {
    expect(hudChange(undefined, { kind: 'volume', value: 40 }, NOW)).toBeUndefined();
    expect(hudChange({ kind: 'volume', value: 40 }, { kind: 'volume', value: 40.3 }, NOW)).toBeUndefined();
    expect(hudChange({ kind: 'volume', value: 40 }, { kind: 'volume', value: 46 }, NOW)).toMatchObject({ value: 46, direction: 1, at: NOW });
    expect(hudChange({ kind: 'volume', value: 40 }, { kind: 'volume', value: 40, muted: true }, NOW)).toMatchObject({ direction: 0, muted: true });
    expect(hudChange({ kind: 'brightness', value: 80 }, { kind: 'brightness', value: 120 }, NOW)).toMatchObject({ value: 100, direction: 1 });
    expect(burstSchedule(100)).toBe(150);
    expect(burstSchedule(5000)).toBeNull();
    expect(hudIcon({ kind: 'volume', value: 0 })).toBe('audio');
    expect(hudIcon({ kind: 'brightness', value: 10 })).toBe('sun');
  });
  it('reads the Linux sound server and backlight events', () => {
    expect(pactlEventKind("Event 'change' on sink #56")).toBe('sink');
    expect(pactlEventKind("Event 'change' on sink-input #12")).toBeNull();
    expect(pactlEventKind("Event 'new' on source-output #3")).toBeNull();
    expect(parsePactlVolume('Volume: front-left: 32768 /  50% / -18.06 dB,   front-right: 39321 /  60% / -13.31 dB')).toBe(55);
    expect(isBacklightEvent('UDEV  [123.4] change   /devices/pci0000:00/0000:00:02.0/drm/card0/card0-eDP-1/intel_backlight (backlight)')).toBe(true);
    expect(isBacklightEvent('UDEV  [123.4] add /devices/usb (usb)')).toBe(false);
    expect(backlightPercent('480\n', '960')).toBe(50);
  });
});

describe('more coding agents', () => {
  it('reads hook status files and event names', () => {
    expect(stateForEvent('beforeShellExecution')).toBe('working');
    expect(stateForEvent('Notification')).toBe('waiting');
    expect(stateForEvent('stop')).toBe('done');
    const s = parseStatusFile(JSON.stringify({ tool: 'cursor', cwd: '/w/shop', state: 'beforeSubmitPrompt', summary: 'Fix the cart', updatedAt: NOW - 1000 }), '/f', 0, NOW)!;
    expect(s).toMatchObject({ tool: 'cursor', project: 'shop', state: 'working', summary: 'Fix the cart' });
    expect(parseStatusFile(JSON.stringify({ tool: 'cursor', state: 'working', updatedAt: NOW - 20 * 60_000 }), '/f', 0, NOW)!.state).toBe('idle');
    expect(parseStatusFile('nope', '/f', 0, NOW)).toBeNull();
    expect(agentName('opencode')).toBe('OpenCode');
    expect(agentName('gemini')).toBe('Gemini CLI');
    expect(agentName('cursor')).toBe('Cursor');
    expect(agentName('my-agent')).toBe('My Agent');
  });
  it('reads Gemini-style and one-file-per-message sessions', () => {
    const waiting = JSON.stringify({ messages: [{ type: 'user', content: 'go' }, { type: 'gemini', content: 'ok', toolCalls: [{ name: 'run_shell', status: 'awaiting_approval' }] }] });
    expect(geminiSessionState(waiting, NOW - 30_000, NOW)).toEqual({ state: 'waiting', summary: 'Wants to use run_shell' });
    expect(geminiSessionState(JSON.stringify({ messages: [{ type: 'gemini', content: 'All done' }] }), NOW - 60_000, NOW).state).toBe('done');
    expect(messageDirState([{ role: 'user', time: { created: NOW - 5000 } }, { role: 'assistant', time: { created: NOW - 3000 }, path: { cwd: '/p/app' } }], NOW)).toEqual({ state: 'working', cwd: '/p/app', updatedAt: NOW - 3000 });
    expect(messageDirState([{ role: 'assistant', time: { created: NOW - 9000, completed: NOW - 8000 } }], NOW).state).toBe('done');
  });
  it('adds and removes editor hooks without touching the person’s own', () => {
    const mine = JSON.stringify({ version: 1, hooks: { stop: [{ command: 'say done' }] } });
    const added = addEditorHooks(mine, (e) => `/h/keeper-agent-status.sh cursor ${e}`);
    const o = JSON.parse(added);
    expect(o.hooks.stop).toEqual([{ command: 'say done' }, { command: '/h/keeper-agent-status.sh cursor stop' }]);
    expect(o.hooks.beforeSubmitPrompt).toHaveLength(1);
    expect(addEditorHooks(added, (e) => `/h/keeper-agent-status.sh cursor ${e}`)).toBe(added);
    expect(JSON.parse(removeEditorHooks(added))).toEqual({ version: 1, hooks: { stop: [{ command: 'say done' }] } });
    expect(() => addEditorHooks('{bad', () => '')).toThrow();
    expect(hookScriptSh()).toContain('.keeper/agents');
  });
  it('scans status files and session folders', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'keeper-agents-'));
    mkdirSync(path.join(home, '.keeper', 'agents'), { recursive: true });
    writeFileSync(path.join(home, '.keeper', 'agents', 'cursor-a.json'), JSON.stringify({ tool: 'cursor', cwd: '/w/site', state: 'waiting', updatedAt: Date.now() }));
    const gdir = path.join(home, '.gemini', 'tmp', 'abc123', 'chats');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(path.join(gdir, 'session-1.json'), JSON.stringify({ messages: [{ type: 'gemini', content: 'Finished' }] }));
    const list = await scanMoreAgents(home);
    expect(list.map((s) => [s.tool, s.state]).sort()).toEqual([['cursor', 'waiting'], ['gemini', 'working']]);
  });
});

describe('more AI usage', () => {
  it('counts replies and cost', () => {
    const json = JSON.stringify({ messages: [{ type: 'user', timestamp: new Date(NOW - 1000).toISOString() }, { type: 'gemini', timestamp: new Date(NOW - 500).toISOString(), tokens: { input: 100, output: 50, total: 150 } }, { type: 'gemini', timestamp: new Date(NOW - 3 * 86_400_000).toISOString(), tokens: { total: 10 } }] });
    const lines = geminiReplies(json);
    expect(lines.length).toBe(2);
    const w = dailyWindows(lines, NOW, 1000);
    expect(w[0]).toMatchObject({ label: 'Today', tokens: 150, used: 1, limit: 1000, usedPercent: 0.1 });
    expect(w[1]).toMatchObject({ tokens: 160, used: 2 });
    const oc = opencodeReply(JSON.stringify({ role: 'assistant', time: { created: NOW - 1000 }, tokens: { input: 10, output: 5, cache: { read: 5 } }, cost: 0.02 }))!;
    expect(oc).toEqual({ at: NOW - 1000, tokens: 20, cost: 0.02 });
    expect(costWindows([oc], NOW)[0]).toMatchObject({ tokens: 20, cost: 0.02, used: 1 });
    expect(report('gemini', [], 0, NOW).state).toBe('none');
    expect(report('opencode', [oc], 1, NOW).windows[0].label).toBe('Last 5 hours');
  });
});

describe('text capture tuning', () => {
  it('cleans pictures for the reader and picks settings', () => {
    // Light text (220) on a dark background (20): comes out black on white.
    const w = 4;
    const h = 2;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { const v = i === 1 ? 220 : 20; px.set([v, v, v, 255], i * 4); }
    const g = toGray(px, w, h);
    const t = otsu(g);
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThan(220);
    expect(isDarkBackground(g, t)).toBe(true);
    const out = enhanceForOcr(px, w, h);
    expect(out[4]).toBe(0);
    expect(out[0]).toBe(255);
    expect(psmFor('line')).toBe('7');
    expect(tesseractParams('sparse').tessedit_pageseg_mode).toBe('11');
    expect(scaleFor(300, 100, true)).toBe(3);
    expect(pickEngine({ engine: 'auto', handwriting: true, systemAvailable: false })).toBe('builtin');
    expect(pickEngine({ engine: 'builtin', systemAvailable: true })).toBe('builtin');
    expect(pickEngine({ handwriting: true, systemAvailable: true })).toBe('system');
  });
});

describe('focus long break and ruler', () => {
  it('takes a long break every N rounds', () => {
    let s: FocusState = { ...newFocus(25, 5), longEvery: 2, longBreakMin: 20 };
    s = startFocus(s, 25, NOW);
    let r = tickFocus(s, NOW + 25 * 60_000);
    expect(r.state.long).toBe(false);
    r = tickFocus(startFocus(r.state, 25, NOW), NOW + 25 * 60_000);
    expect(r.state.long).toBe(true);
    expect(r.state.endsAt).toBe(NOW + 45 * 60_000);
    expect(startBreak(s, true, NOW).endsAt).toBe(NOW + 20 * 60_000);
    expect(rulerMinutes(0.5)).toBe(90);
    expect(rulerMinutes(0.02)).toBe(4);
    expect(rulerMinutes(2)).toBe(180);
  });
});

describe('Island+ extras', () => {
  it('warns about low disk once, picks lyrics per app, finds a glow colour', async () => {
    const { glowColor, lowDiskAlert, lyricsFor, plusSetting } = await import('../core/island-plus');
    let r = lowDiskAlert(5e9, 10, false);
    expect(r).toEqual({ alert: true, warned: true });
    r = lowDiskAlert(4e9, 10, r.warned);
    expect(r.alert).toBe(false);
    expect(lowDiskAlert(12e9, 10, true)).toEqual({ alert: false, warned: false });
    expect(lowDiskAlert(1, 0, false).alert).toBe(false);
    expect(lyricsFor('Google Chrome', ['chrome'])).toBe(false);
    expect(lyricsFor('Spotify', ['chrome'])).toBe(true);
    const red = new Uint8Array(16 * 4 * 4);
    for (let i = 0; i < red.length; i += 4) red.set([200, 30, 40, 255], i);
    expect(glowColor(red)).toMatch(/^rgb\(220, /);
    expect(glowColor(new Uint8Array(64).fill(128))).toBeNull();
    expect(plusSetting(undefined, 'lowDiskGb')).toBe(10);
    expect(plusSetting({ cornerRadius: 4 }, 'cornerRadius')).toBe(4);
  });
  it('carries the extension’s page and cue messages to Keeper', async () => {
    const { parseExtensionMessage } = await import('../core/browser-tabs');
    expect(parseExtensionMessage({ kind: 'active', url: 'https://a.b/x', title: 'X' })).toEqual({ kind: 'active', url: 'https://a.b/x', title: 'X' });
    expect(parseExtensionMessage({ kind: 'cue', url: 'https://a.b/x', title: 'X', site: true })).toMatchObject({ kind: 'cue', site: true, text: '' });
    const { hostSession } = await import('../cli/browser-host');
    const calls: [string, unknown][] = [];
    const s = hostSession({ write: () => undefined, connect: async () => ({ call: async (m: string, p: unknown) => { calls.push([m, p]); return {}; }, close: () => undefined }) as never });
    await s.handle({ kind: 'cue', url: 'https://a.b/x', title: 'X' });
    await s.handle({ kind: 'active', url: 'https://a.b/y', title: 'Y' });
    expect(calls.map((c) => c[0])).toEqual(['keeper/cues.capture', 'keeper/cues.active']);
  });
});
