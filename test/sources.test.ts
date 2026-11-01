// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { parseMdlsWhereFroms, parseZoneIdentifier, sourceFromUrls } from '../core/sources';

describe('download sources', () => {
  it('prefers the referrer page', () => {
    expect(sourceFromUrls(['https://mail-attachment.googleusercontent.com/x', 'https://mail.google.com/mail/u/0/'])?.id).toBe('gmail');
    expect(sourceFromUrls(['https://files.oaiusercontent.com/file-abc', 'https://chatgpt.com/c/123'])?.name).toBe('ChatGPT');
  });

  it('falls back to the site name', () => {
    const s = sourceFromUrls(['https://downloads.example.co.uk/a.zip']);
    expect(s).toMatchObject({ id: 'web:example.co.uk', name: 'example.co.uk' });
  });

  it('recognises extensions and blob URLs', () => {
    expect(sourceFromUrls(['chrome-extension://abcdef/page.html'])?.id).toBe('extension');
    expect(sourceFromUrls(['blob:https://www.canva.com/1234-5678'])?.id).toBe('canva');
  });

  it('parses Windows Zone.Identifier', () => {
    const z = '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://github.com/owner/repo/releases\r\nHostUrl=https://objects.githubusercontent.com/release.exe\r\n';
    expect(parseZoneIdentifier(z)?.id).toBe('github');
  });

  it('parses macOS mdls output', () => {
    expect(parseMdlsWhereFroms('(\n    "https://slack-files.com/T1/abc",\n    "https://app.slack.com/client/T1"\n)')?.id).toBe('slack');
    expect(parseMdlsWhereFroms('(null)')).toBeUndefined();
  });
});
