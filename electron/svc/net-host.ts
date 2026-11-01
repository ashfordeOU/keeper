// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Network Activity service process: sampling, names, countries and latency.

import { configure, dropGeo, geoInfo, health, sample } from '../services/net/sampler';
import { serve } from './runtime';

serve(
  { sample, health, geoInfo, dropGeo },
  (config: { dataDir: string }) => configure(config.dataDir),
);
