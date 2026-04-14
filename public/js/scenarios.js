/* ═══════════════════════════════════════
   SCENARIOS & DETAILS tabs
   ═══════════════════════════════════════ */

// ── ElevenLabs voice list ─────────────────────────────────────────────────────
// id: null → use name as API value; id: string → use id as API value + preview available
const ELEVENLABS_VOICES = [
  // Named presets (no preview URL available)
  { name: 'Rachel',   id: null, desc: 'Default female' },
  { name: 'Aria',     id: null, desc: '' },
  { name: 'Roger',    id: null, desc: '' },
  { name: 'Sarah',    id: null, desc: '' },
  { name: 'Charlie',  id: null, desc: '' },
  { name: 'George',   id: null, desc: '' },
  { name: 'River',    id: null, desc: '' },
  { name: 'Alice',    id: null, desc: '' },
  { name: 'Matilda',  id: null, desc: '' },
  { name: 'Will',     id: null, desc: '' },
  { name: 'Eric',     id: null, desc: '' },
  { name: 'Daniel',   id: null, desc: '' },
  { name: 'Lily',     id: null, desc: '' },
  { name: 'Bill',     id: null, desc: '' },
  // Extended voices with IDs (preview available)
  { name: 'Adam',        id: 'pNInz6obpgDQGcFmaJgB', desc: 'Dominant, Firm' },
  { name: 'Brian',       id: 'nPczCjzI2devNBz1zQrb', desc: 'Deep, Resonant, Comforting' },
  { name: 'Callum',      id: 'N2lVS1w4EtoT3dr4eOWO', desc: 'Husky Trickster' },
  { name: 'Charlotte',   id: 'XB0fDUnXU5powFXDhCwa', desc: '' },
  { name: 'Chris',       id: 'iP95p4xoKVk53GoZ742B', desc: 'Charming, Down-to-Earth' },
  { name: 'Jessica',     id: 'cgSgspJ2msm6clMCkdW9', desc: 'Playful, Bright, Warm' },
  { name: 'Laura',       id: 'FGY2WhTYpPnrIDTdsKH5', desc: 'Enthusiast, Quirky Attitude' },
  { name: 'Liam',        id: 'TX3LPaxmHKxFdv7VOQHJ', desc: 'Energetic, Social Media Creator' },
  { name: 'Ellen',       id: 'BIvP0GN1cAtSRTxNHnWS', desc: 'Serious, Direct, Confident' },
  { name: 'James',       id: 'EkK5I93UQWFDigLMpZcX', desc: 'Husky, Engaging, Bold' },
  { name: 'Hope',        id: 'tnSpp4vdxKPjI9w0GnoV', desc: 'Upbeat, Clear' },
  { name: 'Austin',      id: 'Bj9UqZbhQsanLzgalpEG', desc: 'Deep, Raspy, Authentic' },
  { name: 'Harry',       id: 'SOYHLrjzK2X1ezoPC6cr', desc: 'Fierce Warrior' },
  { name: 'Amelia',      id: 'ZF6FPAbjXT4488VcRRnw', desc: 'Enthusiastic, Expressive' },
  { name: 'Olivia',      id: '1hlpeD1ydbI2ow0Tt3EW', desc: 'Smooth, Warm, Engaging' },
  { name: 'Emily',       id: '1cxc5c3E9K6F1wlqOJGV', desc: 'Gentle, Soft, Meditative' },
  { name: 'Bella',       id: 'hpp4J3VqNfWAUOO0d1Us', desc: 'Professional, Bright, Warm' },
  { name: 'Heather Rey', id: 'MnUw1cSnpiLoLhpd3Hqp', desc: 'Rushed, Friendly' },
  { name: 'Sam',         id: 'scOwDtmlUjD3prqpp97I', desc: 'Support Agent' },
  { name: 'Tom',         id: 'DYkrAHD8iwork3YSUBbs', desc: 'Conversations, Books' },
  { name: 'Matthew',     id: 'IjnA9kwZJHJ20Fp7Vmy6', desc: 'Casual, Friendly, Smooth' },
  { name: 'Mark',        id: '1SM7GgM6IMuvQlz2BwM3', desc: 'Casual, Relaxed, Light' },
  { name: 'Felix',       id: 'Sq93GQT4X1lKDXsQcixO', desc: 'Warm, Positive' },
  { name: 'Sven',        id: 'Tsns2HvNFKfGiNjllgqo', desc: 'Emotional, Nice' },
  { name: 'Nathaniel',   id: 'AeRdCCKzvd23BpJoofzx', desc: 'Engaging, British, Calm' },
  { name: 'Benjamin',    id: 'LruHrtVF6PSyGItzMNHS', desc: 'Deep, Warm, Calming' },
  { name: 'Theodore',    id: 'hqfrgApggtO1785R4Fsn', desc: 'Serene, Grounded' },
];

// ── Sub-tab switching ─────────────────────────────────────────────────────────
document.querySelectorAll('.scen-subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.scen-subtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.scen-subpanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.panel;
    document.getElementById(target)?.classList.add('active');
    // Toggle edit-active on the tab panel (hides образы/upload/предметы in right col)
    document.getElementById('l1-scenarii')?.classList.toggle('edit-active', target === 'scen-panel-edit');
    if (target === 'scen-panel-db')   loadArchivedScenarios();
    if (target === 'scen-panel-edit') renderEditPanel();
    if (target === 'scen-panel-active') {
      // If any generation is done, clear those scenario assignments for a fresh start
      const doneSessions = Object.entries(editFrozenSessions).filter(([, s]) => s.done);
      if (doneSessions.length) {
        const doneScens = new Set(doneSessions.map(([k]) => k.split('__').slice(1).join('__')));
        doneScens.forEach(scenFile => {
          Object.keys(scenarioAssignments).forEach(k => {
            if (k.startsWith(scenFile + '__')) delete scenarioAssignments[k];
          });
        });
        saveScenarioAssignments();
        updateActiveScenariosList();
        loadScenarios();
      }
    }
  });
});

// ── Active образ selection (multi, up to 10) ──────────────────────────────────
const activeObrazIds = new Set();
const MAX_ACTIVE_OBRAZY = 10;

function getActiveObrazы() {
  const all = getObrazы?.() || [];
  return [...activeObrazIds].map(id => all.find(o => o.id === id)).filter(Boolean);
}

function setActiveObraz(id, wrapEl) {
  if (activeObrazIds.has(id)) {
    activeObrazIds.delete(id);
    wrapEl?.classList.remove('obraz-active');
  } else {
    if (activeObrazIds.size >= MAX_ACTIVE_OBRAZY) {
      setStatus(`Максимум ${MAX_ACTIVE_OBRAZY} образов`);
      return;
    }
    activeObrazIds.add(id);
    wrapEl?.classList.add('obraz-active');
  }
  saveEditState();
  renderEditPanel();
}

// ── Scenario assignments ──────────────────────────────────────────────────────
let scenarioAssignments = {};
let scenarioFiles      = []; // cache of {file, name} for active-scenarios panel
let cachedDetailFiles  = []; // cache of detail {file, name, path, thumbPath}
const scenarioLinesCache = {}; // filename → lines[]

async function getLinesForScenario(filename) {
  if (scenarioLinesCache[filename]) return scenarioLinesCache[filename];
  const stored = getModifiedLines(filename);
  if (stored) { scenarioLinesCache[filename] = stored; return stored; }
  try {
    const d = await fetch(`/api/scenarios/${encodeURIComponent(filename)}`).then(r => r.json());
    scenarioLinesCache[filename] = d.lines || [];
    return scenarioLinesCache[filename];
  } catch { return []; }
}

// ── Default interaction options (label shown in dropdown, prompt used for generation) ──
const DEFAULT_INTERACTIONS = [
  { label: 'Рандом',            prompt: '' },
  { label: 'В левой руке',      prompt: 'The character holds the item naturally in their left hand, arm relaxed at side, item clearly visible. Natural grip, correct proportional scale.' },
  { label: 'В правой руке',     prompt: 'The character holds the item in their right hand raised slightly toward camera at a comfortable angle, item prominent and fully visible.' },
  { label: 'Двумя руками',      prompt: 'The character holds the item with both hands, centered in front of the body at natural chest height, secure and comfortable grip, item fully visible.' },
  { label: 'Над головой',       prompt: 'The character lifts the item above their head with both arms extended upward, item clearly visible at the top of the frame, triumphant pose.' },
];

// Analysis cache: detailFile → [{label, prompt}, ...] (3 Gemini variants per asset)
const analysisCache = {};
// Per-card selected interaction: `${scenFile}__${lineIndex}` → optionIndex (into merged options)
const cardInteractionSel = {};
// Per-scenario merged options (default + cached): scenFile → [{label,prompt}]
const scenarioMergedOptions = {};

// ── Frozen edit sessions ──────────────────────────────────────────────────────
// key: `${obrazId}__${scenFile}` → { lines, cells:[{imagePath,detInfo,line}], generating, done }
const editFrozenSessions = {};

// ── Per-card result cache — survives renderEditPanel re-renders (tab switches) ─
// key: `${scenFile}__${lineIdx}` (interaction) or `${scenFile}__${lineIdx}__pose` (pose gen)
const editCardCache = {};

function editSessionKey(obrazId, scenFile) { return `${obrazId}__${scenFile}`; }

// ── Edit state persistence (localStorage) ────────────────────────────────────
const LS_ACTIVE_OBRAZY    = 'edit_active_obrazy_v1';
const LS_FROZEN_SESSIONS  = 'edit_frozen_sessions_v1';
const LS_CARD_CACHE       = 'edit_card_cache_v1';

function saveEditState() {
  try {
    localStorage.setItem(LS_ACTIVE_OBRAZY,   JSON.stringify([...activeObrazIds]));
    // Save ALL sessions — including generating ones (cells may have taskIds for recovery)
    localStorage.setItem(LS_FROZEN_SESSIONS, JSON.stringify(editFrozenSessions));
    localStorage.setItem(LS_CARD_CACHE,      JSON.stringify(editCardCache));
  } catch {}
}

function loadEditState() {
  try {
    const ids = JSON.parse(localStorage.getItem(LS_ACTIVE_OBRAZY) || '[]');
    ids.forEach(id => activeObrazIds.add(id));
    const sessions = JSON.parse(localStorage.getItem(LS_FROZEN_SESSIONS) || '{}');
    Object.assign(editFrozenSessions, sessions);
    const cache = JSON.parse(localStorage.getItem(LS_CARD_CACHE) || '{}');
    Object.assign(editCardCache, cache);
  } catch {}
}

function removeEditProject(sessionKey) {
  delete editFrozenSessions[sessionKey];
  // Remove all card cache entries for this session's scenFile
  const scenFile = sessionKey.split('__').slice(1).join('__');
  Object.keys(editCardCache).forEach(k => {
    if (k.startsWith(scenFile + '__')) delete editCardCache[k];
  });
  saveEditState();
}

// Restore persisted edit state immediately on script load
loadEditState();

// ── Resume polling for Edit cells that had in-flight tasks at restart ─────────
// Runs after page load; for each frozen session cell that has a taskId but no
// imagePath, resumes polling and fills the result in when the task completes.
async function resumeEditPendingCells() {
  let anyPending = false;
  const promises = [];

  for (const [sessionKey, session] of Object.entries(editFrozenSessions)) {
    if (!Array.isArray(session.cells)) continue;
    const scenFile = sessionKey.split('__').slice(1).join('__');

    session.cells.forEach((cell, cellIdx) => {
      if (!cell.taskId || cell.imagePath) return;  // nothing to resume
      anyPending = true;
      const cardKey = `${scenFile}__${cellIdx}`;

      promises.push((async () => {
        try {
          const imagePath = await pollTask(cell.taskId);
          cell.imagePath = imagePath;
          delete cell.taskId;
          editCardCache[cardKey] = { imagePath };
          saveEditState();
          renderEditPanel();
        } catch {
          // Task failed or timed out — mark cell as failed
          delete cell.taskId;
          session.generating = false;
          saveEditState();
          renderEditPanel();
        }
      })());
    });

    // If any cells still need recovery, keep session visually "generating"
    const hasPending = session.cells.some(c => c.taskId && !c.imagePath);
    if (hasPending) session.generating = true;
  }

  if (anyPending) {
    renderEditPanel();   // show spinners immediately
    setStatus('Восстанавливаю незавершённые генерации Эдит…');
  }

  await Promise.all(promises);
  if (anyPending) setStatus('Восстановление Эдит завершено.');
}

// ── Pick a random image from obraz + its completed variations ─────────────────
function pickRandomObrazImage(obraz) {
  const completed = (obraz.variations || []).filter(v => v && v !== 'error');
  const pool = [obraz.char, ...completed].filter(Boolean);
  if (!pool.length) return obraz.char || '';
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Edit-pose dropdown options (must match EDIT_POSE_KEYS in config) ─────────
const EDIT_POSE_OPTIONS = [
  { value: '',                   label: '— поза —' },
  { value: 'edit_pose_look_left',  label: 'Поворот влево' },
  { value: 'edit_pose_look_right', label: 'Поворот вправо' },
  { value: 'edit_pose_3quarter',   label: 'Три четверти' },
  { value: 'edit_pose_head_tilt',  label: 'Наклон головы' },
  { value: 'edit_pose_chin_up',    label: 'Подбородок вверх' },
];

// Run edit-pose generation: Gemini analysis → generation → show result
// cardKey and obrazId are optional — used to cache result and record in образ history
async function runEditPose(imgBox, genaBtn, charImagePath, poseKey, cardKey, obrazId, imageEngine) {
  imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
  imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
  genaBtn.disabled = true;

  try {
    imageEngine = imageEngine || getImageEngine?.() || 'nano-banana-pro';
    const gr = await fetch('/api/edit-pose/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath: charImagePath, poseKey, imageEngine }),
    });
    const gd = await gr.json();
    if (!gd.success) throw new Error(gd.error);

    // Poll until done
    const MAX = 120, INTERVAL = 3000;
    let imagePath = null;
    for (let i = 0; i < MAX; i++) {
      await new Promise(r => setTimeout(r, INTERVAL));
      const sr = await fetch(`/api/edit-pose/status/${gd.taskId}`);
      const sd = await sr.json();
      if (sd.state === 'success') { imagePath = sd.imagePath; break; }
      if (sd.state === 'failed')  throw new Error(sd.error || 'failed');
    }
    if (!imagePath) throw new Error('Таймаут генерации позы');

    imgBox.innerHTML = '';
    imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
    const img = document.createElement('img');
    img.src = imagePath + '?t=' + Date.now();
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    img.addEventListener('click', () => openLightbox?.(imagePath));
    imgBox.appendChild(img);
    if (cardKey)  { editCardCache[cardKey] = { imagePath }; saveEditState(); }
    if (obrazId)  addObrazEditResult?.(obrazId, imagePath);
  } catch (err) {
    console.error('[edit-pose]', err.message);
    imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
    imgBox.innerHTML = '<span style="font-size:8px;color:#aa0000;text-align:center;padding:2px;">Ошибка</span>';
  } finally {
    genaBtn.disabled = false;
  }
}

function getMergedOptions(scenFile) {
  const extra = analysisCache[scenFile] || [];
  return [...DEFAULT_INTERACTIONS, ...extra];
}

// ── Helper: build a frozen results row from a saved session ──────────────────
function buildFrozenRow(session, onReran) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';

  session.cells.forEach((cell, i) => {
    const c = document.createElement('div');
    c.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;';

    const num = document.createElement('div');
    num.style.cssText = 'font-size:9px;color:#808080;line-height:1.4;';
    num.textContent = i + 1;

    const imgBox = document.createElement('div');
    imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';

    if (!cell.detInfo) {
      imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
      const img = document.createElement('img');
      img.src = cell.imagePath || '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      if (cell.imagePath) img.addEventListener('click', () => openLightbox?.(cell.imagePath));
      imgBox.appendChild(img);
    } else if (cell.imagePath) {
      imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
      const img = document.createElement('img');
      img.src = cell.imagePath + '?t=' + Date.now();
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      img.addEventListener('click', () => openLightbox?.(cell.imagePath));
      imgBox.appendChild(img);
    } else if (cell.taskId || session.generating) {
      imgBox.style.cssText += 'background:#ddd;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
    } else {
      imgBox.style.cssText += 'background:#ebebeb;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:8px;color:#aa0000;">Ошибка</span>';
    }

    const reranBtn = document.createElement('button');
    reranBtn.textContent = '↺';
    reranBtn.title = 'Реран (рандомный промпт)';
    reranBtn.style.cssText = `width:66px;font-size:9px;padding:1px 0;margin-top:1px;cursor:pointer;${(!cell.detInfo || !cell.imagePath) ? 'display:none;' : ''}`;
    reranBtn.addEventListener('click', () => onReran(i, imgBox, reranBtn));

    const txt = document.createElement('div');
    txt.style.cssText = 'font-size:8px;color:#444;text-align:center;line-height:1.3;max-width:66px;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
    txt.textContent = cell.line;

    // Video container — pre-populate if videoPath already stored
    const videoContainer = document.createElement('div');
    videoContainer.style.cssText = 'width:66px;margin-top:2px;' + (cell.videoPath ? '' : 'display:none;');
    if (cell.videoPath) {
      const vid = document.createElement('video');
      vid.controls = true; vid.src = cell.videoPath;
      vid.style.cssText = 'width:66px;';
      videoContainer.appendChild(vid);
    }

    c.appendChild(num); c.appendChild(imgBox); c.appendChild(reranBtn); c.appendChild(txt);
    c.appendChild(videoContainer);
    row.appendChild(c);
    cell._imgBox         = imgBox;
    cell._reranBtn       = reranBtn;
    cell._videoContainer = videoContainer;
  });
  return row;
}

// ── Эдит panel renderer ───────────────────────────────────────────────────────
async function renderEditPanel() {
  const panel = document.getElementById('scen-panel-edit');
  if (!panel) return;

  const activeObrazList = getActiveObrazы();
  // For the "no items" message, also check frozen sessions
  const frozenKeys = Object.keys(editFrozenSessions);
  const activeScens = scenarioFiles.filter(f =>
    Object.entries(scenarioAssignments).some(([k, v]) => k.startsWith(f.file + '__') && v)
  );

  panel.innerHTML = '';

  // Collect all obraz+scen combos: active ones + those with frozen sessions
  const combos = [];
  for (const obraz of activeObrazList) {
    for (const f of activeScens) combos.push({ obraz, f });
  }
  // Also add combos that are frozen but no longer "active" (assignments cleared)
  for (const key of frozenKeys) {
    const [obrazId, ...rest] = key.split('__');
    const scenFile = rest.join('__');
    const obraz = (getObrazы?.() || []).find(o => String(o.id) === obrazId);
    const f = scenarioFiles.find(sf => sf.file === scenFile);
    if (obraz && f && !combos.find(c => c.obraz.id === obraz.id && c.f.file === f.file)) {
      combos.push({ obraz, f, frozenOnly: true });
    }
  }

  if (!combos.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#888;font-size:11px;padding:8px 0;';
    msg.textContent = !activeScens.length ? 'Выберите предмет в строке сценария' : 'Выберите образ проекта';
    panel.appendChild(msg);
    return;
  }

  for (const { obraz: activeObraz, f, frozenOnly } of combos) {
    const lines = await getLinesForScenario(f.file);
    if (!lines.length) continue;

    const sessionKey = editSessionKey(String(activeObraz.id), f.file);
    const frozen     = editFrozenSessions[sessionKey];

    const block = document.createElement('div');
    block.style.cssText = 'margin-bottom:16px;';

    // ── Scenario header (vertical layout) ──
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid #808080;';

    const hdrName = document.createElement('span');
    hdrName.style.cssText = 'font-weight:bold;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    hdrName.textContent = `${activeObraz.name} — ${f.name}`;

    // Per-project engine selector (row 2)
    const engineSel = document.createElement('select');
    engineSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;flex:1;';
    engineSel.title = 'Движок для этого проекта';
    [['nano-banana-pro','NB Pro'],['qwen2','Qwen2'],['seedream','Seed']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; engineSel.appendChild(o);
    });
    const engineStorageKey = `edit_engine__${sessionKey}`;
    engineSel.value = localStorage.getItem(engineStorageKey) || getImageEngine?.() || 'nano-banana-pro';
    engineSel.addEventListener('change', () => localStorage.setItem(engineStorageKey, engineSel.value));

    // Per-project voice selector (row 3)
    const voiceStorageKey = `edit_voice__${sessionKey}`;
    const voiceSel = document.createElement('select');
    voiceSel.style.cssText = 'font-size:9px;height:22px;padding:0 2px;flex:1;';
    voiceSel.title = 'Голос ElevenLabs для этого проекта';
    ELEVENLABS_VOICES.forEach(v => {
      const o = document.createElement('option');
      o.value = v.id || v.name;
      o.textContent = v.name + (v.desc ? ` · ${v.desc}` : '');
      voiceSel.appendChild(o);
    });
    voiceSel.value = localStorage.getItem(voiceStorageKey) || 'Rachel';
    voiceSel.addEventListener('change', () => {
      localStorage.setItem(voiceStorageKey, voiceSel.value);
      updateVoicePreview();
    });

    // Voice preview button
    const voicePreviewBtn = document.createElement('button');
    voicePreviewBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:10px;flex-shrink:0;cursor:pointer;';
    voicePreviewBtn.title = 'Прослушать голос';
    voicePreviewBtn.textContent = '▷';
    let previewAudio = null;
    function updateVoicePreview() {
      const selectedVoice = ELEVENLABS_VOICES.find(v => (v.id || v.name) === voiceSel.value);
      voicePreviewBtn.style.display = (selectedVoice?.id) ? '' : 'none';
    }
    voicePreviewBtn.addEventListener('click', () => {
      const selectedVoice = ELEVENLABS_VOICES.find(v => (v.id || v.name) === voiceSel.value);
      if (!selectedVoice?.id) return;
      if (previewAudio) { previewAudio.pause(); previewAudio = null; voicePreviewBtn.textContent = '▷'; return; }
      previewAudio = new Audio(`https://static.aiquickdraw.com/elevenlabs/voice/${selectedVoice.id}.mp3`);
      voicePreviewBtn.textContent = '■';
      previewAudio.play().catch(() => {});
      previewAudio.addEventListener('ended', () => { previewAudio = null; voicePreviewBtn.textContent = '▷'; });
    });
    updateVoicePreview();

    // TTS "Голоса" button — enabled only when frozen session exists
    const ttsBtn = document.createElement('button');
    ttsBtn.textContent = '🎙';
    ttsBtn.title = 'Генерировать голоса для строк сценария';
    ttsBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:10px;flex-shrink:0;cursor:pointer;';
    ttsBtn.disabled = !frozen;

    const analyzeBtn = document.createElement('button');
    analyzeBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:9px;flex-shrink:0;cursor:pointer;';
    analyzeBtn.textContent = '🔍';
    analyzeBtn.title = 'Анализировать взаимодействия';

    const generateBtn = document.createElement('button');
    generateBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:9px;flex-shrink:0;cursor:pointer;';
    generateBtn.textContent = '▶';
    generateBtn.title = 'Генерировать';

    const resetBtn = document.createElement('button');
    resetBtn.style.cssText = 'width:22px;height:22px;padding:0;font-size:9px;flex-shrink:0;cursor:pointer;color:#aa0000;' + (frozen ? '' : 'display:none;');
    resetBtn.textContent = '✕';
    resetBtn.title = 'Сбросить результаты';
    resetBtn.addEventListener('click', () => {
      removeEditProject(sessionKey);
      renderEditPanel();
    });

    // Row 1: title + action buttons
    const hdrRow1 = document.createElement('div');
    hdrRow1.style.cssText = 'display:flex;align-items:center;gap:4px;';
    hdrRow1.appendChild(hdrName);
    hdrRow1.appendChild(analyzeBtn);
    hdrRow1.appendChild(generateBtn);
    hdrRow1.appendChild(resetBtn);

    // Row 2: engine selector
    const hdrRow2 = document.createElement('div');
    hdrRow2.style.cssText = 'display:flex;align-items:center;gap:4px;';
    hdrRow2.appendChild(engineSel);

    // Row 3: voice selector + preview + TTS голоса
    const hdrRow3 = document.createElement('div');
    hdrRow3.style.cssText = 'display:flex;align-items:center;gap:4px;';
    hdrRow3.appendChild(voiceSel);
    hdrRow3.appendChild(voicePreviewBtn);
    hdrRow3.appendChild(ttsBtn);

    hdr.appendChild(hdrRow1);
    hdr.appendChild(hdrRow2);
    hdr.appendChild(hdrRow3);
    block.appendChild(hdr);

    // ── If frozen: render frozen row and skip cards ──
    if (frozen) {
      const frozenRow = buildFrozenRow(frozen, (cellIdx, imgBox, reranBtn) => {
        const cell = frozen.cells[cellIdx];
        if (!cell?.detInfo) return;
        runGen(imgBox, reranBtn, cell.detInfo, `${f.file}__${cellIdx}`, true, cellIdx, cell.charImagePath);
      });
      block.appendChild(frozenRow);

      // ── Define "Говорящая голова" early so голосаPanel rows can reference it ──
      const allHaveAudio = () => frozen.cells.every(c => c.audioPath);
      const говорящаяГоловаBtn = document.createElement('button');
      говорящаяГоловаBtn.textContent = '🗣 Говорящая голова';
      говорящаяГоловаBtn.title = 'Создать видео-аватар (Kling) для каждого кадра';
      говорящаяГоловаBtn.style.cssText = 'margin-top:4px;font-size:10px;padding:3px 8px;cursor:pointer;width:100%;';
      говорящаяГоловаBtn.disabled = !allHaveAudio();

      // ── Голоса collapsible panel ──
      const голосаPanel = document.createElement('div');
      голосаPanel.style.cssText = 'margin-top:4px;';

      const голосаHeader = document.createElement('div');
      голосаHeader.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;padding:3px 0;border-top:1px solid #c0c0c0;';
      const голосаArrow = document.createElement('span');
      голосаArrow.textContent = '▶'; голосаArrow.style.cssText = 'font-size:9px;color:#555;flex-shrink:0;';
      const голосаLabel = document.createElement('span');
      голосаLabel.style.cssText = 'font-size:10px;font-weight:bold;color:#333;';
      голосаLabel.textContent = 'Голоса';
      голосаHeader.appendChild(голосаArrow); голосаHeader.appendChild(голосаLabel);

      const голосаBody = document.createElement('div');
      голосаBody.style.cssText = 'display:none;padding:2px 0;';

      голосаHeader.addEventListener('click', () => {
        const open = голосаBody.style.display === 'none';
        голосаBody.style.display = open ? '' : 'none';
        голосаArrow.textContent = open ? '▼' : '▶';
      });

      // Build one row per cell in the panel
      frozen.cells.forEach((cell, idx) => {
        const rowEl = document.createElement('div');
        rowEl.style.cssText = 'display:flex;align-items:flex-start;gap:4px;margin-bottom:5px;';

        const numEl = document.createElement('span');
        numEl.textContent = idx + 1;
        numEl.style.cssText = 'font-size:9px;color:#808080;min-width:14px;padding-top:5px;flex-shrink:0;';

        const audioArea = document.createElement('div');
        audioArea.style.cssText = 'flex-shrink:0;padding-top:2px;';
        const makeAudioPlayer = (src) => {
          const aud = document.createElement('audio');
          aud.controls = true; aud.src = src;
          aud.style.cssText = 'height:24px;width:110px;';
          return aud;
        };
        if (cell.audioPath) {
          audioArea.appendChild(makeAudioPlayer(cell.audioPath));
        } else if (cell.audioError) {
          audioArea.innerHTML = '<span style="font-size:9px;color:#aa0000;">❌</span>';
        } else {
          audioArea.innerHTML = '<span style="font-size:9px;color:#bbb;">—</span>';
        }
        cell._audioContainer = audioArea;

        const textEl = document.createElement('textarea');
        textEl.value = cell.line;
        textEl.rows = 2;
        textEl.style.cssText = 'flex:1;font-size:9px;resize:vertical;padding:2px 3px;font-family:inherit;min-width:0;';

        const remakeBtn = document.createElement('button');
        remakeBtn.textContent = '↺';
        remakeBtn.title = 'Переделать голос для этой строки';
        remakeBtn.style.cssText = 'flex-shrink:0;width:22px;height:22px;padding:0;font-size:12px;cursor:pointer;';
        remakeBtn.addEventListener('click', async () => {
          const newText = textEl.value.trim() || cell.line;
          audioArea.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
          remakeBtn.disabled = true;
          try {
            const r = await fetch('/api/audio/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: newText, voice: voiceSel.value, ttsParams: getEngineParams?.('elevenlabs/text-to-speech-turbo-2-5') || {} }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            const audioPath = await pollTts(d.taskId);
            cell.audioPath = audioPath; delete cell.audioError; saveEditState();
            audioArea.innerHTML = '';
            audioArea.appendChild(makeAudioPlayer(audioPath));
            if (allHaveAudio()) говорящаяГоловаBtn.disabled = false;
          } catch (err) {
            cell.audioError = err.message; saveEditState();
            audioArea.innerHTML = '<span style="font-size:9px;color:#aa0000;">❌</span>';
          } finally {
            remakeBtn.disabled = false;
          }
        });

        rowEl.appendChild(numEl); rowEl.appendChild(audioArea); rowEl.appendChild(textEl); rowEl.appendChild(remakeBtn);
        голосаBody.appendChild(rowEl);
      });

      голосаPanel.appendChild(голосаHeader); голосаPanel.appendChild(голосаBody);
      block.appendChild(голосаPanel);

      // ── Attach говорящаяГоловаBtn click handler ──────────────────────────────
      говорящаяГоловаBtn.addEventListener('click', async () => {
        говорящаяГоловаBtn.disabled = true;
        const videoParams = getEngineParams?.('kling/ai-avatar-pro') || {};
        const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';

        // Step 1: immediately mark cells as pending, switch to Склейка — placeholders show now
        говорящаяГоловаBtn.textContent = '⏳ Анализ…';
        frozen.cells.forEach(cell => { if (cell.audioPath) cell._videoPending = true; });
        renderMontagePanel();
        document.querySelector('#l1-tabs [aria-controls="l1-skleyka"]')?.click();

        // Step 2: Gemini animation prompts + Kling submission per cell (all parallel)
        let done = 0;
        await Promise.all(frozen.cells.map(async (cell, idx) => {
          if (!cell.audioPath) return;
          const imgPath = cell.imagePath || cell.charImagePath;
          if (!imgPath) { delete cell._videoPending; renderMontagePanel(); return; }

          // Get Gemini prompt (skip for cell 0)
          let prompt = defaultPrompt;
          if (idx > 0) {
            try {
              const pr = await fetch('/api/audio/avatar-prompt', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imagePath: imgPath, text: cell.line }),
              });
              const pd = await pr.json();
              if (pd.success && pd.prompt) prompt = pd.prompt;
            } catch {}
          }

          const vc = cell._videoContainer;
          if (vc) { vc.style.display = ''; vc.innerHTML = '<span style="font-size:8px;color:#888;">⏳</span>'; }
          try {
            const r = await fetch('/api/audio/avatar', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            // taskId received — fragment is now queued; still shows ⏳ placeholder
            говорящаяГоловаBtn.textContent = '⏳ Генерация видео…';
            const videoPath = await pollAvatar(d.taskId);
            cell.videoPath = videoPath; cell.videoError = null;
            delete cell._videoPending; saveEditState();
            if (vc) {
              vc.innerHTML = '';
              const vid = document.createElement('video');
              vid.controls = true; vid.src = videoPath; vid.style.cssText = 'width:66px;';
              vc.appendChild(vid);
            }
            done++;
          } catch (err) {
            cell.videoError = err.message || 'Avatar failed';
            delete cell._videoPending; saveEditState();
            if (vc) vc.innerHTML = '<span style="font-size:8px;color:#aa0000;">❌ Видео</span>';
          }
          renderMontagePanel(); // update montage immediately after each cell resolves
          renderAllTimelines();
        }));

        говорящаяГоловаBtn.textContent = done > 0 ? `✓ Видео (${done})` : '🗣 Говорящая голова';
        говорящаяГоловаBtn.disabled = false;
        renderAllTimelines();
      });
      block.appendChild(говорящаяГоловаBtn);

      // ── TTS "Голоса" button handler — auto-expands panel, updates audioArea per cell ──
      ttsBtn.disabled = false;
      ttsBtn.addEventListener('click', async () => {
        const voice = voiceSel.value;
        ttsBtn.disabled = true; ttsBtn.textContent = '⏳';
        // Auto-expand the голоса panel to show progress
        голосаBody.style.display = ''; голосаArrow.textContent = '▼';
        await Promise.all(frozen.cells.map(async (cell) => {
          if (cell.audioPath) return;
          const container = cell._audioContainer;
          if (container) container.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';

          const showAudioError = () => {
            if (!container) return;
            container.innerHTML = '';
            const errSpan = document.createElement('span');
            errSpan.style.cssText = 'font-size:9px;color:#aa0000;'; errSpan.textContent = '❌';
            const retryBtn = document.createElement('button');
            retryBtn.textContent = '↺'; retryBtn.style.cssText = 'font-size:9px;padding:1px 3px;cursor:pointer;margin-left:3px;';
            retryBtn.addEventListener('click', async () => {
              container.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
              try {
                const r2 = await fetch('/api/audio/tts', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: cell.line, voice: voiceSel.value, ttsParams: getEngineParams?.('elevenlabs/text-to-speech-turbo-2-5') || {} }),
                });
                const d2 = await r2.json();
                if (!d2.success) throw new Error(d2.error);
                const ap = await pollTts(d2.taskId);
                cell.audioPath = ap; delete cell.audioError; saveEditState();
                container.innerHTML = '';
                const aud = document.createElement('audio');
                aud.controls = true; aud.src = ap; aud.style.cssText = 'height:24px;width:110px;';
                container.appendChild(aud);
                if (allHaveAudio()) говорящаяГоловаBtn.disabled = false;
              } catch (e2) { cell.audioError = e2.message; saveEditState(); showAudioError(); }
            });
            container.appendChild(errSpan); container.appendChild(retryBtn);
          };

          try {
            const r = await fetch('/api/audio/tts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: cell.line, voice, ttsParams: getEngineParams?.('elevenlabs/text-to-speech-turbo-2-5') || {} }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.error);
            const audioPath = await pollTts(d.taskId);
            cell.audioPath = audioPath; delete cell.audioError; saveEditState();
            if (container) {
              container.innerHTML = '';
              const aud = document.createElement('audio');
              aud.controls = true; aud.src = audioPath; aud.style.cssText = 'height:24px;width:110px;';
              container.appendChild(aud);
            }
          } catch (err) { cell.audioError = err.message || 'TTS failed'; saveEditState(); showAudioError(); }
        }));
        ttsBtn.disabled = false; ttsBtn.textContent = '🎙';
        if (allHaveAudio()) говорящаяГоловаBtn.disabled = false;
      });

      panel.appendChild(block);
      analyzeBtn.addEventListener('click', () => doAnalyze(analyzeBtn, lines, activeObraz, f, []));
      continue;
    }

    // ── Per-line random image (obraz.char or one of its completed variations) ──
    const lineImages = lines.map(() => pickRandomObrazImage(activeObraz));

    // ── Cards row (pre-generation) ──
    const cardsRow = document.createElement('div');
    cardsRow.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';

    const cardSelects = [];

    lines.forEach((line, i) => {
      const cardKey    = `${f.file}__${i}`;
      const detFile    = scenarioAssignments[cardKey] || null;
      const detailInfo = detFile ? cachedDetailFiles.find(d => d.file === detFile) : null;

      const card = document.createElement('div');
      card.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;';

      const num = document.createElement('div');
      num.style.cssText = 'font-size:9px;color:#808080;line-height:1.4;';
      num.textContent = i + 1;

      const obrazBox = document.createElement('div');
      obrazBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;';
      const obrazImg = document.createElement('img');
      obrazImg.src = lineImages[i];
      obrazImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      obrazBox.appendChild(obrazImg);

      const detailBox = document.createElement('div');
      if (detailInfo) {
        detailBox.style.cssText = 'width:62px;height:62px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;';
        const detImg = document.createElement('img');
        detImg.src = detailInfo.thumbPath || detailInfo.path;
        detImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        detailBox.appendChild(detImg);
      } else {
        detailBox.style.cssText = 'width:62px;height:62px;border:1px dashed #bbb;background:#ebebeb;flex-shrink:0;';
      }

      // Interaction dropdown — only shown when detail is assigned
      const sel = document.createElement('select');
      sel.style.cssText = 'width:66px;font-size:8px;margin-top:1px;' + (detailInfo ? '' : 'display:none;');
      const opts = getMergedOptions(f.file);
      opts.forEach((o, idx) => {
        const opt = document.createElement('option');
        opt.value = idx; opt.textContent = o.label;
        sel.appendChild(opt);
      });
      const savedIdx = cardInteractionSel[cardKey];
      if (savedIdx != null && savedIdx < opts.length) sel.value = savedIdx;
      sel.addEventListener('change', () => { cardInteractionSel[cardKey] = Number(sel.value); });
      cardSelects.push({ sel, detFile, cardKey });

      // Pose dropdown — only shown when NO detail is assigned
      const poseSel = document.createElement('select');
      poseSel.style.cssText = 'width:66px;font-size:8px;margin-top:1px;' + (detailInfo ? 'display:none;' : '');
      EDIT_POSE_OPTIONS.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.label;
        poseSel.appendChild(opt);
      });

      const txt = document.createElement('div');
      txt.style.cssText = 'font-size:8px;color:#444;text-align:center;line-height:1.3;max-width:66px;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
      txt.textContent = line;

      // ── Гена button ──
      const genaBtn = document.createElement('button');
      genaBtn.textContent = 'Гена';
      genaBtn.style.cssText = 'width:66px;font-size:8px;padding:1px 0;margin-top:1px;cursor:pointer;';
      genaBtn.title = detailInfo ? 'Сгенерировать это изображение' : 'Сгенерировать с выбранной позой';

      if (detailInfo) {
        // With detail: generate asset interaction
        if (editCardCache[cardKey]) {
          // Restore cached result immediately (survives tab switches)
          const cached = editCardCache[cardKey];
          obrazBox.innerHTML = '';
          obrazBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
          const cImg = document.createElement('img');
          cImg.src = cached.imagePath + '?t=' + Date.now();
          cImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          cImg.addEventListener('click', () => openLightbox?.(cached.imagePath));
          obrazBox.appendChild(cImg);
          detailBox.style.display = 'none';
          genaBtn.textContent = '↺';
          genaBtn.title = 'Реран (рандомный промпт)';
          genaBtn.addEventListener('click', () => {
            runGen(obrazBox, genaBtn, detailInfo, cardKey, true, i, lineImages[i]);
          });
        } else {
          genaBtn.addEventListener('click', () => {
            const resultBox = document.createElement('div');
            resultBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';
            obrazBox.replaceWith(resultBox);
            detailBox.remove();
            genaBtn.textContent = '↺';
            genaBtn.title = 'Реран (рандомный промпт)';
            let firstRun = true;
            const doRun = () => {
              runGen(resultBox, genaBtn, detailInfo, cardKey, !firstRun, i, lineImages[i]);
              firstRun = false;
            };
            genaBtn.onclick = doRun;
            doRun();
          });
        }
      } else {
        // Without detail: generate pose variation
        const poseCardKey = `${f.file}__${i}__pose`;
        if (editCardCache[poseCardKey]) {
          // Restore cached pose result immediately
          const cachedPose = editCardCache[poseCardKey];
          obrazImg.src = cachedPose.imagePath + '?t=' + Date.now();
          obrazImg.style.cursor = 'zoom-in';
          obrazImg.onclick = () => openLightbox?.(cachedPose.imagePath);
          genaBtn.textContent = '↺';
        }
        genaBtn.addEventListener('click', () => {
          const poseKey = poseSel.value;
          if (!poseKey) { setStatus('Выберите позу в дропдауне'); return; }
          runEditPose(obrazBox, genaBtn, lineImages[i], poseKey, poseCardKey, activeObraz.id, engineSel.value);
        });
      }

      card.appendChild(num); card.appendChild(obrazBox); card.appendChild(detailBox);
      card.appendChild(sel); card.appendChild(poseSel); card.appendChild(genaBtn); card.appendChild(txt);
      cardsRow.appendChild(card);
    });

    block.appendChild(cardsRow);

    // ── Shared runGen: with retry, freeze update, reran support ──
    async function runGen(imgBox, reranBtn, detInfo, cardKey, useRandomPrompt, cellIdx, charImagePath) {
      const imageEngine = engineSel.value || getImageEngine?.() || 'nano-banana-pro';
      const activePath  = charImagePath || activeObraz.char;
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:9px;color:#888;">⏳</span>';
      if (reranBtn) reranBtn.disabled = true;

      let interactionPrompt = '';
      if (!useRandomPrompt) {
        const selEntry = cardSelects.find(s => s.cardKey === cardKey);
        const selIdx   = selEntry ? Number(selEntry.sel.value) : 0;
        interactionPrompt = getMergedOptions(f.file)[selIdx]?.prompt || '';
      }

      const MAX_RETRIES = 3;
      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const gr = await fetch('/api/asset-interact/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              activePath, assetPath: detInfo.path,
              prompt: interactionPrompt, assetType: 'detail', imageEngine,
              engineParams: getEngineParams?.(imageEngine) || {},
            }),
          });
          const gd = await gr.json();
          if (!gd.success) throw new Error(gd.error);

          // Persist taskId in cell so a server restart can resume polling
          const sess = editFrozenSessions[sessionKey];
          if (sess && cellIdx != null) {
            sess.cells[cellIdx].taskId = gd.taskId;
            saveEditState();
          }

          const imagePath = await pollTask(gd.taskId);

          // Update frozen session cell
          if (sess && cellIdx != null) {
            sess.cells[cellIdx].imagePath = imagePath;
            delete sess.cells[cellIdx].taskId;
          }

          imgBox.innerHTML = '';
          imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ccc;overflow:hidden;flex-shrink:0;cursor:zoom-in;';
          const img = document.createElement('img');
          img.src = imagePath + '?t=' + Date.now();
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          img.addEventListener('click', () => openLightbox?.(imagePath));
          imgBox.appendChild(img);
          editCardCache[cardKey] = { imagePath };
          saveEditState();
          addObrazEditResult?.(activeObraz.id, imagePath);
          if (reranBtn) reranBtn.disabled = false;
          return; // success
        } catch (err) {
          lastErr = err;
          console.error(`[Эдит] Ошибка строка ${(cellIdx ?? '?') + 1}, попытка ${attempt}: ${err.message}`);
          setStatus(`Строка ${(cellIdx ?? '?') + 1}: попытка ${attempt}/3 — ${err.message}`);
          if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000));
        }
      }
      // All retries exhausted
      imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;background:#ddd;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
      imgBox.innerHTML = '<span style="font-size:8px;color:#aa0000;text-align:center;padding:2px;">Ошибка</span>';
      if (reranBtn) reranBtn.disabled = false;
    }

    // ── Анализировать handler ──
    analyzeBtn.addEventListener('click', () => doAnalyze(analyzeBtn, lines, activeObraz, f, cardSelects));

    // ── Генерировать handler ──
    generateBtn.addEventListener('click', async () => {
      generateBtn.disabled = true; generateBtn.textContent = '⏳';
      resetBtn.style.display = '';

      // Freeze session immediately
      const sessionCells = lines.map((line, i) => {
        const cardKey = `${f.file}__${i}`;
        const detFile = scenarioAssignments[cardKey] || null;
        const detInfo = detFile ? cachedDetailFiles.find(d => d.file === detFile) : null;
        return { line, detInfo, charImagePath: lineImages[i], imagePath: detInfo ? null : lineImages[i] };
      });
      editFrozenSessions[sessionKey] = { lines, cells: sessionCells, generating: true, done: false };
      saveEditState();   // persist immediately so restart can detect this session

      // Build results row
      const resultsRow = document.createElement('div');
      resultsRow.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;';

      const jobs = [];
      sessionCells.forEach((cell, i) => {
        const c = document.createElement('div');
        c.style.cssText = 'flex-shrink:0;width:66px;display:flex;flex-direction:column;align-items:center;gap:2px;';
        const num = document.createElement('div');
        num.style.cssText = 'font-size:9px;color:#808080;line-height:1.4;';
        num.textContent = i + 1;
        const imgBox = document.createElement('div');
        imgBox.style.cssText = 'width:62px;height:82px;border:1px solid #808080;overflow:hidden;flex-shrink:0;';
        cell._imgBox = imgBox;

        let reranBtn = null;
        if (!cell.detInfo) {
          imgBox.style.cssText += 'background:#ccc;cursor:zoom-in;';
          const img = document.createElement('img');
          img.src = cell.imagePath;
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          img.addEventListener('click', () => openLightbox?.(cell.imagePath));
          imgBox.appendChild(img);
        } else {
          reranBtn = document.createElement('button');
          reranBtn.textContent = '↺'; reranBtn.title = 'Реран (рандомный промпт)';
          reranBtn.style.cssText = 'width:66px;font-size:9px;padding:1px 0;margin-top:1px;cursor:pointer;display:none;';
          reranBtn.addEventListener('click', () => runGen(imgBox, reranBtn, cell.detInfo, `${f.file}__${i}`, true, i, cell.charImagePath));
          cell._reranBtn = reranBtn;
          jobs.push({ imgBox, reranBtn, detInfo: cell.detInfo, cardKey: `${f.file}__${i}`, cellIdx: i, charImagePath: cell.charImagePath });
        }

        const txt = document.createElement('div');
        txt.style.cssText = 'font-size:8px;color:#444;text-align:center;line-height:1.3;max-width:66px;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;';
        txt.textContent = cell.line;
        c.appendChild(num); c.appendChild(imgBox);
        if (reranBtn) c.appendChild(reranBtn);
        c.appendChild(txt);
        resultsRow.appendChild(c);
      });

      cardsRow.replaceWith(resultsRow);
      setStatus('Генерация…');

      let done = 0;
      await Promise.all(jobs.map(({ imgBox, reranBtn, detInfo, cardKey, cellIdx, charImagePath }) =>
        runGen(imgBox, reranBtn, detInfo, cardKey, false, cellIdx, charImagePath).then(() => {
          if (reranBtn) reranBtn.style.display = 'block';
          done++;
          setStatus(`Генерация: ${done}/${jobs.length}`);
        })
      ));

      editFrozenSessions[sessionKey].generating = false;
      editFrozenSessions[sessionKey].done = true;
      saveEditState();
      setStatus('Генерация завершена.');
      generateBtn.disabled = false; generateBtn.textContent = '▶';
      await renderEditPanel();
    });

    panel.appendChild(block);
  } // end for combos
}

// ── Shared analyze handler ────────────────────────────────────────────────────
async function doAnalyze(analyzeBtn, lines, activeObraz, f, cardSelects) {
  analyzeBtn.disabled = true; analyzeBtn.textContent = '⏳';
  setStatus('Анализирую взаимодействия…');
  const uniqueDetails = [...new Set(lines.map((_, i) => scenarioAssignments[`${f.file}__${i}`]).filter(Boolean))];
  if (!uniqueDetails.length) {
    setStatus('Нет назначенных предметов для анализа.');
    analyzeBtn.disabled = false; analyzeBtn.textContent = '🔍'; return;
  }
  try {
    const newVariants = [];
    for (const detFile of uniqueDetails) {
      if (analysisCache[detFile]) { newVariants.push(...analysisCache[detFile]); continue; }
      const detInfo = cachedDetailFiles.find(d => d.file === detFile);
      if (!detInfo) continue;
      const r = await fetch('/api/scenarios/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activePath: activeObraz.char, assetPath: detInfo.path }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      analysisCache[detFile] = d.variants;
      newVariants.push(...d.variants);
    }
    const existing = (analysisCache[f.file] || []).map(v => v.label);
    const fresh = newVariants.filter(v => !existing.includes(v.label));
    analysisCache[f.file] = [...(analysisCache[f.file] || []), ...fresh];
    const merged = getMergedOptions(f.file);
    cardSelects.forEach(({ sel, cardKey }) => {
      const curVal = Number(sel.value);
      while (sel.options.length > DEFAULT_INTERACTIONS.length) sel.remove(DEFAULT_INTERACTIONS.length);
      merged.slice(DEFAULT_INTERACTIONS.length).forEach((o, idx) => {
        const opt = document.createElement('option');
        opt.value = DEFAULT_INTERACTIONS.length + idx; opt.textContent = o.label;
        sel.appendChild(opt);
      });
      sel.value = curVal < merged.length ? curVal : 0;
    });
    setStatus(`Добавлено вариантов: ${fresh.length}`);
  } catch (err) {
    setStatus('Ошибка анализа: ' + err.message);
  } finally {
    analyzeBtn.disabled = false; analyzeBtn.textContent = '🔍';
  }
}

// ── Poll task until success/failed ────────────────────────────────────────────
async function pollTask(taskId, intervalMs = 3000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/asset-interact/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') return d.imagePath;
    if (d.state === 'failed')  throw new Error(d.error || 'failed');
  }
  throw new Error('Таймаут генерации');
}

async function pollTts(taskId, intervalMs = 3000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/audio/tts/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') return d.audioPath;
    if (d.state === 'failed')  throw new Error(d.error || 'TTS failed');
  }
  throw new Error('Таймаут TTS');
}

async function pollAvatar(taskId, intervalMs = 5000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const r = await fetch(`/api/audio/avatar/status/${taskId}`);
    const d = await r.json();
    if (d.state === 'success') return d.videoPath;
    if (d.state === 'failed')  throw new Error(d.error || 'Avatar failed');
  }
  throw new Error('Таймаут аватара');
}

// ── Video lightbox ─────────────────────────────────────────────────────────────
function openVideoLightbox(src) {
  let lb = document.getElementById('scen-video-lb');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'scen-video-lb';
    lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:12px;';
    lb.innerHTML = '<video id="scen-video-lb-el" controls style="max-width:90vw;max-height:80vh;display:block;background:#000;"></video><button style="padding:6px 24px;font-size:13px;cursor:pointer;">Закрыть</button>';
    lb.addEventListener('click', e => {
      if (e.target === lb || e.target.tagName === 'BUTTON') {
        lb.style.display = 'none';
        const vid = lb.querySelector('video');
        vid.pause(); vid.src = '';
      }
    });
    document.body.appendChild(lb);
  }
  lb.querySelector('#scen-video-lb-el').src = src;
  lb.style.display = 'flex';
}

// ── Монтаж panel — теперь алиас renderAllTimelines (монтаж встроен в таймлайн) ─
function renderMontagePanel() { renderAllTimelines(); }

// Derive thumbnail path: /uploads/foo.jpg → /uploads/thumbs/foo.jpg (with fallback)
function _toThumb(p) {
  if (!p) return p;
  return p.replace(/^(\/uploads\/)(?!thumbs\/)([^/]+)$/, '$1thumbs/$2');
}
function _imgWithThumb(src, fallback) {
  const img = document.createElement('img');
  const thumb = _toThumb(src);
  img.src = thumb || src;
  if (thumb && thumb !== src) {
    img.onerror = () => { img.src = fallback || src; img.onerror = null; };
  } else {
    img.onerror = () => { img.style.display = 'none'; img.onerror = null; };
  }
  return img;
}

// Make a video-poster thumbnail: shows first frame, click opens lightbox
function _videoThumb(videoPath, cssText, onClickFn) {
  const v = document.createElement('video');
  v.src = videoPath + '#t=0.1';
  v.muted = true;
  v.preload = 'metadata';
  v.style.cssText = cssText;
  v.style.cursor = 'pointer';
  v.title = '▶ Смотреть видео';
  if (onClickFn) v.addEventListener('click', e => { e.stopPropagation(); onClickFn(); });
  return v;
}

// ── Biroly timeline bar: fill (or re-fill) a bar element ─────────────────────
function _fillBirolyBar(bBar, sessionKey, totalDur) {
  bBar.innerHTML = '';
  const archive  = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const tlData   = getTimelineData();
  const sessData = tlData[sessionKey] || {};
  const activated = sessData.activated || [];
  const bTimings  = sessData.timings   || {};

  activated.forEach(idx => {
    const b = archive[idx];
    const t = bTimings[idx];
    if (!b || !t || t.start === undefined) return;

    const startVal = parseFloat(t.start);
    const endVal   = parseFloat(t.end);
    const cropVal  = parseFloat(t.crop) || 0;
    if (isNaN(startVal) || isNaN(endVal) || endVal <= startVal) return;

    const duration  = endVal - startVal;          // clip duration stays fixed during drag
    const cropStart = Math.max(0, startVal - cropVal);
    const blockLeft  = cropStart / totalDur * 100;
    const blockWidth = (endVal - cropStart) / totalDur * 100;
    const cropFrac   = (blockWidth > 0 && (startVal - cropStart) > 0)
      ? ((startVal - cropStart) / (endVal - cropStart) * 100) : 0;

    const block = document.createElement('div');
    block.style.cssText = `position:absolute;left:${blockLeft.toFixed(3)}%;width:${Math.max(blockWidth, 0.3).toFixed(3)}%;height:100%;box-sizing:border-box;overflow:hidden;border-radius:2px;cursor:grab;`;
    block.title = `${b.name || 'Бирол'}\nс: ${startVal.toFixed(2)}s  до: ${endVal.toFixed(2)}s  crop: ${cropVal.toFixed(2)}s\nТяни для перемещения`;

    if (cropFrac > 0) {
      const cropPart = document.createElement('div');
      cropPart.style.cssText = `position:absolute;left:0;width:${cropFrac.toFixed(3)}%;height:100%;background:#666;filter:grayscale(1);border-right:2px dashed #aaa;box-sizing:border-box;`;
      block.appendChild(cropPart);
    }

    const color = TL_COLORS[idx % TL_COLORS.length];
    const activePart = document.createElement('div');
    activePart.style.cssText = `position:absolute;left:${cropFrac.toFixed(3)}%;width:${(100 - cropFrac).toFixed(3)}%;height:100%;background:${color};box-sizing:border-box;display:flex;align-items:center;overflow:hidden;`;
    activePart.innerHTML = `<span style="font-size:7px;color:#fff;font-weight:bold;padding:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;">${b.name || 'Б'}</span>`;
    block.appendChild(activePart);

    // ── Drag to reposition ──────────────────────────────────────────────────
    block.addEventListener('mousedown', e => {
      e.preventDefault();
      const barRect  = bBar.getBoundingClientRect();
      const origLeft = cropStart;   // seconds from bar start to block left edge
      const startX   = e.clientX;

      block.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      const onMove = ev => {
        const deltaX   = ev.clientX - startX;
        const deltaSec = deltaX / barRect.width * totalDur;
        // Clamp: block left edge ≥ 0, block right edge ≤ totalDur
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - (endVal - cropStart)));
        const newStart     = newCropStart + cropVal;
        const newEnd       = newStart + duration;
        // Move block visually
        block.style.left = (newCropStart / totalDur * 100).toFixed(3) + '%';
        block.title = `${b.name || 'Бирол'}\nс: ${newStart.toFixed(2)}s  до: ${newEnd.toFixed(2)}s  crop: ${cropVal.toFixed(2)}s`;
      };

      const onUp = ev => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        block.style.cursor = 'grab';
        document.body.style.userSelect = '';

        // Final position
        const deltaX   = ev.clientX - startX;
        const deltaSec = deltaX / barRect.width * totalDur;
        const newCropStart = Math.max(0, Math.min(origLeft + deltaSec, totalDur - (endVal - cropStart)));
        const newStart     = parseFloat((newCropStart + cropVal).toFixed(2));
        const newEnd       = parseFloat((newStart + duration).toFixed(2));

        // Save to localStorage
        const d = getTimelineData();
        if (!d[sessionKey]) d[sessionKey] = {};
        if (!d[sessionKey].timings) d[sessionKey].timings = {};
        d[sessionKey].timings[idx] = { crop: cropVal.toFixed(2), start: newStart.toFixed(2), end: newEnd.toFixed(2) };
        setTimelineData(d);

        // Re-render right column — re-sorts active birolys by new start time
        window.refreshTimelineBirolys?.();
        // Re-render bar (refreshTimelineBirolys → renderSessionBirolys → refreshBirolyBars covers it,
        // but call directly too in case the column isn't in DOM yet)
        _fillBirolyBar(bBar, sessionKey, totalDur);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    bBar.appendChild(block);
  });
}

// Refresh only biroly bars already in DOM (fast, no async) ────────────────────
function refreshBirolyBars() {
  document.querySelectorAll('.timeline-biroly-bar[data-session-key]').forEach(el => {
    const totalDur = parseFloat(el.dataset.totalDur) || 0;
    if (totalDur > 0) _fillBirolyBar(el, el.dataset.sessionKey, totalDur);
  });
}
window.refreshBirolyBars = refreshBirolyBars;

// ── Build video fragments strip for one session (used inside timeline row) ────
function _buildFragStrip(session, sessionKey, opts = {}) {
  const excludedSet = opts.excludedSet || new Set();
  const fragRow = document.createElement('div');
  fragRow.style.cssText = 'display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:8px;border-bottom:1px solid #a0a0a0;';

  // Build ordered list: non-excluded first, excluded at end (greyed)
  const cellOrder = [];
  session.cells.forEach((cell, idx) => {
    if (!cell.videoPath && !cell.videoError && !cell._videoPending) return;
    cellOrder.push({ cell, idx, excluded: excludedSet.has(idx) });
  });
  cellOrder.sort((a, b) => (a.excluded ? 1 : 0) - (b.excluded ? 1 : 0));

  cellOrder.forEach(({ cell, idx, excluded }) => {
    const imgPath = cell.thumbPath || cell.imagePath || cell.charImagePath;

    const frag = document.createElement('div');
    frag.style.cssText = 'flex-shrink:0;width:88px;display:flex;flex-direction:column;align-items:center;gap:3px;' + (excluded ? 'opacity:0.35;filter:grayscale(1);' : '');

    const numEl = document.createElement('div');
    numEl.style.cssText = 'font-size:8px;color:#808080;align-self:flex-start;';
    numEl.textContent = idx + 1;

    const thumbBox = document.createElement('div');
    thumbBox.style.cssText = `width:86px;height:115px;border:1px solid #808080;overflow:hidden;background:#1a1a1a;flex-shrink:0;cursor:${cell.videoPath ? 'pointer' : 'default'};position:relative;`;
    if (imgPath) {
      const img = _imgWithThumb(imgPath, cell.imagePath || cell.charImagePath);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      // If image fails entirely, fall back to video first-frame
      img.addEventListener('error', () => {
        if (cell.videoPath && img.parentNode) {
          const vt = _videoThumb(cell.videoPath, 'width:100%;height:100%;object-fit:cover;display:block;', () => openVideoLightbox(cell.videoPath));
          img.parentNode.replaceChild(vt, img);
        }
      }, { once: true });
      thumbBox.appendChild(img);
    } else if (cell.videoPath) {
      // No image at all — show video first-frame directly
      const vt = _videoThumb(cell.videoPath, 'width:100%;height:100%;object-fit:cover;display:block;', () => openVideoLightbox(cell.videoPath));
      thumbBox.appendChild(vt);
    }
    if (cell._videoPending) {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';
      ov.innerHTML = '<span style="color:#fff;font-size:18px;">⏳</span>';
      thumbBox.appendChild(ov);
    } else if (cell.videoPath) {
      thumbBox.title = 'Нажмите для просмотра видео';
      const playOv = document.createElement('div');
      playOv.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.15s;background:rgba(0,0,0,0.3);';
      playOv.innerHTML = '<span style="color:#fff;font-size:24px;">▶</span>';
      thumbBox.appendChild(playOv);
      thumbBox.addEventListener('mouseenter', () => { playOv.style.opacity = '1'; });
      thumbBox.addEventListener('mouseleave', () => { playOv.style.opacity = '0'; });
      thumbBox.addEventListener('click', () => openVideoLightbox(cell.videoPath));
    } else if (cell.videoError) {
      const errOv = document.createElement('div');
      errOv.style.cssText = 'position:absolute;inset:0;background:rgba(170,0,0,0.35);display:flex;align-items:center;justify-content:center;';
      errOv.innerHTML = '<span style="color:#fff;font-size:18px;">❌</span>';
      thumbBox.appendChild(errOv);
    }

    const statusArea = document.createElement('div');
    statusArea.style.cssText = 'width:86px;';

    if (cell.videoPath) {
      const playBtn = document.createElement('button');
      playBtn.textContent = '▶';
      playBtn.style.cssText = 'width:86px;font-size:9px;padding:2px 0;cursor:pointer;';
      playBtn.addEventListener('click', () => openVideoLightbox(cell.videoPath));
      statusArea.appendChild(playBtn);
    } else if (cell._videoPending) {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:8px;color:#666;text-align:center;padding:2px 0;';
      d.textContent = '⏳ Генерация…';
      statusArea.appendChild(d);
    } else if (cell.videoError) {
      const retryBtn = document.createElement('button');
      retryBtn.textContent = '↺';
      retryBtn.title = 'Повторить генерацию';
      retryBtn.style.cssText = 'width:86px;font-size:9px;padding:2px 0;cursor:pointer;';
      retryBtn.addEventListener('click', async () => {
        if (!cell.audioPath || !imgPath) return;
        retryBtn.disabled = true;
        cell._videoPending = true; delete cell.videoError;
        renderAllTimelines();
        try {
          const videoParams = getEngineParams?.('kling/ai-avatar-pro') || {};
          const defaultPrompt = videoParams.prompt || 'Natural speaking motion with subtle head movement and relaxed posture';
          let prompt = defaultPrompt;
          if (idx > 0) {
            try {
              const pr = await fetch('/api/audio/avatar-prompt', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imagePath: imgPath, text: cell.line }),
              });
              const pd = await pr.json();
              if (pd.success && pd.prompt) prompt = pd.prompt;
            } catch {}
          }
          const r = await fetch('/api/audio/avatar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagePath: imgPath, audioPath: cell.audioPath, prompt, videoParams }),
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error);
          const videoPath = await pollAvatar(d.taskId);
          cell.videoPath = videoPath; cell.videoError = null;
        } catch (err) {
          cell.videoError = err.message || 'Avatar failed';
        }
        delete cell._videoPending; saveEditState(); renderAllTimelines();
      });
      statusArea.appendChild(retryBtn);
    }

    frag.appendChild(numEl); frag.appendChild(thumbBox); frag.appendChild(statusArea);
    fragRow.appendChild(frag);
  });

  return fragRow;
}

// ── Helper: get audio duration via Audio element ──────────────────────────────
function getAudioDuration(src) {
  return new Promise(resolve => {
    const a = new Audio(src);
    a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
    a.addEventListener('error', () => resolve(0), { once: true });
    a.load();
  });
}

// ── Timeline timings: { [sessionKey]: { [birolyIdx]: { start, end } } } ────────
// Source of truth for WHICH birolys to show is always getActiveBirolyIdxs() order.
// This store holds only the start/end values entered by the user,
// plus a per-session "excluded" set for birolys removed with ×.
const TIMELINE_DATA_KEY    = 'timeline_data_v2';
const BIROLY_DEFAULTS_KEY  = 'biroly_defaults_v1';
function getTimelineData()  { try { return JSON.parse(localStorage.getItem(TIMELINE_DATA_KEY)   || '{}'); } catch { return {}; } }
function setTimelineData(d) { localStorage.setItem(TIMELINE_DATA_KEY, JSON.stringify(d)); }
function getBirolyDefaults()  { try { return JSON.parse(localStorage.getItem(BIROLY_DEFAULTS_KEY) || '{}'); } catch { return {}; } }
function setBirolyDefaults(d) { localStorage.setItem(BIROLY_DEFAULTS_KEY, JSON.stringify(d)); }

// ── Audio library (music + sfx uploaded by user) ─────────────────────────────
const AUDIO_LIB_KEY = 'audio_library_v1';
function getAudioLib()    { try { return JSON.parse(localStorage.getItem(AUDIO_LIB_KEY) || '[]'); } catch { return []; } }
function saveAudioLib(lib){ localStorage.setItem(AUDIO_LIB_KEY, JSON.stringify(lib)); }

// ── makeMusicControl(sessionKey, tlData, getVideoDur) ────────────────────────
// Returns { el, getUrl, getOffset, getVolume, setSaveCallback }
function makeMusicControl(sessionKey, tlData, getVideoDur) {
  const sd = tlData[sessionKey] || {};
  let currentUrl    = sd.music        || 'Нет';
  let currentOffset = parseFloat(sd.musicOffset) || 0;
  let currentVolume = (sd.musicVolume != null && !isNaN(sd.musicVolume)) ? parseFloat(sd.musicVolume) : 0.5;
  let _saveCallback = null;

  function _saveTl(patch) {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    Object.assign(d[sessionKey], patch);
    setTimelineData(d);
  }

  const wrap = document.createElement('div');
  wrap.className = 'audio-ctrl-wrap';

  // ── Row 1: label + dropdown + del button ─────────────────────────────────
  const row1 = document.createElement('div');
  row1.className = 'audio-ctrl-row';
  const lbl = document.createElement('span');
  lbl.className = 'audio-ctrl-lbl';
  lbl.textContent = 'Музычка:';
  const sel = document.createElement('select');
  sel.className = 'audio-ctrl-sel';
  const delBtn = document.createElement('button');
  delBtn.className = 'audio-del-btn'; delBtn.textContent = '🗑'; delBtn.title = 'Удалить из библиотеки';

  function _rebuildSel() {
    const lib = getAudioLib().filter(x => x.type === 'music');
    sel.innerHTML = '';
    ['Нет', 'Рандом'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    lib.forEach(item => { const o = document.createElement('option'); o.value = item.webPath; o.textContent = item.name; sel.appendChild(o); });
    sel.value = currentUrl;
  }
  _rebuildSel();
  row1.appendChild(lbl); row1.appendChild(sel); row1.appendChild(delBtn);
  wrap.appendChild(row1);

  // ── Collapsible details panel ─────────────────────────────────────────────
  const details = document.createElement('details');
  details.className = 'audio-details';
  const summary = document.createElement('summary');
  summary.className = 'audio-details-summary';
  summary.textContent = 'Настройки…';
  details.appendChild(summary);

  // ── Native audio player ───────────────────────────────────────────────────
  const player = document.createElement('audio');
  player.className = 'audio-player'; player.controls = true; player.preload = 'metadata';
  details.appendChild(player);

  // ── Timeline bar with video projection ───────────────────────────────────
  const barOuter = document.createElement('div');
  barOuter.className = 'audio-bar-outer';

  // ruler: left label (0s), right label (vidDur)
  const rulerRow = document.createElement('div');
  rulerRow.className = 'audio-bar-ruler';
  const rulerLeft  = document.createElement('span'); rulerLeft.textContent = '0s';
  const rulerRight = document.createElement('span');
  rulerRow.appendChild(rulerLeft); rulerRow.appendChild(rulerRight);
  barOuter.appendChild(rulerRow);

  // bar track
  const barWrap = document.createElement('div');
  barWrap.className = 'audio-music-bar-wrap';
  barWrap.title = 'Перетащи мышью для смещения';
  const bar    = document.createElement('div'); bar.className = 'audio-music-bar';
  const barLbl = document.createElement('div'); barLbl.className = 'audio-music-bar-lbl';
  // video duration overlay (shows exactly 0→vidDur as a faint region)
  const vidOverlay = document.createElement('div'); vidOverlay.className = 'audio-vid-overlay';
  barWrap.appendChild(vidOverlay);
  barWrap.appendChild(bar);
  barWrap.appendChild(barLbl);
  barOuter.appendChild(barWrap);
  details.appendChild(barOuter);

  // ── Offset + Volume row ───────────────────────────────────────────────────
  const paramsRow = document.createElement('div');
  paramsRow.className = 'audio-params-row';

  const offInp = document.createElement('input');
  offInp.type = 'number'; offInp.min = '0'; offInp.step = '0.1'; offInp.value = currentOffset.toFixed(1);
  offInp.style.cssText = 'width:46px;font-size:10px;padding:1px 3px;border:1px solid #bbb;border-radius:2px;';
  const offWrap = document.createElement('label');
  offWrap.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:9px;color:#666;';
  offWrap.textContent = 'Старт:'; offWrap.appendChild(offInp);
  const offSuf = document.createElement('span'); offSuf.textContent = 's'; offSuf.style.cssText = 'font-size:9px;color:#888;';

  const volInp = document.createElement('input');
  volInp.type = 'range'; volInp.min = '0'; volInp.max = '1'; volInp.step = '0.05'; volInp.value = currentVolume; volInp.style.width = '68px';
  const volVal = document.createElement('span'); volVal.textContent = currentVolume.toFixed(2); volVal.style.cssText = 'font-size:9px;color:#666;min-width:24px;';
  const volWrap = document.createElement('label');
  volWrap.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:9px;color:#666;';
  volWrap.textContent = 'Громк:'; volWrap.appendChild(volInp);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'audio-save-btn'; saveBtn.textContent = '💾'; saveBtn.title = 'Сохранить параметры и обновить renderBody';

  paramsRow.appendChild(offWrap); paramsRow.appendChild(offSuf);
  paramsRow.appendChild(volWrap); paramsRow.appendChild(volVal);
  paramsRow.appendChild(saveBtn);
  details.appendChild(paramsRow);

  // ── Update bar visuals ────────────────────────────────────────────────────
  function _updateBar() {
    const audioDur = (player.duration && isFinite(player.duration)) ? player.duration : 0;
    const vidDur   = getVideoDur ? Math.max(getVideoDur(), 1) : 30;

    // Update ruler right label
    rulerRight.textContent = vidDur.toFixed(1) + 's';

    // Video overlay: full-width = 100% of bar, but we want to show where vidDur ends relative to musicDur
    // The bar "scale" is max(audioDur+offset, vidDur). Show full audio range.
    const scaleDur = Math.max(audioDur + currentOffset, vidDur, 1);
    const vidPct   = (vidDur / scaleDur) * 100;
    vidOverlay.style.width = vidPct + '%';

    if (!audioDur) { bar.style.width = '0'; barLbl.textContent = ''; return; }

    const pctLeft  = (currentOffset / scaleDur) * 100;
    const pctWidth = (audioDur     / scaleDur) * 100;
    bar.style.left  = pctLeft + '%';
    bar.style.width = Math.max(pctWidth, 1) + '%';
    barLbl.textContent = audioDur.toFixed(1) + 's';
  }

  player.addEventListener('loadedmetadata', _updateBar);

  // Drag the blue music bar to set offset
  barWrap.addEventListener('mousedown', e => {
    e.preventDefault();
    const rect    = barWrap.getBoundingClientRect();
    const audioDur = (player.duration && isFinite(player.duration)) ? player.duration : 0;
    const vidDur   = getVideoDur ? Math.max(getVideoDur(), 1) : 30;
    const scaleDur = Math.max(audioDur + currentOffset, vidDur, 1);
    const startX   = e.clientX;
    const origOffset = currentOffset;
    const onMove = ev => {
      const dx = ev.clientX - startX;
      currentOffset = parseFloat(Math.max(0, origOffset + (dx / rect.width) * scaleDur).toFixed(1));
      offInp.value = currentOffset.toFixed(1);
      _updateBar();
    };
    const onUp = () => {
      _saveTl({ musicOffset: currentOffset });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  offInp.addEventListener('change', () => {
    currentOffset = Math.max(0, parseFloat(offInp.value) || 0);
    offInp.value = currentOffset.toFixed(1);
    _saveTl({ musicOffset: currentOffset });
    _updateBar();
  });
  volInp.addEventListener('input', () => {
    currentVolume = parseFloat(volInp.value);
    volVal.textContent = currentVolume.toFixed(2);
    player.volume = currentVolume;
    _saveTl({ musicVolume: currentVolume });
  });

  saveBtn.addEventListener('click', async () => {
    _saveTl({ musicOffset: currentOffset, musicVolume: currentVolume });
    if (!_saveCallback) { saveBtn.textContent = '✓'; setTimeout(() => { saveBtn.textContent = '💾'; }, 1200); return; }
    saveBtn.disabled = true; saveBtn.textContent = '…';
    try {
      const result = await _saveCallback();
      saveBtn.textContent = result.success ? '✓' : '⚠';
      if (!result.success) console.warn('[music save]', result.error);
    } catch (e) { saveBtn.textContent = '⚠'; console.warn('[music save]', e); }
    finally { saveBtn.disabled = false; setTimeout(() => { saveBtn.textContent = '💾'; }, 2000); }
  });

  // ── Show/hide details based on file selection ─────────────────────────────
  function _applyUrl(url) {
    currentUrl = url;
    const isFile = url && url !== 'Нет' && url !== 'Рандом';
    details.style.display = isFile ? '' : 'none';
    delBtn.style.display  = isFile ? '' : 'none';
    if (isFile) { player.src = url; player.load(); }
    _saveTl({ music: url });
    _updateBar();
  }

  _applyUrl(currentUrl);
  sel.addEventListener('change', () => _applyUrl(sel.value));

  delBtn.addEventListener('click', () => {
    if (!currentUrl || currentUrl === 'Нет' || currentUrl === 'Рандом') return;
    saveAudioLib(getAudioLib().filter(x => !(x.type === 'music' && x.webPath === currentUrl)));
    currentUrl = 'Нет'; _rebuildSel(); _applyUrl('Нет');
  });

  // ── Upload row ────────────────────────────────────────────────────────────
  const upRow = document.createElement('div');
  upRow.className = 'audio-upload-row';
  const fileInp = document.createElement('input'); fileInp.type = 'file'; fileInp.accept = 'audio/*';
  const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.placeholder = 'Название…'; nameInp.maxLength = 60;
  const upBtn   = document.createElement('button'); upBtn.className = 'audio-upload-btn'; upBtn.textContent = '⬆ Загрузить';

  fileInp.addEventListener('change', () => { if (fileInp.files[0] && !nameInp.value) nameInp.value = fileInp.files[0].name.replace(/\.[^.]+$/, '').slice(0, 40); });
  upBtn.addEventListener('click', async () => {
    if (!fileInp.files[0]) return;
    upBtn.disabled = true; upBtn.textContent = '…';
    try {
      const fd = new FormData(); fd.append('file', fileInp.files[0]);
      if (nameInp.value) fd.append('name', nameInp.value);
      const r = await fetch('/api/audio/upload-file', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      const lib = getAudioLib();
      lib.push({ id: Date.now().toString(), name: d.name, webPath: d.webPath, type: 'music', addedAt: new Date().toISOString() });
      saveAudioLib(lib); _rebuildSel(); sel.value = d.webPath; _applyUrl(d.webPath);
      fileInp.value = ''; nameInp.value = '';
    } catch (e) { alert('Ошибка загрузки: ' + e.message); }
    finally { upBtn.disabled = false; upBtn.textContent = '⬆ Загрузить'; }
  });

  upRow.appendChild(fileInp); upRow.appendChild(nameInp); upRow.appendChild(upBtn);
  wrap.appendChild(details);
  wrap.appendChild(upRow);

  return {
    el: wrap,
    getUrl:    () => currentUrl,
    getOffset: () => currentOffset,
    getVolume: () => currentVolume,
    setSaveCallback: cb => { _saveCallback = cb; },
  };
}

// ── makeSfxControl(sessionKey, tlData, sfxKey) ───────────────────────────────
// Returns { el, getUrl }
// sfxKey: key in tlData[sessionKey] to store selection (default 'sfx')
function makeSfxControl(sessionKey, tlData, sfxKey = 'sfx') {
  const sd = tlData[sessionKey] || {};
  let currentUrl = sd[sfxKey] || 'Нет';

  function _saveTl(patch) {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    Object.assign(d[sessionKey], patch);
    setTimelineData(d);
  }

  const wrap = document.createElement('div');
  wrap.className = 'audio-ctrl-wrap audio-sfx-wrap'; // black top border separator via CSS

  const row1 = document.createElement('div');
  row1.className = 'audio-ctrl-row';
  const lbl = document.createElement('span');
  lbl.className = 'audio-ctrl-lbl'; lbl.textContent = sfxKey === 'segSfx' ? 'Вжухи (гол.):' : sfxKey === 'biroSfx' ? 'Вжухи (бир.):' : 'Вжухи:';
  const sel   = document.createElement('select'); sel.className = 'audio-ctrl-sel';
  const playBtn = document.createElement('button'); playBtn.className = 'audio-play-btn'; playBtn.textContent = '▶'; playBtn.title = 'Прослушать';
  const delBtn  = document.createElement('button'); delBtn.className = 'audio-del-btn'; delBtn.textContent = '🗑'; delBtn.title = 'Удалить из библиотеки';

  // hidden player
  const player = document.createElement('audio'); player.preload = 'none'; player.style.display = 'none';
  wrap.appendChild(player);

  function _rebuildSel() {
    const lib = getAudioLib().filter(x => x.type === 'sfx');
    sel.innerHTML = '';
    ['Нет', 'Рандом'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    lib.forEach(item => { const o = document.createElement('option'); o.value = item.webPath; o.textContent = item.name; sel.appendChild(o); });
    sel.value = currentUrl;
  }
  _rebuildSel();

  function _applyUrl(url) {
    currentUrl = url;
    const isFile = url && url !== 'Нет' && url !== 'Рандом';
    playBtn.style.display = isFile ? '' : 'none';
    delBtn.style.display  = isFile ? '' : 'none';
    if (isFile) player.src = url;
    _saveTl({ [sfxKey]: url });
  }
  _applyUrl(currentUrl);

  sel.addEventListener('change', () => _applyUrl(sel.value));
  playBtn.addEventListener('click', () => {
    if (player.paused) { player.load(); player.play(); playBtn.textContent = '⏹'; }
    else { player.pause(); player.currentTime = 0; playBtn.textContent = '▶'; }
  });
  player.addEventListener('ended', () => { playBtn.textContent = '▶'; });
  delBtn.addEventListener('click', () => {
    if (!currentUrl || currentUrl === 'Нет' || currentUrl === 'Рандом') return;
    saveAudioLib(getAudioLib().filter(x => !(x.type === 'sfx' && x.webPath === currentUrl)));
    currentUrl = 'Нет'; _rebuildSel(); _applyUrl('Нет');
  });

  row1.appendChild(lbl); row1.appendChild(sel); row1.appendChild(playBtn); row1.appendChild(delBtn);
  wrap.appendChild(row1);

  // ── Upload row ───────────────────────────────────────────────────────────
  const upRow = document.createElement('div');
  upRow.className = 'audio-upload-row';
  const fileInp = document.createElement('input');
  fileInp.type = 'file'; fileInp.accept = 'audio/*';
  const nameInp = document.createElement('input');
  nameInp.type = 'text'; nameInp.placeholder = 'Название…'; nameInp.maxLength = 60;
  const upBtn = document.createElement('button');
  upBtn.className = 'audio-upload-btn'; upBtn.textContent = '⬆ Загрузить';

  fileInp.addEventListener('change', () => {
    if (fileInp.files[0] && !nameInp.value) nameInp.value = fileInp.files[0].name.replace(/\.[^.]+$/, '').slice(0, 40);
  });

  upBtn.addEventListener('click', async () => {
    if (!fileInp.files[0]) return;
    upBtn.disabled = true; upBtn.textContent = '…';
    try {
      const fd = new FormData();
      fd.append('file', fileInp.files[0]);
      if (nameInp.value) fd.append('name', nameInp.value);
      const r = await fetch('/api/audio/upload-file', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      const lib = getAudioLib();
      lib.push({ id: Date.now().toString(), name: d.name, webPath: d.webPath, type: 'sfx', addedAt: new Date().toISOString() });
      saveAudioLib(lib);
      _rebuildSel();
      sel.value = d.webPath;
      _applyUrl(d.webPath);
      fileInp.value = ''; nameInp.value = '';
    } catch (e) { alert('Ошибка загрузки: ' + e.message); }
    finally { upBtn.disabled = false; upBtn.textContent = '⬆ Загрузить'; }
  });

  upRow.appendChild(fileInp); upRow.appendChild(nameInp); upRow.appendChild(upBtn);
  wrap.appendChild(upRow);

  return { el: wrap, getUrl: () => currentUrl };
}

function getCompletedSessions() {
  return Object.entries(editFrozenSessions).filter(([, s]) => {
    if (!Array.isArray(s.cells)) return false;
    const audioCells = s.cells.filter(c => c.audioPath);
    return audioCells.length > 0 && audioCells.every(c => c.videoPath && !c._videoPending && !c.videoError);
  });
}

// ── Right column: biroly list for one session ────────────────────────────────
// Active birolys sorted by start time. Inactive birolys below (hideable).
// Per-session state in timeline_data_v2: { activated[], timings{}, hideInactive }
function renderSessionBirolys(container, sessionKey) {
  container.innerHTML = '';
  const data        = getTimelineData();
  const archive     = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
  const sessionData = data[sessionKey] || {};
  const activated   = new Set(sessionData.activated || []);
  const timings     = sessionData.timings || {};
  const hideInactive = !!sessionData.hideInactive;

  // ── Header row: "Биролы" + hide-toggle + save-default + reset ───────────
  const hdrRow = document.createElement('div');
  hdrRow.style.cssText = 'display:flex;align-items:center;gap:3px;margin-bottom:5px;flex-wrap:wrap;';
  const hdrLbl = document.createElement('span');
  hdrLbl.style.cssText = 'font-size:9px;color:#555;font-weight:bold;flex:1;min-width:0;';
  hdrLbl.textContent = 'Биролы';

  const _btnStyle = 'font-size:8px;padding:1px 5px;cursor:pointer;background:#d4d0c8;border:1px solid #808080;flex-shrink:0;white-space:nowrap;';

  const hideBtn = document.createElement('button');
  hideBtn.style.cssText = _btnStyle;
  hideBtn.textContent = hideInactive ? 'Показать все' : 'Скрыть неакт.';
  hideBtn.title = hideInactive ? 'Показать неактивные биролы' : 'Скрыть неактивные биролы';
  hideBtn.addEventListener('click', () => {
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    d[sessionKey].hideInactive = !d[sessionKey].hideInactive;
    setTimelineData(d);
    renderSessionBirolys(container, sessionKey);
  });

  // ── Save as default ──────────────────────────────────────────────────────
  const defaults     = getBirolyDefaults();
  const hasDefault   = !!defaults[sessionKey];

  const saveDefBtn = document.createElement('button');
  saveDefBtn.style.cssText = _btnStyle + 'background:#e4f0e4;border-color:#5a9a5a;color:#1a5c1a;';
  saveDefBtn.textContent = '⭐ Дефолт';
  saveDefBtn.title = hasDefault
    ? 'Сохранить текущий порядок и тайминги как дефолт (заменит сохранённый)'
    : 'Сохранить текущий порядок и тайминги биролов как дефолт';
  saveDefBtn.addEventListener('click', () => {
    const d  = getTimelineData();
    const sd = d[sessionKey] || {};
    const snap = {
      activated: JSON.parse(JSON.stringify(sd.activated || [])),
      timings:   JSON.parse(JSON.stringify(sd.timings   || {})),
    };
    const defs = getBirolyDefaults();
    defs[sessionKey] = snap;
    setBirolyDefaults(defs);
    saveDefBtn.textContent = '⭐ Сохранено';
    saveDefBtn.style.background = '#b8e0b8';
    setTimeout(() => {
      saveDefBtn.textContent = '⭐ Дефолт';
      saveDefBtn.style.background = '#e4f0e4';
    }, 1500);
  });

  // ── Reset to default ─────────────────────────────────────────────────────
  const resetDefBtn = document.createElement('button');
  resetDefBtn.style.cssText = _btnStyle + (hasDefault
    ? 'background:#f0e4d4;border-color:#9a6a1a;color:#5c3a00;'
    : 'opacity:0.45;cursor:default;');
  resetDefBtn.textContent = '↺ Сброс';
  resetDefBtn.title = hasDefault ? 'Вернуть дефолтный порядок биролов' : 'Дефолт ещё не сохранён';
  resetDefBtn.disabled = !hasDefault;
  resetDefBtn.addEventListener('click', () => {
    if (!hasDefault) return;
    const defs = getBirolyDefaults();
    const snap = defs[sessionKey];
    if (!snap) return;
    const d = getTimelineData();
    if (!d[sessionKey]) d[sessionKey] = {};
    d[sessionKey].activated = JSON.parse(JSON.stringify(snap.activated || []));
    d[sessionKey].timings   = JSON.parse(JSON.stringify(snap.timings   || {}));
    setTimelineData(d);
    renderSessionBirolys(container, sessionKey);
    refreshBirolyBars();
  });

  hdrRow.appendChild(hdrLbl);
  hdrRow.appendChild(saveDefBtn);
  hdrRow.appendChild(resetDefBtn);
  hdrRow.appendChild(hideBtn);
  container.appendChild(hdrRow);

  const allItems = archive
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item && item.videoPath);

  if (!allItems.length) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:9px;color:#888;';
    empty.textContent = 'Нет биролов с видео';
    container.appendChild(empty);
    return;
  }

  // Read category order from biroly_cats localStorage key (same source as Биролы tab)
  const BIROLY_DEFAULT_CATS = [
    { id: 'hooks',   label: 'Hooks' },
    { id: 'science', label: 'Science' },
    { id: 'hands',   label: 'Hands' },
    { id: 'faces',   label: 'Faces' },
  ];
  const catOrder = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('biroly_cats') || '[]');
      return parsed.length ? parsed : BIROLY_DEFAULT_CATS;
    } catch { return BIROLY_DEFAULT_CATS; }
  })();

  function saveTiming(birolyIdx, updates) {
    const d = getTimelineData();
    if (!d[sessionKey])                    d[sessionKey] = {};
    if (!d[sessionKey].timings)            d[sessionKey].timings = {};
    if (!d[sessionKey].timings[birolyIdx]) d[sessionKey].timings[birolyIdx] = {};
    Object.assign(d[sessionKey].timings[birolyIdx], updates);
    setTimelineData(d);
  }

  // Render a single biroly card into container
  function renderBirolyCard(item, birolyIdx) {
    const isActive = activated.has(birolyIdx);
    const saved    = timings[birolyIdx] || {};
    const dur      = parseFloat(item.duration || 6);

    // Match timeline bar color for this biroly
    const tlColor  = TL_COLORS[birolyIdx % TL_COLORS.length];
    // Derive a subtle background tint from the timeline color (low opacity)
    const bgActive = tlColor + '28'; // ~16% opacity hex suffix

    const card = document.createElement('div');
    card.style.cssText = `display:flex;flex-direction:column;gap:3px;margin-bottom:4px;padding:3px 4px;
      border:1px solid ${isActive ? tlColor : '#c0c0c0'};
      background:${isActive ? bgActive : '#ebebeb'};
      ${!isActive ? 'opacity:0.75;' : ''}`;

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const thumbSrc = item.thumbPath || item.imagePath;
    const thumbCss = 'width:22px;height:30px;object-fit:cover;flex-shrink:0;cursor:pointer;border:1px solid #808080;';
    const openFn   = item.videoPath ? () => window.openBirolyVideoLightbox?.(item.videoPath, item.imagePath || item.thumbPath) : null;
    if (thumbSrc) {
      const thumb = document.createElement('img');
      thumb.src = thumbSrc; thumb.style.cssText = thumbCss;
      thumb.title = '▶ ' + (item.name || 'Бирол');
      if (openFn) {
        thumb.addEventListener('click', openFn);
        thumb.addEventListener('error', () => {
          if (item.videoPath && thumb.parentNode)
            thumb.parentNode.replaceChild(_videoThumb(item.videoPath, thumbCss, openFn), thumb);
          else thumb.style.display = 'none';
        }, { once: true });
      }
      topRow.appendChild(thumb);
    } else if (item.videoPath) {
      topRow.appendChild(_videoThumb(item.videoPath, thumbCss, openFn));
    }

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'flex:1;font-size:9px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
    nameEl.textContent = item.name || 'Бирол';
    topRow.appendChild(nameEl);

    const toggleBtn = document.createElement('button');
    toggleBtn.style.cssText = `flex-shrink:0;font-size:9px;padding:1px 5px;cursor:pointer;
      ${isActive ? `background:${tlColor};color:#fff;font-weight:bold;border:1px solid ${tlColor};` : 'background:#d4d4d4;border:1px solid #a0a0a0;'}`;
    toggleBtn.textContent = isActive ? '★' : '☆';
    toggleBtn.title = isActive ? 'Деактивировать' : 'Активировать';
    toggleBtn.addEventListener('click', () => {
      const d = getTimelineData();
      if (!d[sessionKey])           d[sessionKey] = {};
      if (!d[sessionKey].activated) d[sessionKey].activated = [];
      const arr = d[sessionKey].activated;
      const pos = arr.indexOf(birolyIdx);
      if (pos === -1) {
        arr.push(birolyIdx);
        if (!d[sessionKey].timings)            d[sessionKey].timings = {};
        if (!d[sessionKey].timings[birolyIdx]) {
          d[sessionKey].timings[birolyIdx] = { crop: '0', start: '0.00', end: dur.toFixed(2) };
        }
      } else { arr.splice(pos, 1); }
      setTimelineData(d);
      renderSessionBirolys(container, sessionKey);
    });
    topRow.appendChild(toggleBtn);
    card.appendChild(topRow);

    if (isActive) {
      const timingRow = document.createElement('div');
      timingRow.style.cssText = 'display:flex;align-items:center;gap:2px;flex-wrap:nowrap;';
      const lbl = t => { const s = document.createElement('span'); s.style.cssText = 'font-size:8px;color:#555;flex-shrink:0;'; s.textContent = t; return s; };
      const inp = (val, ph, w) => { const i = document.createElement('input'); i.type = 'text'; i.value = val || ''; i.placeholder = ph; i.style.cssText = `width:${w||34}px;font-size:8px;padding:1px 2px;box-sizing:border-box;`; return i; };

      const cropInp  = inp(saved.crop  ?? '0',            'crop', 30);
      const startInp = inp(saved.start ?? '0.00',         '0.00', 36);
      const endInp   = inp(saved.end   ?? dur.toFixed(2), '0.00', 36);

      // Data attributes so drag handler can find + update these inputs directly
      startInp.dataset.timingKey = `${sessionKey}__${birolyIdx}__start`;
      endInp.dataset.timingKey   = `${sessionKey}__${birolyIdx}__end`;

      const recalcEnd = () => { const c = parseFloat(cropInp.value)||0; const s = parseFloat(startInp.value)||0; endInp.value = (s + Math.max(0, dur - c)).toFixed(2); };
      const saveAll   = () => saveTiming(birolyIdx, { crop: cropInp.value, start: startInp.value, end: endInp.value });

      cropInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      cropInp.addEventListener('change', () => { saveAll(); refreshBirolyBars(); });
      startInp.addEventListener('input',  () => { recalcEnd(); saveAll(); });
      startInp.addEventListener('change', () => { saveAll(); renderSessionBirolys(container, sessionKey); refreshBirolyBars(); });
      endInp.addEventListener('change',   () => { saveAll(); refreshBirolyBars(); });

      timingRow.appendChild(lbl('crop')); timingRow.appendChild(cropInp);
      timingRow.appendChild(lbl('с:'));   timingRow.appendChild(startInp);
      timingRow.appendChild(lbl('до:'));  timingRow.appendChild(endInp);
      card.appendChild(timingRow);
    }
    container.appendChild(card);
  }

  // Group allItems by categoryId
  const groupMap = new Map();
  allItems.forEach(({ item, idx }) => {
    const cid = item.categoryId || '__none__';
    if (!groupMap.has(cid)) groupMap.set(cid, { label: item.categoryLabel || 'Без категории', items: [] });
    groupMap.get(cid).items.push({ item, idx });
  });

  // Build ordered groups: catOrder first, then leftovers
  const orderedGroups = [];
  catOrder.forEach(cat => {
    if (groupMap.has(cat.id)) {
      orderedGroups.push({ label: cat.label, items: groupMap.get(cat.id).items });
      groupMap.delete(cat.id);
    }
  });
  groupMap.forEach(({ label, items }) => orderedGroups.push({ label, items }));

  // Render groups
  orderedGroups.forEach(({ label, items }) => {
    const activeInGroup   = items.filter(({ idx }) => activated.has(idx))
      .sort((a, b) => (parseFloat(timings[a.idx]?.start)||0) - (parseFloat(timings[b.idx]?.start)||0));
    const inactiveInGroup = hideInactive ? [] : items.filter(({ idx }) => !activated.has(idx));
    if (!activeInGroup.length && !inactiveInGroup.length) return;

    // Category header
    const catHdr = document.createElement('div');
    catHdr.style.cssText = 'font-size:8px;font-weight:bold;color:#555;text-transform:uppercase;letter-spacing:0.05em;background:#d8d4cc;padding:2px 5px;margin:4px -4px 3px;border-top:1px solid #a0a0a0;border-bottom:1px solid #a0a0a0;';
    catHdr.textContent = label;
    container.appendChild(catHdr);

    activeInGroup.forEach(({ item, idx }) => renderBirolyCard(item, idx));

    if (inactiveInGroup.length) {
      const sep = document.createElement('div');
      sep.style.cssText = 'border-top:1px dashed #bbb;margin:3px 0 2px;font-size:8px;color:#aaa;padding-top:2px;';
      sep.textContent = 'неактивные';
      container.appendChild(sep);
      inactiveInGroup.forEach(({ item, idx }) => renderBirolyCard(item, idx));
    }
  });
  // After any re-render, sync biroly bars
  refreshBirolyBars();
}

// ── Per-project Таймлайн rows (one per completed session) ─────────────────────
const TL_COLORS = ['#3a7a5a','#4a6a9a','#7a4a8a','#9a7a3a','#3a6a7a','#7a3a4a','#5a8a3a','#8a5a3a'];

// ── FFmpeg Advanced Settings — defaults ───────────────────────────────────────
const ADV_DEFAULTS = {
  resolution:   '1080x1920',
  fps:          30,
  crf:          23,
  preset:       'fast',
  audioBitrate: '192k',
  eqBrightness: 0,
  eqContrast:   1,
  eqSaturation: 1,
  eqGamma:      1,
  subsEnabled:  false,
  subsFontSize: 48,
  subsPosition: 'bottom',
  subsColor:    '#ffffff',
  subsStyle:    'outline',
};

// ── Advanced-settings modal (global, one instance shared across sessions) ─────
let _advModalInited = false;
let _advCurSessionKey = null;

function _advSlider(id, valId, fmt) {
  const sl = document.getElementById(id);
  const vl = document.getElementById(valId);
  if (!sl || !vl) return;
  sl.addEventListener('input', () => { vl.textContent = fmt(parseFloat(sl.value)); });
}

function _advSubsToggle() {
  const enabled = document.getElementById('adv-subs-enabled')?.checked;
  const opts    = document.getElementById('adv-subs-opts');
  if (opts) opts.classList.toggle('adv-hidden', !enabled);
}

function _openAdvModal(sessionKey) {
  if (!_advModalInited) {
    _advModalInited = true;
    document.getElementById('adv-modal-close') .addEventListener('click',  _closeAdvModal);
    document.getElementById('adv-modal-cancel').addEventListener('click',  _closeAdvModal);
    document.getElementById('adv-modal-apply') .addEventListener('click',  _applyAdvModal);
    document.getElementById('adv-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('adv-modal-overlay')) _closeAdvModal();
    });
    _advSlider('adv-crf',        'adv-crf-val',        v => v.toFixed(0));
    _advSlider('adv-brightness', 'adv-brightness-val', v => v.toFixed(2));
    _advSlider('adv-contrast',   'adv-contrast-val',   v => v.toFixed(2));
    _advSlider('adv-saturation', 'adv-saturation-val', v => v.toFixed(2));
    _advSlider('adv-gamma',      'adv-gamma-val',      v => v.toFixed(2));
    _advSlider('adv-subs-size',  'adv-subs-size-val',  v => v.toFixed(0));
    document.getElementById('adv-subs-enabled')?.addEventListener('change', _advSubsToggle);
  }
  _advCurSessionKey = sessionKey;
  const tlData = getTimelineData();
  const adv = { ...ADV_DEFAULTS, ...(tlData[sessionKey]?.advSettings || {}) };
  _populateAdvModal(adv);
  document.getElementById('adv-modal-overlay').classList.add('open');
}

function _closeAdvModal() {
  document.getElementById('adv-modal-overlay').classList.remove('open');
}

function _populateAdvModal(adv) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  const setVal = (valId, v, fmt) => { const el = document.getElementById(valId); if (el) el.textContent = fmt(v); };

  set('adv-resolution',   adv.resolution);
  set('adv-fps',          String(adv.fps));
  set('adv-crf',          String(adv.crf));          setVal('adv-crf-val',        adv.crf,          v => v.toFixed(0));
  set('adv-preset',       adv.preset);
  set('adv-audio-bitrate', adv.audioBitrate);
  set('adv-brightness',   String(adv.eqBrightness)); setVal('adv-brightness-val', adv.eqBrightness, v => v.toFixed(2));
  set('adv-contrast',     String(adv.eqContrast));   setVal('adv-contrast-val',   adv.eqContrast,   v => v.toFixed(2));
  set('adv-saturation',   String(adv.eqSaturation)); setVal('adv-saturation-val', adv.eqSaturation, v => v.toFixed(2));
  set('adv-gamma',        String(adv.eqGamma));      setVal('adv-gamma-val',      adv.eqGamma,      v => v.toFixed(2));
  setChk('adv-subs-enabled', adv.subsEnabled);
  set('adv-subs-size',    String(adv.subsFontSize)); setVal('adv-subs-size-val',  adv.subsFontSize, v => v.toFixed(0));
  set('adv-subs-pos',     adv.subsPosition);
  set('adv-subs-color',   adv.subsColor);
  set('adv-subs-style',   adv.subsStyle);
  _advSubsToggle();
}

function _readAdvModal() {
  const num  = id => parseFloat(document.getElementById(id)?.value) || 0;
  const str  = id => document.getElementById(id)?.value || '';
  const chk  = id => !!document.getElementById(id)?.checked;
  return {
    resolution:   str('adv-resolution')   || ADV_DEFAULTS.resolution,
    fps:          parseInt(str('adv-fps')) || ADV_DEFAULTS.fps,
    crf:          parseInt(str('adv-crf')) || ADV_DEFAULTS.crf,
    preset:       str('adv-preset')       || ADV_DEFAULTS.preset,
    audioBitrate: str('adv-audio-bitrate')|| ADV_DEFAULTS.audioBitrate,
    eqBrightness: num('adv-brightness'),
    eqContrast:   num('adv-contrast')   || 1,
    eqSaturation: num('adv-saturation') || 1,
    eqGamma:      num('adv-gamma')      || 1,
    subsEnabled:  chk('adv-subs-enabled'),
    subsFontSize: parseInt(str('adv-subs-size')) || ADV_DEFAULTS.subsFontSize,
    subsPosition: str('adv-subs-pos')   || ADV_DEFAULTS.subsPosition,
    subsColor:    str('adv-subs-color') || ADV_DEFAULTS.subsColor,
    subsStyle:    str('adv-subs-style') || ADV_DEFAULTS.subsStyle,
  };
}

function _applyAdvModal() {
  const adv = _readAdvModal();
  const d   = getTimelineData();
  if (!d[_advCurSessionKey]) d[_advCurSessionKey] = {};
  d[_advCurSessionKey].advSettings = adv;
  setTimelineData(d);
  _closeAdvModal();
}

// ── ASS subtitle styling modal ────────────────────────────────────────────────
const ASS_DEFAULTS = {
  fontName:     'Arial',
  fontSize:     60,
  bold:         false,
  italic:       false,
  primaryColor: '#ffffff',
  outlineColor: '#000000',
  shadowColor:  '#000000',
  backColor:    '#000000',
  backAlpha:    128,
  borderStyle:  1,
  outline:      2.5,
  shadow:       1,
  blur:         0,
  alignment:    2,
  marginV:      60,
  marginL:      20,
  marginR:      20,
  fadeIn:       200,
  fadeOut:      150,
  slideFrom:    'none',
  slideDist:    60,
};

let _assModalInited = false;
let _assCurSessionKey = null;

function _assSlider(id, valId, fmt) {
  const sl = document.getElementById(id);
  const vl = document.getElementById(valId);
  if (!sl || !vl) return;
  sl.addEventListener('input', () => { vl.textContent = fmt(parseFloat(sl.value)); });
}

function _openAssModal(sessionKey) {
  if (!_assModalInited) {
    _assModalInited = true;
    document.getElementById('ass-modal-close') .addEventListener('click',  _closeAssModal);
    document.getElementById('ass-modal-cancel').addEventListener('click',  _closeAssModal);
    document.getElementById('ass-modal-apply') .addEventListener('click',  _applyAssModal);
    document.getElementById('ass-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('ass-modal-overlay')) _closeAssModal();
    });
    _assSlider('ass-font-size',  'ass-font-size-val',  v => v.toFixed(0));
    _assSlider('ass-back-alpha', 'ass-back-alpha-val', v => Math.round(v * 100 / 255) + '%');
    _assSlider('ass-outline',    'ass-outline-val',    v => v.toFixed(1));
    _assSlider('ass-shadow',     'ass-shadow-val',     v => v.toFixed(1));
    _assSlider('ass-blur',       'ass-blur-val',       v => v.toFixed(1));
    _assSlider('ass-margin-v',   'ass-margin-v-val',   v => v.toFixed(0) + 'px');
    _assSlider('ass-margin-l',   'ass-margin-l-val',   v => v.toFixed(0) + 'px');
    _assSlider('ass-margin-r',   'ass-margin-r-val',   v => v.toFixed(0) + 'px');
    _assSlider('ass-fade-in',    'ass-fade-in-val',    v => v.toFixed(0) + 'мс');
    _assSlider('ass-fade-out',   'ass-fade-out-val',   v => v.toFixed(0) + 'мс');
    _assSlider('ass-slide-dist', 'ass-slide-dist-val', v => v.toFixed(0) + 'px');
    // Alignment grid
    document.getElementById('ass-align-grid')?.addEventListener('click', e => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      document.getElementById('ass-alignment').value = btn.dataset.v;
      document.querySelectorAll('#ass-align-grid button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }
  _assCurSessionKey = sessionKey;
  const tlData = getTimelineData();
  const ass = { ...ASS_DEFAULTS, ...(tlData[sessionKey]?.assSettings || {}) };
  _populateAssModal(ass);
  document.getElementById('ass-modal-overlay').classList.add('open');
}

function _closeAssModal() {
  document.getElementById('ass-modal-overlay').classList.remove('open');
}

function _populateAssModal(ass) {
  const set    = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  const setVal = (valId, v, fmt) => { const el = document.getElementById(valId); if (el) el.textContent = fmt(v); };

  set('ass-font-name',    ass.fontName);
  set('ass-font-size',    String(ass.fontSize));   setVal('ass-font-size-val',  ass.fontSize, v => v.toFixed(0));
  setChk('ass-bold',      ass.bold);
  setChk('ass-italic',    ass.italic);
  set('ass-primary-color', ass.primaryColor);
  set('ass-outline-color', ass.outlineColor);
  set('ass-shadow-color',  ass.shadowColor);
  set('ass-back-color',    ass.backColor);
  set('ass-back-alpha',   String(ass.backAlpha));  setVal('ass-back-alpha-val', ass.backAlpha, v => Math.round(v * 100 / 255) + '%');
  set('ass-border-style', String(ass.borderStyle));
  set('ass-outline',      String(ass.outline));    setVal('ass-outline-val',    ass.outline,   v => v.toFixed(1));
  set('ass-shadow',       String(ass.shadow));     setVal('ass-shadow-val',     ass.shadow,    v => v.toFixed(1));
  set('ass-blur',         String(ass.blur));       setVal('ass-blur-val',       ass.blur,      v => v.toFixed(1));
  set('ass-alignment',    String(ass.alignment));
  set('ass-margin-v',     String(ass.marginV));    setVal('ass-margin-v-val',   ass.marginV,   v => v.toFixed(0) + 'px');
  set('ass-margin-l',     String(ass.marginL));    setVal('ass-margin-l-val',   ass.marginL,   v => v.toFixed(0) + 'px');
  set('ass-margin-r',     String(ass.marginR));    setVal('ass-margin-r-val',   ass.marginR,   v => v.toFixed(0) + 'px');
  set('ass-fade-in',      String(ass.fadeIn));     setVal('ass-fade-in-val',    ass.fadeIn,    v => v.toFixed(0) + 'мс');
  set('ass-fade-out',     String(ass.fadeOut));    setVal('ass-fade-out-val',   ass.fadeOut,   v => v.toFixed(0) + 'мс');
  set('ass-slide-from',   ass.slideFrom);
  set('ass-slide-dist',   String(ass.slideDist));  setVal('ass-slide-dist-val', ass.slideDist, v => v.toFixed(0) + 'px');
  // Update alignment grid active state
  document.querySelectorAll('#ass-align-grid button').forEach(b => {
    b.classList.toggle('active', b.dataset.v === String(ass.alignment));
  });
}

function _readAssModal() {
  const num = id => parseFloat(document.getElementById(id)?.value) || 0;
  const str = id => document.getElementById(id)?.value || '';
  const chk = id => !!document.getElementById(id)?.checked;
  return {
    fontName:     str('ass-font-name')    || ASS_DEFAULTS.fontName,
    fontSize:     parseInt(str('ass-font-size')) || ASS_DEFAULTS.fontSize,
    bold:         chk('ass-bold'),
    italic:       chk('ass-italic'),
    primaryColor: str('ass-primary-color') || ASS_DEFAULTS.primaryColor,
    outlineColor: str('ass-outline-color') || ASS_DEFAULTS.outlineColor,
    shadowColor:  str('ass-shadow-color')  || ASS_DEFAULTS.shadowColor,
    backColor:    str('ass-back-color')    || ASS_DEFAULTS.backColor,
    backAlpha:    Math.round(num('ass-back-alpha')),
    borderStyle:  parseInt(str('ass-border-style')) || 1,
    outline:      num('ass-outline'),
    shadow:       num('ass-shadow'),
    blur:         num('ass-blur'),
    alignment:    parseInt(str('ass-alignment'))   || ASS_DEFAULTS.alignment,
    marginV:      Math.round(num('ass-margin-v')),
    marginL:      Math.round(num('ass-margin-l')),
    marginR:      Math.round(num('ass-margin-r')),
    fadeIn:       Math.round(num('ass-fade-in')),
    fadeOut:      Math.round(num('ass-fade-out')),
    slideFrom:    str('ass-slide-from')  || 'none',
    slideDist:    Math.round(num('ass-slide-dist')),
  };
}

function _applyAssModal() {
  const ass = _readAssModal();
  const d   = getTimelineData();
  if (!d[_assCurSessionKey]) d[_assCurSessionKey] = {};
  d[_assCurSessionKey].assSettings = ass;
  setTimelineData(d);
  _closeAssModal();
}

// ── Parse SRT content to [{text,start,end}] ───────────────────────────────────
function _parseSrt(srtContent) {
  const blocks = (srtContent || '').trim().split(/\n\n+/);
  const subs = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
    const parseTime = s => {
      const [h, m, rest] = s.split(':');
      const [sec, ms] = rest.replace(',', '.').split('.');
      return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(sec) + parseInt(ms || 0) / 1000;
    };
    const textLines = lines.slice(lines.indexOf(timeLine) + 1).filter(Boolean);
    const text = textLines.join(' ').trim();
    if (text) subs.push({ text, start: parseTime(startStr), end: parseTime(endStr) });
  }
  return subs;
}

let _tlRunning = false, _tlQueued = false;
async function renderAllTimelines() {
  if (_tlRunning) { _tlQueued = true; return; }
  _tlRunning = true;
  try { await _renderAllTimelinesImpl(); }
  finally {
    _tlRunning = false;
    if (_tlQueued) { _tlQueued = false; renderAllTimelines(); }
  }
}
async function _renderAllTimelinesImpl() {
  const wrap = document.getElementById('skleyka-timelines');
  if (!wrap) return;
  wrap.innerHTML = '';

  // Only sessions where ALL audio cells have finished videos
  const sessions = getCompletedSessions();

  if (!sessions.length) {
    const row = document.createElement('div');
    row.className = 'skleyka-row';
    row.innerHTML = '<div class="col-header">Таймлайн</div><span style="color:#888;font-size:11px;">Здесь появится таймлайн после завершения генерации всех видеофрагментов</span>';
    wrap.appendChild(row);
    return;
  }

  for (let si = 0; si < sessions.length; si++) {
    const [sessionKey, session] = sessions[si];
    const scenName = sessionKey.split('__').slice(1).join('__').replace(/\.txt$/i, '');

    // Load audio durations (all sessions here are completed — every audio cell has a video)
    const durations = await Promise.all(
      session.cells.map(c => c.audioPath ? getAudioDuration(c.audioPath) : Promise.resolve(0))
    );

    // Read per-session exclusions and controls settings
    const tlData = getTimelineData();
    const sessData = tlData[sessionKey] || {};
    const excludedSet = new Set(sessData.excludedSegments || []);

    // Build all segments with original (full) timing
    let allCursor = 0;
    const allSegments = session.cells.map((cell, i) => {
      const dur = durations[i] || 0; const start = allCursor; allCursor += dur;
      return { cell, idx: i, start, end: allCursor, dur };
    }).filter(s => s.dur > 0);

    // Active segments (non-excluded) with recalculated consecutive timing
    let activeCursor = 0;
    const activeSegments = allSegments
      .filter(s => !excludedSet.has(s.idx))
      .map(s => { const st = activeCursor; activeCursor += s.dur; return { ...s, activeStart: st, activeEnd: activeCursor }; });
    const totalDur = activeCursor;

    // Row
    const row = document.createElement('div');
    row.className = 'skleyka-row';

    const hdr = document.createElement('div');
    hdr.className = 'col-header';
    hdr.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const hdrText = document.createElement('span');
    hdrText.style.cssText = 'flex:1;';
    hdrText.textContent = `Таймлайн-${si + 1}: ${scenName}` + (totalDur > 0 ? `  (${totalDur.toFixed(2)}с)` : '');
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = '↺';
    refreshBtn.title = 'Обновить таймлайн';
    refreshBtn.style.cssText = 'font-size:11px;padding:0 5px;cursor:pointer;background:#d4d0c8;border:1px solid #808080;flex-shrink:0;line-height:1.4;';
    refreshBtn.addEventListener('click', () => renderAllTimelines());
    hdr.appendChild(hdrText);
    hdr.appendChild(refreshBtn);
    row.appendChild(hdr);

    const cols = document.createElement('div');
    cols.className = 'timeline-cols';

    // ── Left: fragment strip + audio bar + timing list ───────────────────────
    const leftCol = document.createElement('div');
    leftCol.className = 'timeline-col-left';

    // Fragment strip: excluded cells greyed and moved to end
    leftCol.appendChild(_buildFragStrip(session, sessionKey, { excludedSet }));

    // ── Video preview (filled after _ssState is init'd below) ────────────────
    const videoPreviewWrap = document.createElement('div');
    videoPreviewWrap.className = 'video-preview-wrap';
    videoPreviewWrap.innerHTML = '<div class="video-preview-placeholder">Предпросмотр появится после рендера</div>';
    leftCol.appendChild(videoPreviewWrap);

    // ── Biroly timeline bar (above audio bar) ────────────────────────────────
    if (totalDur > 0) {
      const bLbl = document.createElement('div');
      bLbl.style.cssText = 'font-size:8px;color:#888;margin-bottom:1px;';
      bLbl.textContent = 'Биролы:';

      const bBar = document.createElement('div');
      bBar.className = 'timeline-biroly-bar';
      bBar.dataset.sessionKey = sessionKey;
      bBar.dataset.totalDur   = String(totalDur);
      bBar.style.cssText = 'position:relative;height:26px;background:#111;border-radius:3px;overflow:hidden;margin-bottom:3px;';

      _fillBirolyBar(bBar, sessionKey, totalDur);
      leftCol.appendChild(bLbl);
      leftCol.appendChild(bBar);
    }

    if (activeSegments.length && totalDur > 0) {
      // Visual bar (active segments only, with recalculated positions)
      const bar = document.createElement('div');
      bar.style.cssText = 'position:relative;height:28px;background:#1a1a1a;border-radius:3px;overflow:hidden;margin-bottom:3px;';
      activeSegments.forEach(seg => {
        const el = document.createElement('div');
        el.style.cssText = `position:absolute;left:${(seg.activeStart/totalDur*100).toFixed(3)}%;width:${(seg.dur/totalDur*100).toFixed(3)}%;height:100%;background:${TL_COLORS[seg.idx%TL_COLORS.length]};border-right:1px solid rgba(0,0,0,0.4);box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden;`;
        el.title = `Фр.${seg.idx+1}: ${seg.activeStart.toFixed(2)}s–${seg.activeEnd.toFixed(2)}s (${seg.dur.toFixed(2)}s)\n${seg.cell.line||''}`;
        el.innerHTML = `<span style="font-size:8px;color:#fff;font-weight:bold;pointer-events:none;">${seg.idx+1}</span>`;
        bar.appendChild(el);
      });
      leftCol.appendChild(bar);

      // Ruler (active segments)
      const ruler = document.createElement('div');
      ruler.style.cssText = 'position:relative;height:12px;margin-bottom:4px;';
      activeSegments.forEach(seg => {
        const tick = document.createElement('span');
        tick.style.cssText = `position:absolute;left:${(seg.activeStart/totalDur*100).toFixed(3)}%;font-size:8px;color:#555;white-space:nowrap;transform:translateX(-50%);`;
        tick.textContent = seg.activeStart.toFixed(1)+'s';
        ruler.appendChild(tick);
      });
      const endTick = document.createElement('span');
      endTick.style.cssText = 'position:absolute;right:0;font-size:8px;color:#555;';
      endTick.textContent = totalDur.toFixed(1)+'s';
      ruler.appendChild(endTick);
      leftCol.appendChild(ruler);
    }

    // Fragment list — collapsed under a <details> dropdown
    if (allSegments.length) {
      const details = document.createElement('details');
      details.style.cssText = 'margin-top:4px;';
      const summary = document.createElement('summary');
      const exclCount = allSegments.filter(s => excludedSet.has(s.idx)).length;
      summary.style.cssText = 'font-size:12px;font-weight:700;color:#111;cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:5px;padding:3px 0;';
      summary.innerHTML = `<span style="font-size:10px;color:#444;">▶</span><span>Фрагменты (${allSegments.length - exclCount}/${allSegments.length})</span>`;
      details.addEventListener('toggle', () => {
        const arrow = summary.querySelector('span:first-child');
        if (arrow) arrow.textContent = details.open ? '▼' : '▶';
      });

      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:3px;';
      allSegments.forEach(seg => {
        const excluded = excludedSet.has(seg.idx);
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;gap:5px;' + (excluded ? 'opacity:0.5;' : '');
        const dot = document.createElement('span');
        dot.style.cssText = `flex-shrink:0;width:8px;height:8px;border-radius:2px;background:${excluded ? '#777' : TL_COLORS[seg.idx%TL_COLORS.length]};`;
        const timing = document.createElement('span');
        timing.style.cssText = 'flex-shrink:0;font-size:9px;color:#555;white-space:nowrap;min-width:82px;' + (excluded ? 'text-decoration:line-through;' : '');
        timing.textContent = `${seg.start.toFixed(2)}s–${seg.end.toFixed(2)}s (${seg.dur.toFixed(2)}s)`;
        const text = document.createElement('span');
        text.style.cssText = 'font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;' + (excluded ? 'text-decoration:line-through;color:#888;' : 'color:#333;');
        text.textContent = seg.cell.line || `Фр. ${seg.idx+1}`;
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = excluded ? '↺' : '×';
        toggleBtn.title = excluded ? 'Включить фрагмент' : 'Исключить фрагмент';
        toggleBtn.style.cssText = `flex-shrink:0;font-size:9px;padding:0 4px;cursor:pointer;line-height:1.4;border:1px solid ${excluded ? '#4a7a4a' : '#c05050'};background:${excluded ? '#2a3a2a' : '#3a2020'};color:${excluded ? '#8fc' : '#faa'};border-radius:2px;`;
        toggleBtn.addEventListener('click', () => {
          const d = getTimelineData();
          if (!d[sessionKey]) d[sessionKey] = {};
          const excl = new Set(d[sessionKey].excludedSegments || []);
          if (excluded) excl.delete(seg.idx); else excl.add(seg.idx);
          d[sessionKey].excludedSegments = [...excl];
          setTimelineData(d);
          renderAllTimelines();
        });
        r.appendChild(dot); r.appendChild(timing); r.appendChild(text); r.appendChild(toggleBtn);
        list.appendChild(r);
      });
      details.appendChild(summary);
      details.appendChild(list);
      leftCol.appendChild(details);

      // ── Subtitle generation row ──────────────────────────────────────────
      const sttRow = document.createElement('div');
      sttRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-top:5px;flex-wrap:wrap;';

      const sttBtn = document.createElement('button');
      sttBtn.textContent = '🎙 Субтитры';
      sttBtn.style.cssText = 'font-size:10px;font-weight:700;padding:3px 9px;cursor:pointer;border:1.5px solid #5a7a5a;background:#e8f0e8;color:#2a5a2a;border-radius:3px;white-space:nowrap;';

      const sttHelp = document.createElement('span');
      sttHelp.textContent = '?';
      sttHelp.title = 'Автоматическая расшифровка аудио каждого фрагмента через ElevenLabs Speech-to-Text (kie.ai).\n\nСоздаёт .srt файл субтитров с точными временными метками, синхронизированными с таймлайном видео.\n\nТребует: активный API ключ kie.ai в настройках.';
      sttHelp.style.cssText = 'font-size:9px;font-weight:700;color:#666;border:1px solid #aaa;border-radius:50%;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;cursor:help;flex-shrink:0;';

      const sttStatus = document.createElement('span');
      sttStatus.style.cssText = 'font-size:9px;color:#666;';

      const assBtn = document.createElement('button');
      assBtn.textContent = '{ }';
      assBtn.title = 'Настройка стиля субтитров (libass):\nшрифты, цвета, контур, анимации, позиция';
      assBtn.style.cssText = 'font-size:10px;font-weight:700;padding:2px 7px;cursor:pointer;border:1.5px solid #5a6a9a;background:#e8eaf8;color:#2a3a7a;border-radius:3px;white-space:nowrap;';
      assBtn.addEventListener('click', () => _openAssModal(sessionKey));

      sttRow.appendChild(sttBtn);
      sttRow.appendChild(sttHelp);
      sttRow.appendChild(assBtn);
      sttRow.appendChild(sttStatus);

      // Result row (hidden until done)
      const sttResultRow = document.createElement('div');
      sttResultRow.style.cssText = 'display:none;flex-direction:column;gap:4px;margin-top:4px;';

      const sttResultBtns = document.createElement('div');
      sttResultBtns.style.cssText = 'display:flex;gap:5px;align-items:center;';

      const sttDownBtn = document.createElement('a');
      sttDownBtn.textContent = '⬇ Скачать .srt';
      sttDownBtn.style.cssText = 'font-size:10px;font-weight:700;padding:3px 8px;border:1.5px solid #5a7a9a;background:#e8edf8;color:#2a4a7a;border-radius:3px;text-decoration:none;cursor:pointer;';

      const sttPreviewBtn = document.createElement('button');
      sttPreviewBtn.textContent = '👁 Просмотр';
      sttPreviewBtn.style.cssText = 'font-size:10px;font-weight:700;padding:3px 8px;border:1.5px solid #888;background:#f0f0f0;color:#333;border-radius:3px;cursor:pointer;';

      const sttPreviewBox = document.createElement('pre');
      sttPreviewBox.style.cssText = 'display:none;font-size:9px;font-family:monospace;color:#222;background:#f8f8f8;border:1px solid #ccc;border-radius:3px;padding:5px 7px;max-height:140px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;margin:0;';

      sttPreviewBtn.addEventListener('click', () => {
        const open = sttPreviewBox.style.display === 'none';
        sttPreviewBox.style.display = open ? 'block' : 'none';
        sttPreviewBtn.textContent = open ? '▲ Скрыть' : '👁 Просмотр';
      });

      sttResultBtns.appendChild(sttDownBtn);
      sttResultBtns.appendChild(sttPreviewBtn);
      sttResultRow.appendChild(sttResultBtns);
      sttResultRow.appendChild(sttPreviewBox);
      leftCol.appendChild(sttRow);
      leftCol.appendChild(sttResultRow);

      // STT generation handler
      sttBtn.addEventListener('click', async () => {
        const segsForStt = activeSegments.filter(s => s.cell.audioPath);
        if (!segsForStt.length) { sttStatus.textContent = '⚠ Нет аудио'; return; }
        sttBtn.disabled = true;
        sttStatus.textContent = 'Запрос…';
        sttResultRow.style.display = 'none';
        sttPreviewBox.style.display = 'none';
        sttPreviewBtn.textContent = '👁 Просмотр';

        try {
          const r = await fetch('/api/audio/stt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              segments: segsForStt.map(s => ({
                audioPath:  s.cell.audioPath,
                timeOffset: s.activeStart,
              })),
            }),
          });
          const rj = await r.json();
          if (!rj.success) throw new Error(rj.error || 'Ошибка запуска');
          const { jobId } = rj;

          // Poll
          const poll = setInterval(async () => {
            try {
              const sr = await fetch(`/api/audio/stt/status/${jobId}`);
              const sj = await sr.json();
              if (!sj.success) return;

              if (sj.state === 'done') {
                clearInterval(poll);
                sttBtn.disabled = false;
                sttStatus.textContent = '✓ Готово';

                // Download link
                sttDownBtn.href = sj.srtPath;
                sttDownBtn.download = `subtitles_${scenName}.srt`;

                // Preview
                sttPreviewBox.textContent = sj.srtContent || '';
                sttResultRow.style.display = 'flex';

                // Store parsed subtitles in session for render
                const parsedSubs = _parseSrt(sj.srtContent || '');
                const _d = getTimelineData();
                if (!_d[sessionKey]) _d[sessionKey] = {};
                _d[sessionKey].srtSubtitles = parsedSubs;
                setTimelineData(_d);

              } else if (sj.state === 'failed') {
                clearInterval(poll);
                sttBtn.disabled = false;
                sttStatus.textContent = '⚠ ' + (sj.error || 'Ошибка').slice(0, 60);
              } else {
                const prog = sj.progress ? ` (${sj.progress})` : '…';
                sttStatus.textContent = `Обработка${prog}`;
              }
            } catch {}
          }, 3000);

        } catch (e) {
          sttBtn.disabled = false;
          sttStatus.textContent = '⚠ ' + e.message.slice(0, 60);
        }
      });
    }

    // ── Right: biroly timings + action buttons ─────────────────────────────
    const rightArea = document.createElement('div');
    rightArea.className = 'timeline-col-right-area';

    const rightCol = document.createElement('div');
    rightCol.className = 'timeline-col-right';
    rightCol.dataset.sessionKey = sessionKey;
    renderSessionBirolys(rightCol, sessionKey);
    rightArea.appendChild(rightCol);
    // ssCol (action buttons) will be appended to rightArea after construction below

    cols.appendChild(leftCol);
    cols.appendChild(rightArea);
    row.appendChild(cols);

    // ── Separator + per-project controls ────────────────────────────────────
    const hr = document.createElement('hr');
    hr.style.cssText = 'border:none;border-top:1px solid #a0a0a0;margin:6px 0 5px;';
    row.appendChild(hr);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:0 4px 6px;font-size:10px;color:#444;';

    const makeSelect = (label, options, key) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'white-space:nowrap;font-size:10px;color:#555;min-width:68px;';
      lbl.textContent = label + ':';
      const sel = document.createElement('select');
      sel.style.cssText = 'font-size:10px;padding:1px 3px;flex:1;max-width:120px;';
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        sel.appendChild(o);
      });
      const savedVal = (tlData[sessionKey] || {})[key];
      if (savedVal && options.includes(savedVal)) sel.value = savedVal;
      sel.addEventListener('change', () => {
        const d = getTimelineData();
        if (!d[sessionKey]) d[sessionKey] = {};
        d[sessionKey][key] = sel.value;
        setTimelineData(d);
      });
      wrap.appendChild(lbl); wrap.appendChild(sel);
      return wrap;
    };

    // ── FFmpeg transition options ──────────────────────────────────────────────
    // Paired transitions: applied at start AND end of each clip
    const SEG_TRANS_OPTS = [
      { v:'none',       l:'Нет' },
      { v:'fade',       l:'Fade (чёрный)' },
      { v:'fadewhite',  l:'Fade (белый)' },
      { v:'fadegrays',  l:'Fade (серый)' },
      { v:'blur',       l:'Blur In/Out' },
    ];
    const BIRO_TRANS_OPTS = [
      { v:'none',       l:'Нет' },
      { v:'fade',       l:'Fade (чёрный)' },
      { v:'fadewhite',  l:'Fade (белый)' },
      { v:'fadegrays',  l:'Fade (серый)' },
      { v:'blur',       l:'Blur In/Out' },
    ];
    const ANIM_OPTS = [
      { v:'none',     l:'Нет' },
      { v:'zoom_in',  l:'Zoom In (slow)' },
      { v:'zoom_out', l:'Zoom Out (slow)' },
      { v:'vignette', l:'Vignette' },
      { v:'sharpen',  l:'Sharpen' },
      { v:'warm',     l:'Warm тон' },
      { v:'cool',     l:'Cool тон' },
    ];

    const _makeVolumeRow = (label, tlKey, defaultVal) => {
      const row = document.createElement('div');
      row.className = 'ss-param-row';
      const lbl = document.createElement('span');
      lbl.className = 'ss-param-lbl'; lbl.textContent = label;
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '2'; slider.step = '0.05';
      slider.className = 'ss-vol-slider';
      const saved = sessData[tlKey];
      slider.value = (saved != null && !isNaN(saved)) ? saved : defaultVal;
      slider.addEventListener('input', () => {
        const d = getTimelineData(); if (!d[sessionKey]) d[sessionKey] = {};
        d[sessionKey][tlKey] = parseFloat(slider.value); setTimelineData(d);
      });
      row.appendChild(lbl); row.appendChild(slider);
      return row;
    };

    const _makeSettingRow = (label, opts, tlKey, defaultVal) => {
      const row = document.createElement('div');
      row.className = 'ss-param-row';
      const lbl = document.createElement('span');
      lbl.className = 'ss-param-lbl'; lbl.textContent = label;
      const sel = document.createElement('select');
      sel.className = 'ss-param-sel';
      opts.forEach(o => {
        const opt = document.createElement('option'); opt.value = o.v; opt.textContent = o.l; sel.appendChild(opt);
      });
      const saved = (sessData)[tlKey];
      sel.value = (saved && opts.find(o => o.v === saved)) ? saved : (defaultVal || opts[0].v);
      sel.addEventListener('change', () => {
        const d = getTimelineData(); if (!d[sessionKey]) d[sessionKey] = {};
        d[sessionKey][tlKey] = sel.value; setTimelineData(d);
      });
      row.appendChild(lbl); row.appendChild(sel);
      return row;
    };

    // ── Two-column settings panel ──────────────────────────────────────────────
    const settingsPanel = document.createElement('div');
    settingsPanel.className = 'ss-settings-panel';

    const segCol = document.createElement('div');
    segCol.className = 'ss-settings-col';
    const segHdr = document.createElement('div');
    segHdr.className = 'ss-settings-col-hdr'; segHdr.textContent = '🎬 Говорящая голова';
    segCol.appendChild(segHdr);
    segCol.appendChild(_makeVolumeRow('Громкость', 'segVolume', 1.0));
    segCol.appendChild(_makeSettingRow('Переход',  SEG_TRANS_OPTS, 'segTransition', 'fade'));
    segCol.appendChild(_makeSettingRow('Анимация', ANIM_OPTS,      'segAnimation',  'none'));
    const segSfxCtrl = makeSfxControl(sessionKey, tlData, 'segSfx');
    segCol.appendChild(segSfxCtrl.el);
    segCol.appendChild(_makeVolumeRow('Громк. вжухи', 'segSfxVolume', 0.8));

    const biroCol = document.createElement('div');
    biroCol.className = 'ss-settings-col';
    const biroHdr = document.createElement('div');
    biroHdr.className = 'ss-settings-col-hdr'; biroHdr.textContent = '🎭 Биролы';
    biroCol.appendChild(biroHdr);
    biroCol.appendChild(_makeSettingRow('Переход',  BIRO_TRANS_OPTS, 'biroTransition', 'fade'));
    biroCol.appendChild(_makeSettingRow('Анимация', ANIM_OPTS,       'biroAnimation',  'none'));
    const biroSfxCtrl = makeSfxControl(sessionKey, tlData, 'biroSfx');
    biroCol.appendChild(biroSfxCtrl.el);
    biroCol.appendChild(_makeVolumeRow('Громк. вжухи', 'biroSfxVolume', 0.8));

    settingsPanel.appendChild(segCol);
    settingsPanel.appendChild(biroCol);
    controls.appendChild(settingsPanel);

    // ── Music section (full width) ─────────────────────────────────────────────
    const getVideoDur = () => activeSegments.reduce((m, s) => Math.max(m, s.activeEnd || 0), 30);
    const musicCtrl = makeMusicControl(sessionKey, tlData, getVideoDur);

    const audioSection = document.createElement('details');
    audioSection.className = 'audio-section-details';
    const audioSummary = document.createElement('summary');
    audioSummary.className = 'audio-section-summary';
    audioSummary.textContent = '🎵 Музычка';
    const musicVolSlider = document.createElement('input');
    musicVolSlider.type = 'range'; musicVolSlider.min = '0'; musicVolSlider.max = '2'; musicVolSlider.step = '0.05';
    musicVolSlider.className = 'ss-vol-slider ss-vol-slider-music';
    const savedMV = sessData.musicVolume;
    musicVolSlider.value = (savedMV != null && !isNaN(savedMV)) ? savedMV : 0.5;
    musicVolSlider.addEventListener('click', e => e.stopPropagation()); // prevent toggle
    musicVolSlider.addEventListener('input', () => {
      const d = getTimelineData(); if (!d[sessionKey]) d[sessionKey] = {};
      d[sessionKey].musicVolume = parseFloat(musicVolSlider.value); setTimelineData(d);
    });
    audioSummary.appendChild(musicVolSlider);
    audioSection.appendChild(audioSummary);
    audioSection.appendChild(musicCtrl.el);
    controls.appendChild(audioSection);
    // ── Action column ──────────────────────────────────────────────────────────
    const ssCol = document.createElement('div');
    ssCol.className = 'ss-action-col';

    const statusEl = document.createElement('div');
    statusEl.className = 'ss-status';

    const btnMerge = document.createElement('button');
    btnMerge.className = 'ss-btn ss-btn-merge';
    btnMerge.textContent = '▶ Мердж';
    btnMerge.title = 'Рендер через FFmpeg локально';

    const btnMergeJson = document.createElement('button');
    btnMergeJson.className = 'ss-btn-json';
    btnMergeJson.textContent = '{ }';
    btnMergeJson.title = 'Настройки FFmpeg (разрешение, качество, цвет, субтитры)';

    const btnSave = document.createElement('button');
    btnSave.className = 'ss-btn ss-btn-save';
    btnSave.textContent = '💾 Сохранить';
    btnSave.title = 'Сохранить видео в архив';
    btnSave.disabled = true;

    // Per-session state (renderUrl persisted to localStorage)
    const _SS_KEY = `ss_state_${sessionKey}`;
    const _ssStateStored = (() => { try { return JSON.parse(localStorage.getItem(_SS_KEY) || '{}'); } catch { return {}; } })();
    let _ssState = { renderUrl: _ssStateStored.renderUrl || null };

    function _updateVideoPreview(url) {
      videoPreviewWrap.innerHTML = '';
      if (url) {
        const vid = document.createElement('video');
        vid.src = url; vid.controls = true; vid.preload = 'metadata';
        vid.style.cssText = 'width:100%;max-height:220px;border-radius:3px;background:#000;display:block;';
        videoPreviewWrap.appendChild(vid);
      } else {
        videoPreviewWrap.innerHTML = '<div class="video-preview-placeholder">Предпросмотр появится после рендера</div>';
      }
    }
    if (_ssState.renderUrl) { _updateVideoPreview(_ssState.renderUrl); btnSave.disabled = false; }

    function _setStatus(msg, cls = '') {
      statusEl.textContent = msg;
      statusEl.className = 'ss-status' + (cls ? ' ' + cls : '');
    }

    // ── СОХРАНИТЬ ─────────────────────────────────────────────────────────────
    btnSave.addEventListener('click', async () => {
      if (!_ssState.renderUrl) { _setStatus('Нет URL видео', 'err'); return; }
      btnSave.disabled = true;
      _setStatus('Сохраняем…', 'spin');

      try {
        const archive = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
        const tlData  = getTimelineData();
        const sd      = tlData[sessionKey] || {};
        const projectData = { sessionKey, timelineData: sd, archive };

        const r = await fetch('/api/finals/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            renderUrl:   _ssState.renderUrl,
            sessionLabel: session?.file || sessionKey,
            projectData,
          }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Ошибка');
        _setStatus('Сохранено!', 'ok');
        // Open finals archive if user wants to view
        window.loadFinals?.();
      } catch (e) {
        _setStatus(e.message, 'err');
        btnSave.disabled = false;
      }
    });

    // ── JSON VIEWER (modal elements) ─────────────────────────────────────────
    const _rbOverlay  = document.getElementById('rb-modal-overlay');
    const _rbTa       = document.getElementById('rb-modal-ta');
    const _rbErr      = document.getElementById('rb-modal-err');
    const _rbSaveBtn  = document.getElementById('rb-modal-save');
    const _rbCloseBtn = document.getElementById('rb-modal-close');

    function _closeRbModal() { _rbOverlay.classList.remove('open'); }
    _rbCloseBtn.addEventListener('click', _closeRbModal);
    _rbOverlay.addEventListener('click', e => { if (e.target === _rbOverlay) _closeRbModal(); });

    // Ctrl+S inside textarea — save; Escape — close
    _rbTa.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); _rbSaveBtn.click(); }
      if (e.key === 'Escape') _closeRbModal();
    });

    _rbSaveBtn.addEventListener('click', async () => {
      try {
        const parsed = JSON.parse(_rbTa.value);
        const jid = _rbSaveBtn._ffmpegJobId;
        if (jid) {
          const r = await fetch(`/api/ffmpeg/body/${jid}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed),
          });
          const d = await r.json();
          if (!d.success) throw new Error(d.error || 'Ошибка сохранения');
        }
        _rbErr.style.color = '#9fe09f';
        _rbErr.textContent = '✓ Сохранено';
        setTimeout(() => { _rbErr.textContent = ''; _rbErr.style.color = ''; }, 2000);
      } catch (e) {
        _rbErr.style.color = '#e07070';
        _rbErr.textContent = '⚠ Ошибка: ' + e.message;
      }
    });

    // ── МЕРДЖ (FFmpeg локально) ───────────────────────────────────────────────
    btnMerge.addEventListener('click', async () => {
      const archive   = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
      const tlDataNow = getTimelineData();
      const sd        = tlDataNow[sessionKey] || {};
      const activated = sd.activated || [];
      const timings   = sd.timings   || {};

      const localClips = activated.map(idx => {
        const b = archive[idx]; const t = timings[idx];
        if (!b || !b.videoPath || !t || t.start === undefined) return null;
        return { videoPath: b.videoPath, name: b.name || 'Бирол',
                 start: parseFloat(t.start)||0, end: parseFloat(t.end)||6, crop: parseFloat(t.crop)||0 };
      }).filter(Boolean).sort((a, b) => a.start - b.start);

      const localSegClips = activeSegments.filter(s => s.cell.videoPath).map(s => ({
        name: s.cell.line || `Фр.${s.idx+1}`, videoPath: s.cell.videoPath,
        start: s.activeStart, end: s.activeEnd, crop: 0,
      }));

      if (!localSegClips.length) { _setStatus('Нет видео сегментов', 'err'); return; }

      btnMerge.disabled = true;
      btnSave.disabled = true;
      _setStatus('Рендерим…', 'spin');

      try {
        const advSettings   = { ...ADV_DEFAULTS, ...(sd.advSettings || {}) };
        const assSettings   = { ...ASS_DEFAULTS, ...(sd.assSettings || {}) };
        const subtitles     = advSettings.subsEnabled
          ? localSegClips.map(s => ({ text: s.name, start: s.start, end: s.end }))
          : [];
        const srtSubtitles  = sd.srtSubtitles || [];

        const r = await fetch('/api/ffmpeg/render', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segmentClips:   localSegClips,
            clips:          localClips,
            music:          musicCtrl.getUrl(),
            musicOffset:    musicCtrl.getOffset(),
            musicVolume:    sd.musicVolume   != null ? sd.musicVolume   : 0.5,
            segVolume:      sd.segVolume     != null ? sd.segVolume     : 1.0,
            segTransition:  sd.segTransition  || 'fade',
            segAnimation:   sd.segAnimation   || 'none',
            segSfx:         segSfxCtrl.getUrl(),
            segSfxVolume:   sd.segSfxVolume  != null ? sd.segSfxVolume  : 0.8,
            biroTransition: sd.biroTransition || 'fade',
            biroAnimation:  sd.biroAnimation  || 'none',
            biroSfx:        biroSfxCtrl.getUrl(),
            biroSfxVolume:  sd.biroSfxVolume != null ? sd.biroSfxVolume : 0.8,
            outputLabel:    scenName,
            advSettings,
            subtitles,
            srtSubtitles,
            assSettings,
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} — перезапусти сервер`);
        const rj = await r.json();
        if (!rj.success) throw new Error(rj.error || 'Ошибка запуска');

        const { jobId } = rj;
        btnMergeJson._jobId = jobId;
        btnMergeJson.disabled = false;

        const poll = setInterval(async () => {
          try {
            const sr = await fetch(`/api/ffmpeg/status/${jobId}`);
            const sj = await sr.json();
            if (!sj.success) return;
            if (sj.status === 'done') {
              clearInterval(poll);
              _ssState.renderUrl = sj.url;
              try { const st2 = JSON.parse(localStorage.getItem(_SS_KEY)||'{}'); localStorage.setItem(_SS_KEY, JSON.stringify({...st2, renderUrl: sj.url})); } catch {}
              _updateVideoPreview(sj.url);
              btnSave.disabled = false;
              btnMerge.disabled = false;
              _setStatus('Готово!', 'ok');
            } else if (sj.status === 'failed') {
              clearInterval(poll);
              btnMerge.disabled = false;
              _setStatus((sj.error || 'Ошибка рендера').slice(0, 120), 'err');
            } else {
              const prog = sj.progressSecs > 0 ? ` (${sj.progressSecs.toFixed(0)}с)` : '';
              _setStatus(`Рендерим…${prog}`, 'spin');
            }
          } catch {}
        }, 2000);
      } catch (e) {
        btnMerge.disabled = false;
        _setStatus(e.message.slice(0, 120), 'err');
      }
    });

    // ── НАСТРОЙКИ FFmpeg ──────────────────────────────────────────────────────
    btnMergeJson.addEventListener('click', () => _openAdvModal(sessionKey));

    const mergeRow = document.createElement('div');
    mergeRow.className = 'ss-merge-row';
    mergeRow.appendChild(btnMerge);
    mergeRow.appendChild(btnMergeJson);

    ssCol.appendChild(mergeRow);
    ssCol.appendChild(btnSave);
    ssCol.appendChild(statusEl);

    // Action buttons go to the bottom of the right (biroly) area
    rightArea.appendChild(ssCol);

    row.appendChild(controls);
    wrap.appendChild(row);
  }
}
window.renderAllTimelines = renderAllTimelines;

// Fast sync update — re-renders only the Биролы right columns already in the DOM.
// Called by toggleActiveBiroly so birolys appear instantly without waiting for async render.
function refreshTimelineBirolys() {
  document.querySelectorAll('.timeline-col-right[data-session-key]').forEach(col => {
    renderSessionBirolys(col, col.dataset.sessionKey);
  });
}
window.refreshTimelineBirolys = refreshTimelineBirolys;

function updateActiveScenariosList() {
  const panel = document.getElementById('active-scenarios-panel');
  if (!panel) return;

  // Find scenario filenames that have at least one non-empty assignment
  const activeFiles = scenarioFiles.filter(f =>
    Object.entries(scenarioAssignments).some(
      ([key, val]) => key.startsWith(f.file + '__') && val
    )
  );

  panel.innerHTML = '';
  if (!activeFiles.length) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  const header = document.createElement('div');
  header.className = 'active-scen-header';
  header.textContent = 'Активные сценарии';
  panel.appendChild(header);

  activeFiles.forEach(f => {
    const row = document.createElement('div');
    row.className = 'active-scen-item';

    const name = document.createElement('span');
    name.className = 'active-scen-name';
    name.textContent = f.name;

    // Count assigned lines
    const count = Object.entries(scenarioAssignments).filter(
      ([key, val]) => key.startsWith(f.file + '__') && val
    ).length;
    const badge = document.createElement('span');
    badge.className = 'active-scen-badge';
    badge.textContent = count;

    row.appendChild(name);
    row.appendChild(badge);
    panel.appendChild(row);
  });

  renderEditPanel();
}

async function loadScenarioAssignments() {
  try {
    const d = await fetch('/api/scenarios/assignments').then(r => r.json());
    if (d.success) scenarioAssignments = d.assignments;
  } catch {}
}

async function saveScenarioAssignments() {
  await fetch('/api/scenarios/assignments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments: scenarioAssignments }),
  });
}

// ── Per-scenario modified lines storage (localStorage) ───────────────────────
function getModifiedLines(filename) {
  try {
    const raw = localStorage.getItem('scen_lines_v1__' + filename);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveModifiedLines(filename, lines) {
  localStorage.setItem('scen_lines_v1__' + filename, JSON.stringify(lines));
}
function clearModifiedLines(filename) {
  localStorage.removeItem('scen_lines_v1__' + filename);
}

// Re-index assignments after a line deletion so keys stay correct
function reindexAssignments(filename, deletedIdx, totalBefore) {
  delete scenarioAssignments[`${filename}__${deletedIdx}`];
  for (let j = deletedIdx + 1; j < totalBefore; j++) {
    const oldKey = `${filename}__${j}`;
    const newKey = `${filename}__${j - 1}`;
    if (scenarioAssignments[oldKey] != null) {
      scenarioAssignments[newKey] = scenarioAssignments[oldKey];
    } else {
      delete scenarioAssignments[newKey];
    }
    delete scenarioAssignments[oldKey];
  }
}

// ── Build scenario item ───────────────────────────────────────────────────────
function buildScenarioItem(file, detailFiles) {
  const item = document.createElement('div');
  item.className = 'scenario-item';

  const header = document.createElement('div');
  header.className = 'scenario-item-header';

  // Delete scenario button (two-click confirmation — no browser dialog)
  const delBtn = document.createElement('button');
  delBtn.className = 'scenario-del-btn'; delBtn.textContent = '🗑'; delBtn.title = 'Удалить сценарий';
  let delConfirmTimer = null;
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    // First click: arm confirmation
    if (!delBtn.dataset.armed) {
      delBtn.dataset.armed = '1';
      delBtn.textContent = '✓';
      delBtn.title = 'Нажмите ещё раз для подтверждения';
      delBtn.style.background = '#ffcccc';
      delConfirmTimer = setTimeout(() => {
        delBtn.dataset.armed = '';
        delBtn.textContent = '🗑';
        delBtn.title = 'Удалить сценарий';
        delBtn.style.background = '';
      }, 3000);
      return;
    }
    // Second click within 3 s: execute
    clearTimeout(delConfirmTimer);
    delBtn.dataset.armed = '';
    delBtn.textContent = '🗑';
    delBtn.style.background = '';
    delBtn.disabled = true;
    try {
      const r = await fetch('/api/scenarios/delete', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.file }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      clearModifiedLines(file.file);
      scenarioFiles = scenarioFiles.filter(f => f.file !== file.file);
      Object.keys(scenarioAssignments).forEach(k => {
        if (k.startsWith(file.file + '__')) delete scenarioAssignments[k];
      });
      updateActiveScenariosList();
      item.remove();
      setStatus(`Сценарий перемещён в базу данных: ${file.name}`);
    } catch (err) {
      delBtn.disabled = false;
      setStatus('Ошибка: ' + err.message);
    }
  });

  // Restore default lines button
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'scenario-del-btn';
  restoreBtn.textContent = '↺'; restoreBtn.title = 'Восстановить строки по умолчанию';
  restoreBtn.style.color = '#006600';
  restoreBtn.addEventListener('click', async e => {
    e.stopPropagation();
    clearModifiedLines(file.file);
    // Clear all assignments for this scenario
    Object.keys(scenarioAssignments).forEach(key => {
      if (key.startsWith(file.file + '__')) delete scenarioAssignments[key];
    });
    // Immediately reset any currently visible dropdowns in DOM
    body.querySelectorAll('.scenario-detail-select').forEach(s => { s.value = ''; });
    await saveScenarioAssignments();
    updateActiveScenariosList();
    await renderBody();
    setStatus('Строки и назначения восстановлены.');
  });

  const toggle = document.createElement('span');
  toggle.className = 'scenario-toggle'; toggle.textContent = '▶';

  const title = document.createElement('span');
  title.className = 'scenario-title'; title.textContent = file.name;

  header.appendChild(delBtn); header.appendChild(restoreBtn);
  header.appendChild(toggle); header.appendChild(title);

  const body = document.createElement('div');
  body.className = 'scenario-body';

  // ── Render body from a lines array ──────────────────────────────────────────
  async function renderBody() {
    body.innerHTML = '<span style="font-size:11px;color:#888;">Загрузка…</span>';
    try {
      // Use modified lines from localStorage if available, else fetch from API
      let lines = getModifiedLines(file.file);
      if (!lines) {
        const d = await fetch(`/api/scenarios/${encodeURIComponent(file.file)}`).then(r => r.json());
        lines = d.lines;
      }
      scenarioLinesCache[file.file] = lines; // keep cache fresh
      body.innerHTML = '';

      // Save assignments button
      const saveRow = document.createElement('div');
      saveRow.style.cssText = 'margin-bottom:6px;display:flex;gap:6px;';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = '💾 Сохранить назначения'; saveBtn.style.fontSize = '11px';
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        await saveScenarioAssignments();
        setStatus('Назначения сохранены.');
        saveBtn.disabled = false;
      });
      saveRow.appendChild(saveBtn);
      body.appendChild(saveRow);

      // Render each line
      lines.forEach((line, i) => {
        const row = document.createElement('div');
        row.className = 'scenario-line';

        const num = document.createElement('span');
        num.className = 'scenario-line-num'; num.textContent = i + 1;

        const text = document.createElement('input');
        text.type = 'text';
        text.className = 'scenario-line-text';
        text.value = line;
        text.title = 'Нажмите для редактирования';
        text.addEventListener('change', () => {
          lines[i] = text.value;
          saveModifiedLines(file.file, lines);
          scenarioLinesCache[file.file] = [...lines];
        });

        const sel = document.createElement('select');
        sel.className = 'scenario-detail-select';
        const blank = document.createElement('option');
        blank.value = ''; blank.textContent = '— предмет —';
        sel.appendChild(blank);
        detailFiles.forEach(df => {
          const opt = document.createElement('option');
          opt.value = df.file; opt.textContent = df.name;
          sel.appendChild(opt);
        });
        const key = `${file.file}__${i}`;
        if (scenarioAssignments[key]) sel.value = scenarioAssignments[key];
        sel.addEventListener('change', () => {
          scenarioAssignments[key] = sel.value;
          updateActiveScenariosList();
        });

        // Delete line button
        const lineDelBtn = document.createElement('button');
        lineDelBtn.className = 'scenario-line-del';
        lineDelBtn.textContent = '✕'; lineDelBtn.title = 'Удалить строку';
        lineDelBtn.addEventListener('click', () => {
          reindexAssignments(file.file, i, lines.length);
          lines.splice(i, 1);
          saveModifiedLines(file.file, lines);
          renderBody();
        });

        row.appendChild(num); row.appendChild(text); row.appendChild(sel); row.appendChild(lineDelBtn);
        body.appendChild(row);
      });
    } catch { body.textContent = 'Ошибка загрузки'; }
  }

  header.addEventListener('click', async () => {
    const open = body.classList.toggle('open');
    toggle.textContent = open ? '▼' : '▶';
    if (open) await renderBody();
  });

  item.appendChild(header); item.appendChild(body);
  return item;
}

// ── Archive (База данных) ─────────────────────────────────────────────────────
async function loadArchivedScenarios() {
  const list = document.getElementById('scenario-archive-list');
  if (!list) return;
  list.innerHTML = '<span style="color:#888;font-size:11px;">Загрузка…</span>';
  try {
    const d = await fetch('/api/scenarios/archive').then(r => r.json());
    list.innerHTML = '';
    if (!d.files.length) {
      list.innerHTML = '<div style="color:#888;font-size:11px;padding:8px 0;">Архив пуст</div>';
      return;
    }
    d.files.forEach(f => {
      const row = document.createElement('div');
      row.className = 'scen-archive-item';

      const name = document.createElement('span');
      name.className = 'scen-archive-name';
      name.textContent = f.name;

      const date = document.createElement('span');
      date.className = 'scen-archive-date';
      date.textContent = new Date(f.mtime).toLocaleDateString('ru-RU');

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'scen-archive-btn restore';
      restoreBtn.textContent = '↩ Восстановить';
      restoreBtn.addEventListener('click', async () => {
        restoreBtn.disabled = true;
        try {
          const r = await fetch('/api/scenarios/restore', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: f.file }),
          });
          const res = await r.json();
          if (!res.success) throw new Error(res.error);
          row.remove();
          setStatus(`Сценарий восстановлен: ${f.name}`);
          loadScenarios(); // refresh active list
        } catch (err) {
          setStatus('Ошибка: ' + err.message);
          restoreBtn.disabled = false;
        }
      });

      const purgeBtn = document.createElement('button');
      purgeBtn.className = 'scen-archive-btn purge';
      purgeBtn.textContent = '🗑';
      let purgeTimer = null;
      purgeBtn.addEventListener('click', async () => {
        if (!purgeBtn.dataset.armed) {
          purgeBtn.dataset.armed = '1';
          purgeBtn.textContent = '✓?';
          purgeBtn.style.background = '#ffcccc';
          purgeTimer = setTimeout(() => {
            purgeBtn.dataset.armed = '';
            purgeBtn.textContent = '🗑';
            purgeBtn.style.background = '';
          }, 3000);
          return;
        }
        clearTimeout(purgeTimer);
        purgeBtn.dataset.armed = '';
        purgeBtn.textContent = '🗑';
        purgeBtn.style.background = '';
        purgeBtn.disabled = true;
        try {
          const r = await fetch('/api/scenarios/archive/purge', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: f.file }),
          });
          const res = await r.json();
          if (!res.success) throw new Error(res.error);
          row.remove();
          if (!list.querySelector('.scen-archive-item')) {
            list.innerHTML = '<div style="color:#888;font-size:11px;padding:8px 0;">Архив пуст</div>';
          }
          setStatus(`Удалено навсегда: ${f.name}`);
        } catch (err) {
          setStatus('Ошибка: ' + err.message);
          purgeBtn.disabled = false;
        }
      });

      row.appendChild(name);
      row.appendChild(date);
      row.appendChild(restoreBtn);
      row.appendChild(purgeBtn);
      list.appendChild(row);
    });
  } catch {
    list.innerHTML = '<div style="color:#888;font-size:11px;">Ошибка загрузки</div>';
  }
}

// ── Load scenarios ────────────────────────────────────────────────────────────
const scenarioList = document.getElementById('scenario-list');

async function loadScenarios() {
  if (!scenarioList) return;
  try {
    const [sd, dd] = await Promise.all([
      fetch('/api/scenarios').then(r => r.json()),
      fetch('/api/details').then(r => r.json()),
    ]);
    await loadScenarioAssignments();
    scenarioFiles     = sd.files || [];
    cachedDetailFiles = dd.success ? dd.files : [];
    scenarioList.innerHTML = '';
    if (!sd.files.length) {
      scenarioList.innerHTML = '<div style="color:#888;font-size:11px;">Нет сценариев</div>';
      updateActiveScenariosList();
      return;
    }
    sd.files.forEach(f => scenarioList.appendChild(buildScenarioItem(f, cachedDetailFiles)));
    updateActiveScenariosList();
    updateAutofillPanel();
  } catch { scenarioList.innerHTML = '<div style="color:#888;font-size:11px;">Ошибка загрузки</div>'; }
  // Also refresh the образы panel whenever scenarios reload
  loadScenarioObrazы();
}

// ── Образы catalog in Сценарии right column ───────────────────────────────────
// Hidden set: образы the user removed from this view (persisted in localStorage)
const SCEN_HIDDEN_KEY = 'scen_hidden_obrazy_v1';

function getHiddenObrazы() {
  try { return new Set(JSON.parse(localStorage.getItem(SCEN_HIDDEN_KEY) || '[]')); } catch { return new Set(); }
}
function hideObraz(id) {
  const s = getHiddenObrazы(); s.add(String(id));
  localStorage.setItem(SCEN_HIDDEN_KEY, JSON.stringify([...s]));
}

function loadScenarioObrazы() {
  const row = document.getElementById('scenarii-obrazy-row');
  if (!row) return;

  const hidden     = getHiddenObrazы();
  const allObrazы  = getObrazы?.() || [];
  const curProjId  = getCurrentProjectId?.() || null;

  // Filter out hidden; sort: current-project ones first, then rest by date desc
  const visible = allObrazы.filter(o => !hidden.has(String(o.id)));
  if (!visible.length) {
    row.innerHTML = '<span style="color:#888;font-size:11px;">Нет образов</span>';
    return;
  }

  const projOnes  = visible.filter(o => o.projectId === curProjId && curProjId);
  const otherOnes = visible.filter(o => o.projectId !== curProjId || !curProjId);
  const sorted    = [...projOnes, ...otherOnes];

  row.innerHTML = '';
  sorted.forEach(obraz => {
    if (!obraz.char) return; // skip obrazы without a character image

    // Pending if variations array has nulls (generation still in progress)
    const hasPending = Array.isArray(obraz.variations) && obraz.variations.length > 0
      && obraz.variations.some(v => v === null);

    const wrap = document.createElement('div');
    wrap.className = 'scen-obraz-wrap';
    if (hasPending) wrap.style.opacity = '0.5';

    const img = document.createElement('img');
    img.src = obraz.char + '?t=' + Date.now();
    img.className = 'scen-obraz-thumb' + (obraz.projectId === curProjId && curProjId ? ' proj-obraz' : '');

    if (hasPending) {
      img.style.cursor = 'not-allowed';
      img.title = obraz.name + ' · генерация вариаций…';
    } else {
      img.title = obraz.name + ' · клик — выбрать / снять выбор';
      img.addEventListener('click', () => setActiveObraz(obraz.id, wrap));
    }

    // Restore active state if this образ was previously selected
    if (activeObrazIds.has(obraz.id)) wrap.classList.add('obraz-active');

    const name = document.createElement('div');
    name.className = 'scen-obraz-name';
    name.textContent = hasPending ? '⏳ ' + obraz.name : obraz.name;

    const delBtn = document.createElement('button');
    delBtn.className = 'scen-obraz-del';
    delBtn.textContent = '✕';
    delBtn.title = 'Убрать из проекта';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      hideObraz(obraz.id);
      wrap.remove();
      if (!row.querySelector('.scen-obraz-wrap')) {
        row.innerHTML = '<span style="color:#888;font-size:11px;">Нет образов</span>';
      }
    });

    wrap.appendChild(img);
    wrap.appendChild(name);
    wrap.appendChild(delBtn);
    row.appendChild(wrap);
  });
}

// ── Upload scenario file ──────────────────────────────────────────────────────
const scenarioDropzone  = document.getElementById('scenario-dropzone');
const scenarioInput     = document.getElementById('scenario-input');
const scenarioFileLabel = document.getElementById('scenario-file-label');
const scenarioNameInput = document.getElementById('scenario-name');
const btnScenarioUpload = document.getElementById('btn-scenario-upload');
let scenarioBlob = null;

scenarioDropzone?.addEventListener('click', () => scenarioInput?.click());
scenarioDropzone?.addEventListener('dragover', e => { e.preventDefault(); scenarioDropzone.classList.add('drag-over'); });
scenarioDropzone?.addEventListener('dragleave', () => scenarioDropzone.classList.remove('drag-over'));
scenarioDropzone?.addEventListener('drop', e => {
  e.preventDefault(); scenarioDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (!f || !f.name.endsWith('.txt')) { setStatus('Только .txt файлы.'); return; }
  scenarioBlob = f; scenarioFileLabel.textContent = f.name;
  scenarioDropzone.classList.add('has-file'); btnScenarioUpload.disabled = false;
});
scenarioInput?.addEventListener('change', () => {
  const f = scenarioInput.files[0]; if (!f) return;
  scenarioBlob = f; scenarioFileLabel.textContent = f.name;
  scenarioDropzone.classList.add('has-file'); btnScenarioUpload.disabled = false;
});

btnScenarioUpload?.addEventListener('click', async () => {
  if (!scenarioBlob) return;
  btnScenarioUpload.disabled = true; setStatus('Загружаю сценарий…');
  try {
    const base64 = await blobToBase64(scenarioBlob);
    const r = await fetch('/api/scenarios/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBase64: base64, name: scenarioNameInput.value.trim() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Сценарий сохранён: ${d.name}`);
    scenarioBlob = null;
    scenarioFileLabel.textContent = 'Нажмите или перетащите .txt файл';
    scenarioDropzone.classList.remove('has-file');
    scenarioNameInput.value = ''; scenarioInput.value = '';
    loadScenarios();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnScenarioUpload.disabled = false; }
});

// ── Manual text input ─────────────────────────────────────────────────────────
document.getElementById('btn-scenario-manual-upload')?.addEventListener('click', async () => {
  const text = document.getElementById('scenario-manual-text')?.value.trim();
  if (!text) { setStatus('Введите текст сценария.'); return; }
  const btn = document.getElementById('btn-scenario-manual-upload');
  btn.disabled = true; setStatus('Сохраняю сценарий…');
  try {
    const base64 = btoa(unescape(encodeURIComponent(text)));
    const r = await fetch('/api/scenarios/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBase64: base64, name: document.getElementById('scenario-manual-name')?.value.trim() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Сценарий сохранён: ${d.name}`);
    document.getElementById('scenario-manual-text').value = '';
    document.getElementById('scenario-manual-name').value = '';
    loadScenarios();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btn.disabled = false; }
});

// ── Active detail selection ───────────────────────────────────────────────────
const activeDetailFiles = new Set(); // file names of selected details

function toggleDetailActive(file, cardEl) {
  if (activeDetailFiles.has(file)) {
    activeDetailFiles.delete(file);
    cardEl.classList.remove('detail-selected');
  } else {
    activeDetailFiles.add(file);
    cardEl.classList.add('detail-selected');
  }
  updateAutofillPanel();
}

function updateAutofillPanel() {
  const panel = document.getElementById('detail-autofill-panel');
  if (!panel) return;
  if (activeDetailFiles.size < 1) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  // Populate scenario dropdown with current scenarioFiles list
  const sel = document.getElementById('detail-autofill-scenario');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '';
    if (!scenarioFiles.length) {
      const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'Нет сценариев'; sel.appendChild(opt);
    } else {
      scenarioFiles.forEach(f => {
        const opt = document.createElement('option'); opt.value = f.file; opt.textContent = f.name; sel.appendChild(opt);
      });
      if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    }
  }
}

document.getElementById('btn-detail-autofill')?.addEventListener('click', async () => {
  const scenFile = document.getElementById('detail-autofill-scenario')?.value;
  const pct      = Math.max(1, Math.min(100, Number(document.getElementById('detail-autofill-pct')?.value) || 60));
  if (!scenFile) { setStatus('Выберите сценарий.'); return; }
  if (!activeDetailFiles.size) { setStatus('Нет активных предметов.'); return; }

  // Get lines for the scenario (use cache or fetch)
  const lines = await getLinesForScenario(scenFile);
  if (!lines.length) { setStatus('Сценарий пуст.'); return; }

  const detailArr = [...activeDetailFiles];
  const count     = Math.max(1, Math.round(lines.length * pct / 100));

  // Pick `count` random line indices (without repetition if count ≤ lines.length)
  const indices = [];
  const pool    = lines.map((_, i) => i);
  while (indices.length < count && pool.length) {
    const r = Math.floor(Math.random() * pool.length);
    indices.push(pool.splice(r, 1)[0]);
  }

  // Assign a random detail from the active set to each picked line
  indices.forEach(i => {
    const det = detailArr[Math.floor(Math.random() * detailArr.length)];
    scenarioAssignments[`${scenFile}__${i}`] = det;
  });

  await saveScenarioAssignments();
  updateActiveScenariosList();

  // Re-render the open scenario body if it's currently visible
  const allBodies = document.querySelectorAll('.scenario-item');
  allBodies.forEach(item => {
    const titleEl = item.querySelector('.scenario-title');
    const scenObj = scenarioFiles.find(f => f.name === titleEl?.textContent && f.file === scenFile);
    if (scenObj) {
      const body = item.querySelector('.scenario-body');
      if (body?.classList.contains('open')) body.dispatchEvent(new Event('rerender'));
    }
  });

  setStatus(`Заполнено: ${count} из ${lines.length} строк (${pct}%)`);
});

// ── Details ───────────────────────────────────────────────────────────────────
const detailInput     = document.getElementById('detail-input');
const detailUrlInput  = document.getElementById('detail-url-input');
const btnDetailPick   = document.getElementById('btn-detail-file-pick');
const btnDetailUpload = document.getElementById('btn-detail-upload');
const detailNameInput = document.getElementById('detail-name');
const detailsGrid     = document.getElementById('details-grid');
let detailBlob = null;

function detailMarkReady(label) {
  if (detailUrlInput) detailUrlInput.value = label;
  if (btnDetailUpload) btnDetailUpload.disabled = false;
}
function detailClear() {
  if (detailUrlInput) detailUrlInput.value = '';
  if (detailInput)    detailInput.value = '';
  if (btnDetailUpload) btnDetailUpload.disabled = true;
  detailBlob = null;
}

// File picker button
btnDetailPick?.addEventListener('click', () => detailInput?.click());
detailInput?.addEventListener('change', () => {
  const f = detailInput.files[0]; if (!f) return;
  detailBlob = f;
  detailMarkReady(`📁 ${f.name}`);
});

// URL typed into the text field
detailUrlInput?.addEventListener('input', () => {
  const v = detailUrlInput.value.trim();
  if (v.startsWith('http')) {
    detailBlob = null;
    if (btnDetailUpload) btnDetailUpload.disabled = false;
  } else if (!detailBlob) {
    if (btnDetailUpload) btnDetailUpload.disabled = true;
  }
});

// Paste image from clipboard (Ctrl+V)
detailUrlInput?.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      detailBlob = item.getAsFile();
      detailMarkReady('📋 Изображение вставлено');
      return;
    }
  }
  // Plain text paste (URL) — handled by 'input' event
});

btnDetailUpload?.addEventListener('click', async () => {
  const urlVal = detailUrlInput?.value.trim() || '';
  if (!detailBlob && !urlVal.startsWith('http')) {
    setStatus('Загрузите файл или укажите URL изображения.'); return;
  }
  btnDetailUpload.disabled = true; setStatus('Сохраняю предмет…');
  try {
    const body = { name: detailNameInput?.value.trim() };
    if (detailBlob) {
      body.imageBase64 = await blobToBase64(detailBlob);
    } else {
      body.imageUrl = urlVal;
    }
    const r = await fetch('/api/details/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Предмет сохранён: ${d.name}`);
    detailClear();
    if (detailNameInput) detailNameInput.value = '';
    loadDetails();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnDetailUpload.disabled = false; }
});

async function loadDetails() {
  if (!detailsGrid) return;
  try {
    const d = await fetch('/api/details').then(r => r.json());
    cachedDetailFiles = d.success ? d.files : [];
    detailsGrid.innerHTML = '';
    if (!d.files.length) { detailsGrid.innerHTML = '<div class="gallery-empty">Нет предметов</div>'; return; }
    d.files.forEach(item => {
      const card = buildGalleryCard(item, (it, imgEl) => {
        activateAsset?.(it.path, it.thumbPath || it.path, it.name || '', 'detail', imgEl);
      });
      // Restore selection state
      if (activeDetailFiles.has(item.file)) card.classList.add('detail-selected');
      // Click on image area toggles selection
      const imgWrap = card.querySelector('.g-img-wrap');
      imgWrap?.addEventListener('click', e => {
        e.stopPropagation();
        toggleDetailActive(item.file, card);
      });
      detailsGrid.appendChild(card);
    });
    relinkActiveThumbs?.(detailsGrid, 'data-path');
    updateAutofillPanel();
  } catch { detailsGrid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>'; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadScenarios();
loadDetails();
loadScenarioObrazы();
// Resume any in-flight Edit panel generations that survived a restart
resumeEditPendingCells();
