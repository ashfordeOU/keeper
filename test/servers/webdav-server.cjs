// SPDX-License-Identifier: AGPL-3.0-or-later
// A small WebDAV server over a folder, for tests: user "ana", password "secret",
// served under /remote.php/dav/files/ana like Nextcloud.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const BASE = '/remote.php/dav/files/ana';

function start(rootDir, { port = 0 } = {}) {
  const local = (urlPath) => {
    const p = decodeURIComponent(urlPath.split('?')[0]);
    if (!p.startsWith(BASE)) return null;
    return path.join(rootDir, path.posix.normalize('/' + p.slice(BASE.length)).replace(/^(\.\.\/?)+/, ''));
  };
  const href = (rel, dir) => BASE + rel.split('/').map(encodeURIComponent).join('/') + (dir && !rel.endsWith('/') ? '/' : '');
  const prop = (rel, st) => `<d:response><d:href>${href(rel, st.isDirectory())}</d:href><d:propstat><d:prop>${st.isDirectory() ? '<d:resourcetype><d:collection/></d:resourcetype>' : `<d:resourcetype/><d:getcontentlength>${st.size}</d:getcontentlength><d:getcontenttype>application/octet-stream</d:getcontenttype>`}<d:getlastmodified>${st.mtime.toUTCString()}</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:quota-available-bytes/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`;
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Basic ' + Buffer.from('ana:secret').toString('base64')) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="test"' });
      return res.end();
    }
    const file = local(req.url);
    if (!file) { res.writeHead(404); return res.end(); }
    const rel = '/' + path.relative(rootDir, file).split(path.sep).filter(Boolean).join('/');
    const send = (code, body = '', headers = {}) => { res.writeHead(code, headers); res.end(body); };
    try {
      switch (req.method) {
        case 'PROPFIND': {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            if (!fs.existsSync(file)) return send(404);
            const st = fs.statSync(file);
            if (body.includes('quota-available-bytes') && req.headers.depth === '0') {
              return send(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${href(rel, true)}</d:href><d:propstat><d:prop><d:quota-available-bytes>1000000</d:quota-available-bytes><d:quota-used-bytes>2500</d:quota-used-bytes></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`, { 'content-type': 'application/xml' });
            }
            let out = prop(rel === '/' ? '' : rel, st);
            if (st.isDirectory() && req.headers.depth !== '0') {
              for (const n of fs.readdirSync(file)) out += prop(`${rel === '/' ? '' : rel}/${n}`, fs.statSync(path.join(file, n)));
            }
            send(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">${out}</d:multistatus>`, { 'content-type': 'application/xml; charset=utf-8' });
          });
          return;
        }
        case 'GET': {
          if (!fs.existsSync(file)) return send(404);
          const size = fs.statSync(file).size;
          const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
          if (m) {
            const start = m[1] ? +m[1] : 0;
            const end = m[2] ? +m[2] : size - 1;
            res.writeHead(206, { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
            return fs.createReadStream(file, { start, end }).pipe(res);
          }
          res.writeHead(200, { 'content-length': size });
          return fs.createReadStream(file).pipe(res);
        }
        case 'PUT': {
          const out = fs.createWriteStream(file);
          req.pipe(out);
          out.on('close', () => send(201));
          return;
        }
        case 'MKCOL':
          fs.mkdirSync(file);
          return send(201);
        case 'DELETE':
          fs.rmSync(file, { recursive: true, force: true });
          return send(204);
        case 'MOVE': {
          const dest = local(new URL(req.headers.destination).pathname);
          fs.renameSync(file, dest);
          return send(201);
        }
        default:
          return send(405);
      }
    } catch (e) {
      send(500, String(e));
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, base: BASE, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) })));
}

module.exports = { start, BASE };
