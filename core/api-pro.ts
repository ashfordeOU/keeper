// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper Pro for the interface (Settings → Account & Pro). In builds without Pro
// status() answers { enabled: false } and nothing else does anything.

import type { ProStatus } from './pro/client';
import type { PaidPlan } from './pro/license';
import type { Period } from './pro/payments';

export type { ProStatus };

export interface ProApi {
  status(): Promise<ProStatus>;
  /** a pasted license or keeper://license link */
  activate(text: string): Promise<ProStatus>;
  /** removes the license from this computer (to move it to another) */
  deactivate(): Promise<ProStatus>;
  /** opens the hosted checkout in the browser */
  checkout(plan: PaidPlan, period: Period): Promise<void>;
  /** opens the page to manage or cancel a subscription */
  manage(): Promise<void>;
  /** sends the licenses bought with this address to it again; returns what to tell the person */
  restore(email: string): Promise<string>;
}
