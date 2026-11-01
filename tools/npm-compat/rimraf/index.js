// SPDX-License-Identifier: ISC
// rimraf 2's API (rimraf(path, [opts], cb) and rimraf.sync(path, [opts])) on
// Node's own fs.rm. Keeper's package.json points old rimraf 2 users at this
// through "overrides", so the deprecated glob 7 and inflight stay out.
'use strict';
const fs = require('node:fs');

const options = (opts) => ({ recursive: true, force: true, maxRetries: (opts && opts.maxBusyTries) || 0 });

function rimraf(p, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  fs.rm(p, options(opts), (err) => { if (cb) cb(err || null); });
}
rimraf.sync = (p, opts) => fs.rmSync(p, options(opts));

module.exports = rimraf;
