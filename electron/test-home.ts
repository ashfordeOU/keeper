// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Test runs only: point every Electron folder at a throwaway home, before any
// other part of Keeper asks where things live. macOS takes the home folder
// from the system rather than $HOME, so this has to happen inside Keeper.
// Official builds ignore it.
import { app } from 'electron';
import path from 'node:path';

declare const __KEEPER_OFFICIAL__: boolean | undefined;
const official = typeof __KEEPER_OFFICIAL__ === 'boolean' && __KEEPER_OFFICIAL__;
const home = process.env.KEEPER_MACTEST_HOME;

if (!official && home && path.isAbsolute(home)) {
  const userData = process.env.KEEPER_MACTEST_USERDATA || path.join(home, 'Library', 'Application Support', 'Keeper');
  const set = (name: Parameters<typeof app.setPath>[0], p: string) => {
    try {
      app.setPath(name, p);
    } catch {
      /* not on this system */
    }
  };
  process.env.HOME = home;
  set('home', home);
  set('appData', path.join(home, 'Library', 'Application Support'));
  set('userData', userData);
  set('sessionData', userData);
  for (const [name, dir] of [['desktop', 'Desktop'], ['documents', 'Documents'], ['downloads', 'Downloads'], ['music', 'Music'], ['pictures', 'Pictures'], ['videos', 'Movies']] as const) set(name, path.join(home, dir));
  set('logs', path.join(home, 'Library', 'Logs', 'Keeper'));
  set('crashDumps', path.join(userData, 'Crashpad'));
}
