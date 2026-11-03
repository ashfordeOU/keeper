// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's saved sign-ins (mail passwords, AI keys, this device's Link key)
// are sealed with the system keychain ("Keeper Safe Storage" on a Mac). When
// the keychain says no (Deny in the macOS question, a locked keyring on
// Linux), a saved secret is still there, only unreadable: these functions
// tell that apart from "nothing saved", so nothing is mistaken for a wrong
// password or replaced with a new key.

export type SecretState = 'ok' | 'missing' | 'locked' | 'unavailable';

/** The keychain as a whole: fine, refused (denied or locked), or not on this system. */
export type KeychainState = 'ok' | 'locked' | 'unavailable';

export interface KeychainStatus {
  state: KeychainState;
  platform: string;
  /** how many saved secrets cannot be read now */
  unreadable?: number;
  /** macOS without a Developer ID signature: each update asks about "Keeper Safe Storage" once */
  updateAsks?: boolean;
}

export interface KeychainApi {
  status(): Promise<KeychainStatus>;
  /** reads the saved secrets again (macOS shows its question again when it can) */
  retry(): Promise<KeychainStatus>;
}

/**
 * One saved value as stored in secrets.json ("enc:" + base64), read with the
 * keychain. `available` is whether the keychain can be used at all now.
 */
export function readSealed(stored: string | undefined, available: boolean, decrypt: (b: Buffer) => string, platform: string): { state: SecretState; value?: string } {
  if (!stored) return { state: 'missing' };
  if (!stored.startsWith('enc:')) return { state: 'missing' };
  if (!available) return { state: platform === 'linux' ? 'unavailable' : 'locked' };
  try {
    return { state: 'ok', value: decrypt(Buffer.from(stored.slice(4), 'base64')) };
  } catch {
    return { state: 'locked' };
  }
}

/** The keychain's state from what the last reads found. */
export function overallState(states: SecretState[]): KeychainState {
  if (states.includes('locked')) return 'locked';
  if (states.includes('unavailable')) return 'unavailable';
  return 'ok';
}

/** Where the keychain lives, by system, for messages. */
export function keychainName(platform: string): string {
  return platform === 'darwin' ? 'the macOS keychain' : platform === 'win32' ? 'Windows' : 'the system keyring';
}

/** What a feature says when its saved password or key cannot be read (instead of "wrong password"). */
export function lockedMessage(platform: string, what = 'its saved passwords and keys'): string {
  if (platform === 'darwin') return `Keeper can’t read ${what}: macOS did not let it use “Keeper Safe Storage” in your keychain (Deny was chosen, or the keychain is locked). Press Try again in the keychain banner and choose Always Allow.`;
  if (platform === 'linux') return `Keeper can’t read ${what}: the system keyring is locked or not running. Unlock it (log out and in again, or open your keyring app), then press Try again in the keychain banner.`;
  return `Keeper can’t read ${what}: ${keychainName(platform)} refused. Press Try again in the keychain banner.`;
}

/** Thrown where a saved secret exists but the keychain will not open it. */
export class KeychainLockedError extends Error {
  readonly code = 'KEYCHAIN_LOCKED';
  constructor(platform: string, what?: string) {
    super(lockedMessage(platform, what));
    this.name = 'KeychainLockedError';
  }
}

/** Shown in the update window on macOS before restarting into a new version. */
export const UPDATE_KEYCHAIN_NOTE = 'macOS may ask for your login password once so Keeper can unlock its saved sign-ins (“Keeper Safe Storage”): type it and choose Always Allow.';

/**
 * Shown instead, once, when the update moves Keeper from its own certificate to Ashforde's
 * Apple Developer ID (UpdateStatus.signerChange).
 */
export const UPDATE_SIGNER_CHANGE_NOTE = 'This update is signed with Ashforde’s Apple Developer ID. macOS will ask once more for your login password (choose Always Allow) and may ask you to allow Keeper again in Privacy & Security. After this, updates won’t ask.';
