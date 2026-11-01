// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Containers from Docker or Podman (whichever is installed and answering):
// the list, live use per container (`stats --no-stream`) and disk use
// (`system df`). Pure parsers for both engines' JSON shapes.

export type Engine = 'docker' | 'podman';

export interface ContainerRow {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  /** % of one core */
  cpu?: number;
  memUsed?: number;
  memLimit?: number;
  netIn?: number;
  netOut?: number;
  blockRead?: number;
  blockWrite?: number;
  pids?: number;
}

export interface DiskUse { type: string; total: number; active: number; size: number; reclaimable: number }

const UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };

/** "12.3MiB", "1.2kB", "500MB (40%)", "0B" → bytes. */
export function parseSize(s: unknown): number {
  if (typeof s === 'number') return s;
  const m = String(s ?? '').trim().match(/^([\d.]+)\s*([kmgt]?i?b)?/i);
  if (!m) return 0;
  return Math.round(Number(m[1]) * (UNITS[(m[2] ?? 'b').toLowerCase()] ?? 1));
}

const pair = (s: unknown): [number, number] => {
  const [a, b] = String(s ?? '').split('/');
  return [parseSize(a), parseSize(b)];
};
const pct = (s: unknown) => {
  const v = parseFloat(String(s ?? '').replace('%', ''));
  return Number.isFinite(v) ? v : undefined;
};

function lines(out: string): Record<string, unknown>[] {
  const t = out.trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try {
      return JSON.parse(t) as Record<string, unknown>[];
    } catch {
      return [];
    }
  }
  return t.split('\n').map((l) => {
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      return null;
    }
  }).filter((x): x is Record<string, unknown> => !!x);
}

const str = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v));

/** `docker ps -a --format '{{json .}}'` or `podman ps -a --format json`. */
export function parsePs(out: string): ContainerRow[] {
  return lines(out).map((d) => {
    const ports = Array.isArray(d.Ports) ? (d.Ports as { host_port?: number; container_port?: number; hostPort?: number; containerPort?: number }[]).map((p) => `${p.host_port ?? p.hostPort ?? ''}->${p.container_port ?? p.containerPort ?? ''}`).join(', ') : str(d.Ports);
    const state = str(d.State) || (/^Up/i.test(str(d.Status)) ? 'running' : 'exited');
    return { id: str(d.ID ?? d.Id).slice(0, 12), name: str(d.Names ?? d.Name).replace(/^\//, ''), image: str(d.Image), state: state.toLowerCase(), status: str(d.Status), ports };
  }).filter((c) => c.id);
}

/** `docker stats --no-stream --format '{{json .}}'` or `podman stats --no-stream --format json`. */
export function parseStats(out: string): Map<string, Partial<ContainerRow>> {
  const m = new Map<string, Partial<ContainerRow>>();
  for (const d of lines(out)) {
    const id = str(d.ID ?? d.id ?? d.ContainerID).slice(0, 12);
    if (!id) continue;
    const [memUsed, memLimit] = pair(d.MemUsage ?? d.mem_usage);
    const [netIn, netOut] = pair(d.NetIO ?? d.net_io);
    const [blockRead, blockWrite] = pair(d.BlockIO ?? d.block_io);
    m.set(id, { cpu: pct(d.CPUPerc ?? d.cpu_percent ?? d.CPU), memUsed, memLimit, netIn, netOut, blockRead, blockWrite, pids: Number(d.PIDs ?? d.pids) || undefined });
  }
  return m;
}

/** `docker system df --format '{{json .}}'` or `podman system df --format json`. */
export function parseDf(out: string): DiskUse[] {
  return lines(out).map((d) => ({
    type: str(d.Type),
    total: Number(d.TotalCount ?? d.Total) || 0,
    active: Number(d.Active) || 0,
    size: parseSize(d.Size ?? d.RawSize),
    reclaimable: parseSize(d.Reclaimable ?? d.RawReclaimable),
  })).filter((x) => x.type);
}

/** Lists plus stats, joined by short id. */
export function joinStats(rows: ContainerRow[], stats: Map<string, Partial<ContainerRow>>): ContainerRow[] {
  return rows.map((r) => ({ ...r, ...(stats.get(r.id) ?? {}) })).sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || (b.cpu ?? 0) - (a.cpu ?? 0) || a.name.localeCompare(b.name));
}

/** Container ids and names safe to pass to the engine. */
export function safeContainerId(id: string): boolean {
  return /^[a-zA-Z0-9][\w.-]{0,127}$/.test(id);
}

export type ContainerAction = 'stop' | 'start' | 'restart' | 'pause' | 'unpause';
export const CONTAINER_ACTIONS: ContainerAction[] = ['stop', 'start', 'restart', 'pause', 'unpause'];
