// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Locking and unlocking folders: choose how to unlock (your account or a
// password), save the recovery key, then watch it encrypt and check itself.

import { useEffect, useMemo, useState } from 'react';
import type { LockedFolder, LockStatus, RelockWhen, VaultInfo } from '../../core/api-lock';
import { formatBytes, relativeTime } from '../../core/format';
import { passwordStrength } from '../../core/vault-ui';
import { api } from '../api';
import { useAsync, useStore } from '../state';
import { Icon } from './Icon';
import { Modal } from './ui';
import '../styles/lock.css';

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const folderName = (vault: string) => baseName(vault).replace(/\.keeperlock$/i, '');

/** Errors from the main process arrive wrapped ("Error invoking remote method …: VaultError: …"). */
export function lockError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': /, '').replace(/^(\w*Error): /, '');
}

const RELOCK: { value: RelockWhen; label: string }[] = [
  { value: 'quit', label: 'when Keeper quits' },
  { value: 'screen', label: 'when the screen locks or the computer sleeps' },
  { value: 'idle', label: 'after some minutes' },
  { value: 'never', label: 'only when I lock it' },
];

function RelockPicker({ value, minutes, onChange }: { value: RelockWhen; minutes: number; onChange: (v: RelockWhen, minutes: number) => void }) {
  return (
    <div className="lock-relock">
      <span className="small muted">After unlocking, lock it again</span>
      <select className="input sm" value={value} onChange={(e) => onChange(e.target.value as RelockWhen, minutes)} aria-label="Lock again">
        {RELOCK.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      {value === 'idle' ? (
        <select className="input sm" value={minutes} onChange={(e) => onChange(value, Number(e.target.value))} aria-label="Minutes">
          {[5, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
      ) : null}
    </div>
  );
}

/** Live progress from the main process while a folder is being locked or unlocked. */
function useLockProgress(active: boolean) {
  const [p, setP] = useState<{ phase: string; done: number; total: number; file?: string } | null>(null);
  useEffect(() => {
    if (!active) {
      setP(null);
      return;
    }
    return api.on('lock-progress', (x) => setP(x));
  }, [active]);
  return p;
}

const PHASE: Record<string, string> = {
  scan: 'Looking at what is inside…',
  encrypt: 'Encrypting',
  verify: 'Checking every file can be read back',
  remove: 'Removing the unencrypted original',
  decrypt: 'Decrypting and checking',
};

function Progress({ active, fallback }: { active: boolean; fallback: string }) {
  const p = useLockProgress(active);
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : null;
  return (
    <div className="lock-progress" role="status">
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <span>{p ? PHASE[p.phase] ?? p.phase : fallback}</span>
        <span className="muted small num">{pct !== null ? `${pct}% · ${formatBytes(p!.done)} of ${formatBytes(p!.total)}` : ''}</span>
      </div>
      <div className={`progress ${pct === null ? 'indeterminate' : ''}`}><i style={pct === null ? undefined : { width: `${pct}%` }} /></div>
      {p?.file ? <div className="small muted ellipsis">{p.file}</div> : null}
    </div>
  );
}

function StrengthMeter({ password }: { password: string }) {
  const s = passwordStrength(password);
  return (
    <div className="lock-strength" data-score={s.score} aria-label={`Password strength: ${s.label}`}>
      <div className="bars">{[0, 1, 2, 3].map((i) => <i key={i} className={password && i < Math.max(1, s.score) ? 'on' : ''} />)}</div>
      <span className="small muted">{password ? s.label : 'Use a long phrase that only you know'}</span>
    </div>
  );
}

// ---------------------------------------------------------------- lock

export function LockDialog({ dir, onClose }: { dir: string; onClose: () => void }) {
  const { toast, refresh } = useStore();
  const name = baseName(dir);
  const check = useAsync(() => api.lock.canLock(dir), [dir]);
  const status = useAsync<LockStatus>(() => api.lock.status(), []);
  const [step, setStep] = useState<'how' | 'key' | 'working'>('how');
  const [method, setMethod] = useState<'account' | 'password' | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [relock, setRelock] = useState<RelockWhen>('quit');
  const [minutes, setMinutes] = useState(15);
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = status.data?.account;
  const chosen = method ?? (account?.available ? 'account' : 'password');
  useEffect(() => void api.lock.newRecoveryKey().then(setKey), []);
  const pwOk = chosen === 'account' || (pw.length >= 4 && pw === pw2);

  const run = async () => {
    setStep('working');
    setError(null);
    try {
      const r = await api.lock.lock({ dir, method: chosen, password: chosen === 'password' ? pw : undefined, recoveryKey: key, relock, idleMinutes: minutes });
      toast(r.leftovers ? `“${name}” is locked, but some original files could not be removed. Check the folder.` : `“${name}” is locked`);
      refresh();
      onClose();
    } catch (e) {
      setError(lockError(e));
      setStep('key');
    }
  };

  const title = <span className="row" style={{ gap: 8 }}><Icon name="lock" size={18} /> Lock “{name}”</span>;
  if (check.data) {
    return (
      <Modal title={title} onClose={onClose} width={460}>
        <p className="lock-refused"><Icon name="warning" size={15} /> {check.data}</p>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }
  return (
    <Modal title={title} onClose={step === 'working' ? () => undefined : onClose} width={520}>
      {step === 'how' ? (
        <div className="col lock-dialog">
          <p className="muted" style={{ marginTop: 0 }}>
            Keeper encrypts everything inside into one locked file, <b>{name}.keeperlock</b>, checks it, then removes the unencrypted folder. Anyone using this computer, or a copy of the file, sees nothing until it is unlocked.
          </p>
          <div className="lock-methods" role="radiogroup" aria-label="How to unlock">
            <label className={`lock-method ${chosen === 'account' ? 'on' : ''} ${account && !account.available ? 'disabled' : ''}`}>
              <input type="radio" name="lock-method" disabled={!account?.available} checked={chosen === 'account'} onChange={() => setMethod('account')} />
              <Icon name="fingerprint" size={22} />
              <div>
                <div className="lock-method-title">Your account</div>
                <div className="small muted">{account ? (account.available ? `${account.label}. Only works on this computer.` : account.reason) : 'Checking…'}</div>
              </div>
            </label>
            <label className={`lock-method ${chosen === 'password' ? 'on' : ''}`}>
              <input type="radio" name="lock-method" checked={chosen === 'password'} onChange={() => setMethod('password')} />
              <Icon name="key" size={22} />
              <div>
                <div className="lock-method-title">A password</div>
                <div className="small muted">Works on any computer with Keeper. Keeper never stores it.</div>
              </div>
            </label>
          </div>
          {chosen === 'password' ? (
            <div className="col" style={{ gap: 8 }}>
              <input className="input" type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" />
              <StrengthMeter password={pw} />
              <input className="input" type="password" placeholder="Type it again" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="Confirm password" />
              {pw2 && pw !== pw2 ? <span className="small danger-text">The two passwords are different.</span> : null}
            </div>
          ) : null}
          <RelockPicker value={relock} minutes={minutes} onChange={(v, m) => { setRelock(v); setMinutes(m); }} />
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!pwOk || !status.data} onClick={() => setStep('key')}>Continue</button>
          </div>
        </div>
      ) : step === 'key' ? (
        <div className="col lock-dialog">
          <p style={{ marginTop: 0 }}><b>Save your recovery key.</b> It unlocks “{name}” if you forget the password{chosen === 'account' ? ', reinstall your system or move to a new computer' : ''}. Without it, nobody — not even Keeper — can get the files back.</p>
          <div className="lock-key" aria-label="Recovery key">{key}</div>
          <div className="btn-row">
            <button className="btn sm" onClick={() => void api.files.copyText(key).then(() => toast('Recovery key copied'))}><Icon name="copy" size={13} /> Copy</button>
            <button className="btn sm" onClick={() => void api.lock.saveRecoveryKey(key, name).then((ok) => ok && setSaved(true))}><Icon name="down" size={13} /> Save as a file…</button>
          </div>
          <label className="row lock-confirm">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I have saved the recovery key somewhere safe, away from this computer</span>
          </label>
          {error ? <p className="lock-refused"><Icon name="warning" size={15} /> {error}</p> : null}
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setStep('how')}>Back</button>
            <button className="btn primary" disabled={!saved || !key} onClick={() => void run()}><Icon name="lock" size={13} /> Lock Folder</button>
          </div>
        </div>
      ) : (
        <div className="col lock-dialog">
          <Progress active fallback="Starting…" />
          <p className="small muted" style={{ margin: 0 }}>The original stays untouched until the locked copy has been read back and checked.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => void api.lock.cancel()}>Stop</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- unlock

export function UnlockDialog({ vault, onClose, onUnlocked }: { vault: string; onClose: () => void; onUnlocked?: (folder: string) => void }) {
  const { toast, refresh } = useStore();
  const name = folderName(vault);
  const info = useAsync<VaultInfo>(() => api.lock.inspect(vault), [vault]);
  const status = useAsync<LockStatus>(() => api.lock.status(), []);
  const [mode, setMode] = useState<'account' | 'password' | 'recovery' | null>(null);
  const [secret, setSecret] = useState('');
  const [fallback, setFallback] = useState(false);
  const [relock, setRelock] = useState<RelockWhen>('quit');
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => setWait(info.data?.waitSeconds ?? 0), [info.data]);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const canAccount = !!info.data?.thisComputer && !!status.data?.account.available;
  const chosen = mode ?? (canAccount ? 'account' : info.data?.methods.includes('password') ? 'password' : 'recovery');
  const account = status.data?.account;
  const askAccountPassword = chosen === 'account' && (account?.needsPassword || (fallback && status.data?.platform === 'win32'));

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.lock.unlock({ vault, method: chosen, secret: chosen === 'account' && !askAccountPassword ? undefined : secret, fallback, relock, idleMinutes: minutes });
      toast(`“${name}” is unlocked`);
      refresh();
      onClose();
      onUnlocked?.(r.folder);
    } catch (e) {
      const m = lockError(e);
      setError(m);
      const w = m.match(/Wait (\d+) seconds/);
      if (w) setWait(Number(w[1]));
      else void api.lock.inspect(vault).then((x) => setWait(x.waitSeconds)).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const title = <span className="row" style={{ gap: 8 }}><Icon name="unlock" size={18} /> Unlock “{name}”</span>;
  return (
    <Modal title={title} onClose={busy ? () => undefined : onClose} width={480}>
      {!info.data ? (info.error ? <p className="lock-refused"><Icon name="warning" size={15} /> {lockError(info.error)}</p> : <Progress active={false} fallback="Opening…" />) : busy && chosen !== 'account' ? (
        <Progress active fallback="Checking…" />
      ) : (
        <form className="col lock-dialog" onSubmit={(e) => { e.preventDefault(); if (!busy && wait <= 0) void go(); }}>
          {chosen === 'account' ? (
            <div className="lock-account">
              <Icon name="fingerprint" size={34} />
              <div className="small muted">{busy ? `Waiting for ${account?.label ?? 'your account'}…` : `Confirm it’s you with ${fallback && status.data?.platform !== 'win32' ? (status.data?.platform === 'darwin' ? 'your Mac password' : 'your password') : account?.label ?? 'your account'}.`}</div>
              {askAccountPassword ? <input className="input" type="password" autoFocus placeholder="Your Windows password" value={secret} onChange={(e) => setSecret(e.target.value)} aria-label="Account password" /> : null}
            </div>
          ) : (
            <div className="col" style={{ gap: 6 }}>
              <input
                className={`input ${chosen === 'recovery' ? 'mono' : ''}`}
                type={chosen === 'password' ? 'password' : 'text'}
                autoFocus
                placeholder={chosen === 'password' ? 'Password' : 'Recovery key (XXXX-XXXX-…)'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                aria-label={chosen === 'password' ? 'Password' : 'Recovery key'}
              />
            </div>
          )}
          {error ? <p className="lock-refused"><Icon name="warning" size={15} /> {error}</p> : null}
          <RelockPicker value={relock} minutes={minutes} onChange={(v, m) => { setRelock(v); setMinutes(m); }} />
          <div className="lock-alt small">
            {canAccount && chosen !== 'account' ? <button type="button" className="link-like" onClick={() => { setMode('account'); setSecret(''); setError(null); }}>Use {account?.label ?? 'your account'}</button> : null}
            {chosen === 'account' && !fallback && status.data?.platform !== 'linux' && !account?.needsPassword ? <button type="button" className="link-like" onClick={() => { setFallback(true); setError(null); }}>Use {status.data?.platform === 'darwin' ? 'your Mac password' : 'your Windows password'} instead</button> : null}
            {info.data.methods.includes('password') && chosen !== 'password' ? <button type="button" className="link-like" onClick={() => { setMode('password'); setSecret(''); setError(null); }}>Use the folder’s password</button> : null}
            {chosen !== 'recovery' ? <button type="button" className="link-like" onClick={() => { setMode('recovery'); setSecret(''); setError(null); }}>Use the recovery key</button> : null}
          </div>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || wait > 0 || (chosen !== 'account' && !secret) || (askAccountPassword && !secret)}>
              {wait > 0 ? `Try again in ${wait}s` : busy ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Settings

const METHOD_LABEL: Record<string, string> = { device: 'your account', password: 'password', recovery: 'recovery key' };

export function LockedFoldersPanel() {
  const { go, toast, version } = useStore();
  const [rows, setRows] = useState<LockedFolder[] | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const load = useMemo(() => () => void api.lock.list().then(setRows), []);
  useEffect(() => {
    load();
    return api.on('locks-changed', load);
  }, [load, version]);
  if (!rows) return null;
  if (!rows.length) return <p className="small muted">No locked folders yet. Right-click a folder in Browse and choose Lock Folder….</p>;
  return (
    <div className="locked-list">
      {rows.map((r) => (
        <div key={r.vault} className={`locked-row ${r.state}`}>
          <Icon name={r.state === 'unlocked' ? 'unlock' : 'folderLock'} size={18} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 600 }}>{folderName(r.vault)}</div>
            <div className="small muted ellipsis">
              {r.state === 'unlocked' ? `Unlocked ${r.unlockedAt ? relativeTime(r.unlockedAt) : ''}` : r.state === 'missing' ? 'Not found where it was' : `Locked ${r.lockedAt ? relativeTime(r.lockedAt) : ''}`}
              {r.files !== undefined ? ` · ${r.files.toLocaleString()} files, ${formatBytes(r.bytes ?? 0)}` : ''} · opens with {r.methods.map((m) => METHOD_LABEL[m] ?? m).join(' or ')}
            </div>
          </div>
          <select className="input sm" value={r.relock} title="Lock again" onChange={(e) => void api.lock.setRelock(r.vault, e.target.value as RelockWhen, r.idleMinutes).then(setRows)}>
            {RELOCK.map((x) => <option key={x.value} value={x.value}>Lock {x.label}</option>)}
          </select>
          {r.state === 'unlocked' ? (
            <button className="btn sm" onClick={() => void api.lock.relock(r.vault).then(() => toast(`“${folderName(r.vault)}” is locked`), (e) => toast(lockError(e)))}><Icon name="lock" size={13} /> Lock now</button>
          ) : r.state === 'locked' ? (
            <button className="btn sm" onClick={() => setUnlocking(r.vault)}><Icon name="unlock" size={13} /> Unlock…</button>
          ) : null}
          <button className="btn sm ghost icon" title="Show" disabled={r.state === 'missing'} onClick={() => void api.files.reveal(r.state === 'unlocked' && r.folder ? r.folder : r.vault)}><Icon name="reveal" size={13} /></button>
          <button className="btn sm ghost icon" title="Stop listing it here (the locked file is kept)" onClick={() => void api.lock.forget(r.vault).then(setRows)}><Icon name="close" size={13} /></button>
        </div>
      ))}
      {unlocking ? <UnlockDialog vault={unlocking} onClose={() => setUnlocking(null)} onUnlocked={(f) => go({ name: 'browse', arg: f })} /> : null}
    </div>
  );
}
