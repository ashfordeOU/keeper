// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/parity.cjs /tmp/kp /tmp/kp-shots
// Drives the real Keeper app through the newer tools that need the app itself
// (it draws PDF pages, prints HTML and web pages, reads text in pictures):
// Markdown and web pages to PDF, true PDF redaction, searchable scans, hiding
// faces, joining clips, reading aloud to MP3, ZIPs, and the Convert and
// Toolbox screens (palette → tool, Media tools, coordinates).
const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3]);
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const D = (...p) => path.join(HOME, 'Documents', ...p);
fs.writeFileSync(D('notes.md'), '# Trip notes\n\n- passport\n- **chargers**\n\nThe hotel is booked for three nights.\n');
fs.writeFileSync(D('read me.txt'), 'Keeper reads this sentence aloud into a file.');
const has = (cmd) => { try { execFileSync('which', [cmd]); return true; } catch { return false; } };
const ff = require(path.resolve(__dirname, '../../node_modules/ffmpeg-static'));
for (const n of ['a', 'b']) execFileSync(ff, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(HOME, 'Movies', `${n}.mp4`)], { stdio: 'ignore' });
const faces = process.env.KEEPER_FACES_PHOTO;
const speech = process.env.KEEPER_SPEECH_SAMPLE;
const sharp = require(path.resolve(__dirname, '../../node_modules/sharp'));
// A stand-in for ddcutil with one DDC display that remembers what it is set to.
const BIN = path.join(HOME, 'bin');
fs.mkdirSync(BIN, { recursive: true });
fs.writeFileSync(path.join(BIN, 'ddcutil'), `#!/bin/sh
S="${HOME}/ddc-state"
case "$*" in
  "detect --brief") printf 'Display 1\\n   I2C bus:  /dev/i2c-4\\n   Monitor:             DEL:DELL U2720Q:ABC123\\n' ;;
  *getvcp*) c=$(echo "$*" | sed -E 's/.*getvcp ([0-9a-f]+).*/\\1/'); v=$(cat "$S.$c" 2>/dev/null || echo 40); echo "VCP $c C $v 100" ;;
  *setvcp*) c=$(echo "$*" | sed -E 's/.*setvcp ([0-9a-f]+) ([0-9]+).*/\\1/'); v=$(echo "$*" | sed -E 's/.*setvcp ([0-9a-f]+) ([0-9]+).*/\\2/'); echo "$v" > "$S.$c" ;;
esac
`, { mode: 0o755 });
// An iPhone backup where libimobiledevice keeps them on Linux.
const BK = path.join(HOME, '.local/share/MobileSync/Backup/00008110-001A2B');
fs.mkdirSync(path.join(BK, 'aa'), { recursive: true });
fs.writeFileSync(path.join(BK, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>Device Name</key><string>Test iPhone</string><key>Product Type</key><string>iPhone16,1</string><key>Product Version</key><string>19.1</string><key>Last Backup Date</key><date>2026-10-28T09:00:00Z</date></dict></plist>');
fs.writeFileSync(path.join(BK, 'aa', 'blob'), Buffer.alloc(2_500_000));
fs.writeFileSync(D('notes.de.srt'), '1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\nSee you soon\n');
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };
const skip = (what) => console.log(`SKIP ${what}`);
const pdfText = (f) => (has('pdftotext') ? execFileSync('pdftotext', [f, '-']).toString() : '');

// A small local "web site" for Web page to PDF.
const site = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html><title>Menu</title><h1>Café Menu</h1>' + Array.from({ length: 80 }, (_, i) => `<p>Dish number ${i + 1} — tasty</p>`).join(''));
});

(async () => {
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${site.address().port}/`;
  // A stand-in local model for translation: answers "N: TEXT" in capitals.
  const llm = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const prompt = JSON.parse(body).messages.find((m) => m.role === 'user').content;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ message: { content: prompt.split('\n').map((l) => l.toUpperCase()).join('\n') } }));
    });
  });
  await new Promise((r) => llm.listen(0, '127.0.0.1', r));
  const app = await _electron.launch({ executablePath: path.resolve(__dirname, '../../node_modules/.bin/electron'), args: [path.resolve(__dirname, '../..'), '--no-sandbox'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', PATH: `${BIN}:${process.env.PATH}`, HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1320, height: 860 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  const run = (op, inputs, extra = {}) => main.evaluate(([o, i, x]) => window.keeper.convert.run({ op: o, inputs: i, ...x }), [op, inputs, extra]);
  const shot = async (name, dark) => {
    await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
    await main.waitForTimeout(500);
    await main.screenshot({ path: `${SHOTS}/${name}-${dark ? 'dark' : 'light'}.png` });
  };

  // ---- documents (the app prints HTML itself)
  const mdPdf = (await run({ tool: 'doc.toPdf', pageSize: 'a4', onePage: false }, [D('notes.md')])).outputs[0];
  check(/Trip notes/.test(pdfText(mdPdf)) && /three nights/.test(pdfText(mdPdf)), 'Markdown becomes a PDF with its text');
  const longPdf = (await run({ tool: 'doc.toPdf', pageSize: 'a4', onePage: true }, [D('notes.md')])).outputs[0];
  check(fs.existsSync(longPdf), 'Markdown as one long page');
  const web = await main.evaluate((u) => window.keeper.convert.webToPdf(u, { pageSize: 'a4', onePage: false }), url);
  check(web.startsWith(path.join(HOME, 'Downloads')), 'saved in Downloads');
  const webText = pdfText(web);
  check(/Café Menu/.test(webText) && /Dish number 80/.test(webText), 'a web page is saved as a PDF in Downloads, all of it');
  const webOne = await main.evaluate((u) => window.keeper.convert.webToPdf(u, { pageSize: 'a4', onePage: true }), url);
  check(has('pdfinfo') ? /Pages:\s+1\b/.test(execFileSync('pdfinfo', [webOne]).toString()) : fs.existsSync(webOne), 'a web page as one long page');

  // ---- PDF redaction with the app's own page drawing
  const red = await run({ tool: 'pdf.redact', words: 'three nights, passport', caseSensitive: false }, [mdPdf]);
  const redText = pdfText(red.outputs[0]);
  check(!/three nights/i.test(redText) && !/passport/i.test(redText) && /chargers/.test(redText) === false, 'redacted words are gone from the PDF (the page is rebuilt)');
  check(/Removed \d+ match/.test(red.message ?? ''), `redaction reports what it removed (${red.message})`);

  // ---- searchable scan with the app's own text reader (needs the language data download)
  try {
    const scan = (await run({ tool: 'doc.toPdf', pageSize: 'a4', onePage: false }, [D('read me.txt')])).outputs[0];
    const img = (await run({ tool: 'pdf.toImages', format: 'png', dpi: 150 }, [scan])).outputs[0];
    const asScan = (await run({ tool: 'image.toPdf', pageSize: 'a4' }, [img])).outputs[0];
    check(!/aloud/.test(pdfText(asScan)), 'a picture-only PDF has no text before');
    const s = await run({ tool: 'pdf.searchable' }, [asScan]);
    check(/aloud/i.test(pdfText(s.outputs[0])), `the scanned page becomes searchable (${s.message})`);
  } catch (e) {
    skip(`searchable scan: ${String(e.message || e).slice(0, 120)}`);
  }

  // ---- media
  const joined = await run({ tool: 'video.merge' }, [path.join(HOME, 'Movies/a.mp4'), path.join(HOME, 'Movies/b.mp4')]);
  check(fs.existsSync(joined.outputs[0]), 'two clips are joined');
  const info = await run({ tool: 'video.info' }, [joined.outputs[0]]);
  check(/Video: h264 320×240/.test(info.details ?? ''), 'what is inside the joined clip is shown');
  const gif = await run({ tool: 'video.convert', format: 'gif', width: 240, fps: 10 }, [path.join(HOME, 'Movies/a.mp4')]);
  check(fs.existsSync(gif.outputs[0]) && fs.readFileSync(gif.outputs[0]).subarray(0, 3).toString() === 'GIF', 'a clip becomes a GIF');
  fs.writeFileSync(path.join(HOME, 'Movies/a.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello subtitles\n');
  const subbed = await run({ tool: 'video.subtitles', fontSize: 22 }, [path.join(HOME, 'Movies/a.mp4')]);
  check(fs.existsSync(subbed.outputs[0]), 'subtitles are burnt in from the .srt next to the video');
  if (has('espeak-ng')) {
    const mp3 = await run({ tool: 'doc.speak', rate: 1, format: 'mp3' }, [D('read me.txt')]);
    check(fs.existsSync(mp3.outputs[0]) && fs.statSync(mp3.outputs[0]).size > 2000, 'text is read aloud into an MP3');
  } else skip('read aloud: espeak-ng is not installed');
  if (faces && fs.existsSync(faces)) {
    const f = await run({ tool: 'image.faces', style: 'pixelate' }, [faces]);
    check(/Hid [1-9]/.test(f.message ?? ''), `faces are found and hidden (${f.message})`);
    fs.copyFileSync(f.outputs[0], path.join(SHOTS, 'faces-hidden.jpg'));
  } else skip('faces: set KEEPER_FACES_PHOTO to a photo with faces');

  // ---- files
  const zip = await run({ tool: 'file.zip', password: 'pw' }, [D('notes.md'), D('read me.txt')]);
  const back = await run({ tool: 'file.unzip', password: 'pw' }, [zip.outputs[0]]);
  check(fs.readFileSync(path.join(back.outputs[0], 'notes.md'), 'utf8').includes('Trip notes'), 'a password ZIP is made and unpacked again');

  // ---- screens
  // A fresh profile starts with the welcome tour; and page tips may show once.
  for (const label of ['Skip tour', 'Got it']) {
    const b = main.locator('button', { hasText: label });
    if (await b.count()) await b.first().click().catch(() => undefined);
  }
  await main.keyboard.press('Control+k');
  await main.waitForTimeout(400);
  await main.keyboard.type('redact');
  await main.waitForTimeout(500);
  const hit = main.locator('.q-row', { hasText: 'PDF: Redact' }).first();
  check(await hit.count() > 0, 'the command palette finds “PDF: Redact”');
  if (await hit.count()) await hit.click();
  await main.waitForTimeout(900);
  check(await main.locator('.conv-panel h2', { hasText: 'Redact' }).count() > 0, 'it opens Convert on the Redact tool');
  await shot('convert-redact', false);
  for (const label of ['Skip tour', 'Got it']) { const b = main.locator('button', { hasText: label }); if (await b.count()) await b.first().click().catch(() => undefined); }
  await main.locator('.conv-tool', { hasText: 'Sign' }).first().click();
  await main.waitForTimeout(500);
  const pad = main.locator('canvas.sig-pad');
  await pad.scrollIntoViewIfNeeded();
  await main.waitForTimeout(300);
  const box = await pad.boundingBox();
  if (box) {
    await main.mouse.move(box.x + 30, box.y + 70);
    await main.mouse.down();
    for (let i = 0; i < 40; i++) await main.mouse.move(box.x + 30 + i * 9, box.y + 70 + Math.sin(i / 3) * 30);
    await main.mouse.up();
  }
  await main.waitForTimeout(300);
  check(await main.locator('img[alt="Your signature"]').count() > 0, 'a signature can be drawn');
  await main.evaluate(() => document.querySelector('.content')?.scrollTo({ top: 0 }));
  await shot('convert-sign', false);
  await shot('convert-sign', true);
  await main.locator('.conv-cats button', { hasText: 'Documents' }).click();
  await main.waitForTimeout(400);
  check(await main.locator('.conv-tool', { hasText: 'Read aloud to a file' }).count() > 0, 'the Documents category lists its tools');
  await shot('convert-documents', false);
  await main.locator('.conv-cats button', { hasText: 'Video' }).click();
  await main.waitForTimeout(400);
  await shot('convert-video', true);

  await main.evaluate(() => window.location.hash = '');
  await main.keyboard.press('Control+k');
  await main.keyboard.type('toolbox');
  await main.waitForTimeout(400);
  await main.keyboard.press('Enter');
  await main.waitForTimeout(900);
  const media = await main.locator('.section h3', { hasText: 'Media' }).count();
  check(media > 0, 'the Toolbox has a Media group (download video, record, web page to PDF)');
  await main.locator('.tool-card', { hasText: 'Coordinates' }).first().click();
  await main.waitForTimeout(500);
  check(await main.locator('text=59°26′13.2″N 24°45′13.0″E').count() > 0, 'coordinates are shown in every format');
  await shot('toolbox-coordinates', false);
  await main.locator('.tool-card', { hasText: 'Download video' }).first().click();
  await main.waitForTimeout(400);
  await shot('toolbox-download', true);

  await main.locator('.tool-card', { hasText: 'Placeholder text' }).first().click();
  await main.waitForTimeout(300);
  await main.locator('select').filter({ has: main.locator('option[value="markdown"]') }).first().selectOption('html');
  await main.waitForTimeout(200);
  check(await main.locator('.tool-out', { hasText: '<p>Lorem ipsum' }).count() > 0, 'placeholder text comes out as HTML');
  await main.locator('.tool-card', { hasText: 'Compare texts' }).first().click();
  await main.waitForTimeout(300);
  const areas = main.locator('textarea');
  await areas.nth(0).fill('one\ntwo\nthree');
  await areas.nth(1).fill('one\nTWO\nthree\nfour');
  await main.locator('button', { hasText: 'Side by side' }).click();
  await main.waitForTimeout(200);
  check(await main.locator('text=2 changed lines').count() + await main.locator('text=3 changed lines').count() > 0 && await main.locator('.diff-line.add', { hasText: 'TWO' }).count() === 1, 'texts compare side by side');
  await shot('toolbox-diff', false);

  // ---------------------------------------------------------------- the last gaps
  const nav = (r) => app.evaluate(({ BrowserWindow }, route) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('event:navigate', route)), r);
  for (const label of ['Skip tour', 'Got it']) { const b = main.locator('button', { hasText: label }); if (await b.count()) await b.first().click().catch(() => undefined); }

  // On-device transcription: the real model is downloaded (checksum-checked) and run here.
  if (speech && fs.existsSync(speech)) {
    const wav = path.join(HOME, 'Music', 'speech.wav');
    fs.copyFileSync(speech, wav);
    const t0 = Date.now();
    const srt = await run({ tool: 'audio.transcribe', format: 'srt', engine: 'device', model: 'tiny', language: 'auto' }, [wav]);
    const srtText = fs.readFileSync(srt.outputs[0], 'utf8');
    check(/ask not what your country can do for you/i.test(srtText) && /^1\n00:00:0\d,\d{3} --> /m.test(srtText), `speech becomes subtitles on this computer (${Math.round((Date.now() - t0) / 1000)} s incl. model download)`);
    const modelOk = fs.existsSync(path.join(HOME, '.config/Keeper/models/whisper-tiny/encoder_model_quantized.onnx'));
    check(modelOk, 'the speech model was downloaded once into Keeper’s models folder');
    const vid = path.join(HOME, 'Movies', 'talk.mp4');
    execFileSync(ff, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=0x333355:size=640x360:rate=25', '-i', wav, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid], { stdio: 'ignore' });
    const sub = await run({ tool: 'video.subtitles', auto: true, fontSize: 22, engine: 'device', model: 'tiny' }, [vid]);
    check(fs.existsSync(sub.outputs[0]) && fs.statSync(sub.outputs[0]).size > 20_000, 'automatic subtitles are burnt in from speech transcribed on this computer');
    execFileSync(ff, ['-hide_banner', '-y', '-ss', '3', '-i', sub.outputs[0], '-frames:v', '1', path.join(SHOTS, 'subtitles-on-device.png')], { stdio: 'ignore' });
  } else skip('on-device transcription: set KEEPER_SPEECH_SAMPLE to a speech recording');

  // Scan: a photo of a page at an angle is found, straightened and cleaned.
  const photo = path.join(HOME, 'Pictures', 'page.jpg');
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="100%" height="100%" fill="#3a3a40"/><polygon points="260,120 980,180 900,820 180,760" fill="#f4f1ea"/><g transform="matrix(0.99,0.08,-0.12,0.99,330,260)"><text font-size="44" font-family="DejaVu Sans" fill="#222">Invoice 2041</text><text y="70" font-size="30" font-family="DejaVu Sans" fill="#333">Total due: 128.40 EUR</text></g></svg>')).jpeg().toFile(photo);
  const scan = await run({ tool: 'image.scan', mode: 'bw', pageSize: 'fit' }, [photo]);
  check(/Straightened 1 of 1/.test(scan.message ?? ''), `a photographed page is found and straightened (${scan.message})`);
  if (has('pdftoppm')) execFileSync('pdftoppm', ['-png', '-r', '60', '-singlefile', scan.outputs[0], path.join(SHOTS, 'scan-straightened')]);

  // Phone camera: the companion page takes page photos and the computer makes the PDF.
  const linkOn = await main.evaluate(() => window.keeper.link.state()).catch(() => null);
  if (linkOn?.me?.port) {
    const invite = await main.evaluate(() => window.keeper.link.companionInvite(false));
    const local = invite.url.replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${linkOn.me.port}`);
    const { chromium, devices } = require('playwright');
    const browser = await chromium.launch();
    const phone = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
    await phone.goto(local);
    for (let i = 0; i < 50 && !(await main.getByText('Allow this phone?').count()); i++) await main.waitForTimeout(200);
    await main.getByRole('button', { name: 'Allow', exact: true }).click().catch(() => undefined);
    for (let i = 0; i < 50 && !(await phone.locator('#status').innerText()).includes('Connected'); i++) await phone.waitForTimeout(200);
    await phone.setInputFiles('#scan-shot', photo);
    for (let i = 0; i < 50 && !/1 page/.test(await phone.locator('#scan-pages').innerText()); i++) await phone.waitForTimeout(200);
    await phone.locator('#scan-make').click();
    for (let i = 0; i < 100 && !/Saved .*\.pdf/.test(await phone.locator('#msg').innerText().catch(() => '')); i++) await phone.waitForTimeout(200);
    const msgText = await phone.locator('#msg').innerText().catch(() => '');
    const made = fs.readdirSync(path.join(HOME, 'Downloads/Keeper')).filter((f) => f.endsWith('.pdf'));
    check(/Straightened 1 of 1/.test(msgText) && made.length === 1 && !fs.readdirSync(path.join(HOME, 'Downloads/Keeper')).some((f) => /^scan-.*\.jpe?g$/.test(f)), `a page photographed on a phone becomes a straightened PDF on the computer (${msgText.trim()})`);
    await phone.screenshot({ path: `${SHOTS}/phone-scan.png` });
    await browser.close();
  } else skip('phone scan: Keeper Link is off in this profile');

  // Visual PDF organizer.
  const four = D('four.pdf');
  {
    const { PDFDocument, StandardFonts } = require(path.resolve(__dirname, '../../node_modules/pdf-lib'));
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (let i = 1; i <= 4; i++) doc.addPage([300, 400]).drawText(`Page ${i}`, { x: 60, y: 200, size: 40, font });
    fs.writeFileSync(four, await doc.save());
  }
  await nav('convert:' + JSON.stringify({ tool: 'pdf.organize', files: [four] }));
  await main.waitForTimeout(800);
  for (let i = 0; i < 40 && (await main.locator('.org-page').count()) < 4; i++) await main.waitForTimeout(250);
  check(await main.locator('.org-page img').count() === 4, 'the organizer shows every page as a picture');
  // drag page 4 to the front, turn the new second page, remove the last one
  await main.locator('.org-page').nth(3).dragTo(main.locator('.org-page').nth(0));
  await main.waitForTimeout(300);
  await main.locator('.org-page').nth(1).locator('button[title="Turn right"]').click();
  await main.locator('.org-page').nth(3).locator('button[title="Remove page"]').click();
  await main.waitForTimeout(300);
  await shot('convert-organize', false);
  await shot('convert-organize', true);
  await main.locator('.conv-panel button.primary', { hasText: /Organize|Run|Start|Convert/ }).last().click().catch(() => undefined);
  let orgOut = '';
  for (let i = 0; i < 40 && !orgOut; i++) {
    await main.waitForTimeout(250);
    orgOut = fs.readdirSync(path.dirname(four), { recursive: true }).map(String).find((f) => /four organized\.pdf$/.test(f)) ?? '';
  }
  if (orgOut) {
    const full = path.join(path.dirname(four), orgOut);
    const text = pdfText(full).replace(/\s+/g, ' ');
    const info = has('pdfinfo') ? execFileSync('pdfinfo', [full]).toString() : '';
    check(/Pages:\s+3\b/.test(info) && text.indexOf('Page 4') < text.indexOf('Page 1') && text.indexOf('Page 1') < text.indexOf('Page 2') && !/Page 3/.test(text), `pages were reordered, turned and removed by dragging (${text.trim()})`);
  } else check(false, 'the organized PDF was saved');

  // Translation that keeps layout and timings, with the chosen AI (a stand-in local model here).
  await main.evaluate((u) => window.keeper.settings.set({ ai: { provider: 'ollama', model: 'test', ollamaUrl: u } }), `http://127.0.0.1:${llm.address().port}`);
  const tr = await run({ tool: 'doc.translate', language: 'de', engine: 'ai' }, [D('notes.md'), D('notes.de.srt')]);
  const mdOut = fs.readFileSync(tr.outputs.find((o) => o.endsWith('.md')), 'utf8');
  const srtOut = fs.readFileSync(tr.outputs.find((o) => o.endsWith('.srt')), 'utf8');
  check(/^# TRIP NOTES/m.test(mdOut) && /^- \*\*CHARGERS\*\*/m.test(mdOut), 'a Markdown file is translated with its marks kept');
  check(/00:00:01,000 --> 00:00:02,500\nHELLO THERE/.test(srtOut), 'subtitles are translated with their timings kept');
  await nav('convert:' + JSON.stringify({ tool: 'doc.translate', files: [D('notes.md')] }));
  await main.waitForTimeout(700);
  await shot('convert-translate', false);

  // Toolbox: external display controls (DDC/CI through ddcutil).
  await nav('tools');
  await main.waitForTimeout(700);
  await main.locator('.tool-card', { hasText: 'Display control' }).first().click();
  for (let i = 0; i < 40 && !(await main.getByText('DELL U2720Q ABC123').count()); i++) await main.waitForTimeout(250);
  check(await main.getByText('DELL U2720Q ABC123').count() > 0, 'the external display is listed with its controls');
  const contrast = main.locator('label', { hasText: 'Contrast' }).locator('input[type=range]').first();
  await contrast.evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '73'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  const volume = main.locator('label', { hasText: 'Volume' }).locator('input[type=range]').first();
  await volume.evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '22'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await main.waitForTimeout(1200);
  const st = (c) => { try { return fs.readFileSync(path.join(HOME, `ddc-state.${c}`), 'utf8').trim(); } catch { return ''; } };
  check(st('12') === '73' && st('62') === '22', `contrast and volume reach the display (contrast ${st('12')}, volume ${st('62')})`);
  await shot('toolbox-displays', false);
  await shot('toolbox-displays', true);

  // Storage: phone backups.
  await nav('space');
  await main.waitForTimeout(800);
  await main.locator('.phone-backups button', { hasText: 'Find backups' }).click();
  for (let i = 0; i < 40 && !(await main.getByText('Test iPhone').count()); i++) await main.waitForTimeout(250);
  check(await main.locator('.phone-backups', { hasText: 'Test iPhone' }).count() > 0 && await main.locator('.phone-backups', { hasText: 'iOS 19.1' }).count() > 0, 'iPhone backups are listed with device, version and size');
  await main.locator('.phone-backups').scrollIntoViewIfNeeded();
  await shot('storage-phone-backups', false);

  // Text capture works out the writing system by itself (Cyrillic here, with English chosen).
  const ru = path.join(HOME, 'Pictures', 'russian.png');
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="220"><rect width="100%" height="100%" fill="white"/><text x="30" y="90" font-size="46" font-family="DejaVu Sans">Добро пожаловать в наш магазин</text><text x="30" y="170" font-size="46" font-family="DejaVu Sans">Сегодня скидка двадцать процентов</text></svg>')).png().toFile(ru);
  try {
    const got = await main.evaluate((p) => window.keeper.capture.readFile(p), ru);
    check(/магазин/i.test(got.text ?? '') && /скидка/i.test(got.text ?? ''), `text in another writing system is read without choosing its language (${(got.text ?? '').replace(/\s+/g, ' ').slice(0, 60)})`);
  } catch (e) { check(false, 'automatic language detection: ' + e.message); }

  // PDF limits survive in the file (checked with qpdf when installed).
  if (has('qpdf')) {
    const locked = await run({ tool: 'pdf.encrypt', password: 'open', allowPrint: false, allowCopy: false }, [mdPdf]);
    const show = execFileSync('qpdf', ['--password=open', '--show-encryption', locked.outputs[0]]).toString();
    check(/print low resolution: not allowed/.test(show) && /extract for any purpose: not allowed/.test(show), 'a locked PDF keeps its print and copy limits');
  } else skip('PDF limits: qpdf is not installed');
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await app.close();
  site.close();
  llm.close();
})().catch((e) => { console.error(e); process.exit(1); });
