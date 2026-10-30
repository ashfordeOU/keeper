// SPDX-License-Identifier: AGPL-3.0-or-later
// macOS Finder tags: Keeper reads them while indexing and writes changes back,
// so tags set in Keeper show in Finder and the other way round. Other systems
// keep Keeper's own tags.

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../core/platform';

const ATTR = 'com.apple.metadata:_kMDItemUserTags';

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Builds the XML property list Finder stores (an array of tag names). */
export function tagsPlist(tags: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><array>${tags.map((t) => `<string>${xmlEscape(t)}</string>`).join('')}</array></plist>
`;
}

export async function writeFinderTags(file: string, tags: string[]): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  if (!tags.length) return (await run('/usr/bin/xattr', ['-d', ATTR, file])).ok || true;
  const tmp = path.join(os.tmpdir(), `keeper-tags-${process.pid}-${Date.now()}.plist`);
  try {
    await fsp.writeFile(tmp, tagsPlist(tags));
    if (!(await run('/usr/bin/plutil', ['-convert', 'binary1', tmp])).ok) return false;
    const hex = (await fsp.readFile(tmp)).toString('hex');
    return (await run('/usr/bin/xattr', ['-wx', ATTR, hex, file])).ok;
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}
