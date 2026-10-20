'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the render of a project.

   A project has a variable number of lanes, made and destroyed by hand, and their order is a
   property of the project. The talking-head editor's renderer, which read six named lanes, went
   with that editor (docs/local-app/PLAN.md, phase 3); its effects and its halfer band were
   ported here first, value for value.

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
const { CAPTION_FONTS_DIR } = require('./config');
const FRAMING = require('../public/js/framing/path.js');

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

// (phase V23) How long a sound fades in and out - its own fades and (phase V28.4) the crossing of two tracks of music
// that overlap on a lane: ONE rule, the preview's too (public/js/sound/fades.js, an ES module required here).
const { fadesOf } = require('../public/js/sound/fades.js');

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
//
// THE BARS OF A FITTED CLIP ARE SEE-THROUGH when something is under it (`clear`), as on the
// preview, which draws the picture alone and lets the layer beneath show around it. They were
// black here, which covered the film under a wide picture in the file and nowhere else.
function fitChain(c, w, h, clear) {
  if (String(c.fit || 'fit') !== 'fill') {
    return `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
           `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black${clear ? '@0' : ''}`;
  }
  // Both axes are given and only one of them can do anything: after scaling to cover, the
  // frame matches the source on one side exactly, so that side's offset works out to zero
  // whatever was chosen. One list of five answers, no way to pick a contradiction.
  const a = String(c.cropAlign || 'center');
  const x = a === 'left' ? '0' : a === 'right' ? '(iw-ow)' : '(iw-ow)/2';
  const y = a === 'top' ? '0' : a === 'bottom' ? '(ih-oh)' : '(ih-oh)/2';
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:${x}:${y}`;
}

// ── A filled clip that FOLLOWS (phase V33.2) ─────────────────────────────────
// The clip's `frame` - its window over the FILE's time, worked out from its faces - read the way the preview reads it:
// public/js/framing/path.js is the one answer, its windowAt() for the screen and its expressions here. The window is
// cut out of the film FIRST, in the film's own pixels (crop with an expression of the time - `t` counts from the clip's
// trimIn, so the file's second is t+trimIn), and only then scaled to the frame: cheaper than scaling the whole film up
// to cover the frame and cutting it after, and the same picture.
// A clip with more than one kind of shot - a face here, no face there ((х7) Б: the whole frame by its width over a
// blurred copy of itself), two bands (х9) - has a branch for each, and the shots switch between them by time.
// Returns { parts, out } - the graph's lines and the label the rest of the clip's chain starts from - or null when the
// clip is framed the plain way (no record, or a film no wider than the frame).
const isFramedClip = (c, w, h) => !!(c && String(c.fit || 'fit') === 'fill' && !isPlaced(c) && FRAMING.isFramed(c.frame)
  && c.frame.src && FRAMING.windowW(+c.frame.src.w, +c.frame.src.h, w / h) < 0.999);

function framedChain(c, input, n, w, h) {
  if (!isFramedClip(c, w, h)) return null;
  const fr = c.frame;
  const sw = +fr.src.w, sh = +fr.src.h;
  const T = `(t+${r6(+c.trimIn || 0)})`;
  const kinds = FRAMING.kindsOf(fr);
  const parts = [];
  const tag = (k) => `fm${n}${k}`;
  const outs = [];
  parts.push(`[${input}]` + (kinds.length > 1 ? `split=${kinds.length}` + kinds.map((k) => `[${tag(k)}i]`).join('') : `null[${tag(kinds[0])}i]`));
  for (const k of kinds) {
    const i = `${tag(k)}i`, o = `${tag(k)}o`;
    if (k === 'face') {
      const x = FRAMING.exprFace(fr, T, sw, sh, w / h);
      parts.push(`[${i}]crop=w='trunc(ih*${w}/${h}/2)*2':h=ih:x='clip((${x})*iw-ow/2,0,iw-ow)':y=0,scale=${w}:${h},setsar=1[${o}]`);
    } else if (k === 'whole') {
      const qw = Math.max(2, Math.round(w / 8) * 2), qh = Math.max(2, Math.round(h / 8) * 2);
      parts.push(`[${i}]split[${o}a][${o}b]`);
      parts.push(`[${o}a]scale=${qw}:${qh}:force_original_aspect_ratio=increase,crop=${qw}:${qh},boxblur=10:2,scale=${w}:${h},setsar=1[${o}bg]`);
      parts.push(`[${o}b]scale=${w}:-2,setsar=1[${o}fg]`);
      parts.push(`[${o}bg][${o}fg]overlay=0:(H-h)/2[${o}]`);
    } else if (k === 'bands') {
      const b1 = FRAMING.exprBand(fr, 1, T, sw, sh, w / h), b2 = FRAMING.exprBand(fr, 2, T, sw, sh, w / h);
      const half = Math.max(2, Math.round(h / 4) * 2);
      const crop = (b) => `crop=w='trunc(ih*${r6(b.bh)}*${2 * w}/${h}/2)*2':h='trunc(ih*${r6(b.bh)}/2)*2'` +
        `:x='clip((${b.x})*iw-ow/2,0,iw-ow)':y='clip((${b.y})*ih-oh/2,0,ih-oh)'`;
      parts.push(`[${i}]split[${o}1][${o}2]`);
      parts.push(`[${o}1]${crop(b1)},scale=${w}:${half},setsar=1[${o}t]`);
      parts.push(`[${o}2]${crop(b2)},scale=${w}:${h - half},setsar=1[${o}d]`);
      parts.push(`[${o}t][${o}d]vstack=2[${o}]`);
    }
    outs.push([k, o]);
  }
  // The first kind is the base; each other one is laid over it while its shots run.
  let last = outs[0][1];
  for (const [k, o] of outs.slice(1)) {
    const on = FRAMING.spansOfKind(fr, k).map(([a, b]) => `between(${T},${r6(a)},${r6(b)})`).join('+') || '0';
    parts.push(`[${last}][${o}]overlay=0:0:enable='${on}'[${tag(k)}m]`);
    last = `${tag(k)}m`;
  }
  return { parts, out: last };
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

// ── A halfer band ───────────────────────────────────────────────────────────
// A strip across the whole width of the frame instead of a picture on it: the source turned a
// quarter at a time, scaled to cover the strip, and the slice `halferKeep` names kept. The numbers
// and their defaults are the talking-head editor's Halfers lane, so a band
// brought over from there renders as it did:
//   halferThick  how tall, as a share of the frame (5-100, 40)
//   halferPos    where: 100 against the top edge, 0 against the bottom (100)
//   halferKeep   which slice survives the crop: 100 is the top at 0 and 180, the right at 90
//                and 270 (100)
//   rotation     0 / 90 / 180 / 270, clockwise (90 - a portrait source lies across the strip)
//   feather      the fade on the edges facing INTO the frame, as a share of the band (0.03)
// A band has no placement, framing or effects: it is always the full width, and the other
// editor's renderer never applied effects to one. THE THIRD THING THIS MUST AGREE WITH
// preview-b.js ABOUT - its _drawBand() reads every one of these the same way.
const isBand = (c) => !!(c && c.halfer);

const _pct = (v, dflt, lo = 0) => {
  const n = Number(v);
  return (v != null && Number.isFinite(n)) ? Math.max(lo, Math.min(100, n)) : dflt;
};

function bandGeom(c, w, h) {
  // Even: yuv420 and overlay both dislike an odd height.
  let band = Math.round(h * _pct(c.halferThick, 40, 5) / 100);
  if (band % 2) band++;
  band = Math.max(2, Math.min(h, band));
  const y = Math.round((h - band) * (1 - _pct(c.halferPos, 100) / 100));
  const keep = _pct(c.halferKeep, 100) / 100;
  const rot = [0, 90, 180, 270].includes(+c.rotation) && c.rotation != null ? +c.rotation : 90;
  // Null is the default softness and 0 is hard - the panel writes a number even at zero.
  const soft = (c.feather == null || !Number.isFinite(+c.feather)) ? 0.03 : Math.max(0, Math.min(0.4, +c.feather));
  const fade = soft > 0 ? Math.max(1, Math.round(band * soft)) : 0;
  // Only the edges that face into the picture: one while the band is parked against an edge,
  // both while it floats.
  return { band, y, keep, rot, fade, softTop: fade > 0 && y > 0, softBot: fade > 0 && y + band < h };
}

// The turn first, so a portrait source lies across the strip; then cover, keeping its shape;
// then the slice. Which way the slice slides depends on the turn - at 0 and 180 the spare is
// above and below, at 90 and 270 it is to the sides. rgba from end to end: the fade IS alpha.
function bandChain(b, w) {
  const turn = b.rot === 90 ? 'transpose=1,' : b.rot === 270 ? 'transpose=2,'
             : b.rot === 180 ? 'transpose=2,transpose=2,' : '';
  const off = (b.rot === 0 || b.rot === 180)
    ? `0:(ih-${b.band})*${(1 - b.keep).toFixed(4)}`
    : `(iw-${w})*${b.keep.toFixed(4)}:0`;
  const dTop = 'Y', dBot = `(${b.band - 1}-Y)`;
  const dist = b.softTop && b.softBot ? `min(${dTop},${dBot})` : b.softTop ? dTop : b.softBot ? dBot : '';
  return 'format=rgba,' + turn +
    `scale=${w}:${b.band}:force_original_aspect_ratio=increase,crop=${w}:${b.band}:${off},setsar=1` +
    (dist ? `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='min(255,255*${dist}/${b.fade})'` : '');
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
// Ported from the talking-head editor's renderer, value for value - `fade`, `zoom_in`, `vhs`
// and the rest are the names the inspector offers (js/merge-v3/controls.js).
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
//
// `alpha`: the clip carries transparency (a soft edge, a turn, the see-through bars of a fitted
// clip), and the chain has to stay in a format that has it - written into yuv420p it is thrown
// away silently and the edge comes back hard. Every effect filter here keeps an alpha plane
// through yuva420p except vignette, which is given it back (gradeChain).
const _fmtOf = (alpha) => (alpha ? 'yuva420p' : 'yuv420p');

function animChain(anim, dur, w, h, alpha) {
  if (anim !== 'zoom_in' && anim !== 'zoom_out') return '';
  const frames = Math.max(1, Math.ceil(dur * FPS));
  const max = 1.15;
  const P = `(on/${frames})`;
  const z = anim === 'zoom_in' ? `1+(${max.toFixed(4)}-1)*${P}` : `${max.toFixed(4)}-(${max.toFixed(4)}-1)*${P}`;
  return `zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${2 * w}x${2 * h}:fps=${FPS},` +
         `scale=${w}:${h}:flags=lanczos,format=${_fmtOf(alpha)},setsar=1`;
}

// Colour and texture, no motion. Every one of these is a look applied to the whole clip.
// `tag` names the side branch vignette needs on a clip with transparency: vignette drops the alpha
// plane, so the plane is split off first and merged back after it. Both branches are pinned to
// yuva420p at the split and converted after it - left to negotiate, the split settled on the
// format vignette wanted and the alpha branch was handed a picture with no alpha in it.
function gradeChain(filt, alpha, tag) {
  const POST = `,format=${_fmtOf(alpha)},setsar=1`;
  switch (filt) {
    case 'vignette':
      if (alpha && tag) {
        return `split=2[${tag}c][${tag}a];[${tag}a]format=yuva420p,alphaextract[${tag}l];` +
               `[${tag}c]format=yuva420p,scale=iw:ih,format=yuv420p,vignette=angle=0.780:aspect=1.000,format=yuv420p[${tag}g];` +
               `[${tag}g][${tag}l]alphamerge${POST}`;
      }
      return `vignette=angle=0.780:aspect=1.000${POST}`;
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
//
// `alpha`: a placed insert with transparency - a fade dissolves it rather than painting black over
// it. `clear`: the see-through bars of a fitted clip - a fade darkens the picture and leaves the
// bars alone (the preview's veil covers the picture's rectangle), but the format has to keep them.
function transChain(trans, dur, w, h, placed, alpha, clear) {
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
             `scale=${w}:${h}:flags=lanczos,format=${_fmtOf(alpha || clear)},setsar=1`;
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
 * @param opts.eq       { brightness, contrast, saturation, gamma } - a colour correction over the
 *                      whole picture, before the captions (lib/render-finish.js settingsOf)
 * @param opts.out      { w, h } - the size the file is written at, when it is smaller than the frame
 * @param opts.fps      the frame rate of the black bed the layers are laid onto
 * @param opts.noise    { color, volume } - a quiet noise under the whole mix
 * @param opts.silent   sources known to have no sound (lib/mv3b-job.js asks the files): a clip
 *                      of one is left out of the mix, because ffmpeg refuses a graph that
 *                      names an audio stream a file does not have
 * Returns { w, h, dur, inputs, filter, map } - inputs in the order ffmpeg must be given them; an
 * input is a file ({ file, ss, t, loop }) or something ffmpeg makes ({ lavfi, t }). There is always
 * a sound: silence when nothing is heard, so every render joins a black tail the same way.
 */
function buildGraph(timeline, opts) {
  const { w, h } = frame(timeline);
  const dur = duration(timeline);
  const inputs = [];
  const parts = [];

  // The bed everything is laid onto: one black frame of the project's shape, held for the
  // whole length. Built rather than taken from a clip, so a timeline with a gap at the start
  // - or no picture at all - still renders something of the right size instead of failing.
  const bedFps = [24, 25, 30, 50, 60].includes(+(opts && opts.fps)) ? +opts.fps : 30;
  parts.push(`color=c=black:s=${w}x${h}:d=${r6(dur)}:r=${bedFps}[bg]`);
  let last = 'bg';

  let n = 0;
  // Every clip painted so far, as a stretch of time - what a fitted clip's bars would cover.
  const painted = [];
  const under = (c) => painted.some(p => p.s < (+c.start) + (+c.dur) - 1e-6 && p.e > (+c.start) + 1e-6);
  for (const lane of videoLanes(timeline)) {
    for (const c of (lane.clips || [])) {
      const still = isStill(c.src);
      const idx = inputs.length;
      inputs.push(still
        ? { file: c.src, loop: true, t: r2(c.dur) }
        : { file: c.src, ss: r2(c.trimIn || 0), t: r2((c.dur || 0) * (c.speed || 1)) });

      const speed = +c.speed || 1;
      const tag = `v${n++}`;
      const covers = under(c);
      painted.push({ s: +c.start, e: (+c.start) + (+c.dur) });
      if (isBand(c)) {
        const b = bandGeom(c, w, h);
        parts.push(
          `[${idx}:v]` +
          (!still && c.reversed ? 'reverse,' : '') +
          (speed !== 1 ? `setpts=${r6(1 / speed)}*PTS,` : '') +
          bandChain(b, w) + ',' +
          `setpts=PTS-STARTPTS+${r6(c.start)}/TB[${tag}]`
        );
        parts.push(
          `[${last}][${tag}]overlay=x=0:y=${b.y}:enable='between(t,${r6(c.start)},${r6((+c.start) + (+c.dur))})'` +
          `:format=auto[o${n}]`
        );
        last = `o${n}`;
        continue;
      }
      const placed = isPlaced(c);
      const angle = placed ? (+c.angle || 0) : 0;
      const soft = placed ? featherChain(c.feather) : '';
      // See-through bars on a fitted clip, but only over something: over the black bed they would
      // be black anyway, and the plain path is the faster one.
      const clear = !placed && String(c.fit || 'fit') !== 'fill' && covers;
      // Anything with a transparent edge has to be carried in a format that HAS one, and
      // blended by an overlay told to pick one. Written into yuv420p the ramp is thrown away
      // silently, and the insert comes back with the hard edge it was given a feather to lose.
      const alpha = !!(soft || angle || clear);
      // THE EFFECTS GO BEFORE THE CLIP IS PLACED. Every one of them is written against the
      // clip's own clock - a fade at 0, a zoom counted in frames from the start - and the
      // shift at the end of this chain moves that clock to where the clip sits on the
      // timeline. Applied after it, a fade-in would happen at the start of the FILM instead
      // of the start of the clip.
      // zoompan re-bakes its output to the frame size, which would throw a placed insert back
      // to full screen - so the two zooms are not offered to one. The grade and the fades are
      // fine at any size, and a fade over something with an edge fades the EDGE too.
      const anim  = placed ? '' : animChain(named(c.animation), +c.dur || 0, w, h, alpha);
      const grade = gradeChain(named(c.filter), alpha, `g${n}`);
      const trans = transChain(named(c.transition), +c.dur || 0, w, h, placed, !!(soft || angle), clear);
      // Only when something needs it: fps normalises the frame timing the effects count in,
      // and a clip with no effects is left exactly as it rendered before they existed.
      const fx = (anim || grade || trans) ? `fps=${FPS},` : '';
      // Reverse before the timing, so what follows places an already-reversed clip at its
      // moment. Never on a still: there is one frame, and reversing it would buffer thirty
      // copies of it a second to arrive back where it started.
      // A PLACED insert is scaled to its own width and keeps its shape; only a full-frame clip
      // is fitted or filled against the frame.
      const pw = placed ? Math.max(2, Math.round(w * Math.max(0.02, Math.min(4, +c.tw)) / 2) * 2) : 0;
      // (phase V33.2) A filled clip that follows its faces is framed by its own little graph first.
      const framed = placed ? null : framedChain(c, `${idx}:v`, n, w, h);
      if (framed) parts.push(...framed.parts);
      const geom = placed
        ? `scale=${pw}:-2:force_divisible_by=2,setsar=1`
        : framed ? 'setsar=1' : fitChain(c, w, h, clear);

      parts.push(
        `[${framed ? framed.out : idx + ':v'}]` +
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
      // Zero is a place - the middle on the frame's edge - and not "no place": `|| 0.5` sent an insert
      // dragged hard against the left or top edge back to the centre of the file.
      const at = placed
        ? `x='${Math.round(w * Math.max(0, Math.min(1, c.tx == null ? 0.5 : +c.tx)))}-w/2':` +
          `y='${Math.round(h * Math.max(0, Math.min(1, c.ty == null ? 0.5 : +c.ty)))}-h/2'`
        : 'x=0:y=0';
      parts.push(
        `[${last}][${tag}]overlay=${at}:enable='between(t,${r6(c.start)},${r6((+c.start) + (+c.dur))})'` +
        (alpha ? ':format=auto' : '') + `[o${n}]`
      );
      last = `o${n}`;
    }
  }

  // THE COLOUR CORRECTION, over the whole picture and under the captions: the words keep the
  // colours they were given. Where the talking-head render put it, too.
  const eq = opts && opts.eq;
  if (eq) {
    parts.push(`[${last}]eq=brightness=${(+eq.brightness).toFixed(3)}:contrast=${(+eq.contrast).toFixed(3)}` +
               `:saturation=${(+eq.saturation).toFixed(3)}:gamma=${(+eq.gamma).toFixed(3)}[veq]`);
    last = 'veq';
  }

  // CAPTIONS LAST, over every layer. They are not a layer themselves - nothing is ever laid
  // on top of the words - so they are burnt onto the finished picture rather than overlaid at
  // a moment, which is also why the file needs no `enable`: each line carries its own times.
  const assPath = opts && opts.assPath;
  if (assPath) {
    // The shipped fonts (phase K5): libass draws in them rather than in whatever Windows has.
    parts.push(`[${last}]ass=filename=${escapeFilterPath(assPath)}:fontsdir=${escapeFilterPath(CAPTION_FONTS_DIR)}[vsub]`);
    last = 'vsub';
  }

  // A SMALLER FILE, scaled last - after the captions, which are laid out for the frame.
  const out = opts && opts.out;
  if (out && (out.w !== w || out.h !== h)) {
    parts.push(`[${last}]scale=${out.w}:${out.h}:flags=lanczos,setsar=1[vout]`);
    last = 'vout';
  }

  // Sound. Each audible clip is delayed to its place and mixed; the mix is normalised off,
  // because amix would otherwise quieten every clip as more are added and a level set by hand
  // would stop meaning what it says.
  const aTags = [];
  const silent = (opts && opts.silent) || null;
  const FADES = fadesOf(timeline);
  for (const { clip, gain } of audibleClips(timeline)) {
    if (silent && silent.has(clip.src)) continue;
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
    // (phase V23) A sound's own fades, in seconds of the timeline - the two variants of one Suno generation cross into
    // each other this way. After the tempo, so they are counted on the clip as it plays; the preview ramps the same.
    const fd = FADES.get(String(clip.id)) || { in: 0, out: 0 };
    // The delay comes after the tempo, because it is a position on the finished timeline and
    // the tempo is what decides how long the clip is by then.
    parts.push(
      `[${idx}:a]atrim=0:${r6(srcLen)},asetpts=PTS-STARTPTS,` +
      (clip.reversed ? 'areverse,' : '') +
      atempoChain(sp).map(x => x + ',').join('') +
      (fd.in > 0 ? `afade=t=in:st=0:d=${r6(fd.in)},` : '') +
      (fd.out > 0 ? `afade=t=out:st=${r6(Math.max(0, (+clip.dur || 0) - fd.out))}:d=${r6(fd.out)},` : '') +
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
  // Nothing to hear is still a sound: silence, as long as the film.
  if (!amap) {
    const idx = inputs.length;
    inputs.push({ lavfi: 'anullsrc=channel_layout=stereo:sample_rate=44100', t: dur });
    parts.push(`[${idx}:a]anull[asil]`);
    amap = 'asil';
  }
  // THE NOISE, under everything and as long as the film - the mix ends with its first input.
  const noise = opts && opts.noise;
  if (noise && ['white', 'pink', 'brown'].includes(noise.color) && +noise.volume > 0) {
    const idx = inputs.length;
    inputs.push({ lavfi: `anoisesrc=c=${noise.color}:r=44100:a=1`, t: dur });
    parts.push(`[${idx}:a]volume=${r6(Math.min(0.05, +noise.volume))},aformat=channel_layouts=stereo[noise]`);
    parts.push(`[${amap}][noise]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[anoise]`);
    amap = 'anoise';
  }

  return { w, h, dur, inputs, filter: parts.join(';'), map: { v: last, a: amap } };
}

module.exports = { buildGraph, frame, videoLanes, audioLanes, audibleClips, duration,
                   fitChain, atempoChain, animChain, gradeChain, transChain,
                   featherChain, isPlaced, isBand, bandGeom, bandChain, framedChain, isFramedClip };
