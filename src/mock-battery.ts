// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's battery care: a Linux laptop at 64%, stopping at 80%.

import type { BatteryCareApi, BatteryCareStatus } from '../core/api-battery';
import { chargePlan, defaultChargeSettings, tripEnd, type ChargeSettings } from '../core/charge-limit';

export function mockBatteryCare(): { batteryCare: BatteryCareApi } {
  let s: ChargeSettings = defaultChargeSettings();
  let kept = true;
  const status = async (): Promise<BatteryCareStatus> => ({ platform: 'linux', settings: s, battery: { percent: 64, charging: true, plugged: true, temp: 31 }, support: 'linux', canLimit: true, canPause: true, withoutAsking: true, current: chargePlan(s, Date.now()).end, kept, plan: chargePlan(s, Date.now(), 31) });
  return {
    batteryCare: {
      status,
      apply: async (limit) => { s = { ...s, limit }; kept = limit < 100; return { ok: true, message: `Charging stops at ${limit}%` }; },
      setTrip: async (on) => { s = { ...s, tripUntil: on ? tripEnd(Date.now()) : 0 }; return status(); },
      setHeat: async (on) => { s = { ...s, heat: on }; return status(); },
      openSettings: async () => undefined,
    },
  };
}
