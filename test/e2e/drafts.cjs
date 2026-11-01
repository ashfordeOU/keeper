// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage: npx vite --port 5182 &  node test/e2e/drafts.cjs [url]
// In the browser demo: typing into the assistant's question box and into a mail
// being written shows every letter at once, keeps the text when the page is left
// and opened again, and saves it with the tab (drafts survive a restart).
const { chromium } = require('playwright');

const URL = process.argv[2] || 'http://localhost:5182/';
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL);
  // A first-run tour may be showing; skip it.
  await p.locator('.tour').waitFor({ timeout: 6000 }).catch(() => undefined);
  await p.locator('.tour button', { hasText: /Skip/ }).click({ timeout: 2000 }).catch(() => undefined);

  // Assistant
  await p.click('.sidebar [title="Assistant"]');
  const ta = p.locator('.composer textarea');
  await ta.click();
  await p.keyboard.type('hello there', { delay: 20 });
  check((await ta.inputValue()) === 'hello there', 'the assistant box shows each letter as it is typed');
  await p.click('.sidebar [title="Home"]');
  await p.waitForTimeout(400);
  await p.click('.sidebar [title="Assistant"]');
  check((await p.locator('.composer textarea').inputValue()) === 'hello there', 'the question is still there after leaving the page');

  // Mail
  await p.click('.sidebar [title="Mail"]');
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: /Compose|New message|Write/i }).first().click().catch(async () => { await p.keyboard.press('c'); });
  await p.waitForSelector('.compose', { timeout: 5000 });
  const body = p.locator('.compose textarea').first();
  await body.click();
  await p.keyboard.type('Hi Ana, here is the plan', { delay: 15 });
  check((await body.inputValue()) === 'Hi Ana, here is the plan', 'a mail being written shows each letter as it is typed');
  await p.locator('.compose input[placeholder*="ubject" i], .compose .compose-field input').last().click().catch(() => undefined);
  await p.keyboard.type('Plans', { delay: 15 });
  check((await body.inputValue()) === 'Hi Ana, here is the plan', 'the mail text stays while another field is typed in');
  await p.waitForTimeout(1200);
  check((await p.evaluate(() => localStorage.getItem('demo.session') ?? '')).includes('here is the plan'), 'the mail draft is saved with the tab');

  check(errs.length === 0, `no page errors (${errs.slice(0, 2).join(' | ')})`);
  await b.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
