// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small FTP server over a folder, for tests: user "ana", password "secret".
// Passive mode only (PASV and EPSV), Unix-style LIST.

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function listLine(name, st) {
  const d = st.mtime;
  const date = `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${st.isDirectory() ? 'd' : '-'}rw-r--r-- 1 ana ana ${String(st.size).padStart(10, ' ')} ${date} ${name}`;
}

function start(rootDir, { port = 0 } = {}) {
  const server = net.createServer((sock) => {
    let cwd = '/';
    let user = '';
    let authed = false;
    let pasv = null;
    let rest = 0;
    let renameFrom = null;
    const reply = (s) => sock.write(s + '\r\n');
    const resolve = (p) => path.posix.normalize(p && p.startsWith('/') ? p : path.posix.join(cwd, p || '.'));
    const real = (p) => path.join(rootDir, resolve(p).replace(/^(\.\.\/?)+/, ''));
    const withData = (fn) => {
      if (!pasv) return reply('425 Use PASV first');
      const srv = pasv;
      pasv = null;
      const go = (data) => fn(data, () => srv.close());
      if (srv.conn) go(srv.conn);
      else srv.once('connection', go);
    };
    const openPasv = (cb) => {
      const srv = net.createServer();
      srv.once('connection', (c) => { srv.conn = c; });
      srv.listen(0, '127.0.0.1', () => { pasv = srv; cb(srv.address().port); });
    };
    reply('220 test ftp');
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const sp = line.indexOf(' ');
        const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
        const arg = sp < 0 ? '' : line.slice(sp + 1);
        if (!authed && !['USER', 'PASS', 'QUIT', 'FEAT', 'SYST', 'AUTH', 'OPTS'].includes(cmd)) { reply('530 Not logged in'); continue; }
        try {
          switch (cmd) {
            case 'USER': user = arg; reply('331 Password please'); break;
            case 'PASS': if (user === 'ana' && arg === 'secret') { authed = true; reply('230 Welcome'); } else reply('530 Login incorrect'); break;
            case 'AUTH': reply('502 No TLS here'); break;
            case 'SYST': reply('215 UNIX Type: L8'); break;
            case 'FEAT': reply('211-Features'); reply(' UTF8'); reply(' SIZE'); reply(' MDTM'); reply(' EPSV'); reply('211 End'); break;
            case 'OPTS': reply('200 OK'); break;
            case 'TYPE': reply('200 OK'); break;
            case 'PWD': reply(`257 "${cwd}"`); break;
            case 'CWD': { const t = resolve(arg); if (fs.existsSync(real(t)) && fs.statSync(real(t)).isDirectory()) { cwd = t; reply('250 OK'); } else reply('550 No such folder'); break; }
            case 'CDUP': cwd = path.posix.dirname(cwd); reply('250 OK'); break;
            case 'PASV': openPasv((p) => reply(`227 Entering Passive Mode (127,0,0,1,${p >> 8},${p & 255})`)); break;
            case 'EPSV': openPasv((p) => reply(`229 Entering Extended Passive Mode (|||${p}|)`)); break;
            case 'LIST': case 'NLST': {
              const target = real(arg.replace(/^-\S+\s*/, '') || '.');
              const names = fs.readdirSync(target);
              reply('150 Here it comes');
              withData((d, done) => {
                d.end(names.map((n) => (cmd === 'NLST' ? n : listLine(n, fs.statSync(path.join(target, n))))).join('\r\n') + (names.length ? '\r\n' : ''), () => { done(); reply('226 Done'); });
              });
              break;
            }
            case 'SIZE': reply(`213 ${fs.statSync(real(arg)).size}`); break;
            case 'MDTM': { const d = fs.statSync(real(arg)).mtime; reply(`213 ${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}`); break; }
            case 'REST': rest = Number(arg) || 0; reply('350 OK'); break;
            case 'RETR': {
              const file = real(arg);
              if (!fs.existsSync(file)) { reply('550 Not found'); break; }
              const start = rest;
              rest = 0;
              reply('150 Sending');
              withData((d, done) => {
                const s = fs.createReadStream(file, { start });
                s.pipe(d);
                d.on('close', () => { done(); reply('226 Done'); });
              });
              break;
            }
            case 'STOR': {
              const file = real(arg);
              reply('150 Ready');
              withData((d, done) => {
                const out = fs.createWriteStream(file);
                d.pipe(out);
                out.on('close', () => { done(); reply('226 Stored'); });
              });
              break;
            }
            case 'MKD': fs.mkdirSync(real(arg)); reply(`257 "${resolve(arg)}" created`); break;
            case 'RMD': fs.rmdirSync(real(arg)); reply('250 Removed'); break;
            case 'DELE': fs.unlinkSync(real(arg)); reply('250 Deleted'); break;
            case 'RNFR': renameFrom = real(arg); reply('350 Ready'); break;
            case 'RNTO': fs.renameSync(renameFrom, real(arg)); renameFrom = null; reply('250 Renamed'); break;
            case 'QUIT': reply('221 Bye'); sock.end(); break;
            default: reply('502 Not implemented');
          }
        } catch (e) {
          reply(`550 ${e.code || 'Failed'}`);
        }
      }
    });
    sock.on('error', () => undefined);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(() => r())) })));
}

module.exports = { start };
