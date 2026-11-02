// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// In the app, when the Island and widgets run in processes of their own: what
// the app used to do to their windows is sent to those processes instead.
// A part that is not running (switched off, or starting again after a crash)
// simply misses the request; it reads the current state when it starts.

import { registerIslandWindowIpc, setIslandRemote } from '../ipc/island';
import { setWidgetsRemote } from '../ipc/widgets';
import { onPartBye, onPartHello, partCommand, partConnected, partEvent } from './hub';

const counts = { island: 0, widgets: 0 };
const quiet = () => undefined;

export function installRemotes() {
  const island = (name: string, ...args: unknown[]) => { if (partConnected('island')) void partCommand('island', name, args).catch(quiet); };
  setIslandRemote({
    ensure: (reposition) => island('ensure', reposition),
    setHidden: (hidden) => island('setHidden', hidden),
    openOn: (tab) => island('openOn', tab),
    send: (channel, ...args) => partEvent('island', channel, args),
    count: () => counts.island,
    openClips: () => island('openClips'),
    hideClips: async () => { if (partConnected('island')) await partCommand('island', 'hideClips').catch(quiet); },
    toggleClips: () => island('toggleClips'),
  });
  const widgets = (name: string, ...args: unknown[]) => { if (partConnected('widgets')) void partCommand('widgets', name, args).catch(quiet); };
  let state: { arranging: boolean; tint: string | null } = { arranging: false, tint: null };
  setWidgetsRemote({
    sync: () => widgets('sync'),
    arrange: (on) => { state = { ...state, arranging: on }; widgets('state', state); },
    tint: (color) => { state = { ...state, tint: color }; widgets('state', state); },
    count: () => counts.widgets,
  });
  // A part that (re)connects is told the state it cannot read from settings.
  onPartHello((role) => {
    if (role === 'widgets') widgets('state', state);
    setTimeout(() => void refreshCount(role), 1500);
  });
  onPartBye((role) => { counts[role] = 0; });
}

async function refreshCount(role: 'island' | 'widgets') {
  const n = await partCommand<number>(role, 'count', [], 2000).catch(() => 0);
  counts[role] = n;
}

/** The channel could not open: the windows run in the app after all, as they always did. */
export function uninstallRemotes(ctx: { preload: string; lockDown(win: Electron.BrowserWindow): void }) {
  setIslandRemote(null);
  setWidgetsRemote(null);
  registerIslandWindowIpc(ctx);
}
