// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { errorText, ignorable, throttle } from '../core/quiet-errors';

describe('failures nobody caught', () => {
  it('reads like a sentence', () => {
    expect(errorText(new Error("Error invoking remote method 'pim.archive': Error: Mailbox does not exist"))).toBe('Mailbox does not exist');
    expect(errorText(new TypeError('x is not a function'))).toBe('x is not a function');
    expect(errorText('plain')).toBe('plain');
    expect(errorText({ message: 'from an object' })).toBe('from an object');
  });
  it('cancellations are not failures', () => {
    expect(ignorable(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))).toBe(true);
    expect(ignorable(new Error('Render frame was disposed before WebFrameMain could be accessed'))).toBe(true);
    expect(ignorable(new Error('Disk full'))).toBe(false);
  });
  it('the same message shows once in a while', () => {
    let t = 0;
    const once = throttle(5000, () => t);
    expect(once('a')).toBe(true);
    expect(once('a')).toBe(false);
    expect(once('b')).toBe(true);
    t = 6000;
    expect(once('a')).toBe(true);
  });
});
