// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where Keeper's program starts. Keeper itself (the main window, the tray, the
// library and everything behind them) unless it was started as one of the
// suite's parts (`--keeper-role=island`, `--keeper-role=widgets`), which load
// only their own small piece (docs/SUITE.md), or by an app icon as a light app
// (`--keeper-solo=mail`), which loads only what that part needs (docs/SOLO.md).

import { soloFromArgv } from '../core/solo';
import { roleOf } from '../core/suite';

if (roleOf(process.argv) !== 'app') await import('./suite/part');
else if (soloFromArgv(process.argv)) await import('./solo/main');
else await import('./main');
