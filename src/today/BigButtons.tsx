// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Big buttons: six large buttons at the top of Today for the things most people
// came for. The signature of Simple and Family (core/modes.ts), and an ordinary
// part anyone can turn on (bigButtons in core/features.ts).

import { api } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { useFeatureStates } from '../features';
import { useStore } from '../state';
import { openHelp } from '../components/HelpSheet';

interface Big { id: string; label: string; icon: IconName; feature?: string; run: () => void }

export function BigButtons() {
  const { go, toast, info } = useStore();
  const states = useFeatureStates();
  const on = (f?: string) => !f || states?.get(f)?.on !== false;
  const helpOn = on('remoteHelp');
  const all: Big[] = [
    { id: 'find', label: 'Find a file', icon: 'search', run: () => { go({ name: 'library' }); requestAnimationFrame(() => document.getElementById('search')?.focus()); } },
    { id: 'space', label: 'Free up space', icon: 'broom', feature: 'cleanup', run: () => go({ name: 'cleanup' }) },
    { id: 'mail', label: 'Write a mail', icon: 'mail', feature: 'mail', run: () => go({ name: 'mail', arg: 'compose' }) },
    { id: 'calendar', label: 'Calendar', icon: 'calendar', feature: 'calendars', run: () => go({ name: 'calendar' }) },
    { id: 'photos', label: 'Pictures', icon: 'image', run: () => go({ name: 'browse', arg: `${info?.home ?? ''}/Pictures` }) },
    {
      id: 'help', label: helpOn ? 'Get help' : 'Help', icon: helpOn ? 'person' : 'info',
      run: helpOn
        ? () => void api.access.helpStart().then((o) => { go({ name: 'devices', arg: 'help' }); toast(`Help code ${o.code} · password ${o.password}`); }, () => go({ name: 'devices', arg: 'help' }))
        : () => openHelp(),
    },
  ];
  const shown = all.filter((b) => on(b.feature));
  return (
    <section className="big-buttons" aria-label="Big buttons" data-testid="big-buttons">
      {shown.map((b) => (
        <button key={b.id} className="big-button" data-testid={`big-${b.id}`} onClick={b.run}>
          <span className="big-button-art" aria-hidden><Icon name={b.icon} size={26} /></span>
          <span>{b.label}</span>
        </button>
      ))}
    </section>
  );
}
