/* scen-utils.js — Resume-polling helpers, pickRandomObrazImage, runEditPose, getMergedOptions */

// ── Resume polling for Edit cells that had in-flight tasks at restart ─────────
// Runs after page load; for each frozen session cell that has a taskId but no
// imagePath, resumes polling and fills the result in when the task completes.
async function resumeEditPendingCells() {
  let anyPending = false;
  const promises = [];

  for (const [sessionKey, session] of Object.entries(editFrozenSessions)) {
    if (!Array.isArray(session.cells)) continue;

    session.cells.forEach((cell, cellIdx) => {
      if (!cell.taskId || cell.imagePath) return;  // nothing to resume
      anyPending = true;
      const cardKey = `${sessionKey}__${cellIdx}`;

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

// ── Resume polling for avatar video tasks that survived a tab switch / reload ──
// For each frozen session cell that has avatarTaskId but no videoPath, resumes
// polling pollAvatar() and writes the result back when kie.ai finishes.
async function resumeAvatarPendingCells() {
  let anyPending = false;
  const promises = [];

  for (const [, session] of Object.entries(editFrozenSessions)) {
    if (!Array.isArray(session.cells)) continue;

    session.cells.forEach(cell => {
      if (!cell.avatarTaskId || cell.videoPath) return;  // nothing to resume
      anyPending = true;
      cell._videoPending = true;  // show spinner in montage panel immediately

      promises.push((async () => {
        try {
          const videoPath = await pollAvatar(cell.avatarTaskId);
          cell.videoPath  = videoPath;
          cell.videoError = null;
          delete cell.avatarTaskId;
          delete cell._videoPending;
          saveEditState();
          renderEditPanel();
          renderMontagePanel();
        } catch (err) {
          cell.videoError = err.message || 'Avatar failed';
          delete cell.avatarTaskId;
          delete cell._videoPending;
          saveEditState();
          renderEditPanel();
          renderMontagePanel();
        }
      })());
    });
  }

  if (anyPending) {
    renderEditPanel();
    setStatus('Восстанавливаю незавершённые видео говорящей головы…');
  }

  await Promise.all(promises);
  if (anyPending) setStatus('Восстановление видео завершено.');
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
    imageEngine = imageEngine || getImageEngine?.() || 'nano-banana-2';
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

    // Accumulate pose variants in cache for lightbox slider
    const prevPoseCache = cardKey ? (editCardCache[cardKey] || {}) : {};
    const poseGenImgs = prevPoseCache.generatedImages || [];
    if (!poseGenImgs.includes(imagePath)) poseGenImgs.push(imagePath);
    const poseCacheObj = { imagePath, generatedImages: poseGenImgs };
    if (cardKey) { editCardCache[cardKey] = poseCacheObj; saveEditState(); }

    img.addEventListener('click', () => openImagePicker(
      poseCacheObj.generatedImages?.length ? poseCacheObj.generatedImages : [poseCacheObj.imagePath],
      img, poseCacheObj.imagePath, selected => {
        poseCacheObj.imagePath = selected;
        img.src = selected + '?t=' + Date.now();
        if (cardKey) { editCardCache[cardKey] = poseCacheObj; saveEditState(); }
      }));
    imgBox.appendChild(img);
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
