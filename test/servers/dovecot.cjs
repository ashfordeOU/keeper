// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Starts a throwaway Dovecot IMAP server (if Dovecot is installed) for the
// mail tests: one user "ana" with password "secret", plain IMAP on 127.0.0.1.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function dovecotPath() {
  for (const p of ['/usr/sbin/dovecot', '/usr/local/sbin/dovecot', '/opt/homebrew/sbin/dovecot']) if (fs.existsSync(p)) return p;
  return null;
}

/** opts.password: the user's password (default "secret") */
async function startDovecot(opts = {}) {
  const password = opts.password || 'secret';
  const bin = dovecotPath();
  if (!bin) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-dovecot-'));
  const port = await freePort();
  const me = os.userInfo();
  // Dovecot refuses to run its login processes as root; installed packages provide these users.
  const root = me.uid === 0;
  // Mail is never stored as root: as root, the mailbox belongs to the dovecot user.
  const uid = root ? Number(execFileSync('id', ['-u', 'dovecot']).toString().trim()) : me.uid;
  const gid = root ? Number(execFileSync('id', ['-g', 'dovecot']).toString().trim()) : me.gid;
  fs.writeFileSync(path.join(dir, 'passwd'), `ana:{PLAIN}${password}:${uid}:${gid}::${dir}/home/ana\n`);
  fs.mkdirSync(path.join(dir, 'home/ana'), { recursive: true });
  if (root) fs.chownSync(path.join(dir, 'home/ana'), uid, gid);
  // The auth process runs as another user and must be able to read the password file.
  if (root) { fs.chmodSync(dir, 0o755); fs.chmodSync(path.join(dir, 'passwd'), 0o644); }
  const conf = `
protocols = imap
listen = 127.0.0.1
base_dir = ${dir}/run
state_dir = ${dir}/state
log_path = ${dir}/dovecot.log
ssl = no
disable_plaintext_auth = no
auth_mechanisms = plain login
mail_location = maildir:~/Maildir
default_login_user = ${root ? 'dovenull' : me.username}
default_internal_user = ${root ? 'dovecot' : me.username}
default_internal_group = ${root ? 'dovecot' : me.username}
first_valid_uid = 1
passdb {
  driver = passwd-file
  args = scheme=PLAIN ${dir}/passwd
}
userdb {
  driver = passwd-file
  args = ${dir}/passwd
}
service imap-login {
  inet_listener imap {
    address = 127.0.0.1
    port = ${port}
  }
  inet_listener imaps {
    port = 0
  }
}
service anvil {
  chroot =
}
service imap-login {
  chroot =
}
namespace inbox {
  inbox = yes
  mailbox Sent {
    special_use = \\Sent
    auto = create
  }
  mailbox Trash {
    special_use = \\Trash
    auto = create
  }
  mailbox Archive {
    special_use = \\Archive
    auto = create
  }
  mailbox Drafts {
    special_use = \\Drafts
    auto = create
  }
}
`;
  fs.writeFileSync(path.join(dir, 'dovecot.conf'), conf);
  const child = spawn(bin, ['-F', '-c', path.join(dir, 'dovecot.conf')], { stdio: 'ignore' });
  // Wait until it answers.
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise((r) => { const s = net.connect(port, '127.0.0.1', () => { s.end(); r(true); }); s.on('error', () => r(false)); });
    if (ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    port, dir,
    log: () => { try { return fs.readFileSync(path.join(dir, 'dovecot.log'), 'utf8'); } catch { return ''; } },
    stop: () => { child.kill('SIGTERM'); try { execFileSync('sleep', ['0.2']); } catch { /* */ } fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

/**
 * Writes `count` generated messages straight into the user's Maildir (much
 * faster than sending them one by one), two thirds marked read, plus a
 * nested folder "Projects/2026" with 40 unread ones. Returns the Maildir path.
 */
function fillMaildir(server, count) {
  const md = path.join(server.dir, 'home/ana/Maildir');
  for (const sub of ['cur', 'new', 'tmp', '.Projects/cur', '.Projects/new', '.Projects/tmp', '.Projects.2026/cur', '.Projects.2026/new', '.Projects.2026/tmp']) fs.mkdirSync(path.join(md, sub), { recursive: true });
  const t = Math.floor(Date.now() / 1000);
  const msg = (i) => {
    const d = new Date(Date.now() - (count - i) * 600_000);
    return [`From: Sender ${i % 97} <s${i % 97}@example.org>`, 'To: Ana <ana@example.org>', `Subject: Message number ${i}`, `Message-ID: <m${i}@example.org>`, `Date: ${d.toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain', '', `Body of message ${i}.`, ''].join('\r\n');
  };
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(md, 'cur', `${t}.M${i}P1.keeper:2,${i % 3 ? 'S' : ''}`), msg(i));
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(md, '.Projects.2026/cur', `${t}.N${i}P1.keeper:2,`), msg(count + i));
  fs.writeFileSync(path.join(md, 'subscriptions'), 'Projects\nProjects.2026\n');
  if (os.userInfo().uid === 0) execFileSync('chown', ['-R', 'dovecot:dovecot', path.join(server.dir, 'home/ana')]);
  return md;
}

module.exports = { startDovecot, freePort, fillMaildir };
