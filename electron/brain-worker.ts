// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs the meaning-search model off the main thread, so building vectors for
// thousands of passages never makes Keeper stutter.

import os from 'node:os';
import { parentPort, workerData } from 'node:worker_threads';
import { E5Embedder } from '../core/brain/e5';

interface Job {
  id: number;
  texts: string[];
  kind: 'query' | 'passage';
}

const { modelsDir, threads } = workerData as { modelsDir: string; threads: number };
// Few threads: background work must leave the computer free for the person.
// On Linux a thread's priority is its own (and the model's threads inherit it): below
// everything the person runs. Elsewhere the call would lower all of Keeper, so it is not made.
if (process.platform === 'linux') {
  try { os.setPriority(0, os.constants.priority.PRIORITY_LOW); } catch { /* not permitted */ }
}

const ready = E5Embedder.load(modelsDir, { threads });
ready.then(() => parentPort!.postMessage({ ready: true }), (e: unknown) => parentPort!.postMessage({ ready: false, error: e instanceof Error ? e.message : String(e) }));

parentPort!.on('message', async (job: Job) => {
  try {
    const e = await ready;
    const vecs = await e.embed(job.texts, job.kind);
    parentPort!.postMessage({ id: job.id, vectors: vecs }, vecs.map((v) => v.buffer as ArrayBuffer));
  } catch (err) {
    parentPort!.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) });
  }
});
