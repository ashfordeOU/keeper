// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which permission (core/permissions.ts id) an error is really about, so the
// message can carry an "Open Permissions" button instead of plain directions.

export function permissionForError(e: unknown, hint?: 'microphone' | 'camera' | 'screen' | 'location'): string | undefined {
  const name = e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e ?? '');
  // getUserMedia and the like: the system or the person said no.
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || (/Permission denied|not allowed by the user agent/i.test(msg) && !/\b(EPERM|EACCES)\b/.test(msg))) return hint;
  // Apple events: "Not authorized to send Apple events to Notes." (-1743)
  const ae = /(-1743|Not authori[sz]ed to send Apple events to (\w[\w ]*))/i.exec(msg);
  if (ae) {
    const app = (ae[2] ?? '').toLowerCase();
    if (app.includes('notes')) return 'automation.notes';
    if (app.includes('music')) return 'automation.music';
    if (app.includes('finder')) return 'automation.finder';
    return 'automation.systemevents';
  }
  // Folders only Full Disk Access opens (Mail, Safari, Messages, the Trash, Find My).
  if (/\b(EPERM|EACCES)\b|Operation not permitted/.test(msg) && /Library\/(Mail|Safari|Messages|Containers\/com\.apple|Application Support\/com\.apple)|\.Trash|FindMy/i.test(msg)) return 'fullDisk';
  if (/Full Disk Access/i.test(msg)) return 'fullDisk';
  if (/Screen Recording|screen capture/i.test(msg)) return 'screen';
  return undefined;
}
