// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where Keeper's program starts. Keeper itself (the main window, the tray, the
// library and everything behind them) unless it was started as one of the
// suite's parts (`--keeper-role=island`, `--keeper-role=widgets`), which load
// only their own small piece (docs/SUITE.md).

import { roleOf } from '../core/suite';

if (roleOf(process.argv) === 'app') await import('./main');
else await import('./suite/part');
