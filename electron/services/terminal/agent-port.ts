// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Connects the agent terminal manager to the session host. No Electron here,
// so tests drive a real host with real shells through the same code.

import type { HostMsg } from '../../../core/terminal/protocol';
import type { SessionInfo, SessionSpec } from '../../../core/terminal/types';
import type { AgentTerminals, HostPort } from '../../../core/terminal/agent/manager';
import type { HostClient } from './client';

export interface LaunchFor {
  (req: Parameters<HostPort['create']>[0]): Promise<{ spec: SessionSpec; launch: { file: string; args: string[]; cwd: string; env: Record<string, string>; startup?: string }; scrollback: number; shellKind?: string }>;
}

export function hostPort(client: () => Promise<HostClient> | HostClient, launchFor: LaunchFor): HostPort {
  const c = async () => client();
  return {
    async create(req) {
      const h = await c();
      const { spec, launch, scrollback, shellKind } = await launchFor(req);
      const info = await h.request<SessionInfo>({ t: 'create', spec, launch, scrollback });
      // Subscribe at once, so no output is missed.
      await h.request({ t: 'attach', id: info.id });
      if (req.persist) h.post({ t: 'persist', id: info.id, on: true });
      return { id: info.id, pid: info.pid, cwd: info.cwd ?? launch.cwd, shellFile: launch.file, shellKind };
    },
    write(id, data) {
      void Promise.resolve(c()).then((h) => h.post({ t: 'input', id, data }));
    },
    async kill(id) {
      await (await c()).request({ t: 'kill', id });
    },
    resize(id, cols, rows) {
      void Promise.resolve(c()).then((h) => h.post({ t: 'resize', id, cols, rows }));
    },
    async scrollback(id) {
      const r = await (await c()).request<{ data: string }>({ t: 'attach', id });
      return r.data;
    },
  };
}

/** Passes host messages about agent terminals to the manager. */
export function routeToAgents(m: HostMsg, terms: AgentTerminals) {
  if (m.t === 'data') terms.data(m.id, m.data);
  else if (m.t === 'exit') terms.exited(m.id, m.code);
  else if (m.t === 'event' && m.ev.kind === 'prompt') terms.prompt(m.id);
}
