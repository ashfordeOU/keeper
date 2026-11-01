// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stands in for keeper-helper in tests: same JSON-lines protocol.
const rl = require('node:readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const waiting = new Map();
const cancelled = new Set();
rl.on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  const { id, method, params } = m;
  if (method === 'hello') return send({ id, result: { version: '1', macos: 26, arm: true, appleModel: 'available', ocr: true, spotlight: true } });
  if (method === 'toolResult') { const w = waiting.get(params.call); waiting.delete(params.call); return w && w(params.result); }
  if (method === 'cancel') { cancelled.add(id); return; }
  if (method === 'fail') return send({ id, error: 'it went wrong' });
  if (method === 'crash') process.exit(3);
  if (method === 'slow') return setTimeout(() => !cancelled.has(id) && send({ id, result: 'late' }), 2000);
  if (method === 'noise') { process.stdout.write('not json\n'); return send({ id, result: 'ok' }); }
  if (method === 'chat') {
    // Streams a little, asks Keeper to run a tool, then finishes with what the tool said.
    send({ id, delta: 'Looking' });
    send({ id, delta: '…' });
    const call = 'c1';
    waiting.set(call, (result) => {
      send({ id, delta: ' found ' + result.count });
      send({ id, result: { text: 'Looking… found ' + result.count } });
    });
    return send({ id, tool: { call, name: 'search_files', arguments: { query: params.messages.at(-1).content } } });
  }
  send({ id, error: 'Unknown method ' + method });
});
