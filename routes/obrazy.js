'use strict';

// Per-obraz folder management. The "Save obraz" flow on the frontend hits
// /api/obrazy/create BEFORE writing to localStorage so the look-image gets
// moved into its dedicated folder and the returned path is what ends up in
// obrazy.json. Deletion of an obraz triggers /api/obrazy/:id to wipe the
// folder. Pose-variations save to the folder is wired separately in
// routes/generate.js by passing obrazId through to resolveTask.

const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const router  = express.Router();

const { OBRAZY_DIR, ROOT_DIR, DATA_DIR } = require('../lib/config');
const { obrazFolderName, obrazAbsFolder } = require('../lib/obrazy-store');
const { deleteDraftByObraz } = require('../lib/char-store');

function _safeRel(p) {
  return String(p || '').replace(/^\//, '');
}

// Return the relative web path of the earliest-mtime image inside an obraz folder.
// Skips the thumbs/ subdir and anything that isn't an image. Returns null when
// the folder doesn't exist or has no images.
function _earliestImageInFolder(absFolder) {
  if (!fs.existsSync(absFolder)) return null;
  let earliest = null;
  let earliestMtime = Infinity;
  try {
    for (const f of fs.readdirSync(absFolder)) {
      if (f === 'thumbs') continue;
      if (!/\.(jpg|jpeg|png|webp)$/i.test(f)) continue;
      try {
        const st = fs.statSync(path.join(absFolder, f));
        if (st.mtimeMs < earliestMtime) {
          earliestMtime = st.mtimeMs;
          earliest = f;
        }
      } catch {}
    }
  } catch { return null; }
  if (!earliest) return null;
  return `/obrazy/${path.basename(absFolder)}/${earliest}`;
}

// ── GET /api/obrazy/main-images ─────────────────────────────────────────────
// Returns { obrazId: '/obrazy/<folder>/<earliest>.jpg', ... } for every obraz
// in data/obrazy.json. The earliest-by-mtime file inside each obraz folder is
// treated as the "main look image" — by design the look-image is saved first,
// the posevars are auto-generated after, so the earliest mtime is always the
// look-image. Filesystem metadata is more reliable than the timestamp encoded
// in filenames (which can be re-set by copy operations).
const { OBRAZY_FILE } = require('../lib/config');
router.get('/obrazy/main-images', (_req, res) => {
  try {
    const list = JSON.parse(fs.readFileSync(OBRAZY_FILE, 'utf8'));
    const out = {};
    for (const o of list) {
      if (!o.id) continue;
      const folder = obrazAbsFolder(o.name, o.id);
      const main = _earliestImageInFolder(folder);
      if (main) out[o.id] = main;
    }
    res.json({ success: true, mainImages: out });
  } catch (e) {
    res.json({ success: true, mainImages: {} });
  }
});

// ── POST /api/obrazy/delete-file ────────────────────────────────────────────
// Body: { path } — a web-style path inside obrazy/ or characters/. Unlinks the
// file and its thumbnail. Used by the rerun flow which no longer archives old
// posevars to editResults[] but simply deletes them. Restricted to obrazy/ and
// characters/ subtrees so a malformed path can't escape the project root.
router.post('/obrazy/delete-file', (req, res) => {
  try {
    const p = String(req.body?.path || '').replace(/^\//, '');
    if (!p) return res.status(400).json({ success: false, error: 'path is required' });
    if (!p.startsWith('obrazy/') && !p.startsWith('characters/')) {
      return res.status(400).json({ success: false, error: 'path must be under obrazy/ or characters/' });
    }
    const abs = path.join(ROOT_DIR, p);
    const rootResolved = path.resolve(ROOT_DIR);
    if (!path.resolve(abs).startsWith(rootResolved + path.sep)) {
      return res.status(400).json({ success: false, error: 'path outside project root' });
    }
    if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch {} }
    // Thumb path: same dir + /thumbs/<basename>.jpg
    const baseNoExt = path.basename(p).replace(/\.[^.]+$/, '');
    const thumb = path.join(path.dirname(abs), 'thumbs', baseNoExt + '.jpg');
    if (fs.existsSync(thumb)) { try { fs.unlinkSync(thumb); } catch {} }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/obrazy/:id ──────────────────────────────────────────────────
// Removes the entire folder for one obraz. Called by the frontend when the user
// deletes an obraz from the Образы grid. Frontend resolves the folder name
// from the obraz's name+id via the same helper before sending.
router.delete('/obrazy/:id', (req, res) => {
  try {
    const id = req.params.id;
    const name = req.query.name || '';
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    // Drop the provisional draft character tied to this obraz, if any (a
    // PROMOTED character has draft:false and is left untouched).
    let draftRemoved = false;
    try { draftRemoved = deleteDraftByObraz(id); } catch {}
    const folder = obrazAbsFolder(name, id);
    if (fs.existsSync(folder)) {
      fs.rmSync(folder, { recursive: true, force: true });
      return res.json({ success: true, removed: path.basename(folder), draftRemoved });
    }
    res.json({ success: true, removed: null, draftRemoved });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/obrazy/prune-missing ──────────────────────────────────────────
// Removes "orphan" obrazy whose image files are ALL missing on disk (left behind
// by a partial import or deleted media) so they stop 404-ing in the Looks row.
// Also drops geni gallery entries whose file is gone. Conservative: an obraz is
// KEPT if ANY of its images (char or a variation) still exists on disk.
function _existsUnderRoot(url) {
  if (!url || typeof url !== 'string') return false;
  const rel  = url.split('?')[0].replace(/^\/+/, '');
  if (!rel) return false;
  const abs  = path.resolve(ROOT_DIR, rel);
  const root = path.resolve(ROOT_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) return false;   // escape guard
  try { return fs.existsSync(abs) && fs.statSync(abs).isFile(); } catch { return false; }
}
function _obrazImageUrls(o) {
  const out = [];
  if (o && typeof o.char === 'string') out.push(o.char);
  if (o && Array.isArray(o.variations)) for (const v of o.variations) {
    if (v && v !== 'error' && typeof v === 'string') out.push(v);
  }
  return out;
}
router.post('/obrazy/prune-missing', (_req, res) => {
  try {
    // obrazy.json — drop entries with no surviving image file
    let obrazy = [];
    try { obrazy = JSON.parse(fs.readFileSync(OBRAZY_FILE, 'utf8')); } catch {}
    if (!Array.isArray(obrazy)) obrazy = [];
    const removedObrazy = [];
    const keptObrazy = obrazy.filter(o => {
      const hasImage = _obrazImageUrls(o).some(_existsUnderRoot);
      if (!hasImage) { removedObrazy.push({ id: o && o.id, name: (o && o.name) || '' }); return false; }
      return true;
    });
    if (removedObrazy.length) writeFileAtomic(OBRAZY_FILE, JSON.stringify(keptObrazy, null, 2));

    // geni.json — drop history entries whose file is gone
    const geniFile = path.join(DATA_DIR, 'geni.json');
    let geni = [];
    try { geni = JSON.parse(fs.readFileSync(geniFile, 'utf8')); } catch {}
    let removedGeni = 0, keptGeni = Array.isArray(geni) ? geni : [];
    if (Array.isArray(geni)) {
      keptGeni = geni.filter(g => { const ok = _existsUnderRoot(g && g.path); if (!ok) removedGeni++; return ok; });
      if (removedGeni) writeFileAtomic(geniFile, JSON.stringify(keptGeni, null, 2));
    }

    res.json({ success: true, removedObrazy, removedGeniCount: removedGeni, obrazy: keptObrazy, geni: keptGeni });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
