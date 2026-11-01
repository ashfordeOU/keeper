// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Command palette entries for wallpaper, vibes, ambient sound and folder icons.

import { useEffect, useState } from 'react';
import type { AmbienceState } from '../../core/scenes/api';
import { SCENES, sceneSource } from '../../core/scenes/catalog';
import { api } from '../api';

export interface AmbienceCommand {
  id: string;
  label: string;
  group: 'Go to' | 'Actions';
  icon: string;
  keywords?: string;
  typed?: boolean;
  run: () => unknown;
}

export function useAmbienceCommands(toast: (t: string) => void, go: (r: { name: 'ambience' | 'widgets'; arg?: string }) => void): AmbienceCommand[] {
  const [s, setS] = useState<AmbienceState | null>(null);
  useEffect(() => { void api.ambience?.state().then(setS).catch(() => undefined); }, []);
  const out: AmbienceCommand[] = [
    { id: 'vibe-page', label: 'Wallpaper & Vibes', group: 'Go to', icon: 'palette', keywords: 'wallpaper live desktop background scene vibe mood sound', run: () => go({ name: 'ambience' }) },
    { id: 'widget-arrange', label: 'Arrange Desktop Widgets', group: 'Actions', icon: 'grid', keywords: 'widgets move snap layout desktop', run: () => void api.widgets.arrange?.(true).then(() => toast('Drag widgets on the desktop; they snap into place')) },
    { id: 'folder-icon-page', label: 'Custom Folder Icons', group: 'Go to', icon: 'folder', keywords: 'folder icon colour color pattern symbol finder explorer', run: () => go({ name: 'ambience', arg: 'icons' }) },
  ];
  if (!s || !s.settings.surfaces.palette) return out;
  if (s.features.vibes) {
    out.push({ id: 'vibe-next', label: 'Next Vibe', group: 'Actions', icon: 'sparkle', keywords: 'vibe mood switch', run: () => void api.ambience.stepVibe(1).then((x) => toast(`Vibe: ${x.settings.vibes.find((v) => v.id === x.settings.activeVibe)?.name ?? ''}`)) });
    for (const v of s.settings.vibes) out.push({ id: `vibe-${v.id}`, label: `Vibe: ${v.emoji} ${v.name}`, group: 'Actions', icon: 'sparkle', typed: true, keywords: `vibe mood ${v.name}`, run: () => void api.ambience.applyVibe(v.id).then(() => toast(`${v.emoji} ${v.name}`)) });
  }
  if (s.features.wallpaper || !s.settings.wallpaper.enabled) {
    const on = s.features.wallpaper && s.settings.wallpaper.enabled;
    out.push({ id: 'wallpaper-toggle', label: on ? 'Turn Live Wallpaper Off' : 'Turn Live Wallpaper On', group: 'Actions', icon: 'image', keywords: 'live wallpaper desktop background animated', run: () => void api.ambience.setPlaying(!on).then(() => toast(on ? 'Live wallpaper off' : 'Live wallpaper on')) });
    out.push({ id: 'wallpaper-surprise', label: 'Surprise Me (Wallpaper)', group: 'Actions', icon: 'shuffle', keywords: 'random wallpaper scene palette', run: () => void api.ambience.surprise().then(() => toast('A new wallpaper')) });
    for (const sc of SCENES) out.push({ id: `wallpaper-scene-${sc.id}`, label: `Wallpaper: ${sc.name}`, group: 'Actions', icon: 'image', typed: true, keywords: `wallpaper scene ${sc.category} ${sc.description}`, run: () => void api.ambience.setWallpaper('all', sceneSource(sc.id)).then(() => toast(`Wallpaper: ${sc.name}`)) });
  }
  if (s.features.ambientSound) {
    out.push({ id: 'ambient-mixer', label: 'Ambient Sound Mixer', group: 'Actions', icon: 'audio', keywords: 'rain cafe waves noise focus sleep sound', run: () => void api.ambience.openMixer() });
    out.push({ id: 'ambient-toggle', label: s.settings.sound.playing ? 'Stop Ambient Sound' : 'Play Ambient Sound', group: 'Actions', icon: 'audio', keywords: 'rain cafe waves noise sound', run: () => void api.ambience.setSoundPlaying(!s.settings.sound.playing) });
  }
  return out;
}
