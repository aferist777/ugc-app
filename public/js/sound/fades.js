/* HOW LONG EACH SOUND FADES IN AND OUT - one rule for the preview (js/merge-v3/preview-b.js, a ramp of the gain) and the
   render (lib/mv3b-render.js, afade), so what is heard while cutting is what the film says.

   A sound's own fades (phase V23: `fadeIn` / `fadeOut`, the inspector's two rows; Suno's two variants laid one after
   the other cross this way). And (phase V28.4, the owner 2026-10-12: "место перекрытия нужно делать, чтобы один трек
   затухал а второй увеличивался в громкости для плавности перехода. Это автоматически") where two tracks of MUSIC (a
   clip marked `bed`) overlap on one lane, they cross over the overlap by themselves: the earlier fades out and the
   later in. Only music - a voice over a bed is not faded, nor a sound effect, nor a film's sound. One track wholly
   inside another just mixes. Moved, the crossing follows: it is worked out from where the clips are, never stored.

     fadesOf(timeline) -> Map(clipId -> { in, out })   seconds of the timeline; the two never longer than the clip */

export function fadesOf(timeline) {
  const out = new Map();
  for (const tr of ((timeline && timeline.tracks) || [])) {
    if (!tr || tr.kind !== 'audio') continue;
    const clips = (tr.clips || []).filter(Boolean);
    for (const c of clips) out.set(String(c.id), { in: Math.max(0, +c.fadeIn || 0), out: Math.max(0, +c.fadeOut || 0) });
    const beds = clips.filter(c => c.bed).sort((a, b) => (+a.start || 0) - (+b.start || 0));
    for (let i = 0; i < beds.length; i++) {
      const a = beds[i];
      const aEnd = (+a.start || 0) + (+a.dur || 0);
      for (let j = i + 1; j < beds.length; j++) {
        const b = beds[j];
        const bStart = +b.start || 0;
        if (bStart >= aEnd) break;                       // sorted by start: none later overlaps either
        if (bStart + (+b.dur || 0) <= aEnd) continue;    // wholly inside: they mix
        const over = aEnd - bStart;
        const fa = out.get(String(a.id));
        const fb = out.get(String(b.id));
        fa.out = Math.max(fa.out, over);
        fb.in = Math.max(fb.in, over);
      }
    }
    // Inside the clip: the two together never longer than it is.
    for (const c of clips) {
      const f = out.get(String(c.id));
      const dur = Math.max(0, +c.dur || 0);
      f.in = Math.min(f.in, dur);
      f.out = Math.min(f.out, dur);
      if (f.in + f.out > dur && f.in + f.out > 0) { const k = dur / (f.in + f.out); f.in *= k; f.out *= k; }
    }
  }
  return out;
}
