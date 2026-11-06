// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Separate app icons (Keeper Mail, Keeper Notes, Keeper Files…): what each system
// gets, that Keeper only removes what it made, and that the macOS bundles and the
// icons match the list in core/launchers.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { desktopEntry, desktopExecArg, isOurDesktopEntry, isOurMacLauncher, isOurShortcut, LAUNCHERS, launcherPlan, winArg, type LauncherContext } from '../core/launchers';
import { pageFromArgv, pageFromUrl } from '../core/page-window';
import { soloFromArgv } from '../core/solo';

const require = createRequire(import.meta.url);
const mac = require('../build/mac-launchers.cjs') as {
  LAUNCHERS: { page: string; opens?: string; name: string; bundleId: string }[];
  infoPlist: (l: { page: string; opens?: string; name: string; bundleId: string }, v: string) => string;
  makeLaunchers: (app: string, version: string, o?: { binary?: string; icons?: string }) => { made: number; reason?: string };
  launcherBundles: (app: string) => string[];
};
const root = path.resolve(__dirname, '..');

const ctx = (platform: string, extra: Partial<LauncherContext> = {}): LauncherContext => ({ platform, home: platform === 'win32' ? 'C:\\Users\\ann' : platform === 'darwin' ? '/Users/ann' : '/home/ann', exe: '', iconDir: platform === 'win32' ? 'C:\\Users\\ann\\AppData\\Roaming\\Keeper\\launchers' : '/home/ann/.config/Keeper/launchers', ...extra });

describe('what each system gets', () => {
  it('macOS: a copy of the app inside Keeper.app, in ~/Applications or /Applications', () => {
    const p = launcherPlan('mail', ctx('darwin', { appBundle: '/Applications/Keeper.app', exe: '/Applications/Keeper.app/Contents/MacOS/Keeper' }));
    expect(p).toEqual({ kind: 'mac-app', page: 'mail', name: 'Keeper Mail', source: '/Applications/Keeper.app/Contents/Library/Launchers/Keeper Mail.app', target: '/Users/ann/Applications/Keeper Mail.app', bundleId: 'io.github.ashfordeou.keeper.mail' });
    const sys = launcherPlan('calendar', ctx('darwin', { appBundle: '/Applications/Keeper.app', systemApplications: true }));
    expect(sys).toMatchObject({ target: '/Applications/Keeper Calendar.app' });
    expect(launcherPlan('mail', ctx('darwin'))).toEqual({ unavailable: 'Available in the installed Keeper app' });
  });

  it('Windows: a Start menu shortcut to Keeper with --keeper-solo, its own icon and app ID', () => {
    const p = launcherPlan('calendar', ctx('win32', { exe: 'C:\\Users\\ann\\AppData\\Local\\Programs\\Keeper\\Keeper.exe', appData: 'C:\\Users\\ann\\AppData\\Roaming' }));
    expect(p).toEqual({
      kind: 'win-shortcut', page: 'calendar', name: 'Keeper Calendar', exe: 'C:\\Users\\ann\\AppData\\Local\\Programs\\Keeper\\Keeper.exe', args: '--keeper-solo=calendar', description: 'Your calendars in a light app of their own', appUserModelId: 'io.github.ashfordeou.keeper.calendar',
      target: 'C:\\Users\\ann\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Keeper Calendar.lnk',
      icon: 'C:\\Users\\ann\\AppData\\Roaming\\Keeper\\launchers\\keeper-calendar.ico',
    });
    // A development copy passes its folder first, quoted.
    const dev = launcherPlan('mail', ctx('win32', { exe: 'C:\\dev\\electron.exe', exeArgs: ['C:\\my code\\keeper'] }));
    expect(dev).toMatchObject({ args: '"C:\\my code\\keeper" --keeper-solo=mail' });
  });

  it('Linux: a desktop entry in ~/.local/share/applications (or $XDG_DATA_HOME)', () => {
    const p = launcherPlan('notes', ctx('linux', { exe: '/opt/Keeper/keeper' }));
    expect(p).toMatchObject({ kind: 'linux-desktop', target: '/home/ann/.local/share/applications/keeper-notes.desktop', icon: '/home/ann/.config/Keeper/launchers/keeper-notes.png' });
    expect((p as { content: string }).content).toContain('Exec=/opt/Keeper/keeper --keeper-solo=notes\n');
    // Its window class is its own, so the dock shows it apart from Keeper.
    expect((p as { content: string }).content).toContain('StartupWMClass=keeper-notes\n');
    expect((p as { content: string }).content).toContain('Name=Keeper Notes\n');
    expect((p as { content: string }).content).toContain('X-Keeper-Launcher=notes\n');
    expect(launcherPlan('mail', ctx('linux', { exe: '/x', dataHome: '/data' }))).toMatchObject({ target: '/data/applications/keeper-mail.desktop' });
  });

  it('nine app icons, and only on the three systems', () => {
    expect(LAUNCHERS.map((l) => l.page)).toEqual(['mail', 'calendar', 'notes', 'reminders', 'planner', 'files', 'studio', 'terminal', 'rdc']);
    expect(launcherPlan('settings', ctx('linux'))).toHaveProperty('unavailable');
    expect(launcherPlan('mail', ctx('freebsd'))).toHaveProperty('unavailable');
  });

  it('each launcher\'s command line starts its own light app, and opens its own page in a running Keeper', () => {
    for (const l of LAUNCHERS) {
      const p = launcherPlan(l.page, ctx('linux', { exe: '/opt/Keeper/keeper' })) as { content: string };
      const exec = /^Exec=(.*)$/m.exec(p.content)![1].split(' ');
      expect(soloFromArgv(exec)).toBe(l.page);
      expect(pageFromArgv(exec)).toBe(l.opens ?? l.page);
      expect(pageFromUrl(`keeper://open/${l.opens ?? l.page}`)).toBe(l.opens ?? l.page);
    }
  });
});

describe('quoting', () => {
  it('quotes desktop entry arguments with spaces and specials', () => {
    expect(desktopExecArg('/opt/Keeper/keeper')).toBe('/opt/Keeper/keeper');
    expect(desktopExecArg('/home/ann/Apps/Keeper (1).AppImage')).toBe('"/home/ann/Apps/Keeper (1).AppImage"');
    expect(desktopExecArg('/a/$HOME"x')).toBe('"/a/\\$HOME\\"x"');
    expect(desktopEntry(LAUNCHERS[0], '/my apps/keeper', '/i.png')).toContain('Exec="/my apps/keeper" --keeper-solo=mail');
  });

  it('quotes Windows arguments', () => {
    expect(winArg('C:\\a')).toBe('C:\\a');
    expect(winArg('C:\\my dir\\')).toBe('"C:\\my dir\\\\"');
  });
});

describe('only what Keeper made is removed', () => {
  it('recognises its own desktop entries, shortcuts and bundles', () => {
    expect(isOurDesktopEntry(desktopEntry(LAUNCHERS[0], '/k', '/i'), 'mail')).toBe(true);
    expect(isOurDesktopEntry('[Desktop Entry]\nName=Keeper Mail\nExec=other\n', 'mail')).toBe(false);
    expect(isOurDesktopEntry(desktopEntry(LAUNCHERS[0], '/k', '/i'), 'notes')).toBe(false);
    expect(isOurShortcut({ args: '--keeper-solo=mail' }, 'mail')).toBe(true);
    // Shortcuts an older Keeper made are still recognised (and brought up to date).
    expect(isOurShortcut({ args: '--keeper-open=mail' }, 'mail')).toBe(true);
    expect(isOurShortcut({ args: '--keeper-solo=mailbox' }, 'mail')).toBe(false);
    expect(isOurShortcut({ args: '--keeper-open=mailbox' }, 'mail')).toBe(false);
    expect(isOurShortcut(null, 'mail')).toBe(false);
    expect(isOurMacLauncher(mac.infoPlist(mac.LAUNCHERS[0], '1.0.0'), 'mail')).toBe(true);
    expect(isOurMacLauncher(mac.infoPlist(mac.LAUNCHERS[0], '1.0.0'), 'calendar')).toBe(false);
  });
});

describe('the macOS bundles', () => {
  it('match core/launchers.ts', () => {
    expect(mac.LAUNCHERS).toEqual(LAUNCHERS.map(({ page, opens, name, bundleId }) => ({ page, ...(opens ? { opens } : {}), name, bundleId })));
  });

  it('name their page, executable and icon in Info.plist', () => {
    const plist = mac.infoPlist(mac.LAUNCHERS[1], '1.0.0');
    const files = mac.infoPlist(mac.LAUNCHERS.find((l) => l.page === 'files')!, '1.0.0');
    expect(files).toMatch(/<key>KeeperApp<\/key>\s*<string>files<\/string>/);
    expect(files).toMatch(/<key>KeeperPage<\/key>\s*<string>browse<\/string>/);
    for (const [k, v] of [['CFBundleExecutable', 'Keeper Calendar'], ['CFBundleIdentifier', 'io.github.ashfordeou.keeper.calendar'], ['KeeperPage', 'calendar'], ['KeeperApp', 'calendar'], ['CFBundleIconFile', 'AppIcon'], ['CFBundleShortVersionString', '1.0.0'], ['CFBundlePackageType', 'APPL']]) {
      expect(plist).toMatch(new RegExp(`<key>${k}</key>\\s*<string>${v}</string>`));
    }
    expect(plist).toMatch(/<key>LSUIElement<\/key>\s*<true\/>/);
  });

  it('are made inside Keeper.app at Contents/Library/Launchers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-launchers-'));
    try {
      const app = path.join(dir, 'Keeper.app');
      fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
      const bin = path.join(dir, 'keeper-launcher');
      fs.writeFileSync(bin, 'stub');
      expect(mac.makeLaunchers(app, '1.0.0', { binary: bin }).made).toBe(LAUNCHERS.length);
      const bundles = mac.launcherBundles(app);
      expect(bundles.map((b) => path.relative(app, b).split(path.sep).join('/'))).toEqual(LAUNCHERS.map((l) => `Contents/Library/Launchers/${l.name}.app`));
      const exe = path.join(bundles[0], 'Contents', 'MacOS', 'Keeper Mail');
      // Windows file systems keep no run bit; the bundles are only ever made on a Mac.
      if (process.platform === 'win32') expect(fs.existsSync(exe)).toBe(true);
      else expect(fs.statSync(exe).mode & 0o111).toBeTruthy();
      expect(fs.existsSync(path.join(bundles[0], 'Contents', 'Resources', 'AppIcon.icns'))).toBe(true);
      // Without keeper-launcher there are none, and the reason says why.
      expect(mac.makeLaunchers(app, '1.0.0', { binary: path.join(dir, 'missing') })).toEqual({ made: 0, reason: expect.stringMatching(/not built/) });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the icons', () => {
  it('exist for every launcher in each format', () => {
    for (const l of LAUNCHERS) {
      const icns = fs.readFileSync(path.join(root, 'build', 'launchers', `keeper-${l.page}.icns`));
      expect(icns.subarray(0, 4).toString('ascii')).toBe('icns');
      expect(icns.readUInt32BE(4)).toBe(icns.length);
      const ico = fs.readFileSync(path.join(root, 'build', 'launchers', `keeper-${l.page}.ico`));
      expect(ico.readUInt16LE(2)).toBe(1);
      expect(ico.readUInt16LE(4)).toBe(7);
      const png = fs.readFileSync(path.join(root, 'build', 'launchers', `keeper-${l.page}.png`));
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    }
  });

  it('use the same colours as core/launchers.ts', async () => {
    const { BADGES } = await import('../scripts/launcher-icons.mjs');
    expect(BADGES.map(({ page, color }) => ({ page, color }))).toEqual(LAUNCHERS.map(({ page, color }) => ({ page, color })));
  });
});
