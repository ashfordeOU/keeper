// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A connection as a drive (core/remote/drive.ts), on its page's status line:
// "Open as a Drive" when it is not one; where it shows, how it is doing,
// Show and Close when it is. When this computer or this kind of connection
// cannot, one click explains why and what would make it work.

import { useEffect, useState } from 'react';
import { driveFor, driveStatusText, type DriveStatus, type DriveSupport } from '../../core/remote/drive';
import type { Connection } from '../../core/remote/types';
import { api } from '../api';
import { useFeature } from '../features';
import { useStore } from '../state';
import { errText } from './ConnectionDialog';
import { Icon } from './Icon';
import { Modal } from './ui';

interface Drive { id: string; name: string; place: string; status: DriveStatus }

export function DriveControl({ conn }: { conn: Connection }) {
  const on = useFeature('driveMount');
  const { toast, info } = useStore();
  const [drive, setDrive] = useState<Drive | null>(null);
  const [why, setWhy] = useState<{ title: string; detail: string; steps?: string[]; link?: DriveSupport['link'] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    void api.remote.drives().then((l) => alive && setDrive(l.find((d) => d.id === conn.id) ?? null), () => undefined);
    const off = api.on('remote-drive', (d) => { if (d.id === conn.id) setDrive(d.closed ? null : d); });
    return () => { alive = false; off(); };
  }, [on, conn.id]);
  if (!on) return null;

  const fm = info?.platform === 'darwin' ? 'Finder' : info?.platform === 'win32' ? 'File Explorer' : 'the file manager';
  const openIt = async () => {
    const can = driveFor(conn);
    if (!can.ok) { setWhy({ title: 'Can’t be a drive', detail: can.why }); return; }
    setBusy(true);
    try {
      const sup = await api.remote.driveSupport();
      if (!sup.ready) { setWhy(sup); return; }
      const d = await api.remote.openDrive(conn.id);
      setDrive(d);
      toast(`${conn.name} is a drive now: ${d.place}`);
    } catch (e) {
      setWhy({ title: 'Couldn’t open it as a drive', detail: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {drive ? (
        <span className="drive-on" data-testid="drive-on">
          <Icon name="disk" size={13} />
          <span title={drive.place}>Drive in {fm}</span>
          <span className={`drive-state ${drive.status.state}`} data-testid="drive-state">· {driveStatusText(drive.status)}</span>
          <button className="btn ghost sm" onClick={() => void api.remote.showDrive(conn.id)}>Show</button>
          <button className="btn ghost sm" data-testid="drive-close" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await api.remote.closeDrive(conn.id); setDrive(null); toast(`${conn.name} is no longer a drive`); } catch (e) { toast(errText(e)); } finally { setBusy(false); }
          }}>Close Drive</button>
        </span>
      ) : (
        <button className="btn ghost sm" data-testid="drive-open" disabled={busy} title={`Show it in ${fm}, for every app`} onClick={() => void openIt()}>
          <Icon name="disk" size={13} /> {busy ? 'Opening…' : 'Open as a Drive'}
        </button>
      )}
      {why ? (
        <Modal title={why.title} onClose={() => setWhy(null)} width={460} testId="drive-why">
          <div className="col">
            <p className="drive-why-text">{why.detail}</p>
            {why.steps?.length ? <ol className="drive-steps">{why.steps.map((s) => <li key={s}>{s}</li>)}</ol> : null}
            <div className="small muted">It still opens here in Keeper, as it does now.</div>
            <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
              {why.link ? <button className="btn" onClick={() => void api.system.openExternal(why.link!.url)}><Icon name="external" size={13} /> {why.link.label} website</button> : null}
              <button className="btn primary" onClick={() => setWhy(null)}>OK</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
