/* ═══════════════════════════════════════════════════════════════════════════
   FRAGMENTS OF ONE VIDEO - ONE RULE for the page and the server (phase V81, the owner 2026-11-09: "надо пользователю дать
   возможность на одном видео сделать сразу несколько выделений ... сохранить и сразу склеить выделеное, либо сохранить каждый
   фрагмент отдельно ... видео проанализировалось и сразу же нарезалось на сцены").

   The page's bar of fragments (js/ranges.js, under every viewer's video - js/cut.js) and the server's cuts (lib/cuts.js
   cutMany, lib/scenes.js) read the same seconds from here: which fragments there are, in what order the join plays them, and
   where the scenes of a video begin and end.

     normParts(parts, dur)   [{ in, out, label? }] in the order of time, inside the file, to hundredths; a fragment starting
                             before the one before it ends starts where it ends; shorter than MIN_PART - none. Fragments edge to
                             edge stay two (scenes are) - a join plays them on anyway.
     joinedLen(parts)        how long they are, one after another
     scenesOf(changes, dur)  [{ in, out }] edge to edge from the changes of shot (scdet's times): changes closer than
                             SCENE_MERGE are one (as js/framing/active.js reads a podcast's), a scene shorter than SCENE_MIN
                             joins the one before it (the first - the one after)
   ═══════════════════════════════════════════════════════════════════════════ */

export const MIN_PART = 0.3;        // the shortest fragment - lib/cuts.js refuses a shorter piece
export const SEAM_FADE = 0.015;     // a join's sound fades out and in at every seam, so no seam clicks (js/sound/pause-cuts.js)
export const SCENE_MERGE = 0.6;     // changes of shot closer than this are one (a flash, a dissolve's two halves)
export const SCENE_MIN = 1;         // a scene is never shorter than this

const EPS = 1e-6;
const r2 = (v) => Math.round(v * 100) / 100;

export function normParts(parts, dur) {
  const D = +dur > 0 ? +dur : Infinity;
  const list = (Array.isArray(parts) ? parts : [])
    .filter((p) => p && Number.isFinite(+p.in) && Number.isFinite(+p.out))
    .map((p) => {
      const o = { in: r2(Math.max(0, Math.min(D, +p.in))), out: r2(Math.max(0, Math.min(D, +p.out))) };
      if (p.label) o.label = String(p.label).slice(0, 40);
      return o;
    })
    .filter((p) => p.out > p.in)
    .sort((a, b) => a.in - b.in || a.out - b.out);
  const out = [];
  for (const p of list) {
    const last = out[out.length - 1];
    if (last && p.in < last.out - EPS) p.in = last.out;
    if (p.out - p.in >= MIN_PART - EPS) out.push(p);
  }
  return out;
}

export function joinedLen(parts) {
  return r2((parts || []).reduce((s, p) => s + Math.max(0, (+p.out || 0) - (+p.in || 0)), 0));
}

export function scenesOf(changes, dur) {
  const D = +dur || 0;
  if (!(D > 0)) return [];
  const merged = [];
  for (const c of (changes || []).map(Number).filter((c) => c > 0.05 && c < D - 0.05).sort((a, b) => a - b)) {
    if (merged.length && c - merged[merged.length - 1] < SCENE_MERGE) merged[merged.length - 1] = c;
    else merged.push(c);
  }
  const e = [0, ...merged, D];
  // A scene shorter than SCENE_MIN joins the one before it - its starting edge goes; the first joins the one after.
  for (let k = 0; k < e.length - 1 && e.length > 2;) {
    if (e[k + 1] - e[k] >= SCENE_MIN - EPS) { k++; continue; }
    if (k === 0) e.splice(1, 1);
    else { e.splice(k, 1); k--; }
  }
  const out = [];
  for (let i = 0; i + 1 < e.length; i++) out.push({ in: r2(e[i]), out: r2(e[i + 1]) });
  return out;
}
