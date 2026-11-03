// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Text sizes and corners come from the tokens in app.css (--fs-*, --r-*): new
// stylesheets use only those, and the older ones may not gain raw pixel values.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(__dirname, '../src/styles');
const raw = (css: string) => (css.match(/(font-size|border-radius):\s*[0-9.]+px\s*[;}]/g) ?? []).length;

describe('type scale and corner tokens', () => {
  it('Settings and the tab bar use only the tokens', () => {
    expect(raw(readFileSync(path.join(dir, 'settings.css'), 'utf8'))).toBe(0);
    const app = readFileSync(path.join(dir, 'app.css'), 'utf8');
    const tabs = app.slice(app.indexOf('/* The one tab bar'), app.indexOf('/* Native controls look like'));
    expect(raw(tabs)).toBe(0);
  });
  it('raw pixel sizes only go down', () => {
    // Lower this as stylesheets move to the tokens (1,255 before the tokens).
    const total = readdirSync(dir).filter((f) => f.endsWith('.css')).reduce((n, f) => n + raw(readFileSync(path.join(dir, f), 'utf8')), 0);
    expect(total).toBeLessThanOrEqual(1147);
  });
});
