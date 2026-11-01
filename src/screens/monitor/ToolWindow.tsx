// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small window with one tool in it, opened from the tool launcher. It shows
// only that tool and its own settings; results follow the standard output
// setting (Health → Settings → Results go to).

import { lazy, Suspense, useEffect, useState } from 'react';
import { launcherTools, parseToolId } from '../../../core/tool-catalog';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { Loading } from '../../components/ui';
import { useStore } from '../../state';
import '../../styles/monitor.css';

const Tools = lazy(() => import('../Tools').then((m) => ({ default: m.Tools })));
const Convert = lazy(() => import('../Convert').then((m) => ({ default: m.Convert })));

export function ToolWindow({ id }: { id: string }) {
  const { go, route } = useStore();
  const parsed = parseToolId(id);
  const tool = launcherTools().find((t) => t.id === id);
  const [ready, setReady] = useState(parsed?.kind !== 'convert');
  useEffect(() => {
    if (tool) document.title = `${tool.name} — Keeper`;
    // Convert reads its tool from the route, as when opened from the command palette.
    if (parsed?.kind === 'convert') go({ name: 'convert', arg: JSON.stringify({ tool: parsed.ref }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (parsed?.kind === 'convert' && route.name === 'convert') setReady(true);
  }, [route.name, parsed?.kind]);

  if (!parsed || !tool) return <div className="toolwin"><div className="toolwin-body"><p className="muted">This tool is not available.</p></div></div>;
  return (
    <div className="toolwin">
      <div className="toolwin-head">
        <Icon name={tool.icon} size={16} />
        <b>{tool.name}</b>
        <button className="btn ghost sm" title="Find another tool" onClick={() => void api.sysmon.openLauncher()}><Icon name="search" size={13} /> Tools</button>
      </div>
      <div className="toolwin-body">
        <p className="small muted" style={{ marginTop: 0 }}>{tool.desc}</p>
        <Suspense fallback={<Loading />}>
          {parsed.kind === 'toolbox' ? <Tools only={parsed.ref} /> : ready ? <Convert /> : <Loading />}
        </Suspense>
      </div>
    </div>
  );
}
