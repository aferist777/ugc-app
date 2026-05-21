'use strict';

// Per-obraz folder management. The "Save obraz" flow on the frontend hits
// /api/obrazy/create BEFORE writing to localStorage so the look-image gets
// moved into its dedicated folder and the returned path is what ends up in
// obrazy.json. Deletion of an obraz triggers /api/obrazy/:id to wipe the
// folder. Pose-variations save to the folder is wired separately in
// routes/generate.js by passing obrazId through to resolveTask.

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const { OBRAZY_DIR, ROOT_DIR } = require('../lib/config');
const { obrazFolderName, obrazAbsFolder } = require('../lib/obrazy-store');

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

// ── POST /api/obrazy/create ─────────────────────────────────────────────────
// Body: { id, name, charPath }
// Creates obrazy/<slug>_<idShort>/, MOVES the look-image (and its thumb)
// from its current location into that folder, returns the new absolute web
// path. Idempotent: calling twice for the same id is a no-op the second time.
router.post('/obrazy/create', (req, res) => {
  try {
    const { id, name, charPath } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id is required' });
    if (!charPath) return res.status(400).json({ success: false, error: 'charPath is required' });

    const folder = obrazAbsFolder(name, id);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const folderRel = `/obrazy/${path.basename(folder)}`;

    const srcRel = _safeRel(charPath);
    const srcAbs = path.join(ROOT_DIR, srcRel);
    const filename = path.basename(srcAbs);
    const destAbs  = path.join(folder, filename);

    // If the file already lives in the target folder, just return its path.
    if (srcAbs === destAbs && fs.existsSync(destAbs)) {
      return res.json({ success: true, folder: folderRel, charPath: `${folderRel}/${filename}` });
    }
    if (!fs.existsSync(srcAbs)) {
      // Source missing — maybe browser-cached path that's already migrated.
      // If destination already exists, accept it; otherwise fail loudly.
      if (fs.existsSync(destAbs)) {
        return res.json({ success: true, folder: folderRel, charPath: `${folderRel}/${filename}` });
      }
      return res.status(404).json({ success: false, error: `source not found: ${charPath}` });
    }
    try { fs.renameSync(srcAbs, destAbs); }
    catch { fs.copyFileSync(srcAbs, destAbs); try { fs.unlinkSync(srcAbs); } catch {} }

    // Move thumb if present
    const baseNoExt = filename.replace(/\.[^.]+$/, '');
    const thumbSrc  = path.join(path.dirname(srcAbs), 'thumbs', baseNoExt + '.jpg');
    const thumbDest = path.join(folder, 'thumbs',                baseNoExt + '.jpg');
    if (fs.existsSync(thumbSrc)) {
      try {
        if (!fs.existsSync(path.dirname(thumbDest))) fs.mkdirSync(path.dirname(thumbDest), { recursive: true });
        fs.renameSync(thumbSrc, thumbDest);
      } catch {}
    }

    res.json({ success: true, folder: folderRel, charPath: `${folderRel}/${filename}` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
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
    const folder = obrazAbsFolder(name, id);
    if (fs.existsSync(folder)) {
      fs.rmSync(folder, { recursive: true, force: true });
      return res.json({ success: true, removed: path.basename(folder) });
    }
    res.json({ success: true, removed: null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
