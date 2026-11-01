// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/remote.cjs /tmp/kr /tmp/kr-shots
// Drives the real Keeper app against SFTP and WebDAV servers started here:
// adds an SFTP connection through the dialog (Test, then Add), browses it,
// gets a picture's thumbnail and opens it in Quick Look, downloads a file,
// uploads one, and lists a Nextcloud-style WebDAV folder.
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3]);
const SERVER = path.join(HOME, '..', path.basename(HOME) + '-server');
for (const d of [HOME, SERVER]) fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Downloads', 'Documents', 'Desktop', 'Pictures']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
for (const d of ['Photos', 'Backups', 'USB Seagate 4TB']) fs.mkdirSync(path.join(SERVER, d), { recursive: true });
fs.writeFileSync(path.join(SERVER, 'hello.txt'), 'hello from the NAS\n');
fs.writeFileSync(path.join(HOME, 'Documents', 'to-upload.txt'), 'made on this computer\n');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };

(async () => {
  // A sunset-coloured picture for the thumbnail.
  await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 245, g: 120, b: 60 } } })
    .composite([{ input: Buffer.from('<svg width="640" height="480"><circle cx="320" cy="300" r="120" fill="#ffd166"/><rect y="330" width="640" height="150" fill="#1d3557"/></svg>'), top: 0, left: 0 }])
    .jpeg().toFile(path.join(SERVER, 'Photos', 'Sunset.jpg'));
  const sftp = await require('../servers/sftp-server.cjs').start(SERVER);
  const dav = await require('../servers/webdav-server.cjs').start(SERVER);

  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 40 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1280, height: 820 }).catch(() => undefined);
  await main.waitForTimeout(2000);
  const shot = async (name, dark) => {
    await main.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
    await main.waitForTimeout(500);
    await main.screenshot({ path: `${SHOTS}/${name}-${dark ? 'dark' : 'light'}.png` });
  };

  try {
    // ---- the sidebar section is there, empty
    const add = main.locator('.nav-item.add-conn');
    check(await add.isVisible(), 'Cloud & Servers is in the sidebar with an Add button');

    // ---- the cloud tab says honestly that rclone is missing in this build
    await add.click();
    await main.waitForSelector('.conn-tabs', { timeout: 10000 });
    await main.waitForTimeout(1500);
    const note = await main.locator('.conn-note').first().innerText().catch(() => '');
    check(/rclone/.test(note), `without rclone the cloud tab says so (“${note.slice(0, 80)}…”)`);

    // ---- add an SFTP server through the dialog
    await main.getByRole('tab', { name: /Server/ }).click();
    const form = main.locator('.conn-form');
    await form.locator('input').nth(0).fill('127.0.0.1');
    await form.locator('label:has-text("User name") input').fill('ana');
    await form.locator('label:has-text("Password") input').fill('secret');
    await form.locator('label:has-text("Port") input').fill(String(sftp.port));
    await form.locator('label:has-text("Name in Keeper") input').fill('Studio NAS');
    await form.getByRole('button', { name: 'Test' }).click();
    await main.waitForSelector('.conn-note.ok', { timeout: 15000 });
    check(true, 'Test reports the connection works');
    await shot('add-server', false);
    await form.getByRole('button', { name: 'Add' }).click();

    // ---- it opens straight away
    await main.waitForSelector('.remote-card', { timeout: 15000 });
    const folderNames = await main.locator('.folder-item .ellipsis').allInnerTexts();
    check(['Photos', 'Backups', 'USB Seagate 4TB'].every((n) => folderNames.some((f) => f.includes(n))), 'browsing shows the server’s folders');
    check((await main.locator('.remote-name', { hasText: 'hello.txt' }).count()) === 1, 'and its files');
    check((await main.locator('.conn-row', { hasText: 'Studio NAS' }).count()) === 1, 'the connection is listed in the sidebar');
    check((await main.locator('.conn-row .conn-dot.connected').count()) === 1, 'with a green dot');
    await main.waitForTimeout(500);
    await shot('browse-root', false);
    await shot('browse-root', true);

    // ---- a picture: thumbnail as it comes into view, Quick Look on double-click
    await main.locator('.folder-item', { hasText: 'Photos' }).dblclick();
    await main.waitForSelector('.remote-card >> text=Sunset.jpg', { timeout: 10000 });
    let thumb = null;
    for (let i = 0; i < 30 && !thumb; i++) {
      thumb = await main.locator('.remote-thumb img').first().getAttribute('src').catch(() => null);
      if (!thumb) await main.waitForTimeout(300);
    }
    check(!!thumb && thumb.startsWith('data:image'), 'the picture gets a thumbnail');
    await shot('photos', false);
    await main.locator('.remote-card', { hasText: 'Sunset.jpg' }).dblclick();
    await main.waitForSelector('.ql', { timeout: 15000 });
    check(true, 'double-click opens it in Quick Look');
    await main.waitForTimeout(800);
    await shot('quicklook', true);
    await main.keyboard.press('Escape');
    await main.waitForTimeout(400);

    // ---- download through the menu
    await main.locator('.crumbs button').first().click();
    await main.waitForSelector('.remote-card >> text=hello.txt', { timeout: 10000 });
    await main.locator('.remote-card', { hasText: 'hello.txt' }).click({ button: 'right' });
    await main.locator('.menu button', { hasText: /^Download$/ }).click();
    const got = path.join(HOME, 'Downloads', 'hello.txt');
    for (let i = 0; i < 30 && !fs.existsSync(got); i++) await main.waitForTimeout(200);
    check(fs.existsSync(got) && fs.readFileSync(got, 'utf8') === 'hello from the NAS\n', 'Download puts the file in Downloads, byte for byte');

    // ---- upload (the same call a drop makes)
    const conns = await main.evaluate(() => window.keeper.remote.list());
    const id = conns.connections[0].id;
    const up = await main.evaluate(([cid, p]) => window.keeper.remote.upload(cid, '/Backups', [p]), [id, path.join(HOME, 'Documents', 'to-upload.txt')]);
    check(up.done === 1 && fs.readFileSync(path.join(SERVER, 'Backups', 'to-upload.txt'), 'utf8') === 'made on this computer\n', 'uploading copies a file onto the server');

    // ---- new folder through the dialog
    await main.getByRole('button', { name: /New Folder/ }).click();
    await main.locator('.modal input, [role=dialog] input').first().fill('From Keeper');
    await main.locator('#rm-ok').click();
    for (let i = 0; i < 20 && !fs.existsSync(path.join(SERVER, 'From Keeper')); i++) await main.waitForTimeout(200);
    check(fs.existsSync(path.join(SERVER, 'From Keeper')), 'New Folder makes the folder on the server');

    // ---- the password stays only for this session here (no keychain in this container)
    check(!fs.readFileSync(path.join(HOME, '.config', 'Keeper', 'remote', 'connections.json'), 'utf8').includes('secret'), 'the password is never written to the connections file');

    // ---- WebDAV (Nextcloud-style path), added through the API
    const w = await main.evaluate(([port, base]) => window.keeper.remote.save({ kind: 'webdav', name: 'Nextcloud', host: '127.0.0.1', port, root: base, user: 'ana', password: 'secret', secure: false, device: 'server' }), [dav.port, dav.base]);
    const davList = await main.evaluate((cid) => window.keeper.remote.listDir(cid, '/Photos'), w.connection.id);
    check(davList.length === 1 && davList[0].name === 'Sunset.jpg', 'a WebDAV connection lists its folders');
    const q = await main.evaluate((cid) => window.keeper.remote.quota(cid), w.connection.id);
    check(q && q.total === 1002500, 'and reports its space');

    // ---- the network tab works with nobody answering
    await main.locator('.nav-item.add-conn').click();
    await main.getByRole('tab', { name: /On this network/ }).click();
    await main.waitForTimeout(3500);
    const lan = await main.locator('.lan-list, .conn-note').first().innerText().catch(() => '');
    check(lan.length > 0, 'looking on the network finishes (here: nobody answers)');
    await main.keyboard.press('Escape');

    check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  } catch (e) {
    console.log('FAIL', e.message);
    process.exitCode = 1;
    await main.screenshot({ path: `${SHOTS}/failure.png` }).catch(() => undefined);
  } finally {
    await app.close();
    await sftp.close();
    await dav.close();
  }
})();
