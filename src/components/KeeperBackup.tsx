// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → General → Move or back up Keeper: a file sealed with a password,
// sending it to another of your computers, a copy each night and putting one
// back. The same restore sheet opens from setup's "Moving from another
// computer?" (core/keeper-backup.ts, electron/services/keeper-backup.ts).

import { useEffect, useState } from 'react';
import type { KeeperBackupStatus } from '../../core/api-keeper-backup';
import type { LinkDevice } from '../../core/api-link';
import { formatBytes } from '../../core/format';
import { passwordProblem, type BackupMeta } from '../../core/keeper-backup';
import { api } from '../api';
import { useFeature } from '../features';
import { Row } from '../screens/IslandSettings';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Modal, Toggle } from './ui';
import '../styles/keeper-backup.css';

const errorText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export function KeeperBackupPanel() {
  const { toast } = useStore();
  const [st, setSt] = useState<KeeperBackupStatus | null>(null);
  const [ask, setAsk] = useState<null | { kind: 'save' } | { kind: 'send'; device: LinkDevice }>(null);
  const [restoring, setRestoring] = useState(false);
  const [devices, setDevices] = useState<LinkDevice[]>([]);
  const [pick, setPick] = useState('');
  const nightly = useFeature('keeperBackup');
  const linkOn = useFeature('link');
  const load = () => void api.keeperBackup.status().then((s) => { setSt(s); setPick((p) => p || s.snapshots[0]?.name || ''); }, () => undefined);
  useEffect(load, [nightly]);
  useEffect(() => { if (linkOn) void api.link.state().then((s) => setDevices(s.devices), () => setDevices([])); }, [linkOn]);

  return (
    <div className="kb" data-testid="keeper-backup">
      <p className="kb-trust small muted">Everything but passwords · Sealed with your password · On this computer until you move it</p>
      <Row title="Back up to a file" desc={st ? `${st.files} files, ${formatBytes(st.bytes)}. Open it on a new computer to carry on where you left off.` : 'Reading…'}>
        <button className="btn primary" data-testid="kb-save" onClick={() => setAsk({ kind: 'save' })}><Icon name="down" size={13} /> Back up…</button>
      </Row>
      <Row title="Restore from a file" desc="Puts Keeper back as it was in a backup. Keeper restarts to finish.">
        <button className="btn" data-testid="kb-restore" onClick={() => setRestoring(true)}><Icon name="arrowUp" size={13} /> Restore…</button>
      </Row>
      {linkOn && devices.length ? (
        <Row title="Send to another computer" desc="Over your own link, sealed with your password. Restore it there.">
          <select className="input" aria-label="Send to" value="" onChange={(e) => { const d = devices.find((x) => x.id === e.target.value); if (d) setAsk({ kind: 'send', device: d }); }}>
            <option value="">Choose a computer…</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Row>
      ) : null}
      <Row title="A copy each night" desc="Keeps the last 14 on this computer, so you can put Keeper back to how it was on Tuesday.">
        <Toggle label="A copy each night" on={nightly} onChange={(v) => void api.features.set('keeperBackup', v)} />
      </Row>
      {st?.snapshots.length ? (
        <Row title="Put Keeper back to" desc="What it replaces is kept, so this can be undone the same way.">
          <div className="btn-row">
            <select className="input" aria-label="Copy to restore" data-testid="kb-snapshots" value={pick} onChange={(e) => setPick(e.target.value)}>
              {st.snapshots.map((s) => <option key={s.name} value={s.name}>{s.label} · {formatBytes(s.bytes)}</option>)}
            </select>
            <button className="btn" data-testid="kb-snapshot-restore" disabled={!pick} onClick={() => void api.keeperBackup.restoreSnapshot(pick).then(() => toast('Keeper restarts to put it back'), (e) => toast(errorText(e)))}>Restore</button>
          </div>
        </Row>
      ) : nightly ? (
        <Row title="No copies yet" desc="The first one is made in a few minutes.">
          <button className="btn ghost" data-testid="kb-snapshot-now" onClick={() => void api.keeperBackup.snapshotNow().then((s) => { setSt(s); setPick(s.snapshots[0]?.name ?? ''); toast('Copy made'); }, (e) => toast(errorText(e)))}>Make one now</button>
        </Row>
      ) : null}
      {st?.leftOut.length ? (
        <details className="kb-left">
          <summary className="small">What a copy leaves out</summary>
          <ul className="small muted">{st.leftOut.map((l) => <li key={l.why}>{l.text}</li>)}</ul>
        </details>
      ) : null}
      {ask ? (
        <PasswordSheet
          title={ask.kind === 'save' ? 'Back up Keeper' : `Send to ${ask.device.name}`}
          action={ask.kind === 'save' ? 'Back up' : 'Send'}
          onClose={() => setAsk(null)}
          onDone={async (pw) => {
            if (ask.kind === 'save') { const p = await api.keeperBackup.saveFile(pw); if (p) toast(`Saved ${p.split(/[\\/]/).pop()}`); }
            else { await api.keeperBackup.sendTo(ask.device.id, pw); toast(`Sent to ${ask.device.name}. Restore it there with the same password.`); }
          }}
        />
      ) : null}
      {restoring ? <RestoreSheet onClose={() => setRestoring(false)} /> : null}
    </div>
  );
}

function PasswordSheet({ title, action, onClose, onDone }: { title: string; action: string; onClose: () => void; onDone: (pw: string) => Promise<void> }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problem = passwordProblem(pw, again);
  return (
    <Modal title={title} onClose={onClose} width={440} testId="kb-password">
      <form className="kb-form" onSubmit={(e) => { e.preventDefault(); if (problem) return setError(problem); setBusy(true); setError(''); void onDone(pw).then(onClose, (x) => { setError(errorText(x)); setBusy(false); }); }}>
        <p className="small muted">You need this password to open the backup. Keeper cannot get it back for you.</p>
        <label><span>Password</span><input type="password" autoFocus data-testid="kb-pw" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
        <label><span>Again</span><input type="password" data-testid="kb-pw2" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></label>
        {error || (pw && again && problem) ? <div className="small warn-text" role="alert">{error || problem}</div> : null}
        <div className="btn-row modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" data-testid="kb-go" disabled={busy || !!problem}>{busy ? 'Working…' : action}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Choose a .keeperbackup, see where it came from, type its password: Keeper restarts as it was. */
export function RestoreSheet({ onClose, file: given }: { onClose: () => void; file?: string }) {
  const [file, setFile] = useState<{ file: string; meta: BackupMeta } | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (given) void api.keeperBackup.inspect(given).then((meta) => setFile({ file: given, meta }), (e) => setError(errorText(e)));
  }, [given]);
  const choose = () => void api.keeperBackup.pickFile().then((r) => { if (r) { setFile(r); setError(''); } }, (e) => setError(errorText(e)));
  return (
    <Modal title="Restore Keeper" onClose={onClose} width={460} testId="kb-restore-sheet">
      {!file ? (
        <>
          <p className="small muted">Choose a Keeper backup (a file ending in .keeperbackup) made on this or another computer.</p>
          {error ? <div className="small warn-text" role="alert">{error}</div> : null}
          <div className="btn-row modal-actions">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" autoFocus data-testid="kb-choose" onClick={choose}>Choose a backup…</button>
          </div>
        </>
      ) : (
        <form className="kb-form" onSubmit={(e) => { e.preventDefault(); setBusy(true); setError(''); void api.keeperBackup.restoreFile(file.file, pw).then(() => setError(''), (x) => { setError(errorText(x)); setBusy(false); }); }}>
          <div className="kb-meta" data-testid="kb-meta">
            <span className="kb-kicker">From</span>
            <b>{file.meta.from}</b>
            <span className="small muted">{new Date(file.meta.created).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · Keeper {file.meta.keeper} · {file.meta.files} files</span>
          </div>
          <label><span>Its password</span><input type="password" autoFocus data-testid="kb-restore-pw" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          {error ? <div className="small warn-text" role="alert">{error}</div> : null}
          <p className="small muted">Keeper restarts to finish. What it replaces is kept as a copy. Passwords and pairing are entered again.</p>
          <div className="btn-row modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" data-testid="kb-restore-go" disabled={busy || !pw}>{busy ? 'Restoring…' : 'Restore and restart'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
