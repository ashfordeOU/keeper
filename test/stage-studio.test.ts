// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { stageAfterStudio, stageBefore } from '../core/stage/studio';

describe('Stage after a Studio recording', () => {
  it('goes back to the preset the person was in', () => {
    const before = stageBefore({ on: true, preset: 'presenting', reason: 'Calendar' });
    expect(stageAfterStudio(before, { on: true, reason: 'Studio' })).toEqual({ action: 'restore', preset: 'presenting', reason: 'Calendar' });
  });
  it('turns off again when it was off', () => {
    expect(stageAfterStudio(stageBefore({ on: false }), { on: true, reason: 'Studio' })).toEqual({ action: 'stop' });
  });
  it('leaves it alone when the person changed Stage meanwhile, or Studio never switched it', () => {
    expect(stageAfterStudio(null, { on: false })).toEqual({ action: 'leave' });
    expect(stageAfterStudio(null, { on: true, reason: 'Manual' })).toEqual({ action: 'leave' });
    // Already on the Recording preset: Studio did not take it over.
    expect(stageAfterStudio(stageBefore({ on: true, preset: 'recording', reason: 'Manual' }), { on: true, reason: 'Manual' })).toEqual({ action: 'leave' });
  });
});
