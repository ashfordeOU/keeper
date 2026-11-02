// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { KeychainLockedError, lockedMessage, overallState, readSealed } from '../core/keychain';

const ok = (b: Buffer) => b.toString('utf8');
const sealed = (v: string) => 'enc:' + Buffer.from(v).toString('base64');

describe('telling a refused keychain from "nothing saved"', () => {
  it('reads a saved secret', () => {
    expect(readSealed(sealed('hunter2'), true, ok, 'darwin')).toEqual({ state: 'ok', value: 'hunter2' });
  });
  it('nothing saved is missing, whatever the keychain says', () => {
    expect(readSealed(undefined, false, ok, 'darwin').state).toBe('missing');
    expect(readSealed(undefined, true, ok, 'linux').state).toBe('missing');
  });
  it('saved but the keychain said no is locked (macOS Deny), never missing', () => {
    expect(readSealed(sealed('x'), true, () => { throw new Error('Error while decrypting the ciphertext'); }, 'darwin').state).toBe('locked');
    expect(readSealed(sealed('x'), false, ok, 'darwin').state).toBe('locked');
    expect(readSealed(sealed('x'), false, ok, 'win32').state).toBe('locked');
  });
  it('saved but no keyring on Linux is unavailable', () => {
    expect(readSealed(sealed('x'), false, ok, 'linux').state).toBe('unavailable');
  });
  it('the whole keychain: locked wins, then unavailable', () => {
    expect(overallState(['ok', 'missing'])).toBe('ok');
    expect(overallState(['ok', 'unavailable'])).toBe('unavailable');
    expect(overallState(['unavailable', 'locked', 'ok'])).toBe('locked');
    expect(overallState([])).toBe('ok');
  });
  it('the message blames the keychain, not the password', () => {
    const e = new KeychainLockedError('darwin', 'this account’s saved password');
    expect(e.code).toBe('KEYCHAIN_LOCKED');
    expect(e.message).toMatch(/Keeper Safe Storage/);
    expect(e.message).toMatch(/Always Allow/);
    expect(e.message).not.toMatch(/wrong|did not accept/i);
    expect(lockedMessage('linux')).toMatch(/keyring/);
  });
});
