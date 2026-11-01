// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The unattended Keeper Link daemon: started by the system service
// (core/screen/unattended.ts) as you, at boot, with Electron running as plain
// Node. It keeps this device reachable by your own paired devices while
// Keeper itself is not running — after a restart and before anyone logs in:
// files, terminals, commands that were already allowed once, system details,
// Wake-on-LAN relaying and restarts. It has no screen of its own (see
// docs/REMOTE.md for what each system allows at the login screen).
//
// When the Keeper app starts it asks this daemon to step aside (POST
// /local/yield); the daemon stops listening and waits until the app has quit.

import crypto from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LinkNode, type LinkData } from './services/link/node';
import { installOps } from './services/link/ops';

declare const __KEEPER_VERSION__: string;

const dataDir = process.env.KEEPER_DATA_DIR || path.join(os.homedir(), '.config', 'Keeper');
const linkDir = path.join(dataDir, 'link');
const dataFile = path.join(linkDir, 'link.json');
const keyFile = path.join(linkDir, 'unattended-key.json');
const daemonFile = path.join(linkDir, 'daemon.json');
const token = crypto.randomBytes(24).toString('base64url');

let node: LinkNode | null = null;
let yieldedTo = 0;

async function writeJson(file: string, v: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function start() {
  if (node) return;
  const n = new LinkNode(
    {
      load: () => fsp.readFile(dataFile, 'utf8').then((t) => JSON.parse(t) as LinkData).catch(() => null),
      save: (d) => writeJson(dataFile, d),
      getSecret: async (name) => (name === 'link.identity' ? fsp.readFile(keyFile, 'utf8').catch(() => undefined) : undefined),
      setSecret: async () => false,
      changed: () => undefined,
      transfer: () => undefined,
      pairPrompt: () => undefined,
      // Nobody is there to accept: files arrive only from devices set to "Accept files without asking".
      offer: (o) => node?.answerOffer(o.id, false),
      approveCompanion: async () => false,
      notify: () => undefined,
      clipboard: { read: () => '', write: () => undefined },
      downloads: () => path.join(os.homedir(), 'Downloads'),
      companionDir: () => path.join(__dirname, 'companion'),
      qr: async (t) => t,
      tunnel: () => undefined,
      directAllowed: () => true,
    },
    { hostname: os.hostname(), os: process.platform, controlToken: token },
  );
  // Only commands the owner already allowed once run unattended; anything new is refused.
  installOps(n, { approveCommand: async () => false, version: typeof __KEEPER_VERSION__ === 'string' ? __KEEPER_VERSION__ : 'unattended' });
  n.registerControl('yield', async (p) => {
    yieldedTo = Number(p.pid) || 0;
    setTimeout(() => void stop(), 50);
    return true;
  });
  await n.start();
  node = n;
  await writeJson(daemonFile, { port: n.port, token, pid: process.pid });
}

async function stop() {
  const n = node;
  node = null;
  await n?.stop();
}

async function main() {
  if (!existsSync(keyFile)) {
    console.error('Keeper Link daemon: no key file; turn unattended access on in Keeper first.');
    process.exit(2);
  }
  await start();
  // While the app runs, stay out of its way; listen again once it has quit.
  setInterval(() => {
    if (!node && (!yieldedTo || !alive(yieldedTo))) {
      yieldedTo = 0;
      void start().catch(() => undefined);
    }
  }, 10_000);
  const bye = () => void stop().finally(() => process.exit(0));
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
}

void main();
