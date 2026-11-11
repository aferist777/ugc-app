/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S EFFECTS LAID BY THE AGENT - THE RULE (phase V90, the owner 2026-11-11; docs/local-app/plan/, "Фаза V90", "Подфаза 5 —
   V90: подробный план", (аэ1)-(аэ15)). ONE module for the page (the "Auto effects" row - js/merge-v3/fx-ui.js, hl-group.js) and the
   server (lib/fx-auto.js asks the agents' ladder; lib/highlights-job.js lays them at the cut) - require()d as params.js is.

   WHAT THE AGENT SEES (`briefOf`): the WHOLE film - its length, its words as phrases with their seconds (the Subtitles lane), the text
   lanes' lines, the key lines (the punch-ins of main video - framing/path.js `zooms` - and the ones handed in), where a face is seen,
   the clips it may put effects on (the targets, seconds of the film), the kind, the title, the language and how many (`count`: a
   number, or 'auto' - the owner's (аэ10): a hook at the start, about one on a key line, not more often than once in 4-6 s).
   WHAT THE PROGRAM KEEPS OF ITS ANSWER (`checkAnswer`, the owner's (аэ3), (аэ4)): a key it knows and may lay (never Face mosaic -
   `SKIP`); a start inside a target - the effect goes on the clip under it (`t0` the file's second there, as params.js keeps it); a
   moment's length its own unless given, kept in its range, cut at its clip's end (moved earlier to fit its least, as a set's); one
   that goes on - the length given (1 s at least) or to the clip's end; by the face - only where a face is seen at its start and its
   middle; behind the person - one a film; two moments on one clip never overlap, no more than two that go on at once; repeats are
   fine; the PERSON'S effects already on the clips (not the agent's) are told to it and kept to as well - no moment over theirs, no
   second behind the person; a card's words - every field, at most TEXT_MAX, a card without its main words left out; a number - that many at most (the
   agent writes the most important first), 'auto' - at most `autoCap`. Every effect it keeps is MARKED `ai: 1` (params.js keeps it):
   "Again" takes only those off (аэ7); the person changing one makes it theirs (аэ15, fx-ui.js).
   (block 4) WHERE THE FACE IS, BY THE SERVER (`facePathOf`): a highlights fragment's clip follows its faces (framing/path.js) - the
   face's box carried from the film's frame into the 9:16 one by the window of a `face` shot and its punch-in, the preview's own rule
   (preview-b.js _place); a clip laid otherwise gets none and its effect works where a face usually is.
   ═══════════════════════════════════════════════════════════════════════════ */

import { EFFECTS, effectOf } from './effects.js';
import { lengthRange, fileAt, timeOfFile, spanOf, TEXT_MAX, PATH_MAX, FX_MAX } from './params.js';
import { isFramed, windowAt, zoomAt } from '../framing/path.js';

export const AUTO_VERSION = 1;
/** Never offered to the agent (the owner's (аэ4): "с мозайкой для лица не делаем"). */
export const SKIP = ['mosaic'];
/** The effects the agent may lay, in the table's order. */
export const AGENT_KEYS = Object.keys(EFFECTS).filter((k) => !SKIP.includes(k));
/** How many - the row's choices (the owner's (аэ10)); the highlights popup has its own ("none" first, (аэ13)). */
export const COUNTS = ['auto', 1, 2, 3, 4, 5, 6, 8];
export const POPUP_COUNTS = ['none', 'auto', 1, 2, 3, 4, 5];
/** 'auto': a hook and about one every 5 s at most. */
export const autoCap = (len) => Math.max(1, 1 + Math.floor((+len || 0) / 5));
export const isAgent = (e) => !!(e && e.ai);
/** A count as kept: 'auto' or a whole number 1..8; anything else - 'auto'. */
export function countOf(v) {
  if (v === 'auto') return 'auto';
  const n = Math.round(Number(v));
  return n >= 1 && n <= 8 ? n : 'auto';
}

// A card's words: the fields that keep the table's own when the agent writes none, and the one without which a card is not laid.
const KEEP = { chat: ['name'], magazine: ['issue', 'date'] };
const MAIN = { checklistpop: 'i1', checklist2: 'i1', growthchart: 'number', chat: 'request', phonemock: 'caption', headlinestorm: 'h1',
  headlinestorm2: 'h1', magazine: 'head1' };
export const MAIN_TEXT = MAIN;

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const r4 = (x) => Math.round(x * 10000) / 10000;
const _aspect = (tl) => { const f = String((tl && tl.format) || '9:16').split(':'); return (+f[0] > 0 && +f[1] > 0) ? (+f[0] / +f[1]) : 9 / 16; };
const _end = (c) => (+c.start || 0) + (+c.dur || 0);

// ── What the film says ─────────────────────────────────────────────────────
/** The film's words in its seconds - the Subtitles lane with the most of them: [{ w, a, b }]. */
export function wordsOf(tl) {
  let best = [];
  for (const t of (tl && tl.tracks) || []) {
    if (!t || t.kind !== 'subs') continue;
    const out = [];
    for (const c of t.clips || []) {
      const s = +c.start || 0;
      if (Array.isArray(c.words) && c.words.length) {
        for (const w of c.words) { const tx = String((w && w.w) || '').trim(); if (tx) out.push({ w: tx, a: s + (+w.s || 0), b: s + (+w.e || +w.s || 0) }); }
      } else if (String(c.name || '').trim()) out.push({ w: String(c.name).trim(), a: s, b: _end(c) });
    }
    if (out.length > best.length) best = out;
  }
  return best.sort((x, y) => x.a - y.a);
}
/** The words as phrases: cut at a sentence's end, a pause over 0.7 s or 14 words - [{ a, b, text }]. */
export function phrasesOf(words) {
  const out = [];
  let cur = null;
  for (const w of words || []) {
    if (cur && (w.a - cur.b > 0.7 || cur.n >= 14)) { out.push(cur); cur = null; }
    if (!cur) cur = { a: w.a, b: w.b, text: '', n: 0 };
    cur.text += (cur.text ? ' ' : '') + w.w;
    cur.b = Math.max(cur.b, w.b);
    cur.n++;
    if (/[.!?…]["»”')]*$/.test(w.w)) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.map((p) => ({ a: r2(p.a), b: r2(p.b), text: p.text }));
}
/** The text lanes' lines - [{ a, b, text }]. */
function _lines(tl) {
  const out = [];
  for (const t of (tl && tl.tracks) || []) {
    if (!t || t.kind !== 'text') continue;
    for (const c of t.clips || []) { const tx = String(c.name || c.text || '').trim(); if (tx) out.push({ a: r2(+c.start || 0), b: r2(_end(c)), text: tx.slice(0, 200) }); }
  }
  return out.sort((x, y) => x.a - y.a);
}
const _mainLane = (tl) => ((tl && tl.tracks) || []).find((t) => t && t.kind === 'video' && t.main) || null;
/** The film's length: its main video's end, else every lane's. */
export function lengthOf(tl) {
  const lanes = _mainLane(tl) ? [_mainLane(tl)] : ((tl && tl.tracks) || []);
  let m = 0;
  for (const t of lanes) for (const c of (t && t.clips) || []) m = Math.max(m, _end(c));
  return r2(m);
}
/** The key lines - the punch-ins of main video's clips (the file's seconds, said in the film's) - [{ a, b }]. */
function _keys(tl) {
  const out = [];
  for (const c of ((_mainLane(tl) || {}).clips || [])) {
    const z = c && c.frame && !c.frame.noZoom && Array.isArray(c.frame.zooms) ? c.frame.zooms : [];
    for (const k of z) {
      const a = timeOfFile(c, +k.t0 || 0), b = timeOfFile(c, +k.t1 || +k.t0 || 0);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (hi > (+c.start || 0) && lo < _end(c)) out.push({ a: r2(Math.max(lo, +c.start || 0)), b: r2(Math.min(hi, _end(c))) });
    }
  }
  return out;
}

// ── Where a face is ─────────────────────────────────────────────────────────
// The boxes of a faces record (lib/faces.js: [[x, y, w, h, score], ...] a frame, shares of the film's frame) at the file's second.
function _boxesAt(rec, tf) {
  const fps = +rec.fps || 5;
  const fr = rec.frames || [];
  const b = fr[Math.max(0, Math.min(fr.length - 1, Math.round(tf * fps)))] || [];
  return b.filter((x) => Array.isArray(x) && x[2] > 0 && x[3] > 0);
}
// Whether the clip shows its film whole enough at the file's second for its face to be on the screen: a clip that follows its faces
// only on a `face` shot (a whole frame over its blur, two bands, a camera + game - none).
function _faceShot(c, rec, tf, aspect) {
  if (!isFramed(c.frame)) return true;
  return windowAt(c.frame, tf, +rec.w || 1920, +rec.h || 1080, aspect).kind === 'face';
}
/** The film's stretches where clip `c` shows a face - [[a, b], ...] in the film's seconds, from its faces record `rec`. */
export function faceSpansOf(c, rec, aspect = 9 / 16) {
  if (!c || !rec || !Array.isArray(rec.frames) || !rec.frames.length) return [];
  const s = +c.start || 0, e = _end(c);
  const out = [];
  let cur = null;
  for (let t = s; t < e; t += 0.2) {
    const tf = fileAt(c, t);
    const on = _faceShot(c, rec, tf, aspect) && _boxesAt(rec, tf).length > 0;
    if (on) { if (!cur) cur = [t, t]; cur[1] = Math.min(e, t + 0.2); } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter((x) => x[1] - x[0] >= 0.6).map((x) => [r2(x[0]), r2(x[1])]);
}
const _inSpans = (spans, t) => (spans || []).some((x) => t >= x[0] - 1e-3 && t <= x[1] + 1e-3);

/**
 * (block 4) The face's path over clip `c` for an effect by the face - [[the file's second, x, y, w, h], ...] five a second, shares of
 * the 9:16 frame (effects.js faceAt) - for a MAIN clip filling the frame that follows its faces (a highlights fragment's), by its
 * `face` shots' window and punch-in; null for anything else (the page finds it then - fx-ui.js).
 */
export function facePathOf(c, rec, aspect = 9 / 16) {
  if (!c || !rec || !Array.isArray(rec.frames) || !rec.frames.length) return null;
  if (String(c.fit || '') !== 'fill' || !isFramed(c.frame) || c.pip || (c.crop && !c.crop.off) || (c.tw != null && +c.tw > 0)) return null;
  const sw = +rec.w || 1920, sh = +rec.h || 1080;
  const s = +c.start || 0, dur = +c.dur || 0;
  const n = Math.min(PATH_MAX, Math.max(2, Math.ceil(dur * 5) + 1));
  const out = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const t = Math.min(s + dur - 1e-3, s + (dur * i) / (n - 1));
    const tf = fileAt(c, t);
    const win = windowAt(c.frame, tf, sw, sh, aspect);
    if (win.kind !== 'face') { prev = null; continue; }
    const boxes = _boxesAt(rec, tf);
    if (!boxes.length) continue;
    const mid = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
    let box = null;
    if (prev) {
      const p = mid(prev);
      let best = Infinity;
      for (const b of boxes) { const m = mid(b); const d = Math.hypot(m[0] - p[0], m[1] - p[1]); if (d < best) { best = d; box = b; } }
      if (best > 0.25) box = null;
    }
    if (!box) box = boxes.reduce((x, y) => (y[2] * y[3] > x[2] * x[3] ? y : x));
    prev = box;
    // The window of the film the frame shows (preview-b.js _place): full height, `aspect` wide, about its x; a punch-in inside it.
    const fw = sh * aspect;
    let sx = Math.max(0, Math.min(sw - fw, win.x * sw - fw / 2)), sy = 0, ww = fw, wh = sh;
    const zm = zoomAt(c.frame, tf);
    if (zm.z > 1.0005) { sx += fw * zm.ax * (1 - 1 / zm.z); sy = sh * zm.ay * (1 - 1 / zm.z); ww = fw / zm.z; wh = sh / zm.z; }
    const [mx, my] = mid(box);
    out.push([r3(tf), r4((mx * sw - sx) / ww), r4((my * sh - sy) / wh), r4(Math.min(4, box[2] * sw / ww)), r4(Math.min(4, box[3] * sh / wh))]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const uniq = out.filter((p, i) => i === 0 || p[0] > out[i - 1][0]);
  return uniq.length ? uniq : null;
}

// ── The brief ───────────────────────────────────────────────────────────────
/**
 * What the agent is told about timeline `tl` and the clips `ids` it may put effects on (the video lanes' clips with a file, never a
 * halfer band): { length, phrases, lines, keys, targets: [{ id, lane, main, a, b }], faces: [[a, b]], count, cap, kind, title, language,
 * noWords }. `o`: { count, kind, title, language, keys: [{ a, b }] more key lines, faces: { <clip id>: faces record } }.
 */
export function briefOf(tl, ids, o = {}) {
  const want = new Set((ids || []).map(String));
  const aspect = _aspect(tl);
  const targets = [];
  const faces = [];
  const existing = [];          // the person's effects on the targets: { id, k, a, b, intro, person } - kept to by checkAnswer
  for (const t of (tl && tl.tracks) || []) {
    if (!t || t.kind !== 'video') continue;
    for (const c of t.clips || []) {
      if (!c || !c.src || c.halfer || !want.has(String(c.id)) || !(+c.dur > 0)) continue;
      targets.push({ id: String(c.id), lane: String(t.id), main: !!t.main, a: r2(+c.start || 0), b: r2(_end(c)) });
      const rec = o.faces && o.faces[String(c.id)];
      if (rec) faces.push(...faceSpansOf(c, rec, aspect));
      for (const e of Array.isArray(c.fx) ? c.fx : []) {
        const d = e && effectOf(e.k);
        if (!d || isAgent(e)) continue;
        const sp = spanOf(c, e);
        if (sp.b > sp.a + 1e-3) existing.push({ id: String(c.id), k: e.k, a: r2(sp.a), b: r2(sp.b), intro: d.kind === 'intro', person: !!d.person });
      }
    }
  }
  targets.sort((x, y) => x.a - y.a);
  const words = wordsOf(tl);
  const length = lengthOf(tl) || (targets.length ? Math.max(...targets.map((x) => x.b)) : 0);
  const count = countOf(o.count);
  const keys = _keys(tl).concat((o.keys || []).filter((k) => k && +k.b > +k.a).map((k) => ({ a: r2(+k.a), b: r2(+k.b) })))
    .sort((x, y) => x.a - y.a);
  return {
    v: AUTO_VERSION, length, phrases: phrasesOf(words), lines: _lines(tl), keys, targets, existing: existing.sort((x, y) => x.a - y.a),
    faces: faces.sort((x, y) => x[0] - y[0]), count, cap: count === 'auto' ? autoCap(length) : count,
    kind: String(o.kind || ''), title: String(o.title || '').slice(0, 200), language: String(o.language || '').slice(0, 40),
    noWords: !words.length,
  };
}

// ── Its answer, kept to the rules ───────────────────────────────────────────
/** The words of a card from the agent's `txt`: every field of the table - its own words, the table's for KEEP, else ''. */
function _texts(k, txt) {
  const d = effectOf(k);
  if (!d.texts) return null;
  const out = {};
  const keep = KEEP[k] || [];
  for (const [key, , def] of d.texts) {
    const v = txt && typeof txt === 'object' && typeof txt[key] === 'string' ? txt[key].replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, TEXT_MAX) : null;
    out[key] = v != null && v !== '' ? v : (keep.includes(key) ? def : '');
  }
  if (k === 'growthchart') out.number = String(out.number || '').replace(/[^0-9]/g, '').slice(0, 6);
  return out;
}

/**
 * The agent's `effects` ([{ k, at, len, txt }], the most important first) kept to the rules (the header) for the clips of `tl` the
 * `brief` names: { byClip: { <clip id>: [{ k, t0, len?, txt?, ai: 1 }] }, placed, dropped: [{ k, at, why }] } - ids, colours, the
 * face's path and the cover's date are the layer's to add (fx-ui.js / lib/fx-auto.js).
 */
export function checkAnswer(effects, brief, tl) {
  const clips = new Map();
  for (const t of (tl && tl.tracks) || []) for (const c of (t && t.clips) || []) if (c && c.id != null) clips.set(String(c.id), c);
  const byClip = {};
  const theirs = (brief.existing || []).map((x) => ({ ...x }));
  const kept = [];             // { id, k, a, b, intro, person } - the agent's, kept
  const dropped = [];
  const cap = brief.cap === 'auto' ? autoCap(brief.length) : Math.max(1, +brief.cap || 1);
  let persons = theirs.filter((x) => x.person).length;
  for (const p of Array.isArray(effects) ? effects : []) {
    if (kept.length >= cap) break;
    const k = String((p && p.k) || '').trim();
    const at0 = Number(p && p.at);
    const no = (why) => dropped.push({ k, at: Number.isFinite(at0) ? r2(at0) : null, why });
    const d = effectOf(k);
    if (!d) { no('not an effect of the app'); continue; }
    if (SKIP.includes(k)) { no('not offered'); continue; }
    if (!Number.isFinite(at0)) { no('no start'); continue; }
    const tg = brief.targets.find((x) => at0 >= x.a - 0.05 && at0 < x.b - 0.05);
    const c = tg && clips.get(tg.id);
    if (!c) { no('outside the clips it may go on'); continue; }
    const s = +c.start || 0, e = _end(c);
    let at = Math.max(s, at0);
    let len = 0;
    const given = Number(p && p.len);
    if (d.kind === 'intro') {
      const [lo, hi] = lengthRange(k);
      len = Math.max(lo, Math.min(hi, given > 0 ? given : d.dur));
      if (e - s < lo - 1e-3) { no('its clip is shorter than the effect can be'); continue; }
      if (at + len > e) {
        if (e - at >= lo) len = e - at;
        else { at = Math.max(s, e - lo); len = e - at; }
      }
    } else {
      len = given >= 1 ? Math.min(given, e - at) : e - at;
      if (len < 0.3) { no('too short'); continue; }
    }
    const b = at + len;
    if (d.face && !(_inSpans(brief.faces, at) && _inSpans(brief.faces, at + len / 2))) { no('no face there'); continue; }
    if (d.person && persons >= 1) { no('one behind the person a film'); continue; }
    const all = kept.concat(theirs);
    const mine = all.filter((x) => x.id === tg.id);
    if (d.kind === 'intro' && mine.some((x) => x.intro && x.a < b - 0.05 && at < x.b - 0.05)) { no('over another moment'); continue; }
    if (d.kind !== 'intro' && all.filter((x) => !x.intro && x.a < b - 0.05 && at < x.b - 0.05).length >= 2) { no('two go on there already'); continue; }
    if ((byClip[tg.id] || []).length + ((c.fx || []).filter((x) => !isAgent(x)).length) >= FX_MAX) { no('the clip has as many as it takes'); continue; }
    const one = { k, t0: r3(fileAt(c, at)), ai: 1 };
    // A moment keeps its length; one that goes on to the clip's end keeps none (params.js spanOf).
    if (d.kind === 'intro' || b < e - 0.05) one.len = r3(len);
    if (d.texts) {
      const txt = _texts(k, p.txt);
      if (MAIN[k] && !txt[MAIN[k]]) { no('a card with no words'); continue; }
      one.txt = txt;
    }
    if (d.person) persons++;
    kept.push({ id: tg.id, k, a: at, b, intro: d.kind === 'intro' });
    (byClip[tg.id] = byClip[tg.id] || []).push(one);
  }
  return { byClip, placed: kept.length, dropped };
}
