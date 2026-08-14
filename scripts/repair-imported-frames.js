#!/usr/bin/env node
// Give imported fragments the frame their clip was made from, and the clip its poster.
//
// The old flow had no first frame: a fragment was words, a voice take and a clip. This one
// is built on frames - the Montage column counts `lines.filter(l => l.frameId)` and says
// "no frames yet" when that is empty, and refuses to animate a fragment without one. So an
// imported project arrives complete and reads as untouched work, which is worse than
// obviously broken: nothing to click, no reason given.
//
// The honest frame is the clip's own first frame. A lipsync IS that picture moving, so
// extracting frame 0 does not invent provenance - it recovers it. Each fragment gets its
// own variant in the mix pool, the fragment points at it, and the clip records it as the
// frame it came from; without that last part the clip would read as stale and vanish from
// the card it belongs to.
//
// The clip poster is fixed in the same pass: the cell draws `clip.thumb`, and an imported
// clip had none, so a finished fragment showed an empty square.
//
//   node scripts/repair-imported-frames.js --dry-run
//   node scripts/repair-imported-frames.js
//   node scripts/repair-imported-frames.js --api http://localhost:3000
//
// Re-running is safe: a fragment that already has a frameId is left alone.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const VT = require('../lib/video-thumb');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const API = flag('api', 'http://localhost:3000') + '/api/scen3';
const ROOT = path.join(__dirname, '..');

const firstFrame = (absVideo, absOut) => new Promise((resolve, reject) => {
  // -ss 0 before -i: the first decodable frame, without walking the file.
  execFile(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0', '-i', absVideo,
    '-frames:v', '1', '-q:v', '3', absOut], { timeout: 60000 },
    (err) => (err || !fs.existsSync(absOut)) ? reject(err || new Error('no frame written')) : resolve());
});

(async () => {
  const res = await (await fetch(API + '/projects')).json();
  const list = (res.projects || res.items || []);
  console.log('projects:', list.length, DRY ? '(DRY RUN - nothing written)' : '');

  let touched = 0, frames = 0, posters = 0, failed = 0;

  for (const row of list) {
    const full = await (await fetch(API + '/projects/' + encodeURIComponent(row.id))).json();
    const p = full.project || full.item || full;
    const lines = p.lines || [];
    // Only fragments that HAVE a clip and LACK a frame. A project the user has worked on
    // normally is untouched by this.
    const need = lines.filter(l => !l.frameId && ((l.video && l.video.plain) || []).length);
    if (!need.length) continue;

    console.log('  >', String(p.name || p.id).slice(0, 46), '|', need.length, 'of', lines.length, 'fragments');
    if (DRY) { touched++; continue; }

    const mix = p.mix || {};
    const variants = Array.isArray(mix.variants) ? mix.variants.slice() : [];

    for (const ln of lines) {
      const clips = (ln.video && ln.video.plain) || [];
      if (ln.frameId || !clips.length) continue;
      const clip = clips[0];
      const absVideo = VT.localFromUrl(clip.path);
      if (!absVideo || !fs.existsSync(absVideo)) { failed++; continue; }

      const base = path.basename(clip.path).replace(/\.[^.]+$/, '');
      const url = '/uploads/migframe_' + base + '.jpg';
      const abs = path.join(ROOT, url);
      try {
        if (!fs.existsSync(abs)) await firstFrame(absVideo, abs);
        const id = 'f_mig_' + base;
        if (!variants.some(v => v.id === id)) {
          variants.push({ id, path: url, preview: '', at: new Date().toISOString(),
            prompt: 'first frame of the imported clip' });
        }
        ln.frameId = id;
        // Without this the clip belongs to no frame and the card treats it as stale.
        for (const c of clips) if (!c.fromFrame) c.fromFrame = id;
        frames++;
      } catch (e) { failed++; continue; }

      // The cell draws clip.thumb; an imported clip had none.
      if (!clip.thumb) {
        try { clip.thumb = (await VT.makeThumb(clip.path)).thumb; posters++; } catch (e) {}
      }
    }

    const saved = await (await fetch(API + '/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, lines, mix: { ...mix, variants } }),
    })).json();
    if (!saved || !saved.success) { console.log('    FAIL save ->', saved && saved.error); continue; }
    touched++;
  }

  console.log('\nprojects touched:', touched, '| frames made:', frames, '| posters made:', posters, '| failed:', failed);
})();
