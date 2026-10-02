'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — captions for a project, as an .ass file: the server's door to the shared builder.

   The style and the builder live in public/js/captions/ (phase K0, 2026-10-03), ES modules the page
   imports and this file require()s - one copy, so the screen and the file cannot drift apart over a
   default. What stays here is what only the server does: escaping a path for an ffmpeg filter.
   ═══════════════════════════════════════════════════════════════════════════ */

const STYLE = require('../public/js/captions/style.js');
const ASS = require('../public/js/captions/ass.js');

// Windows paths inside a filter argument: the separators have to turn round and the drive colon has to
// be escaped, or ffmpeg reads `C:` as the start of another option.
const escapeFilterPath = (p) => String(p).replace(/\\/g, '/').replace(/:/g, '\\:');

module.exports = {
  buildAss: ASS.buildAss, hexToAss: ASS.hexToAss, assTime: ASS.assTime,
  anchorOf: STYLE.anchorOf, captionLanes: STYLE.captionLanes, withAuto: STYLE.withAuto,
  autoSize: STYLE.autoSizePx, DEF: STYLE.DEF, normalizeStyle: STYLE.normalizeStyle,
  normalizeOverride: STYLE.normalizeOverride, normalizeWords: STYLE.normalizeWords,
  escapeFilterPath,
};
