// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The one place that answers "may this person use that?" for Keeper Pro:
// `entitlements(…).has('pro.cloudSync')`.
//
// The promise (README, LICENSE.md): Keeper is free to use, and what is free stays
// free. So:
//   - every part in core/features.ts is free, for everyone, forever;
//   - every feature introduced up to `freeThrough` (the version in which payments
//     were first switched on, .github/release.json) is free whatever the plan;
//   - only features added after that can be Pro or Team, and only ones that cost
//     Ashforde money to run (servers, storage, AI) or are for teams and businesses.
// test/entitlements.test.ts fails if any part that exists today is ever marked paid.
//
// With Pro switched off in the build (core/pro-switch.ts), paid features simply do
// not exist: has() is false for them and nothing anywhere mentions them.

import { compareVersions } from './updates';
import { FEATURES } from './features';
import type { LicenseCheck, PaidPlan } from './pro/license';
import type { VerifiedReceipt } from './pro/payments';

export type Plan = 'free' | PaidPlan;
export const PLANS: Plan[] = ['free', 'pro', 'team'];
const RANK: Record<Plan, number> = { free: 0, pro: 1, team: 2 };
export const PLAN_NAME: Record<Plan, string> = { free: 'Free', pro: 'Pro', team: 'Team' };

/** The version every part in core/features.ts was free in. Parts added later carry their own `introducedIn`. */
export const FREE_BASELINE = '1.0.0';

export interface PaidFeature {
  /** 'pro.…' or 'team.…' */
  id: string;
  name: string;
  /** one short sentence */
  about: string;
  /** the lowest plan that includes it (Team includes everything in Pro) */
  plan: PaidPlan;
  /** the version it shipped in; null while it is only a proposal (not built) */
  introducedIn: string | null;
  /** why it is paid: it costs money to run, or it is for teams and businesses */
  why: 'costs' | 'teams';
}

/**
 * Candidate paid features, registered so the rest of Keeper can ask about them.
 * All are proposals: none is built, and none takes anything away from what is free.
 */
export const PAID_FEATURES: PaidFeature[] = [
  { id: 'pro.cloudSync', name: 'Keeper Cloud sync', about: 'Settings, notes, snippets and clipboard sets on all your computers and phones, encrypted end to end.', plan: 'pro', introducedIn: null, why: 'costs' },
  { id: 'pro.cloudBackup', name: 'Keeper Cloud backup', about: 'An encrypted copy of Keeper’s own data, kept by Ashforde.', plan: 'pro', introducedIn: null, why: 'costs' },
  { id: 'pro.hostedLinks', name: 'Hosted share links', about: 'Share Studio videos and Shelf files without storage of your own.', plan: 'pro', introducedIn: null, why: 'costs' },
  { id: 'pro.aiCredits', name: 'AI included', about: 'Use Keeper’s AI features without a key of your own.', plan: 'pro', introducedIn: null, why: 'costs' },
  { id: 'pro.monorailBundle', name: 'Monorail included', about: 'Monorail and Keeper Pro together.', plan: 'pro', introducedIn: null, why: 'costs' },
  { id: 'team.shared', name: 'Shared vaults', about: 'Shared snippets, connections and vaults for your team.', plan: 'team', introducedIn: null, why: 'teams' },
  { id: 'team.admin', name: 'Admin policies', about: 'Settings and policies for every computer in your company.', plan: 'team', introducedIn: null, why: 'teams' },
  { id: 'team.sso', name: 'Single sign-on', about: 'Sign in with your company account.', plan: 'team', introducedIn: null, why: 'teams' },
  { id: 'team.support', name: 'Priority support', about: 'Answers from Ashforde within one working day.', plan: 'team', introducedIn: null, why: 'teams' },
];

const paidById = new Map(PAID_FEATURES.map((f) => [f.id, f]));
const featureIds = new Set(FEATURES.map((f) => f.id));
export const paidFeature = (id: string) => paidById.get(id);

/** Was something introduced in `version` covered by the free-forever promise? */
export function freeForever(version: string | null | undefined, freeThrough: string | null): boolean {
  if (!version) return false;
  if (compareVersions(version, FREE_BASELINE) <= 0) return true;
  return !!freeThrough && compareVersions(version, freeThrough) <= 0;
}

/**
 * The lowest plan a feature needs. Every part in core/features.ts is free; so is
 * anything unknown, and any paid feature introduced up to `freeThrough`.
 */
export function planOf(id: string, freeThrough: string | null): Plan {
  if (featureIds.has(id)) return 'free';
  const f = paidById.get(id);
  if (!f) return 'free';
  if (freeForever(f.introducedIn, freeThrough)) return 'free';
  return f.plan;
}

// ---------------------------------------------------------------- where a plan comes from

/** A reason this computer has a paid plan: a license (direct download) or an App Store purchase. */
export type EntitlementSource =
  | { kind: 'license'; check: LicenseCheck }
  | { kind: 'receipt'; receipt: VerifiedReceipt; plan: PaidPlan | null };

/** An App Store purchase as a source; `planOfProduct` maps Ashforde's product ids to plans. */
export function receiptSource(receipt: VerifiedReceipt, planOfProduct: (id: string) => PaidPlan | null): EntitlementSource {
  return { kind: 'receipt', receipt, plan: planOfProduct(receipt.productId) };
}

/** The plan one source gives right now ('free' when it gives nothing). */
export function sourcePlan(s: EntitlementSource, now: number): Plan {
  if (s.kind === 'license') return s.check.ok ? s.check.payload.plan : 'free';
  if (!s.plan || s.receipt.revoked) return 'free';
  return s.receipt.expires === null || now <= s.receipt.expires ? s.plan : 'free';
}

export interface Entitlements {
  /** Pro exists in this build */
  enabled: boolean;
  plan: Plan;
  /** the source that gives the plan */
  source?: EntitlementSource;
  /** may this person use that feature here? */
  has(id: string): boolean;
  /** the plan a feature needs (Free for everything Keeper has today) */
  needs(id: string): Plan;
}

export function entitlements(o: { enabled: boolean; freeThrough: string | null; sources?: EntitlementSource[]; now: number }): Entitlements {
  let plan: Plan = 'free';
  let source: EntitlementSource | undefined;
  if (o.enabled) {
    for (const s of o.sources ?? []) {
      const p = sourcePlan(s, o.now);
      if (RANK[p] > RANK[plan]) { plan = p; source = s; }
    }
  }
  const needs = (id: string) => planOf(id, o.freeThrough);
  return {
    enabled: o.enabled,
    plan,
    source,
    needs,
    has(id) {
      const need = needs(id);
      if (need === 'free') return !paidById.has(id) || !!paidById.get(id)!.introducedIn;
      return o.enabled && RANK[plan] >= RANK[need] && !!paidById.get(id)?.introducedIn;
    },
  };
}
