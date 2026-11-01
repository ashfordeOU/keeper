// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Talks to the built macOS helper the way Keeper does (one JSON message per
// line) and checks every method that needs no permission answers in the shape
// Keeper reads. Methods that need a permission (Accessibility, Input
// Monitoring, Screen Recording, Calendars) must still answer, with a plain
// "no" or an error, and never hang or crash the helper.
//
// Usage (macOS): node scripts/ci/helper-smoke.mjs native/macos/KeeperHelper/.build/apple/Products/Release/keeper-helper
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const BIN = path.resolve(process.argv[2] ?? 'native/macos/KeeperHelper/.build/apple/Products/Release/keeper-helper');
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failures++; };

const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = new Map();
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return console.log(`(not JSON) ${line}`); }
  const w = waiting.get(m.id);
  if (w) { waiting.delete(m.id); w(m); }
});
let next = 1;
const call = (method, params = {}, ms = 15_000) => new Promise((resolve) => {
  const id = next++;
  const t = setTimeout(() => { waiting.delete(id); resolve({ timeout: true }); }, ms);
  waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
  child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
});
const show = (v) => String(JSON.stringify(v)).slice(0, 300);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

const hello = await call('hello');
check(isObj(hello.result) && hello.result.version === '1' && typeof hello.result.macos === 'number' && typeof hello.result.arm === 'boolean' && typeof hello.result.appleModel === 'string', `hello ${show(hello.result)}`);

const lang = await call('language', { text: 'Bonjour à tous, nous allons parler de la météo aujourd’hui.' });
check(lang.result?.lang === 'fr', `language detects French ${show(lang.result)}`);

const ddc = await call('ddc.list');
check(typeof ddc.result?.displays === 'number', `ddc.list ${show(ddc.result)}`);

const modes = await call('stage.modes');
const ms = modes.result?.modes;
check(typeof modes.result?.display === 'number' && Array.isArray(ms) && ms.every((m) => typeof m.id === 'number' && m.width > 0 && m.height > 0 && typeof m.hidpi === 'boolean' && typeof m.current === 'boolean'), `stage.modes: display ${modes.result?.display}, ${ms?.length} modes, current ${show(ms?.find((m) => m.current))}`);

const wins = await call('stage.windows');
check(Array.isArray(wins.result?.windows) && wins.result.windows.every((w) => typeof w.owner === 'string' && typeof w.pid === 'number' && typeof w.layer === 'number'), `stage.windows: ${wins.result?.windows?.length} windows (${[...new Set(wins.result?.windows?.map((w) => w.owner))].slice(0, 6).join(', ')})`);

const cursor = await call('stage.cursorSize');
check(isObj(cursor.result) && 'size' in cursor.result && (cursor.result.size === null || typeof cursor.result.size === 'number'), `stage.cursorSize ${show(cursor.result)}`);

const focus = await call('voice.focus');
check(isObj(focus.result) && 'secure' in focus.result, `voice.focus ${show(focus.result)}`);

const mic = await call('voice.micState');
check(typeof mic.result?.inUse === 'boolean' && Array.isArray(mic.result?.apps), `voice.micState ${show(mic.result)}`);

const micApps = await call('calls.micApps');
check(typeof micApps.result?.perApp === 'boolean' && Array.isArray(micApps.result?.apps), `calls.micApps ${show(micApps.result)}`);

const muted = await call('calls.muted');
check(typeof muted.result?.muted === 'boolean' && typeof muted.result?.available === 'boolean', `calls.muted ${show(muted.result)}`);

const hud = await call('hud.levels');
check(isObj(hud.result) && (hud.result.volume === undefined || typeof hud.result.volume === 'number'), `hud.levels ${show(hud.result)}`);

const notif = await call('notifications.status');
check(typeof notif.result?.trusted === 'boolean' && typeof notif.result?.running === 'boolean', `notifications.status ${show(notif.result)}`);

const place = await call('place.measure');
check(Array.isArray(place.result?.screens) && place.result.screens.length > 0 && place.result.screens.every((x) => typeof x.id === 'number' && typeof x.width === 'number') && Array.isArray(place.result?.items), `place.measure ${show(place.result)}`);

const running = await call('apps.running', { bundles: ['com.apple.finder', 'io.example.not-installed'] });
check(Array.isArray(running.result?.running) && !running.result.running.includes('io.example.not-installed'), `apps.running ${show(running.result)}`);

// A CI runner may have no app in front; the answer is then an empty object, never a hang.
const frontNow = await call('front.now');
check(isObj(frontNow.result) && (frontNow.result.pid === undefined || (typeof frontNow.result.pid === 'number' && typeof frontNow.result.fullscreen === 'boolean')), `front.now ${show(frontNow.result)}`);

const wall = await call('desktop.getImage');
check(isObj(wall.result) && 'path' in wall.result, `desktop.getImage ${show(wall.result)}`);

const input = await call('input.status');
check(typeof input.result?.accessibility === 'boolean' && typeof input.result?.screenRecording === 'boolean', `input.status ${show(input.result)}`);

// Live Text on a picture with words in it.
let ocrImage;
try {
  const sharp = (await import('sharp')).default;
  ocrImage = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kh-')), 'words.png');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200"><rect width="100%" height="100%" fill="white"/><text x="40" y="130" font-family="Helvetica, Arial, sans-serif" font-size="88" fill="black">Keeper Helper</text></svg>';
  await sharp(Buffer.from(svg)).png().toFile(ocrImage);
} catch (e) { console.log(`INFO could not draw the test picture (${e.message})`); }
if (ocrImage) {
  const ocr = await call('ocr', { path: ocrImage, languages: ['en-US'] }, 60_000);
  check(typeof ocr.result?.text === 'string' && /keeper/i.test(ocr.result.text), `ocr reads the words in a picture ${show(ocr.result ?? ocr.error)}`);
}
const ocrMissing = await call('ocr', { path: '/nonexistent/picture.png' });
check(typeof ocrMissing.error === 'string', `ocr of a missing file is an error, not a crash: ${show(ocrMissing.error)}`);

// Asked without a permission: an answer, a plain error, or (EventKit) waiting for the person to answer
// the system's prompt, which nobody can on CI; the helper must keep answering everything else meanwhile.
const ekPending = call('eventkit.reminders', {}, 8000);
const meanwhile = await call('hello', {}, 5000);
check(!!meanwhile.result, 'the helper keeps answering while a permission prompt is open');
const ek = await ekPending;
if (ek.timeout) console.log('INFO eventkit.reminders waits for the Reminders permission prompt (nobody can answer it on CI)');
else check(Array.isArray(ek.result) || typeof ek.error === 'string', `eventkit.reminders answers ${show(ek.result ?? ek.error)}`);
const notifWatch = await call('notifications.watch', {}, 10_000);
const watchId = next - 1;
if (notifWatch.timeout) {
  console.log('INFO notifications.watch is watching (Accessibility is allowed on this machine); cancelling it');
  child.stdin.write(JSON.stringify({ id: watchId, method: 'cancel' }) + '\n');
}
else check(typeof notifWatch.error === 'string' || notifWatch.result, `notifications.watch answers ${show(notifWatch.result ?? notifWatch.error)}`);

const unknown = await call('no.such.method');
check(/Unknown method/.test(unknown.error ?? ''), `an unknown method is a clear error: ${show(unknown.error)}`);

// Still alive after all of that, and it leaves when its input closes.
const again = await call('hello');
check(!!again.result, 'the helper is still answering');
child.stdin.end();
const code = await new Promise((r) => { const t = setTimeout(() => { child.kill(); r('killed'); }, 45_000); child.on('exit', (c) => { clearTimeout(t); r(c); }); });
check(code === 0, `the helper exits when Keeper closes its input (${code})`);

console.log(failures ? `${failures} helper checks failed` : 'All helper checks passed');
process.exit(failures ? 1 : 0);
