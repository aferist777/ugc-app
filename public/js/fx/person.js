/* ═══════════════════════════════════════════════════════════════════════════
   THE PERSON'S MASK - for the effects that go BEHIND the person
   (js/fx/behind.js) and the magazine cover's head in front of its title. MediaPipe's Selfie Segmenter (Apache-2.0;
   vendor/mediapipe/selfie_segmenter.tflite, laid out by tools/fetch-mediapipe.js) is run on the clip's WINDOW'S PICTURE AS IT IS
   NOW - so the mask fits whatever that picture is (cut, framed, moved by the effects before) -, by the preview and by the app's
   bake window with this one code: the same picture, the same mask. Nothing is remembered from frame to frame (a frame sought is
   drawn as when it plays).
     personReady()            the segmenter loaded, once - resolves true, or false where it cannot run (the bake window waits)
     personOf(pic, canvas)    -> { mask, cut } | null for a picture (a canvas w x h): `mask` the person's alpha (white), `cut` the
                              picture inside it, both w x h on canvases `canvas(name, w, h)` gives; null until the segmenter is
                              there (asked for then - the preview paints again when it comes, js/fx/kit.js told)
   Page only.
   ═══════════════════════════════════════════════════════════════════════════ */

import { told } from './kit.js';

const VENDOR = '/vendor/mediapipe/';
// The picture handed to the segmenter is at most this many px along its long side (the model's own input is 256 x 256).
const LONG = 512;
let _seg = null;
let _ready = null;
let _idx = 0;
export let personDelegate = '';

/** The segmenter, loaded once (the window's GPU first, else its CPU). */
export function personReady() {
  if (_ready) return _ready;
  if (typeof document === 'undefined') { _ready = Promise.resolve(false); return _ready; }
  _ready = (async () => {
    const { ImageSegmenter } = await import(VENDOR + 'vision_bundle.mjs');
    const files = { wasmLoaderPath: VENDOR + 'wasm/vision_wasm_internal.js', wasmBinaryPath: VENDOR + 'wasm/vision_wasm_internal.wasm' };
    for (const delegate of ['GPU', 'CPU']) {
      try {
        _seg = await ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: VENDOR + 'selfie_segmenter.tflite', delegate },
          runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
        });
        personDelegate = delegate;
        break;
      } catch (e) { _seg = null; }
    }
    if (!_seg) return false;
    // The person's mask among its outputs: the one labelled so, else the last (one output - the person's).
    try {
      const labels = (_seg.getLabels && _seg.getLabels()) || [];
      const i = labels.findIndex((l) => /person|selfie|foreground/i.test(String(l)));
      _idx = i >= 0 ? i : Math.max(0, labels.length - 1);
    } catch (e) { _idx = 0; }
    told();
    return true;
  })().catch(() => { _seg = null; return false; });
  return _ready;
}

const _own = new Map();
function _canvas(name, w, h) {
  let c = _own.get(name);
  if (!c) { c = document.createElement('canvas'); _own.set(name, c); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

/** The person in picture `pic` - { mask, cut } (see the header), or null. */
export function personOf(pic, canvas) {
  if (!pic || !(pic.width > 1 && pic.height > 1)) return null;
  if (!_seg) { personReady(); return null; }
  const w = pic.width, h = pic.height;
  const k = Math.min(1, LONG / Math.max(w, h));
  const iw = Math.max(16, Math.round(w * k)), ih = Math.max(16, Math.round(h * k));
  const inp = _canvas('in', iw, ih);
  const ix = inp.getContext('2d');
  ix.imageSmoothingQuality = 'high';
  ix.clearRect(0, 0, iw, ih);
  ix.drawImage(pic, 0, 0, iw, ih);
  let res = null;
  let small = null;
  try {
    res = _seg.segment(inp);
    const masks = (res && res.confidenceMasks) || [];
    const m = masks[Math.min(_idx, masks.length - 1)];
    if (!m) return null;
    const f = m.getAsFloat32Array();
    const mw = m.width, mh = m.height;
    small = _canvas('m', mw, mh);
    const sx = small.getContext('2d');
    const id = sx.createImageData(mw, mh);
    const d = id.data;
    // The pack's matte curve: soft between 0.3 and 0.7 of the confidence, smooth at both ends.
    for (let i = 0, j = 0; i < f.length; i++, j += 4) {
      let v = (f[i] - 0.3) / 0.4;
      v = v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v);
      d[j] = 255; d[j + 1] = 255; d[j + 2] = 255; d[j + 3] = Math.round(v * 255);
    }
    sx.putImageData(id, 0, 0);
  } catch (e) {
    return null;
  } finally {
    try { if (res) res.close(); } catch (e) { /* gone */ }
  }
  // Up to the picture's size, softened a little (the pack's 0.0022 of the width).
  const mask = canvas('pmask', w, h);
  const mx = mask.getContext('2d');
  mx.clearRect(0, 0, w, h);
  mx.imageSmoothingEnabled = true;
  mx.imageSmoothingQuality = 'high';
  mx.filter = `blur(${Math.max(0.5, 0.0022 * w).toFixed(2)}px)`;
  mx.drawImage(small, 0, 0, w, h);
  mx.filter = 'none';
  const cut = canvas('pcut', w, h);
  const cx = cut.getContext('2d');
  cx.clearRect(0, 0, w, h);
  cx.drawImage(pic, 0, 0, w, h);
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(mask, 0, 0);
  cx.globalCompositeOperation = 'source-over';
  return { mask, cut };
}
