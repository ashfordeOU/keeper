// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo of Settings → Ashforde apps in the browser preview: Monorail installs
// with a pretend download, connects, and slides between workspaces.
// ?monorail=installed starts with it installed and connected.

import type { AshfordeApi, AshfordePrefs, MonorailStatus } from '../core/api-ashforde';
import { DEFAULT_ASHFORDE_PREFS } from '../core/api-ashforde';
import { ASHFORDE_APPS } from '../core/ashforde/apps';
import type { MonorailState } from '../core/ashforde/monorail';

export function mockAshforde(featureOn: (id: string) => boolean, emit: (ch: string, ...a: unknown[]) => void): { ashforde: AshfordeApi } {
  const start = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('monorail') : null;
  let installed = start === 'installed';
  let running = installed;
  let connected = installed;
  let version = installed ? '1.1.0' : undefined;
  let busy: MonorailStatus['busy'];
  let prefs: AshfordePrefs = { ...DEFAULT_ASHFORDE_PREFS };
  const names = ['Work', 'Writing', 'Personal'];
  const apps = ['Safari', 'Mail', 'Xcode', 'Notes'];
  let state: MonorailState = { workspace: 1, workspaceName: names[0], workspaceCount: 3, profile: 'Default', slide: 2, slides: 5, app: 'Safari', title: 'Monorail — GitHub', focusMode: false };

  const status = async (): Promise<MonorailStatus> => ({
    supported: true,
    installed,
    path: installed ? '/Applications/Monorail.app' : undefined,
    version,
    running,
    connected,
    apiReady: running && connected,
    accessibility: installed ? true : undefined,
    state: running && featureOn('monorail') ? state : undefined,
    update: installed && version === '1.0.4' ? { version: '1.1.0', notes: 'Themes, a cheat sheet and smoother sliding.' } : undefined,
    lastCheck: Date.now() - 3_600_000,
    signature: installed ? { ok: true, reason: 'Signed with Monorail’s certificate.' } : undefined,
    clashes: [],
    sliderAtTop: false,
    busy,
  });

  const changed = () => emit('ashforde-changed');
  const step = (label: string, p?: number) => { busy = { step: label, progress: p }; changed(); };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Slide around now and then while it runs, as if someone were working.
  setInterval(() => {
    if (!installed || !running || !featureOn('monorail')) return;
    const nextSlide = state.slide % state.slides + 1;
    const ws = nextSlide === 1 ? state.workspace % 3 + 1 : state.workspace;
    state = { ...state, workspace: ws, workspaceName: names[ws - 1], slide: nextSlide, app: apps[nextSlide % apps.length] };
    changed();
  }, 9000);

  const ashforde: AshfordeApi = {
    overview: async () => ({
      platform: 'darwin',
      apps: ASHFORDE_APPS.map((a) => ({ id: a.id, name: a.name, tagline: a.tagline, description: a.description, homepage: a.homepage, offered: true, elsewhere: a.elsewhere, together: a.together, enabled: featureOn(a.id) })),
    }),
    monorail: status,
    install: async () => {
      step('Finding the latest release');
      await wait(400);
      for (let p = 0; p <= 100; p += 20) { step('Downloading Monorail 1.1.0', p / 100); await wait(180); }
      step('Checking the download'); await wait(300);
      step('Checking the signature'); await wait(300);
      step('Installing Monorail'); await wait(300);
      installed = true; running = true; version = '1.1.0'; busy = undefined;
      changed();
      return status();
    },
    update: async () => { version = '1.1.0'; changed(); return status(); },
    checkUpdate: status,
    uninstall: async () => { installed = false; running = false; connected = false; version = undefined; changed(); return status(); },
    launch: async () => { running = true; changed(); return status(); },
    quit: async () => { running = false; changed(); return status(); },
    connect: async () => { connected = true; changed(); return status(); },
    openPermission: async () => ({ ok: true, label: 'Privacy & Security → Accessibility' }),
    action: async (kind, arg) => {
      if (kind === 'workspace') { const n = Number(arg) || 1; state = { ...state, workspace: n, workspaceName: names[n - 1] ?? `Workspace ${n}`, slide: 1 }; changed(); }
      if (kind === 'focus-mode') { state = { ...state, focusMode: arg !== false && arg !== 'off' }; changed(); }
      return { ok: true };
    },
    prefs: async () => prefs,
    setPrefs: async (patch) => { prefs = { ...prefs, ...patch }; changed(); return prefs; },
  };
  return { ashforde };
}
