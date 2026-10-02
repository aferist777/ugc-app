'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CAPTIONS ON A SCREENSHOT (phase K4, 2026-10-03).
//
// The preview draws captions with libass in the page now (public/js/captions/layer.js), on a canvas
// its worker owns - the screenshot cannot take them from it. So the frame is saved without them and
// they are burnt here, by the render's own libass, from the project's own timeline at that moment:
// the screenshot shows what the render will. The picture is one still; its single frame is moved to
// the moment (setpts) so the .ass is drawn as it is at `at`.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { TEMP_DIR, CAPTION_FONTS_DIR } = require('./config');
const SUBS = require('./mv3b-subs');

function _run(args) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    p.stderr.on('data', (d) => { err = (err + d.toString()).slice(-2000); });
    p.on('close', (code) => resolve({ code, err }));
    p.on('error', (e) => resolve({ code: -1, err: e.message }));
  });
}

/**
 * Burn the captions showing at `at` (seconds) onto the picture at `abs`, in place. Answers whether
 * anything was drawn; a timeline with no caption at that moment leaves the picture as it is.
 */
async function burn(abs, timeline, at) {
  const t = Math.max(0, +at || 0);
  const lanes = SUBS.captionLanes(timeline).map(l => ({
    ...l, clips: (l.clips || []).filter(c => c && c.name && t >= (+c.start || 0) && t < (+c.start || 0) + (+c.dur || 0)),
  }));
  if (!lanes.some(l => l.clips.length)) return false;
  const fmt = (timeline && timeline.format) === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
  const ass = SUBS.buildAss(lanes, fmt.w, fmt.h);
  if (!ass) return false;
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const assFile = path.join(TEMP_DIR, 'shot_' + stamp + '.ass');
  const out = path.join(TEMP_DIR, 'shot_' + stamp + path.extname(abs));
  fs.writeFileSync(assFile, ass);
  try {
    // A still arrives in a 1/25 s time base, and setpts rounds to it - so the frame would be drawn up
    // to 40 ms early. In milliseconds first, then moved.
    const vf = 'settb=1/1000,setpts=PTS+' + Math.round(t * 1000) + ',ass=filename=' + SUBS.escapeFilterPath(assFile)
      + ':fontsdir=' + SUBS.escapeFilterPath(CAPTION_FONTS_DIR);
    const r = await _run(['-hide_banner', '-y', '-i', abs, '-vf', vf, '-frames:v', '1', out]);
    if (r.code !== 0 || !fs.existsSync(out)) throw new Error('the captions could not be drawn (' + r.err.split('\n').slice(-2).join(' ').slice(0, 200) + ')');
    // COPY, not rename: scratch and the library may be on different drives (CLAUDE.md).
    fs.copyFileSync(out, abs);
    return true;
  } finally {
    for (const f of [assFile, out]) { try { fs.unlinkSync(f); } catch (e) { /* gone */ } }
  }
}

module.exports = { burn };
