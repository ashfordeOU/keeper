// SPDX-License-Identifier: AGPL-3.0-or-later
// node-pty's macOS packages ship `spawn-helper` without the execute bit, so
// every terminal fails with "posix_spawnp failed". Put the bit back.
// Used after install, when packaging, and by the terminal host before it starts a shell.
const fs = require('fs');
const path = require('path');

function fixNodePty(root) {
  const fixed = [];
  for (const dir of [path.join(root, 'prebuilds'), path.join(root, 'build')]) {
    if (!fs.existsSync(dir)) continue;
    for (const sub of fs.readdirSync(dir)) {
      const helper = path.join(dir, sub, 'spawn-helper');
      try {
        const mode = fs.statSync(helper).mode;
        if ((mode & 0o111) !== 0o111) {
          fs.chmodSync(helper, mode | 0o755);
          fixed.push(helper);
        }
      } catch {
        /* not there for this system */
      }
    }
  }
  return fixed;
}

module.exports = { fixNodePty };

if (require.main === module) {
  let root;
  try {
    root = path.dirname(require.resolve('node-pty/package.json'));
  } catch {
    process.exit(0);
  }
  const fixed = fixNodePty(root);
  if (fixed.length) console.log(`node-pty: made ${fixed.length} spawn-helper file(s) executable`);
}
