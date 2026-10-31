// SPDX-License-Identifier: AGPL-3.0-or-later
// A small SFTP server over a folder, for tests: password "secret" for any user.

const fs = require('node:fs');
const path = require('node:path');
const { Server, utils } = require('ssh2');

const { OPEN_MODE, STATUS_CODE } = utils.sftp;

function start(rootDir, { password = 'secret', port = 0 } = {}) {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.password === password) return ctx.accept();
      ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map();
          let next = 0;
          const real = (p) => {
            const clean = path.posix.normalize('/' + String(p)).replace(/^(\.\.\/?)+/, '');
            return path.join(rootDir, clean);
          };
          const attrs = (st) => ({ mode: st.mode, uid: 0, gid: 0, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) });
          const handle = (v) => {
            const b = Buffer.alloc(4);
            b.writeUInt32BE(next);
            handles.set(next++, v);
            return b;
          };
          const get = (b) => handles.get(b.readUInt32BE(0));
          const fail = (id, e) => sftp.status(id, e && e.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE);
          sftp.on('REALPATH', (id, p) => sftp.name(id, [{ filename: path.posix.normalize('/' + p), longname: '', attrs: {} }]));
          sftp.on('STAT', (id, p) => fs.stat(real(p), (e, st) => (e ? fail(id, e) : sftp.attrs(id, attrs(st)))));
          sftp.on('LSTAT', (id, p) => fs.lstat(real(p), (e, st) => (e ? fail(id, e) : sftp.attrs(id, attrs(st)))));
          sftp.on('OPENDIR', (id, p) => fs.readdir(real(p), (e, names) => (e ? fail(id, e) : sftp.handle(id, handle({ dir: real(p), names, done: false })))));
          sftp.on('READDIR', (id, h) => {
            const d = get(h);
            if (!d || d.done) return sftp.status(id, STATUS_CODE.EOF);
            d.done = true;
            sftp.name(id, d.names.map((n) => {
              const st = fs.statSync(path.join(d.dir, n));
              return { filename: n, longname: n, attrs: attrs(st) };
            }));
          });
          sftp.on('OPEN', (id, p, flags) => {
            const mode = flags & OPEN_MODE.WRITE ? (flags & OPEN_MODE.APPEND ? 'a' : 'w') : 'r';
            fs.open(real(p), mode, (e, fd) => (e ? fail(id, e) : sftp.handle(id, handle({ fd }))));
          });
          sftp.on('READ', (id, h, offset, len) => {
            const { fd } = get(h);
            const buf = Buffer.alloc(len);
            fs.read(fd, buf, 0, len, offset, (e, n) => (e ? fail(id, e) : n ? sftp.data(id, buf.subarray(0, n)) : sftp.status(id, STATUS_CODE.EOF)));
          });
          sftp.on('WRITE', (id, h, offset, data) => {
            const { fd } = get(h);
            fs.write(fd, data, 0, data.length, offset, (e) => sftp.status(id, e ? STATUS_CODE.FAILURE : STATUS_CODE.OK));
          });
          sftp.on('CLOSE', (id, h) => {
            const v = get(h);
            handles.delete(h.readUInt32BE(0));
            if (v && v.fd !== undefined) fs.close(v.fd, () => sftp.status(id, STATUS_CODE.OK));
            else sftp.status(id, STATUS_CODE.OK);
          });
          sftp.on('MKDIR', (id, p) => fs.mkdir(real(p), (e) => sftp.status(id, e ? STATUS_CODE.FAILURE : STATUS_CODE.OK)));
          sftp.on('RMDIR', (id, p) => fs.rmdir(real(p), (e) => sftp.status(id, e ? STATUS_CODE.FAILURE : STATUS_CODE.OK)));
          sftp.on('REMOVE', (id, p) => fs.unlink(real(p), (e) => sftp.status(id, e ? STATUS_CODE.FAILURE : STATUS_CODE.OK)));
          sftp.on('RENAME', (id, a, b) => fs.rename(real(a), real(b), (e) => sftp.status(id, e ? STATUS_CODE.FAILURE : STATUS_CODE.OK)));
          sftp.on('SETSTAT', (id) => sftp.status(id, STATUS_CODE.OK));
          sftp.on('FSTAT', (id, h) => fs.fstat(get(h).fd, (e, st) => (e ? fail(id, e) : sftp.attrs(id, attrs(st)))));
        });
      });
    });
    client.on('error', () => undefined);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(() => r())) })));
}

module.exports = { start };

if (require.main === module) {
  start(process.argv[2] || process.cwd(), { port: Number(process.argv[3] || 0) }).then((s) => console.log(`SFTP on 127.0.0.1:${s.port}`));
}
