'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — captions for a project, as an .ass file: the server's door to the shared builder.

   The style and the builder live in public/js/captions/ (phase K0, 2026-10-03), ES modules the page
   imports and this file require()s - one copy, so the screen and the file cannot drift apart over a
   default. What stays here is what only the server does: escaping a path for an ffmpeg filter.
   ═══════════════════════════════════════════════════════════════════════════ */

const STYLE = require('../public/js/captions/style.js');
const ASS = require('../public/js/captions/ass.js');
// The sound a timeline plays and the words heard in it (phase K1): lib/captions-job.js lays them.
const HEARD = require('../public/js/captions/heard.js');
// The words cut into pages (phase K2) - the same rules the page re-cuts by.
const PAGES = require('../public/js/captions/pages.js');
// A heard line's words and the text written over them (phase K10): what Generate keeps.
const WORDS = require('../public/js/captions/words.js');

// A path as an UNQUOTED filter option value (phase K5). ffmpeg reads a filter's arguments twice - as an
// option value, where \ ' and : are special, then as part of the graph, where \ ' [ ] , and ; are - so
// each level gets its own escapes, in that order. Quoting is not enough: an apostrophe in the path (a
// Windows user name can have one) ended the quotes, and the fonts were silently not found. Checked on
// our ffmpeg with "O'Neil, [x]; fonts" in -vf and in -filter_complex.
const escapeFilterPath = (p) => {
  const value = String(p).replace(/\\/g, '/').replace(/[\\':]/g, (m) => '\\' + m);
  return value.replace(/[\\'[\],;]/g, (m) => '\\' + m);
};

module.exports = {
  buildAss: ASS.buildAss, hexToAss: ASS.hexToAss, assTime: ASS.assTime,
  anchorOf: STYLE.anchorOf, captionLanes: STYLE.captionLanes, withAuto: STYLE.withAuto,
  autoSize: STYLE.autoSizePx, DEF: STYLE.DEF, normalizeStyle: STYLE.normalizeStyle,
  normalizeOverride: STYLE.normalizeOverride, normalizeWords: STYLE.normalizeWords,
  escapeFilterPath, HEARD, PAGES, WORDS,
};
