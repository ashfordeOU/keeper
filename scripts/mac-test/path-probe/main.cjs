// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Before Keeper starts, the Mac test run starts this tiny app the same way
// (same Electron, same name, same switches) and reads back every folder
// Electron would use, to prove none of them is the owner's own.
'use strict';
const { app } = require('electron');
const names = ['home', 'appData', 'userData', 'sessionData', 'temp', 'desktop', 'documents', 'downloads', 'music', 'pictures', 'videos', 'logs', 'crashDumps'];
app.whenReady().then(() => {
  const out = {};
  for (const n of names) { try { out[n] = app.getPath(n); } catch { /* not here */ } }
  out.processHome = process.env.HOME || '';
  process.stdout.write('KEEPER_PATHS ' + JSON.stringify(out) + '\n', () => app.exit(0));
});
