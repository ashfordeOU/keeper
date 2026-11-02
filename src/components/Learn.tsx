// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Learn more ↗": opens a page of Keeper's documentation in the browser.

import type { ReactNode } from 'react';
import { docUrl } from '../../core/brand';
import { api } from '../api';
import { Icon } from './Icon';

export function openDoc(doc: string, anchor?: string) {
  void api.system.openExternal(docUrl(doc, anchor));
}

export function Learn({ doc, anchor, children }: { doc: string; anchor?: string; children?: ReactNode }) {
  return (
    <button type="button" className="link-like learn-link" onClick={() => openDoc(doc, anchor)}>
      {children ?? 'Learn more'} <Icon name="external" size={11} />
    </button>
  );
}
