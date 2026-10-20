/* faces-worker.js - the app's hidden faces window (phase V33.2; docs/local-app/PLAN.md "Фаза V33", V33.2).

   Asks the server for a film (GET /api/faces/next, held open), reads its frames as they come - raw RGBA, five a second,
   480 wide (GET /api/faces/frames/:id) -, finds the faces in each with MediaPipe's BlazeFace FULL RANGE model and answers
   with every frame's boxes (POST /api/faces/:id/done). On the window's graphics card when it has one, else on the
   processor (5.8 and 10.8 ms a frame on the owner's laptop). The frames are counted as they arrive, so the server's
   ffmpeg goes at the detector's pace and nothing is held in memory but one frame.

   desktop/faces.js keeps it open, hidden, for as long as the app runs; it can be opened in a tab too (a test). */

import { FaceDetector } from '/vendor/mediapipe/vision_bundle.mjs';

const FILES = {
  wasmLoaderPath: '/vendor/mediapipe/wasm/vision_wasm_internal.js',
  wasmBinaryPath: '/vendor/mediapipe/wasm/vision_wasm_internal.wasm',
};
const MODEL = '/vendor/mediapipe/blaze_face_full_range.tflite';
const MIN_SCORE = 0.5;

const el = document.getElementById('faces-state');
const say = (s) => { if (el) el.textContent = s; };
const r3 = (x) => Math.round(x * 1000) / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let det = null;
let delegate = '';
const counted = { films: 0, frames: 0 };
window.__faces = { counted, get delegate() { return delegate; } };

async function make(prefer) {
  let last = null;
  for (const d of prefer) {
    try {
      const x = await FaceDetector.createFromOptions(FILES, {
        baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: 'IMAGE', minDetectionConfidence: MIN_SCORE,
      });
      if (det) { try { det.close(); } catch (e) { /* gone */ } }
      det = x;
      delegate = d;
      return;
    } catch (e) { last = e; }
  }
  throw last || new Error('the face detector could not start');
}

function boxes(img, fw, fh) {
  let r;
  try { r = det.detect(img); }
  catch (e) {
    // The graphics card let go (a lost context): the processor counts from here on.
    if (delegate !== 'GPU') throw e;
    throw Object.assign(e, { gpuLost: true });
  }
  return r.detections.filter((d) => d.categories[0] && d.categories[0].score >= MIN_SCORE).map((d) => [
    r3(d.boundingBox.originX / fw), r3(d.boundingBox.originY / fh), r3(d.boundingBox.width / fw), r3(d.boundingBox.height / fh),
    r3(d.categories[0].score),
  ]);
}

async function count(job) {
  const size = job.fw * job.fh * 4;
  const res = await fetch(job.frames);
  if (!res.ok || !res.body) throw new Error('the frames did not come (' + res.status + ')');
  const reader = res.body.getReader();
  const frame = new Uint8ClampedArray(size);
  let fill = 0;
  let ms = 0;
  const out = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    let off = 0;
    while (off < value.length) {
      const take = Math.min(size - fill, value.length - off);
      frame.set(value.subarray(off, off + take), fill);
      fill += take;
      off += take;
      if (fill < size) continue;
      fill = 0;
      const img = new ImageData(frame, job.fw, job.fh);
      const t0 = performance.now();
      try { out.push(boxes(img, job.fw, job.fh)); }
      catch (e) {
        if (!e.gpuLost) throw e;
        await make(['CPU']);
        out.push(boxes(img, job.fw, job.fh));
      }
      ms += performance.now() - t0;
      counted.frames++;
      if (out.length % 25 === 0) say(`counting ${out.length} / ${job.n} frames (${delegate})`);
    }
  }
  return { frames: out, msPerFrame: out.length ? ms / out.length : 0 };
}

async function loop() {
  say('loading the face detector');
  for (;;) {
    try { await make(['GPU', 'CPU']); break; }
    catch (e) { say('the face detector could not start: ' + (e && e.message || e)); await sleep(30000); }
  }
  say('waiting for work (' + delegate + ')');
  for (;;) {
    let job = null;
    try {
      const r = await fetch('/api/faces/next?wait=1', { cache: 'no-store' });
      job = (await r.json()).job;
    } catch (e) { say('the server is not answering'); await sleep(2000); continue; }
    if (!job) continue;
    try {
      const got = await count(job);
      await fetch('/api/faces/' + job.id + '/done', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames: got.frames, model: 'blaze_face_full_range', delegate, msPerFrame: got.msPerFrame }),
      });
      counted.films++;
      say(`counted ${counted.films} films, ${counted.frames} frames (${delegate}); waiting`);
    } catch (e) {
      try {
        await fetch('/api/faces/' + job.id + '/fail', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: String(e && e.message || e) }) });
      } catch (e2) { /* the server will hand it out again */ }
      say('could not count a film: ' + (e && e.message || e));
    }
  }
}

loop();
