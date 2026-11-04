// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Exchange servers run by an organisation: Autodiscover's answer read, and
// what Keeper sets up and tells the person.

import { describe, expect, it } from 'vitest';
import { autodiscoverRequest, autodiscoverUrls, exchangeConfig, looksLikeExchange, parseAutodiscover } from '../core/pim/exchange';

const ANSWER = `<?xml version="1.0" encoding="utf-8"?><Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006"><Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">
<User><DisplayName>Ana Lopez</DisplayName></User><Account><AccountType>email</AccountType><Action>settings</Action>
<Protocol><Type>EXCH</Type><Server>EX01.corp.example</Server><EwsUrl>https://mail.corp.example/EWS/Exchange.asmx</EwsUrl></Protocol>
<Protocol><Type>IMAP</Type><Server>mail.corp.example</Server><Port>993</Port><SSL>on</SSL></Protocol>
<Protocol><Type>SMTP</Type><Server>mail.corp.example</Server><Port>587</Port><Encryption>TLS</Encryption></Protocol>
</Account></Response></Autodiscover>`;

describe('Exchange Autodiscover', () => {
  it('asks the usual places', () => {
    expect(autodiscoverUrls('ana@corp.example')).toEqual(['https://autodiscover.corp.example/autodiscover/autodiscover.xml', 'https://corp.example/autodiscover/autodiscover.xml']);
    expect(autodiscoverRequest('ana@corp.example')).toContain('<EMailAddress>ana@corp.example</EMailAddress>');
  });
  it('reads the servers and uses IMAP and SMTP when offered', () => {
    const info = parseAutodiscover(ANSWER)!;
    expect(info).toMatchObject({ name: 'Ana Lopez', ews: 'https://mail.corp.example/EWS/Exchange.asmx', imap: { host: 'mail.corp.example', port: 993, ssl: true }, smtp: { host: 'mail.corp.example', port: 587 } });
    const cfg = exchangeConfig('ana@corp.example', info);
    expect(cfg.imap).toEqual({ host: 'mail.corp.example', port: 993, security: 'tls', user: 'ana@corp.example' });
    expect(cfg.smtp).toEqual({ host: 'mail.corp.example', port: 587, security: 'starttls', user: 'ana@corp.example' });
    expect(cfg.note).toMatch(/offers IMAP/);
  });
  it('says plainly what to do when the server offers only its own protocol', () => {
    const cfg = exchangeConfig('ana@corp.example', parseAutodiscover(ANSWER.replace(/<Protocol><Type>(IMAP|SMTP)[\s\S]*?<\/Protocol>/g, ''))!);
    expect(cfg.note).toMatch(/ask your IT team to turn on IMAP and SMTP/);
    expect(cfg.imap?.host).toBe('mail.corp.example');
    expect(looksLikeExchange(401, 'Negotiate, NTLM')).toBe(true);
    expect(looksLikeExchange(404, null)).toBe(false);
    expect(parseAutodiscover('<html>')).toBeNull();
  });
});
