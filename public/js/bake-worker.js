/* ═══════════════════════════════════════════════════════════════════════════
   THE BAKE WINDOW (phase V84 block 3, the owner 2026-11-10, (б3-1)-(б3-10); lib/fx-bake.js is the server's side). The app keeps it
   hidden (desktop/faces.js createBakeWindow). It asks the server for a STRETCH of a clip on main video whose effects the page alone
   draws, reads its frames as the clip lies in the frame (raw I420 from the render's own graph), draws EVERY effect of the clip on
   each with the PREVIEW'S code - fx/params.js paramsAt and merge-v3/fx-draw.js applyFx, one rule - encodes H.264 with WebCodecs
   (the window's graphics card when it has an encoder) and sends the stream back in pieces; the server makes it the copy the render
   lays over the stretch. One stretch at a time.
   ═══════════════════════════════════════════════════════════════════════════ */

import { paramsAt } from './fx/params.js';
import { applyFx } from './merge-v3/fx-draw.js';

const stateEl = document.getElementById('bake-state');
const say = (t) => { if (stateEl) stateEl.textContent = t; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function _json(url, init) {
  const r = await fetch(url, init);
  return r.json();
}
const _post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

// The encoder: H.264 High, Annex B (the parameter sets with every key frame - the server copies the stream into an mp4 as it is),
// a high rate - it is a copy the render encodes again. The card's encoder first, else the program's.
async function _encoderConfig(W, H, fps) {
  const bitrate = Math.round(Math.min(40e6, Math.max(6e6, W * H * fps * 0.35)));
  for (const codec of ['avc1.640033', 'avc1.64002a', 'avc1.4d0033', 'avc1.42003e']) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'annexb' }, hardwareAcceleration };
      try {
        const s = await VideoEncoder.isConfigSupported(cfg);
        if (s && s.supported) return cfg;
      } catch (e) { /* the next */ }
    }
  }
  throw new Error('this computer has no H.264 encoder the app window can use');
}

async function bake(job) {
  const { id, w: W, h: H, fps, n, a, clip } = job;
  const t0 = performance.now();
  say(`drawing ${n} frames ${W}x${H}`);
  const cfg = await _encoderConfig(W, H, fps);
  let pending = [];
  let pendingBytes = 0;
  let failed = null;
  const enc = new VideoEncoder({
    output: (ch) => { const b = new Uint8Array(ch.byteLength); ch.copyTo(b); pending.push(b); pendingBytes += b.length; },
    error: (e) => { failed = e; },
  });
  enc.configure(cfg);
  const send = async (k) => {
    if (!pending.length) return;
    const blob = new Blob(pending, { type: 'application/octet-stream' });
    pending = [];
    pendingBytes = 0;
    const r = await fetch(`/api/fx-bake/${id}/chunk?n=${k}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
    if (!r.ok) throw new Error('the server did not take the drawn frames');
  };
  // The clip's frame as it lies in the frame, drawn here; the effects drawn over it by the preview's code.
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const lg = layer.getContext('2d');
  const FS = W * H * 3 / 2;
  const buf = new Uint8Array(FS);
  let fill = 0;
  let i = 0;
  const step = Math.round(1e6 / fps);
  const one = async () => {
    const ts = i * step;
    const vf = new VideoFrame(buf, { format: 'I420', codedWidth: W, codedHeight: H, timestamp: ts,
      colorSpace: { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', fullRange: false } });
    lg.drawImage(vf, 0, 0);
    vf.close();
    const p = paramsAt(clip, a + i / fps + 1e-6, W, H, true);
    const src = p ? applyFx(layer, p, { W, H, PAD: 0, inFrame: true }) : layer;
    const out = new VideoFrame(src, { timestamp: ts, duration: step });
    enc.encode(out, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
    out.close();
    i++;
    while (enc.encodeQueueSize > 6 && !failed) await sleep(1);
    if (pendingBytes > 4e6) await send(i);
    if (i % 15 === 0) say(`frame ${i} of ${n}`);
  };
  const res = await fetch(job.frames);
  if (!res.ok || !res.body) throw new Error('the clip\'s frames could not be read');
  const rd = res.body.getReader();
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    let off = 0;
    while (off < value.length && i < n) {
      const take = Math.min(FS - fill, value.length - off);
      buf.set(value.subarray(off, off + take), fill);
      fill += take;
      off += take;
      if (fill === FS) { fill = 0; await one(); }
      if (failed) throw failed;
    }
  }
  if (!i) throw new Error('no frame of the clip arrived');
  await enc.flush();
  if (failed) throw failed;
  enc.close();
  await send(i);
  const ms = (performance.now() - t0) / i;
  await _post(`/api/fx-bake/${id}/done`, { frames: i, msPerFrame: ms, codec: cfg.codec + ' ' + cfg.hardwareAcceleration });
  say(`baked ${i} frames, ${ms.toFixed(1)} ms a frame`);
}

async function loop() {
  say('waiting');
  for (;;) {
    let job = null;
    try { job = (await _json('/api/fx-bake/next?wait=1')).job; } catch (e) { await sleep(3000); continue; }
    if (!job) continue;
    try { await bake(job); } catch (e) {
      say('failed: ' + (e && e.message));
      try { await _post(`/api/fx-bake/${job.id}/fail`, { error: String((e && e.message) || e) }); } catch (x) { /* the server is gone */ }
    }
  }
}

if (typeof VideoEncoder === 'undefined') say('no WebCodecs here');
else loop();
