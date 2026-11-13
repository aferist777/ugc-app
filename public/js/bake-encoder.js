/* ═══════════════════════════════════════════════════════════════════════════
   THE BAKE WINDOW'S ENCODER - a worker of js/bake-worker.js, so the window draws the next frame while this
   turns the last one into YUV and encodes it (one thread doing both one after the other takes 45 ms a frame against 20-25).
   It gets the drawn frames as straight RGBA, converts each by ffmpeg's own rule (toI420 - the encoder's own conversion leaves the
   copy a little flatter than the render's frames), encodes H.264 with WebCodecs and sends the stream to
   the server in pieces itself; every buffer goes back to the window to be drawn into again.
     { start: { id, W, H, alpha, cfg } }   { frame: { k, buf } } (buf transferred)   { end: true }
   It answers { free: buf }, { done: { frames, convMs } } or { error }.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * RGBA (straight) -> I420 by ffmpeg's rule for its own conversions (swscale, BT.601, the TV range: Y within 1 of ffmpeg's, the
 * colour from each 2x2 block's mean - ffmpeg's filter differs by under 1 on a film). `alpha` - the frame twice as tall: the alpha
 * as the bottom half's Y, its colour neutral (lib/mv3b-render.js joins them again).
 */
function toI420(d, W, H, out, alpha) {
  const HH = alpha ? 2 * H : H;
  const cw = W >> 1;
  const uOff = W * HH, vOff = uOff + cw * (HH >> 1);
  for (let y = 0; y < H; y++) {
    let si = y * W * 4;
    const yi = y * W;
    for (let x = 0; x < W; x++, si += 4) out[yi + x] = (16.5 + (65.481 * d[si] + 128.553 * d[si + 1] + 24.966 * d[si + 2]) / 255) | 0;
  }
  for (let y = 0; y < H; y += 2) {
    const r0 = y * W * 4, r1 = r0 + W * 4;
    const ci = (y >> 1) * cw;
    for (let x = 0, a = r0, b = r1; x < W; x += 2, a += 8, b += 8) {
      const R = d[a] + d[a + 4] + d[b] + d[b + 4];
      const G = d[a + 1] + d[a + 5] + d[b + 1] + d[b + 5];
      const B = d[a + 2] + d[a + 6] + d[b + 2] + d[b + 6];
      const j = ci + (x >> 1);
      out[uOff + j] = (128.5 + (-37.797 * R - 74.203 * G + 112 * B) / 1020) | 0;
      out[vOff + j] = (128.5 + (112 * R - 93.786 * G - 18.214 * B) / 1020) | 0;
    }
  }
  if (alpha) {
    const yo = W * H;
    for (let i = 0, si = 3; i < W * H; i++, si += 4) out[yo + i] = d[si];
    const half = cw * (H >> 1);
    out.fill(128, uOff + half, uOff + 2 * half);
    out.fill(128, vOff + half, vOff + 2 * half);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let job = null;
let queue = Promise.resolve();

function _start({ id, W, H, alpha, cfg }) {
  if (job) { try { job.enc.close(); } catch (e) { /* closed */ } }
  const HH = alpha ? 2 * H : H;
  const j = { id, W, H, HH, alpha, step: Math.round(1e6 / cfg.framerate), keyEvery: Math.max(1, Math.round(cfg.framerate * 2)),
    yuv: new Uint8Array(W * HH * 3 / 2), pending: [], pendingBytes: 0, failed: null, frames: 0, convMs: 0 };
  j.enc = new VideoEncoder({
    output: (ch) => { const b = new Uint8Array(ch.byteLength); ch.copyTo(b); j.pending.push(b); j.pendingBytes += b.length; },
    error: (e) => { j.failed = e; },
  });
  j.enc.configure(cfg);
  job = j;
}

async function _send(j, k) {
  if (!j.pending.length) return;
  const blob = new Blob(j.pending, { type: 'application/octet-stream' });
  j.pending = [];
  j.pendingBytes = 0;
  const r = await fetch(`/api/fx-bake/${j.id}/chunk?n=${k}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
  if (!r.ok) throw new Error('the server did not take the drawn frames');
}

async function _frame(j, { k, buf }) {
  if (j.failed) throw j.failed;
  const q = performance.now();
  toI420(buf, j.W, j.H, j.yuv, j.alpha);
  j.convMs += performance.now() - q;
  self.postMessage({ free: buf }, [buf.buffer]);
  const vf = new VideoFrame(j.yuv, { format: 'I420', codedWidth: j.W, codedHeight: j.HH, timestamp: k * j.step, duration: j.step,
    colorSpace: { matrix: 'smpte170m', primaries: 'smpte170m', transfer: 'smpte170m', fullRange: false } });
  j.enc.encode(vf, { keyFrame: k % j.keyEvery === 0 });
  vf.close();
  j.frames = k + 1;
  while (j.enc.encodeQueueSize > 6 && !j.failed) await sleep(1);
  if (j.pendingBytes > 4e6) await _send(j, j.frames);
}

async function _end(j) {
  await j.enc.flush();
  if (j.failed) throw j.failed;
  j.enc.close();
  await _send(j, j.frames);
  self.postMessage({ done: { frames: j.frames, convMs: j.frames ? j.convMs / j.frames : 0 } });
  job = null;
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  queue = queue.then(async () => {
    if (m.start) _start(m.start);
    else if (m.frame && job) await _frame(job, m.frame);
    else if (m.end && job) await _end(job);
  }).catch((e) => {
    if (job) { try { job.enc.close(); } catch (x) { /* closed */ } }
    job = null;
    self.postMessage({ error: String((e && e.message) || e) });
  });
};
