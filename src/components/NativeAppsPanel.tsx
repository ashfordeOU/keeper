// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Open with: which app maps, forecasts, events, email and the rest
// open in. Only kinds with more than one choice on this computer are shown.

import { useEffect, useState } from 'react';
import type { NativeKindInfo } from '../../core/native-apps';
import { api } from '../api';
import { Row } from '../screens/IslandSettings';
import { useStore } from '../state';
import { Icon } from './Icon';

export function NativeAppsPanel() {
  const { settings, updateSettings } = useStore();
  const [kinds, setKinds] = useState<NativeKindInfo[] | null>(null);
  const load = (refresh?: boolean) => void api.native.apps(refresh).then(setKinds).catch(() => setKinds([]));
  useEffect(() => load(), []);
  if (!settings || !kinds) return null;
  const shown = kinds.filter((k) => k.choices.length > 1);
  const pick = (k: NativeKindInfo, v: string) => {
    void updateSettings({ nativeApps: { ...(settings.nativeApps ?? {}), [k.kind]: v } });
    setKinds(kinds.map((x) => (x.kind === k.kind ? { ...x, pick: v } : x)));
  };
  return (
    <>
      <div className="small muted" style={{ marginBottom: 6 }}>Places, forecasts, events, email addresses and phone numbers in Keeper open in your own apps. Automatic uses the one built into your system, or Google Maps when it is installed as an app.</div>
      {shown.map((k) => {
        const value = k.choices.some((c) => c.id === k.pick) ? k.pick : 'auto';
        return (
          <Row key={k.kind} title={k.label} desc={value === 'auto' && k.auto ? `Automatic opens ${k.auto}` : undefined}>
            <select className="input" aria-label={`Open ${k.label.toLowerCase()} with`} value={value} onChange={(e) => pick(k, e.target.value)}>
              <option value="auto">Automatic</option>
              {k.choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Row>
        );
      })}
      <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => load(true)}><Icon name="refresh" size={12} /> Look for apps again</button>
    </>
  );
}
