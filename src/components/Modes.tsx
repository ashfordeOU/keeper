// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Modes in the window: the cards in Settings → General, the preview sheet shown
// before any switch (from Settings, the palette, the tray or the sidebar's
// badge), the badge itself, and Focus as a timed session. The logic is in
// core/modes.ts; switching happens in the main process (electron/services/modes.ts).

import { useEffect, useMemo, useState } from 'react';
import { ADDONS, addonDef, badgeText, cleanAddons, MODES, modeDef, modeKey, modeOf, modeTitle, normalizeSession, overrideCount, previewLine, sessionLeft, SESSION_LENGTHS, type AddonId, type ModeChoice, type ModeId, type ModePreview } from '../../core/modes';
import { errorText } from '../../core/ipc-error';
import { allOff, offlineLine, onlineThings } from '../../core/offline';
import { patchFor } from '../../core/settings-schema';
import { api } from '../api';
import { useNow } from '../pim/mail-today';
import { useStore } from '../state';
import { useFeatureStates } from '../features';
import { Icon, type IconName } from './Icon';
import { ContextMenu, Modal, Toggle, type MenuItem } from './ui';
import '../styles/modes.css';

const EVENT = 'keeper-mode-preview';

/** Opens the preview sheet for a switch (it changes nothing until Switch is pressed). */
export function openModePreview(to: ModeChoice) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: to }));
}

/** "Switch to Focus" from a base id, keeping the add-ons the person has. */
export function previewBase(current: ModeChoice, base: ModeId) {
  openModePreview({ base, addons: current.addons });
}

function useMode() {
  const { settings } = useStore();
  return useMemo(() => modeOf(settings ?? ({} as never)), [settings]);
}

/** Mounted once in the app: shows the preview sheet when something asks for a switch. */
export function ModeSheetHost() {
  const [to, setTo] = useState<ModeChoice | null>(null);
  useEffect(() => {
    const open = (e: Event) => setTo((e as CustomEvent<ModeChoice>).detail);
    window.addEventListener(EVENT, open);
    // The tray's Mode menu (the main process sends the choice).
    const off = api.on?.('mode-preview', ((c: ModeChoice) => setTo(c)) as never);
    return () => { window.removeEventListener(EVENT, open); off?.(); };
  }, []);
  return to ? <ModePreviewSheet to={to} onClose={() => setTo(null)} /> : null;
}

function ModePreviewSheet({ to, onClose }: { to: ModeChoice; onClose: () => void }) {
  const { toast } = useStore();
  const [p, setP] = useState<ModePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { void api.modes.preview(to).then(setP, (e: unknown) => { toast(errorText(e)); onClose(); }); }, [to, toast, onClose]);
  const def = modeDef(to.base)!;
  const go = async () => {
    setBusy(true);
    try {
      await api.modes.switch(to);
      toast(`${modeTitle(to)} is on. Your data stayed as it was.`);
      onClose();
    } catch (e) {
      toast(errorText(e));
      setBusy(false);
    }
  };
  const list = (names: string[]) => (more || names.length <= 6 ? names : [...names.slice(0, 5), `${names.length - 5} more`]).join(', ');
  return (
    <Modal title={`Switch to ${modeTitle(to)}?`} onClose={onClose} width={520} testId="mode-preview">
      <div className="mode-sheet">
        <div className="mode-sheet-head">
          <span className={`mode-art tone-${def.tone}`} aria-hidden><Icon name={def.icon as IconName} size={20} /></span>
          <div className="grow">
            <div className="mode-line">{def.line}</div>
            {p ? <div className="small muted" data-testid="mode-preview-line">{previewLine(p)}</div> : <div className="small muted">Working out what changes…</div>}
          </div>
        </div>
        {p ? (
          <dl className="mode-diff">
            {p.turnsOn.length ? <><dt>Turns on</dt><dd data-testid="mode-preview-on">{list(p.turnsOn)}</dd></> : null}
            {p.turnsOff.length ? <><dt>Turns off</dt><dd data-testid="mode-preview-off">{list(p.turnsOff)}</dd></> : null}
            {p.settings.length ? <><dt>Looks</dt><dd data-testid="mode-preview-settings">{(more ? p.settings : p.settings.slice(0, 4)).map((x) => `${x.label}: ${x.to}`).join(' · ')}{!more && p.settings.length > 4 ? ` · ${p.settings.length - 4} more` : ''}</dd></> : null}
            <dt>Sidebar</dt><dd>{p.sidebar === null ? 'Every section' : `${p.sidebar} ${p.sidebar === 1 ? 'section' : 'sections'}; the rest are in the palette`}</dd>
            {p.restored ? <><dt>Yours</dt><dd>{p.restored} {p.restored === 1 ? 'change' : 'changes'} you made in {modeTitle(to)} come back</dd></> : null}
            {p.kept ? <><dt>Kept</dt><dd>{p.kept} {p.kept === 1 ? 'change' : 'changes'} you made here wait for when you return</dd></> : null}
          </dl>
        ) : null}
        {p && (p.turnsOn.length > 6 || p.turnsOff.length > 6 || p.settings.length > 4) && !more ? <button className="link-like small" onClick={() => setMore(true)}>Show everything</button> : null}
        <div className="mode-trust small muted"><Icon name="lock" size={12} /> Your files, notes, mail and accounts are not touched · Switch back anytime</div>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" data-testid="mode-switch" disabled={!p || busy} onClick={() => void go()}>{busy ? <span className="spinner" /> : null} Switch</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Settings → General → Mode

/** The mode cards, the add-ons, what was changed, and Focus for a while. */
export function ModesPanel() {
  const m = useMode();
  const { settings, toast } = useStore();
  const states = useFeatureStates();
  // The person's changes in this mode, counted live (a preview of switching to the same mode).
  const [kept, setKept] = useState(() => overrideCount(m.overrides[modeKey(m)]));
  useEffect(() => { void api.modes.preview(m).then((p) => setKept(p.kept), () => undefined); }, [settings, m]);
  const def = modeDef(m.base)!;
  const sig = [def.signature, ...m.addons.map((a) => addonDef(a)?.signature)].find((x) => x && states?.get(x.part)?.on === false);
  const flip = (a: AddonId) => openModePreview({ base: m.base, addons: m.addons.includes(a) ? m.addons.filter((x) => x !== a) : cleanAddons([...m.addons, a]) });
  return (
    <div className="modes" data-testid="settings-modes">
      <div className="modes-status small muted" data-testid="mode-status">
        <span className={`mode-dot tone-${def.tone}`} aria-hidden /> <b>{modeTitle(m)}</b>
        {kept ? <> · {kept} {kept === 1 ? 'change' : 'changes'} of yours <button className="link-like" data-testid="mode-reset" onClick={() => void api.modes.reset().then(() => toast(`${modeTitle(m)} is back as it comes`))}>Reset to {def.name}</button></> : <> · as it comes</>}
      </div>
      <div className="modes-grid" role="radiogroup" aria-label="Mode">
        {MODES.map((x) => {
          const on = x.id === m.base;
          return (
            <button key={x.id} role="radio" aria-checked={on} className={`mode-card${on ? ' on' : ''}`} data-testid={`mode-${x.id}`} onClick={() => (on ? undefined : openModePreview({ base: x.id, addons: m.addons }))}>
              <span className={`mode-art tone-${x.tone}`} aria-hidden><Icon name={x.icon as IconName} size={18} /></span>
              <b>{x.name}</b>
              <span className="small muted">{x.line}</span>
              {on ? <span className="mode-tick" aria-hidden><Icon name="check" size={11} /></span> : null}
            </button>
          );
        })}
      </div>
      <div className="modes-addons">
        <div className="kicker">Add to any mode</div>
        <div className="mode-chips" role="group" aria-label="Add to any mode">
          {ADDONS.map((a) => (
            <button key={a.id} className={`mode-chip${m.addons.includes(a.id) ? ' on' : ''}`} aria-pressed={m.addons.includes(a.id)} data-testid={`addon-${a.id}`} title={a.line} onClick={() => flip(a.id)}>
              <Icon name={a.icon as IconName} size={12} /> {a.name}
            </button>
          ))}
        </div>
      </div>
      {sig ? (
        <div className="mode-signature small" data-testid="mode-signature">
          <Icon name="sparkle" size={12} /> <span className="grow"><b>{sig.name}</b> · {sig.line}</span>
          <button className="btn sm" onClick={() => void api.features.set(sig.part, true).then(() => toast(`${sig.name} is on`))}>Turn on</button>
        </div>
      ) : null}
      <FocusSessionRow />
    </div>
  );
}

/** Focus for a while, over any mode: notices wait and the sidebar narrows; it ends by itself. */
export function FocusSessionRow() {
  const { settings, toast } = useStore();
  const now = useNow();
  const session = normalizeSession(settings?.modeSession, now);
  const left = sessionLeft(session, now);
  return (
    <div className="mode-session" data-testid="focus-session">
      <div className="grow">
        <b>Focus for a while</b>
        <div className="small muted">{left ? `${left} min left. Notices wait until it ends.` : 'Over any mode. Notices wait, and it ends by itself.'}</div>
      </div>
      {left ? (
        <button className="btn sm" data-testid="focus-session-end" onClick={() => void api.modes.endFocus()}>End now</button>
      ) : (
        <div className="seg" role="group" aria-label="Focus for">
          {SESSION_LENGTHS.map((n) => <button key={n} data-testid={`focus-session-${n}`} onClick={() => void api.modes.focus(n).then(() => toast(`Focus for ${n} minutes`))}>{n} min</button>)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the badge in the sidebar's foot

export function ModeBadge({ compact }: { compact?: boolean }) {
  const m = useMode();
  const { settings, go } = useStore();
  const now = useNow();
  const session = normalizeSession(settings?.modeSession, now);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const tone = sessionLeft(session, now) ? 'focus' : modeDef(m.base)!.tone;
  const text = badgeText(m, session, now);
  const items: MenuItem[] = sessionLeft(session, now)
    ? [{ label: 'End focus now', icon: 'close', run: () => void api.modes.endFocus() }, { sep: true, label: '' }, { label: 'Modes…', icon: 'settings', run: () => go({ name: 'settings', arg: 'general#mode' }) }]
    : [
      ...MODES.filter((x) => x.id !== m.base).map((x) => ({ label: x.name, icon: x.icon, run: () => openModePreview({ base: x.id, addons: m.addons }) })),
      { sep: true, label: '' },
      ...SESSION_LENGTHS.slice(0, 2).map((n) => ({ label: `Focus for ${n} min`, icon: 'timer', run: () => void api.modes.focus(n) })),
      { label: 'Modes…', icon: 'settings', run: () => go({ name: 'settings', arg: 'general#mode' }) },
    ];
  return (
    <>
      <button className={`mode-badge tone-${tone}${compact ? ' compact' : ''}`} data-testid="mode-badge" title={`Mode: ${text}. Click to switch.`} aria-label={`Mode: ${text}. Switch mode`} aria-haspopup="menu"
        onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 8 - 32 * Math.min(items.length, 10) }); }}>
        <span className="mode-dot" aria-hidden />{compact ? null : <span className="ellipsis">{text}</span>}
      </button>
      {menu ? <ContextMenu x={menu.x} y={Math.max(8, menu.y)} items={items} onClose={() => setMenu(null)} label="Switch mode" /> : null}
    </>
  );
}

// ---------------------------------------------------------------- the palette

export function modeCommands(current: ModeChoice, go: (r: { name: 'settings'; arg: string }) => void) {
  return [
    ...MODES.map((x) => ({ id: `mode-${x.id}`, label: `Mode: ${x.name}`, group: 'Actions' as const, icon: x.icon, typed: x.id !== 'focus', keywords: `mode profile switch ${x.who} ${x.line}`, run: () => openModePreview({ base: x.id, addons: current.addons }) })),
    ...ADDONS.map((a) => ({ id: `mode-addon-${a.id}`, label: `${current.addons.includes(a.id) ? 'Leave out' : 'Add'}: ${a.name}`, group: 'Actions' as const, icon: a.icon, typed: true, keywords: `mode add-on accessibility privacy ${a.line}`, run: () => openModePreview({ base: current.base, addons: current.addons.includes(a.id) ? current.addons.filter((x) => x !== a.id) : cleanAddons([...current.addons, a.id]) }) })),
    ...SESSION_LENGTHS.map((n) => ({ id: `focus-session-${n}`, label: `Focus for ${n} Minutes`, group: 'Actions' as const, icon: 'timer', typed: n !== 50, keywords: 'focus session do not disturb concentrate deep work pomodoro', run: () => void api.modes.focus(n) })),
    { id: 'focus-session-end', label: 'End Focus Session', group: 'Actions' as const, icon: 'timer', typed: true, keywords: 'focus stop end', run: () => void api.modes.endFocus() },
    { id: 'offline-check', label: 'Offline Check', group: 'Go to' as const, icon: 'shield', keywords: 'offline internet connections privacy air gap', run: () => go({ name: 'settings', arg: 'privacy#offlineCheck' }) },
    { id: 'mode-settings', label: 'Modes…', group: 'Go to' as const, icon: 'settings', keywords: 'mode profile simple focus pro researcher creator writer family accessibility privacy', run: () => go({ name: 'settings', arg: 'general#mode' }) },
  ];
}

// ---------------------------------------------------------------- Settings → Privacy → Offline check

/** Every way Keeper could reach the internet, one switch each, and Turn all off. */
export function OfflineCheckPanel() {
  const { settings, info, updateSettings, toast } = useStore();
  if (!settings) return null;
  const things = onlineThings(settings, info?.platform ?? '');
  const n = things.filter((t) => t.on).length;
  const flip = async (id: string, kind: 'part' | 'setting', on: boolean) => {
    if (kind === 'part') await api.features.set(id, on);
    else await updateSettings(patchFor(settings, id, on));
  };
  const off = async () => {
    const a = allOff(things);
    for (const id of a.parts) await api.features.set(id, false).catch(() => undefined);
    let next = settings;
    for (const p of a.settings) next = { ...next, ...patchFor(next, p, false) };
    if (a.settings.length) await updateSettings(Object.fromEntries(a.settings.map((p) => [p.split('.')[0], (next as unknown as Record<string, unknown>)[p.split('.')[0]]])));
    toast('Everything that reaches the internet is off');
  };
  return (
    <div className="offline" data-testid="offline-check">
      <div className="offline-head">
        <div className={`offline-meter${n ? '' : ' zero'}`} aria-live="polite"><b data-testid="offline-count">{n}</b><span className="small muted">{offlineLine(things)}</span></div>
        <button className="btn" data-testid="offline-all-off" disabled={!n} onClick={() => void off()}>Turn all off</button>
      </div>
      <ul className="offline-list">
        {things.map((t) => (
          <li key={t.id}>
            <div className="grow"><div>{t.label}</div>{t.why ? <div className="small muted">{t.why}</div> : null}</div>
            <Toggle label={t.label} on={t.on} onChange={(v) => void flip(t.id, t.kind, v)} />
          </li>
        ))}
      </ul>
      <div className="small muted">These are switches. To watch every connection from this computer, open Network &amp; firewall.</div>
    </div>
  );
}
