/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — subtitles: drawn on the preview, dragged like a picture-in-picture,
   highlighted word by word.

   A subtitle is a CLIP on the `subs` track with no video: its text lives in `name`,
   like every other clip's caption, and its per-word timings live in `words` relative
   to its own start. Relative, so dragging a caption along the lane keeps the karaoke
   in step.

   POSITION IS TWO NUMBERS ADDED TOGETHER. The track's style carries a base offset and
   each caption carries its own on top:

       effective = style.tx/ty  +  clip.tx/ty

   That is what makes "select the track, drag, they all move" and "select one, drag,
   only it moves" the same gesture over two different values - and why moving the track
   also moves captions that have been placed by hand, instead of leaving them behind.

   The word timings come from Groq Whisper through /api/stt/timeline, which returns them
   ALREADY in final-timeline coordinates - the fragments are concatenated in timeline
   order server-side before transcription. So generation is: send the Main track, get
   words back, group them into captions. No proportional guessing from line lengths;
   these are the times the words were actually said.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as C from './controls.js';

const DEFAULT_STYLE = {
  font: 'Arial', size: 60, bold: true, italic: false,
  primary: '#ffffff', secondary: '#8a9099',
  outlineColor: '#000000', shadowColor: '#000000',
  backColor: '#000000', backAlpha: 0,
  outline: 3, shadow: 0, blur: 0,
  borderStyle: 'outline', pos: 'bottom',
  tx: 0, ty: 0, wrap: true, wordsPerLine: 0, karaoke: false,
  // Per-axis letter scale, in percent, independent of `size`. 100 is the font as drawn.
  // Stretching one axis alone is a thing type does not otherwise offer: a taller letter
  // at the same width reads as emphasis, and at the same height a wider one reads as calm.
  scaleX: 100, scaleY: 100,
};

export function style() {
  const tl = Store.timeline();
  const s = (tl && _subs(tl) && _subs(tl).style) || {};
  return { ...DEFAULT_STYLE, ...s };
}

// The subtitle track, whichever shape the open project has. A talking-head timeline keys its
// tracks by name; a blank one carries an ordered LIST, because its tracks are created and
// deleted by hand. Every site below goes through here, so this file never has to know which
// kind of project it is looking at - reaching for tracks.subs on a blank one threw on every
// preview frame, which is how this came to exist.
const _subs = (tl) => (!tl ? null : (Array.isArray(tl.tracks)
  ? (tl.tracks.find(t => t && t.kind === 'subs') || null)
  : (tl.tracks.subs || null)));

// Which caption is on screen at time t.
export function activeAt(t) {
  const tl = Store.timeline();
  if (!tl) return null;
  const st = _subs(tl);
  if (!st) return null;
  for (const c of (st.clips || [])) {
    if (t >= c.start && t < c.start + c.dur) return c;
  }
  return null;
}

// ── Layout ──────────────────────────────────────────────────────────────────
// Measured against the canvas, so it is the same arithmetic at every preview
// resolution: sizes are fractions of the frame height, never raw pixels.
function _font(st, cw) {
  const px = Math.max(8, Math.round(st.size / 1920 * (cw * 16 / 9)));
  return { px, css: (st.italic ? 'italic ' : '') + (st.bold ? '700 ' : '400 ') + px + 'px ' + st.font + ', Arial, sans-serif' };
}

// Percent in the style, a plain multiplier everywhere else. Bounded here rather than trusted:
// a project written by an older build has no scale at all, and 0 would erase the captions.
const _scale = (v) => Math.max(25, Math.min(400, Math.round(+v || 100))) / 100;
const _sx = (st) => _scale(st.scaleX);
const _sy = (st) => _scale(st.scaleY);

// Wrap into lines that fit, and keep each word's x so karaoke can colour them one at a
// time without measuring twice.
// THE WORDS OF A CAPTION, and the only place that decides what they are.
//
// The TEXT always comes from `name`; `words` supplies nothing but the clock. It used to be
// the other way round - the painter read words[].w and fell back to name only when there
// were none - and since every caption ever generated has word timings, that fallback never
// ran. Editing the text changed `name` and the screen went on showing the old words, while
// the export wrote the new ones. Measured: a caption re-typed three times kept a layout
// exactly 216px wide, to the pixel.
//
// With the split this way round the two cannot disagree again: whatever is typed is what is
// laid out, and a word with no timing beside it is simply a word with no timing - which the
// karaoke pass already treats as "sung", the same as a caption that never had any.
export function wordsOf(c) {
  const tokens = String((c && c.name) || '').split(/\s+/).filter(Boolean);
  const tw = (c && c.words) || [];
  return tokens.map((text, i) => ({
    text,
    s: tw[i] ? +tw[i].s : null,
    e: tw[i] ? +tw[i].e : null,
  }));
}

// Carry a caption's timings onto new text.
//
// A TYPO FIX DOES NOT CHANGE THE WORD COUNT - "превет" for "привет" is still one word - so in
// the case this exists for, every word keeps its own timing exactly and karaoke stays in step
// with the voice. Nothing is approximated.
//
// When the count does change the timings cannot be carried by position: delete a word in the
// middle and every word after it would inherit its neighbour's moment, drifting the whole
// tail. So the caption is re-timed as a whole - its span shared out in proportion to word
// length, which is rough but never absurd.
function _retime(c, text) {
  const next = String(text || '').split(/\s+/).filter(Boolean);
  const old = (c && c.words) || [];
  if (!next.length) return [];
  if (old.length === next.length) {
    return next.map((w, i) => ({ w, s: +old[i].s || 0, e: +old[i].e || 0 }));
  }
  const span = +c.dur || 0;
  const total = next.reduce((n, w) => n + w.length, 0) || 1;
  const r2 = (v) => Math.round(v * 100) / 100;
  let at = 0;
  return next.map((w) => {
    const d = span * (w.length / total);
    const one = { w, s: r2(at), e: r2(at + d) };
    at += d;
    return one;
  });
}

function _layout(ctx, c, st, cw, ch) {
  const f = _font(st, cw);
  ctx.font = f.css;
  const margin = Math.round(cw * 0.07);
  const maxW = cw - margin * 2;
  const words = wordsOf(c);

  // Every measured width is the drawn width: the glyphs go down through a scale, so the
  // layout has to be told about it or a stretched line centres by the size it used to be.
  const sx = _sx(st), sy = _sy(st);
  const spaceW = ctx.measureText(' ').width * sx;
  const lines = [];
  let cur = { items: [], w: 0 };
  for (const w of words) {
    const ww = ctx.measureText(w.text).width * sx;
    const add = cur.items.length ? spaceW + ww : ww;
    if (st.wrap && cur.items.length && cur.w + add > maxW) { lines.push(cur); cur = { items: [], w: 0 }; }
    cur.items.push({ ...w, w: ww });
    cur.w += cur.items.length === 1 ? ww : add;
  }
  if (cur.items.length) lines.push(cur);

  const lineH = Math.round(f.px * 1.22 * sy);
  const blockH = lines.length * lineH;
  // The anchor the offset is measured from, then the two offsets added.
  const base = st.pos === 'top' ? Math.round(ch * 0.07)
             : st.pos === 'center' ? Math.round((ch - blockH) / 2)
             : Math.round(ch - blockH - ch * 0.09);
  const dx = ((+st.tx || 0) + (+c.tx || 0)) * cw;
  const dy = ((+st.ty || 0) + (+c.ty || 0)) * ch;

  // Per-line x, and per-word x within it.
  let y = base + dy;
  for (const ln of lines) {
    ln.x = Math.round((cw - ln.w) / 2 + dx);
    ln.y = Math.round(y);
    let x = ln.x;
    for (const it of ln.items) { it.x = x; x += it.w + spaceW; }
    y += lineH;
  }
  return { f, lines, lineH, blockH, margin,
           box: { x: Math.min(...lines.map(l => l.x)), y: base + dy,
                  w: Math.max(...lines.map(l => l.w)), h: blockH } };
}

// ── Drawing ─────────────────────────────────────────────────────────────────
export function draw(ctx, cw, ch, t) {
  const c = activeAt(t);
  if (!c) return null;
  const st = style();
  const L = _layout(ctx, c, st, cw, ch);
  const local = t - c.start;

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = L.f.css;
  ctx.lineJoin = 'round';

  // One place that knows about the stretch. The whole drawing goes through the scale, not
  // just the fill, so the outline and the shadow stretch with the letters - which is what
  // libass does with ScaleX/ScaleY, and the preview has to agree with the burn.
  const sx = _sx(st), sy = _sy(st);
  const put = (how, text, x, y) => {
    if (sx === 1 && sy === 1) { ctx[how](text, x, y); return; }
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy); ctx[how](text, 0, 0); ctx.restore();
  };

  if (st.borderStyle === 'box' && st.backAlpha > 0) {
    ctx.globalAlpha = st.backAlpha;
    ctx.fillStyle = st.backColor;
    const pad = Math.round(L.f.px * 0.28);
    for (const ln of L.lines) ctx.fillRect(ln.x - pad, ln.y - pad * 0.5, ln.w + pad * 2, L.lineH);
    ctx.globalAlpha = 1;
  }

  for (const ln of L.lines) {
    for (const it of ln.items) {
      // Karaoke: a word is "sung" once the clock has passed its start. With no word
      // timings there is nothing to time against, so everything is sung - a caption with
      // no timings is a plain caption, not a broken one.
      const sung = !st.karaoke || it.s == null || local >= it.s;
      if (st.shadow > 0) {
        ctx.fillStyle = st.shadowColor;
        const d = Math.round(st.shadow / 1920 * (cw * 16 / 9));
        put('fillText', it.text, it.x + d, ln.y + d);
      }
      if (st.outline > 0) {
        ctx.strokeStyle = st.outlineColor;
        ctx.lineWidth = Math.max(1, Math.round(st.outline / 1920 * (cw * 16 / 9)) * 2);
        put('strokeText', it.text, it.x, ln.y);
      }
      ctx.fillStyle = sung ? st.primary : st.secondary;
      put('fillText', it.text, it.x, ln.y);
    }
  }
  ctx.restore();
  return { clip: c, box: L.box };
}

// The box the caption occupies, for hit-testing and for the selection frame. Needs the
// same ctx the drawing uses, because it measures text.
export function boxAt(ctx, cw, ch, t) {
  const c = activeAt(t);
  if (!c) return null;
  const L = _layout(ctx, c, style(), cw, ch);
  return { clip: c, ...L.box };
}

// ── Burning into the render ─────────────────────────────────────────────────
// libass, not drawtext: drawtext cannot wrap a sentence, and ten chained instances of it
// left a band of overlapping text across the top of the frame. What goes over is the same
// arithmetic the preview draws with, expressed in the render's own coordinates - the .ass
// PlayRes is the output size, and the style's numbers are written against 1920 tall, so
// every size scales by H/1920.
//
// Position goes over as the block's CENTRE, per caption. \an5 centres the block on the
// point, so a caption libass happens to wrap onto two lines grows around the same middle
// instead of sliding off the frame.
let _mcv = null;
function _measureCtx(w, h) {
  if (!_mcv) _mcv = document.createElement('canvas');
  if (_mcv.width !== w || _mcv.height !== h) { _mcv.width = w; _mcv.height = h; }
  return _mcv.getContext('2d');
}

export function renderPayload(W, H) {
  const tl = Store.timeline();
  const clips = ((tl && _subs(tl) && _subs(tl).clips) || [])
    .filter(c => c.name && +c.dur > 0).slice().sort((a, b) => a.start - b.start);
  if (!clips.length) return { srtSubtitles: [], assSettings: {} };

  const st = style();
  const k = H / 1920;
  const ctx = _measureCtx(W, H);
  const r3 = (v) => Math.round(v * 1000) / 1000;

  const srtSubtitles = clips.map(c => {
    const L = _layout(ctx, c, st, W, H);
    return {
      text: String(c.name || ''),
      start: +c.start,
      end: +c.start + +c.dur,
      posX: r3((0.5 + (+st.tx || 0) + (+c.tx || 0)) * 100),
      posY: r3((L.box.y + L.box.h / 2) / H * 100),
      // Absolute times: the builder only uses each word's length, but absolute reads the
      // same as everything else in the payload.
      // Through wordsOf, so the karaoke sweep spells the caption the same way the screen
      // does. The ASS builder writes these word by word when karaoke is on, and reading the
      // stored array directly is how a stale word reached a finished file.
      words: wordsOf(c).filter(w => w.s != null).map(w => ({
        text: w.text, start: +c.start + (+w.s || 0), end: +c.start + (+w.e || 0),
      })),
    };
  });

  return {
    srtSubtitles,
    assSettings: {
      fontName: st.font,
      fontSize: Math.max(8, Math.round(st.size * k)),
      bold: !!st.bold, italic: !!st.italic,
      // Straight through as percent - the ASS style field speaks the same units.
      scaleX: Math.round(_sx(st) * 100), scaleY: Math.round(_sy(st) * 100),
      primaryColor: st.primary, secondaryColor: st.secondary,
      outlineColor: st.outlineColor, shadowColor: st.shadowColor,
      backColor: st.backColor,
      // ASS alpha runs the other way round: 0 is opaque, 255 is invisible.
      backAlpha: Math.round((1 - Math.max(0, Math.min(1, +st.backAlpha || 0))) * 255),
      borderStyle: st.borderStyle === 'box' ? 3 : 1,
      outline: +(st.outline * k).toFixed(1),
      shadow: +(st.shadow * k).toFixed(1),
      blur: +st.blur || 0,
      posAlign: 'mc',
      karaokeStyle: st.karaoke ? 'k' : 'none',
      // 0 turns OFF the builder's own re-grouping. These captions are the ones on the
      // timeline - generated, then hand-edited and dragged - and rebuilding them from raw
      // words would throw all of that away.
      wordsPerLine: 0,
      // The preview has no fade or wobble, so neither does the burn: a render that moves
      // differently from what was previewed is a render nobody asked for.
      appearPreset: 'none', animPreset: 'none', rotationPreset: 'none',
      wrapStyle: st.wrap ? 0 : 2,
    },
  };
}

// ── Moving ──────────────────────────────────────────────────────────────────
// One caption, or all of them. The caller decides which by what is selected; this only
// knows that both are an offset in fractions of the frame.
export function nudgeClip(id, dtx, dty) {
  Store.mutate(tl => {
    const c = (_subs(tl).clips || []).find(x => x.id === id);
    if (!c) return;
    c.tx = Math.max(-1, Math.min(1, (+c.tx || 0) + dtx));
    c.ty = Math.max(-1, Math.min(1, (+c.ty || 0) + dty));
  });
}
export function nudgeAll(dtx, dty) {
  Store.mutate(tl => {
    const s = _subs(tl).style || (_subs(tl).style = { ...DEFAULT_STYLE });
    s.tx = Math.max(-1, Math.min(1, (+s.tx || 0) + dtx));
    s.ty = Math.max(-1, Math.min(1, (+s.ty || 0) + dty));
  });
}

export function setStyle(patch) {
  Store.mutate(tl => {
    const t = _subs(tl);
    t.style = { ...DEFAULT_STYLE, ...(t.style || {}), ...patch };
  });
}
export function patchClip(id, patch) {
  Store.mutate(tl => {
    const c = (_subs(tl).clips || []).find(x => x.id === id);
    if (!c) return;
    // Changing the TEXT re-times the words with it. Not doing so left three different
    // answers to what a caption says: the screen drew the old words, an export with karaoke
    // on burnt the old words, and an export with karaoke off burnt the new text - the
    // difference decided by a style toggle nowhere near the edit.
    const retime = ('name' in patch) && String(patch.name || '') !== String(c.name || '');
    Object.assign(c, patch);
    if (retime) c.words = _retime(c, c.name);
  });
}
export function removeClip(id) {
  Store.mutate(tl => { _subs(tl).clips = (_subs(tl).clips || []).filter(c => c.id !== id); });
}

// ── Generation ──────────────────────────────────────────────────────────────
// The Main track goes to /api/stt/timeline in the shape it wants; the words come back in
// timeline coordinates; they are grouped into captions here.
//
// Grouping rule, in order of authority: never span a gap in speech, never exceed
// wordsPerLine when one is set, and otherwise break on sentence-ending punctuation or
// once a caption has run long enough to be replaced. Gaps first, because a caption that
// bridges a pause reads as though the speaker never stopped.
const MAX_CAP_SEC = 3.2;
const GAP_SEC = 0.45;

export function groupWords(words, perLine) {
  const caps = [];
  let cur = null;
  for (const w of words) {
    // THREE NAMES for the same thing. /api/stt/timeline returns `text`, Whisper's raw
    // response calls it `word`, and a caption already on the track stores `w`. Reading only
    // the last two is what made a real generation produce nothing at all: every word came
    // back as empty and was skipped, so 235 words became 0 captions.
    const text = String(w.text != null ? w.text : (w.word != null ? w.word : w.w) || '').trim();
    if (!text) continue;
    const s = +w.start, e = +w.end;
    if (!isFinite(s) || !isFinite(e)) continue;
    const gap = cur ? s - cur.end : 0;
    const tooLong = cur && (e - cur.start) > MAX_CAP_SEC;
    const full = cur && perLine > 0 && cur.items.length >= perLine;
    const ended = cur && /[.!?…]$/.test(cur.items[cur.items.length - 1].text);
    if (!cur || gap > GAP_SEC || tooLong || full || (perLine === 0 && ended)) {
      cur = { start: s, end: e, items: [] };
      caps.push(cur);
    }
    cur.items.push({ text, s, e });
    cur.end = e;
  }
  return caps
    .filter(c => c.items.length)
    .map((c, i) => ({
      id: 'sub' + Date.now().toString(36) + '_' + i,
      name: c.items.map(x => x.text).join(' ').slice(0, 200),
      start: Math.round(c.start * 100) / 100,
      dur: Math.round(Math.max(0.3, c.end - c.start) * 100) / 100,
      // Relative to the caption's own start, so the caption can be moved later.
      words: c.items.map(x => ({ w: x.text, s: Math.round((x.s - c.start) * 100) / 100, e: Math.round((x.e - c.start) * 100) / 100 })),
      tx: null, ty: null, src: null, thumb: null, libId: null,
      srcDur: 0, trimIn: 0, trimOut: 0, speed: 1, volume: null, reversed: false,
      transition: null, animation: null, filter: null,
      cropAlign: null, tw: null, angle: null, halferAlign: null, rotation: null, valign: null,
    }));
}

// Returns a job id to poll. The segments are the Main track in the shape stt/timeline
// wants - `crop` is the in-point there too, the same name the render uses.
export async function startGeneration() {
  const tl = Store.timeline();
  if (!tl) throw new Error('no timeline');
  const segs = (tl.tracks.seg.clips || []).slice().sort((a, b) => a.start - b.start).map(c => ({
    src: c.src,
    // A Main clip's source in-point is `crop`; `trimIn` is what the insert tracks use. Both
    // are read because a fragment that came from Scenarios has neither set and one that was
    // trimmed by hand has one of them - transcribing from the wrong second shifts every word.
    crop: +c.crop || +c.trimIn || 0,
    speed: +c.speed || 1,
    dur: +c.dur || 0,
    voiceOnly: false,
  }));
  if (!segs.length) throw new Error('nothing on the Main track to transcribe');
  const d = await fetch('/api/stt/timeline', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments: segs }),
  }).then(r => r.json());
  if (!d || (!d.jobId && !d.id)) throw new Error((d && d.error) || 'transcription refused');
  return d.jobId || d.id;
}

export async function pollGeneration(jobId) {
  const d = await fetch('/api/stt/timeline/' + encodeURIComponent(jobId)).then(r => r.json());
  return d || {};
}

// Replaces every caption. Regenerating is "do it again from the audio", so keeping the old
// ones would leave two sets overlapping - and the style, which is the part worth keeping,
// lives on the track and is untouched.
export function applyWords(words, perLine) {
  const caps = groupWords(words || [], perLine || 0);
  Store.mutate(tl => {
    const t = _subs(tl);
    t.clips = caps;
    // These came from the Main track as it is right now, so whatever was cut out of it
    // before is answered for. The one place captions are replaced is the one place the
    // warning can honestly be taken down - see _markSubsStale in timeline.js.
    t.stale = false;
  });
  return caps.length;
}

// ── "The timeline changed" ──────────────────────────────────────────────────
// The warning in the top bar, left of queue. Painted from the project rather than raised by
// the edit that set it: that way it is right after a reload, right after switching projects,
// and right after an undo - which puts the flag back along with everything else.
function _paintStale() {
  const el = document.getElementById('mv3-subs-stale');
  if (!el) return;
  const t = _subs(Store.timeline());
  // No captions, nothing to regenerate: the flag can only be stale ABOUT something.
  el.hidden = !(t && t.stale && ((t.clips || []).length > 0));
}

export function initSubsStale(open) {
  const el = document.getElementById('mv3-subs-stale');
  // A click takes you to the button it is asking you to press, rather than leaving you to
  // remember that captions live behind the subtitle track in the inspector.
  if (el && typeof open === 'function') el.addEventListener('click', open);
  _paintStale();
  Store.onChange(_paintStale);
}

// ── The inspector panels ────────────────────────────────────────────────────
// The whole style lives on the TRACK, because a caption look belongs to the video and not
// to one line of it. A single caption gets only what is genuinely its own: its words, and
// where it sits relative to the rest.
function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function _colorRow(label, value, onChange) {
  const i = document.createElement('input');
  i.type = 'color';
  i.value = value;
  i.className = 'mv3-c-color';
  i.addEventListener('change', () => onChange(i.value));
  return C.row(label, i);
}

// Several controls on one line, each under its own small caption - the same trade the
// effects triple in the inspector makes. The fixed label column of a normal row is what
// makes four controls impossible at this width, so the label shrinks to a caption and the
// full name goes to the tooltip.
function _cells(items) {
  const wrap = _el('div', 'mv3-ins-cells');
  for (const it of items) {
    if (!it) continue;
    const box = _el('div', 'mv3-ins-cell');
    if (it.grow) box.style.flex = it.grow;
    box.appendChild(_el('span', 'mv3-ins-fx3-lbl', it.label));
    it.control.title = it.title || it.label;
    box.appendChild(it.control);
    wrap.appendChild(box);
  }
  return wrap;
}

function _color(value, onChange) {
  const i = document.createElement('input');
  i.type = 'color';
  i.value = value;
  i.className = 'mv3-c-color';
  i.addEventListener('change', () => onChange(i.value));
  return i;
}

export function renderSubsTrack(host) {
  const st = style();
  const tl = Store.timeline();
  const n = ((_subs(tl) || {}).clips || []).length;
  const mainN = ((tl && tl.tracks.seg.clips) || []).length;

  // The outcome rides on the Generate row itself - see genRow(). A line of its own said
  // one short sentence across the full width and pushed everything below it down a step.

  host.appendChild(_cells([
    { label: 'font', grow: '1 1 72px', control: C.select(
      [['Arial', 'Arial'], ['Impact', 'Impact'], ['Verdana', 'Verdana'], ['Georgia', 'Georgia'],
       ['Tahoma', 'Tahoma'], ['Trebuchet MS', 'Trebuchet MS'], ['Courier New', 'Courier New']],
      st.font, (v) => setStyle({ font: v })) },
    // As wide as its own caption and no wider: a swatch is read, not aimed at, and the
    // full-width bar it used to be spent a whole row saying one colour.
    { label: 'color', grow: '0 0 34px', title: 'Text colour',
      control: _color(st.primary, (v) => setStyle({ primary: v })) },
    { label: 'size', grow: '1 1 78px', control: C.slider({
      min: 20, max: 120, step: 2, value: st.size, fmt: (v) => v.toFixed(0),
      onChange: (v) => setStyle({ size: v }) }) },
    { label: 'bold', control: C.toggle(!!st.bold, (on) => setStyle({ bold: on })) },
    { label: 'italic', control: C.toggle(!!st.italic, (on) => setStyle({ italic: on })) },
  ]));

  // Under the font, because that is what they modify - the same letters, one axis at a time.
  // Both on one line: they are two halves of one decision, and read as a pair or not at all.
  host.appendChild(_cells([
    { label: 'width', grow: '1 1 0', title: 'Letter width, leaving the height alone',
      control: C.slider({ min: 50, max: 200, step: 5, value: +st.scaleX || 100,
        fmt: (v) => v + '%', onChange: (v) => setStyle({ scaleX: v }) }) },
    { label: 'height', grow: '1 1 0', title: 'Letter height, leaving the width alone',
      control: C.slider({ min: 50, max: 200, step: 5, value: +st.scaleY || 100,
        fmt: (v) => v + '%', onChange: (v) => setStyle({ scaleY: v }) }) },
  ]));

  host.appendChild(_el('div', 'mv3-c-sep'));
  // A colour and the number that governs it are one decision, so they share a line. Apart,
  // they read as four settings and took four rows to say two things.
  //
  // Each swatch is sized to its OWN caption rather than to a shared number: at the 34px that
  // fits "color" these two read "outl..." and "shad...", and a clipped label is worse than
  // the pixels it saves.
  host.appendChild(_cells([
    { label: 'outline', grow: '0 0 52px', title: 'Outline colour',
      control: _color(st.outlineColor, (v) => setStyle({ outlineColor: v })) },
    { label: 'width', grow: '1 1 0', title: 'Outline width', control: C.slider({
      min: 0, max: 10, step: 1, value: st.outline, fmt: (v) => v.toFixed(0),
      onChange: (v) => setStyle({ outline: v }) }) },
  ]));
  host.appendChild(_cells([
    { label: 'shadow', grow: '0 0 52px', title: 'Shadow colour',
      control: _color(st.shadowColor, (v) => setStyle({ shadowColor: v })) },
    { label: 'distance', grow: '1 1 0', title: 'Shadow distance', control: C.slider({
      min: 0, max: 10, step: 1, value: st.shadow, fmt: (v) => v.toFixed(0),
      onChange: (v) => setStyle({ shadow: v }) }) },
  ]));

  host.appendChild(_el('div', 'mv3-c-sep'));
  host.appendChild(_cells([
    { label: 'border', grow: '1 1 0', control: C.select([['outline', 'Outline'], ['box', 'Background box']],
      st.borderStyle, (v) => setStyle({ borderStyle: v })) },
    { label: 'anchor', grow: '1 1 0', control: C.select([['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']],
      st.pos, (v) => setStyle({ pos: v })) },
  ]));
  // The box colour only exists when there is a box, so it appears under the row that turns
  // one on rather than sitting there dead.
  if (st.borderStyle === 'box') {
    host.appendChild(_colorRow('Box', st.backColor, (v) => setStyle({ backColor: v })));
    host.appendChild(C.row('Box alpha', C.slider({
      min: 0, max: 1, step: 0.05, value: st.backAlpha, fmt: C.pct,
      onChange: (v) => setStyle({ backAlpha: v }),
    })));
  }

  host.appendChild(_el('div', 'mv3-c-sep'));
  const unsung = _color(st.secondary, (v) => setStyle({ secondary: v }));
  if (!st.karaoke) unsung.disabled = true;
  host.appendChild(_cells([
    { label: 'wrap', control: C.toggle(!!st.wrap, (on) => setStyle({ wrap: on })) },
    { label: 'words/line', grow: '1 1 66px', title: 'Words per caption on the next generation',
      control: C.slider({
        min: 0, max: 12, step: 1, value: st.wordsPerLine,
        fmt: (v) => (v ? v.toFixed(0) : 'auto'),
        onChange: (v) => setStyle({ wordsPerLine: v }) }) },
    { label: 'karaoke', control: C.toggle(!!st.karaoke, (on) => setStyle({ karaoke: on })) },
    { label: 'unsung', title: st.karaoke ? 'Colour of the words not sung yet' : 'Karaoke is off, so nothing is unsung',
      control: unsung },
  ]));
  host.appendChild(C.hint('Words / line groups the NEXT generation - it is not how a caption is drawn. Karaoke needs word timings, which only a generated caption has; one typed by hand shows in full.'));

  // The base offset has no control here any more. Where the captions sit is set by dragging
  // one on the preview with this track selected, and that gesture is its own undo - the
  // button and the sentence under it existed to describe a thing the frame already shows.
}

export function renderSubClip(host, clip) {
  const own = (+clip.tx || 0) !== 0 || (+clip.ty || 0) !== 0;

  const ta = document.createElement('textarea');
  ta.className = 'mv3-c-ta';
  ta.value = clip.name || '';
  ta.rows = 3;
  ta.addEventListener('change', () => patchClip(clip.id, { name: ta.value.slice(0, 200) }));
  host.appendChild(ta);
  host.appendChild(C.hint(clip.words && clip.words.length
    ? clip.words.length + ' word timings, so karaoke can run on this one. Fixing a typo keeps them '
      + 'exactly; adding or removing a word shares the caption out again.'
    : 'No word timings on this caption, so karaoke would show it in full.'));

  // Only once the caption HAS been moved. Untouched, the button read "Not moved" and
  // undid an offset that was not there, under a line saying it sat where the track put
  // it - a control and a sentence that between them reported nothing had happened.
  if (own) {
    host.appendChild(_el('div', 'mv3-c-sep'));
    host.appendChild(C.row('', C.button('Back to the row', () => patchClip(clip.id, { tx: null, ty: null }), {
      title: "Drop this caption's own offset so it sits where the rest do",
    })));
    host.appendChild(C.hint('Moved ' + Math.round((clip.tx || 0) * 100) + '% / ' + Math.round((clip.ty || 0) * 100) + '% from where the others sit. Drag it on the preview to change that.'));
  }

  host.appendChild(_el('div', 'mv3-c-sep'));
  host.appendChild(C.row('', C.button('Remove caption', () => removeClip(clip.id), { danger: true })));
}

// ── Generation, with the progress it needs ──────────────────────────────────
// Whisper on a 90-second voice track is tens of seconds, so the panel says where it is and
// locks while it runs - a second press would queue a second transcription of the same audio.
let _busy = false;

// The last thing generation had to say, kept out here because the inspector rebuilds itself
// on every store change - and the last store change generation makes is the captions
// themselves. Writing the outcome only into the DOM meant the panel was rebuilt the instant
// there was something to report, so a failed run looked exactly like a button that did
// nothing at all.
let _msg = '';

async function _generate() {
  if (_busy) return;
  _busy = true;
  const host = document.querySelector('#mv3-inspector .mv3-panel-body');
  const say = (t) => {
    _msg = t;
    const el = document.getElementById('mv3-subs-status');
    if (el) el.textContent = t;
  };
  const controls = host ? [...host.querySelectorAll('button, select, input, textarea')] : [];
  for (const b of controls) b.disabled = true;
  try {
    say('sending the voice to Whisper…');
    const jobId = await startGeneration();
    let words = null;
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 1200));
      const d = await pollGeneration(jobId);
      if (d.state === 'error' || d.state === 'failed') throw new Error(d.error || 'transcription failed');
      // `done` ENDS the wait, empty or not. Waiting for words to be non-empty meant a
      // finished job that heard nothing spun here for six minutes and then blamed a timeout.
      if (d.state === 'done') { words = Array.isArray(d.words) ? d.words : []; break; }
      say('transcribing… ' + (d.progress != null ? Math.round(+d.progress) + '%' : (d.state || 'working')));
    }
    if (!words) throw new Error('timed out waiting for the transcription');
    if (!words.length) throw new Error('Whisper heard no speech in the Main track');
    const n = applyWords(words, style().wordsPerLine);
    say(n + ' captions from ' + words.length + ' words');
  } catch (e) {
    say(e.message);
  } finally {
    _busy = false;
    for (const b of controls) b.disabled = false;
  }
}

// Lives in the panel's HEADER, next to the track name, so the one action here is not below
// a screen of styling for it.
// The button and the last run's outcome on one line. Separately they were a control at the
// top of the panel and a sentence under it saying how many captions exist - two rows for one
// idea, in the column that has the least room.
export function genRow() {
  const tl = Store.timeline();
  const n = ((_subs(tl) || {}).clips || []).length;
  const mainN = ((tl && tl.tracks.seg.clips) || []).length;
  const status = _el('span', 'mv3-subs-stat', _msg || (mainN
    ? (n ? n + ' captions · regenerating replaces them all' : 'Nothing yet. ' + mainN + ' fragments to transcribe.')
    : 'The Main track is empty, so there is no voice to transcribe.'));
  status.id = 'mv3-subs-status';
  return C.row('', C.pair(genButton(), status));
}

export function genButton() {
  const tl = Store.timeline();
  const n = ((_subs(tl) || {}).clips || []).length;
  const mainN = ((tl && tl.tracks.seg.clips) || []).length;
  const b = C.button(n ? 'Regenerate' : 'Generate', () => _generate(), {
    title: 'Transcribe the Main track with Groq Whisper and build captions from the word timings'
      + (n ? ' - this replaces all ' + n : ''),
  });
  if (!mainN || _busy) b.disabled = true;
  return b;
}
