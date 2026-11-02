// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/mesh.cjs <work dir> <screenshots dir>
// Two real Keeper apps on one computer (separate, realpath'd homes): pair them
// over Keeper Link, turn Keeper Mesh on, invite one into a network through
// the window, and check the signed key exchange, the addresses on screen, that
// the two generated WireGuard configurations match each other, and that the
// local shim passes WireGuard packets through a real Keeper Relay. Then the
// places mesh controls appear: the tray menu, the Island (exit node in use),
// the command palette, and the Settings choice that moves them. The network
// card comes up and pings only where this computer has WireGuard and the
// rights for it; otherwise that is reported, not faked.
const { _electron } = require('playwright');
const { spawn, spawnSync } = require('node:child_process');
const dgram = require('node:dgram');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'kmesh'));
const SHOTS = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), 'kmesh-shots'));
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const homes = { a: fs.realpathSync(fs.mkdtempSync(path.join(ROOT, 'desk-'))), b: fs.realpathSync(fs.mkdtempSync(path.join(ROOT, 'laptop-'))) };
for (const h of Object.values(homes)) for (const d of ['Documents', 'Downloads', 'Desktop']) fs.mkdirSync(path.join(h, d), { recursive: true });

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) { failures++; process.exitCode = 1; } };
const note = (what) => console.log(`NOTE ${what}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() - t0 > ms) return undefined;
    await wait(250);
  }
}
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function launch(home) {
  const app = await _electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'),
    args: [path.resolve(__dirname, '../..'), '--no-sandbox'],
    env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME: home, NODE_OPTIONS: '', KEEPER_SUITE: 'shared', XDG_CONFIG_HOME: home + '/.config', XDG_DATA_HOME: home + '/.local/share', KEEPER_MESH_FORCE_RELAY: '1' },
  });
  let main;
  for (let i = 0; i < 160 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await wait(500);
  }
  if (!main) throw new Error('no main window');
  const errors = [];
  main.on('pageerror', (e) => errors.push(e.message));
  await main.waitForSelector('.sidebar', { timeout: 60_000 });
  await main.getByRole('button', { name: /Skip tour/ }).click({ timeout: 4000 }).catch(() => undefined);
  await main.setViewportSize({ width: 1360, height: 900 }).catch(() => undefined);
  // the administrator-style questions (offer an exit node) are answered "Allow" in this test
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  return { app, main, errors };
}

const api = (w, fn, ...args) => w.evaluate(([f, a]) => {
  const p = f.split('.');
  let o = window.keeper;
  for (const k of p.slice(0, -1)) o = o[k];
  return o[p[p.length - 1]](...a);
}, [fn, args]);

async function shot(w, name, dark) {
  await w.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await w.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
  await w.waitForTimeout(500);
  await w.screenshot({ path: `${SHOTS}/${name}-${dark ? 'dark' : 'light'}.png` });
}

/** A DNS question, by hand: id, flags, one question. */
function dnsQuery(name, type) {
  const labels = name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
  return Buffer.concat([Buffer.from([0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]), ...labels, Buffer.from([0, 0, type, 0, 1])]);
}

(async () => {
  // ---- a real Keeper Relay (with the new packet path), built from relay/
  spawnSync(process.execPath, [path.resolve(__dirname, '../../relay/build.mjs')], { stdio: 'ignore' });
  const relayPort = await freePort();
  const relay = spawn(process.execPath, [path.resolve(__dirname, '../../relay/dist/keeper-relay.mjs')], { env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', PORT: String(relayPort), HOST: '127.0.0.1' }, stdio: 'ignore' });
  const relayUrl = `http://127.0.0.1:${relayPort}`;
  await until(async () => (await fetch(relayUrl)).ok, 10000);

  const A = await launch(homes.a);
  const B = await launch(homes.b);
  try {
    await api(A.main, 'link.rename', 'Desk');
    await api(B.main, 'link.rename', 'Laptop');
    // ---- pair over Keeper Link (code, then both confirm the six digits)
    const sa = await api(A.main, 'link.state');
    const inv = await api(A.main, 'link.invite');
    const pairing = api(B.main, 'link.pair', { address: `127.0.0.1:${sa.me.port}`, code: inv.code });
    for (const w of [A.main, B.main]) {
      const p = await until(async () => (await api(w, 'link.pending')).pairs[0], 15000);
      if (p) await api(w, 'link.confirmPair', p.id, true);
    }
    await pairing;
    const paired = await until(async () => (await api(A.main, 'link.state')).devices.length === 1 && (await api(B.main, 'link.state')).devices.length === 1, 15000);
    check(!!paired, 'the two apps are paired over Keeper Link');
    const devB = (await api(A.main, 'link.state')).devices[0];

    // ---- Keeper Mesh: off by default, turned on in Features; the relay set in Link
    check((await api(A.main, 'mesh.state')).feature === false, 'Keeper Mesh is off by default');
    for (const w of [A.main, B.main]) {
      await api(w, 'features.set', 'keeperMesh', true);
      await api(w, 'link.setSettings', { mode: 'internet', relayUrl, stun: [] });
      // The window's copy of the settings did not follow the feature switch live in this build (the main
      // process's settings broadcast did not arrive); a reload reads them fresh.
      await w.reload();
      await w.waitForSelector('.sidebar', { timeout: 60_000 });
    }
    // to the Mesh page through the command palette
    for (const w of [A.main, B.main]) {
      await w.waitForTimeout(800);
      await w.keyboard.press('Control+K');
      await w.keyboard.type('Mesh');
      const seen = await until(async () => (await w.locator('.q-row', { hasText: 'Turn Keeper Mesh On' }).count()) > 0, 8000);
      if (!seen) note(`palette rows: ${(await w.locator('.q-row').allInnerTexts()).join(' | ').replace(/\n/g, ' ')}`);
      await w.locator('.q-row', { hasText: /^Mesh$/ }).first().click().catch(async () => { await w.keyboard.press('Escape'); });
    }
    await A.main.waitForSelector('[data-testid=mesh-switch]');
    await shot(A.main, 'mesh-start', false);
    await A.main.locator('[data-testid=mesh-switch] .toggle').click();
    await until(async () => (await api(A.main, 'mesh.state')).on, 15000);
    await api(B.main, 'mesh.setOn', true);
    let s = await api(A.main, 'mesh.createNetwork', 'Home');
    const netId = s.networks[0].id;
    check(/^fd[0-9a-f]{2}:/.test(s.networks[0].prefix6) && /^100\./.test(s.networks[0].prefix4), `the network has its own ranges (${s.networks[0].prefix6}, ${s.networks[0].prefix4})`);

    // ---- invite the laptop; it joins through its window
    await api(A.main, 'mesh.addMember', netId, devB.id, 'own');
    const invite = await until(async () => (await B.main.locator('[data-testid=mesh-invite]').count()) > 0, 15000);
    check(!!invite, 'the laptop’s Mesh page shows the invitation');
    await shot(B.main, 'mesh-invite', true);
    if (invite) await B.main.locator('[data-testid=mesh-invite]').getByRole('button', { name: 'Join' }).click();

    // ---- the signed key exchange over Link
    const exchanged = await until(async () => {
      const x = await api(A.main, 'mesh.state');
      const y = await api(B.main, 'mesh.state');
      return x.networks[0]?.peers[0]?.keyVerified && y.networks[0]?.peers[0]?.keyVerified ? [x, y] : undefined;
    }, 30000);
    check(!!exchanged, 'both apps verified each other’s signed WireGuard key');
    const [x, y] = exchanged ?? [await api(A.main, 'mesh.state'), await api(B.main, 'mesh.state')];
    const pa = x.networks[0].peers[0];
    const pb = y.networks[0]?.peers[0];
    check(pa?.a6 === y.networks[0]?.me.a6 && pa?.a4 === y.networks[0]?.me.a4 && pb?.a6 === x.networks[0].me.a6, `each knows the other’s address (desk ${x.networks[0].me.a4}, laptop ${y.networks[0]?.me.a4})`);
    check(pa?.dns === 'laptop.keeper' && pb?.dns === 'desk.keeper', 'names: laptop.keeper and desk.keeper');

    // ---- addresses on screen
    await A.main.waitForTimeout(800);
    const myAddr = await A.main.locator('[data-testid=mesh-my-addr]').first().innerText().catch(() => '');
    check(myAddr.includes(x.networks[0].me.a4), `the desk’s Mesh page shows its address (${myAddr.trim()})`);
    const peerRow = await A.main.locator('[data-testid=mesh-peer]').first().innerText().catch(() => '');
    check(peerRow.includes(pa.a4) && peerRow.includes('laptop.keeper'), 'and the laptop’s address and name');
    const pathShown = await until(async () => (await A.main.locator('[data-testid=mesh-path]').first().innerText()) === 'Relayed', 15000);
    check(!!pathShown, 'the path shows as Relayed (direct paths are switched off in this test)');

    // ---- the generated configurations match each other
    const ca = await api(A.main, 'mesh.config', netId);
    const cb = await api(B.main, 'mesh.config', netId);
    const iface = (c) => c.match(/Address = (.*)/)[1];
    const peerAllowed = (c) => c.match(/AllowedIPs = (.*)/)[1];
    check(ca.includes(`PublicKey = ${y.wgPub}`) && cb.includes(`PublicKey = ${x.wgPub}`), 'each configuration has the other’s public key');
    const addrA = iface(ca).split(', ').map((a) => a.split('/')[0]);
    const addrB = iface(cb).split(', ').map((a) => a.split('/')[0]);
    check(peerAllowed(cb).split(', ').map((a) => a.split('/')[0]).sort().join() === addrA.sort().join() && peerAllowed(ca).split(', ').map((a) => a.split('/')[0]).sort().join() === addrB.sort().join(), 'each side’s AllowedIPs for the other are exactly the other’s own addresses');
    check(!ca.includes(x.wgPub) && /PrivateKey = \(kept in the keychain\)/.test(ca), 'the shown configuration leaves the private key out');
    fs.writeFileSync(path.join(SHOTS, 'desk.conf'), ca);
    fs.writeFileSync(path.join(SHOTS, 'laptop.conf'), cb);

    // ---- the relay shim passes WireGuard packets (stand-in WireGuard sockets on each side's port)
    const wgA = Number(ca.match(/ListenPort = (\d+)/)[1]);
    const wgB = Number(cb.match(/ListenPort = (\d+)/)[1]);
    const shimA = Number(ca.match(/Endpoint = 127\.0\.0\.1:(\d+)/)[1]);
    const sockA = dgram.createSocket('udp4');
    const sockB = dgram.createSocket('udp4');
    const got = [];
    sockB.on('message', (m) => got.push(m));
    await new Promise((r) => sockA.bind(wgA, '127.0.0.1', r));
    await new Promise((r) => sockB.bind(wgB, '127.0.0.1', r));
    const pkt = Buffer.alloc(148, 7);
    pkt[0] = 1; pkt[1] = pkt[2] = pkt[3] = 0;
    sockA.send(pkt, shimA, '127.0.0.1');
    const arrived = await until(async () => got.length > 0, 8000);
    check(!!arrived && got[0].equals(pkt), 'a WireGuard packet went desk WireGuard port → shim → Keeper Relay → laptop WireGuard port, intact');
    sockA.close();
    sockB.close();

    // ---- names: the responder answers (on this computer while the card is not up)
    if (x.dns.responder) {
      const [h, p] = [x.dns.responder.replace(/:\d+$/, ''), Number(x.dns.responder.split(':').pop())];
      const ans = await new Promise((resolve) => {
        const q = dgram.createSocket('udp4');
        const t = setTimeout(() => { q.close(); resolve(null); }, 3000);
        q.on('message', (m) => { clearTimeout(t); q.close(); resolve(m); });
        q.send(dnsQuery('laptop.keeper', 1), p, h);
      });
      const ip = ans && ans.length >= 4 ? [...ans.subarray(ans.length - 4)].join('.') : '';
      check(ip === pa.a4, `laptop.keeper resolves to ${ip} at the desk’s mesh name server (${x.dns.responder})`);
    }

    // ---- the network card itself
    if (x.iface.state === 'up') {
      const ping = await api(A.main, 'mesh.ping', devB.id);
      check(ping.ok, `the network card is up and ping works: ${ping.lines.join(' | ')}`);
    } else note(`network card not brought up here: ${x.iface.state} — ${x.iface.message ?? ''}`);

    await shot(A.main, 'mesh-page', false);
    await shot(A.main, 'mesh-page', true);
    await shot(B.main, 'mesh-page-laptop', false);
    await A.main.locator('[data-testid=mesh-trouble]').locator('summary').click();
    await A.main.getByRole('button', { name: 'Path test' }).click();
    await until(async () => (await A.main.locator('.mesh-diag').count()) > 0, 15000);
    await shot(A.main, 'mesh-trouble', false);

    // ---- where the controls appear: tray, Island, palette, and the Settings choice
    let tray = await api(A.main, 'mesh.trayPreview');
    const t1 = JSON.stringify(tray);
    check(/"Keeper Mesh","checked":true/.test(t1) && /Copy Mesh Address/.test(t1) && /Laptop/.test(t1) && /Exit Node/.test(t1), 'the tray menu has the mesh switch, the exit-node picker and Laptop’s address to copy');
    await api(B.main, 'mesh.offerExit', true);
    const offered = await until(async () => (await api(A.main, 'mesh.state')).networks[0].peers[0].offersExit, 15000);
    check(!!offered, 'the laptop offers itself as an exit node (signed record updated)');
    await api(A.main, 'mesh.setExit', devB.id);
    tray = await api(A.main, 'mesh.trayPreview');
    check(/Exit Node: Laptop/.test(JSON.stringify(tray)), 'the tray shows the exit node in use');
    const isl = A.app.windows().find((w) => w.url().includes('view=island'));
    if (isl) {
      const shown = await until(async () => /Laptop|exit/i.test(await isl.evaluate(() => document.body.innerText)), 8000);
      check(!!shown, 'the Island shows that traffic goes through the laptop');
      await isl.screenshot({ path: `${SHOTS}/island-exit.png` }).catch(() => undefined);
    } else note('no Island window in this session');
    await A.main.keyboard.press('Control+K');
    await A.main.keyboard.type('mesh address');
    const inPalette = await until(async () => (await A.main.getByText('Copy Laptop’s Mesh Address').count()) > 0, 5000);
    check(!!inPalette, 'the palette offers “Copy Laptop’s Mesh Address”');
    await shot(A.main, 'palette-mesh', false);
    await A.main.keyboard.press('Escape');
    // Settings: take the addresses out of the tray and the palette
    await A.main.keyboard.press('Control+Comma');
    const placesShown = await until(async () => (await A.main.locator('[data-testid=mesh-places]').count()) > 0, 8000);
    check(!!placesShown, 'Settings has “Keeper Mesh: where its controls appear”');
    if (placesShown) {
      await A.main.waitForTimeout(800);
      await A.main.locator('[data-testid=mesh-place-addresses-tray] button').click();
      await A.main.waitForTimeout(400);
      await A.main.locator('[data-testid=mesh-place-addresses-palette] button').click();
      await A.main.locator('[data-testid=mesh-places]').scrollIntoViewIfNeeded().catch(() => undefined);
      await A.main.waitForTimeout(500);
      await shot(A.main, 'settings-mesh-places', false);
      await shot(A.main, 'settings-mesh-places', true);
    }
    tray = await api(A.main, 'mesh.trayPreview');
    check(!/Copy Mesh Address/.test(JSON.stringify(tray)) && /Keeper Mesh/.test(JSON.stringify(tray)), 'after unticking: no addresses in the tray, the switch still there');
    await A.main.keyboard.press('Control+K');
    await A.main.keyboard.type('mesh address');
    await A.main.waitForTimeout(700);
    check((await A.main.getByText('Copy Laptop’s Mesh Address').count()) === 0, 'and none in the palette');
    await A.main.keyboard.press('Escape');

    // ---- off: everything goes
    await api(A.main, 'mesh.setExit', null);
    s = await api(A.main, 'mesh.setOn', false);
    check(s.iface.state === 'off' && (await api(A.main, 'mesh.trayPreview')).every((r) => !/Exit Node/.test(r.label)), 'turning the mesh off removes it (and its exit-node picker leaves the tray)');
    check(!A.errors.length && !B.errors.length, `no errors in the windows${A.errors.length + B.errors.length ? `: ${[...A.errors, ...B.errors].join('; ')}` : ''}`);
  } finally {
    await A.app.close().catch(() => undefined);
    await B.app.close().catch(() => undefined);
    relay.kill();
  }
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
