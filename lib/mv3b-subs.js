'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — captions for a project, as an .ass file: the server's door to the shared builder.

   The style and the builder live in public/js/captions/, ES modules the page
   imports and this file require()s - one copy, so the screen and the file cannot drift apart over a
   default. What stays here is what only the server does: escaping a path for an ffmpeg filter.
   ═══════════════════════════════════════════════════════════════════════════ */

const STYLE = require('../public/js/captions/style.js');
const ASS = require('../public/js/captions/ass.js');
// The sound a timeline plays and the words heard in it: lib/captions-job.js lays them.
const HEARD = require('../public/js/captions/heard.js');
// The words cut into pages - the same rules the page re-cuts by.
const PAGES = require('../public/js/captions/pages.js');
// A heard line's words and the text written over them: what Generate keeps.
const WORDS = require('../public/js/captions/words.js');
// The `.srt` beside a render: lib/mv3b-job.js.
const SRT = require('../public/js/captions/srt.js');
// Several presets and animations dealt onto the pages: lib/captions-job.js, lib/highlights-cut.js.
const MIX = require('../public/js/captions/mix.js');

// A path as an UNQUOTED filter option value. ffmpeg reads a filter's arguments twice - as an
// option value, where \ ' and : are special, then as part of the graph, where \ ' [ ] , and ; are - so
// each level gets its own escapes, in that order. Quoting is not enough: an apostrophe in the path (a
// Windows user name can have one) would end the quotes, and the fonts would silently not be found. Checked on
// our ffmpeg with "O'Neil, [x]; fonts" in -vf and in -filter_complex.
const escapeFilterPath = (p) => {
  const value = String(p).replace(/\\/g, '/').replace(/[\\':]/g, (m) => '\\' + m);
  return value.replace(/[\\'[\],;]/g, (m) => '\\' + m);
};

module.exports = {
  buildAss: ASS.buildAss, captionLanes: STYLE.captionLanes, normalizeStyle: STYLE.normalizeStyle,
  normalizeOverride: STYLE.normalizeOverride, normalizeWords: STYLE.normalizeWords,
  escapeFilterPath, HEARD, PAGES, WORDS, SRT, MIX,
};
