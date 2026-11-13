/* ═══════════════════════════════════════════════════════════════════════════
   THE BAKE WINDOW (lib/fx-bake.js is the server's side). The app keeps it
   hidden (desktop/faces.js createBakeWindow). It asks the server for a STRETCH of a clip whose effects the page alone draws, reads
   its frames as the clip lies in the frame (raw I420 from the render's own graph, read by ffmpeg's matrix), draws EVERY effect of the
   clip on each with the PREVIEW'S code - fx/params.js paramsAt and merge-v3/fx-draw.js applyFx, one rule -, reads the drawn frame
   back and hands it to its encoder (js/bake-encoder.js, a worker: turned into YUV by ffmpeg's own rule - left to the
   encoder, the copy comes out a little flatter than the render's frames -, encoded H.264 with WebCodecs, sent to the server in
   pieces); the server makes it the copy the render lays over the stretch. One stretch at a time.
   A clip ABOVE main comes on a transparent frame (`alpha`): its copy is twice as tall - the colour
   above, the alpha below as grey -, as H.264 keeps no alpha; the render joins the two again (lib/mv3b-render.js).
   An effect behind the person waits for the person's segmenter (js/fx/person.js) before the first frame.
   ═══════════════════════════════════════════════════════════════════════════ */

import { paramsAt, momentsOf } from './fx/params.js';
import { applyFx } from './merge-v3/fx-draw.js';
import { windowOf } from './fx/box.js';
import { fontsFor, loadMoments } from './fx/kit.js';
import { effectOf } from './fx/effects.js';
import { personReady } from './fx/person.js';

// The size of a clip's file - what its window's shape is made of (js/fx/box.js, the preview's rule): its picture or its
// film's metadata, as the preview knows it from its own element. Unknown - the window is the frame.
const PIC_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
function _dimsOf(src) {
  return new Promise((resolve) => {
    const u = String(src || '');
    const done = (w, h) => resolve({ w: w || 0, h: h || 0 });
    if (PIC_RE.test(u.split('?')[0])) {
      const i = new Image();
      i.onload = () => done(i.naturalWidth, i.naturalHeight);
      i.onerror = () => done(0, 0);
      i.src = u;
      return;
    }
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => { done(v.videoWidth, v.videoHeight); v.removeAttribute('src'); v.load(); };
    v.onerror = () => done(0, 0);
    v.src = u;
  });
}

const stateEl = document.getElementById('bake-state');
const say = (t) => { if (stateEl) stateEl.textContent = t; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function _json(url, init) {
  const r = await fetch(url, init);
  return r.json();
}
const _post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

// The encoder: H.264 High, Annex B (the parameter sets with every key frame - the server copies the stream into an mp4 as it is),
// a high rate - it is a copy the render encodes again. The card's encoder first, else the program's. A copy with its alpha is
// twice as tall - level 6 when 5.1 cannot take it.
async function _encoderConfig(W, H, fps) {
  const bitrate = Math.round(Math.min(40e6, Math.max(6e6, W * H * fps * 0.35)));
  for (const codec of ['avc1.640033', 'avc1.64003C', 'avc1.64002a', 'avc1.4d0033', 'avc1.42003e']) {
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

// The encoder's worker - one for the window's life.
const _enc = new Worker('/js/bake-encoder.js', { type: 'module' });
let _onEnc = null;
_enc.onmessage = (ev) => { if (_onEnc) _onEnc(ev.data || {}); };
_enc.onerror = (ev) => { if (_onEnc) _onEnc({ error: (ev && ev.message) || 'the encoder stopped' }); };

async function bake(job) {
  const { id, w: W, h: H, fps, n, a, clip } = job;
  const alpha = !!job.alpha;
  const t0 = performance.now();
  say(`drawing ${n} frames ${W}x${H}${alpha ? ' with its alpha' : ''}`);
  const cfg = await _encoderConfig(W, alpha ? 2 * H : H, fps);
  // The graphics' fonts before the first frame (a card's own font and its twin too), and the clip's window (main video - the frame).
  await fontsFor(clip && clip.fx);
  // The other moments its effects show - the same pictures the preview draws.
  await Promise.all(((clip && clip.fx) || []).map((e) => { const sp = momentsOf(clip, e); return sp ? loadMoments(clip.src, sp) : null; }));
  // The person's segmenter, for an effect drawn behind the person (js/fx/person.js) - the preview runs the same one.
  if (((clip && clip.fx) || []).some((e) => { const d = effectOf(e && e.k); return d && d.person; })) {
    if (!(await personReady())) say('the segmenter of the person could not start - drawn without the person in front');
  }
  let box = null;
  if (alpha) {
    const d = await _dimsOf(clip.src);
    box = windowOf(clip, false, d.w, d.h, W, H);
  }
  const FS = W * H * 4;
  // Three frame buffers go round between the window and its encoder: a fourth frame waits for one to come back.
  const free = [new Uint8Array(FS), new Uint8Array(FS), new Uint8Array(FS)];
  let waiter = null;
  let failed = null;
  let finished = null;
  const over = new Promise((resolve) => { finished = resolve; });
  _onEnc = (m) => {
    if (m.free && m.free.length === FS) { free.push(m.free); if (waiter) { const w = waiter; waiter = null; w(); } }
    if (m.error) { failed = new Error(m.error); if (waiter) { const w = waiter; waiter = null; w(); } finished(null); }
    if (m.done) finished(m.done);
  };
  _enc.postMessage({ start: { id, W, H, alpha, cfg } });
  const takeBuf = async () => {
    while (!free.length && !failed) await new Promise((r) => { waiter = r; });
    if (failed) throw failed;
    return free.pop();
  };
  // The clip's frame as it lies in the frame, put on the layer as it came; the effects drawn over it by the preview's code; the
  // result read back through a VideoFrame (copyTo - straight RGBA). getImageData on the effects' canvases makes Chromium move them
  // off the graphics card after a few frames, and their blurs then cost a second a frame (measured).
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const lg = layer.getContext('2d');
  // The frames come as ffmpeg's I420 (with its alpha plane above main) - a third of RGBA's bytes, which the pipe could not carry
  // fast enough -, read by ffmpeg's own matrix (BT.601, the TV range: the one its conversions use).
  const IN = W * H * (alpha ? 5 : 3) / 2;
  const buf = new Uint8Array(IN);
  const inSpace = { matrix: 'smpte170m', primaries: 'smpte170m', transfer: 'smpte170m', fullRange: false };
  const step = Math.round(1e6 / fps);
  let fill = 0;
  let i = 0;
  let drawMs = 0;
  const one = async () => {
    const out = await takeBuf();
    const q0 = performance.now();
    const vin = new VideoFrame(buf, { format: alpha ? 'I420A' : 'I420', codedWidth: W, codedHeight: H, timestamp: i * step, colorSpace: inSpace });
    lg.clearRect(0, 0, W, H);
    lg.drawImage(vin, 0, 0);
    vin.close();
    const p = paramsAt(clip, a + i / fps + 1e-6, W, H, !alpha);
    const src = p ? applyFx(layer, p, { W, H, PAD: 0, inFrame: true, box }) : layer;
    const vf = new VideoFrame(src, { timestamp: i * step });
    try { await vf.copyTo(out, { format: 'RGBA' }); } finally { vf.close(); }
    drawMs += performance.now() - q0;
    _enc.postMessage({ frame: { k: i, buf: out } }, [out.buffer]);
    i++;
    if (i % 15 === 0) say(`frame ${i} of ${n}`);
  };
  try {
    const res = await fetch(job.frames);
    if (!res.ok || !res.body) throw new Error('the clip\'s frames could not be read');
    const rd = res.body.getReader();
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      let off = 0;
      while (off < value.length && i < n) {
        const take = Math.min(IN - fill, value.length - off);
        buf.set(value.subarray(off, off + take), fill);
        fill += take;
        off += take;
        if (fill === IN) { fill = 0; await one(); }
        if (failed) throw failed;
      }
    }
    if (!i) throw new Error('no frame of the clip arrived');
    _enc.postMessage({ end: true });
    const got = await over;
    if (failed || !got) throw failed || new Error('the encoder stopped');
    const ms = (performance.now() - t0) / i;
    await _post(`/api/fx-bake/${id}/done`, { frames: i, msPerFrame: ms, drawMs: drawMs / i, convMs: got.convMs, codec: cfg.codec + ' ' + cfg.hardwareAcceleration });
    say(`baked ${i} frames, ${ms.toFixed(1)} ms a frame (drawing ${(drawMs / i).toFixed(1)}, converting ${(+got.convMs).toFixed(1)})`);
  } finally {
    _onEnc = null;
  }
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
