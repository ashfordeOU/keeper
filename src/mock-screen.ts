// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote screens for the browser demo: a recent session in the log, an Android
// phone on USB, nothing that leaves the page.

import type { AndroidDevice, ScreenApi, ScreenState } from '../core/api-screen';
import { DEFAULT_POLICY } from '../core/screen/consent';

export function mockScreen(): { screen: ScreenApi } {
  const now = Date.now();
  const state: ScreenState = {
    sessions: [],
    policy: { ...DEFAULT_POLICY },
    log: [
      { at: now - 50 * 60_000, title: 'Sam helped you (help session)' },
      { at: now - 2 * 3600_000, title: 'You controlled Studio Mac mini for 12 min' },
      { at: now - 26 * 3600_000, title: 'Ana’s iPhone viewed this screen for 3 min' },
    ],
    wake: {},
  };
  const phones: AndroidDevice[] = [{ serial: 'R58M123', state: 'device', model: 'Galaxy S24', product: 'e3q', wifi: false }];
  const no = async () => {
    throw new Error('Not available in the demo');
  };
  return {
    screen: {
      state: async () => state,
      session: async () => null,
      view: no,
      stop: async () => undefined,
      answer: async () => undefined,
      setPolicy: async (p) => (state.policy = { ...state.policy, ...p, unattended: { ...state.policy.unattended, ...(p.unattended ?? {}) } }),
      displays: async () => [{ id: '1', label: 'Built-in Retina Display', x: 0, y: 0, width: 1512, height: 982, scale: 2, primary: true }],
      source: async () => null,
      signal: async () => undefined,
      frame: async () => false,
      input: () => undefined,
      ack: () => undefined,
      ready: () => undefined,
      saveRecording: no,
      wake: no,
      learn: async () => true,
      control: async () => ({ available: true }),
      requestPermissions: async () => undefined,
      android: async () => ({ ready: true, version: '5.0.1', downloading: false, progress: 0, canDownload: true }),
      androidInstall: async () => '',
      androidDevices: async () => phones,
      androidPair: async () => true,
      androidConnect: async () => true,
      androidMirror: no,
      androidStop: async () => undefined,
      androidDrop: async (_s, files) => files.map((f) => ({ file: f, ok: true })),
      airplay: async () => ({ how: 'system', detail: 'Turn on AirPlay Receiver in System Settings → General → AirDrop & Handoff, then on the iPhone open Control Center → Screen Mirroring and pick this Mac.', running: false }),
      airplayStart: async () => ({ how: 'system', detail: '' }),
      airplayStop: async () => undefined,
      setControl: async () => true,
      print: async () => undefined,
      reboot: async () => undefined,
      invites: async () => [],
      joinInvite: no,
      sources: async () => [],
    },
  };
}
