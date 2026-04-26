'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const DATA_DIR = path.join(__dirname, '..', 'data');

function _read(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name + '.json'), 'utf8')); }
  catch { return []; }
}
function _write(name, list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(list, null, 2), 'utf8');
}

router.get('/userdata/obrazy',   (_req, res) => res.json({ success: true, list: _read('obrazy') }));
router.get('/userdata/projects', (_req, res) => res.json({ success: true, list: _read('projects') }));

router.post('/userdata/obrazy', (req, res) => {
  const { list } = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ success: false, error: 'list must be array' });
  try { _write('obrazy', list); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/userdata/projects', (req, res) => {
  const { list } = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ success: false, error: 'list must be array' });
  try { _write('projects', list); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
