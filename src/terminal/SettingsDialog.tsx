// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Terminal settings in one dialog: profiles (shell, folder, variables, separate
// sign-ins, language, colours, font), behaviour, keyboard shortcuts, triggers
// and "Open in…" commands. Every change saves straight away.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal, Toggle } from '../components/ui';
import { comboFromEvent, conflicts, formatCombo } from '../../core/terminal/keys';
import { DEFAULT_KEYBINDINGS, defaultKeybindings } from '../../core/terminal/profiles';
import { SCHEMES } from '../../core/terminal/schemes';
import { patternError } from '../../core/terminal/triggers';
import type { ShellInfo, TerminalProfile, TerminalSettings, Trigger } from '../../core/terminal/types';
import { ACTION_NAMES } from './actions';
import { PROGRAM_LOCALES, useTT } from './strings';

const MAC = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
type Section = 'profiles' | 'behaviour' | 'keys' | 'triggers' | 'launchers';

export function TerminalSettingsDialog({ settings, shells, onClose, onChange }: { settings: TerminalSettings; shells: ShellInfo[]; onClose: () => void; onChange: (patch: Partial<TerminalSettings>) => void }) {
  const tt = useTT();
  const [section, setSection] = useState<Section>('profiles');
  const [pid, setPid] = useState(settings.defaultProfile);
  const profile = settings.profiles.find((p) => p.id === pid) ?? settings.profiles[0];
  const setProfile = (patch: Partial<TerminalProfile>) => onChange({ profiles: settings.profiles.map((p) => (p.id === profile.id ? { ...p, ...patch } : p)) });

  return (
    <Modal title={tt('settings')} onClose={onClose} width={860}>
      <div className="term-settings">
        <nav>
          {([['profiles', tt('profiles'), 'terminal'], ['behaviour', 'Behaviour', 'settings'], ['keys', tt('keybindings'), 'rules'], ['triggers', tt('triggers'), 'bolt'], ['launchers', tt('openIn'), 'external']] as const).map(([id, label, icon]) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}><Icon name={icon} size={13} /> {label}</button>
          ))}
        </nav>
        <div className="term-settings-body">
          {section === 'profiles' ? (
            <div className="profiles-grid">
              <div className="profile-list">
                {settings.profiles.map((p) => (
                  <button key={p.id} className={p.id === profile.id ? 'on' : ''} onClick={() => setPid(p.id)}>
                    <span className="tab-badge" style={{ background: p.color ?? 'var(--accent)' }}>{p.badge ?? p.name[0]}</span>
                    <span className="grow ellipsis">{p.name}</span>
                    {p.id === settings.defaultProfile ? <span className="badge">{tt('default')}</span> : null}
                  </button>
                ))}
                <button onClick={() => {
                  const id = `p${Date.now().toString(36)}`;
                  onChange({ profiles: [...settings.profiles, { ...profile, id, name: `${profile.name} copy`, badge: undefined }] });
                  setPid(id);
                }}><Icon name="plus" size={13} /> New profile</button>
              </div>
              <div className="profile-form">
                <Field label={tt('name')}><input className="input" value={profile.name} onChange={(e) => setProfile({ name: e.target.value })} /></Field>
                <div className="row" style={{ gap: 8 }}>
                  <Field label="Badge"><input className="input" style={{ width: 70 }} maxLength={2} value={profile.badge ?? ''} onChange={(e) => setProfile({ badge: e.target.value || undefined })} /></Field>
                  <Field label="Colour"><input type="color" value={profile.color ?? '#6d6dff'} onChange={(e) => setProfile({ color: e.target.value })} /></Field>
                </div>
                <Field label={tt('shells')}>
                  <select className="input" value={profile.shell} onChange={(e) => setProfile({ shell: e.target.value })}>
                    <option value="default">Your login shell</option>
                    {shells.map((s) => <option key={s.id} value={s.id}>{s.label}{s.detail ? '' : ` — ${s.file}`}</option>)}
                    <option value="custom">Another program…</option>
                  </select>
                </Field>
                {profile.shell === 'custom' ? <Field label="Program and arguments"><input className="input" value={[profile.command, ...(profile.args ?? [])].filter(Boolean).join(' ')} onChange={(e) => { const [command, ...args] = e.target.value.split(' '); setProfile({ command, args }); }} placeholder="/usr/local/bin/fish -l" /></Field> : null}
                <Field label="SSH host (connects on start)"><input className="input" value={profile.ssh ?? ''} onChange={(e) => setProfile({ ssh: e.target.value || undefined })} placeholder="alias from ~/.ssh/config or user@host" /></Field>
                <Field label="Starts in folder"><div className="row" style={{ gap: 6 }}><input className="input grow" value={profile.cwd ?? ''} onChange={(e) => setProfile({ cwd: e.target.value || undefined })} placeholder="~" /><button className="btn sm" onClick={() => void api.settings.pickFolder().then((f) => f && setProfile({ cwd: f }))}><Icon name="folder" size={12} /></button></div></Field>
                <Field label="Run when it opens"><input className="input" value={profile.startup ?? ''} onChange={(e) => setProfile({ startup: e.target.value || undefined })} placeholder="e.g. a command-line AI assistant, a dev server, htop" /></Field>
                <Field label="Variables (NAME=value, one per line; ${PATH} refers to the current value)">
                  <textarea className="input" rows={3} value={Object.entries(profile.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')} onChange={(e) => setProfile({ env: Object.fromEntries(e.target.value.split('\n').map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => [m[1], m[2]])) })} />
                </Field>
                <div className="tsetting-row">
                  <div><b>{tt('isolate')}</b><div className="small muted">Each profile gets its own config folders, so the same command-line tool can be signed in to a different account in each (for example two AI assistant accounts side by side). Some tools keep sign-ins in the system keychain instead; those cannot be separated this way.</div></div>
                  <Toggle on={!!profile.isolate} onChange={(v) => setProfile({ isolate: v })} />
                </div>
                {profile.isolate ? (
                  <div className="tsetting-row">
                    <div><b>{tt('isolateHome')}</b><div className="small muted">Stronger separation; programs no longer see your usual dotfiles.</div></div>
                    <Toggle on={!!profile.isolateHome} onChange={(v) => setProfile({ isolateHome: v })} />
                  </div>
                ) : null}
                <div className="tsetting-row">
                  <div><b>Load the folder's .env</b><div className="small muted">Variables from a .env file in the starting folder (never over the profile's own).</div></div>
                  <Toggle on={!!profile.loadDotEnv} onChange={(v) => setProfile({ loadDotEnv: v })} />
                </div>
                <Field label={tt('locale')}>
                  <select className="input" value={profile.locale ?? ''} onChange={(e) => setProfile({ locale: e.target.value || undefined })}>
                    {PROGRAM_LOCALES.map((l) => <option key={l} value={l}>{l || 'Same as the system'}</option>)}
                  </select>
                </Field>
                <Field label="Colours">
                  <div className="tscheme-grid">
                    <button className={`tscheme ${(profile.scheme ?? 'keeper') === 'keeper' ? 'on' : ''}`} onClick={() => setProfile({ scheme: 'keeper' })}><span className="tscheme-chip keeper" /> Follow Keeper’s theme</button>
                    {SCHEMES.map((s) => (
                      <button key={s.id} className={`tscheme ${profile.scheme === s.id ? 'on' : ''}`} onClick={() => setProfile({ scheme: s.id })}>
                        <span className="tscheme-chip" style={{ background: s.background, color: s.foreground }}>
                          {s.ansi.slice(1, 7).map((c) => <i key={c} style={{ background: c }} />)}
                        </span>
                        {s.name}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <Field label="Font"><input className="input" value={profile.fontFamily ?? ''} placeholder="system monospace" onChange={(e) => setProfile({ fontFamily: e.target.value || undefined })} /></Field>
                  <Field label="Size"><input className="input" type="number" min={8} max={32} style={{ width: 70 }} value={profile.fontSize ?? 13} onChange={(e) => setProfile({ fontSize: Number(e.target.value) || 13 })} /></Field>
                  <Field label="Cursor">
                    <select className="input" value={profile.cursor ?? 'bar'} onChange={(e) => setProfile({ cursor: e.target.value as TerminalProfile['cursor'] })}>
                      <option value="bar">Bar</option><option value="block">Block</option><option value="underline">Underline</option>
                    </select>
                  </Field>
                  <Field label="Bell">
                    <select className="input" value={profile.bell ?? 'visual'} onChange={(e) => setProfile({ bell: e.target.value as TerminalProfile['bell'] })}>
                      <option value="visual">Flash</option><option value="sound">Sound</option><option value="island">Island alert</option><option value="none">None</option>
                    </select>
                  </Field>
                </div>
                <div className="btn-row" style={{ marginTop: 12 }}>
                  {profile.id !== settings.defaultProfile ? <button className="btn sm" onClick={() => onChange({ defaultProfile: profile.id })}>Make default</button> : null}
                  {settings.profiles.length > 1 ? <button className="btn sm danger" onClick={() => { onChange({ profiles: settings.profiles.filter((p) => p.id !== profile.id) }); setPid(settings.defaultProfile); }}>Delete profile</button> : null}
                  <IntegrationButton shell={profile.shell} shells={shells} />
                </div>
              </div>
            </div>
          ) : null}

          {section === 'behaviour' ? (
            <div>
              <Field label={tt('keepAlive')}>
                {(['window', 'quit', 'never'] as const).map((m) => (
                  <label key={m} className="tradio-row"><input type="radio" checked={settings.keepAlive === m} onChange={() => onChange({ keepAlive: m })} /> {tt(m === 'window' ? 'keepWindow' : m === 'quit' ? 'keepQuit' : 'keepNever')}</label>
                ))}
              </Field>
              <ToggleRow label="Save scrollback when terminals stop, to read it after a restart" on={settings.saveScrollback} set={(v) => onChange({ saveScrollback: v })} />
              <ToggleRow label={tt('pasteGuard')} on={settings.pasteGuard} set={(v) => onChange({ pasteGuard: v })} />
              <ToggleRow label={tt('confirmBroadcast')} on={settings.confirmBroadcast} set={(v) => onChange({ confirmBroadcast: v })} />
              <ToggleRow label={tt('copyOnSelect')} on={settings.copyOnSelect} set={(v) => onChange({ copyOnSelect: v })} />
              <ToggleRow label="Draw with the graphics card (faster; turn off if text looks wrong)" on={settings.webgl} set={(v) => onChange({ webgl: v })} />
              <ToggleRow label="Suggest a fix when a command fails" on={settings.quickFixes !== false} set={(v) => onChange({ quickFixes: v })} />
              <ToggleRow label="Pin the command you are reading the output of" on={settings.stickyScroll !== false} set={(v) => onChange({ stickyScroll: v })} />
              <ToggleRow label="Screen reader support (slower drawing)" on={!!settings.screenReader} set={(v) => onChange({ screenReader: v })} />
              <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>Open file:line links with (empty: the file's usual app). Example: code -g {'{file}'}:{'{line}'}:{'{col}'}
                <input className="input" defaultValue={settings.editorCommand ?? ''} placeholder="code -g {file}:{line}:{col}" onBlur={(e) => onChange({ editorCommand: e.target.value })} />
              </label>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <Field label="Lines of scrollback"><input className="input" type="number" min={500} max={200000} step={500} value={settings.scrollback} onChange={(e) => onChange({ scrollback: Number(e.target.value) })} /></Field>
                <Field label={`${tt('quick')} — shortcut`}><ShortcutInput value={settings.quickShortcut} onChange={(v) => onChange({ quickShortcut: v })} /></Field>
                <Field label="Terminal window — shortcut"><ShortcutInput value={settings.windowShortcut} onChange={(v) => onChange({ windowShortcut: v })} /></Field>
                <Field label={`${tt('quick')} — height`}><input type="range" min={0.2} max={0.9} step={0.05} value={settings.quickHeight} onChange={(e) => onChange({ quickHeight: Number(e.target.value) })} /></Field>
              </div>
            </div>
          ) : null}

          {section === 'keys' ? <KeysEditor settings={settings} onChange={onChange} /> : null}
          {section === 'triggers' ? <TriggersEditor triggers={settings.triggers} onChange={(triggers) => onChange({ triggers })} /> : null}
          {section === 'launchers' ? (
            <div>
              <p className="small muted" style={{ marginTop: 0 }}>Commands that open a terminal’s folder in another app (an IDE, an editor, a file manager). Desktop development apps cannot run inside Keeper’s window, so this opens them beside it. Use {'{path}'} where the folder goes.</p>
              {settings.launchers.map((l, i) => (
                <div key={l.id} className="row" style={{ gap: 6, marginBottom: 6 }}>
                  <input className="input" style={{ width: 160 }} value={l.name} onChange={(e) => onChange({ launchers: settings.launchers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <input className="input grow" value={l.command} onChange={(e) => onChange({ launchers: settings.launchers.map((x, j) => (j === i ? { ...x, command: e.target.value } : x)) })} />
                  <button className="btn ghost sm icon" onClick={() => onChange({ launchers: settings.launchers.filter((_, j) => j !== i) })}><Icon name="close" size={12} /></button>
                </div>
              ))}
              <button className="btn sm" onClick={() => onChange({ launchers: [...settings.launchers, { id: `l${Date.now()}`, name: 'My IDE', command: MAC ? 'open -a "AppName" {path}' : 'ide-command {path}' }] })}><Icon name="plus" size={12} /> Add</button>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="tfield">
      <span className="small muted">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="tsetting-row">
      <div>{label}</div>
      <Toggle on={on} onChange={set} />
    </div>
  );
}

function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState(false);
  return (
    <button className={`btn sm shortcut ${rec ? 'on' : ''}`} onClick={() => setRec(true)} onBlur={() => setRec(false)}
      onKeyDown={(e) => {
        if (!rec) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') return setRec(false);
        if (e.key === 'Backspace') {
          onChange('');
          return setRec(false);
        }
        const c = comboFromEvent(e.nativeEvent, MAC);
        if (c) {
          onChange(c);
          setRec(false);
        }
      }}>
      {rec ? 'Press keys…' : value ? formatCombo(value, MAC) : 'None'}
    </button>
  );
}

function KeysEditor({ settings, onChange }: { settings: TerminalSettings; onChange: (p: Partial<TerminalSettings>) => void }) {
  const clashes = useMemo(() => conflicts(settings.keybindings, MAC), [settings.keybindings]);
  const clashing = new Set(clashes.flat());
  return (
    <div>
      {clashes.length ? <div className="callout warn small" style={{ marginBottom: 8 }}>Some shortcuts are the same: {clashes.map(([a, b]) => `${ACTION_NAMES[a] ?? a} / ${ACTION_NAMES[b] ?? b}`).join(', ')}</div> : null}
      <div className="keys-grid">
        {Object.keys(DEFAULT_KEYBINDINGS).map((a) => (
          <div key={a} className={`tsetting-row ${clashing.has(a) ? 'clash' : ''}`}>
            <div>{ACTION_NAMES[a] ?? a}</div>
            <ShortcutInput value={settings.keybindings[a] ?? ''} onChange={(v) => onChange({ keybindings: { ...settings.keybindings, [a]: v } })} />
          </div>
        ))}
      </div>
      <button className="btn sm" style={{ marginTop: 10 }} onClick={() => onChange({ keybindings: defaultKeybindings(MAC ? 'darwin' : 'other') })}>Reset to defaults</button>
    </div>
  );
}

function TriggersEditor({ triggers, onChange }: { triggers: Trigger[]; onChange: (t: Trigger[]) => void }) {
  const set = (i: number, patch: Partial<Trigger>) => onChange(triggers.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div>
      <p className="small muted" style={{ marginTop: 0 }}>When a terminal prints a line matching the pattern, Keeper tells you — in the Island, as a notification, or by highlighting the tab. Handy for a long build, or an AI assistant waiting for your answer in a terminal you are not looking at.</p>
      {triggers.map((t, i) => {
        const err = patternError(t.pattern);
        return (
          <div key={t.id} className="trigger-row">
            <Toggle on={t.enabled} onChange={(v) => set(i, { enabled: v })} />
            <input className="input" style={{ width: 170 }} placeholder="Name" value={t.label ?? ''} onChange={(e) => set(i, { label: e.target.value })} />
            <input className={`input grow mono ${err ? 'bad' : ''}`} title={err} value={t.pattern} onChange={(e) => set(i, { pattern: e.target.value })} />
            <select className="input" value={t.action} onChange={(e) => set(i, { action: e.target.value as Trigger['action'] })}>
              <option value="island">Island</option><option value="notify">Notification</option><option value="highlight">Highlight</option><option value="sound">Sound</option>
            </select>
            <button className="btn ghost sm icon" onClick={() => onChange(triggers.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
          </div>
        );
      })}
      <button className="btn sm" onClick={() => onChange([...triggers, { id: `t${Date.now()}`, pattern: 'done|finished', action: 'island', enabled: true, label: 'Finished' }])}><Icon name="plus" size={12} /> Add trigger</button>
    </div>
  );
}

function IntegrationButton({ shell, shells }: { shell: string; shells: ShellInfo[] }) {
  const [script, setScript] = useState<string | null>(null);
  const kind = useMemo(() => {
    const s = shells.find((x) => x.id === shell);
    const file = (s?.file ?? '').toLowerCase();
    if (/pwsh|powershell/.test(file)) return 'powershell';
    if (/fish/.test(file)) return 'fish';
    if (/bash/.test(file)) return 'bash';
    return 'zsh';
  }, [shell, shells]);
  useEffect(() => setScript(null), [kind]);
  return (
    <>
      <button className="btn sm" onClick={() => void api.terminal.integrationScript(kind as 'zsh').then(setScript)}>Shell integration…</button>
      {script !== null ? (
        <Modal title="Shell integration" onClose={() => setScript(null)}>
          <p className="small muted" style={{ marginTop: 0 }}>Add this to your {kind} start-up file to get command marks, exit codes, durations, jump-to-prompt and the current folder in Keeper.</p>
          <pre className="term-paste-preview">{script}</pre>
          <button className="btn primary" onClick={() => void navigator.clipboard.writeText(script)}><Icon name="copy" size={12} /> Copy</button>
        </Modal>
      ) : null}
    </>
  );
}
