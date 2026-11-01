// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BrainHit } from '../core/brain-contract';
import {
  DEFAULT_PLATFORM, dbusServiceFile, desktopExec, encodePowerShell, explorerMenuReg, gnomeMetas, gnomeProviderIni, krunnerDesktopFile, krunnerMatches,
  LineDecoder, listIntegrations, odrManifest, parseKeeperUrl, pathFromResultId, psQuote, resultId, searchInFromArgv, spotlightItem, termsToQuery,
  windowsOcrScript, type HelperMessage,
} from '../core/platform-integrations';
import { HelperClient } from '../electron/services/platform/helper-client';

const hit = (p: string, extra: Partial<BrainHit> = {}): BrainHit => ({ path: p, name: path.posix.basename(p), kind: 'document', size: 1, mtime: 1, score: 0.5, ...extra });

describe('what each computer offers', () => {
  const ids = (l: { id: string }[]) => l.map((i) => i.id);

  it('a Mac with Apple Intelligence ready', () => {
    const l = listIntegrations({ platform: 'darwin', helper: true, appleModel: 'available' }, DEFAULT_PLATFORM);
    expect(ids(l)).toEqual(expect.arrayContaining(['mcp', 'ask-shortcut', 'url-actions', 'apple-intelligence', 'mac-ocr', 'spotlight', 'shortcuts', 'mac-services']));
    expect(l.find((i) => i.id === 'apple-intelligence')).toMatchObject({ available: true, enabled: true });
    expect(l.find((i) => i.id === 'spotlight')).toMatchObject({ available: true, enabled: false, toggle: true });
    expect(ids(l)).not.toContain('gnome-search');
  });

  it('a Mac that cannot run the model, or without the helper, says why', () => {
    const intel = listIntegrations({ platform: 'darwin', helper: true, appleModel: 'deviceNotEligible' }, DEFAULT_PLATFORM).find((i) => i.id === 'apple-intelligence')!;
    expect(intel.available).toBe(false);
    expect(intel.detail).toMatch(/Apple silicon/);
    const none = listIntegrations({ platform: 'darwin', helper: false }, { ...DEFAULT_PLATFORM, spotlight: true });
    expect(none.find((i) => i.id === 'spotlight')).toMatchObject({ available: false, enabled: false });
    expect(none.find((i) => i.id === 'apple-intelligence')!.detail).toMatch(/helper is missing/);
  });

  it('Windows: OCR language hint, agent registry steps, honest about the Store-only model', () => {
    const l = listIntegrations({ platform: 'win32', winBuild: 22631, winOcr: false, odr: false }, DEFAULT_PLATFORM);
    expect(l.find((i) => i.id === 'win-ocr')!.detail).toMatch(/Language/);
    const agents = l.find((i) => i.id === 'win-agents')!;
    expect(agents.available).toBe(false);
    expect(agents.steps?.join(' ')).toMatch(/keeper mcp/);
    expect(l.find((i) => i.id === 'win-ai')).toMatchObject({ available: false });
    const withOdr = listIntegrations({ platform: 'win32', winBuild: 26100, winOcr: true, odr: true }, DEFAULT_PLATFORM);
    expect(withOdr.find((i) => i.id === 'win-agents')!.actions).toEqual([{ id: 'register-odr', label: 'Register Keeper' }]);
  });

  it('Linux: GNOME and KDE need a session bus; other desktops are told it works when they switch', () => {
    const kde = listIntegrations({ platform: 'linux', desktop: 'kde', sessionBus: true }, { ...DEFAULT_PLATFORM, krunner: true });
    expect(kde.find((i) => i.id === 'krunner')).toMatchObject({ available: true, enabled: true, detail: undefined });
    expect(kde.find((i) => i.id === 'gnome-search')!.detail).toMatch(/not on GNOME/);
    const headless = listIntegrations({ platform: 'linux', sessionBus: false }, { ...DEFAULT_PLATFORM, gnomeSearch: true });
    expect(headless.find((i) => i.id === 'gnome-search')).toMatchObject({ available: false, enabled: false });
  });
});

describe('keeper:// links', () => {
  it('reads search, ask, open and reveal', () => {
    expect(parseKeeperUrl('keeper://search?q=tax%202025')).toEqual({ action: 'search', q: 'tax 2025' });
    expect(parseKeeperUrl('keeper://ask?q=when%20does%20my%20passport%20expire')).toEqual({ action: 'ask', q: 'when does my passport expire' });
    expect(parseKeeperUrl('keeper://ask')).toEqual({ action: 'ask', q: '' });
    expect(parseKeeperUrl('keeper://reveal?path=%2FUsers%2Fme%2Fa.pdf')).toEqual({ action: 'reveal', path: '/Users/me/a.pdf' });
    expect(parseKeeperUrl('keeper://open?path=C%3A%5CUsers%5Cme%5Ca.pdf')).toEqual({ action: 'open', path: 'C:\\Users\\me\\a.pdf' });
    expect(parseKeeperUrl('keeper://clean')).toEqual({ action: 'other', name: 'clean' });
  });

  it('refuses relative paths, other schemes and nonsense', () => {
    expect(parseKeeperUrl('keeper://reveal?path=..%2Fsecret')).toBeNull();
    expect(parseKeeperUrl('keeper://open?path=https%3A%2F%2Fevil.example')).toBeNull();
    expect(parseKeeperUrl('keeper://open?path=%2Fa%00b')).toBeNull();
    expect(parseKeeperUrl('https://example.com/search?q=x')).toBeNull();
    expect(parseKeeperUrl('not a url')).toBeNull();
    expect(parseKeeperUrl('keeper://ask?q=' + 'x'.repeat(5000))!).toMatchObject({ q: 'x'.repeat(2000) });
  });
});

describe('Windows pieces', () => {
  const nasty = [
    "C:\\Users\\me\\it's $(Remove-Item C:\\ -Recurse); `whoami`.png",
    'C:\\a\\‘curly’ ’quotes‚.png',
    "C:\\a\\'; Start-Process calc; '.png",
  ];

  it('quotes file names so PowerShell never runs anything inside them', () => {
    for (const p of nasty) {
      const q = psQuote(p);
      expect(q.startsWith("'") && q.endsWith("'")).toBe(true);
      const inner = q.slice(1, -1);
      // Every quote character inside comes in pairs, so the literal never ends early.
      expect(inner.replace(/['‘’‚‛]{2}/g, '')).not.toMatch(/['‘’‚‛]/);
    }
    expect(psQuote("a'b")).toBe("'a''b'");
    expect(psQuote('a\0b')).toBe("'ab'");
  });

  it('puts the file into the OCR script only as a quoted literal', () => {
    const s = windowsOcrScript(nasty[0]);
    const line = s.split('\n').find((l) => l.includes('$path ='))!;
    expect(line.trim()).toBe(`$path = ${psQuote(nasty[0])}`);
    expect(s.split('\n').filter((l) => l.includes('Remove-Item'))).toHaveLength(1);
    expect(windowsOcrScript('C:\\a.png', "en'US")).toContain("[Windows.Globalization.Language]::new('en''US')");
  });

  it('encodes scripts for -EncodedCommand (UTF-16LE base64)', () => {
    const s = 'Write-Output "héllo ✓"';
    expect(Buffer.from(encodePowerShell(s), 'base64').toString('utf16le')).toBe(s);
  });

  it('builds the Explorer menu as reg.exe arguments, no shell involved', () => {
    const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\Keeper\\Keeper.exe';
    const add = explorerMenuReg(exe, true);
    expect(add).toContainEqual(['add', 'HKCU\\Software\\Classes\\Directory\\shell\\KeeperSearch\\command', '/ve', '/d', `"${exe}" "--keeper-search-in=%1"`, '/f']);
    expect(add).toContainEqual(['add', 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\KeeperSearch\\command', '/ve', '/d', `"${exe}" "--keeper-search-in=%V"`, '/f']);
    expect(add.every((a) => a[1].startsWith('HKCU\\'))).toBe(true);
    expect(explorerMenuReg(exe, false)).toEqual([
      ['delete', 'HKCU\\Software\\Classes\\Directory\\shell\\KeeperSearch', '/f'],
      ['delete', 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\KeeperSearch', '/f'],
    ]);
  });

  it('reads the folder Explorer passes back', () => {
    expect(searchInFromArgv(['Keeper.exe', '--keeper-search-in=C:\\Users\\me\\Docs'])).toBe('C:\\Users\\me\\Docs');
    expect(searchInFromArgv(['Keeper.exe', '"--keeper-search-in=D:\\x"'])).toBeUndefined();
    expect(searchInFromArgv(['Keeper.exe'])).toBeUndefined();
  });

  it('describes the MCP server for the agent registry', () => {
    const m = odrManifest('C:\\K\\Keeper.exe', ['C:\\K\\resources\\app.asar\\dist-cli\\keeper.cjs', 'mcp'], '0.1.0');
    expect(m.server.mcp_config).toEqual({ command: 'C:\\K\\Keeper.exe', args: ['C:\\K\\resources\\app.asar\\dist-cli\\keeper.cjs', 'mcp'], env: {} });
    // The MCP bundle manifest format Windows reads (modelcontextprotocol/mcpb, version 0.3).
    expect(m.manifest_version).toBe('0.3');
    expect(m.tools.map((t) => t.name)).toContain('computer');
    expect(m.display_name).toBe('Keeper by Ashforde®');
  });
});

describe('Linux desktop search', () => {
  it('writes the GNOME and KRunner registration files', () => {
    expect(gnomeProviderIni('keeper.desktop')).toBe('[Shell Search Provider]\nDesktopId=keeper.desktop\nBusName=org.ashfordeou.Keeper.SearchProvider\nObjectPath=/org/ashfordeou/Keeper/SearchProvider\nVersion=2\n');
    const k = krunnerDesktopFile();
    expect(k).toContain('X-Plasma-API=DBus');
    expect(k).toContain('X-Plasma-DBusRunner-Service=org.ashfordeou.Keeper.Runner');
    expect(k).toContain('Name=Keeper by Ashforde®');
  });

  it('quotes odd executable paths in Exec lines', () => {
    expect(desktopExec('/opt/Keeper/keeper')).toBe('/opt/Keeper/keeper');
    expect(desktopExec('/home/me/Apps/Keeper "beta" $1.AppImage')).toBe('"/home/me/Apps/Keeper \\"beta\\" \\$1.AppImage"');
    expect(dbusServiceFile('org.x.Y', '/opt/Keeper/keeper')).toBe('[D-BUS Service]\nName=org.x.Y\nExec=/opt/Keeper/keeper --keeper-dbus\n');
  });

  it('shapes results for GNOME and KRunner', () => {
    const hits = [hit('/home/me/Docs/a.pdf', { score: 0.9, snippet: 'line one\n\nline   two' }), hit('/srv/b.png', { kind: 'image', score: 1.4 })];
    const map = new Map(hits.map((h) => [resultId(h), h]));
    expect(gnomeMetas(['f:/home/me/Docs/a.pdf', 'f:/missing', 'f:/srv/b.png'], map, '/home/me')).toEqual([
      { id: 'f:/home/me/Docs/a.pdf', name: 'a.pdf', description: '~/Docs — line one line two', gicon: 'x-office-document' },
      { id: 'f:/srv/b.png', name: 'b.png', description: '/srv', gicon: 'image-x-generic' },
    ]);
    const k = krunnerMatches(hits, '/home/me');
    expect(k[0].slice(0, 5)).toEqual(['f:/home/me/Docs/a.pdf', 'a.pdf', 'x-office-document', 100, 0.9]);
    expect(k[1][4]).toBe(1);
    expect(termsToQuery([' tax ', '', 'return'])).toBe('tax return');
    expect(pathFromResultId('f:/a/b')).toBe('/a/b');
    expect(pathFromResultId('x')).toBeUndefined();
  });
});

describe('Spotlight items', () => {
  it('carry the name, source, tags and the start of the text', () => {
    const s = spotlightItem(hit('/Users/me/Downloads/invoice.pdf', { source: 'Gmail', tags: ['work', 'work', ' taxes '] }), 'Invoice   #123\nTotal 45 EUR');
    expect(s).toMatchObject({ id: 'f:/Users/me/Downloads/invoice.pdf', title: 'invoice.pdf', description: 'From Gmail · Invoice #123 Total 45 EUR', keywords: ['work', 'taxes', 'Gmail', 'document'] });
  });
});

describe('helper line protocol', () => {
  it('reassembles messages split across chunks and skips bad lines', () => {
    const got: HelperMessage[] = [];
    const bad: string[] = [];
    const d = new LineDecoder((m) => got.push(m), (l) => bad.push(l));
    d.push('{"id":1,"res');
    d.push('ult":"a\\nb"}\n\nnot json\n{"no":"id"}\n{"id":2,');
    expect(got).toEqual([{ id: 1, result: 'a\nb' }]);
    d.push(Buffer.from('"delta":"é"}\n'));
    expect(got[1]).toEqual({ id: 2, delta: 'é' });
    expect(bad).toEqual(['not json', '{"no":"id"}']);
  });
});

describe('talking to the helper process', () => {
  const fake = path.join(__dirname, 'fixtures', 'fake-helper.cjs');
  const client = () => new HelperClient(process.execPath, [fake], 200);

  it('asks, streams, runs a tool for the model and gets the answer', async () => {
    const c = client();
    expect(await c.call('hello')).toMatchObject({ appleModel: 'available', spotlight: true });
    const deltas: string[] = [];
    const tools: unknown[] = [];
    const r = await c.call<{ text: string }>('chat', { messages: [{ role: 'user', content: 'tax' }] }, {
      onDelta: (t) => deltas.push(t),
      onTool: async (name, args) => { tools.push([name, args]); return { count: 3 }; },
    });
    expect(tools).toEqual([['search_files', { query: 'tax' }]]);
    expect(deltas.join('')).toBe('Looking… found 3');
    expect(r.text).toBe('Looking… found 3');
    expect(await c.call('noise')).toBe('ok');
    await expect(c.call('fail')).rejects.toThrow('it went wrong');
    c.stop();
  });

  it('stops waiting on abort and on timeout, and survives the helper crashing', async () => {
    const c = client();
    const ac = new AbortController();
    const p = c.call('slow', undefined, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow('Stopped');
    await expect(c.call('slow', undefined, { timeoutMs: 100 })).rejects.toThrow(/too long/);
    await expect(c.call('crash')).rejects.toThrow(/stopped/);
    // A crash is not the end: the next call starts it again.
    expect(await c.call('hello')).toMatchObject({ version: '1' });
    c.disable();
    await expect(c.call('hello')).rejects.toThrow(/not available/);
  });

  it('a missing helper fails the call instead of hanging', async () => {
    const c = new HelperClient('/no/such/keeper-helper');
    await expect(c.call('hello', undefined, { timeoutMs: 3000 })).rejects.toThrow();
  });
});
