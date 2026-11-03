// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Alerts to your phone: the ways Keeper can reach you (ntfy, Telegram, e-mail,
// a web address), what each one gets, a test button, and the last deliveries.

import { useCallback, useEffect, useState } from 'react';
import type { AlertChannelStatus, PhoneAlertsOverview } from '../../core/api-alerts';
import { ALERT_SOURCES, CHANNEL_KINDS, channelLine, channelProblems, kindLabel, secretNeed, type AlertChannel, type AlertChannelKind, type AlertSource } from '../../core/phone-alerts';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { FirstRun, PhoneArt } from '../components/FirstRun';
import { Icon } from '../components/Icon';
import { Loading, Modal, PageHead, Toggle } from '../components/ui';
import { useFeatureStates } from '../features';
import { useStore } from '../state';
import '../styles/extras.css';
import '../styles/alerts.css';

const KIND_ICON: Record<AlertChannelKind, string> = { ntfy: 'bell', telegram: 'send', email: 'mail', webhook: 'link' };

export function PhoneAlerts() {
  const { toast } = useStore();
  const states = useFeatureStates();
  const [ov, setOv] = useState<PhoneAlertsOverview | null>(null);
  const [edit, setEdit] = useState<{ channel: AlertChannel; isNew: boolean } | null>(null);
  const [testing, setTesting] = useState('');

  const load = useCallback(async () => setOv(await api.alerts.overview()), []);
  useEffect(() => {
    void load();
    return api.on('alerts-changed', () => void load());
  }, [load]);

  const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e));
  const fresh = (kind: AlertChannelKind = 'ntfy'): AlertChannel => ({ id: '', kind, name: kindLabel(kind), on: true, sources: ALERT_SOURCES.filter((s) => s.id === 'monitors' || s.id === 'backups').map((s) => s.id), server: kind === 'ntfy' ? 'https://ntfy.sh' : undefined });
  const test = async (c: AlertChannelStatus) => {
    setTesting(c.id);
    try {
      const r = await api.alerts.test(c.id);
      toast(r.ok ? `Test sent to ${c.name}` : r.message);
    } catch (e) { fail(e); } finally { setTesting(''); void load(); }
  };

  if (!ov) return <div className="page"><PageHead title="Phone Alerts" /><Loading /></div>;
  const featureOn = (f: string) => states?.get(f)?.on !== false;

  return (
    <div className="page pa-page" data-testid="alerts-page">
      <PageHead title="Phone Alerts" sub="Keeper’s alerts on your phone. Only the ones you choose.">
        {ov.channels.length ? <button className="btn primary" data-testid="pa-add" onClick={() => setEdit({ channel: fresh(), isNew: true })}><Icon name="plus" size={14} /> Add a way</button> : null}
      </PageHead>

      {!ov.channels.length ? (
        <FirstRun testid="pa-first" kicker="Phone alerts" title="Alerts that find you" mark="find"
          line="A site goes down or a backup fails: Keeper tells your phone, even when you are away from this computer."
          art={<PhoneArt />}
          action={<button className="btn primary" data-testid="pa-add" onClick={() => setEdit({ channel: fresh(), isNew: true })}><Icon name="plus" size={14} /> Add a way to reach you</button>}
          more={<span className="muted small">ntfy, Telegram, e-mail or a web address</span>}
          trust={['Only alerts you choose', 'Tokens stay in your keychain', 'Nothing is sent until you add one']} />
      ) : (
        <div className="pa-list" data-testid="pa-list">
          {ov.channels.map((c) => (
            <section key={c.id} className={`xpanel pa-card${c.on ? '' : ' off'}`} aria-label={c.name} data-testid={`pa-card-${c.kind}`}>
              <div className="pa-icon" aria-hidden><Icon name={KIND_ICON[c.kind]} size={18} /></div>
              <div className="pa-body">
                <div className="pa-name">{c.name}</div>
                <div className="muted small">{channelLine(c)}</div>
                <div className="pa-chips">
                  {c.sources.length ? c.sources.map((s) => <span key={s} className="xchip">{ALERT_SOURCES.find((x) => x.id === s)?.label}</span>) : <span className="xchip warn">Gets nothing yet</span>}
                </div>
                <p className="trust-line" data-testid="pa-last">
                  {c.secretLocked ? 'The keychain would not open this token.' : c.last ? `${c.last.ok ? 'Delivered' : 'Not delivered'} ${relativeTime(c.last.at)}${c.last.ok ? '' : ` · ${c.last.message}`}` : 'Nothing sent yet'}
                </p>
              </div>
              <div className="pa-ctl">
                <button className="btn sm" disabled={testing === c.id || !c.on} onClick={() => void test(c)} data-testid="pa-test">{testing === c.id ? 'Sending…' : 'Send a test'}</button>
                <button className="btn sm ghost icon" title={`Change ${c.name}`} aria-label={`Change ${c.name}`} onClick={() => setEdit({ channel: c, isNew: false })}><Icon name="settings" size={14} /></button>
                <Toggle on={c.on} label={`${c.name} on`} onChange={(on) => void api.alerts.save({ ...stripStatus(c), on }).then(setOv, fail)} />
              </div>
            </section>
          ))}
          <p className="trust-line pa-trust">Alerts that come close together arrive as one message · Tokens stay in your keychain{ov.memoryOnly ? ' (this computer has none: they are kept until Keeper quits)' : ''} · Off sends nothing</p>
          {ov.log.length ? (
            <details className="xpanel pa-log">
              <summary><b>Recent</b> <span className="muted small">{ov.log.length} sent</span></summary>
              <ul>
                {ov.log.map((l, i) => (
                  <li key={i}><span className={`sdot ${l.ok ? 'up' : 'down'}`} /> <span className="grow">{l.title}</span> <span className="muted small">{ov.channels.find((c) => c.id === l.channel)?.name ?? ''} · {relativeTime(l.at)}{l.test ? ' · test' : ''}</span></li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      {edit ? (
        <ChannelSheet ov={ov} start={edit.channel} isNew={edit.isNew} featureOn={featureOn}
          onClose={() => setEdit(null)}
          onSaved={(o, msg) => { setOv(o); setEdit(null); toast(msg); }} />
      ) : null}
    </div>
  );
}

const stripStatus = (c: AlertChannelStatus): AlertChannel => {
  const { hasSecret: _h, secretLocked: _l, last: _x, ...rest } = c;
  return rest;
};

function ChannelSheet({ ov, start, isNew, featureOn, onClose, onSaved }: { ov: PhoneAlertsOverview; start: AlertChannel; isNew: boolean; featureOn: (f: string) => boolean; onClose: () => void; onSaved: (o: PhoneAlertsOverview, msg: string) => void }) {
  const [c, setC] = useState<AlertChannel>(isNew ? start : stripStatus(start as AlertChannelStatus));
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const saved = ov.channels.find((x) => x.id === c.id);
  const need = secretNeed(c.kind);
  const problems = channelProblems(c, !!secret.trim() || !!saved?.hasSecret);
  const set = (patch: Partial<AlertChannel>) => { setC({ ...c, ...patch }); setErr(''); };
  const toggleSource = (s: AlertSource) => set({ sources: c.sources.includes(s) ? c.sources.filter((x) => x !== s) : [...c.sources, s] });
  const save = async (thenTest: boolean) => {
    setBusy(true);
    try {
      const o = await api.alerts.save(c, secret.trim() ? secret : undefined);
      const id = c.id || o.channels.at(-1)?.id || '';
      if (thenTest && id) {
        const r = await api.alerts.test(id);
        onSaved(await api.alerts.overview(), r.ok ? 'Saved. A test is on its way.' : `Saved, but the test failed: ${r.message}`);
      } else onSaved(o, 'Saved');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={isNew ? 'Add a way to reach you' : `Change ${start.name}`} onClose={onClose} width={520}>
      <div className="xform" data-testid="pa-sheet">
        {isNew ? (
          <div className="seg pa-kinds" role="radiogroup" aria-label="How to send">
            {CHANNEL_KINDS.map((k) => (
              <button key={k.id} role="radio" aria-checked={c.kind === k.id} className={c.kind === k.id ? 'on' : ''} data-testid={`pa-kind-${k.id}`}
                onClick={() => set({ kind: k.id, name: c.name === kindLabel(c.kind) ? k.label : c.name, server: k.id === 'ntfy' ? c.server ?? 'https://ntfy.sh' : c.server })}>
                <Icon name={KIND_ICON[k.id]} size={13} /> {k.label}
              </button>
            ))}
          </div>
        ) : null}
        <p className="xform-note">{CHANNEL_KINDS.find((k) => k.id === c.kind)?.line}</p>
        <label>Name<input className="input" value={c.name} onChange={(e) => set({ name: e.target.value })} data-testid="pa-name" /></label>

        {c.kind === 'ntfy' ? (
          <>
            <label>Topic<input className="input" value={c.topic ?? ''} onChange={(e) => set({ topic: e.target.value })} placeholder="a-long-name-only-you-know" data-testid="pa-topic" /></label>
            <p className="xform-note">Anyone who knows a topic on the public server can read it, so pick a long, unusual name. Subscribe to it in the ntfy app.</p>
            <details className="pa-more">
              <summary>More settings</summary>
              <div className="xform">
                <label>Server<input className="input" value={c.server ?? ''} onChange={(e) => set({ server: e.target.value })} placeholder="https://ntfy.sh" data-testid="pa-server" /></label>
                <label>Access token (if your server needs one)<input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={saved?.hasSecret ? 'Saved. Type to replace it.' : 'Optional'} autoComplete="off" /></label>
              </div>
            </details>
          </>
        ) : c.kind === 'telegram' ? (
          <>
            <label>Bot token<input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={saved?.hasSecret ? 'Saved. Type to replace it.' : '123456789:ABC…'} autoComplete="off" data-testid="pa-secret" /></label>
            <label>Chat<input className="input" value={c.chatId ?? ''} onChange={(e) => set({ chatId: e.target.value })} placeholder="123456789 or @yourchannel" data-testid="pa-chat" /></label>
            <p className="xform-note">Make a bot with @BotFather, send it a message, then put your chat number here.</p>
          </>
        ) : c.kind === 'email' ? (
          ov.accounts.length ? (
            <div className="xform-row">
              <label>Send from
                <select className="input" value={c.account ?? ''} onChange={(e) => set({ account: e.target.value })} data-testid="pa-account">
                  <option value="">Choose…</option>
                  {ov.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}{a.email && a.email !== a.label ? ` (${a.email})` : ''}</option>)}
                </select>
              </label>
              <label>To<input className="input" type="email" value={c.to ?? ''} onChange={(e) => set({ to: e.target.value })} placeholder="you@example.com" data-testid="pa-to" /></label>
            </div>
          ) : <p className="xform-err" role="status">Add a mail account in Mail first; Keeper sends from it.</p>
        ) : (
          <>
            <label>Web address<input className="input" value={c.url ?? ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/hooks/keeper" data-testid="pa-url" /></label>
            <details className="pa-more">
              <summary>More settings</summary>
              <div className="xform">
                <label>Secret (sent as a bearer token)<input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={saved?.hasSecret ? 'Saved. Type to replace it.' : 'Optional'} autoComplete="off" /></label>
              </div>
            </details>
          </>
        )}

        <div>
          <div className="insp-title" style={{ marginBottom: 8 }}>Send me</div>
          <div className="xchecks" role="group" aria-label="Alerts to send">
            {ALERT_SOURCES.map((s) => (
              <button key={s.id} className="xcheck" aria-pressed={c.sources.includes(s.id)} onClick={() => toggleSource(s.id)} data-testid={`pa-src-${s.id}`}>
                {c.sources.includes(s.id) ? <Icon name="check" size={12} /> : null}{s.label}{featureOn(s.feature) ? '' : ' (off)'}
              </button>
            ))}
          </div>
        </div>

        {need === 'required' && saved?.secretLocked ? <p className="xform-err">The keychain would not open the saved token. Paste it again.</p> : null}
        {err ? <p className="xform-err" role="alert">{err}</p> : null}
        <div className="xform-foot">
          {!isNew ? <button className="btn ghost danger" onClick={() => { if (confirm(`Remove ${start.name}? Its token is deleted too.`)) void api.alerts.remove(start.id).then((o) => onSaved(o, 'Removed')); }}>Remove</button> : null}
          <span className="grow" />
          <button className="btn" disabled={busy || !!problems.length} onClick={() => void save(false)}>Save</button>
          <button className="btn primary" disabled={busy || !!problems.length} onClick={() => void save(true)} title={problems[0]} data-testid="pa-save-test">{busy ? 'Saving…' : 'Save and send a test'}</button>
        </div>
        {problems.length ? <p className="xform-note" data-testid="pa-problem">{problems[0]}</p> : null}
      </div>
    </Modal>
  );
}
