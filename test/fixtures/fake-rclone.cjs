#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A stand-in for rclone, for end-to-end tests of drives on machines without it
// (test/e2e/drives.cjs). `rcd` answers the few remote-control calls drives use;
// every call is written to $KEEPER_FAKE_RCLONE_LOG, and `vfs/stats` reports as
// many waiting changes as $KEEPER_FAKE_RCLONE_QUEUE holds. It mounts nothing.

const fs = require('node:fs');
const http = require('node:http');

const args = process.argv.slice(2);
if (args[0] !== 'rcd') process.exit(0);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [host, port] = (opt('rc-addr') ?? '127.0.0.1:0').split(':');
const auth = 'Basic ' + Buffer.from(`${opt('rc-user')}:${opt('rc-pass')}`).toString('base64');
const log = (line) => { if (process.env.KEEPER_FAKE_RCLONE_LOG) fs.appendFileSync(process.env.KEEPER_FAKE_RCLONE_LOG, JSON.stringify(line) + '\n'); };
const mounts = new Map();
const queued = () => { try { return Number(fs.readFileSync(process.env.KEEPER_FAKE_RCLONE_QUEUE, 'utf8')) || 0; } catch { return 0; } };

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== auth) { res.writeHead(401); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const method = req.url.replace(/^\//, '');
    let params = {};
    try { params = body ? JSON.parse(body) : {}; } catch { /* empty */ }
    log({ method, params });
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    switch (method) {
      case 'rc/noop': return send(200, {});
      case 'mount/types': return send(200, { mountTypes: ['mount', 'cmount'] });
      case 'core/obscure': return send(200, { obscured: 'obsc-' + Buffer.from(String(params.clear)).toString('hex') });
      case 'mount/mount':
        if (!fs.existsSync(params.mountPoint)) return send(500, { error: 'mount point does not exist' });
        mounts.set(params.mountPoint, params.fs);
        return send(200, {});
      case 'mount/unmount': mounts.delete(params.mountPoint); return send(200, {});
      case 'mount/listmounts': return send(200, { mountPoints: [...mounts].map(([MountPoint, Fs]) => ({ MountPoint, Fs })) });
      case 'vfs/stats': return send(200, { fs: params.fs, diskCache: { uploadsInProgress: 0, uploadsQueued: queued(), erroredFiles: 0, bytesUsed: 1024, outOfSpace: false } });
      case 'core/quit': send(200, {}); return setTimeout(() => process.exit(0), 50);
      default: return send(404, { error: `not in the stand-in: ${method}` });
    }
  });
});
server.listen(Number(port), host);
