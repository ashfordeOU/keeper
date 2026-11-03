// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro's build switch, read from .github/release.json by scripts/build-main.mjs
// and vite.config.ts (so the app, its interface and the command line agree).
//
//   "proEnabled": false   Pro is not in the build at all (the default; docs/PRO.md)
//   "freeThrough": null   the version in which payments were first switched on;
//                         every feature up to it stays free for everyone, forever
//
// KEEPER_PRO=1 or KEEPER_PRO=0 overrides "proEnabled" for one build (tests, trying
// it out). A build with Pro on and no "freeThrough" fails: `node scripts/pro.mjs on`
// switches Pro on and records the version.
import { readFileSync } from 'node:fs';

export function proFlags(root = new URL('..', import.meta.url)) {
  const rel = JSON.parse(readFileSync(new URL('.github/release.json', root), 'utf8'));
  const env = process.env.KEEPER_PRO;
  const pro = env === '1' ? true : env === '0' ? false : rel.proEnabled === true;
  let freeThrough = typeof rel.freeThrough === 'string' ? rel.freeThrough : null;
  if (pro && !freeThrough) {
    // Trying Pro out from source: the current version stands in, nothing is recorded.
    if (env === '1') freeThrough = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;
    else throw new Error('.github/release.json has "proEnabled": true but no "freeThrough". Run node scripts/pro.mjs on (docs/PRO.md).');
  }
  return { pro, freeThrough };
}
