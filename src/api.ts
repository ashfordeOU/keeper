// SPDX-License-Identifier: AGPL-3.0-or-later
// The bridge to the main process. In the browser demo (`npm run demo`) there is
// no main process, so a fake with sample data stands in and nothing touches the disk.

import type { KeeperApi } from '../core/api';
import { createMockApi } from './mock';

declare global {
  interface Window {
    keeper?: KeeperApi;
  }
}

export const api: KeeperApi = window.keeper ?? createMockApi();
export const isDemo = !window.keeper;
