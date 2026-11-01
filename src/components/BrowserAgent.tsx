// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Computer use, the part beyond the screen: what is running now (Keeper's
// browser tabs and private desktops, with take over / hand back), the plan
// each AI is following, what always waits for the person, saved sign-ins that
// Keeper fills without the AI seeing them, and recorded workflows.

import { useEffect, useState } from 'react';
import type { CuSettingsView, CuState } from '../../core/api-cu';
import type { WorkflowTrigger } from '../../core/cu/schedule';
import type { Sensitive } from '../../core/cu/guard';
import { planText } from '../../core/cu/run';
import type { SavedSecret } from '../../core/cu/secrets';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { useStore } from '../state';
import { Icon } from './Icon';

function useCu(): [CuState | null, CuSettingsView | null, () => void] {
  const [s, setS] = useState<CuState | null>(null);
  const [c, setC] = useState<CuSettingsView | null>(null);
  const load = () => {
    void api.cu.state().then(setS).catch(() => undefined);
    void api.cu.settings().then(setC).catch(() => undefined);
  };
  useEffect(() => {
    load();
    return api.on('cu-changed', load);
  }, []);
  return [s, c, load];
}

export function BrowserAgentPanel() {
  const { toast } = useStore();
  const [s, c, reload] = useCu();
  const [adding, setAdding] = useState<{ name: string; sites: string; source: SavedSecret['source']; ref: string; value: string } | null>(null);
  const [recUrl, setRecUrl] = useState('https://');
  const [recording, setRecording] = useState<string | null>(null);
  const [recName, setRecName] = useState('');
  if (!s || !c) return null;
  const live = s.tabs.filter((t) => !t.recording);
  const running = s.tasks.filter((t) => t.state === 'running' || t.state === 'paused' || t.state === 'waiting-for-person');
  const toggleKind = (k: Sensitive) => void api.cu.setSettings({ askBefore: c.askBefore.includes(k) ? c.askBefore.filter((x) => x !== k) : [...c.askBefore, k] }).then(reload);

  return (
    <div className="card perm-group browser-agent">
      <div style={{ fontWeight: 650 }}><Icon name="globe" size={14} /> Keeper’s browser and private desktops</div>
      <div className="small muted">
        For web tasks AIs use Keeper’s own browser: they read each page as a numbered list of its buttons, links and fields and act on them directly, which is faster and far more reliable than clicking on pictures.
        Tabs run hidden so you keep working; watch, take over and hand back any time. {s.desktopSupport.ok ? 'App tasks can run on a private desktop of their own.' : s.desktopSupport.why}
      </div>

      {live.length || s.desktops.length ? (
        <div className="col" style={{ gap: 6, marginTop: 10 }}>
          {live.map((t) => (
            <div key={t.id} className="row cu-tab">
              <span className={`dot ${t.takenOver ? 'off' : 'error'}`} />
              <div className="grow ellipsis"><b>{t.client}</b> {t.takenOver ? 'is waiting — you have the controls' : 'is working'} · {t.title || t.url} <span className="small muted">· {t.steps} steps{t.downloads.length ? ` · ${t.downloads.length} downloaded` : ''}</span></div>
              <button className="btn sm" onClick={() => void api.cu.show(t.id, !t.visible).then(reload)}>{t.visible ? 'Hide' : 'Watch'}</button>
              <button className="btn sm" onClick={() => void api.cu.takeOver(t.id, !t.takenOver).then(reload)}>{t.takenOver ? 'Hand back' : 'Take over'}</button>
              <button className="btn sm ghost icon" title="Close this tab" aria-label="Close this tab" onClick={() => void api.cu.closeTab(t.id).then(reload)}><Icon name="close" size={12} /></button>
            </div>
          ))}
          {s.desktops.map((d) => <div key={d.id} className="row cu-tab"><span className="dot error" /><div className="grow"><b>{d.client}</b> is using a private desktop ({d.display}) since {relativeTime(d.since)}</div></div>)}
        </div>
      ) : null}

      {running.map((t) => (
        <div key={t.id} className="cu-plan">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="small"><b>{t.client}</b> · {t.state === 'paused' ? 'paused' : t.state === 'waiting-for-person' ? 'waiting for you' : 'working'} · {t.steps} steps · {relativeTime(t.started)}</div>
            <div className="row" style={{ gap: 6 }}>
              {s.resumable.includes(t.id) && t.state === 'paused' ? <button className="btn sm" onClick={() => void api.cu.resume(t.id).then(reload)}>Reopen its tabs</button> : null}
              <button className="btn sm ghost" onClick={() => void api.cu.forgetTask(t.id).then(reload)}>Forget</button>
            </div>
          </div>
          {t.plan ? (
            <textarea
              className="input mono small"
              rows={Math.min(10, t.plan.steps.length + 1)}
              defaultValue={planText(t.plan)}
              title="Edit the plan: the AI reads it at its next step"
              onBlur={(e) => {
                const steps = e.target.value.split('\n').slice(1).map((l) => l.replace(/^\[[ >x!-]\]\s*\d+\.\s*/, '').replace(/\s+—\s.*$/, '')).join('\n');
                void api.cu.editPlan(t.client, steps).then(reload);
              }}
            />
          ) : <div className="small muted">No plan written yet.</div>}
        </div>
      ))}

      <div style={{ marginTop: 14, fontWeight: 600 }} className="small">Always ask me before an AI tries to…</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {(Object.keys(c.labels) as Sensitive[]).map((k) => (
          <label key={k} className={`chip ${c.askBefore.includes(k) ? 'on' : ''}`} style={{ cursor: 'default' }}>
            <input type="checkbox" checked={c.askBefore.includes(k)} onChange={() => toggleKind(k)} /> {c.labels[k]}
          </label>
        ))}
      </div>
      <div className="row small" style={{ gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        <label><input type="checkbox" checked={c.showTabs} onChange={(e) => void api.cu.setSettings({ showTabs: e.target.checked }).then(reload)} /> Show browser tabs while an AI works</label>
        <label>Pause after <input className="input sm" type="number" min={10} max={1000} value={c.maxSteps} onChange={(e) => void api.cu.setSettings({ maxSteps: Number(e.target.value) }).then(reload)} style={{ width: 70 }} /> steps</label>
        <label>or <input className="input sm" type="number" min={1} max={240} value={c.maxMinutes} onChange={(e) => void api.cu.setSettings({ maxMinutes: Number(e.target.value) }).then(reload)} style={{ width: 60 }} /> minutes</label>
      </div>
      <div className="row small" style={{ gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
        <label title="Paired phones (Devices → Phone) show what the AI is doing and can answer its questions"><input type="checkbox" checked={c.phoneApprovals} onChange={(e) => void api.cu.setSettings({ phoneApprovals: e.target.checked }).then(reload)} /> Answer from my phone</label>
        <label title="Some agent apps cannot take pictures; they still get the numbered lists"><input type="checkbox" checked={c.mcpScreenshots === 'images'} onChange={(e) => void api.cu.setSettings({ mcpScreenshots: e.target.checked ? 'images' : 'text' }).then(reload)} /> Send screenshots to connected agents</label>
      </div>

      <div style={{ marginTop: 14, fontWeight: 600 }} className="small">Saved sign-ins</div>
      <div className="small muted">An AI asks for <code>{'{{secret:name}}'}</code>; Keeper types the real value itself, only on the sites listed. The AI, the log and the conversation never see it.</div>
      <div className="col" style={{ gap: 4, marginTop: 6 }}>
        {c.secrets.map((x) => (
          <div key={x.name} className="row small">
            <Icon name="key" size={12} /> <b>{x.name}</b> <span className="muted grow">on {x.sites.join(', ')} · {x.source === 'keychain' ? 'system keychain' : x.source === 'op' ? '1Password' : 'Bitwarden'}</span>
            <button className="btn sm ghost icon" title="Remove" aria-label="Remove" onClick={() => void api.cu.removeSecret(x.name).then(reload)}><Icon name="close" size={11} /></button>
          </div>
        ))}
        {adding ? (
          <div className="col cu-add" style={{ gap: 6 }}>
            <input className="input sm" placeholder="name, e.g. shop-login" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
            <input className="input sm" placeholder="sites, e.g. shop.example.com" value={adding.sites} onChange={(e) => setAdding({ ...adding, sites: e.target.value })} />
            <div className="seg">
              {(['keychain', 'op', 'bw'] as const).map((k) => <button key={k} className={adding.source === k ? 'on' : ''} onClick={() => setAdding({ ...adding, source: k })}>{k === 'keychain' ? 'Keep in keychain' : k === 'op' ? '1Password' : 'Bitwarden'}</button>)}
            </div>
            {adding.source === 'keychain'
              ? <input className="input sm" type="password" placeholder="password or value" value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} />
              : <input className="input sm" placeholder={adding.source === 'op' ? 'op://Vault/Item/password' : 'item id (add #totp for codes)'} value={adding.ref} onChange={(e) => setAdding({ ...adding, ref: e.target.value })} />}
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm primary" onClick={() => void api.cu.saveSecret({ name: adding.name.trim(), sites: adding.sites.split(/[,\s]+/).filter(Boolean), source: adding.source, ref: adding.ref || undefined }, adding.value || undefined).then(() => { setAdding(null); reload(); }, (e: Error) => toast(e.message))}>Save</button>
              <button className="btn sm" onClick={() => setAdding(null)}>Cancel</button>
            </div>
          </div>
        ) : <button className="link-like small" onClick={() => setAdding({ name: '', sites: '', source: 'keychain', ref: '', value: '' })}>Add a saved sign-in…</button>}
      </div>

      <div style={{ marginTop: 14, fontWeight: 600 }} className="small">Workflows: show Keeper once, then let it repeat</div>
      <div className="small muted">Record yourself doing a task in Keeper’s browser. What you typed becomes blanks to fill on each run; passwords become saved sign-ins.</div>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        {recording ? (
          <>
            <input className="input sm grow" placeholder="Name this workflow" value={recName} onChange={(e) => setRecName(e.target.value)} />
            <button className="btn sm primary" onClick={() => void api.cu.stopRecording(recording, recName).then((id) => { setRecording(null); toast(id ? 'Workflow saved' : 'Nothing was recorded'); reload(); })}>Stop and save</button>
          </>
        ) : (
          <>
            <input className="input sm grow" value={recUrl} onChange={(e) => setRecUrl(e.target.value)} />
            <button className="btn sm" onClick={() => void api.cu.record(recUrl).then(setRecording)}><Icon name="camera" size={12} /> Record</button>
          </>
        )}
      </div>
      <div className="col" style={{ gap: 4, marginTop: 6 }}>
        {s.workflows.map((w) => <WorkflowRow key={w.id} w={w} schedules={s.schedules.filter((x) => x.workflowId === w.id)} reload={reload} />)}
      </div>
    </div>
  );
}

type WorkflowView = CuState['workflows'][number];

/** One workflow: run it now, or let it run by itself (on a schedule, when Keeper starts, when the computer wakes). */
function WorkflowRow({ w, schedules, reload }: { w: WorkflowView; schedules: CuState['schedules']; reload: () => void }) {
  const { toast } = useStore();
  const [open, setOpen] = useState<'run' | 'schedule' | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(w.params.filter((p) => !p.secret).map((p) => [p.name, p.example])));
  const [trigger, setTrigger] = useState<WorkflowTrigger>('schedule');
  const [when, setWhen] = useState('every monday at 9');
  const [visible, setVisible] = useState(false);
  const blanks = w.params.filter((p) => !p.secret);
  return (
    <div className="cu-workflow">
      <div className="row small" title={w.text}>
        <Icon name="play" size={12} /> <b>{w.name}</b> <span className="muted grow">{w.site} · {w.steps} steps{w.params.length ? ` · blanks: ${w.params.map((p) => p.name).join(', ')}` : ''}</span>
        <button className="btn sm" onClick={() => setOpen(open === 'run' ? null : 'run')}>Run…</button>
        <button className="btn sm" onClick={() => setOpen(open === 'schedule' ? null : 'schedule')}><Icon name="clock" size={11} /> Automate…</button>
        <button className="btn sm ghost icon" title="Delete" aria-label="Delete" onClick={() => void api.cu.removeWorkflow(w.id).then(reload)}><Icon name="close" size={11} /></button>
      </div>
      {schedules.map((x) => (
        <div key={x.id} className="row small cu-sched">
          <label className="grow"><input type="checkbox" checked={x.enabled} onChange={(e) => void api.cu.setSchedule(x.id, e.target.checked).then(reload)} /> {x.label}
            <span className="muted">{x.next && x.enabled ? ` · next ${new Date(x.next).toLocaleString()}` : ''}{x.lastResult ? ` · last run ${x.lastResult.ok ? 'finished' : `stopped: ${x.lastResult.note.split(/(?<=\.) /)[0]}`}` : ''}</span>
          </label>
          <button className="btn sm ghost" onClick={() => void api.cu.runSchedule(x.id).then((r) => { if (r) toast(r.note); reload(); })}>Run now</button>
          <button className="btn sm ghost icon" title="Stop running it by itself" aria-label="Stop running it by itself" onClick={() => void api.cu.removeSchedule(x.id).then(reload)}><Icon name="close" size={11} /></button>
        </div>
      ))}
      {open ? (
        <div className="col cu-add" style={{ gap: 6 }}>
          {blanks.map((p) => (
            <label key={p.name} className="row small" style={{ gap: 6 }}>
              <span style={{ minWidth: 90 }}>{p.name}</span>
              <input className="input sm grow" value={values[p.name] ?? ''} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} />
            </label>
          ))}
          {w.params.some((p) => p.secret) ? <div className="small muted">Passwords come from your saved sign-ins for {w.site}.</div> : null}
          {open === 'schedule' ? (
            <>
              <div className="seg">
                {(['schedule', 'launch', 'wake'] as const).map((k) => <button key={k} className={trigger === k ? 'on' : ''} onClick={() => setTrigger(k)}>{k === 'schedule' ? 'On a schedule' : k === 'launch' ? 'When Keeper starts' : 'When the computer wakes'}</button>)}
              </div>
              {trigger === 'schedule' ? <input className="input sm" style={{ width: '100%' }} value={when} onChange={(e) => setWhen(e.target.value)} placeholder="every monday at 9 · every weekday at 8:30 · 0 9 1 * *" /> : null}
              <div className="small muted">It runs like pressing Run: steps you chose under “Always ask me before” still wait for your yes, here or on your phone.</div>
            </>
          ) : null}
          <label className="small"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Show the browser while it runs</label>
          <div className="row" style={{ gap: 6 }}>
            {open === 'run' ? (
              <button className="btn sm primary" onClick={() => void api.cu.runWorkflow(w.id, values, visible).then((r) => { toast(r.note); setOpen(null); })}>Run</button>
            ) : (
              <button className="btn sm primary" onClick={() => void api.cu.addSchedule({ workflowId: w.id, trigger, when: trigger === 'schedule' ? when : undefined, values, visible }).then(() => { setOpen(null); reload(); }, (e: Error) => toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))}>Save</button>
            )}
            <button className="btn sm" onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
