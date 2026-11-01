// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Checks file contents off the main thread: fingerprint (SHA-256), Keeper's
// built-in heuristics and YARA rules. Large files are fingerprinted in a
// stream and only their beginning is examined. The signature engine (ClamAV)
// runs as its own program, started by the security service.

import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import { inspect } from '../core/security/heuristics';
import type { Detection } from '../core/security/types';
import { matchYara, parseYara, type YaraRule } from '../core/security/yara';

/** Bytes read into memory for heuristics and YARA; larger files are fingerprinted only (ClamAV still reads them whole). */
const EXAMINE = 24 * 1024 * 1024;

let rules: YaraRule[] = [];
let hashes: Record<string, string> = {};

async function fingerprint(file: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve()).on('error', reject);
  });
  return h.digest('hex');
}

async function check(file: string, location?: string): Promise<{ detections: Detection[]; size: number; sha256?: string; error?: string }> {
  const st = await fsp.stat(file).catch(() => undefined);
  if (!st?.isFile()) return { detections: [], size: 0, error: 'not a file' };
  const small = st.size <= EXAMINE;
  let data: Buffer;
  let sha: string;
  try {
    if (small) {
      data = await fsp.readFile(file);
      sha = createHash('sha256').update(data).digest('hex');
    } else {
      const fh = await fsp.open(file, 'r');
      data = Buffer.alloc(EXAMINE);
      await fh.read(data, 0, EXAMINE, 0);
      await fh.close();
      sha = await fingerprint(file);
    }
  } catch (e) {
    return { detections: [], size: st.size, error: e instanceof Error ? e.message : String(e) };
  }
  const name = path.basename(file);
  const out: Detection[] = inspect({ name, data, location: location as never }, sha).map((d) => ({ ...d, path: file, size: st.size }));
  if (hashes[sha] && !out.some((d) => d.engine === 'hash' || d.engine === 'signature')) out.push({ path: file, engine: 'hash', name: hashes[sha], severity: 'high', confidence: 'certain', sha256: sha, size: st.size, why: 'Its fingerprint is on a malware list you added.' });
  for (const m of matchYara(rules, data)) {
    const sev = (m.meta.severity as Detection['severity']) ?? 'medium';
    out.push({ path: file, engine: 'yara', name: `YARA.${m.rule}`, severity: ['info', 'low', 'medium', 'high', 'critical'].includes(sev) ? sev : 'medium', confidence: (m.meta.confidence as Detection['confidence']) ?? 'likely', sha256: sha, size: st.size, why: m.meta.description || `Matches the YARA rule ${m.rule}.` });
  }
  return { detections: out, size: st.size, sha256: sha };
}

parentPort?.on('message', async (msg: { id: number; type: string; [k: string]: unknown }) => {
  try {
    if (msg.type === 'rules') {
      const parsed = parseYara(String(msg.text ?? ''));
      rules = parsed.rules;
      hashes = (msg.hashes as Record<string, string>) ?? {};
      parentPort!.postMessage({ id: msg.id, ok: true, result: { rules: rules.length, skipped: parsed.skipped } });
    } else if (msg.type === 'check') {
      parentPort!.postMessage({ id: msg.id, ok: true, result: await check(String(msg.file), msg.location as string | undefined) });
    }
  } catch (e) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
