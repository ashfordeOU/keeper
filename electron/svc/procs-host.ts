// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The process manager's service process: reading every process on the
// computer (and, on Windows, the PowerShell host that does it) runs here, so a
// hang or a crash while sampling never reaches the rest of Keeper.

import { act, apps, configureProcs, details, sample, serviceAction, services, setPriority } from '../services/procs';
import { serve } from './runtime';

serve(
  { sample, details, act, setPriority, services, serviceAction, apps },
  (config: { appPid: number }) => configureProcs(config),
);
