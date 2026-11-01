// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Dictation statistics as a picture (1200×630): the totals, words per day for
// four weeks and the apps you dictate into most, in the current theme's colours.

import type { DictationStats } from '../../core/voice/types';

export function statsPng(s: DictationStats, wpm: number): string {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const bg = v('--bg-elev', '#ffffff');
  const text = v('--text', '#18181b');
  const text2 = v('--text-2', '#55555e');
  const line = v('--line', 'rgba(0,0,0,.1)');
  const accent = v('--accent', '#5b5bf0');
  const font = v('--font', 'system-ui, sans-serif');
  const W = 1200;
  const H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = text;
  g.font = `700 44px ${font}`;
  g.fillText('My dictation', 64, 100);
  g.fillStyle = text2;
  g.font = `400 22px ${font}`;
  const to = new Date();
  const from = new Date(Date.now() - 27 * 86_400_000);
  g.fillText(`${from.toLocaleDateString()} – ${to.toLocaleDateString()} · recognised on this computer`, 64, 140);
  const tiles: [string, string][] = [
    [s.words.toLocaleString(), 'words'],
    [`${Math.round(s.minutesSaved)} min`, `saved (typing ${wpm} wpm)`],
    [String(s.activeDays28), 'active days (28)'],
    [s.dailyAverage.toLocaleString(), 'words a day'],
  ];
  tiles.forEach(([big, small], i) => {
    const x = 64 + i * 272;
    g.fillStyle = text;
    g.font = `700 48px ${font}`;
    g.fillText(big, x, 240);
    g.fillStyle = text2;
    g.font = `400 20px ${font}`;
    g.fillText(small, x, 272);
  });
  // words per day
  const max = Math.max(1, ...s.spark);
  const bw = (W - 128) / 28;
  g.strokeStyle = line;
  g.beginPath();
  g.moveTo(64, 500);
  g.lineTo(W - 64, 500);
  g.stroke();
  g.fillStyle = accent;
  s.spark.forEach((n, i) => {
    const h = Math.max(3, (n / max) * 170);
    g.fillRect(64 + i * bw + 3, 500 - h, bw - 6, h);
  });
  g.fillStyle = text2;
  g.font = `400 18px ${font}`;
  g.fillText('Words per day, last 4 weeks', 64, 540);
  const apps = s.topApps.filter((a) => a.app !== 'Unknown').slice(0, 3).map((a) => `${a.app} ${a.words.toLocaleString()}`).join(' · ');
  if (apps) g.fillText(`Most in: ${apps}`, 64, 572);
  g.textAlign = 'right';
  g.fillText('Keeper by Ashforde®', W - 64, 572);
  return c.toDataURL('image/png');
}
