import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDownloadSources } from '../core/platform';
import { parseGetfattrHex, splitMdlsRaw } from '../core/sources';

const hex = (s: string) => '0x' + Buffer.from(s, 'utf8').toString('hex');

describe('download sources in batches', () => {
  it('reads getfattr hex output, names with spaces, quotes, newlines and non-Latin letters', () => {
    const out = [
      '# file: /home/a/Downloads/a b.pdf', `user.xdg.origin.url=${hex('https://mail.google.com/x?a="1"')}`, '',
      '# file: /home/a/Downloads/line\\012break.txt', `user.xdg.origin.url=${hex('https://example.com/ü')}`, '',
      '# file: /home/a/Downloads/back\\\\slash 中.zip', `user.xdg.origin.url=${hex('https://drive.google.com/')}`, '',
    ].join('\n');
    const m = parseGetfattrHex(out, 'user.xdg.origin.url');
    expect(m.get('/home/a/Downloads/a b.pdf')).toBe('https://mail.google.com/x?a="1"');
    expect(m.get('/home/a/Downloads/line\nbreak.txt')).toBe('https://example.com/ü');
    expect(m.get('/home/a/Downloads/back\\slash 中.zip')).toBe('https://drive.google.com/');
  });

  it('splits mdls raw output per file and refuses a count that does not add up', () => {
    expect(splitMdlsRaw('(\n "https://a"\n)\0(null)\0(null)\0(\n "work"\n)', 2, 2)).toEqual([['(\n "https://a"\n)', '(null)'], ['(null)', '(\n "work"\n)']]);
    expect(splitMdlsRaw('(null)\0(null)\0(null)', 2, 2)).toBeNull();
  });

  const hasFattr = (() => { try { execFileSync('setfattr', ['--version']); execFileSync('getfattr', ['--version']); return process.platform === 'linux'; } catch { return false; } })();
  it.runIf(hasFattr)('reads real extended attributes for many files with one call', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kp-origins-'));
    const files = Array.from({ length: 50 }, (_, i) => path.join(dir, `file ${i}.pdf`));
    for (const f of files) writeFileSync(f, 'x');
    try {
      execFileSync('setfattr', ['-n', 'user.xdg.origin.url', '-v', 'https://mail.google.com/mail/u/0/', files[3]]);
      execFileSync('setfattr', ['-n', 'user.xdg.origin.url', '-v', 'https://example.org/file.pdf', files[40]]);
      execFileSync('setfattr', ['-n', 'user.xdg.referrer.url', '-v', 'https://drive.google.com/drive', files[40]]);
    } catch {
      return; // file system without user xattrs
    }
    const m = await readDownloadSources(files);
    expect([...m.keys()].sort()).toEqual([files[3], files[40]].sort());
    expect(m.get(files[3])?.source?.id).toBe('gmail');
    expect(m.get(files[40])?.source?.id).toBe('gdrive');
  });
});
