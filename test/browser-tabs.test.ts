// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { allowedValues, buildBlockRules, buildPac, checkCommand, flattenTabs, parseExtensionMessage, sitePattern, MAX_DYNAMIC_RULES } from '../core/browser-tabs';
import { hostSession } from '../cli/browser-host';
import type { AppConnection } from '../core/brain/client';

describe('browser tab protocol', () => {
  it('checks commands before they reach the browser', () => {
    expect(checkCommand({ cmd: 'mute', tabId: 3, muted: 1 as never })).toEqual({ cmd: 'mute', tabId: 3, muted: true });
    expect(() => checkCommand({ cmd: 'close', tabId: -1 })).toThrow();
    expect(checkCommand({ cmd: 'contentSetting', type: 'camera', pattern: 'https://meet.example.com/abc', setting: 'block' })).toMatchObject({ pattern: '*://*.meet.example.com/*' });
    expect(() => checkCommand({ cmd: 'contentSetting', type: 'javascript', pattern: 'example.com', setting: 'ask' })).toThrow(/valid choice/);
    expect(() => checkCommand({ cmd: 'contentSetting', type: 'evil' as never, pattern: 'example.com', setting: 'block' })).toThrow();
    expect(() => checkCommand({ cmd: 'clearSiteData', origin: 'file:///etc/passwd', what: ['cookies'] })).toThrow();
    expect(checkCommand({ cmd: 'clearSiteData', origin: 'https://a.example.com/path?q', what: ['cookies', 'bogus' as never] })).toEqual({ cmd: 'clearSiteData', origin: 'https://a.example.com', what: ['cookies'] });
    expect(() => checkCommand({ cmd: 'setProxy', pac: 'alert(1)' })).toThrow();
    expect(() => checkCommand({ cmd: 'nope' } as never)).toThrow();
    expect(allowedValues('cookies')).toContain('session_only');
    expect(() => sitePattern('bad host!')).toThrow();
  });

  it('builds blocking rules from blocklists', () => {
    const domains = Array.from({ length: 2500 }, (_, i) => `t${i}.tracker.example`);
    const rules = buildBlockRules([...domains, 'BAD DOMAIN', '*.ads.example.'], { allowSites: ['shop.example.com'] });
    expect(rules[0]).toMatchObject({ id: 1, priority: 2, action: { type: 'allowAllRequests' }, condition: { requestDomains: ['shop.example.com'] } });
    const blocks = rules.filter((r) => r.action.type === 'block');
    expect(blocks).toHaveLength(3);
    expect(blocks[0].condition.domainType).toBe('thirdParty');
    expect(blocks.flatMap((r) => r.condition.requestDomains)).toContain('ads.example');
    expect(blocks.flatMap((r) => r.condition.requestDomains)).not.toContain('bad domain');
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    expect(rules.length).toBeLessThanOrEqual(MAX_DYNAMIC_RULES);
  });

  it('makes a PAC script for chosen sites only', () => {
    const pac = buildPac(['example.com', 'bad site'], { type: 'SOCKS5', host: '127.0.0.1', port: 1080 });
    const FindProxyForURL = new Function('dnsDomainIs', `${pac}; return FindProxyForURL;`)((h: string, d: string) => h.endsWith(d));
    expect(FindProxyForURL('https://www.example.com/', 'www.example.com')).toBe('SOCKS5 127.0.0.1:1080');
    expect(FindProxyForURL('https://other.org/', 'other.org')).toBe('DIRECT');
    expect(() => buildPac(['a.com'], { type: 'PROXY', host: 'x;y', port: 1 })).toThrow();
  });

  it('parses extension messages, including the original reports', () => {
    expect(parseExtensionMessage({ site: 'a.com', thirdParties: [], at: 1 })?.kind).toBe('report');
    expect(parseExtensionMessage({ kind: 'hello', browser: 'Chrome 131', version: '0.2.0', caps: ['tabs', 1] })).toEqual({ kind: 'hello', browser: 'Chrome 131', version: '0.2.0', caps: ['tabs'] });
    expect(parseExtensionMessage({ kind: 'tabs', tabs: [{ id: 1, url: 'https://a' }, { id: -2, url: 'x' }] })).toMatchObject({ tabs: [{ id: 1 }] });
    expect(parseExtensionMessage(null)).toBeNull();
    expect(parseExtensionMessage({ kind: 'weird' })).toBeNull();
  });

  it('lists every tab across browsers, sound first', () => {
    const t = (id: number, extra = {}) => ({ id, windowId: 1, url: `https://s${id}.example`, title: `T${id}`, active: false, audible: false, muted: false, discarded: false, incognito: false, ...extra });
    const flat = flattenTabs([
      { id: 'a', browser: 'Chrome', caps: [], seen: 0, tabs: [t(1, { bytes: 10 }), t(2, { audible: true })] },
      { id: 'b', browser: 'Firefox', caps: [], seen: 0, tabs: [t(3, { bytes: 99 })] },
    ]);
    expect(flat.map((x) => `${x.browser}:${x.id}`)).toEqual(['Chrome:2', 'Firefox:3', 'Chrome:1']);
  });
});

describe('native messaging host', () => {
  it('links a fake extension to a fake app both ways', async () => {
    const toExtension: unknown[] = [];
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    let pushCommand: ((m: string, p: unknown) => void) | undefined;
    const app: AppConnection = {
      call: async (method, params = {}, onNotify) => {
        calls.push({ method, params });
        if (method === 'keeper/browser.attach') {
          pushCommand = onNotify;
          return new Promise(() => undefined); // stays open while linked
        }
        return { ok: true };
      },
      raw: () => () => undefined,
      close: () => undefined,
    };
    const host = hostSession({ write: (o) => toExtension.push(o), connect: async () => app });
    await host.handle({ kind: 'hello', browser: 'Chrome 131', version: '0.2.0', caps: ['tabs', 'mute'] });
    expect(calls[0]).toMatchObject({ method: 'keeper/browser.attach', params: { session: host.session, browser: 'Chrome 131', caps: ['tabs', 'mute'] } });

    await host.handle({ kind: 'tabs', tabs: [{ id: 7, url: 'https://example.com', title: 'Ex' }] });
    expect(calls.at(-1)).toMatchObject({ method: 'keeper/browser.tabs', params: { session: host.session, tabs: [{ id: 7 }] } });

    // Keeper sends a command; only this session's commands reach the extension.
    pushCommand!('keeper/browser.command', { session: 'someone-else', reqId: 'x', command: { cmd: 'list' } });
    pushCommand!('keeper/browser.command', { session: host.session, reqId: 'r1', command: { cmd: 'mute', tabId: 7, muted: true } });
    expect(toExtension).toEqual([{ kind: 'cmd', reqId: 'r1', command: { cmd: 'mute', tabId: 7, muted: true } }]);

    await host.handle({ kind: 'reply', reqId: 'r1', ok: true });
    expect(calls.at(-1)).toMatchObject({ method: 'keeper/browser.reply', params: { session: host.session, reqId: 'r1', ok: true } });

    await host.handle({ site: 'example.com', thirdParties: [{ host: 't.example', requests: 2 }], at: 1 });
    expect(calls.at(-1)?.method).toBe('keeper/security.siteReport');
    expect(toExtension.at(-1)).toEqual({ ok: true });
    host.close();
  });

  it('tells the extension when Keeper is not running', async () => {
    const out: unknown[] = [];
    const host = hostSession({ write: (o) => out.push(o), connect: async () => null });
    await host.handle({ site: 'a.com', thirdParties: [], at: 1 });
    expect(out).toEqual([{ ok: false, error: 'Keeper is not running' }]);
  });
});

describe('Focus blocking and the reader through the extension', () => {
  it('checks the Focus block before it is sent', () => {
    const c = checkCommand({ cmd: 'setFocusBlock', sites: ['news.example.com', 'bad site', 'x.org'], until: 5, strict: true, waitSeconds: 999, passMinutes: 0, why: 'Focus session' });
    expect(c).toEqual({ cmd: 'setFocusBlock', sites: ['news.example.com', 'x.org'], until: 5, strict: true, waitSeconds: 120, passMinutes: 5, why: 'Focus session' });
    expect(() => checkCommand({ cmd: 'setFocusBlock', sites: Array(1001).fill('a.com'), strict: false, waitSeconds: 0, passMinutes: 5, why: '' })).toThrow();
  });
  it('reads a pass request and a page saved for later', () => {
    expect(parseExtensionMessage({ kind: 'focusPass', site: 'News.Example.com', reqId: 'r9' })).toEqual({ kind: 'focusPass', site: 'news.example.com', reqId: 'r9' });
    expect(parseExtensionMessage({ kind: 'readLater', url: 'https://a.example/post', title: 'Post' })).toEqual({ kind: 'readLater', url: 'https://a.example/post', title: 'Post' });
    expect(parseExtensionMessage({ kind: 'readLater', url: 'file:///etc/passwd', title: '' })).toBeNull();
  });
  it('the host asks Keeper for a pass and answers the block page', async () => {
    const out: unknown[] = [];
    const calls: string[] = [];
    const app: AppConnection = {
      call: async (method) => { calls.push(method); return method === 'keeper/focus.pass' ? { ok: false, message: 'Strict mode is on' } : { ok: true }; },
      raw: () => () => undefined,
      close: () => undefined,
    };
    const host = hostSession({ write: (o) => out.push(o), connect: async () => app });
    await host.handle({ kind: 'focusPass', site: 'x.com', reqId: 'q1' });
    expect(out).toEqual([{ kind: 'focusPassResult', reqId: 'q1', ok: false, message: 'Strict mode is on' }]);
    await host.handle({ kind: 'readLater', url: 'https://a.example/', title: 'A' });
    expect(calls).toEqual(['keeper/focus.pass', 'keeper/reader.save']);
  });
});
