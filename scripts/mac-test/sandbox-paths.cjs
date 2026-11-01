// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Loaded with NODE_OPTIONS=--import before Keeper's own code during a Mac
// test run. It points every Electron path (home, Documents, app data, logs,
// crash dumps…) into the throwaway home, so the owner's own files and
// settings are never used. macOS ignores $HOME for these paths, so setting
// HOME alone would not be enough. Does nothing outside a test run, and
// nothing in plain Node processes (where there is no Electron app).
'use strict';
const home = process.env.KEEPER_MACTEST_HOME;
if (home && process.versions.electron && process.type === 'browser') {
  try {
    const path = require('path');
    const { app } = require('electron');
    const userData = process.env.KEEPER_MACTEST_USERDATA || path.join(home, 'Library/Application Support/Keeper');
    const set = (name, p) => { try { app.setPath(name, p); } catch { /* not on this system */ } };
    set('home', home);
    set('appData', path.join(home, 'Library/Application Support'));
    set('userData', userData);
    set('sessionData', userData);
    for (const [name, dir] of [['desktop', 'Desktop'], ['documents', 'Documents'], ['downloads', 'Downloads'], ['music', 'Music'], ['pictures', 'Pictures'], ['videos', 'Movies']]) set(name, path.join(home, dir));
    set('logs', path.join(home, 'Library/Logs/Keeper'));
    set('crashDumps', path.join(userData, 'Crashpad'));
  } catch (e) {
    process.stderr.write(`[mac-test] could not move Electron's folders: ${e && e.message}\n`);
  }
}
