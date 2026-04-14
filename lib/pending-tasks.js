'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const {
  KIE_BASE,
  UPLOADS_DIR, CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR,
  SCENES_DIR, SCENES_FILE, REFS_DIR, REFS_FILE, DATA_DIR,
} = require('./config');
const { kieHeaders, downloadImage, compressBelow9MB, createThumbnail, resolveTask } = require('./helpers');

const STORE_FILE   = path.join(DATA_DIR, 'pending-tasks.json');
const MAX_AGE_MS   = 24 * 60 * 60 * 1000;  // 24 h — kie.ai tasks expire after this

// ── Directory key → absolute path ────────────────────────────────────────────
const DIR_MAP = {
  uploads:      UPLOADS_DIR,
  characters:   CHARACTERS_DIR,
  lookbooks:    LOOKBOOKS_DIR,
  environments: ENVIRONMENTS_DIR,
  scenes:       SCENES_DIR,
  refs:         REFS_DIR,
};

// ── Store helpers ─────────────────────────────────────────────────────────────
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { return []; }
}
function saveStore(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// ── Public: register a new pending task ──────────────────────────────────────
// dirKey   : one of the keys in DIR_MAP above
// prefix   : filename prefix used by resolveTask (e.g. 'generated', 'ref_gen')
// type     : human label for logging / post-processing switch
// meta     : { refId?, title?, originalPath?, generationPrompt?, actors?, description? }
function addPendingTask(taskId, dirKey, prefix, type, meta = {}) {
  if (!taskId) return;
  const list = loadStore();
  if (list.some(t => t.taskId === taskId)) return; // already tracked
  list.push({ taskId, dirKey, prefix, type, meta, createdAt: new Date().toISOString() });
  saveStore(list);
}

// ── Public: remove a task (called after successful poll by status routes) ─────
function removePendingTask(taskId) {
  const list = loadStore().filter(t => t.taskId !== taskId);
  saveStore(list);
}

// ── Scenes JSON helpers ───────────────────────────────────────────────────────
function loadScenes() {
  try { return JSON.parse(fs.readFileSync(SCENES_FILE, 'utf8')); } catch { return []; }
}
function saveScenes(list) {
  fs.writeFileSync(SCENES_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// ── Refs JSON helpers ─────────────────────────────────────────────────────────
function loadRefs() {
  try { return JSON.parse(fs.readFileSync(REFS_FILE, 'utf8')); } catch { return []; }
}
function saveRefs(list) {
  fs.writeFileSync(REFS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// ── Core: check kie.ai status for a single task ───────────────────────────────
async function checkTask(task) {
  const statusRes = await axios.get(
    `${KIE_BASE}/api/v1/jobs/recordInfo`,
    { params: { taskId: task.taskId }, headers: kieHeaders(), timeout: 15000 }
  );
  return statusRes.data?.data;
}

// ── Core: resolve one task — download + post-process ─────────────────────────
async function resolveOne(task) {
  const destDir = DIR_MAP[task.dirKey];
  if (!destDir) return null;

  // Uses helpers.resolveTask which is idempotent (won't re-download existing)
  const result = await resolveTask(task.taskId, destDir, task.prefix);
  if (result.state !== 'success') return null;

  const imagePath = result.imagePath;

  // ── Post-processing by type ────────────────────────────────────────────────
  if (task.type === 'ref-gen' && task.meta?.refId) {
    const refs  = loadRefs();
    const entry = refs.find(r => r.id === task.meta.refId);
    if (entry) {
      if (!Array.isArray(entry.generations)) entry.generations = [];
      if (!entry.generations.some(g => g.path === imagePath)) {
        entry.generations.push({ path: imagePath, seed: task.meta.seed || null, date: new Date().toISOString() });
        saveRefs(refs);
      }
    }
  }

  if (task.type === 'scene' && task.meta?.originalPath) {
    const scenes = loadScenes();
    const alreadySaved = scenes.some(s => s.taskId === task.taskId);
    if (!alreadySaved) {
      scenes.unshift({
        id:               Date.now(),
        taskId:           task.taskId,
        title:            task.meta.title            || '',
        originalPath:     task.meta.originalPath     || '',
        generatedPath:    imagePath,
        generationPrompt: task.meta.generationPrompt || '',
        actors:           task.meta.actors           || '',
        description:      task.meta.description      || '',
        date:             new Date().toISOString(),
        recovered:        true,
      });
      saveScenes(scenes);
    }
  }

  return { type: task.type, imagePath, meta: task.meta };
}

// ── Public: resolve all pending tasks ─────────────────────────────────────────
// Returns array of { type, imagePath, meta } for each newly recovered image.
async function resolveAll() {
  const list      = loadStore();
  const now       = Date.now();
  const recovered = [];
  const remaining = [];

  for (const task of list) {
    // Drop tasks older than 24 h (kie.ai tasks expire)
    if (now - new Date(task.createdAt).getTime() > MAX_AGE_MS) {
      console.log(`[pending-tasks] expired: ${task.taskId}`);
      continue;
    }

    try {
      const data  = await checkTask(task);
      const state = data?.state;

      if (state === 'success') {
        const r = await resolveOne(task);
        if (r) {
          recovered.push(r);
          console.log(`[pending-tasks] recovered: ${task.taskId} → ${r.imagePath}`);
        }
        // don't push to remaining → removed
      } else if (state === 'failed') {
        console.log(`[pending-tasks] failed: ${task.taskId}`);
        // don't push to remaining → removed
      } else {
        // still pending/running
        remaining.push(task);
      }
    } catch (e) {
      console.warn(`[pending-tasks] error checking ${task.taskId}: ${e.message}`);
      remaining.push(task); // keep for next check
    }
  }

  saveStore(remaining);
  return recovered;
}

module.exports = { addPendingTask, removePendingTask, resolveAll };
