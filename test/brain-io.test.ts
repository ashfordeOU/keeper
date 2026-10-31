import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { addToConfig, isConnected, parseJsonc, removeFromConfig, snippets } from '../core/brain/apps';
import { offlineBrain } from '../core/brain/client';
import { defaultBrainSettings, normalizeBrainSettings } from '../core/brain/config';
import { extractText, markupToText, officeText } from '../core/brain/extract';
import { serveLines } from '../core/brain/mcp';
import { brainSocketPath, keeperDataDir } from '../core/brain/paths';
import { FileIndex } from '../core/indexer';
import { mergeSettings, defaultSettings } from '../core/settings';
import { file } from './helpers';

/** A minimal ZIP writer, enough to make office documents for the tests. */
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = deflateRawSync(Buffer.from(text));
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(text.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(text.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('extract', () => {
  it('reads Word, PowerPoint, Excel and OpenDocument text', () => {
    const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Lease for flat 4B</w:t></w:r></w:p><w:p><w:r><w:t>Deposit: two months</w:t></w:r></w:p></w:body></w:document>' });
    expect(officeText(docx, 'docx')).toBe('Lease for flat 4B\nDeposit: two months');
    const pptx = zip({ 'ppt/slides/slide2.xml': '<p:sld><a:p><a:t>Second</a:t></a:p></p:sld>', 'ppt/slides/slide1.xml': '<p:sld><a:p><a:t>First</a:t></a:p></p:sld>' });
    expect(officeText(pptx, 'pptx')).toBe('First\n\nSecond');
    const xlsx = zip({ 'xl/sharedStrings.xml': '<sst><si><t>Invoice</t></si><si><t>Total</t></si></sst>', 'xl/worksheets/sheet1.xml': '<c r="B2" t="n"><v>4200</v></c>' });
    expect(officeText(xlsx, 'xlsx')).toContain('Invoice\nTotal');
    expect(officeText(xlsx, 'xlsx')).toContain('4200');
    const odt = zip({ 'content.xml': '<office:text><text:h>Notes</text:h><text:p>Caf&#233; &amp; more</text:p></office:text>' });
    expect(officeText(odt, 'odt')).toBe('Notes\nCafé & more');
  });

  it('turns HTML into text and reads files from disk', async () => {
    expect(markupToText('<html><head><style>x{}</style></head><body><h1>Title</h1><p>One&nbsp;two</p><script>evil()</script></body></html>')).toBe('Title\nOne two');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'keeper-extract-'));
    const p = path.join(dir, 'notes.md');
    writeFileSync(p, '# Plan\n\nShip it.');
    expect(await extractText(file(p, { size: 17 }))).toBe('# Plan\n\nShip it.');
    const d = path.join(dir, 'lease.docx');
    writeFileSync(d, zip({ 'word/document.xml': '<w:p><w:t>Rent 1200</w:t></w:p>' }));
    expect(await extractText(file(d, { size: 200 }))).toBe('Rent 1200');
    const bin = path.join(dir, 'x.txt');
    writeFileSync(bin, Buffer.from([0, 1, 2, 3]));
    expect(await extractText(file(bin, { size: 4, text: 'from OCR' }))).toBe('from OCR');
  });
});

describe('AI app settings files', () => {
  const launch = { command: '/Applications/Keeper.app/Contents/MacOS/Keeper', args: ['/x/keeper.cjs', 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  it('adds Keeper without touching other servers or settings, and removes it again', () => {
    const before = JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } });
    const after = addToConfig(before, 'mcpServers', launch);
    const data = JSON.parse(after);
    expect(data.theme).toBe('dark');
    expect(data.mcpServers.other).toEqual({ command: 'x' });
    expect(data.mcpServers.keeper).toEqual({ command: launch.command, args: launch.args, env: launch.env });
    expect(isConnected(after, 'mcpServers')).toBe(true);
    const removed = JSON.parse(removeFromConfig(after, 'mcpServers'));
    expect(removed).toEqual({ theme: 'dark', mcpServers: { other: { command: 'x' } } });
  });
  it('uses each app\'s own shape and reads files with comments', () => {
    expect(JSON.parse(addToConfig(undefined, 'vscode', launch)).servers.keeper.type).toBe('stdio');
    expect(JSON.parse(addToConfig('{}', 'zed', launch)).context_servers.keeper.source).toBe('custom');
    const jsonc = '{\n  // my settings\n  "a": "http://x", /* block */\n  "b": [1, 2,],\n}';
    expect(parseJsonc(jsonc)).toEqual({ a: 'http://x', b: [1, 2] });
    expect(() => addToConfig('not json at all', 'mcpServers', launch)).toThrow(/not plain JSON/);
  });
  it('makes copyable snippets', () => {
    const s = snippets(launch);
    expect(s.find((x) => x.id === 'claude-code')!.text).toBe('claude mcp add --env ELECTRON_RUN_AS_NODE=1 keeper -- /Applications/Keeper.app/Contents/MacOS/Keeper /x/keeper.cjs mcp');
  });
});

describe('brain settings and paths', () => {
  it('carries the older single-AI choice over', () => {
    const merged = mergeSettings(defaultSettings([], []), { ai: { provider: 'ollama', model: 'qwen3', ollamaUrl: 'http://127.0.0.1:9999' } });
    expect(merged.brain.active).toBe('ollama');
    const o = merged.brain.connections.find((c) => c.id === 'ollama')!;
    expect(o.model).toBe('qwen3');
    expect(o.baseUrl).toBe('http://127.0.0.1:9999');
    const kept = mergeSettings(defaultSettings([], []), { brain: { ...defaultBrainSettings(), active: 'openai', visibility: 'full' } });
    expect(kept.brain.active).toBe('openai');
    expect(normalizeBrainSettings({ visibility: 'everything' as never, active: 'gone' }).visibility).toBe('snippets');
    expect(normalizeBrainSettings({ active: 'gone' }).active).toBe('anthropic');
  });
  it('finds the app\'s data folder and a socket path on each system', () => {
    expect(keeperDataDir({}, 'darwin', '/Users/sam')).toBe('/Users/sam/Library/Application Support/Keeper');
    expect(keeperDataDir({ XDG_CONFIG_HOME: '/c' }, 'linux', '/home/sam')).toBe(path.join('/c', 'Keeper'));
    expect(keeperDataDir({ KEEPER_DATA_DIR: '/d' }, 'linux', '/home/sam')).toBe('/d');
    expect(brainSocketPath('C:\\Users\\sam\\AppData\\Roaming\\Keeper', 'win32')).toMatch(/^\\\\\.\\pipe\\keeper-brain-[0-9a-f]{16}$/);
    expect(brainSocketPath('/home/sam/.config/Keeper', 'linux')).toBe(path.join('/home/sam/.config/Keeper', 'brain', 'keeper.sock'));
  });
});

describe('keeper mcp without the app', () => {
  it('serves the saved index read-only over stdio, with secrets blanked', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'keeper-offline-'));
    const docs = path.join(root, 'Documents');
    const data = path.join(root, 'data');
    mkdirSync(docs);
    mkdirSync(data);
    writeFileSync(path.join(docs, 'lease.md'), 'The deposit is two months of rent.');
    writeFileSync(path.join(docs, 'wifi.txt'), 'wifi password: hunter22secret');
    const ix = new FileIndex(path.join(data, 'index.json'), [{ path: docs, label: 'Documents' }]);
    await ix.scan();
    await ix.save();
    writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ folders: [docs], excluded: [] }));
    const off = (await offlineBrain(data, { semantic: false }))!;
    const input = new PassThrough();
    const out: { id: number; result: { content?: { text: string }[] } }[] = [];
    const done = serveLines(off.server, input, (l) => out.push(JSON.parse(l)));
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_files', arguments: { query: 'deposit' } } }) + '\n');
    input.end(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_file', arguments: { path: path.join(docs, 'wifi.txt') } } }) + '\n');
    await done;
    expect(out.find((o) => o.id === 2)!.result.content![0].text).toContain('lease.md');
    const read = out.find((o) => o.id === 3)!.result.content![0].text;
    expect(read).toContain('[removed]');
    expect(read).not.toContain('hunter22secret');
    // Read-only: the app's files are left as they were.
    expect(readFileSync(path.join(data, 'settings.json'), 'utf8')).toContain('"folders"');
    expect(() => readFileSync(path.join(data, 'brain', 'brain.json'))).toThrow();
  });
});
