// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { cleanIpcError, errorText } from '../core/ipc-error';

describe('errors from the main process', () => {
  it('drop the IPC wrapper and a plain "Error:"', () => {
    expect(errorText(new Error("Error invoking remote method 'pim.signIn': Error: The browser was closed"))).toBe('The browser was closed');
  });
  it('keep a named error’s name', () => {
    const e = cleanIpcError(new Error("Error invoking remote method 'lock.open': VaultError: Wrong password"));
    expect(e.message).toBe('Wrong password');
    expect(e.name).toBe('VaultError');
  });
  it('leave other errors alone', () => {
    const e = new Error('plain');
    expect(cleanIpcError(e)).toBe(e);
    expect(errorText('text')).toBe('text');
  });
});
