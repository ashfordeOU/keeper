// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → Accessibility: motion, text size and focus outlines. Keyboard
// shortcuts and what is supported are in docs/ACCESSIBILITY.md.

import { defaultA11y, TEXT_SCALES, type A11ySettings, type MotionPref } from '../../core/a11y';
import { api } from '../api';
import { Row } from '../screens/IslandSettings';
import { useStore } from '../state';
import { Toggle } from './ui';

const MOTION: { id: MotionPref; label: string }[] = [
  { id: 'system', label: 'Follow system' },
  { id: 'reduce', label: 'On' },
  { id: 'full', label: 'Off' },
];

export function AccessibilityPanel() {
  const { settings, updateSettings } = useStore();
  if (!settings) return null;
  const a: A11ySettings = { ...defaultA11y(), ...settings.a11y };
  const set = (patch: Partial<A11ySettings>) => void updateSettings({ a11y: { ...a, ...patch } });
  return (
    <>
      <Row title="Reduce motion" desc="Calms animations everywhere: the Island’s changes of shape, toasts, page transitions and moving wallpapers. “Follow system” uses your computer’s own setting.">
        <div className="seg" role="radiogroup" aria-label="Reduce motion">
          {MOTION.map((m) => (
            <button key={m.id} role="radio" aria-checked={a.motion === m.id} className={a.motion === m.id ? 'on' : ''} onClick={() => set({ motion: m.id })}>{m.label}</button>
          ))}
        </div>
      </Row>
      <Row title="Text size" desc="Makes text and controls in Keeper’s windows larger.">
        <div className="seg" role="radiogroup" aria-label="Text size">
          {TEXT_SCALES.map((x) => (
            <button key={x} role="radio" aria-checked={a.textScale === x} className={a.textScale === x ? 'on' : ''} onClick={() => set({ textScale: x })}>{x === 1 ? 'Normal' : `${Math.round(x * 100)}%`}</button>
          ))}
        </div>
      </Row>
      <Row title="Always show focus outlines" desc="Draws an outline around whatever has focus, after a click as well as with the keyboard.">
        <Toggle label="Always show focus outlines" on={a.focusAlways} onChange={(v) => set({ focusAlways: v })} />
      </Row>
      <Row title="Keyboard and screen readers" desc="Keeper also follows your system’s high-contrast and increased-contrast settings. Tab moves between controls, arrow keys move inside lists, menus and tabs, Esc closes. The guide lists every shortcut.">
        <button className="btn ghost" onClick={() => void api.system.openExternal('https://github.com/ashfordeOU/keeper/blob/main/docs/ACCESSIBILITY.md')}>Read the guide</button>
      </Row>
    </>
  );
}
