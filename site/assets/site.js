// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's website: color scheme, the small-screen menu, copy buttons, download links that
// point at the newest release with a file for this computer (as scripts/install.sh picks it:
// a version can come out for macOS first, so this is not simply GitHub's latest release), and
// the interactive parts (their logic is in site/lib, tested in test/site.test.ts).
// No tracking: the only request is to GitHub's public release list, kept for ten minutes.
// Every interactive part is written out in the page, so it reads well without this script,
// and motion stops under prefers-reduced-motion.
import { PARTS, PIECES, estimate } from './lib/parts.mjs';
import { money, totals } from './lib/savings.mjs';
import { ago, search, size } from './lib/search-demo.mjs';
import { fromKey, fromPointer } from './lib/slider.mjs';
import { battery, clock, startsIn, tick } from './lib/island.mjs';
import { lidSteps, scene } from './lib/lid.mjs';
import { SLIDE_MS, nextPart, nextSlide, scrolled, tilt, wordsLit } from './lib/motion.mjs';

window.keeperSite = true;
(() => {
  'use strict';
  const REPO = 'ashfordeOU/keeper';
  const RELEASES = `https://github.com/${REPO}/releases`;
  const LIST = `https://api.github.com/repos/${REPO}/releases?per_page=50`;
  const root = document.documentElement;

  // ---------------------------------------------------------------- color scheme
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private window */ } },
  };
  function showTheme() {
    const t = root.dataset.theme || 'auto';
    for (const b of document.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === t));
  }
  for (const b of document.querySelectorAll('[data-theme-choice]')) {
    b.addEventListener('click', () => {
      const t = b.dataset.themeChoice;
      if (t === 'auto') { delete root.dataset.theme; store.set('keeper-site-theme', null); } else { root.dataset.theme = t; store.set('keeper-site-theme', t); }
      showTheme();
    });
  }
  showTheme();

  // ---------------------------------------------------------------- menu
  const menu = document.querySelector('.menu');
  const nav = document.getElementById('site-nav');
  if (menu && nav) {
    menu.addEventListener('click', () => {
      const open = menu.getAttribute('aria-expanded') !== 'true';
      menu.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('open', open);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); menu.focus(); } });
  }

  // ---------------------------------------------------------------- copy buttons
  for (const box of document.querySelectorAll('.cmd')) {
    const pre = box.querySelector('pre');
    if (!pre) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'copy'; b.textContent = 'Copy';
    b.setAttribute('aria-label', `Copy: ${pre.textContent}`);
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pre.textContent); b.textContent = 'Copied'; } catch (e) {
        const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected';
      }
      setTimeout(() => { b.textContent = 'Copy'; }, 1800);
    });
    box.appendChild(b);
  }

  // ---------------------------------------------------------------- this computer
  async function detect() {
    const ua = navigator.userAgent;
    const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    let os = 'unknown';
    if (/Android|iPhone|iPad|iPod/i.test(ua)) os = 'mobile';
    else if (/Mac/i.test(plat) || /Macintosh/.test(ua)) os = navigator.maxTouchPoints > 1 ? 'mobile' : 'mac';
    else if (/Win/i.test(plat) || /Windows/.test(ua)) os = 'windows';
    else if (/Linux|X11|CrOS/i.test(plat + ua)) os = 'linux';
    // Safari never says which Mac it runs on: Apple silicon is the likely one, Intel is offered next to it.
    let arch = os === 'mac' ? 'arm64' : 'x64';
    let sure = os !== 'mac';
    try {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        const v = await navigator.userAgentData.getHighEntropyValues(['architecture']);
        if (v.architecture === 'arm') { arch = 'arm64'; sure = true; } else if (v.architecture === 'x86') { arch = 'x64'; sure = true; }
      }
    } catch (e) { /* not offered */ }
    if (os === 'linux' && /aarch64|arm64|armv8/i.test(ua)) arch = 'arm64';
    return { os, arch, sure };
  }

  const FILE = {
    mac: { arm64: 'Keeper-mac-arm64.dmg', x64: 'Keeper-mac-x64.dmg' },
    windows: { x64: 'Keeper-setup-x64.exe', arm64: 'Keeper-setup-x64.exe' },
    linux: { x64: 'Keeper-linux-x86_64.AppImage', arm64: 'Keeper-linux-arm64.AppImage' },
  };
  const NAME = { mac: 'Mac', windows: 'Windows', linux: 'Linux' };
  const ARCH = { mac: { arm64: 'Apple silicon', x64: 'Intel' }, windows: { x64: '64-bit', arm64: '64-bit (runs on ARM too)' }, linux: { x64: 'x64 AppImage', arm64: 'ARM64 AppImage' } };

  // ---------------------------------------------------------------- releases
  let pending = null;
  function releases() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const c = JSON.parse(sessionStorage.getItem('keeper-releases') || 'null');
        if (c && Date.now() - c.t < 10 * 60 * 1000 && Array.isArray(c.list)) return c.list;
      } catch (e) { /* no storage */ }
      const r = await fetch(LIST, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const raw = await r.json();
      const list = raw.filter((x) => !x.draft).map((x) => ({
        tag: x.tag_name, pre: !!x.prerelease, date: x.published_at || x.created_at || '', page: x.html_url,
        assets: (x.assets || []).map((a) => ({ n: a.name, u: a.browser_download_url, s: a.size })),
      })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      try { sessionStorage.setItem('keeper-releases', JSON.stringify({ t: Date.now(), list })); } catch (e) { /* no storage */ }
      return list;
    })();
    return pending;
  }

  /** The newest release with the file (test builds marked as pre-releases are never offered). */
  function newestWith(list, name) {
    for (const rel of list) {
      if (rel.pre) continue;
      const a = rel.assets.find((x) => x.n === name);
      if (a) return { rel, url: a.u, size: a.s };
    }
    return null;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mb = (n) => (n ? `${Math.round(n / 1048576)} MB` : '');
  const ver = (tag) => tag.replace(/^v/, '');
  const assetUrl = (rel, name) => { const a = rel.assets.find((x) => x.n === name); return a ? a.u : null; };

  // A stable Mac release from 1.0.0 on (tags like v1.2.3) is signed and notarized.
  const notarized = (rel) => !rel.pre && /^v?([1-9]\d*)\.\d+\.\d+$/.test(rel.tag);

  // The big button on the home page.
  async function heroButton() {
    const btn = document.querySelector('[data-download]');
    if (!btn) return;
    const label = btn.querySelector('[data-dl-label]');
    const sub = btn.querySelector('[data-dl-sub]');
    const note = document.querySelector('[data-dl-note]');
    const { os, arch, sure } = await detect();
    const other = (html) => { if (note) note.innerHTML = html; };
    const allLink = btn.dataset.all || 'download/';
    if (!FILE[os]) {
      btn.href = allLink;
      label.textContent = 'See the downloads';
      sub.textContent = 'Keeper runs on macOS, Windows and Linux';
      return;
    }
    label.textContent = `Download for ${NAME[os]}`;
    sub.textContent = ARCH[os][arch];
    btn.href = allLink;
    try {
      const list = await releases();
      const hit = newestWith(list, FILE[os][arch]);
      if (!hit) { sub.textContent = `${ARCH[os][arch]} · coming soon`; return; }
      btn.href = hit.url;
      sub.textContent = [ARCH[os][arch], mb(hit.size)].filter(Boolean).join(' · ');
      const bits = [];
      // Mac builds are signed with Ashforde's Developer ID and notarized from 1.0.0.
      if (os === 'mac' && notarized(hit.rel)) bits.push('Signed and notarized by Apple');
      if (os === 'mac') {
        const otherArch = arch === 'arm64' ? 'x64' : 'arm64';
        const alt = newestWith(list, FILE.mac[otherArch]);
        if (alt) bits.push(`${sure ? 'Not this Mac?' : 'Intel Mac?'} <a href="${esc(alt.url)}">Download for ${ARCH.mac[otherArch]}</a>`);
      }
      bits.push(`<a href="${allLink}">Other systems and formats</a>`);
      other(bits.join(' · '));
    } catch (e) {
      sub.textContent = `${ARCH[os][arch]} · from the Releases page`;
      other(`Pick the file for your computer on <a href="${RELEASES}">GitHub Releases</a>, or see <a href="${allLink}">all downloads</a>.`);
    }
  }

  // The download page: every file link points at the newest release that has it.
  async function fileLinks() {
    const links = document.querySelectorAll('a[data-asset]');
    if (!links.length) return;
    const here = await detect();
    const card = document.getElementById(here.os);
    if (card && card.classList.contains('os')) {
      card.classList.add('here');
      const flag = card.querySelector('[data-here]');
      if (flag) flag.hidden = false;
    }
    const line = document.querySelector('[data-release-line]');
    try {
      const list = await releases();
      for (const a of links) {
        const hit = newestWith(list, a.dataset.asset);
        const info = a.querySelector('span');
        if (!hit) { if (info) info.textContent = 'coming soon'; continue; }
        a.href = hit.url;
        if (info) info.textContent = [mb(hit.size), ver(hit.rel.tag)].filter(Boolean).join(' · ');
      }
      if (line) {
        const main = FILE[here.os] ? newestWith(list, FILE[here.os][here.arch]) : null;
        const rel = main ? main.rel : list.find((r) => !r.pre);
        if (rel) {
          const sums = assetUrl(rel, 'SHA256SUMS.txt');
          const sig = assetUrl(rel, 'SHA256SUMS.txt.sigstore.json');
          const day = rel.date ? new Date(rel.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
          line.innerHTML = `<b>Keeper ${esc(ver(rel.tag))}</b>${day ? ` · ${day}` : ''} · <a href="${esc(rel.page)}">Release notes and every file</a>${sums ? ` · <a href="${esc(sums)}">SHA256SUMS.txt</a>` : ''}${sig ? ` · <a href="${esc(sig)}">Sigstore bundle</a>` : ''}`;
          line.hidden = false;
        }
      }
    } catch (e) {
      if (line) { line.innerHTML = `Couldn't reach GitHub just now; every file is on the <a href="${RELEASES}">Releases page</a>.`; line.hidden = false; }
    }
  }


  // ================================================================ interactive parts
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const base = new URL('./', import.meta.url).href; // …/assets/

  // ---------------------------------------------------------------- scroll reveal
  function reveal() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;
    if (calm.matches || !('IntersectionObserver' in window)) { for (const el of items) el.classList.add('in'); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    for (const el of items) io.observe(el);
  }

  // ---------------------------------------------------------------- on screen
  // Endless loops (glows, steam, the menu bar) run only while their part is on screen.
  function live() {
    const items = document.querySelectorAll('[data-live]');
    if (!items.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.target.classList.toggle('live', e.isIntersecting && !calm.matches);
    }, { threshold: 0.1 });
    for (const el of items) io.observe(el);
  }

  // ---------------------------------------------------------------- a statement lights up
  // Word by word, from faint to full, as it scrolls up the screen. Without the script or with
  // reduced motion it's simply all there.
  function statement() {
    const box = document.querySelector('[data-say]');
    if (!box || calm.matches) return;
    const words = [];
    const split = (node) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 1) { split(n); continue; }
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const frag = document.createDocumentFragment();
        for (const part of n.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(part); continue; }
          const w = Object.assign(document.createElement('span'), { className: 'w', textContent: part });
          words.push(w);
          frag.append(w);
        }
        n.replaceWith(frag);
      }
    };
    split(box);
    let frame = 0;
    const paint = () => {
      frame = 0;
      const n = wordsLit(box.getBoundingClientRect().top, innerHeight, words.length);
      words.forEach((w, i) => w.classList.toggle('on', i < n));
    };
    const ask = () => { if (!frame) frame = requestAnimationFrame(paint); };
    addEventListener('scroll', ask, { passive: true });
    addEventListener('resize', ask, { passive: true });
    paint();
  }

  // ---------------------------------------------------------------- the hero laptop leans
  // A few degrees towards the pointer, and back as the page scrolls away. Only with a mouse
  // or trackpad for the pointer, never with reduced motion, and only while it's on screen.
  function heroTilt() {
    const box = document.querySelector('[data-tilt]');
    if (!box || calm.matches) return;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    let x = null; let y = null; let frame = 0; let on = true;
    const paint = () => {
      frame = 0;
      const r = box.getBoundingClientRect();
      const hero = box.closest('.hero') || box;
      const h = hero.getBoundingClientRect();
      const t = tilt({ x, y, rect: r, scroll: scrolled(h.top, h.height) });
      box.style.setProperty('--rx', `${t.rx}deg`);
      box.style.setProperty('--ry', `${t.ry}deg`);
    };
    const ask = () => { if (on && !frame) frame = requestAnimationFrame(paint); };
    if (fine) {
      box.closest('.hero')?.addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; ask(); }, { passive: true });
      box.closest('.hero')?.addEventListener('pointerleave', () => { x = null; y = null; ask(); });
    }
    addEventListener('scroll', ask, { passive: true });
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { on = es[0].isIntersecting; }).observe(box);
  }

  // ---------------------------------------------------------------- slideshows in a monitor
  /**
   * Shows a new picture in a monitor: a copy of the current one is changed by `set` and
   * slides in over it (at once with reduced motion).
   */
  function slideTo(panel, set) {
    const all = [...panel.querySelectorAll('.shot')];
    const cur = all.at(-1);
    for (const f of all.slice(0, -1)) f.remove();
    cur.classList.remove('enter', 'in', 'leave');
    if (calm.matches) { set(cur); return; }
    const next = cur.cloneNode(true);
    set(next);
    next.classList.add('enter');
    cur.after(next);
    const img = [...next.querySelectorAll('img')].find((i) => getComputedStyle(i).display !== 'none');
    const go = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      next.classList.add('in');
      cur.classList.add('leave');
      setTimeout(() => { if (cur.isConnected) cur.remove(); next.classList.remove('enter', 'in'); }, 650);
    }));
    (img && img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(go);
  }

  /**
   * Moves a slideshow on every few seconds while it's on screen, unless the person paused
   * it or is pointing at or working in it. Never with reduced motion.
   * @returns {{ restart(): void }}
   */
  function slideshow(box, monitor, advance, what) {
    const btn = box.querySelector('[data-pause]');
    if (calm.matches || !btn || !monitor || !('IntersectionObserver' in window)) return { restart() {} };
    monitor.style.setProperty('--slide', `${SLIDE_MS}ms`);
    let paused = false; let hold = false; let seen = false; let t = 0;
    const restart = () => {
      clearTimeout(t);
      monitor.classList.remove('running');
      if (!seen || paused || hold) return;
      void monitor.offsetWidth; // start the progress line again
      monitor.classList.add('running');
      t = setTimeout(() => { advance(); restart(); }, SLIDE_MS);
    };
    const name = () => btn.setAttribute('aria-label', `${paused ? 'Play' : 'Pause'} the ${what} slideshow`);
    name();
    btn.hidden = false;
    btn.addEventListener('click', () => {
      paused = !paused;
      btn.setAttribute('aria-pressed', String(paused));
      btn.querySelector('[data-pause-label]').textContent = paused ? 'Play' : 'Pause';
      btn.querySelector('[data-icon-pause]').toggleAttribute('hidden', paused);
      btn.querySelector('[data-icon-play]').toggleAttribute('hidden', !paused);
      name();
      restart();
    });
    const holdOn = (v) => () => { if (hold !== v) { hold = v; restart(); } };
    monitor.addEventListener('pointerenter', holdOn(true));
    monitor.addEventListener('pointerleave', holdOn(false));
    box.addEventListener('focusin', (e) => { if (e.target !== btn) holdOn(true)(); });
    box.addEventListener('focusout', holdOn(false));
    new IntersectionObserver((es) => { seen = es[0].isIntersecting; restart(); }, { threshold: 0.4 }).observe(monitor);
    return { restart };
  }

  // ---------------------------------------------------------------- build your Keeper
  function builder() {
    const box = document.querySelector('[data-builder]');
    if (!box) return;
    const all = estimate(PARTS.map((p) => p.id)).total;
    const monitor = box.querySelector('.monitor');
    const panel = monitor.querySelector('.panel');
    const title = box.querySelector('[data-preview-title]');
    const shotFile = (name, theme) => `${base}shots/${name}-${theme}.webp`;
    let shown = PARTS.find((p) => p.on)?.id ?? null;
    const show = (part) => {
      if (!part || part.id === shown) return;
      shown = part.id;
      title.textContent = part.name;
      slideTo(panel, (fig) => {
        for (const t of ['light', 'dark']) {
          const img = fig.querySelector(`[data-preview="${t}"]`);
          if (!img) continue;
          img.src = shotFile(part.shot, t);
          img.alt = `${part.name} in Keeper`;
        }
      });
    };
    const isOn = () => [...box.querySelectorAll('.sw[aria-checked="true"]')].map((b) => b.dataset.part);
    const show2 = slideshow(box, monitor, () => { const id = nextPart(PARTS, isOn(), shown); if (id) show(PARTS.find((p) => p.id === id)); }, 'parts');
    const update = (lastId) => {
      const on = [...box.querySelectorAll('.sw[aria-checked="true"]')].map((b) => b.dataset.part);
      const est = estimate(on);
      box.querySelector('[data-total]').textContent = `About ${est.total} MB`;
      box.querySelector('[data-count]').textContent = `${est.count} of ${PARTS.length} parts on`;
      for (const k of Object.keys(PIECES)) {
        const has = est.pieces.some((p) => p.id === k);
        const bar = box.querySelector(`.bar i[data-piece="${k}"]`);
        if (bar) bar.style.width = has ? `${(PIECES[k].mb / all) * 100}%` : '0%';
        const leg = box.querySelector(`.legend li[data-piece="${k}"]`);
        if (leg) leg.hidden = !has;
      }
      for (const li of box.querySelectorAll('[data-runs]')) li.hidden = !on.includes(li.dataset.runs);
      box.querySelector('[data-runs-none]').hidden = on.length > 0;
      if (lastId && on.includes(lastId)) show(PARTS.find((p) => p.id === lastId));
      else if (lastId) show(PARTS.find((p) => on.includes(p.id)));
    };
    for (const b of box.querySelectorAll('.sw')) {
      b.addEventListener('click', () => {
        b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true'));
        update(b.dataset.part);
        show2.restart();
      });
    }
  }

  // ---------------------------------------------------------------- try the Island
  function island() {
    const stage = document.querySelector('[data-island]');
    if (!stage) return;
    const mock = stage.querySelector('.isl-mock');
    const pill = stage.querySelector('.isl-pill');
    const q = (k) => stage.querySelector(`[data-isl-${k}]`);
    const SONGS = [
      { title: 'Morning Light', who: 'Ana Sol · Coast', length: 214, lyric: 'Every small thing has a place after all' },
      { title: 'Tidewater', who: 'Ana Sol · Coast', length: 262, lyric: 'The water knows the way back home' },
    ];
    let state = { playing: true, song: 42, length: SONGS[0].length, track: 0, timer: 25 * 60, timerOn: false, meeting: 12 };
    const hover = window.matchMedia('(hover: hover)');
    const setOpen = (open, focus) => {
      mock.classList.toggle('open', open);
      pill.setAttribute('aria-expanded', String(open));
      if (open && focus) q('play').focus();
      if (!open && focus) pill.focus();
    };
    const paint = () => {
      const s = SONGS[state.track];
      stage.querySelector('.music b').textContent = s.title;
      stage.querySelector('.music .muted').textContent = s.who;
      stage.querySelector('.isl-pill .l span:last-child').textContent = s.title;
      q('lyric').textContent = s.lyric;
      q('pos').textContent = clock(state.song);
      q('len').textContent = clock(state.length);
      q('scrub').style.width = `${(state.song / state.length) * 100}%`;
      q('play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
      q('play').querySelector('[data-icon-pause]').toggleAttribute('hidden', !state.playing);
      q('play').querySelector('[data-icon-play]').toggleAttribute('hidden', state.playing);
      stage.querySelector('.eq').classList.toggle('paused', !state.playing || calm.matches);
      q('timer').textContent = clock(state.timer);
      q('timer-btn').textContent = state.timerOn ? 'Pause' : state.timer < 25 * 60 ? 'Resume' : 'Start';
      q('pill-right').textContent = state.timerOn || state.timer < 25 * 60 ? clock(state.timer) : '76%';
      q('in').textContent = startsIn(state.meeting);
      const b = battery(76);
      q('batt').className = `batt ${b.tone}`;
      q('batt').querySelector('i').style.width = `${b.fill * 100}%`;
      q('batt-pct').textContent = `${b.percent}%`;
      const d = new Date();
      q('clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };
    pill.addEventListener('click', () => setOpen(!mock.classList.contains('open'), true));
    q('close').addEventListener('click', () => setOpen(false, true));
    mock.addEventListener('mouseenter', () => { if (hover.matches) setOpen(true, false); });
    mock.addEventListener('mouseleave', () => { if (hover.matches && !mock.contains(document.activeElement)) setOpen(false, false); });
    mock.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mock.classList.contains('open')) { e.preventDefault(); setOpen(false, true); } });
    document.addEventListener('pointerdown', (e) => { if (!mock.contains(e.target) && mock.classList.contains('open')) setOpen(false, false); });
    q('play').addEventListener('click', () => { state.playing = !state.playing; paint(); });
    q('prev').addEventListener('click', () => { state.song = 0; paint(); });
    q('next').addEventListener('click', () => { state.track = (state.track + 1) % SONGS.length; state.length = SONGS[state.track].length; state.song = 0; state.playing = true; paint(); });
    q('timer-btn').addEventListener('click', () => { if (state.timer === 0) state.timer = 25 * 60; state.timerOn = !state.timerOn; paint(); });
    q('join').addEventListener('click', () => {
      const j = q('join');
      const joined = j.classList.toggle('joined');
      j.textContent = joined ? 'Joined' : 'Join';
    });
    // The clock runs only while the Island is on screen.
    let timer = 0;
    const run = (on) => {
      clearInterval(timer);
      if (on) timer = setInterval(() => { state = tick(state, 1); paint(); }, 1000);
    };
    // It opens by itself the first time it comes into view, to show what's inside.
    let shown = false;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => {
        const on = es[0].isIntersecting;
        run(on);
        if (on && !shown) { shown = true; setTimeout(() => setOpen(true, false), calm.matches ? 0 : 700); }
      }, { threshold: 0.5 }).observe(stage);
    }
    paint();
  }

  // ---------------------------------------------------------------- search demo
  function searchDemo() {
    const box = document.querySelector('[data-search]');
    if (!box) return;
    const input = box.querySelector('input');
    const list = box.querySelector('.sres');
    const chips = box.querySelectorAll('.chips button');
    const row = (f, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--i', String(i));
      li.innerHTML = `<span class="kind ${esc(f.kind)}" aria-hidden="true">${esc(f.kind === 'screenshot' ? 'png' : f.kind.slice(0, 4))}</span><span class="t"><span class="name">${esc(f.name)}</span><span class="meta">${esc(f.why)} · ${esc(ago(f.days))} · ${esc(size(f.mb))}</span></span>`;
      return li;
    };
    let last = input.value;
    const run = () => {
      const q = input.value;
      if (q === last && list.children.length) return;
      last = q;
      const hits = search(q);
      list.replaceChildren(...(hits.length ? hits.map(row) : [Object.assign(document.createElement('li'), { className: 'empty', textContent: q.trim() ? 'Nothing in the demo files. Try a suggestion.' : 'Type a search, or pick one.' })]));
      for (const c of chips) c.setAttribute('aria-pressed', String(c.textContent === q));
    };
    let t = 0;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 140); });
    for (const c of chips) c.addEventListener('click', () => { input.value = c.textContent; run(); });
  }

  // ---------------------------------------------------------------- before and after
  function sliders() {
    for (const box of document.querySelectorAll('[data-compare]')) {
      const range = box.querySelector('input[type="range"]');
      const set = (v) => { box.style.setProperty('--pos', `${v}%`); range.value = String(v); range.setAttribute('aria-valuetext', `${Math.round(v)}% light`); };
      range.addEventListener('input', () => set(Number(range.value)));
      range.addEventListener('keydown', (e) => {
        const v = fromKey(Number(range.value), e.key, e.shiftKey);
        if (v == null) return;
        e.preventDefault();
        set(v);
      });
      // Dragging anywhere on the picture (mouse, pen or a finger moving sideways).
      let dragging = false;
      box.addEventListener('pointerdown', (e) => { dragging = true; box.setPointerCapture(e.pointerId); const r = box.getBoundingClientRect(); set(fromPointer(e.clientX, r.left, r.width)); });
      box.addEventListener('pointermove', (e) => { if (!dragging) return; const r = box.getBoundingClientRect(); set(fromPointer(e.clientX, r.left, r.width)); });
      const stop = () => { dragging = false; };
      box.addEventListener('pointerup', stop);
      box.addEventListener('pointercancel', stop);
      set(Number(range.value));
    }
  }

  // ---------------------------------------------------------------- theme switcher
  function themes() {
    const box = document.querySelector('[data-themes]');
    if (!box) return;
    const tabs = [...box.querySelectorAll('[role="tab"]')];
    const panel = box.querySelector('[role="tabpanel"]');
    const screen = panel.querySelector('.panel');
    let current = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const pick = (tab, focus) => {
      for (const t of tabs) { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }
      panel.setAttribute('aria-labelledby', tab.id);
      if (focus) tab.focus();
      if (tabs.indexOf(tab) === current) return;
      current = tabs.indexOf(tab);
      const now = box.querySelector('[data-theme-now]');
      if (now) now.textContent = tab.dataset.name;
      slideTo(screen, (fig) => { const img = fig.querySelector('[data-theme-img]'); img.src = tab.dataset.src; img.alt = `Keeper's Home in the ${tab.dataset.name} theme`; });
    };
    // The themes take turns on the monitor; picking one starts the count again.
    const show = slideshow(box, panel, () => pick(tabs[nextSlide(current, tabs.length)], false), 'themes');
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => { pick(t, false); show.restart(); });
      t.addEventListener('keydown', (e) => {
        const n = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (n == null) return;
        e.preventDefault();
        pick(tabs[(n + tabs.length) % tabs.length], true);
        show.restart();
      });
    });
  }

  // ---------------------------------------------------------------- what you'd otherwise pay
  function savings() {
    const box = document.querySelector('[data-savings]');
    if (!box) return;
    const sum = box.querySelector('[data-sum]');
    const update = () => { sum.textContent = money(totals([...box.querySelectorAll('input:checked')].map((i) => i.value))); };
    box.addEventListener('change', update);
    update();
  }

  // ---------------------------------------------------------------- Keeper + Monorail: the lid
  function lidDemo() {
    const box = document.querySelector('[data-lid]');
    if (!box) return;
    const mac = box.querySelector('.mac');
    const list = box.querySelector('[data-lid-steps]');
    const who = { keeper: box.querySelector('[data-who="keeper"]'), monorail: box.querySelector('[data-who="monorail"]'), none: box.querySelector('[data-who="none"]') };
    const btn = box.querySelector('[data-lid-play]');
    const opts = { ready: box.querySelector('[name="ready"]'), plugged: box.querySelector('[name="plugged"]') };
    let timer = 0;
    let steps = [];
    const show = (i) => {
      const s = steps[i];
      [...list.children].forEach((li, n) => { li.classList.toggle('now', n === i); li.classList.toggle('done', n < i); });
      const sc = scene(s);
      mac.dataset.lid = sc.lid;
      mac.dataset.screen = sc.screen;
      if (sc.glow) mac.dataset.glow = sc.glow; else delete mac.dataset.glow;
      for (const [k, el] of Object.entries(who)) if (el) el.classList.toggle('on', k === s.who);
    };
    const render = () => {
      steps = lidSteps({ keeperReady: opts.ready.checked, pluggedIn: opts.plugged.checked });
      list.replaceChildren(...steps.map((s) => Object.assign(document.createElement('li'), { textContent: s.text })));
    };
    const play = () => {
      clearTimeout(timer);
      render();
      list.classList.add('playing');
      let i = 0;
      const next = () => { show(i); i += 1; if (i < steps.length) timer = setTimeout(next, calm.matches ? 1400 : 1800); else btn.textContent = 'Play again'; };
      btn.textContent = 'Playing…';
      next();
    };
    btn.addEventListener('click', play);
    for (const o of Object.values(opts)) o.addEventListener('change', () => { clearTimeout(timer); render(); list.classList.remove('playing'); mac.dataset.lid = 'open'; mac.dataset.screen = 'strip'; delete mac.dataset.glow; for (const el of Object.values(who)) el?.classList.remove('on'); btn.textContent = 'Play'; });
    render();
  }

  // ---------------------------------------------------------------- features: where you are
  function featureNav() {
    const nav = document.querySelector('.feat-nav');
    if (!nav || !('IntersectionObserver' in window)) return;
    const links = new Map([...nav.querySelectorAll('a')].map((a) => [a.getAttribute('href').slice(1), a]));
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
      const best = [...links.keys()].find((id) => (seen.get(id) || 0) > 0);
      if (!best) return;
      for (const [id, a] of links) {
        const on = id === best;
        a.classList.toggle('on', on);
        if (on) { a.setAttribute('aria-current', 'location'); if (window.matchMedia('(max-width: 900px)').matches) a.scrollIntoView({ block: 'nearest', inline: 'center', behavior: calm.matches ? 'auto' : 'smooth' }); } else a.removeAttribute('aria-current');
      }
    }, { rootMargin: '-120px 0px -55% 0px', threshold: [0, 0.01] });
    for (const id of links.keys()) { const el = document.getElementById(id); if (el) io.observe(el); }
  }

  reveal();
  live();
  statement();
  heroTilt();
  builder();
  island();
  searchDemo();
  sliders();
  themes();
  savings();
  lidDemo();
  featureNav();

  heroButton();
  fileLinks();
})();
