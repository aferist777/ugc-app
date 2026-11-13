'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A PHONE'S HEIC, READ WITH THE APP'S OWN FFMPEG.
//
// A HEIC is HEVC pictures in a HEIF box. The shipped sharp reads the box but has no HEVC decoder, and
// Windows' own (the HEVC extension from the Store) refuses any program that is not a Store app - its
// licence check answers 0xC00DB3B3. The app's ffmpeg HAS an HEVC decoder; what it cannot do (6.1) is
// read the HEIF box. So the box is read here and the pictures handed to ffmpeg as a plain HEVC stream:
//
//   the primary item      an 'hvc1' picture (most phones), or a 'grid' of 'hvc1' tiles (an iPhone:
//                         512x512 tiles, eight by six) - the tiles are its 'dimg' references, row by row
//   each picture          its hvcC (VPS, SPS, PPS) and its data (length-prefixed NAL units, found by
//                         iloc - in the file or in idat) become Annex B: start codes, parameter sets first
//   ffmpeg                decodes every picture in ONE run to raw RGB, read in the range and matrix the
//                         box's 'colr' (nclx) says when it says one
//   the picture           tiles laid into the grid and cut to its output size, then 'irot' and 'imir'
//                         - the turn and the mirror of the primary item, in the order the box lists them
//
// What it answers is a JPEG. A colour profile (an iPhone's Display P3) is not carried over: the pixels
// are read as sRGB, which is close enough for a reference picture.
// ════════════════════════════════════════════════════════════════════════════

const { spawn } = require('child_process');
const sharp = require('sharp');

const RUN_MS = 60 * 1000;

const _bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const _4cc = (b, o) => b.toString('latin1', o, o + 4);

// ── The boxes ───────────────────────────────────────────────────────────────
// [{ type, start, end, body }] for the boxes laid one after another in b[from..to).
function _boxes(b, from, to) {
  const out = [];
  let o = from;
  while (o + 8 <= to) {
    let size = b.readUInt32BE(o);
    const type = _4cc(b, o + 4);
    let head = 8;
    if (size === 1) { size = Number(b.readBigUInt64BE(o + 8)); head = 16; }
    else if (size === 0) size = to - o;
    if (size < head || o + size > to) break;
    out.push({ type, start: o, end: o + size, body: o + head });
    o += size;
  }
  return out;
}
const _child = (list, type) => list.find(x => x.type === type) || null;

// An unsigned number of `n` bytes (0, 1, 2, 4 or 8).
function _uint(b, o, n) {
  if (n === 0) return 0;
  if (n === 1) return b[o];
  if (n === 2) return b.readUInt16BE(o);
  if (n === 4) return b.readUInt32BE(o);
  if (n === 8) return Number(b.readBigUInt64BE(o));
  throw _bad('this HEIC could not be read (a field of ' + n + ' bytes)');
}

function _iloc(b, box) {
  const v = b[box.body];
  let o = box.body + 4;
  const offSize = b[o] >> 4, lenSize = b[o] & 15, baseSize = b[o + 1] >> 4, idxSize = (v === 1 || v === 2) ? (b[o + 1] & 15) : 0;
  o += 2;
  const count = v < 2 ? b.readUInt16BE(o) : b.readUInt32BE(o);
  o += v < 2 ? 2 : 4;
  const items = new Map();
  for (let i = 0; i < count; i++) {
    const id = v < 2 ? b.readUInt16BE(o) : b.readUInt32BE(o);
    o += v < 2 ? 2 : 4;
    let method = 0;
    if (v === 1 || v === 2) { method = b.readUInt16BE(o) & 15; o += 2; }
    o += 2;                                                   // data_reference_index
    const base = _uint(b, o, baseSize); o += baseSize;
    const n = b.readUInt16BE(o); o += 2;
    const extents = [];
    for (let e = 0; e < n; e++) {
      o += idxSize;
      const off = _uint(b, o, offSize); o += offSize;
      const len = _uint(b, o, lenSize); o += lenSize;
      extents.push({ off: base + off, len });
    }
    items.set(id, { method, extents });
  }
  return items;
}

function _iinf(b, box) {
  const v = b[box.body];
  const o = box.body + 4 + (v === 0 ? 2 : 4);
  const types = new Map();
  for (const infe of _boxes(b, o, box.end).filter(x => x.type === 'infe')) {
    const iv = b[infe.body];
    if (iv < 2) continue;
    let p = infe.body + 4;
    const id = iv === 2 ? b.readUInt16BE(p) : b.readUInt32BE(p);
    p += iv === 2 ? 2 : 4;
    p += 2;                                                   // item_protection_index
    types.set(id, _4cc(b, p));
  }
  return types;
}

function _iref(b, box) {
  const v = b[box.body];
  const w = v === 0 ? 2 : 4;
  const refs = [];
  for (const r of _boxes(b, box.body + 4, box.end)) {
    let p = r.body;
    const from = _uint(b, p, w); p += w;
    const n = b.readUInt16BE(p); p += 2;
    const to = [];
    for (let i = 0; i < n; i++) { to.push(_uint(b, p, w)); p += w; }
    refs.push({ type: r.type, from, to });
  }
  return refs;
}

// The properties of every item, in the order ipma lists them (that order is the order of the
// transformations): Map(itemId -> [{ type, box }]).
function _props(b, iprp) {
  const kids = _boxes(b, iprp.body, iprp.end);
  const ipco = _child(kids, 'ipco');
  const ipma = _child(kids, 'ipma');
  if (!ipco || !ipma) throw _bad('this HEIC could not be read (no item properties)');
  const list = _boxes(b, ipco.body, ipco.end);
  const v = b[ipma.body], big = (b.readUInt32BE(ipma.body) & 1) === 1;
  let o = ipma.body + 4;
  const n = b.readUInt32BE(o); o += 4;
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const id = v < 1 ? b.readUInt16BE(o) : b.readUInt32BE(o);
    o += v < 1 ? 2 : 4;
    const k = b[o]; o += 1;
    const props = [];
    for (let j = 0; j < k; j++) {
      const idx = big ? (b.readUInt16BE(o) & 0x7fff) : (b[o] & 0x7f);
      o += big ? 2 : 1;
      if (idx > 0 && list[idx - 1]) props.push(list[idx - 1]);
    }
    map.set(id, props);
  }
  return map;
}

// ── One picture as HEVC ─────────────────────────────────────────────────────
const START = Buffer.from([0, 0, 0, 1]);

function _paramSets(b, hvcC) {
  const o = hvcC.body;
  const lenSize = (b[o + 21] & 3) + 1;
  let p = o + 22;
  const arrays = b[p]; p += 1;
  const nals = [];
  for (let a = 0; a < arrays; a++) {
    p += 1;                                                   // completeness, type
    const n = b.readUInt16BE(p); p += 2;
    for (let i = 0; i < n; i++) {
      const len = b.readUInt16BE(p); p += 2;
      nals.push(b.subarray(p, p + len)); p += len;
    }
  }
  return { lenSize, nals };
}

function _itemData(b, loc, idat) {
  const parts = [];
  for (const e of loc.extents) {
    if (loc.method === 1) {
      if (!idat) throw _bad('this HEIC could not be read (no idat)');
      parts.push(b.subarray(idat.body + e.off, idat.body + e.off + e.len));
    } else if (loc.method === 0) {
      parts.push(b.subarray(e.off, e.off + e.len));
    } else {
      throw _bad('this HEIC could not be read (item data by reference)');
    }
  }
  return Buffer.concat(parts);
}

function _annexB(b, item, loc, idat) {
  const hvcC = item.props.find(x => x.type === 'hvcC');
  if (!hvcC) throw _bad('this HEIC could not be read (a picture without hvcC)');
  const { lenSize, nals } = _paramSets(b, hvcC);
  const data = _itemData(b, loc, idat);
  const out = [];
  for (const n of nals) out.push(START, n);
  for (let p = 0; p + lenSize <= data.length;) {
    const len = _uint(data, p, lenSize); p += lenSize;
    if (len <= 0 || p + len > data.length) break;
    out.push(START, data.subarray(p, p + len));
    p += len;
  }
  return Buffer.concat(out);
}

const _ispe = (b, props) => {
  const x = props.find(p => p.type === 'ispe');
  return x ? { w: b.readUInt32BE(x.body + 4), h: b.readUInt32BE(x.body + 8) } : null;
};

// What the box says about the colour of the pixels: the range and the matrix ffmpeg should read them in.
function _nclx(b, props) {
  const c = props.find(p => p.type === 'colr' && _4cc(b, p.body) === 'nclx');
  if (!c) return null;
  const matrix = b.readUInt16BE(c.body + 8);
  const full = (b[c.body + 10] & 0x80) !== 0;
  // The names ffmpeg's scale filter takes for its in_color_matrix (5 and 6 are both BT.601).
  const m = { 1: 'bt709', 5: 'bt601', 6: 'bt601', 9: 'bt2020' }[matrix] || '';
  return { full, matrix: m };
}

// ── Decoding: every picture in one ffmpeg run ───────────────────────────────
function _ffmpeg(stream, w, h, count, colour) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = require('ffmpeg-static');
    const scale = ['scale=w=' + w + ':h=' + h];
    if (colour && colour.matrix) scale.push('in_color_matrix=' + colour.matrix);
    if (colour) scale.push('in_range=' + (colour.full ? 'full' : 'limited'));
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'hevc', '-i', 'pipe:0',
      '-fps_mode', 'passthrough', '-vf', scale.join(':') + ',format=rgb24', '-f', 'rawvideo', 'pipe:1'];
    const p = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    const timer = setTimeout(() => { try { p.kill(); } catch (e) { /* gone */ } }, RUN_MS);
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => { err = (err + d).slice(-600); });
    p.on('error', (e) => { clearTimeout(timer); reject(_bad('this HEIC could not be read (' + e.message + ')')); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const raw = Buffer.concat(out);
      const want = w * h * 3 * count;
      if (code !== 0 || raw.length < want) {
        return reject(_bad('this HEIC could not be read' + (err ? ' (' + err.trim().split('\n').pop() + ')' : '')));
      }
      resolve(raw.subarray(0, want));
    });
    p.stdin.on('error', () => { /* ffmpeg stopped reading: its own exit says why */ });
    p.stdin.end(stream);
  });
}

/**
 * A HEIC's bytes -> a JPEG of its primary picture, turned and mirrored the way the box says.
 * Throws in words (status 400) when it cannot.
 */
async function toJpeg(buf) {
  const b = buf;
  const top = _boxes(b, 0, b.length);
  const meta = _child(top, 'meta');
  if (!meta) throw _bad('this HEIC could not be read (no meta box)');
  const kids = _boxes(b, meta.body + 4, meta.end);
  const pitm = _child(kids, 'pitm'), iloc = _child(kids, 'iloc'), iinf = _child(kids, 'iinf'), iprp = _child(kids, 'iprp');
  if (!pitm || !iloc || !iinf || !iprp) throw _bad('this HEIC could not be read (an incomplete meta box)');
  const primary = b[pitm.body] === 0 ? b.readUInt16BE(pitm.body + 4) : b.readUInt32BE(pitm.body + 4);
  const locs = _iloc(b, iloc);
  const types = _iinf(b, iinf);
  const props = _props(b, iprp);
  const refs = _child(kids, 'iref') ? _iref(b, _child(kids, 'iref')) : [];
  const idat = _child(kids, 'idat');
  const item = (id) => ({ id, type: types.get(id), props: props.get(id) || [] });
  const main = item(primary);

  // The pictures to decode, and how they are laid out.
  let tiles, rows = 1, cols = 1, outW, outH;
  if (main.type === 'hvc1') {
    tiles = [main];
    const s = _ispe(b, main.props);
    if (!s) throw _bad('this HEIC could not be read (no size)');
    outW = s.w; outH = s.h;
  } else if (main.type === 'grid') {
    const d = _itemData(b, locs.get(primary) || { method: 0, extents: [] }, idat);
    const wide = (d[1] & 1) === 1;
    rows = d[2] + 1; cols = d[3] + 1;
    outW = wide ? d.readUInt32BE(4) : d.readUInt16BE(4);
    outH = wide ? d.readUInt32BE(8) : d.readUInt16BE(6);
    const dimg = refs.find(r => r.type === 'dimg' && r.from === primary);
    if (!dimg || dimg.to.length !== rows * cols) throw _bad('this HEIC could not be read (its grid of tiles)');
    tiles = dimg.to.map(item);
    if (tiles.some(t => t.type !== 'hvc1')) throw _bad('this HEIC could not be read (a tile that is not HEVC)');
  } else {
    throw _bad('this HEIC could not be read (a picture of kind ' + (main.type || 'unknown') + ')');
  }
  const ts = _ispe(b, tiles[0].props);
  if (!ts) throw _bad('this HEIC could not be read (no tile size)');
  const stream = Buffer.concat(tiles.map(t => {
    const loc = locs.get(t.id);
    if (!loc) throw _bad('this HEIC could not be read (a picture with no data)');
    return _annexB(b, t, loc, idat);
  }));
  const colour = _nclx(b, main.props) || _nclx(b, tiles[0].props);
  const raw = await _ffmpeg(stream, ts.w, ts.h, tiles.length, colour);

  // The tiles laid into the grid, cut to the output size.
  const W = outW, H = outH;
  const canvas = Buffer.alloc(W * H * 3);
  const tileBytes = ts.w * ts.h * 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = raw.subarray((r * cols + c) * tileBytes, (r * cols + c + 1) * tileBytes);
      const x0 = c * ts.w, y0 = r * ts.h;
      if (x0 >= W || y0 >= H) continue;
      const cw = Math.min(ts.w, W - x0), ch = Math.min(ts.h, H - y0);
      for (let y = 0; y < ch; y++) {
        tile.copy(canvas, ((y0 + y) * W + x0) * 3, y * ts.w * 3, (y * ts.w + cw) * 3);
      }
    }
  }

  // The turn and the mirror of the primary item, in the order the box lists them.
  let img = sharp(canvas, { raw: { width: W, height: H, channels: 3 } });
  const steps = main.props.filter(p => p.type === 'irot' || p.type === 'imir');
  if (steps.length) {
    // Each step on its own pipeline: sharp applies its rotate and flips in a fixed order of its own.
    let cur = await img.png({ compressionLevel: 0 }).toBuffer();
    for (const p of steps) {
      const s = sharp(cur);
      if (p.type === 'irot') {
        const quarter = b[p.body] & 3;                       // anticlockwise, in quarter turns
        cur = await s.rotate((360 - quarter * 90) % 360).png({ compressionLevel: 0 }).toBuffer();
      } else {
        // axis 0: about a vertical axis (left and right swap); 1: about a horizontal one.
        cur = await ((b[p.body] & 1) ? s.flip() : s.flop()).png({ compressionLevel: 0 }).toBuffer();
      }
    }
    img = sharp(cur);
  }
  return img.jpeg({ quality: 92 }).toBuffer();
}

module.exports = { toJpeg };
