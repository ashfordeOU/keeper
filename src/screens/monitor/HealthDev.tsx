// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Health → Dev & agents: every coding agent, AI tool and local model server
// that is running (with everything it started), and dev servers grouped by
// the project they belong to, with open, stop, restart and stop-project.

import { useCallback, useState } from 'react';
import type { RunningAgent, SysmonResult } from '../../../core/api-sysmon';
import { formatBytes, relativeTime } from '../../../core/format';
import type { DevProject } from '../../../core/monitor-devservers';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Empty, Loading, Toggle } from '../../components/ui';
import { useStore } from '../../state';
import { ConfirmButton, useVisibleInterval } from './common';

const KIND_LABEL: Record<string, string> = { cli: 'Agent', ide: 'Editor', server: 'Model server', app: 'AI app' };

export function HealthDev() {
  const { toast } = useStore();
  const [agents, setAgents] = useState<RunningAgent[] | null>(null);
  const [projects, setProjects] = useState<DevProject[] | null>(null);
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    void api.sysmon.agents().then(setAgents).catch(() => setAgents([]));
    void api.sysmon.devServers(all).then((r) => setProjects(r.projects)).catch(() => setProjects([]));
  }, [all]);
  useVisibleInterval(load, 5000, [load]);

  const done = (r: SysmonResult) => {
    toast(r.message);
    setTimeout(load, 600);
  };

  return (
    <div>
      <div className="section-head"><h3>Coding agents and AI tools</h3><span className="small muted">Quitting a session quits everything it started</span></div>
      {agents === null ? <Loading /> : agents.length ? (
        <div className="mon-agents">
          {agents.map((a) => (
            <div key={a.key} className="card mon-agent">
              <div className="top">
                <Icon name={a.kind === 'server' ? 'server' : a.kind === 'ide' ? 'code' : 'agent'} size={15} />
                <b title={a.label}>{a.label}{a.project ? <span className="muted"> · {a.project}</span> : null}</b>
                <span className={`mon-badge ${a.kind}`}>{KIND_LABEL[a.kind]}</span>
              </div>
              <div className="meta">{a.cpu.toFixed(1)}% CPU · {formatBytes(a.memory)} · {a.pids.length} process{a.pids.length === 1 ? '' : 'es'}{a.ports.length ? ` · port ${a.ports.slice(0, 4).join(', ')}${a.ports.length > 4 ? ` +${a.ports.length - 4} more` : ''}` : ''}</div>
              {a.cwd ? <div className="cmd" title={a.cwd}>{a.cwd}</div> : null}
              {a.command ? <div className="cmd" title={a.command}>{a.command}</div> : null}
              <div className="btn-row" style={{ marginTop: 4 }}>
                {a.ports[0] && a.kind !== 'cli' ? <button className="btn ghost sm" onClick={() => void api.system.openExternal(`http://localhost:${a.ports[0]}`)}>Open</button> : null}
                <ConfirmButton label={a.kind === 'cli' ? 'Quit session' : 'Quit'} confirm={`Quit ${a.pids.length} process${a.pids.length === 1 ? '' : 'es'}?`} onConfirm={async () => done(await api.sysmon.stopAgentSession(a.pid))} />
              </div>
            </div>
          ))}
        </div>
      ) : <p className="small muted" style={{ margin: '4px 0 18px' }}>No coding agents, AI tools or local model servers are running.</p>}

      <div className="section-head" style={{ marginTop: 6 }}>
        <h3>Dev servers by project</h3>
        <label className="row small" style={{ gap: 8 }}><Toggle on={all} onChange={setAll} /> Every listening port</label>
      </div>
      {projects === null ? <Loading /> : projects.length ? projects.map((p) => (
        <div key={p.root ?? 'other'} className="card mon-project">
          <div className="mon-project-head">
            <Icon name={p.root ? 'folder' : 'server'} size={15} />
            <h3>{p.name}</h3>
            {p.root ? <span className="path grow" title={p.root}>{p.root}</span> : <span className="grow" />}
            {p.root ? <ConfirmButton label="Stop project" confirm={`Stop ${new Set(p.servers.map((s) => s.pid)).size} server(s)?`} onConfirm={async () => done(await api.sysmon.stopProject(p.root!))} /> : null}
          </div>
          <table className="table">
            <thead><tr><th style={{ width: 70 }}>Port</th><th>Server</th><th>Status</th><th>Started</th><th /></tr></thead>
            <tbody>
              {p.servers.map((s) => (
                <tr key={`${s.pid}-${s.port}`}>
                  <td className="num mono">{s.port}</td>
                  <td><span className="mon-kind" title={s.command}>{s.kind}<span className="muted small">{s.name !== s.kind ? ` · ${s.name}` : ''} · {s.pid}</span></span></td>
                  <td><span className="mon-kind small"><span className={`mon-dot${s.idle ? ' idle' : s.exposed ? ' warn' : ''}`} />{s.idle ? 'idle' : 'in use'}{s.exposed ? ' · open to the network' : ''}</span></td>
                  <td className="small muted">{s.started ? relativeTime(s.started) : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {s.url ? <button className="btn ghost sm" onClick={() => void api.system.openExternal(s.url!)}>Open</button> : null}
                    {s.url && s.cwd ? <ConfirmButton label="Restart" confirm="Restart it?" onConfirm={async () => done(await api.sysmon.restartServer(s.pid))} /> : null}
                    <ConfirmButton label="Stop" confirm="Stop it?" onConfirm={async () => done(await api.sysmon.stopServer(s.pid))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )) : <Empty icon="server" title="No dev servers running">Servers you start in a project folder show up here, grouped by project.</Empty>}
    </div>
  );
}
