// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small POP3 server for the tests (RFC 1939: USER, PASS, STAT, UIDL, RETR,
// DELE, QUIT): one user "ana" with the given password, messages held in memory.
const net = require('net');

function startPop3({ password = 'secret', messages = [] } = {}) {
  const box = messages.map((raw, i) => ({ uid: `u${i + 1}-${Buffer.from(raw).length}`, raw, deleted: false }));
  const log = [];
  const server = net.createServer((sock) => {
    let user = '';
    let authed = false;
    const marked = new Set();
    sock.write('+OK keeper test server ready\r\n');
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const [cmd, ...args] = line.split(' ');
        const c = cmd.toUpperCase();
        log.push(c === 'PASS' ? 'PASS ***' : line);
        const live = box.filter((m) => !m.deleted);
        if (c === 'USER') { user = args[0]; sock.write('+OK\r\n'); }
        else if (c === 'PASS') { authed = user === 'ana' && args.join(' ') === password; sock.write(authed ? '+OK logged in\r\n' : '-ERR [AUTH] invalid login\r\n'); }
        else if (!authed && c !== 'QUIT') sock.write('-ERR log in first\r\n');
        else if (c === 'STAT') sock.write(`+OK ${live.length} ${live.reduce((n, m) => n + m.raw.length, 0)}\r\n`);
        else if (c === 'UIDL') sock.write(`+OK\r\n${live.map((m, j) => `${j + 1} ${m.uid}`).join('\r\n')}${live.length ? '\r\n' : ''}.\r\n`);
        else if (c === 'RETR') { const m = live[Number(args[0]) - 1]; if (!m) sock.write('-ERR no such message\r\n'); else sock.write(`+OK\r\n${m.raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')}\r\n.\r\n`); }
        else if (c === 'DELE') { const m = live[Number(args[0]) - 1]; if (m) marked.add(m); sock.write(m ? '+OK\r\n' : '-ERR no such message\r\n'); }
        else if (c === 'QUIT') { for (const m of marked) m.deleted = true; sock.end('+OK bye\r\n'); }
        else sock.write('-ERR unknown\r\n');
      }
    });
    sock.on('error', () => undefined);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port, log, box,
    add: (raw) => box.push({ uid: `u${box.length + 1}-${Buffer.from(raw).length}`, raw, deleted: false }),
    stop: () => new Promise((r) => server.close(r)),
  })));
}

module.exports = { startPop3 };
