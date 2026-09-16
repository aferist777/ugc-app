'use strict';

/* file-release.js - asking background work to let go of files that are about to move.

   On Windows a file another process has open cannot be renamed, and neither can the folder it is
   in. ffmpeg opens its input without sharing delete, so a preview proxy being made in the
   background (routes/proxies.js) turns the rename of a category or a project folder into EPERM for
   as long as it runs. lib/relocate.js calls release() before it moves anything; whoever runs
   such work registers a releaser here - it drops what is queued for those files and stops what is
   already running (it will be made again, from the new address, when it is next asked for). */

const _releasers = [];

// fn(absPaths): absolute paths of files, or of folders whose contents are moving.
function onRelease(fn) {
  if (typeof fn === 'function') _releasers.push(fn);
}

function release(absPaths) {
  const list = (absPaths || []).filter(Boolean);
  if (!list.length) return;
  for (const fn of _releasers) {
    try { fn(list); } catch (e) { console.warn('[file-release]', e.message); }
  }
}

module.exports = { onRelease, release };
