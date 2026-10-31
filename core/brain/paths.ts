// SPDX-License-Identifier: AGPL-3.0-or-later
// Where Keeper's brain keeps its files on each system, and the private channel
// between the app and the `keeper` command (shared by both; Node only).

import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/**
 * Keeper's data folder, the same one the app uses (Electron's userData for
 * the product name "Keeper"). KEEPER_DATA_DIR overrides it.
 */
export function keeperDataDir(env: Record<string, string | undefined> = process.env, platform = process.platform, home = os.homedir()): string {
  if (env.KEEPER_DATA_DIR) return env.KEEPER_DATA_DIR;
  // Paths in the target system's own style, whichever system computes them.
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'Keeper');
  if (platform === 'win32') return p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'Keeper');
  return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), 'Keeper');
}

/** The private channel between the app and the `keeper` command. */
export function brainSocketPath(dataDir: string, platform = process.platform): string {
  if (platform === 'win32') return `\\\\.\\pipe\\keeper-brain-${createHash('sha256').update(dataDir.toLowerCase()).digest('hex').slice(0, 16)}`;
  const p = path.join(dataDir, 'brain', 'keeper.sock');
  // Unix socket paths are limited to about 104 bytes; fall back to the temp folder.
  return Buffer.byteLength(p) < 100 ? p : path.join(os.tmpdir(), `keeper-brain-${createHash('sha256').update(dataDir).digest('hex').slice(0, 16)}.sock`);
}

export interface BrainEndpoint {
  socket: string;
  token: string;
  pid: number;
  version: string;
  http?: { port: number };
}

export const ENDPOINT_FILE = 'endpoint.json';
