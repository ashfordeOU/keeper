// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// In the app, when Mail and calendars runs in a process of its own
// (`--keeper-role=mail`, docs/SUITE.md): the app's calls for mail, calendars,
// reminders and alarms go to that process, and what it reports (new Important
// mail for the Island, the next meeting, timers, "show the calendar") comes
// back here to the same places as before. While the part starts again after a
// crash, calls wait for it a little; while it is switched off (Mail, Calendar
// and reminders, and Alarms all off), the few calls still made are answered here.

import { BrowserWindow, dialog } from 'electron';
import type { PimDeps } from '../services/pim';
import { setPimRemote } from '../services/pim/route';
import type { AllSettings } from '../../core/settings';
import { adoptSecretStates, updateSettings } from '../store';
import { handleForParts, onPartNote, partCommand, whenPart } from './hub';
import { partWanted } from './supervisor';

/** Calls that read a mailbox or send can take a while (the server is slow, a big attachment). */
const CALL_TIMEOUT_MS = 5 * 60_000;

/** Passwords the part keeps only in memory (no keychain on this computer): held here for its next start, never on disk. */
let memorySecrets: Record<string, string> = {};

export function installMailRemote(deps: PimDeps) {
  setPimRemote((name, args) => {
    if (!partWanted('mail')) return null;
    return whenPart('mail', 20_000).then(() => partCommand('mail', name, args, CALL_TIMEOUT_MS));
  });
  onPartNote('mail', (name, args) => {
    switch (name) {
      case 'broadcast': deps.broadcast(String(args[0]), ...args.slice(1)); break;
      case 'alert': deps.alert(...(args as Parameters<PimDeps['alert']>)); break;
      case 'islandReminders': deps.islandReminders?.(args[0] as never); break;
      case 'islandEvents': deps.islandEvents(args[0] as never); break;
      case 'islandTimers': deps.islandTimers(args[0] as never); break;
      case 'badge': deps.badge?.(Number(args[0]) || 0); break;
      case 'show': deps.show?.(String(args[0])); break;
      case 'secrets': memorySecrets = (args[0] ?? {}) as Record<string, string>; break;
      case 'keychain': adoptSecretStates('pim.', (args[0] ?? {}) as Parameters<typeof adoptSecretStates>[1]); break;
      default: break;
    }
  });
  handleForParts('mail.secrets', ['mail'], () => memorySecrets);
  handleForParts('settings.set', ['mail'], (patch: Partial<AllSettings>) => updateSettings(patch));
  // Pickers open over the window the person is using (none focused: the part's own default answer).
  handleForParts('dialog.open', ['mail'], async (o: Electron.OpenDialogOptions, none: Electron.OpenDialogReturnValue) => {
    const win = BrowserWindow.getFocusedWindow();
    return win ? dialog.showOpenDialog(win, o) : none;
  });
  handleForParts('dialog.save', ['mail'], async (o: Electron.SaveDialogOptions, none: Electron.SaveDialogReturnValue) => {
    const win = BrowserWindow.getFocusedWindow();
    return win ? dialog.showSaveDialog(win, o) : none;
  });
}

/** The channel could not open: mail and calendars run in the app after all. */
export function uninstallMailRemote() {
  setPimRemote(null);
}
