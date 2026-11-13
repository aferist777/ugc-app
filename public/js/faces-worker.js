/* faces-worker.js - the app's hidden faces window.

   Asks the server for a film (GET /api/faces/next, held open), reads its frames as they come - raw RGBA, five a second,
   480 wide (GET /api/faces/frames/:id) -, finds the faces in each with MediaPipe's BlazeFace FULL RANGE model and answers
   with every frame's boxes (POST /api/faces/:id/done). On the window's graphics card when it has one, else on the
   processor (5.8 and 10.8 ms a frame on a laptop). The frames are counted as they arrive, so the server's
   ffmpeg goes at the detector's pace and nothing is held in memory but one frame.

   WHOLE PEOPLE: a film handed out with `people` also has its frames with NO face looked
   at for people - MediaPipe's EfficientDet-Lite0 (float16: int8 on the graphics card finds nothing), only "person", 28.5 ms a
   frame on the card - and the answer carries them beside the faces (`people`, one list a frame, empty where a face was).

   desktop/faces.js keeps it open, hidden, for as long as the app runs; it can be opened in a tab too (a test). */

/* THE MOST ACTIVE: a film handed
   out with `active` (fragmentation) is counted ten times a second, 960 wide, and besides the faces each frame carries
   - per face (the boxes' order): the change of its MOUTH and of its EYES since the frame before, the camera's own move taken
     off (mean luma change, the lower and the upper part of the box - a printed LEGO mouth answers this), and from the Face
     Landmarker on a crop around it the LIPS' gap and four blendshapes (jaw open, smile, brows up, eyes wide) - a live face's
     lips answer this; [m, e, lip, jaw, smile, brow, wide], null where the landmarker read nothing;
   - every second frame (5 a second) the THINGS of any kind EfficientDet finds - [kind, x, y, w, h, score, changed share];
   - the camera's own move, pan and tilt in pixels of a 480 frame (the shift of the column and row profiles).
   The people of the frames with no face come from the same things ('person'), so `people` is there as for auto. */
import { FaceDetector, ObjectDetector, FaceLandmarker } from '/vendor/mediapipe/vision_bundle.mjs';

const FILES = {
  wasmLoaderPath: '/vendor/mediapipe/wasm/vision_wasm_internal.js',
  wasmBinaryPath: '/vendor/mediapipe/wasm/vision_wasm_internal.wasm',
};
const MODEL = '/vendor/mediapipe/blaze_face_full_range.tflite';
const MIN_SCORE = 0.5;
const PEOPLE_MODEL = '/vendor/mediapipe/efficientdet_lite0.tflite';
const PEOPLE_SCORE = 0.4;
const PEOPLE_MIN_AREA = 0.01;          // a person smaller than this share of the frame is not one to follow

const el = document.getElementById('faces-state');
const say = (s) => { if (el) el.textContent = s; };
const r3 = (x) => Math.round(x * 1000) / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let det = null;
let delegate = '';
let pdet = null;                        // the person detector, made the first time a film asks for people
let pdelegate = '';
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

// The person detector - the graphics card when it can, else the processor (float16 both: 28.5 / 69 ms a frame).
async function makePeople(prefer) {
  let last = null;
  for (const d of prefer) {
    try {
      const x = await ObjectDetector.createFromOptions(FILES, {
        baseOptions: { modelAssetPath: PEOPLE_MODEL, delegate: d }, runningMode: 'IMAGE', scoreThreshold: PEOPLE_SCORE,
        categoryAllowlist: ['person'], maxResults: 6,
      });
      if (pdet) { try { pdet.close(); } catch (e) { /* gone */ } }
      pdet = x;
      pdelegate = d;
      return;
    } catch (e) { last = e; }
  }
  throw last || new Error('the person detector could not start');
}

function peopleIn(img, fw, fh) {
  let r;
  try { r = pdet.detect(img); }
  catch (e) {
    if (pdelegate !== 'GPU') throw e;
    throw Object.assign(e, { gpuLost: true });
  }
  return r.detections.filter((d) => d.categories[0] && d.categories[0].score >= PEOPLE_SCORE
      && (d.boundingBox.width * d.boundingBox.height) / (fw * fh) >= PEOPLE_MIN_AREA)
    .map((d) => [r3(d.boundingBox.originX / fw), r3(d.boundingBox.originY / fh), r3(d.boundingBox.width / fw), r3(d.boundingBox.height / fh),
      r3(d.categories[0].score)]);
}

// ── The most active: the landmarker on a crop around each face, every kind of thing, the camera's own move ──
const MARKS_MODEL = '/vendor/mediapipe/face_landmarker.task';
const OBJ_SCORE = 0.3;
const OBJ_MIN_AREA = 0.01;
const NOISE = 14, MAXS = 24, MAXT = 12;     // a pixel changed by more than NOISE (of 255) moved; the camera's move searched up to MAXS/MAXT px
let mdet = null, mdelegate = '';
let odet = null, odelegate = '';
async function makeMarks(prefer) {
  let last = null;
  for (const d of prefer) {
    try {
      const x = await FaceLandmarker.createFromOptions(FILES, {
        baseOptions: { modelAssetPath: MARKS_MODEL, delegate: d }, runningMode: 'IMAGE', numFaces: 1, outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
      });
      if (mdet) { try { mdet.close(); } catch (e) { /* gone */ } }
      mdet = x; mdelegate = d;
      return;
    } catch (e) { last = e; }
  }
  throw last || new Error('the face landmarker could not start');
}
async function makeObjects(prefer) {
  let last = null;
  for (const d of prefer) {
    try {
      const x = await ObjectDetector.createFromOptions(FILES, {
        baseOptions: { modelAssetPath: PEOPLE_MODEL, delegate: d }, runningMode: 'IMAGE', scoreThreshold: OBJ_SCORE, maxResults: 10,
      });
      if (odet) { try { odet.close(); } catch (e) { /* gone */ } }
      odet = x; odelegate = d;
      return;
    } catch (e) { last = e; }
  }
  throw last || new Error('the object detector could not start');
}
const _crop = document.createElement('canvas');
_crop.width = 256; _crop.height = 256;
const _cctx = _crop.getContext('2d');
const _src = document.createElement('canvas');
const _sctx = _src.getContext('2d');
// Each face's lips and look: the landmarker on a square crop 2.2 times the box, around it.
function marksOf(img, faceBoxes, fw, fh) {
  if (!faceBoxes.length) return [];
  if (_src.width !== fw || _src.height !== fh) { _src.width = fw; _src.height = fh; }
  _sctx.putImageData(img, 0, 0);
  return faceBoxes.map((b) => {
    const cx = (b[0] + b[2] / 2) * fw, cy = (b[1] + b[3] / 2) * fh;
    const side = Math.max(b[2] * fw, b[3] * fh) * 2.2;
    _cctx.fillStyle = '#000'; _cctx.fillRect(0, 0, 256, 256);
    _cctx.drawImage(_src, cx - side / 2, cy - side / 2, side, side, 0, 0, 256, 256);
    let r;
    try { r = mdet.detect(_crop); }
    catch (e) { if (mdelegate !== 'GPU') throw e; throw Object.assign(e, { gpuLost: 'marks' }); }
    const lm = r.faceLandmarks && r.faceLandmarks[0];
    if (!lm) return null;
    const fhgt = Math.hypot(lm[10].x - lm[152].x, lm[10].y - lm[152].y) || 1;
    const lip = Math.hypot(lm[13].x - lm[14].x, lm[13].y - lm[14].y) / fhgt;
    const cats = (r.faceBlendshapes && r.faceBlendshapes[0] && r.faceBlendshapes[0].categories) || [];
    const bs = (name) => { const c = cats.find((x) => x.categoryName === name); return c ? c.score : 0; };
    return [r3(lip), r3(bs('jawOpen')), r3((bs('mouthSmileLeft') + bs('mouthSmileRight')) / 2), r3(bs('browInnerUp')),
      r3((bs('eyeWideLeft') + bs('eyeWideRight')) / 2)];
  });
}
function objectsIn(img, fw, fh) {
  let r;
  try { r = odet.detect(img); }
  catch (e) { if (odelegate !== 'GPU') throw e; throw Object.assign(e, { gpuLost: 'objects' }); }
  return r.detections.filter((d) => d.categories[0] && d.categories[0].score >= OBJ_SCORE
      && (d.boundingBox.width * d.boundingBox.height) / (fw * fh) >= OBJ_MIN_AREA)
    .map((d) => [d.categories[0].categoryName, r3(d.boundingBox.originX / fw), r3(d.boundingBox.originY / fh),
      r3(d.boundingBox.width / fw), r3(d.boundingBox.height / fh), r3(d.categories[0].score)]);
}
// The frame's brightness, every second pixel each way (480 wide for a 960 frame): what the motion is read from.
function lumaHalf(rgba, fw, fh) {
  const w = fw >> 1, h = fh >> 1;
  const y = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const row = (j * 2) * fw * 4;
    for (let i = 0; i < w; i++) { const k = row + i * 8; y[j * w + i] = (rgba[k] * 77 + rgba[k + 1] * 150 + rgba[k + 2] * 29) >> 8; }
  }
  return { y, w, h };
}
function profilesOf(Y) {
  const col = new Float32Array(Y.w), row = new Float32Array(Y.h);
  for (let j = 0; j < Y.h; j++) { const r = j * Y.w; let s = 0; for (let i = 0; i < Y.w; i++) { const v = Y.y[r + i]; col[i] += v; s += v; } row[j] = s / Y.w; }
  for (let i = 0; i < Y.w; i++) col[i] /= Y.h;
  return { col, row };
}
function bestShift(a, b, n, max, edge) {
  let best = 0, bd = Infinity, d0 = 0;
  for (let s = -max; s <= max; s++) {
    let d = 0, k = 0;
    for (let x = edge; x < n - edge; x++) { d += Math.abs(a[x] - b[x - s]); k++; }
    d /= k; if (s === 0) d0 = d; if (d < bd) { bd = d; best = s; }
  }
  return Math.abs(best) >= 2 && bd < d0 * 0.6 ? best : 0;
}
// A region's mean change and the share of its pixels that moved, the earlier frame shifted by the camera's move.
function regionDiff(Y, P, rx0, ry0, rx1, ry1, px, py) {
  const x0 = Math.max(0, Math.round(rx0 * Y.w)), x1 = Math.min(Y.w, Math.round(rx1 * Y.w));
  const y0 = Math.max(0, Math.round(ry0 * Y.h)), y1 = Math.min(Y.h, Math.round(ry1 * Y.h));
  let s = 0, n = 0, ch = 0;
  for (let j = y0; j < y1; j++) {
    const jj = j - py; if (jj < 0 || jj >= Y.h) continue;
    for (let i = x0; i < x1; i++) {
      const ii = i - px; if (ii < 0 || ii >= Y.w) continue;
      const d = Math.abs(Y.y[j * Y.w + i] - P.y[jj * Y.w + ii]); s += d; n++; if (d > NOISE) ch++;
    }
  }
  return n ? [Math.round(s / n * 100) / 100, r3(ch / n)] : [0, 0];
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
  // Whole people in the frames with no face, when the film asks for them. A detector that will not start
  // leaves the film without people (said in the answer), not without faces.
  let people = null;
  let msP = 0, nP = 0, peopleError = '';
  // The most active, for fragmentation: the landmarker and the detector of every kind of thing. Its people come
  // from the same things - the person detector is not run beside it.
  let act = null, msA = 0, activeError = '';
  if (job.active) {
    try {
      if (!mdet) await makeMarks(['GPU', 'CPU']);
      if (!odet) await makeObjects(['GPU', 'CPU']);
      act = { faces: [], objects: [], pan: [], tilt: [] };
      if (job.people) people = [];
    } catch (e) { activeError = String(e && e.message || e).slice(0, 200); }
  }
  if (job.people && !act) {
    try { if (!pdet) await makePeople(['GPU', 'CPU']); people = []; }
    catch (e) { peopleError = String(e && e.message || e).slice(0, 200); }
  }
  let prevY = null, prevP = null, lastObjs = [];
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
      if (act) {
        // The camera's own move, then each face's mouth and eyes after it, its lips and look, and every second frame
        // the things and how much of each moved.
        const t1 = performance.now();
        const fb = out[out.length - 1];
        const Y = lumaHalf(frame, job.fw, job.fh);
        const P = profilesOf(Y);
        let pan = 0, tilt = 0;
        if (prevY) {
          pan = bestShift(P.col, prevP.col, Y.w, MAXS, Math.round(Y.w / 10));
          tilt = bestShift(P.row, prevP.row, Y.h, MAXT, Math.round(Y.h / 11));
        }
        // The lips and the look tell faces apart - who of them speaks, who reacts: read only where there are two or more (one
        // face is the window's target whoever speaks; its mouth's pixels still say whether it does).
        let marks = [];
        if (fb.length >= 2) {
          try { marks = marksOf(img, fb, job.fw, job.fh); }
          catch (e) { if (!e.gpuLost) throw e; await makeMarks(['CPU']); marks = marksOf(img, fb, job.fw, job.fh); }
        }
        act.faces.push(fb.map((b, k) => {
          const m = prevY ? regionDiff(Y, prevY, b[0] + 0.2 * b[2], b[1] + 0.6 * b[3], b[0] + 0.8 * b[2], b[1] + b[3], pan, tilt)[0] : 0;
          const e = prevY ? regionDiff(Y, prevY, b[0] + 0.1 * b[2], b[1] + 0.15 * b[3], b[0] + 0.9 * b[2], b[1] + 0.5 * b[3], pan, tilt)[0] : 0;
          return marks[k] ? [m, e, ...marks[k]] : [m, e];
        }));
        let objs = [];
        if (out.length % 2 === 1) {
          try { objs = objectsIn(img, job.fw, job.fh); }
          catch (e) { if (!e.gpuLost) throw e; await makeObjects(['CPU']); objs = objectsIn(img, job.fw, job.fh); }
          objs = objs.map((o) => [...o, prevY ? regionDiff(Y, prevY, o[1], o[2], o[1] + o[3], o[2] + o[4], pan, tilt)[1] : 0]);
          lastObjs = objs;
        }
        act.objects.push(objs);
        act.pan.push(pan);
        act.tilt.push(tilt);
        if (people) {
          people.push(fb.length ? [] : lastObjs.filter((o) => o[0] === 'person' && o[5] >= PEOPLE_SCORE && o[3] * o[4] >= PEOPLE_MIN_AREA)
            .map((o) => o.slice(1, 6)));
        }
        prevY = Y; prevP = P;
        msA += performance.now() - t1;
      } else if (people) {
        let ps = [];
        if (!out[out.length - 1].length) {
          const t1 = performance.now();
          try { ps = peopleIn(img, job.fw, job.fh); }
          catch (e) {
            if (!e.gpuLost) throw e;
            await makePeople(['CPU']);
            ps = peopleIn(img, job.fw, job.fh);
          }
          msP += performance.now() - t1;
          nP++;
        }
        people.push(ps);
      }
      counted.frames++;
      if (out.length % 25 === 0) say(`counting ${out.length} / ${job.n} frames (${delegate}${act ? ', the most active ' + mdelegate + '/' + odelegate : people ? ', people ' + pdelegate : ''})`);
    }
  }
  return { frames: out, msPerFrame: out.length ? ms / out.length : 0, people, peopleError,
    msPerPeopleFrame: nP ? msP / nP : 0,
    active: act ? { ...act, msPerFrame: out.length ? msA / out.length : 0, marksDelegate: mdelegate, objectsDelegate: odelegate } : null,
    activeError };
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
        body: JSON.stringify({ frames: got.frames, model: 'blaze_face_full_range', delegate, msPerFrame: got.msPerFrame,
          ...(job.people ? { people: got.people, peopleModel: 'efficientdet_lite0', peopleDelegate: got.active ? odelegate : pdelegate,
            msPerPeopleFrame: got.msPerPeopleFrame, peopleError: got.peopleError } : {}),
          ...(job.active ? { active: got.active, activeError: got.activeError } : {}) }),
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
