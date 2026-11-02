// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Writes where a file Keeper saved came from, as browsers and the system do
// (see core/origin.ts), then has the library read it again so "Downloaded
// From" lists it. Best effort: a disk without extended attributes (FAT, some
// network shares) simply keeps no origin.

import { promises as fsp } from 'node:fs';
import { quarantineValue, whereFromsPlist, zoneIdentifier } from '../../core/origin';
import { run } from '../../core/platform';

let refresh: ((p: string) => void) | null = null;
/** The library's way to read one file again (set once at start). */
export function setOriginRefresh(fn: (p: string) => void) {
  refresh = fn;
}

let hasSetfattr: boolean | undefined;

/** Records the origin of a file Keeper saved. url is the page or keeper:// link it came from. */
export async function markOrigin(p: string, o: { url: string; referrer?: string }): Promise<boolean> {
  let ok = false;
  try {
    if (process.platform === 'darwin') {
      const urls = [o.url, ...(o.referrer ? [o.referrer] : [])];
      ok = (await run('/usr/bin/xattr', ['-wx', 'com.apple.metadata:kMDItemWhereFroms', whereFromsPlist(urls).toString('hex'), p], 5000)).ok;
      // Quarantined like a browser download (left as it is when already set).
      const q = await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', p], 5000);
      if (!q.ok) await run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', quarantineValue(), p], 5000);
    } else if (process.platform === 'win32') {
      await fsp.writeFile(`${p}:Zone.Identifier`, zoneIdentifier(o.url, o.referrer));
      ok = true;
    } else {
      hasSetfattr ??= (await run('setfattr', ['--version'], 2000)).ok;
      if (hasSetfattr) {
        ok = (await run('setfattr', ['-n', 'user.xdg.origin.url', '-v', o.url, '--', p], 5000)).ok;
        if (ok && o.referrer) await run('setfattr', ['-n', 'user.xdg.referrer.url', '-v', o.referrer, '--', p], 5000);
      }
    }
  } catch {
    ok = false;
  }
  refresh?.(p);
  return ok;
}
