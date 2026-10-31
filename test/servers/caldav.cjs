// SPDX-License-Identifier: AGPL-3.0-or-later
// A small CalDAV server for tests: one user (ana / secret), a calendar home
// with "Work" (events) and "Tasks" (to-dos), well-known redirect, PROPFIND,
// calendar-query, calendar-multiget, sync-collection with tokens, PUT and
// DELETE with ETags. Enough to exercise Keeper's client end to end.
const http = require('http');
const crypto = require('crypto');

function startCalDav() {
  const cals = {
    '/dav/cal/ana/work/': { name: 'Work', color: '#FF2968FF', comps: ['VEVENT'], items: new Map() },
    '/dav/cal/ana/tasks/': { name: 'Tasks', color: '#0A84FFFF', comps: ['VTODO'], items: new Map() },
  };
  let token = 1;
  const changes = []; // { token, href, deleted }
  const log = [];
  const auth = 'Basic ' + Buffer.from('ana:secret').toString('base64');
  const ms = (inner) => `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">${inner}</d:multistatus>`;
  const ok = (href, props) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      log.push({ method: req.method, url: req.url, depth: req.headers.depth, body });
      const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (url === '/.well-known/caldav') { res.writeHead(301, { location: '/dav/' }); return res.end(); }
      if (req.headers.authorization !== auth) { res.writeHead(401, { 'www-authenticate': 'Basic realm="test"' }); return res.end(); }
      const send = (code, text, headers = {}) => { res.writeHead(code, { 'content-type': 'application/xml; charset=utf-8', ...headers }); res.end(text); };
      if (req.method === 'PROPFIND') {
        if (url === '/dav/' || url === '/dav') return send(207, ms(ok('/dav/', '<d:current-user-principal><d:href>/dav/principals/ana/</d:href></d:current-user-principal>')));
        if (url === '/dav/principals/ana/') return send(207, ms(ok(url, '<c:calendar-home-set><d:href>/dav/cal/ana/</d:href></c:calendar-home-set><d:displayname>Ana</d:displayname>')));
        if (url === '/dav/cal/ana/') {
          let inner = ok(url, '<d:resourcetype><d:collection/></d:resourcetype>');
          for (const [href, c] of Object.entries(cals)) {
            inner += ok(href, `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>${c.name}</d:displayname><a:calendar-color>${c.color}</a:calendar-color><cs:getctag>${token}</cs:getctag><d:sync-token>http://test/sync/${token}</d:sync-token><c:supported-calendar-component-set>${c.comps.map((x) => `<c:comp name="${x}"/>`).join('')}</c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>`);
          }
          return send(207, ms(inner));
        }
        const cal = cals[url];
        if (cal) return send(207, ms([...cal.items.entries()].map(([h, it]) => ok(h, `<d:getetag>${it.etag}</d:getetag>`)).join('')));
        return send(404, '');
      }
      if (req.method === 'REPORT') {
        const cal = cals[url];
        if (!cal) return send(404, '');
        if (body.includes('sync-collection')) {
          const from = Number((body.match(/sync\/(\d+)/) ?? [])[1] ?? 0);
          if (body.match(/<d:sync-token>[^<]+<\/d:sync-token>/) && !from) return send(403, '<error/>');
          const seen = new Set();
          let inner = '';
          for (const ch of changes.filter((x) => x.token > from && x.href.startsWith(url)).reverse()) {
            if (seen.has(ch.href)) continue;
            seen.add(ch.href);
            inner += ch.deleted || !cal.items.has(ch.href) ? `<d:response><d:href>${ch.href}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>` : ok(ch.href, `<d:getetag>${cal.items.get(ch.href).etag}</d:getetag>`);
          }
          return send(207, ms(inner + `<d:sync-token>http://test/sync/${token}</d:sync-token>`));
        }
        const hrefs = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => m[1]);
        const wanted = body.includes('calendar-multiget') ? hrefs : [...cal.items.keys()];
        const comp = (body.match(/comp-filter name="(VEVENT|VTODO)"/) ?? [])[1];
        const inner = wanted.filter((h) => cal.items.has(h)).filter((h) => !comp || cal.items.get(h).data.includes(`BEGIN:${comp}`)).map((h) => ok(h, `<d:getetag>${cal.items.get(h).etag}</d:getetag><c:calendar-data>${esc(cal.items.get(h).data)}</c:calendar-data>`)).join('');
        return send(207, ms(inner));
      }
      const calHref = Object.keys(cals).find((h) => url.startsWith(h) && url !== h);
      const cal = calHref && cals[calHref];
      if (req.method === 'PUT' && cal) {
        const cur = cal.items.get(url);
        if (req.headers['if-none-match'] === '*' && cur) return send(412, '');
        if (req.headers['if-match'] && (!cur || cur.etag !== req.headers['if-match'])) return send(412, '');
        const etag = `"${crypto.createHash('md5').update(body).digest('hex').slice(0, 12)}"`;
        cal.items.set(url, { data: body, etag });
        changes.push({ token: ++token, href: url });
        res.writeHead(cur ? 204 : 201, { etag });
        return res.end();
      }
      if (req.method === 'DELETE' && cal) {
        if (!cal.items.has(url)) return send(404, '');
        cal.items.delete(url);
        changes.push({ token: ++token, href: url, deleted: true });
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'GET' && cal && cal.items.has(url)) { res.writeHead(200, { 'content-type': 'text/calendar', etag: cal.items.get(url).etag }); return res.end(cal.items.get(url).data); }
      send(405, '');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({
      port, url: `http://127.0.0.1:${port}/`, cals, log,
      /** puts an object on the server as if another app had added it */
      put(cal, name, data) { const href = `${cal}${name}`; const etag = `"x${Date.now()}"`; cals[cal].items.set(href, { data, etag }); changes.push({ token: ++token, href }); return href; },
      remove(href) { for (const c of Object.values(cals)) if (c.items.delete(href)) changes.push({ token: ++token, href, deleted: true }); },
      stop: () => new Promise((r) => server.close(r)),
    });
  }));
}

module.exports = { startCalDav };
