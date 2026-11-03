// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo data for the screen tools (`npm run demo`).

import type { KeeperApi, RecordState } from '../core/api';
import { CaptureHistory, defaultCaptureOptions, describeColor, type CaptureOptions } from '../core/capture';

/** A pretend screenshot: a small app window with some text, as an SVG data URL. */
export const DEMO_SHOT = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
<rect width="960" height="600" fill="#f4f4f7"/><rect x="0" y="0" width="960" height="44" fill="#e4e4ea"/>
<circle cx="24" cy="22" r="7" fill="#ff5f57"/><circle cx="46" cy="22" r="7" fill="#febc2e"/><circle cx="68" cy="22" r="7" fill="#28c840"/>
<rect x="40" y="84" width="420" height="30" rx="6" fill="#6d6dff"/><text x="56" y="105" font-family="sans-serif" font-size="17" fill="#fff">Network settings</text>
<text x="40" y="170" font-family="sans-serif" font-size="22" fill="#222">Wi-Fi password: blue-otter-42</text>
<text x="40" y="215" font-family="sans-serif" font-size="18" fill="#555">Security: WPA3 · Band: 5 GHz</text>
<rect x="40" y="260" width="880" height="280" rx="12" fill="#fff" stroke="#ddd"/>
<text x="64" y="310" font-family="sans-serif" font-size="18" fill="#333">Click “Save” to apply the changes.</text>
<rect x="760" y="470" width="130" height="44" rx="8" fill="#6d6dff"/><text x="797" y="498" font-family="sans-serif" font-size="17" fill="#fff">Save</text>
</svg>`)}`;

export function createMockCapture(): KeeperApi['capture'] {
  const now = Date.now();
  const history = new CaptureHistory();
  history.add({ kind: 'text', value: 'Wi-Fi password: blue-otter-42\nSecurity: WPA3', thumb: DEMO_SHOT, at: now - 3600_000 });
  history.add({ kind: 'qr', value: 'https://github.com/ashfordeOU/keeper', format: 'QR_CODE', at: now - 1800_000 });
  history.add({ kind: 'barcode', value: '4006381333931', format: 'EAN_13', at: now - 900_000 });
  history.add({ kind: 'link', value: 'https://open-meteo.com/en/docs', at: now - 600_000 });
  history.add({ kind: 'color', value: '#6d6dff', at: now - 300_000 });
  history.add({ kind: 'screenshot', value: 'Screenshot 2026-10-30 at 09.14.02.png', path: '/Users/demo/Pictures/Screenshots/Screenshot 2026-10-30 at 09.14.02.png', thumb: DEMO_SHOT, at: now - 120_000 });
  let options: CaptureOptions = defaultCaptureOptions();
  let rec: RecordState = { recording: false };
  const later = <T>(v: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  return {
    text: async () => later({ text: 'Text read from the area you selected.', image: DEMO_SHOT }),
    clipboardImage: async () => later({ text: 'Text read from the image on your clipboard.' }),
    readFile: async () => later({ text: 'Text read from the file.' }),
    screenshot: async (mode = 'full') => {
      const p = `/Users/demo/Pictures/Screenshots/Screenshot (${mode}).png`;
      history.add({ kind: 'screenshot', value: p.split('/').pop()!, path: p, thumb: DEMO_SHOT });
      return later(p);
    },
    record: async (mode = 'full') => (rec = { recording: true, since: Date.now(), mode }),
    stopRecording: async () => {
      const p = '/Users/demo/Movies/Screen Recording.mp4';
      history.add({ kind: 'recording', value: 'Screen Recording.mp4', path: p });
      rec = { recording: false, path: p };
      return p;
    },
    recordState: async () => rec,
    color: async () => {
      const c = describeColor(255, 111, 163);
      history.add({ kind: 'color', value: c.hex });
      return later(c);
    },
    colors: async () => history.items.filter((x) => x.kind === 'color').map((x) => x.value),
    history: async () => [...history.items],
    removeHistory: async (id) => history.remove(id),
    clearHistory: async () => history.clear(),
    options: async () => ({ ...options }),
    setOptions: async (patch) => (options = { ...options, ...patch }),
    openLink: async (u) => { window.open(u, '_blank'); },
    stopScroll: async () => false,
    pin: async () => 'pin-demo',
    pins: async () => [],
    setPin: async () => false,
    closePins: async () => 0,
    clickablePins: async () => 0,
    share: async () => later({ link: 'https://files.example.com/keeper/abc123/Screenshot.png' }),
    previews: async () => ({ items: [], shown: [] }),
    closePreviews: async () => undefined,
  };
}
