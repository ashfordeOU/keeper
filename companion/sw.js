// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeps the companion's page shell on the phone, so the installed app opens
// without a connection (it then says it is not connected). Data never goes
// in the cache: it travels over the encrypted channel only.
const SHELL = 'keeper-companion-1';
const FILES = ['./', 'app.js', 'manifest.webmanifest', 'icon.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !FILES.some((f) => u.pathname.endsWith(f === './' ? '/c/' : f))) return;
  // Network first (a newer Keeper has a newer page), the kept shell when offline.
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); void caches.open(SHELL).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
