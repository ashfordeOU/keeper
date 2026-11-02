// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The tray menu is handed to the system again only when what it shows changes.
import { describe, expect, it } from 'vitest';
import { menuKey } from '../core/menu-key';

describe('menuKey', () => {
  it('ignores click handlers and notices what is shown', () => {
    const a = [{ label: 'Open', click: () => 1 }, { label: 'More', submenu: [{ label: 'x', id: '/p' }] }];
    const b = [{ label: 'Open', click: () => 2 }, { label: 'More', submenu: [{ label: 'x', id: '/p' }] }];
    expect(menuKey(a)).toBe(menuKey(b));
    expect(menuKey(a)).not.toBe(menuKey([{ label: 'Open' }, { label: 'More', submenu: [{ label: 'x', id: '/q' }] }]));
    expect(menuKey([{ label: 'A', checked: true }])).not.toBe(menuKey([{ label: 'A', checked: false }]));
  });
});
