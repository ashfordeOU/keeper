// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro's build switch, read by the main process, the interface and the
// command line alike. scripts/build-main.mjs and vite.config.ts fill these in
// from .github/release.json ("proEnabled", "freeThrough"); KEEPER_PRO=1 or 0
// overrides "proEnabled" for one build. Outside a bundled build (unit tests)
// they are absent: Pro is off.
//
// With Pro off nothing about it exists for the person: no page, no row, no
// badge, no network and no timers. See docs/PRO.md.

declare const __KEEPER_PRO__: boolean | undefined;
declare const __KEEPER_FREE_THROUGH__: string | undefined;

let override: { pro?: boolean; freeThrough?: string | null } = {};

/** Is Keeper Pro switched on in this build? */
export function proEnabled(): boolean {
  if (override.pro !== undefined) return override.pro;
  return typeof __KEEPER_PRO__ === 'boolean' && __KEEPER_PRO__;
}

/**
 * The last version whose features stay free for everyone, forever: the version in
 * which payments were first switched on (.github/release.json). Null while Pro has
 * never been switched on, which means every feature is free.
 */
export function freeThrough(): string | null {
  if (override.freeThrough !== undefined) return override.freeThrough;
  return typeof __KEEPER_FREE_THROUGH__ === 'string' && __KEEPER_FREE_THROUGH__ ? __KEEPER_FREE_THROUGH__ : null;
}

/** Tests only: pretend a build with Pro on or off. `{}` goes back to the build's own values. */
export function setProSwitchForTests(o: { pro?: boolean; freeThrough?: string | null }) {
  override = { ...o };
}
