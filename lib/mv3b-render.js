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

const { escapeFilterPath } = require('./mv3b-subs');

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

// HOW A CLIP MEETS A FRAME THAT IS NOT ITS SHAPE, and the second thing this file must agree
// with preview-b.js about. Fit keeps the whole picture and pads what is left over; fill covers
// the frame and loses the edges. Which edge survives is the clip's own choice, because when a
// 16:9 shot is forced into a 9:16 film the subject is rarely in the middle.
function fitChain(c, w, h) {
  if (String(c.fit || 'fit') !== 'fill') {
    return `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
           `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
  }
  // Both axes are given and only one of them can do anything: after scaling to cover, the
  // frame matches the source on one side exactly, so that side's offset works out to zero
  // whatever was chosen. One list of five answers, no way to pick a contradiction.
  const a = String(c.cropAlign || 'center');
  const x = a === 'left' ? '0' : a === 'right' ? '(iw-ow)' : '(iw-ow)/2';
  const y = a === 'top' ? '0' : a === 'bottom' ? '(ih-oh)' : '(ih-oh)/2';
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:${x}:${y}`;
}

// ── An insert placed on the frame ───────────────────────────────────────────
// TX AND TY ARE THE CENTRE HERE, as fractions of the frame, and not the top-left corner the
// other editor stores. That is a deliberate divergence and it buys rotation: a turned
// rectangle is bigger than the one it came from, by an amount that depends on the source's
// aspect - which is not known when the graph is written. Anchored by the middle, the position
// is the same number before and after the turn, and overlay can be told it in terms of its own
// runtime width and height.
// PLACED IS `tw` HAVING A VALUE AT ALL, and not "smaller than the frame". Anchored by its
// middle, an insert as wide as the film - or wider - is still a placement: it can be moved off
// centre, turned, and hung over the edge, and the preview has a margin around the frame so that
// what hangs over can be seen. `tw: null` is the unplaced state, and the only one.
const isPlaced = (c) => !!(c && c.tw != null && +c.tw > 0);

// Soft edges, as an alpha ramp in from whichever edge is nearest. A hard edge is what makes an
// insert read as pasted on rather than as part of the shot.
//
// The width is a FRACTION of the insert's shorter side and is resolved inside the expression
// from geq's own W and H. A pixel count would mean one thing on a 1080-wide render and another
// on a 540-wide preview, and the two would disagree about the same number.
//
// geq evaluates per pixel and is not cheap, so it is absent from the chain entirely at zero.
function featherChain(v) {
  const fr = Math.max(0, Math.min(0.45, +v || 0));
  if (fr <= 0.001) return '';
  return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':`
       + `a='min(255,255*min(min(X,W-1-X),min(Y,H-1-Y))/max(1,${fr.toFixed(4)}*min(W,H)))'`;
}

// atempo changes speed without changing pitch, and refuses anything outside 0.5-2 in one go.
// So it is chained: 0.25x is two halvings, and the panel's whole range is covered by at most
// two stages. Resampling instead would drop the voice an octave.
function atempoChain(speed) {
  const out = [];
  let s = Math.max(0.25, Math.min(4, +speed || 1));
  while (s > 2.0001) { out.push('atempo=2'); s /= 2; }
  while (s < 0.4999) { out.push('atempo=0.5'); s *= 2; }
  if (Math.abs(s - 1) > 0.001) out.push('atempo=' + r6(s));
  return out;
}

// ═══ THE THREE EFFECTS ═══════════════════════════════════════════════════════
// Ported from routes/ffmpeg.js rather than imported from it, which is the same bargain the
// rest of this file makes: the scenario renderer must keep working by construction, and a
// shared helper is a shared way to break both at once. The VALUES are its values - `fade`,
// `zoom_in`, `vhs` and the rest are what its ffmpeg side already knows how to build, and a
// prettier name here would be a setting nothing acts on.
//
// What is NOT carried over is the per-effect parameters. That editor lets a transition name
// its own duration and a vignette its own angle; this panel offers the name alone, so the
// defaults are baked in. When the parameters get a UI here they go in one place - these three
// functions - rather than into the clip chain.
const FD = 0.35;      // how long a paired transition takes at each end, seconds
const FPS = 30;

// Five stacked steps that approximate a ramp, in at the head and out at the tail. ffmpeg has
// no way to vary a filter's strength continuously over time, so the strength is stepped and
// each step is switched on for its slice of the clip.
function stackedRamp(D, st, maxValue, make) {
  const N = 5;
  const step = D / N;
  let out = '';
  for (let i = 0; i < N; i++) {
    out += make(maxValue * (1 - i / N), (i * step).toFixed(3), ((i + 1) * step).toFixed(3));
  }
  for (let i = 0; i < N; i++) {
    out += make(maxValue * ((i + 1) / N), (st + i * step).toFixed(3), (st + (i + 1) * step).toFixed(3));
  }
  return out;
}

// A slow push in or out over the whole clip. Rendered at twice the frame size and scaled back
// down: zoompan lands on sub-pixel offsets, and at full size that reads as a shake rather than
// a move.
function animChain(anim, dur, w, h) {
  if (anim !== 'zoom_in' && anim !== 'zoom_out') return '';
  const frames = Math.max(1, Math.ceil(dur * FPS));
  const max = 1.15;
  const P = `(on/${frames})`;
  const z = anim === 'zoom_in' ? `1+(${max.toFixed(4)}-1)*${P}` : `${max.toFixed(4)}-(${max.toFixed(4)}-1)*${P}`;
  return `zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${2 * w}x${2 * h}:fps=${FPS},` +
         `scale=${w}:${h}:flags=lanczos,format=yuv420p,setsar=1`;
}

// Colour and texture, no motion. Every one of these is a look applied to the whole clip.
function gradeChain(filt) {
  const POST = ',format=yuv420p,setsar=1';
  switch (filt) {
    case 'vignette':  return `vignette=angle=0.780:aspect=1.000${POST}`;
    case 'sharpen':   return `unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=1.00${POST}`;
    // gamma_r down and gamma_b up is a warmer picture; the other way round is a colder one.
    case 'warm':      return `eq=gamma_r=0.850:gamma_b=1.150${POST}`;
    case 'cool':      return `eq=gamma_r=1.150:gamma_b=0.850${POST}`;
    case 'glitch':    return `noise=alls=30:allf=t+u,rgbashift=rh=3:bh=-3:edge=smear${POST}`;
    case 'bw':        return `hue=s=0.000,eq=contrast=1.000${POST}`;
    case 'vhs':       return `noise=alls=9:allf=t+u,rgbashift=rh=2:bh=-2:edge=smear,` +
                             `eq=saturation=0.875:gamma_r=1.050${POST}`;
    // Teal in the shadows, orange in the highlights - the grade every trailer is cut with.
    case 'cinematic': return `colorbalance=rs=-0.150:bs=0.150:rh=0.150:bh=-0.150${POST}`;
    case 'sepia':     return `colorchannelmixer=0.3930:0.7690:0.1890:0:0.3490:0.6860:0.1680:0:` +
                             `0.2720:0.5340:0.1310:0${POST}`;
    default:          return '';
  }
}

// PAIRED, not crossfaded: the effect happens at both ends of the same clip rather than
// between two of them. On a timeline where clips may sit anywhere - with gaps, overlapping,
// on four layers at once - there is no reliable "next clip" to cross into, and a transition
// that guessed at one would fire against whatever happened to follow.
//
// Returns a chain WITH a leading comma, or '' for none.
function transChain(trans, dur, w, h, placed, alpha) {
  if (!trans || trans === 'none') return '';
  // The two punches are zoompan, which re-bakes to the frame size - on a placed insert that is
  // not a punch, it is the insert jumping to full screen and back.
  if (placed && (trans === 'zoom-punch-in' || trans === 'zoom-punch-out')) return '';
  const d = Math.min(FD, dur / 3);
  const st = Math.max(0, dur - d);
  const ds = d.toFixed(3), sts = st.toFixed(3);

  switch (trans) {
    case 'fade':
    case 'fadewhite': {
      const c = trans === 'fadewhite' ? ':color=white' : '';
      // On something carrying its own transparency the fade works on the ALPHA: fading to black
      // would paint a black rectangle over the shot rather than letting the insert dissolve.
      const al = alpha ? ':alpha=1' : '';
      return `,fade=in:st=0:d=${ds}${c}${al},fade=out:st=${sts}:d=${ds}${c}${al}`;
    }
    case 'flash-white': {
      const al = alpha ? ':alpha=1' : '';
      return `,fade=in:st=0:d=${ds}:color=white${al},fade=out:st=${sts}:d=${ds}:color=white${al}`;
    }
    case 'blur':
      return stackedRamp(d, st, 20, (v, t0, t1) =>
        `,gblur=sigma=${v.toFixed(2)}:enable='between(t\\,${t0}\\,${t1})'`);
    // A whip is motion blur along one axis: heavy one way, barely anything the other.
    case 'whip-pan-h':
      return stackedRamp(d, st, 30, (v, t0, t1) =>
        `,gblur=sigma=${v.toFixed(2)}:sigmaV=5:enable='between(t\\,${t0}\\,${t1})'`);
    case 'whip-pan-v':
      return stackedRamp(d, st, 30, (v, t0, t1) =>
        `,gblur=sigma=5:sigmaV=${v.toFixed(2)}:enable='between(t\\,${t0}\\,${t1})'`);
    case 'zoom-punch-in':
    case 'zoom-punch-out': {
      // zoompan counts FRAMES - it has `on` and no `t` - so the seconds are converted.
      const zf = 1.2, dF = Math.max(1, Math.round(d * FPS)), stF = Math.max(0, Math.round(st * FPS));
      const z = trans === 'zoom-punch-in'
        ? `if(lt(on\\,${dF})\\,${zf.toFixed(3)}-(${zf.toFixed(3)}-1)*on/${dF}\\,1)`
        : `if(gt(on\\,${stF})\\,1+(${zf.toFixed(3)}-1)*(on-${stF})/${dF}\\,1)`;
      return `,zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${2 * w}x${2 * h}:fps=${FPS},` +
             `scale=${w}:${h}:flags=lanczos,format=yuv420p,setsar=1`;
    }
    case 'glitch':
      return stackedRamp(d, st, 38, (v, t0, t1) =>
        `,noise=alls=${Math.round(v)}:allf=t+u:enable='between(t\\,${t0}\\,${t1})'`);
    default:
      return '';
  }
}

const named = (v) => (v && v !== 'none' ? String(v) : '');

/**
 * Turn a blank project's timeline into an ffmpeg graph.
 * @param opts.assPath  a written .ass file to burn over the picture, or nothing
 * Returns { w, h, dur, inputs, filter, map } - inputs in the order ffmpeg must be given them.
 */
function buildGraph(timeline, opts) {
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
      const placed = isPlaced(c);
      const angle = placed ? (+c.angle || 0) : 0;
      const soft = placed ? featherChain(c.feather) : '';
      // Anything with a transparent edge has to be carried in a format that HAS one, and
      // blended by an overlay told to pick one. Written into yuv420p the ramp is thrown away
      // silently, and the insert comes back with the hard edge it was given a feather to lose.
      const alpha = !!(soft || angle);
      // THE EFFECTS GO BEFORE THE CLIP IS PLACED. Every one of them is written against the
      // clip's own clock - a fade at 0, a zoom counted in frames from the start - and the
      // shift at the end of this chain moves that clock to where the clip sits on the
      // timeline. Applied after it, a fade-in would happen at the start of the FILM instead
      // of the start of the clip.
      // zoompan re-bakes its output to the frame size, which would throw a placed insert back
      // to full screen - so the two zooms are not offered to one. The grade and the fades are
      // fine at any size, and a fade over something with an edge fades the EDGE too.
      const anim  = placed ? '' : animChain(named(c.animation), +c.dur || 0, w, h);
      const grade = gradeChain(named(c.filter));
      const trans = transChain(named(c.transition), +c.dur || 0, w, h, placed, alpha);
      // Only when something needs it: fps normalises the frame timing the effects count in,
      // and a clip with no effects is left exactly as it rendered before they existed.
      const fx = (anim || grade || trans) ? `fps=${FPS},` : '';
      // Reverse before the timing, so what follows places an already-reversed clip at its
      // moment. Never on a still: there is one frame, and reversing it would buffer thirty
      // copies of it a second to arrive back where it started.
      // A PLACED insert is scaled to its own width and keeps its shape; only a full-frame clip
      // is fitted or filled against the frame.
      const pw = placed ? Math.max(2, Math.round(w * Math.max(0.02, Math.min(4, +c.tw)) / 2) * 2) : 0;
      const geom = placed
        ? `scale=${pw}:-2:force_divisible_by=2,setsar=1`
        : fitChain(c, w, h);

      parts.push(
        `[${idx}:v]` +
        (alpha ? 'format=yuva420p,' : '') +
        `${geom},` +
        (!still && c.reversed ? 'reverse,' : '') +
        (speed !== 1 ? `setpts=${r6(1 / speed)}*PTS,` : '') +
        (soft ? soft + ',' : '') +
        // The turn comes after the feather, which is measured against the insert's own edges,
        // and it grows the box to a square big enough for any angle - c=none fills the corners
        // with nothing rather than with black.
        (angle ? `rotate=${r6(angle * Math.PI / 180)}:c=none:ow='hypot(iw\,ih)':oh='hypot(iw\,ih)',` : '') +
        fx + (anim ? anim + ',' : '') + (grade ? grade + ',' : '') +
        // trans already carries its leading comma, and lands last: a fade has to be the final
        // word on a frame or the grade after it would lift the black back out again.
        (trans ? trans.slice(1) + ',' : '') +
        `setpts=PTS-STARTPTS+${r6(c.start)}/TB[${tag}]`
      );
      // Positioned by its MIDDLE, in overlay's own w and h - which is what makes the turn above
      // free: whatever size the rotation made the box, its centre lands where it was put.
      const at = placed
        ? `x='${Math.round(w * Math.max(0, Math.min(1, +c.tx || 0.5)))}-w/2':` +
          `y='${Math.round(h * Math.max(0, Math.min(1, +c.ty || 0.5)))}-h/2'`
        : 'x=0:y=0';
      parts.push(
        `[${last}][${tag}]overlay=${at}:enable='between(t,${r6(c.start)},${r6((+c.start) + (+c.dur))})'` +
        (alpha ? ':format=auto' : '') + `[o${n}]`
      );
      last = `o${n}`;
    }
  }

  // CAPTIONS LAST, over every layer. They are not a layer themselves - nothing is ever laid
  // on top of the words - so they are burnt onto the finished picture rather than overlaid at
  // a moment, which is also why the file needs no `enable`: each line carries its own times.
  const assPath = opts && opts.assPath;
  if (assPath) {
    parts.push(`[${last}]ass=filename='${escapeFilterPath(assPath)}'[vsub]`);
    last = 'vsub';
  }

  // Sound. Each audible clip is delayed to its place and mixed; the mix is normalised off,
  // because amix would otherwise quieten every clip as more are added and a level set by hand
  // would stop meaning what it says.
  const aTags = [];
  for (const { clip, gain } of audibleClips(timeline)) {
    // HOW MUCH OF THE SOURCE A SPED-UP CLIP EATS. The input used to be cut to the clip's
    // length on the timeline, which is its length AFTER the speed - so a 2x clip ran out of
    // sound half way along while its picture played on. The picture had this arithmetic from
    // the start; the sound did not, and a pair that drifts apart is the whole cost of it.
    const sp = Math.max(0.25, Math.min(4, +clip.speed || 1));
    const srcLen = r2((+clip.dur || 0) * sp);
    const idx = inputs.length;
    inputs.push({ file: clip.src, ss: r2(clip.trimIn || 0), t: srcLen });
    const tag = `a${aTags.length}`;
    const ms = Math.round((+clip.start) * 1000);
    // The delay comes after the tempo, because it is a position on the finished timeline and
    // the tempo is what decides how long the clip is by then.
    parts.push(
      `[${idx}:a]atrim=0:${r6(srcLen)},asetpts=PTS-STARTPTS,` +
      (clip.reversed ? 'areverse,' : '') +
      atempoChain(sp).map(x => x + ',').join('') +
      `adelay=${ms}|${ms},` +
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

module.exports = { buildGraph, frame, videoLanes, audioLanes, audibleClips, duration,
                   fitChain, atempoChain, animChain, gradeChain, transChain,
                   featherChain, isPlaced };
