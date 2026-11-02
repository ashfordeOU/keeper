// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Keeper can't read its saved passwords": shown in the main window and the
// menu-bar pop-over while the system keychain refuses Keeper's saved sign-ins
// (Deny in the macOS "Keeper Safe Storage" question, a locked keyring). Try
// again reads them once more; macOS asks again when it can, and otherwise
// after a restart.

import { useEffect, useState } from 'react';
import type { KeychainStatus } from '../../core/keychain';
import { api } from '../api';
import { Icon } from './Icon';
import '../styles/permissions.css';

export function useKeychain(): [KeychainStatus | null, (s: KeychainStatus) => void] {
  const [s, setS] = useState<KeychainStatus | null>(null);
  useEffect(() => {
    if (!api.keychain) return;
    void api.keychain.status().then(setS).catch(() => undefined);
    return api.on('keychain-changed', setS);
  }, []);
  return [s, setS];
}

export function KeychainBanner({ compact }: { compact?: boolean }) {
  const [s, setS] = useKeychain();
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  if (!s || s.state === 'ok') return null;
  const mac = s.platform === 'darwin';
  const retry = async () => {
    setBusy(true);
    try { setS(await api.keychain.retry()); } catch { /* still locked */ }
    setTries((n) => n + 1);
    setBusy(false);
  };
  const why = s.state === 'unavailable'
    ? 'The system keyring is locked or not running. Unlock it (or install gnome-keyring or KWallet and log in again), then Try again.'
    : mac
      ? 'macOS did not let Keeper use “Keeper Safe Storage” in your keychain. Press Try again, type your login password and choose Always Allow. Your mail, AI keys and paired devices are untouched; they wait until then.'
      : 'The system keychain refused. Press Try again.';
  return (
    <div className={`keychain-banner ${compact ? 'compact' : ''}`} role="alert" data-testid="keychain-banner">
      <Icon name="warning" size={15} />
      <div className="grow">
        <b>Keeper can’t read its saved passwords and keys.</b>
        {!compact ? <div className="small">{why}</div> : null}
        {tries > 0 ? <div className="small">Still locked. {mac ? 'macOS asks again after Keeper restarts.' : 'Restarting Keeper reads them again.'}</div> : null}
      </div>
      <button className="btn sm primary" disabled={busy} onClick={() => void retry()}>{busy ? <span className="spinner" /> : null} Try again</button>
      {tries > 0 ? <button className="btn sm" onClick={() => void api.permissions.restart()}>Restart Keeper</button> : null}
    </div>
  );
}
