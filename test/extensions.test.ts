// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decide, folderChecksum, hostAllowed, parseManifest, permissionLines, PERMISSION_WORDS, workerScript, workerUrl } from '../core/extensions';
import { jargonIn } from '../core/settings-schema';

const ok = { id: 'example.hello', name: 'Hello', version: '1.0.0', surfaces: ['commands'], commands: [{ id: 'hi', title: 'Say hi' }], permissions: ['notify'] };
const bad = (patch: Record<string, unknown>) => () => parseManifest(JSON.stringify({ ...ok, ...patch }));

describe('extension manifests', () => {
  it('reads the example in the docs', () => {
    const m = parseManifest(readFileSync(path.resolve(__dirname, '../docs/extensions/hello/manifest.json'), 'utf8'));
    expect(m).toMatchObject({ id: 'example.hello', main: 'main.js', permissions: ['notify', 'inbox'], hosts: [] });
    expect(permissionLines(m).map((l) => l.text)).toEqual(['Show you short messages', 'Add things to your Inbox']);
  });

  it('refuses what it cannot run, in plain words', () => {
    expect(bad({ id: 'Hello World' })).toThrow(/id must look like/);
    expect(bad({ version: '1' })).toThrow(/version must look like 1.0.0/);
    expect(bad({ surfaces: ['today-cards'] })).toThrow(/runs commands only; "today-cards" comes in a later version/);
    expect(bad({ surfaces: ['desktop'] })).toThrow(/not a place/);
    expect(bad({ commands: [] })).toThrow(/at least one command/);
    expect(bad({ permissions: ['files'] })).toThrow(/not a permission Keeper knows/);
    expect(bad({ permissions: ['network'] })).toThrow(/needs the sites/);
    expect(bad({ hosts: ['example.com'] })).toThrow(/only used with the network permission/);
    expect(bad({ main: '../evil.js' })).toThrow(/own folder/);
    expect(() => parseManifest('{')).toThrow(/not valid JSON/);
  });

  it('says each permission in plain words', () => {
    for (const w of Object.values(PERMISSION_WORDS)) expect(jargonIn(w)).toEqual([]);
    const m = parseManifest(JSON.stringify({ ...ok, permissions: ['network'], hosts: ['api.example.com', '*.example.org'] }));
    expect(permissionLines(m)[0].text).toBe('Reach these sites: api.example.com, *.example.org');
  });
});

describe('what an extension may do', () => {
  const m = { permissions: ['notify', 'network'] as const, hosts: ['api.example.com', '*.example.org'] };
  it('reaches only the sites it listed, over https', () => {
    expect(hostAllowed(m, 'https://api.example.com/x')).toBe(true);
    expect(hostAllowed(m, 'https://a.b.example.org/')).toBe(true);
    expect(hostAllowed(m, 'https://example.org/')).toBe(true);
    expect(hostAllowed(m, 'http://api.example.com/')).toBe(false);
    expect(hostAllowed(m, 'https://evil.com/?api.example.com')).toBe(false);
    expect(hostAllowed(m, 'https://notexample.org/')).toBe(false);
  });
  it('asks until allowed, and never allows what it did not ask for', () => {
    expect(decide({ permissions: ['notify'] }, {}, 'notify')).toBe('ask');
    expect(decide({ permissions: ['notify'] }, { notify: 'allow' }, 'notify')).toBe('allow');
    expect(decide({ permissions: ['notify'] }, { inbox: 'allow' }, 'inbox')).toBe('off');
  });
  it('fingerprints the whole folder, in any order', () => {
    const a = folderChecksum([{ name: 'a', data: Buffer.from('1') }, { name: 'b', data: Buffer.from('2') }]);
    expect(folderChecksum([{ name: 'b', data: Buffer.from('2') }, { name: 'a', data: Buffer.from('1') }])).toBe(a);
    expect(folderChecksum([{ name: 'a', data: Buffer.from('1') }, { name: 'b', data: Buffer.from('3') }])).not.toBe(a);
  });
  it('runs the script in a worker with only the keeper bridge', () => {
    const s = workerScript('keeper.onCommand("x", () => {})', { id: 'example.hello' });
    expect(s).toContain('self.keeper = Object.freeze');
    expect(s).not.toMatch(/require\(|importScripts/);
    expect(workerUrl('1', { id: 'a.b' })).toMatch(/^data:text\/javascript;base64,/);
  });
});
