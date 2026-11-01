// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The file kit in the browser demo: workflows kept in memory.

import type { FileKitApi } from '../core/api-filekit';
import { EXAMPLE_WORKFLOWS, type Workflow } from '../core/filekit/workflow';

export function mockFileKit(): { filekit: FileKitApi } {
  let list: Workflow[] = EXAMPLE_WORKFLOWS.slice(0, 1).map((w, i) => ({ ...w, id: `demo${i}`, created: Date.now() }));
  return {
    filekit: {
      workflows: async () => list,
      saveWorkflow: async (w) => { list = [...list.filter((x) => x.id !== w.id), w]; return list; },
      deleteWorkflow: async (id) => { list = list.filter((x) => x.id !== id); return list; },
      runWorkflow: async () => ({ outputs: [], message: 'Workflows run in the Keeper app' }),
      engines: async () => [],
    },
  };
}
