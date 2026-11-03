// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's website: colour scheme, the small-screen menu, copy buttons, and download links
// that point at the newest release with a file for this computer (as scripts/install.sh picks
// it: a version can come out for macOS first, so this is not simply GitHub's latest release).
// No tracking: the only request is to GitHub's public release list, kept for ten minutes.
(() => {
  'use strict';
  const REPO = 'ashfordeOU/keeper';
  const RELEASES = `https://github.com/${REPO}/releases`;
  const LIST = `https://api.github.com/repos/${REPO}/releases?per_page=50`;
  const root = document.documentElement;

  // ---------------------------------------------------------------- colour scheme
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

  /** The newest stable release with the file; when none has it yet, the newest beta with it. */
  function newestWith(list, name) {
    const find = (beta) => {
      for (const rel of list) {
        if (rel.pre && !beta) continue;
        const a = rel.assets.find((x) => x.n === name);
        if (a) return { rel, url: a.u, size: a.s };
      }
      return null;
    };
    return find(false) || find(true);
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
    btn.href = RELEASES;
    try {
      const list = await releases();
      const hit = newestWith(list, FILE[os][arch]);
      if (!hit) throw new Error('no release has this file yet');
      btn.href = hit.url;
      sub.textContent = [ARCH[os][arch], `version ${ver(hit.rel.tag)}`, mb(hit.size)].filter(Boolean).join(' · ');
      const bits = [];
      // Mac builds are signed with Ashforde's Developer ID and notarized from 1.0.0; betas before it were not.
      if (os === 'mac' && notarized(hit.rel)) bits.push('Signed and notarized by Apple');
      if (os === 'mac') {
        const otherArch = arch === 'arm64' ? 'x64' : 'arm64';
        const alt = newestWith(list, FILE.mac[otherArch]);
        if (alt) bits.push(`${sure ? 'Not this Mac?' : 'Intel Mac?'} <a href="${esc(alt.url)}">Download for ${ARCH.mac[otherArch]}</a>`);
      }
      if (hit.rel.pre) bits.push('No stable version has this file yet, so this is the newest beta');
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
        if (!hit) { if (info) info.textContent = 'not released yet'; continue; }
        a.href = hit.url;
        if (info) info.textContent = [mb(hit.size), ver(hit.rel.tag)].filter(Boolean).join(' · ');
      }
      if (line) {
        const main = FILE[here.os] ? newestWith(list, FILE[here.os][here.arch]) : null;
        const rel = main ? main.rel : (list.find((r) => !r.pre) || list[0]);
        if (rel) {
          const sums = assetUrl(rel, 'SHA256SUMS.txt');
          const sig = assetUrl(rel, 'SHA256SUMS.txt.sigstore.json');
          const day = rel.date ? new Date(rel.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
          line.innerHTML = `<b>Keeper ${esc(ver(rel.tag))}</b>${rel.pre ? ' <span class="pill">beta</span>' : ''}${day ? ` · ${day}` : ''} · <a href="${esc(rel.page)}">Release notes and every file</a>${sums ? ` · <a href="${esc(sums)}">SHA256SUMS.txt</a>` : ''}${sig ? ` · <a href="${esc(sig)}">Sigstore bundle</a>` : ''}`;
          line.hidden = false;
        }
      }
    } catch (e) {
      if (line) { line.innerHTML = `Couldn't reach GitHub just now; every file is on the <a href="${RELEASES}">Releases page</a>.`; line.hidden = false; }
    }
  }

  heroButton();
  fileLinks();
})();
