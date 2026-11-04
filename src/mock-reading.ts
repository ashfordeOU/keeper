// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's read aloud: the browser's own voice when it has one.

import type { ReadingApi } from '../core/api-reading';
import { speakable } from '../core/read-aloud';

export function mockReading(): { reading: ReadingApi } {
  const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;
  return {
    reading: {
      voice: async () => (synth ? { ok: true } : { ok: false, message: 'This browser has no voice for reading aloud.' }),
      speak: async (t) => { if (!synth) return { ok: false }; synth.cancel(); synth.speak(new SpeechSynthesisUtterance(speakable(t))); return { ok: true }; },
      stop: async () => synth?.cancel(),
      speaking: async () => !!synth?.speaking,
      font: async () => null,
    },
  };
}
