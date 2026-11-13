'use strict';

/* library-tidy.js - THE LIBRARY'S DATA TIDIED, ONCE (V91 cleanup block 5; the owner 2026-11-12: (чк14) "да, сначала на
   копии", (чк15) "по рекомендации").

   What no part of the program reads any more is taken out of the library at the first start of a program with this step:
     data/ui-state.json     the keys of pages and features that are gone (DEAD_KEYS, DEAD_PREFIXES - the census of 2026-11-13:
                            348 of the owner's 420 keys, and the 14 the cleanup's blocks 1-4 left behind); the chats' drafts and
                            the screens' state of projects that were deleted (PER_PROJECT); the countdowns of progress steps
                            that are gone (DEAD_STEPS); and TIDY_MARK - the window lets go of what it still holds that the
                            library no longer has (public/js/storage-sync.js), or its next page would push it all back up.
     data/settings.json     fields nothing reads (SETTINGS_GONE); New Character's ladders as lib/cv2-ladders.js reads them (the
                            steps of aggregators it no longer has, the `vision` ladder that went into the agents' ladder).
     data/library-cats.json the folders' `order` (the tree's order since V91 block 3).
     data/<file>            stores nothing reads (FILES_GONE).
     the server version's `owner` / `ownerNick` on timelines (projects/<p>/merge/*.json), projects (project.json) and the
                            render queue's entries (data/mv3-queue.json) - and a finished render's copy of its timeline.
     cache/<folder>         caches of what is gone (CACHE_GONE).
   Everything it rewrites or deletes is first copied into backups/<day> tidy/ at its own path - of settings.json only the
   fields taken out (the keys never go into a copy); caches are not copied. data/library.json `tidied` says it was done; a
   step that went wrong leaves no mark and the start after it tries again (every step can be run twice). A step added later
   raises TIDY.
   An older program reads the library as before - FORMAT does not change -, and the marks of ITS one-time steps stay
   (`done` in library.json, cache/thumbs-refresh.json, cache/char-drafts-dropped.json, cache/scen3-options-rebuilt.json):
   opened on this library after an update that did not come up, it would otherwise run them again and move the person's files.
   What goes on for good is not here: moves older than 30 days (lib/moves.js), a finished render's timeline (routes/mv3q.js),
   pitch copies no clip names (lib/pitch-copy.js sweep).
*/

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const KEYS = require('../public/js/highlights/keys.js');

const TIDY = 1;
const TIDY_MARK = 'ugc_tidied_v1';

// The localStorage keys nothing reads (the window's memory, mirrored into data/ui-state.json).
const DEAD_KEYS = new Set([
  '__sync_probe__', '__ugcEditSyncPatched', '__just_imported_at', 'setItem', 'removeItem',
  'all_geni_v1', 'app_nav_width_v1', 'applog_v2', 'archive_selected_cat_v2', 'asset_variants_v1', 'charAuditDecisions_v1',
  'combo_selected_panel', 'current_project_id', 'details_open_state', 'dlPrevH', 'dlProducts', 'dlSceneW', 'extendedvaluekey',
  'gen_timing_v2', 'genlog_history_v1', 'hooks_archive_v1', 'hooks_cats', 'image_engine_v1', 'lib_nr_view',
  'library2_shelf_v1', 'library_cat_v1', 'library_cats_h_v1', 'library_filter_v1', 'library_sc_origin_open_v1',
  'mv3-anim-last', 'mv3-send-partner', 'mv3_audio_made_w', 'mv3_cap_tiles_v1', 'mv3_fc_fold_v1', 'mv3_fx_auto_v1',
  'mv3_hl_ask_v1', 'mv3_hl_caption_picks_v1', 'mv3_hl_cat_v1', 'mv3_hl_kind_style_v1', 'mv3_hl_music_v1', 'mv3_hlg_tips_v1',
  'mv3_ins_folds_v1', 'mv3_left_w', 'mv3_lib_tab', 'mv3_open_project', 'mv3_pc_view_v1', 'mv3_pv_quality', 'mv3_timeline_h',
  'mv3_vc_cat_v1', 'mv3_zones_v1', 'obrazy', 'projects_v1', 'ps_gen_avg_v1', 'realism_enabled_v1', 'sv3_castfold_v1',
  'sv3_last_owner_v1', 'sv3_last_project_v1', 'sv3_lb_engine_v1', 'sv3_lib_v1', 'sv3_selected_v1', 'timeline_data_v2',
  'toonlib_shelf_v1', 'trancy-mode', 'ugc_home_layout_v1', 'ugc_last_project', 'ugc_montage_overrides_v1', 'uploads_cats',
  // the Character page (phase H8) - its preset, cv2_preset_v1, is New Character's and stays
  'cv2_advanced_v1', 'cv2_char_filter_v1', 'cv2_char_v1', 'cv2_create_mode_v1', 'cv2_i2i_v1', 'cv2_i2i_v2', 'cv2_kind_v1',
  'cv2_mode_v1', 'cv2_sheet_v1', 'cv2_side_open_v1', 'cv2_t2i_v1', 'cv2_t2i_v2', 'cv2_work_v1',
]);
// Whole families of them: no key the program writes now begins so.
const DEAD_PREFIXES = [
  'adm-activity-', 'biroly_', 'char_', 'cr_', 'edit_', 'edit2_', 'engine_params__', 'lib_mkchat_', 'mergev2_', 'mv2',
  'mv3_anim_', 'mv3_lib_cat_', 'scen_', 'scenario_', 'skleyka_', 'ss_state_', 'sv2_', 'ugc_lab_audio_',
];
// The keys that keep something per project: { <timeline key or project id>: ... }.
const PER_PROJECT = ['mv3_vc_draft_v1', 'mv3_pc_draft_v1', 'mv3_fc_draft_v1', 'mv3_lib_view_v1', 'mv3_frag_open_v1', 'mv3_step_v1'];
// public/js/progress.js: how long each step took, by its words - these steps are gone.
const EMA_KEY = 'sv3_gen_ema_v1';
const DEAD_STEPS = [
  'Adding that to the location', 'Drawing the frame of line ', 'Drawing the location', 'Extracting the location',
  'Extracting the outfit', 'Preparing the cut', 'Rendering the clip · ', 'Setting the voice', 'l2-enrich|', 'mkc-',
  'mv3-animate', 'mv3-suno',
];
const SETTINGS_GONE = ['engineDefaults', 'editNegativePrompt', 'imageEngine', 'imgVisionModel', 'mergeColW'];
const FILES_GONE = ['makechat-environments.json', 'makechat-lookbooks.json', 'scen3-frame-options.json', 'scen3-moods.json',
  'scen3-poses.json', 'video-presets.json'];
const CACHE_GONE = ['ass', 'cookbook', 'poses', 'voice-previews'];

const _json = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const _day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const _dead = (k) => DEAD_KEYS.has(k) || DEAD_PREFIXES.some((p) => k.startsWith(p));
const _dir = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return []; } };

/** The tidy, when this library has not had it. null when it had; else what it did, `backup` the folder of the copies. */
function run(root, { now = new Date() } = {}) {
  const markFile = path.join(root, 'data', 'library.json');
  let mark;
  try { mark = _json(markFile); } catch (e) { return null; }
  if ((Number(mark.tidied) || 0) >= TIDY) return null;

  const out = { keys: 0, entries: 0, settings: 0, cats: 0, files: 0, owner: 0, renders: 0, caches: 0, backup: '', failed: [] };
  let bak = '';
  // A copy of <root>/<rel> as it is, before it changes.
  const keep = (rel, text) => {
    if (!bak) {
      const dir = path.join(root, 'backups');
      let name = `${_day(now)} tidy`;
      for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${_day(now)} tidy (${i})`;
      bak = path.join(dir, name);
      out.backup = `backups/${name}`;
    }
    const to = path.join(bak, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (text != null) fs.writeFileSync(to, text);
    else fs.copyFileSync(path.join(root, rel), to);
  };
  const step = (name, fn) => { try { fn(); } catch (e) { out.failed.push(name + ': ' + e.message); } };

  // What lives: every timeline (by its key, and a highlights fragment's home) and every listed project.
  const live = new Set(['', 'draft']);
  let liveSure = true;
  step('owner', () => {
    const projects = path.join(root, 'projects');
    for (const d of _dir(projects)) {
      if (!d.isDirectory()) continue;
      const files = [path.join(d.name, 'project.json')];
      for (const f of _dir(path.join(projects, d.name, 'merge'))) {
        if (f.isFile() && f.name.toLowerCase().endsWith('.json')) files.push(path.join(d.name, 'merge', f.name));
      }
      for (const rel of files) {
        const abs = path.join(projects, rel);
        if (!fs.existsSync(abs)) continue;
        const timeline = rel.includes(path.sep + 'merge' + path.sep);
        let doc;
        try { doc = _json(abs); } catch (e) { if (timeline) liveSure = false; continue; }
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;
        if (timeline) {
          const key = String(doc.key || path.basename(rel).replace(/\.json$/i, ''));
          live.add(key);
          live.add(KEYS.homeOf(key));
        }
        if (!('owner' in doc) && !('ownerNick' in doc)) continue;
        keep(path.join('projects', rel));
        delete doc.owner;
        delete doc.ownerNick;
        writeFileAtomic(abs, JSON.stringify(doc, null, 2));
        out.owner++;
      }
    }
    const list = _json(path.join(root, 'data', 'project-list.json'));
    for (const p of (list && list.projects) || []) {
      const id = String((p && p.id) || '');
      if (id) { live.add(id); live.add('sv3_' + id); live.add(KEYS.homeKey(id)); }
    }
  });
  if (out.failed.length) liveSure = false;

  step('ui-state', () => {
    const file = path.join(root, 'data', 'ui-state.json');
    if (!fs.existsSync(file)) return;
    const st = _json(file);
    if (!st || typeof st !== 'object') return;
    for (const k of Object.keys(st)) if (_dead(k)) { delete st[k]; out.keys++; }
    // Only with every timeline read: a timeline that could not be read is not a deleted project.
    if (liveSure) {
      for (const k of PER_PROJECT) {
        let v;
        try { v = JSON.parse(st[k]); } catch (e) { continue; }
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
        let n = 0;
        for (const p of Object.keys(v)) if (!live.has(p)) { delete v[p]; n++; }
        if (n) { st[k] = JSON.stringify(v); out.entries += n; }
      }
    }
    try {
      const ema = JSON.parse(st[EMA_KEY]);
      if (ema && typeof ema === 'object' && !Array.isArray(ema)) {
        let n = 0;
        for (const label of Object.keys(ema)) if (DEAD_STEPS.some((p) => label.startsWith(p))) { delete ema[label]; n++; }
        if (n) { st[EMA_KEY] = JSON.stringify(ema); out.entries += n; }
      }
    } catch (e) { /* none kept yet */ }
    st[TIDY_MARK] = String(TIDY);
    keep('data/ui-state.json');
    writeFileAtomic(file, JSON.stringify(st, null, 2));
  });

  step('settings', () => {
    const file = path.join(root, 'data', 'settings.json');
    if (!fs.existsSync(file)) return;
    const cur = _json(file);                       // unreadable: thrown - never written over (it holds the keys)
    const gone = {};
    for (const k of SETTINGS_GONE) if (k in cur) { gone[k] = cur[k]; delete cur[k]; }
    const was = cur.cv2Ladders;
    if (was && typeof was === 'object' && !Array.isArray(was)) {
      const L = require('./cv2-ladders');
      const next = {};
      for (const op of Object.keys(L.OPS)) {
        const steps = Array.isArray(was[op]) ? was[op] : null;
        if (!steps) continue;
        const fixed = L.normalise(op, steps);
        // A ladder none of whose steps survived reads as the default: left out, it still does.
        if (steps.some((s) => s && fixed.some((f) => f.provider === s.provider && f.engine === s.engine))) next[op] = fixed;
      }
      if (JSON.stringify(next) !== JSON.stringify(was)) { gone.cv2Ladders = was; cur.cv2Ladders = next; }
    }
    if (!Object.keys(gone).length) return;
    keep('data/settings (fields taken out).json', JSON.stringify(gone, null, 2));
    writeFileAtomic(file, JSON.stringify(cur, null, 2));
    out.settings = Object.keys(gone).length;
  });

  step('library-cats', () => {
    const file = path.join(root, 'data', 'library-cats.json');
    if (!fs.existsSync(file)) return;
    const cats = _json(file);
    let n = 0;
    for (const kind of Object.values(cats || {})) if (kind && typeof kind === 'object' && 'order' in kind) { delete kind.order; n++; }
    if (!n) return;
    keep('data/library-cats.json');
    writeFileAtomic(file, JSON.stringify(cats, null, 2));
    out.cats = n;
  });

  step('queue', () => {
    const file = path.join(root, 'data', 'mv3-queue.json');
    if (!fs.existsSync(file)) return;
    const q = _json(file);
    let n = 0;
    for (const it of (q && q.items) || []) {
      if (!it || typeof it !== 'object') continue;
      if ('owner' in it || 'ownerNick' in it) { delete it.owner; delete it.ownerNick; n++; }
      if (it.status === 'done' && it.timeline) { delete it.timeline; out.renders++; n++; }
    }
    if (!n) return;
    keep('data/mv3-queue.json');
    writeFileAtomic(file, JSON.stringify(q, null, 2));
  });

  step('files', () => {
    for (const name of FILES_GONE) {
      const abs = path.join(root, 'data', name);
      if (!fs.existsSync(abs)) continue;
      keep(path.join('data', name));
      fs.rmSync(abs, { force: true });
      out.files++;
    }
  });

  step('caches', () => {
    for (const name of CACHE_GONE) {
      const abs = path.join(root, 'cache', name);
      if (!fs.existsSync(abs)) continue;
      fs.rmSync(abs, { recursive: true, force: true });
      out.caches++;
    }
  });

  if (!out.failed.length) {
    if (bak) keep('data/library.json');
    const fresh = _json(markFile);
    fresh.tidied = TIDY;
    writeFileAtomic(markFile, JSON.stringify(fresh, null, 2));
  }
  return out;
}

module.exports = { TIDY, TIDY_MARK, run };
