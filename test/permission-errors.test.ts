// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { permissionForError } from '../core/permission-errors';

describe('which permission an error is about', () => {
  it('a refused microphone or camera', () => {
    const e = new Error('Permission denied');
    e.name = 'NotAllowedError';
    expect(permissionForError(e, 'microphone')).toBe('microphone');
  });
  it('Apple events per app', () => {
    expect(permissionForError(new Error('execution error: Not authorized to send Apple events to Notes. (-1743)'))).toBe('automation.notes');
    expect(permissionForError(new Error('Not authorised to send Apple events to Music.'))).toBe('automation.music');
    expect(permissionForError(new Error('(-1743)'))).toBe('automation.systemevents');
  });
  it('protected folders mean Full Disk Access', () => {
    expect(permissionForError(new Error("EPERM: operation not permitted, scandir '/Users/a/.Trash'"))).toBe('fullDisk');
    expect(permissionForError(new Error("EACCES: permission denied, open '/Users/a/Library/Mail/V10'"))).toBe('fullDisk');
    expect(permissionForError(new Error('ENOENT: no such file'))).toBeUndefined();
  });
});
