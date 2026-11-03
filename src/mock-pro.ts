// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro in the browser demo. Without Pro in the build it is off, as in the
// app; with it, a pretend free install that can "activate" any pasted license.

import type { ProApi, ProStatus } from '../core/api-pro';
import { PAID_FEATURES, planOf } from '../core/entitlements';
import { findToken } from '../core/pro/license';
import { freeThrough, proEnabled } from '../core/pro-switch';

export function mockPro(emit: (ch: string) => void): { pro: ProApi } {
  let licensed = false;
  const status = async (): Promise<ProStatus> => {
    if (!proEnabled()) return { enabled: false };
    return {
      enabled: true, offered: true, plan: licensed ? 'pro' : 'free', edition: 'direct', manage: licensed,
      license: licensed ? { id: 'demo-license', plan: 'pro', seats: 2, exp: Date.now() + 200 * 86_400_000, state: 'active', via: 'lemonsqueezy' } : undefined,
      buy: [{ plan: 'pro', period: 'month' }, { plan: 'pro', period: 'year' }, { plan: 'team', period: 'year' }],
      features: PAID_FEATURES.map((f) => ({ id: f.id, name: f.name, about: f.about, plan: planOf(f.id, freeThrough()), proposal: !f.introducedIn, has: false })),
    };
  };
  const off = () => { if (!proEnabled()) throw new Error('Keeper Pro isn’t part of this version.'); };
  return {
    pro: {
      status,
      activate: async (text) => { off(); if (!findToken(text)) throw new Error('That isn’t a Keeper license.'); licensed = true; emit('pro-changed'); return status(); },
      deactivate: async () => { off(); licensed = false; emit('pro-changed'); return status(); },
      checkout: async () => { off(); },
      manage: async () => { off(); },
      restore: async () => { off(); return 'If a license was bought with that address, it is on its way.'; },
    },
  };
}
