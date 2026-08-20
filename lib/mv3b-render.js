'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the render of a BLANK project.

   The second of two, and separate on purpose. routes/ffmpeg.js belongs to projects
   that arrive from Scenarios: a flat payload of segmentClips / halferClips / musicClips,
   named lanes with rules of their own, and a compositing order held in the code. None of
   that is true here. A blank project has a variable number of lanes, made and destroyed
   by hand, and their order is a property of the project.

   Two workflows that must not disturb each other. Nothing in routes/ffmpeg.js is imported
   here and nothing here is imported there, so a scenario render keeps working by
   CONSTRUCTION rather than because this change was tested and seemed fine. The duplicated
   arithmetic is the price, and it is a price that ends: when the blank timeline has proved
   itself, the other half goes away entirely.

   THE ONE THING THIS MUST AGREE WITH is public/js/merge-v3/preview-b.js. Layer order and
   frame shape are read from the project here exactly as they are read there - lanes listed
   top layer first, painted bottom first, format off the project. If the two ever read them
   differently the screen and the file show different videos, and that is the most expensive
   kind of bug in an editor: it is invisible until the export is watched.

   PURE. It builds a graph and returns it; it runs nothing and writes nothing. Executing it
   is the next step, and keeping the two apart is what lets the graph be checked without a
   render.
   ═══════════════════════════════════════════════════════════════════════════ */

const FORMATS = { '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 } };

const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const r6 = (v) => (+v || 0).toFixed(6);

function frame(timeline) {
  const f = timeline && timeline.format;
  return FORMATS[f] || FORMATS['9:16'];
}

// Bottom layer first - the video lanes read backwards, because the list is held top layer
// first the way a timeline reads. Identical to _layers() in preview-b.js, deliberately.
function videoLanes(timeline) {
  const t = (timeline && timeline.tracks) || [];
  return t.filter(x => x.kind === 'video').slice().reverse();
}

function audioLanes(timeline) {
  const t = (timeline && timeline.tracks) || [];
  return t.filter(x => x.kind === 'audio');
}

function duration(timeline) {
  let end = 0;
  for (const tr of ((timeline && timeline.tracks) || [])) {
    for (const c of (tr.clips || [])) end = Math.max(end, (+c.start) + (+c.dur));
  }
  return r2(end);
}

const isStill = (src) => /\.(jpe?g|png|webp|avif|bmp)$/i.test(String(src || '').split('?')[0]);

// Every sound that will actually be heard. A clip at volume 0 is left out of the graph
// entirely rather than mixed at silence: a muted birol is the common case here, and feeding
// ffmpeg a stream that contributes nothing costs a decode per clip for no sound.
function audibleClips(timeline) {
  const out = [];
  for (const tr of audioLanes(timeline)) {
    const master = (tr.volume == null) ? 1 : +tr.volume;
    if (!(master > 0)) continue;
    for (const c of (tr.clips || [])) {
      const v = ((c.volume == null) ? 1 : +c.volume) * master;
      if (!(v > 0)) continue;
      out.push({ clip: c, gain: v });
    }
  }
  return out;
}

/**
 * Turn a blank project's timeline into an ffmpeg graph.
 * Returns { w, h, dur, inputs, filter, map } - inputs in the order ffmpeg must be given them.
 */
function buildGraph(timeline) {
  const { w, h } = frame(timeline);
  const dur = duration(timeline);
  const inputs = [];
  const parts = [];

  // The bed everything is laid onto: one black frame of the project's shape, held for the
  // whole length. Built rather than taken from a clip, so a timeline with a gap at the start
  // - or no picture at all - still renders something of the right size instead of failing.
  parts.push(`color=c=black:s=${w}x${h}:d=${r6(dur)}:r=30[bg]`);
  let last = 'bg';

  let n = 0;
  for (const lane of videoLanes(timeline)) {
    for (const c of (lane.clips || [])) {
      const still = isStill(c.src);
      const idx = inputs.length;
      inputs.push(still
        ? { file: c.src, loop: true, t: r2(c.dur) }
        : { file: c.src, ss: r2(c.trimIn || 0), t: r2((c.dur || 0) * (c.speed || 1)) });

      const speed = +c.speed || 1;
      const tag = `v${n++}`;
      // Scaled to fit and padded, never cropped - the same bargain the preview makes, and for
      // the same reason: a clip is whatever shape it is, and filling the frame would throw
      // away part of a picture somebody chose.
      parts.push(
        `[${idx}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        (speed !== 1 ? `setpts=${r6(1 / speed)}*PTS,` : '') +
        `setpts=PTS-STARTPTS+${r6(c.start)}/TB[${tag}]`
      );
      parts.push(
        `[${last}][${tag}]overlay=0:0:enable='between(t,${r6(c.start)},${r6((+c.start) + (+c.dur))})'[o${n}]`
      );
      last = `o${n}`;
    }
  }

  // Sound. Each audible clip is delayed to its place and mixed; the mix is normalised off,
  // because amix would otherwise quieten every clip as more are added and a level set by hand
  // would stop meaning what it says.
  const aTags = [];
  for (const { clip, gain } of audibleClips(timeline)) {
    const idx = inputs.length;
    inputs.push({ file: clip.src, ss: r2(clip.trimIn || 0), t: r2(clip.dur) });
    const tag = `a${aTags.length}`;
    parts.push(
      `[${idx}:a]atrim=0:${r6(clip.dur)},asetpts=PTS-STARTPTS,` +
      `adelay=${Math.round((+clip.start) * 1000)}|${Math.round((+clip.start) * 1000)},` +
      `volume=${r6(Math.min(4, gain))}[${tag}]`
    );
    aTags.push(tag);
  }

  let amap = null;
  if (aTags.length === 1) amap = aTags[0];
  else if (aTags.length > 1) {
    parts.push(`${aTags.map(t => `[${t}]`).join('')}amix=inputs=${aTags.length}:normalize=0:dropout_transition=0[amix]`);
    amap = 'amix';
  }

  return { w, h, dur, inputs, filter: parts.join(';'), map: { v: last, a: amap } };
}

module.exports = { buildGraph, frame, videoLanes, audioLanes, audibleClips, duration };
