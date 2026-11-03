// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Keeper + Monorail lid demo: who keeps the Mac awake, step by step, following
// docs/KEEPER-MONORAIL.md ("Closed lid"). Monorail hands a closed-lid session to Keeper
// only when Keeper says it can take it without a password prompt, and waits for Keeper's
// answer; when Keeper can't, Monorail keeps the Mac awake itself.
// Pure: used by site.js in the browser and by test/site.test.ts.

/**
 * The steps for one run of the demo.
 * @param {{ keeperReady: boolean, pluggedIn: boolean }} s
 * @returns {{ who: 'monorail'|'keeper'|'none', lid: 'open'|'closed', text: string }[]}
 */
export function lidSteps({ keeperReady, pluggedIn }) {
  const holder = keeperReady ? 'keeper' : 'monorail';
  const name = keeperReady ? 'Keeper' : 'Monorail';
  const steps = [
    { who: 'monorail', lid: 'open', text: 'You start a lid-closed session in Monorail.' },
    { who: 'monorail', lid: 'open', text: 'Monorail asks Keeper to take it, and waits.' },
    keeperReady
      ? { who: 'keeper', lid: 'open', text: 'Keeper says yes and takes over.' }
      : { who: 'monorail', lid: 'open', text: 'Keeper can’t yet, and says why. Monorail keeps it.' },
  ];
  if (!pluggedIn) {
    steps.push({ who: 'none', lid: 'closed', text: 'You close the lid. On battery, the Mac sleeps.' });
    return steps;
  }
  steps.push({ who: holder, lid: 'closed', text: `You close the lid. ${name} keeps the Mac awake.` });
  steps.push({ who: holder, lid: 'open', text: 'You open the lid. Nothing dropped.' });
  return steps;
}

/** Who holds the Mac awake at the end of a run. */
export const lidOwner = (s) => lidSteps(s).at(-1).who;

/**
 * What the little Mac in the demo shows for one step: the lid, what's on its screen
 * (Monorail's strip, Keeper's Island saying it keeps the Mac awake, or a sleeping screen),
 * and which app's Stay Awake glow lights up under it.
 * @param {{ who: 'monorail'|'keeper'|'none', lid: 'open'|'closed' }} step
 * @returns {{ lid: 'open'|'closed', screen: 'strip'|'island'|'asleep', glow: 'keeper'|'monorail'|null }}
 */
export function scene(step) {
  const screen = step.who === 'keeper' ? 'island' : step.who === 'monorail' ? 'strip' : 'asleep';
  return { lid: step.lid, screen, glow: step.who === 'none' ? null : step.who };
}
