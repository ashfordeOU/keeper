// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { keeperUrl, quarantineValue, whereFromsPlist, zoneIdentifier } from '../core/origin';
import { mailLink } from '../core/pim/mail-link';
import { parseZoneIdentifier, sourceFromUrls } from '../core/sources';
import { readDownloadSource, run } from '../core/platform';
import { markOrigin } from '../electron/services/origin-mark';

describe('where files Keeper saved came from', () => {
  it('names Keeper’s own sources', () => {
    expect(sourceFromUrls([mailLink('a:INBOX:7')])).toMatchObject({ id: 'keeper-mail', name: 'Mail' });
    expect(sourceFromUrls([keeperUrl('link', 'Pixel 8')])).toMatchObject({ id: 'keeper-link:pixel 8', name: 'Keeper Link · Pixel 8' });
    expect(sourceFromUrls([keeperUrl('cloud', 'Dropbox')])).toMatchObject({ id: 'keeper-cloud:dropbox', name: 'Dropbox' });
    expect(sourceFromUrls(['https://rr3.googlevideo.com/v', 'https://www.youtube.com/watch?v=1'])).toMatchObject({ id: 'youtube' });
  });

  it('writes what Windows and macOS read', () => {
    expect(parseZoneIdentifier(zoneIdentifier('https://example.org/a.zip', 'https://example.org/'))).toMatchObject({ host: 'example.org', url: 'https://example.org/a.zip' });
    expect(quarantineValue(0x65000000 * 1000)).toBe('0081;65000000;Keeper;');
    const b = whereFromsPlist(['https://a.test/x', 'Zoë']);
    expect(b.subarray(0, 8).toString()).toBe('bplist00');
    expect(b.includes(Buffer.from('https://a.test/x'))).toBe(true);
    expect(b.readBigUInt64BE(b.length - 24)).toBe(3n);
  });

  it.runIf(process.platform === 'linux')('Linux: the origin is written as user.xdg.origin.url and read back', async () => {
    if (!(await run('setfattr', ['--version'], 2000)).ok || !(await run('getfattr', ['--version'], 2000)).ok) return;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'korigin-'));
    const f = path.join(dir, 'invoice.pdf');
    writeFileSync(f, 'x');
    try {
      if (!(await markOrigin(f, { url: mailLink('acc:INBOX:42') }))) return; // a file system without user attributes
      expect(await readDownloadSource(f)).toMatchObject({ id: 'keeper-mail', name: 'Mail' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
