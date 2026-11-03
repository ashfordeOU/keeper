// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Light apps (core/solo.ts): what each app icon runs on its own, how a start is decided,
// what a later start asks of a running light app, and how Keeper takes over.
import { describe, expect, it } from 'vitest';
import { FEATURES } from '../core/features';
import { LAUNCHERS, launcherPage } from '../core/launchers';
import { navPage } from '../core/nav';
import { pageFromArgv } from '../core/page-window';
import { reopenFromArgv, servicesToAdd, soloAppOfPage, soloAppUserModelId, soloFromArgv, soloKeepsRoute, soloPlan, soloRequestOf, soloStart, soloWindowTitle, STAYS_OFF, takeOverArgs } from '../core/solo';

describe('the service plan of each app icon', () => {
  it('Mail, Calendar, Reminders and Planner run only Mail and calendars', () => {
    for (const a of ['mail', 'calendar', 'reminders', 'planner']) expect(soloPlan([a]).services).toEqual(['pim']);
  });

  it('Notes runs the notes vaults; Files the library; Studio, Terminal and Remote Desktops their own', () => {
    expect(soloPlan(['notes']).services).toEqual(['notes']);
    expect(soloPlan(['files']).services).toEqual(['library']);
    expect(soloPlan(['studio']).services).toEqual(['studio']);
    expect(soloPlan(['terminal']).services).toEqual(['terminal']);
    expect(soloPlan(['rdc']).services).toEqual(['rdc']);
  });

  it('never runs the library index outside Keeper Files', () => {
    for (const l of LAUNCHERS.filter((x) => x.page !== 'files')) expect(soloPlan([l.page]).services).not.toContain('library');
  });

  it('starts a shared service once, in a fixed order', () => {
    expect(soloPlan(['calendar', 'mail', 'notes', 'mail']).services).toEqual(['pim', 'notes']);
    expect(soloPlan(['notes', 'mail']).services).toEqual(['pim', 'notes']);
    expect(soloPlan(['mail', 'calendar']).apps).toEqual(['mail', 'calendar']);
  });

  it('opens each app icon\'s page (Files shows the Home Folder page)', () => {
    expect(soloPlan(['files', 'mail']).pages).toEqual(['browse', 'mail']);
  });

  it('uses the graphics card only for Studio', () => {
    expect(soloPlan(['mail']).gpu).toBe(false);
    expect(soloPlan(['files', 'notes']).gpu).toBe(false);
    expect(soloPlan(['studio']).gpu).toBe(true);
  });

  it('leaves out unknown app icons and parts that are switched off', () => {
    expect(soloPlan(['island', 'settings']).services).toEqual([]);
    const plan = soloPlan(['mail', 'notes'], (f) => f !== 'mail');
    expect(plan.apps).toEqual(['notes']);
    expect(plan.services).toEqual(['notes']);
  });

  it('adds only what is not running yet', () => {
    expect(servicesToAdd(['pim'], 'calendar')).toEqual([]);
    expect(servicesToAdd(['pim'], 'notes')).toEqual(['notes']);
    expect(servicesToAdd([], 'nope')).toEqual([]);
  });

  it('says in plain words what stays off', () => {
    expect(STAYS_OFF.join(' ')).toMatch(/Island/);
    expect(STAYS_OFF.join(' ')).toMatch(/library index/);
  });
});

describe('every app icon', () => {
  it('belongs to a real feature and opens a real page', () => {
    for (const l of LAUNCHERS) {
      expect(FEATURES.some((f) => f.id === l.feature), l.page).toBe(true);
      expect(navPage(launcherPage(l)), l.page).toBeTruthy();
      expect(soloAppOfPage(launcherPage(l))?.page).toBe(l.page);
    }
  });

  it('has a light-app switch to turn them all off', () => {
    expect(FEATURES.find((f) => f.id === 'soloApps')?.defaultOn).toBe(true);
  });

  it('has its own window name and Windows app ID', () => {
    expect(soloWindowTitle('mail')).toBe('Keeper Mail');
    expect(soloWindowTitle('rdc')).toBe('Keeper Remote Desktops');
    expect(soloAppUserModelId('notes')).toBe('io.github.ashfordeou.keeper.notes');
    expect(new Set(LAUNCHERS.map((l) => l.bundleId)).size).toBe(LAUNCHERS.length);
  });
});

describe('the command line', () => {
  it('reads --keeper-solo=<app> and nothing else', () => {
    expect(soloFromArgv(['/opt/Keeper/keeper', '--keeper-solo=mail'])).toBe('mail');
    expect(soloFromArgv(['keeper', '--keeper-solo', 'Notes'])).toBe('notes');
    expect(soloFromArgv(['keeper', '--keeper-solo=../../etc'])).toBeUndefined();
    expect(soloFromArgv(['keeper', '--keeper-solo=settings'])).toBeUndefined();
    expect(soloFromArgv(['keeper', '--keeper-open=mail'])).toBeUndefined();
  });

  it('names the app icon\'s page for a running Keeper', () => {
    expect(pageFromArgv(['keeper', '--keeper-solo=mail'])).toBe('mail');
    expect(pageFromArgv(['keeper', '--keeper-solo=files'])).toBe('browse');
    expect(pageFromArgv(['keeper', '--keeper-solo=nope'])).toBeUndefined();
  });
});

describe('how a start goes', () => {
  it('hands over to a running Keeper or light app', () => {
    expect(soloStart({ app: 'mail', running: true, enabled: true, partRunning: false })).toBe('hand-over');
  });

  it('starts as a light app when nothing runs', () => {
    expect(soloStart({ app: 'mail', running: false, enabled: true, partRunning: false })).toBe('solo');
  });

  it('starts all of Keeper when light apps are off, in safe mode, or a part of Keeper still runs', () => {
    expect(soloStart({ app: 'mail', running: false, enabled: false, partRunning: false })).toBe('keeper');
    expect(soloStart({ app: 'mail', running: false, enabled: true, partRunning: true })).toBe('keeper');
    expect(soloStart({ app: 'mail', running: false, enabled: true, partRunning: false, safeMode: true })).toBe('keeper');
    expect(soloStart({ app: undefined, running: false, enabled: true, partRunning: false })).toBe('keeper');
  });
});

describe('a later start while a light app runs', () => {
  const pageOf = (a: readonly string[]) => pageFromArgv(a);

  it('adds another app icon to the same light app', () => {
    expect(soloRequestOf(['keeper', '--keeper-solo=notes'], pageOf)).toEqual({ kind: 'add', app: 'notes' });
    expect(soloRequestOf(['keeper', '--keeper-open=calendar'], pageOf)).toEqual({ kind: 'add', app: 'calendar' });
    expect(soloRequestOf(['keeper', '--keeper-open=browse'], pageOf)).toEqual({ kind: 'add', app: 'files' });
  });

  it('lets Keeper take over for anything else', () => {
    expect(soloRequestOf(['keeper'], pageOf)).toEqual({ kind: 'keeper' });
    expect(soloRequestOf(['keeper', '--hidden'], pageOf)).toEqual({ kind: 'keeper' });
    expect(soloRequestOf(['keeper', '--keeper-open=cleanup'], pageOf)).toEqual({ kind: 'keeper' });
    expect(soloRequestOf(['keeper', 'keeper://search?q=x'], pageOf)).toEqual({ kind: 'keeper' });
  });
});

describe('Keeper taking over', () => {
  it('keeps the request, drops the light-app switch and names the windows to open again', () => {
    expect(takeOverArgs(['--hidden'], ['mail', 'notes'])).toEqual(['--hidden', '--keeper-reopen=mail,notes']);
    expect(takeOverArgs(['--keeper-solo=mail', 'keeper://search?q=x'], ['mail'])).toEqual(['keeper://search?q=x', '--keeper-reopen=mail']);
    expect(takeOverArgs(['--keeper-solo', 'notes', '--keeper-reopen=mail'], [])).toEqual([]);
    expect(takeOverArgs([], ['settings', 'mail', 'mail'])).toEqual(['--keeper-reopen=mail']);
  });

  it('reads the windows to open again, only app icons\' pages', () => {
    expect(reopenFromArgv(['keeper', '--keeper-reopen=mail,notes,browse'])).toEqual(['mail', 'notes', 'browse']);
    expect(reopenFromArgv(['keeper', '--keeper-reopen=settings,../x,mail'])).toEqual(['mail']);
    expect(reopenFromArgv(['keeper'])).toEqual([]);
  });
});

describe('what stays in a light app\'s window', () => {
  it('keeps its own page and the pages of the same part', () => {
    expect(soloKeepsRoute('mail', { name: 'mail', arg: 'abc' })).toBe(true);
    expect(soloKeepsRoute('calendar', { name: 'reminders' })).toBe(true);
    expect(soloKeepsRoute('browse', { name: 'recents' })).toBe(true);
    expect(soloKeepsRoute('browse', { name: 'search', q: 'x' })).toBe(true);
  });

  it('sends every other page elsewhere', () => {
    expect(soloKeepsRoute('mail', { name: 'settings' })).toBe(false);
    expect(soloKeepsRoute('mail', { name: 'cleanup' })).toBe(false);
    expect(soloKeepsRoute('notes', { name: 'mail' })).toBe(false);
  });

  it('keeps everything in a window that is not an app icon\'s', () => {
    expect(soloKeepsRoute('settings', { name: 'cleanup' })).toBe(true);
  });
});
