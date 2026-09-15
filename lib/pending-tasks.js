'use strict';

const fs   = require('fs');
const { writeFileAtomic } = require('./atomic-write');
const path = require('path');

// axios, KIE_BASE and kieHeaders went with the kie-only status check this file used to do
// itself. resolveTask speaks to whichever aggregator the task id names.
const {
  MEDIA, CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, DATA_DIR,
} = require('./config');
const { resolveTask } = require('./helpers');

const STORE_FILE   = path.join(DATA_DIR, 'pending-tasks.json');
const MAX_AGE_MS   = 24 * 60 * 60 * 1000;  // 24 h — kie.ai tasks expire after this

// ── Directory key → absolute path ────────────────────────────────────────────
const DIR_MAP = {
  images:       MEDIA.images,
  characters:   CHARACTERS_DIR,
  lookbooks:    LOOKBOOKS_DIR,
  environments: ENVIRONMENTS_DIR,
};

// ── Store helpers ─────────────────────────────────────────────────────────────
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { return []; }
}
function saveStore(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(STORE_FILE, JSON.stringify(list, null, 2));
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

// ── Core: resolve one task — check, download, post-process ───────────────────
// There used to be a checkTask() in front of this that asked kie.ai directly, and it was the
// reason recovery only ever worked for kie. A Replicate task is stored as 'repl:<id>' and an
// OpenRouter one as 'or:<file>'; asking kie about either returns nothing, so the task was put
// back on the pile and sat there until it expired at 24 hours - silently, because a task that
// is "still pending" looks exactly like one that is genuinely still running.
//
// resolveTask already dispatches on those prefixes and has all along. So the gate is gone and
// this asks it directly: one round trip instead of two, and all three aggregators instead of
// one. Returns null while a task is genuinely unfinished, which keeps it on the pile.
async function resolveOne(task) {
  const destDir = DIR_MAP[task.dirKey];
  if (!destDir) return null;

  // Idempotent: it will not re-download something already on disk.
  const result = await resolveTask(task.taskId, destDir, task.prefix);
  if (result.state !== 'success') {
    // Distinguished by the caller: failed drops the task, anything else keeps it.
    return result.state === 'failed' ? { failed: true, error: result.error } : null;
  }

  return { type: task.type, imagePath: result.imagePath, meta: task.meta };
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
      const r = await resolveOne(task);
      if (r && r.failed) {
        console.log(`[pending-tasks] failed: ${task.taskId} - ${r.error || 'no reason given'}`);
        // don't push to remaining → removed
      } else if (r) {
        recovered.push(r);
        console.log(`[pending-tasks] recovered: ${task.taskId} → ${r.imagePath}`);
        // don't push to remaining → removed
      } else {
        remaining.push(task);                    // still running
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
