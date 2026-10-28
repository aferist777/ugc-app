'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHO POINTS AT A LOOK OR AN ENVIRONMENT (phase V58, the owner 2026-10-29, (лк3), (лк4)).
//
// A look and an environment are deleted from their windows by a ✕ pressed twice (js/merge-v3/wk-setup.js,
// wk-env.js) and from their shelves - one route, routes/library.js _deleteOne. One that a project stands on is
// REFUSED in words, with the project's name: a talking head cast in that look, or set in that environment, would
// lose the person or the place in its frames ("отказ с именем проекта"); a 3D scene laid out from the environment
// would lose its room.
//
//   lookRefusal(rec, folderUrl) -> '' | words      rec - the look's record (data/obrazy.json)
//   envRefusal(url)             -> '' | words      url - the environment's address (/media/locations/<file>)
// ════════════════════════════════════════════════════════════════════════════

const _q = (s) => '"' + String(s || '').slice(0, 80) + '"';

function _heads() {
  try { return require('./projects-store').list(); } catch (e) { return []; }
}

function _scenes() {
  try {
    const S = require('./studio3d-store');
    return S.list().map((c) => { try { return { title: c.name || c.title || '', scene: S.get(c.id) }; } catch (e) { return null; } })
      .filter(x => x && x.scene);
  } catch (e) { return []; }
}

const _title = (p) => String((p && (p.title || p.name)) || 'a talking head');

/** A look cast in a talking head - by its id, or by a picture of its folder. */
function lookRefusal(rec, folderUrl) {
  if (!rec) return '';
  const id = String(rec.id || '');
  const dir = String(folderUrl || '').replace(/\/+$/, '');
  const hit = _heads().find((p) => {
    const c = (p && p.casting) || {};
    return (id && String(c.obrazId || '') === id) || (dir && String(c.obrazImage || '').startsWith(dir + '/'));
  });
  return hit ? 'This look is cast in the talking head ' + _q(_title(hit)) + ' - cast another look there first.' : '';
}

/** An environment a talking head is set in, or a 3D scene was laid out from. */
function envRefusal(url) {
  const u = String(url || '');
  if (!u) return '';
  const head = _heads().find(p => String(((p && p.casting) || {}).locationImage || '') === u);
  if (head) return 'The talking head ' + _q(_title(head)) + ' is set in this environment - choose another one there first.';
  const s = _scenes().find(({ scene }) => String((scene.source || {}).path || '') === u
    || (Array.isArray(scene.objects) && scene.objects.some(o => o && String(o.env || '') === u)));
  if (s) return 'The 3D scene ' + _q(s.title) + ' was laid out from this environment - it stays while the scene uses it.';
  return '';
}

module.exports = { lookRefusal, envRefusal };
