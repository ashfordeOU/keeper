// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { detectBrowsers, extensionCopyFolder, hostLocationFor, installMarkers, openInBrowser, sessionBrowserId, storeListing, unpackedSteps } from '../core/browser-setup';
import { BROWSER_LIMITS } from '../core/browser-tabs';

const HOME = '/Users/ana';

describe('browser setup', () => {
  it('finds browsers on a Mac from their app or their data folder, and Safari as not yet supported', () => {
    const present = new Set(['/Applications/Google Chrome.app', `${HOME}/Library/Application Support/Firefox`, '/Applications/Safari.app']);
    const list = detectBrowsers({ platform: 'darwin', home: HOME, exists: (p) => present.has(p), linked: (id) => id === 'chrome', sessions: [] });
    expect(list.map((b) => b.id)).toEqual(['chrome', 'firefox', 'safari']);
    expect(list.find((b) => b.id === 'chrome')).toMatchObject({ supported: true, linked: true, connected: false });
    expect(list.find((b) => b.id === 'firefox')).toMatchObject({ linked: false });
    expect(list.find((b) => b.id === 'safari')).toMatchObject({ supported: false, linked: false });
  });

  it('finds browsers on Windows and Linux', () => {
    const env = { LOCALAPPDATA: 'C:/Users/ana/AppData/Local', APPDATA: 'C:/Users/ana/AppData/Roaming' };
    const win = detectBrowsers({ platform: 'win32', home: 'C:/Users/ana', env, exists: (p) => p === 'C:/Users/ana/AppData/Local/Microsoft/Edge/User Data', linked: () => false, sessions: [] });
    expect(win.map((b) => b.id)).toEqual(['edge']);
    const lin = detectBrowsers({ platform: 'linux', home: '/home/ana', exists: (p) => p === '/usr/bin/brave-browser' || p === '/home/ana/.mozilla/firefox', linked: () => true, sessions: [] });
    expect(lin.map((b) => b.id)).toEqual(['brave', 'firefox']);
    expect(installMarkers('linux', '/home/ana', {}, 'safari')).toEqual([]);
  });

  it('maps what the extension reports to the browser, and a plain "Chrome" to the only Chromium browser when Chrome is not installed', () => {
    expect(sessionBrowserId('Chrome 131')).toBe('chrome');
    expect(sessionBrowserId('Edge 131')).toBe('edge');
    expect(sessionBrowserId('Opera 115')).toBe('opera');
    expect(sessionBrowserId('Firefox 133')).toBe('firefox');
    expect(sessionBrowserId('Brave 131')).toBe('brave');
    expect(sessionBrowserId('Browser')).toBeUndefined();
    const brave = detectBrowsers({ platform: 'darwin', home: HOME, exists: (p) => p === '/Applications/Brave Browser.app', linked: () => true, sessions: [{ browser: 'Chrome 131' }] });
    expect(brave).toEqual([expect.objectContaining({ id: 'brave', connected: true })]);
  });

  it('knows where each browser reads Keeper’s registration (Opera reads Chrome’s)', () => {
    expect(hostLocationFor('darwin', HOME, 'brave')?.dir).toBe(`${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts`);
    expect(hostLocationFor('darwin', HOME, 'opera')?.browser).toBe('Chrome');
    expect(hostLocationFor('win32', 'C:/Users/ana', 'vivaldi')?.regKey).toMatch(/Google\\Chrome/);
    expect(hostLocationFor('linux', '/home/ana', 'firefox')?.dir).toBe('/home/ana/.mozilla/native-messaging-hosts');
    expect(hostLocationFor('darwin', HOME, 'safari')).toBeUndefined();
  });

  it('opens the extensions page in that browser on each system, and nothing else', () => {
    expect(openInBrowser('darwin', 'chrome', 'chrome://extensions')).toEqual([{ file: 'open', args: ['-a', 'Google Chrome', 'chrome://extensions'] }]);
    expect(openInBrowser('darwin', 'firefox', 'about:debugging#/runtime/this-firefox')[0].args).toEqual(['-a', 'Firefox', 'about:debugging#/runtime/this-firefox']);
    expect(openInBrowser('win32', 'edge', 'edge://extensions')).toEqual([{ file: 'cmd.exe', args: ['/d', '/c', 'start', '""', 'msedge', '"edge://extensions"'], verbatim: true }]);
    expect(openInBrowser('linux', 'chrome', 'chrome://extensions').map((c) => c.file)).toEqual(['google-chrome', 'google-chrome-stable']);
    expect(openInBrowser('win32', 'chrome', 'chrome://extensions" & calc & "')).toEqual([]);
    expect(openInBrowser('darwin', 'chrome', 'file:///etc/passwd')).toEqual([]);
  });

  it('opens the store page only when one is configured', () => {
    expect(storeListing('chrome')).toBeUndefined();
    const l = { chromeWebStore: 'https://chromewebstore.google.com/detail/x', edgeAddons: '', firefoxAddons: 'https://addons.mozilla.org/firefox/addon/x' };
    expect(storeListing('brave', l)).toBe(l.chromeWebStore);
    expect(storeListing('edge', l)).toBe(l.chromeWebStore);
    expect(storeListing('firefox', l)).toBe(l.firefoxAddons);
    expect(storeListing('safari', l)).toBeUndefined();
  });

  it('keeps the extension in a folder that is easy to pick, and gives plain steps', () => {
    expect(extensionCopyFolder(`${HOME}/Library/Application Support/Keeper`, 'chromium')).toBe(`${HOME}/Library/Application Support/Keeper/browser-extension`);
    expect(extensionCopyFolder('/x', 'firefox')).toBe('/x/browser-extension-firefox');
    expect(unpackedSteps('chrome').map((s) => s.title)).toEqual(['Keeper opens Chrome’s extensions page', 'Turn on Developer mode', 'Click “Load unpacked” and choose the folder Keeper just showed you']);
    expect(unpackedSteps('firefox')[1].title).toMatch(/Load Temporary Add-on/);
  });

  it('says what each browser allows without developer notes', () => {
    const text = BROWSER_LIMITS.map((l) => l.text).join(' ');
    expect(text).not.toMatch(/scripts\/|\.sh|contentSettings|Xcode|API/);
    expect(BROWSER_LIMITS.find((l) => l.browser === 'Safari')?.text).toBe('Safari support is coming.');
  });
});
