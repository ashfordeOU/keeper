// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Cloudflare Tunnel (cloudflared) for reaching this device from anywhere:
// which binary to fetch and check, how to start it, how to read its output,
// and how long to wait before restarting it. The supervisor that runs it is
// in electron/services/link/cloudflared.ts.

export const CLOUDFLARED_VERSION = '2026.10.7';

/** SHA-256 of each official release file, checked before anything runs. */
export const CLOUDFLARED_ASSETS: Record<string, { file: string; sha256: string; archive?: 'tgz' }> = {
  'linux-x64': { file: 'cloudflared-linux-amd64', sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872' },
  'linux-arm64': { file: 'cloudflared-linux-arm64', sha256: '3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775' },
  'win32-x64': { file: 'cloudflared-windows-amd64.exe', sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343' },
  // Windows on ARM runs the x64 build.
  'win32-arm64': { file: 'cloudflared-windows-amd64.exe', sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343' },
  'darwin-x64': { file: 'cloudflared-darwin-amd64.tgz', sha256: '02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848', archive: 'tgz' },
  'darwin-arm64': { file: 'cloudflared-darwin-arm64.tgz', sha256: '3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd', archive: 'tgz' },
};

export function cloudflaredAsset(platform: string, arch: string) {
  const a = CLOUDFLARED_ASSETS[`${platform}-${arch}`];
  if (!a) return null;
  return { ...a, url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${a.file}` };
}

export type TunnelMode = 'off' | 'quick' | 'named';

export interface TunnelConfig {
  mode: TunnelMode;
  /** named tunnel: the token from the Cloudflare dashboard (kept in the keychain, not here) */
  hostname?: string;
  /** keep running after Keeper quits (installed as a system service) */
  service?: boolean;
  /** extra local services published through the tunnel: port → hostname */
  extra?: { port: number; hostname: string }[];
}

/** Arguments for the tunnel process. The token is passed in the environment, never on the command line. */
export function tunnelArgs(c: TunnelConfig, localPort: number, metricsPort: number): string[] {
  const common = ['tunnel', '--no-autoupdate', '--metrics', `127.0.0.1:${metricsPort}`];
  if (c.mode === 'quick') return [...common, '--url', `http://127.0.0.1:${localPort}`];
  return [...common, 'run'];
}

/** The https address a quick tunnel prints when it is ready. */
export function parseQuickUrl(line: string): string | null {
  const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return m ? m[0].toLowerCase() : null;
}

/** Notable moments in cloudflared's log, for the status card. */
export function parseLogLine(line: string): { connected?: boolean; error?: string } {
  if (/Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(line)) return { connected: true };
  const e = line.match(/\b(ERR|error)\b\s*(.*)/);
  if (e && !/Retrying connection/i.test(line)) return { error: (e[2] || line).replace(/\s+/g, ' ').trim().slice(0, 200) };
  return {};
}

/** Seconds to wait before restart number `n` (1, 2, 4 … up to 2 minutes, with a little jitter). */
export function backoff(n: number, rand = Math.random()): number {
  const base = Math.min(120, 2 ** Math.max(0, n - 1));
  return Math.round(base * (0.85 + rand * 0.3) * 1000) / 1000;
}

/** How many connections cloudflared reports in its metrics (cloudflared_tunnel_ha_connections). */
export function readyConnections(metrics: string): number {
  const m = metrics.match(/^cloudflared_tunnel_ha_connections\s+([0-9.]+)/m);
  return m ? Math.round(Number(m[1])) : 0;
}

/** Ingress rules for a locally managed config (extra published services), as cloudflared YAML. */
export function ingressYaml(localPort: number, hostname: string | undefined, extra: { port: number; hostname: string }[] = []): string {
  const lines = ['ingress:'];
  for (const e of extra) lines.push(`  - hostname: ${e.hostname}`, `    service: http://127.0.0.1:${e.port}`);
  if (hostname) lines.push(`  - hostname: ${hostname}`, `    service: http://127.0.0.1:${localPort}`);
  lines.push('  - service: http_status:404');
  return lines.join('\n') + '\n';
}
