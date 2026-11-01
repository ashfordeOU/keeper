// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo of anonymous usage stats (Settings → Privacy, the tour step, the firewall card)
// in the browser preview. Nothing is sent from the demo; the reports are built
// by the real buildPayload from a pretend computer.

import { FEATURES, featurePatch, featureStates } from '../core/features';
import type { AllSettings } from '../core/settings';
import { buildPayload, enqueue, TELEMETRY_ENDPOINT, TELEMETRY_HOST, uuidFromBytes, type PingBody, type TelemetryInputs, type UsageStatsApi, type UsageStatsStatus } from '../core/telemetry';

const DAY = 86_400_000;
const rnd = () => uuidFromBytes(crypto.getRandomValues(new Uint8Array(16)));

export function mockUsageStats(get: () => AllSettings, apply: (patch: Partial<AllSettings>) => void, emit: (ch: string) => void): { usageStats: UsageStatsApi } {
  let id = '3f6c1a9e-7b2d-4c1e-9a8f-2d4b6e8c0a17';
  let blocked = false;
  const pages: Record<string, number> = { home: 14, search: 9, library: 6, cleanup: 3, settings: 2, todo: 2, devices: 1 };
  const inputs = (now: number): TelemetryInputs => ({
    installId: id, now, version: '0.1.0', official: true, installSource: 'brew', platform: 'darwin', osRelease: '15.1.0', arch: 'arm64',
    cpuModel: 'Apple M3', cores: 8, totalMemBytes: 16 * 1024 ** 3, gpuVendorIds: [0x106b], hasBattery: true, displays: 2, notch: true, locale: 'en-GB',
    activeDays: [0, 1, 2, 4, 5].map((d) => new Date(now - d * DAY).toISOString().slice(0, 10)),
    featuresOn: [...featureStates(get(), 'darwin').values()].filter((f) => f.on).map((f) => f.id), knownFeatures: FEATURES.map((f) => f.id),
    pageOpens: pages, aiProviders: 1, devices: 1, crashes: 0, restarts: 1, avgMemoryBytes: 380 * 1048576, avgCpuPct: 0.4, startupMs: 1400,
  });
  let last: { at: number; body: PingBody } | undefined = { at: Date.now() - DAY + 3_600_000, body: { pings: [buildPayload({ ...inputs(Date.now() - DAY), pageOpens: { home: 21, search: 7, island: 3 } })] } };
  const on = () => featureStates(get(), 'darwin').get('usageStats')?.on ?? true;
  const status = async (): Promise<UsageStatsStatus> => ({
    on: on(), switchOn: on(), offReason: on() ? null : 'switch', offText: on() ? undefined : 'You switched it off.', locked: false,
    installId: id, endpoint: TELEMETRY_ENDPOINT, host: TELEMETRY_HOST, last, next: { pings: enqueue([], buildPayload(inputs(Date.now())), Date.now()) },
    queued: 0, lastAttempt: last ? { at: last.at, result: 'Sent' } : undefined, blockedByFirewall: blocked, policyFile: '/Library/Application Support/Keeper/policy.json',
  });
  return {
    usageStats: {
      status,
      setOn: async (v) => { apply(featurePatch(get(), 'usageStats', v)); emit('features-changed'); return status(); },
      resetId: async () => { id = rnd(); last = undefined; return status(); },
      setBlocked: async (b) => { blocked = b; return status(); },
      page: async (name) => { if (on()) pages[name] = (pages[name] ?? 0) + 1; },
    },
  };
}
