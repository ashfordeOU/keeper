// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The locked-folders part of the interface ↔ main-process contract.

import type { VaultProgress, WrapKind } from './vault';

export type RelockWhen = 'quit' | 'screen' | 'idle' | 'never';

/** How this computer can confirm it is really you before unlocking. */
export interface AccountAuth {
  available: boolean;
  /** e.g. "Touch ID or your Mac password", "Windows Hello (face, fingerprint or PIN)" */
  label: string;
  /** why it is not available, when it is not */
  reason?: string;
  /** the account password is typed into Keeper (Windows without Windows Hello) */
  needsPassword?: boolean;
}

export interface LockStatus {
  account: AccountAuth;
  platform: string;
}

export interface LockedFolder {
  /** the locked file ("…/Taxes.keeperlock") */
  vault: string;
  /** the folder while it is unlocked */
  folder?: string;
  state: 'locked' | 'unlocked' | 'missing';
  methods: WrapKind[];
  relock: RelockWhen;
  /** minutes, when relock is 'idle' */
  idleMinutes?: number;
  lockedAt?: number;
  unlockedAt?: number;
  files?: number;
  bytes?: number;
}

export interface LockRequest {
  dir: string;
  /** 'account' = this computer's sign-in (Touch ID, Windows Hello, the account password) */
  method: 'account' | 'password';
  password?: string;
  /** shown to the person before locking, from newRecoveryKey() */
  recoveryKey: string;
  relock: RelockWhen;
  idleMinutes?: number;
}

export interface UnlockRequest {
  vault: string;
  method: 'account' | 'password' | 'recovery';
  /** the password or recovery key; for 'account', the account password where the system asks Keeper for it */
  secret?: string;
  /** 'account' only: use the account password instead of a fingerprint or face (when that did not work) */
  fallback?: boolean;
  relock?: RelockWhen;
  idleMinutes?: number;
}

export interface VaultInfo {
  methods: WrapKind[];
  /** this computer's key can open it (it was locked here with "Your account") */
  thisComputer: boolean;
  created: number;
  /** seconds to wait before the next try, after several wrong ones */
  waitSeconds: number;
}

export interface LockApi {
  status(): Promise<LockStatus>;
  /** a check before showing the lock dialog: null when the folder can be locked */
  canLock(dir: string): Promise<string | null>;
  newRecoveryKey(): Promise<string>;
  /** saves the recovery key as a text file the person picks; false when cancelled */
  saveRecoveryKey(key: string, folderName: string): Promise<boolean>;
  lock(req: LockRequest): Promise<{ vault: string; leftovers: boolean }>;
  inspect(vault: string): Promise<VaultInfo>;
  unlock(req: UnlockRequest): Promise<{ folder: string }>;
  /** locks an unlocked folder again with the same keys, without asking */
  relock(folderOrVault: string): Promise<{ vault: string }>;
  list(): Promise<LockedFolder[]>;
  /** stops tracking (the locked file itself is kept) */
  forget(vault: string): Promise<LockedFolder[]>;
  setRelock(vault: string, relock: RelockWhen, idleMinutes?: number): Promise<LockedFolder[]>;
  cancel(): Promise<void>;
}

export type { VaultProgress };
