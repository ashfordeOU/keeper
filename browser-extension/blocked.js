// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's block page: shown instead of a site while Keeper blocks it for
// Focus. "Let me in" waits a few seconds first, then asks Keeper, which says
// yes (for a few minutes) or no (strict mode). When the block ends, the page
// offers to open the site again.

const api = globalThis.browser ?? globalThis.chrome;
const q = new URLSearchParams(location.search);
const site = q.get('site') ?? '';
// The original address is everything after "u=" (it is not encoded).
const raw = location.search.indexOf('&u=');
const target = raw >= 0 ? location.search.slice(raw + 3) : `https://${site}/`;
const $ = (id) => document.getElementById(id);

$('site').textContent = site || 'This site';
document.title = `${site || 'This site'} is paused`;

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

async function state() {
  try { return (await api.storage.local.get('focusBlock')).focusBlock ?? null; } catch { return null; }
}

async function render() {
  const b = await state();
  const blocked = b && b.sites.some((s) => site === s || site.endsWith(`.${s}`)) && (!b.until || b.until > Date.now());
  if (!blocked) {
    $('title').textContent = 'The break is over';
    $('why').textContent = 'Keeper is not blocking this site any more.';
    $('pass').hidden = true;
    $('back').textContent = 'Open the page';
    $('back').onclick = () => { location.href = target; };
    return;
  }
  $('why').textContent = [b.until ? `Until ${clock(b.until)}` : '', b.why].filter(Boolean).join(' · ');
  $('pass').textContent = `Let me in for ${b.passMinutes} minute${b.passMinutes === 1 ? '' : 's'}`;
  $('pass').hidden = !!b.strict;
  if (b.strict) $('note').textContent = 'Strict mode is on, so there are no short visits until the block ends.';
}

$('back').onclick = () => { if (history.length > 1) history.back(); else window.close(); };

let timer;
$('pass').onclick = async () => {
  const b = await state();
  if (!b) return;
  $('actions').hidden = true;
  $('wait').hidden = false;
  let left = b.waitSeconds;
  const tick = () => {
    $('confirm').disabled = left > 0;
    $('confirm').textContent = left > 0 ? `Open it (${left})` : 'Open it';
    if (left-- > 0) timer = setTimeout(tick, 1000);
    else $('confirm').focus();
  };
  tick();
};
$('cancel').onclick = () => { clearTimeout(timer); $('wait').hidden = true; $('actions').hidden = false; $('pass').focus(); };
$('confirm').onclick = async () => {
  $('confirm').disabled = true;
  $('note').textContent = 'Asking Keeper…';
  try {
    const r = await api.runtime.sendMessage({ kind: 'focusPass', site });
    if (r && r.ok) location.href = target;
    else { $('note').textContent = (r && r.message) || 'Keeper did not answer. Is it running?'; $('cancel').click(); }
  } catch {
    $('note').textContent = 'Keeper did not answer. Is it running?';
    $('cancel').click();
  }
};

void render();
// The block may end (or change) while the page is open.
api.storage.onChanged.addListener((c) => { if (c.focusBlock) void render(); });
setInterval(() => void render(), 30_000);
