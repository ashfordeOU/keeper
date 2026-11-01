// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The file kit's calls: saved workflows and the engines it can use.

import type { ConvertResult } from './convert-types';
import type { Workflow } from './filekit/workflow';

export interface EngineInfo {
  id: string;
  name: string;
  /** what Keeper uses it for */
  for: string;
  license: string;
  found: boolean;
  path?: string;
  /** where to get it when it is missing */
  url: string;
}

export interface FileKitApi {
  workflows(): Promise<Workflow[]>;
  saveWorkflow(w: Workflow): Promise<Workflow[]>;
  deleteWorkflow(id: string): Promise<Workflow[]>;
  /** runs a workflow on files or folders (a folder runs every matching file inside) */
  runWorkflow(id: string, inputs?: string[]): Promise<ConvertResult>;
  /** outside programs some conversions use, and whether each is installed */
  engines(): Promise<EngineInfo[]>;
}
