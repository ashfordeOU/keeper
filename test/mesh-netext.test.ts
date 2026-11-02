// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's client for the macOS Network Extension variant of the mesh: the
// requests it sends keeper-mesh-ne and how it reads the answers, against a
// stand-in tool (a small script answering as the Swift one does). The Swift
// extension itself (native/macos/KeeperMeshTunnel) is not compiled here.

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NetworkExtensionPlane } from '../electron/services/mesh/netext';
import { NETWORK_EXTENSION } from '../electron/services/mesh/driver';

const dir = mkdtempSync(path.join(os.tmpdir(), 'kne-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const log = path.join(dir, 'requests.log');
const tool = path.join(dir, 'keeper-mesh-ne');
writeFileSync(tool, `#!${process.execPath}
let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  require('fs').appendFileSync(${JSON.stringify(log)}, s + '\\n');
  const r = JSON.parse(s);
  const out = r.cmd === 'stats'
    ? { ok: true, uapi: 'private_key=00\\npublic_key=' + 'ab'.repeat(32) + '\\nendpoint=198.51.100.12:51820\\nlast_handshake_time_sec=1700000000\\nlast_handshake_time_nsec=0\\nrx_bytes=900\\ntx_bytes=1200\\nerrno=0\\n' }
    : r.cmd === 'activate' ? { ok: false, needsApproval: true, message: 'Allow it in System Settings' }
    : r.cmd === 'endpoint' && !r.publicKey ? { ok: false, message: 'unknown peer or endpoint' }
    : { ok: true, status: r.cmd === 'down' ? 'disconnected' : 'connected' };
  process.stdout.write('some log line\\n' + JSON.stringify(out) + '\\n');
});
`);
chmodSync(tool, 0o755);

// The fake extension is a shell script; Windows cannot start one (and the extension is macOS-only).
describe.skipIf(process.platform === 'win32')('mesh: macOS Network Extension client', () => {
  it('is not available off macOS, or without the signed build’s tool', async () => {
    expect(await new NetworkExtensionPlane(tool, { platform: 'linux' }).available()).toBe(false);
    expect(await new NetworkExtensionPlane(path.join(dir, 'missing'), { platform: 'darwin' }).available()).toBe(false);
    expect(await new NetworkExtensionPlane(tool, { platform: 'darwin' }).available()).toBe(true);
    expect(NETWORK_EXTENSION.kind).toBe('network-extension');
    expect(NETWORK_EXTENSION.why).toMatch(/Developer ID/);
    if (process.platform !== 'darwin') expect(await NETWORK_EXTENSION.available()).toBe(false);
  });

  it('sends one JSON request and reads the last line back: up, sync, endpoint, stats, down', async () => {
    const ne = new NetworkExtensionPlane(tool, { platform: 'darwin' });
    const conf = '[Interface]\nPrivateKey = x\nAddress = fd00::1/48\n\n[Peer]\nPublicKey = y\nAllowedIPs = fd00::2/128\nEndpoint = 127.0.0.1:40000\n';
    expect(await ne.up('Home', conf)).toEqual({ ok: true, status: 'connected' });
    expect((await ne.sync(conf)).ok).toBe(true);
    expect((await ne.endpoint('q83vEjRWeJA=', '198.51.100.12:51820')).ok).toBe(true);
    expect(await ne.endpoint('', 'x')).toMatchObject({ ok: false, message: 'unknown peer or endpoint' });
    const st = await ne.stats();
    expect(st).toEqual([expect.objectContaining({ endpoint: '198.51.100.12:51820', rx: 900, tx: 1200, lastHandshake: 1_700_000_000_000 })]);
    expect(await ne.down()).toEqual({ ok: true, status: 'disconnected' });
    expect(await ne.activate()).toMatchObject({ ok: false, needsApproval: true });
    const sent = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(sent.map((r) => r.cmd)).toEqual(['up', 'sync', 'endpoint', 'endpoint', 'stats', 'down', 'activate']);
    expect(sent[0]).toEqual({ cmd: 'up', name: 'Home', wgQuickConfig: conf });
    expect(sent[2]).toEqual({ cmd: 'endpoint', publicKey: 'q83vEjRWeJA=', endpoint: '198.51.100.12:51820' });
  });

  it('a tool that is missing, hangs or says nonsense gives a plain failure', async () => {
    expect(await new NetworkExtensionPlane(path.join(dir, 'missing'), { platform: 'darwin' }).call({ cmd: 'status' })).toMatchObject({ ok: false });
    const hang = path.join(dir, 'hang');
    writeFileSync(hang, `#!${process.execPath}\nsetTimeout(() => {}, 60000);\n`);
    chmodSync(hang, 0o755);
    expect(await new NetworkExtensionPlane(hang, { platform: 'darwin', timeoutMs: 300 }).call({ cmd: 'status' })).toEqual({ ok: false, message: 'The network extension did not answer' });
    const junk = path.join(dir, 'junk');
    writeFileSync(junk, `#!${process.execPath}\nprocess.stdout.write('hello\\n');\n`);
    chmodSync(junk, 0o755);
    expect(await new NetworkExtensionPlane(junk, { platform: 'darwin' }).call({ cmd: 'status' })).toMatchObject({ ok: false, message: /Unexpected answer/ });
  });
});
