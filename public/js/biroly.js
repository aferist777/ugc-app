/* ═══════════════════════════════════════════════════════════════════
   БИРОЛЫ TAB — user-defined spintax prompt slots.
   Spintax format: {option1|option2|option3}
   Also parses JS-style: {{ "a|b|c".split('|')[Math.floor(Math.random()*N)] }}
   Editing happens in a modal popup. Dropdowns in the main column.
   State persisted in localStorage.
   ═══════════════════════════════════════════════════════════════════ */

(function () {

  /* ── Random name pool for new categories ───────────────────────── */
  const ADJ  = ['Алый','Синий','Золотой','Зелёный','Серебряный','Пурпурный','Янтарный','Белый','Тёмный','Яркий','Дикий','Быстрый','Ленивый','Смелый','Тихий','Огненный','Ледяной','Бурный','Светлый','Мрачный'];
  const ANIM = ['Тигр','Лиса','Волк','Медведь','Орёл','Дельфин','Пантера','Енот','Сова','Лось','Рысь','Ягуар','Журавль','Кот','Лев','Краб','Акула','Конь','Змея','Олень'];
  function randomCatName() {
    return ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + ANIM[Math.floor(Math.random() * ANIM.length)];
  }

  const EMOJI_POOL = ['🎬','🎥','🌟','🎭','🎪','🎨','💡','🔥','⚡','🌊','🦋','🎯','💎','🌙','🎵','🍀','🦊','🐙','🌈','🎲'];

  const DEFAULT_CATS = [
    { id: 'hooks',   label: 'Hooks' },
    { id: 'science', label: 'Science' },
    { id: 'hands',   label: 'Hands' },
    { id: 'faces',   label: 'Faces' },
  ];

  /* ── State ──────────────────────────────────────────────────────── */
  let slots      = {};
  let categories = [];
  let selectedId = null;

  const LS_SLOTS = 'biroly_slots_v2';
  const LS_CATS  = 'biroly_cats';

  function loadState() {
    try {
      const rs = localStorage.getItem(LS_SLOTS);
      const rc = localStorage.getItem(LS_CATS);
      if (rs) slots = JSON.parse(rs);
      categories = rc ? JSON.parse(rc) : [...DEFAULT_CATS];
      if (!categories.length) categories = [...DEFAULT_CATS];
    } catch {
      slots = {}; categories = [...DEFAULT_CATS];
    }
    // Always persist so renderSessionBirolys (Склейка) can read the current order
    try { localStorage.setItem(LS_CATS, JSON.stringify(categories)); } catch {}
  }

  function saveState() {
    try {
      localStorage.setItem(LS_SLOTS, JSON.stringify(slots));
      localStorage.setItem(LS_CATS,  JSON.stringify(categories));
    } catch {}
  }

  /* ── Helpers ────────────────────────────────────────────────────── */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* Convert JS-style spintax → simple {a|b|c} */
  function normalizeSpintax(text) {
    return text.replace(
      /\{\{\s*["']([^"']+)["']\.split\(['"][\|]['"][^)]*\)\[Math\.floor\(Math\.random\(\)\s*\*\s*\d+\)\]\s*\}\}/g,
      (_, options) => `{${options}}`
    );
  }

  /* Parse {a|b|c} groups → [{ options }] */
  function parseSpintax(text) {
    const groups = [];
    const re = /\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const options = m[1].split('|').map(s => s.trim()).filter(Boolean);
      if (options.length > 0) groups.push({ options });
    }
    return groups;
  }

  /* Build preview HTML: replace {a|b|c} with bolded selection */
  function buildPreviewHTML(slot) {
    if (!slot.prompt) return null;
    const groups = parseSpintax(slot.prompt);
    if (!groups.length) {
      return slot.prompt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    let i = 0;
    return slot.prompt
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\{([^}]+)\}/g, (_, inner) => {
        const options = inner.split('|').map(s => s.trim()).filter(Boolean);
        if (!options.length) return `{${inner}}`;
        const selIdx = (slot.selections && slot.selections[i] != null) ? slot.selections[i] : 0;
        const chosen = options[Math.min(selIdx, options.length - 1)];
        i++;
        return `<strong>${chosen}</strong>`;
      });
  }

  /* ── Gen state ─────────────────────────────────────────────────── */
  let birolEnhancedPrompt = null; // enhanced prompt after realism button, null if not enhanced

  /* Resolve prompt with current selections */
  function resolvePromptCurrent(slot) {
    if (!slot.prompt) return '';
    let gIdx = 0;
    return slot.prompt.replace(/\{([^}]+)\}/g, (_, inner) => {
      const opts = inner.split('|').map(s => s.trim()).filter(Boolean);
      const sel  = (slot.selections && slot.selections[gIdx] != null) ? slot.selections[gIdx] : 0;
      gIdx++;
      return opts[Math.min(sel, opts.length - 1)] || opts[0] || '';
    });
  }

  /* Resolve prompt with random selections (updates slot.selections) */
  function resolvePromptRandom(slot) {
    const groups = parseSpintax(slot.prompt || '');
    slot.selections = groups.map(g => Math.floor(Math.random() * g.options.length));
    return resolvePromptCurrent(slot);
  }

  /* ── DOM refs ───────────────────────────────────────────────────── */
  const catListEl        = document.getElementById('biroly-category-list');
  const addRowBtn        = document.getElementById('biroly-add-row-btn');
  const previewEmptyEl   = document.getElementById('biroly-preview-empty');
  const promptOutputEl   = document.getElementById('biroly-prompt-output');
  const genAreaEl        = document.getElementById('biroly-gen-area');
  const genStatusEl      = document.getElementById('biroly-gen-status');
  const genImgEl         = document.getElementById('biroly-gen-img');
  const genActionsEl     = document.getElementById('biroly-gen-actions');
  const genCancelBtn     = document.getElementById('biroly-gen-cancel');
  const genRetryBtn      = document.getElementById('biroly-gen-retry');
  const genConfirmBtn    = document.getElementById('biroly-gen-confirm');
  const copyBtn          = document.getElementById('biroly-copy-btn');
  const noSelEl          = document.getElementById('biroly-no-sel');
  const editorEl         = document.getElementById('biroly-editor');
  const slotHeaderEl     = document.getElementById('biroly-slot-header');
  const spintaxContainer = document.getElementById('biroly-spintax-controls');
  const saveBtn          = document.getElementById('biroly-save-btn');
  const editBtn          = document.getElementById('biroly-edit-btn');
  const deleteBtn        = document.getElementById('biroly-delete-btn');
  const imgvidRow        = document.getElementById('biroly-imgvid-row');
  const genBtn           = document.getElementById('biroly-gen-btn');
  const genPlusBtn       = document.getElementById('biroly-gen-plus-btn');
  const realismRowEl     = document.getElementById('biroly-realism-row');
  const realismBtn       = document.getElementById('biroly-realism-btn');
  const realismResetBtn  = document.getElementById('biroly-realism-reset');
  const enhancedBadgeEl  = document.getElementById('biroly-enhanced-badge');

  /* ── Realism enhancement ────────────────────────────────────────── */
  function clearEnhanced() {
    birolEnhancedPrompt = null;
    promptOutputEl.classList.remove('realism-enhanced');
    if (enhancedBadgeEl)  enhancedBadgeEl.style.display  = 'none';
    if (realismResetBtn)  realismResetBtn.style.display   = 'none';
    if (realismBtn)       { realismBtn.textContent = '✨ Реализм'; realismBtn.disabled = false; }
  }

  realismBtn?.addEventListener('click', async () => {
    if (!selectedId || !slots[selectedId]) return;
    const slot = slots[selectedId];
    const basePrompt = birolEnhancedPrompt || resolvePromptCurrent(slot);
    if (!basePrompt) return;

    realismBtn.textContent = '⏳ Улучшаю…';
    realismBtn.disabled = true;

    try {
      const res = await fetch('/api/biroly/enhance-realism', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: basePrompt }),
      }).then(r => r.json());

      if (!res.success) throw new Error(res.error);

      birolEnhancedPrompt = res.prompt;
      promptOutputEl.innerHTML = birolEnhancedPrompt
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      promptOutputEl.style.display = 'block';
      promptOutputEl.classList.add('realism-enhanced');
      previewEmptyEl.style.display = 'none';
      if (enhancedBadgeEl)  enhancedBadgeEl.style.display  = 'block';
      if (realismResetBtn)  realismResetBtn.style.display   = 'inline-block';
      realismBtn.textContent = '✨ Ещё раз';
      realismBtn.disabled = false;
    } catch (e) {
      realismBtn.textContent = '✨ Реализм';
      realismBtn.disabled = false;
      setStatus?.(`Реализм: ошибка — ${e.message}`);
    }
  });

  realismResetBtn?.addEventListener('click', () => {
    clearEnhanced();
    renderPreview();
  });

  /* ── Gen flow — parallel, background ───────────────────────────── */

  let _genCount = 0; // number of active concurrent generations

  /* Open the center gen-area (call at start of any gen) */
  function _genOpen() {
    _genCount++;
    previewEmptyEl.style.display = 'none';
    promptOutputEl.style.display = 'none';
    copyBtn.style.display        = 'none';
    genAreaEl.style.display      = 'flex';
    genActionsEl.style.display   = 'none';
  }

  /* Called when a gen finishes (success or error) */
  function _genClose(finalStatus) {
    if (finalStatus !== undefined) genStatusEl.textContent = finalStatus;
    _genCount = Math.max(0, _genCount - 1);
    if (_genCount === 0) {
      setTimeout(() => {
        if (_genCount === 0) {
          genAreaEl.style.display    = 'none';
          genImgEl.style.display     = 'none';
          genImgEl.src               = '';
          genStatusEl.textContent    = '';
          genActionsEl.style.display = 'none';
          renderPreview();
        }
      }, 2000);
    }
  }

  /* Promise-based poll wrappers */
  function _awaitImg(taskId) {
    return new Promise((res, rej) => pollImageStatus(taskId, res, e => rej(new Error(e))));
  }
  function _awaitVid(taskId) {
    return new Promise((res, rej) => pollVideoStatus(taskId, res, e => rej(new Error(e))));
  }
  async function _post(url, body) {
    return (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  }

  function _st(t) { genStatusEl.textContent = t; }
  function _img(p) { genImgEl.src = p; genImgEl.style.display = 'block'; }

  // ── Pending gen persistence ──────────────────────────────────────────────────
  const BIROLY_PENDING_KEY = 'biroly_pending_v1';
  function _getPendingGens()    { try { return JSON.parse(localStorage.getItem(BIROLY_PENDING_KEY) || '[]'); } catch { return []; } }
  function _savePendingGens(l)  { localStorage.setItem(BIROLY_PENDING_KEY, JSON.stringify(l)); }
  function _upsertPendingGen(g) { const l = _getPendingGens(); const i = l.findIndex(x => x.genId === g.genId); if (i >= 0) l[i] = g; else l.unshift(g); _savePendingGens(l); }
  function _removePendingGen(id){ _savePendingGens(_getPendingGens().filter(g => g.genId !== id)); }
  function _genUid()            { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  // ── Base pipeline (throws on error — retries handled by _execWithRetry) ────────
  async function _execBaseGen(gs) {
    if (!gs.imagePath) {
      _st(gs.currentTaskId ? '⏳ Возобновление генерации…' : '⏳ Генерация изображения…');
      genImgEl.style.display = 'none';
      if (!gs.currentTaskId) {
        const r = await _post('/api/biroly/gen-image', { prompt: gs.prompt });
        if (!r.success) throw new Error(r.error || 'Ошибка запуска');
        gs.currentTaskId = r.taskId; _upsertPendingGen(gs);
      }
      const { imagePath, thumbPath } = await _awaitImg(gs.currentTaskId);
      gs.imagePath = imagePath; gs.thumbPath = thumbPath; gs.stage = 'analyze'; gs.currentTaskId = null;
      _upsertPendingGen(gs);
      updateBirolyEntry(gs.birolyId, { imagePath, thumbPath });
      pushToGeni?.(imagePath, null, null);
    }
    _img(gs.imagePath);

    let vidTaskId = (gs.stage === 'video' && gs.currentTaskId) ? gs.currentTaskId : null;
    if (!vidTaskId) {
      _st('🔍 Анализирую изображение…');
      const analRes = await _post('/api/biroly/analyze-for-video', { imagePath: gs.imagePath });
      if (!analRes.success) throw new Error(analRes.error || 'Ошибка анализа');
      _st('🎬 Генерация видео…');
      const vidRes = await _post('/api/video/grok', { imagePath: gs.imagePath, prompt: analRes.prompt, aspectRatio: '9:16' });
      if (!vidRes.success) throw new Error(vidRes.error || 'Ошибка Grok');
      gs.stage = 'video'; gs.currentTaskId = vidRes.taskId; vidTaskId = vidRes.taskId;
      _upsertPendingGen(gs);
    } else {
      _st('🎬 Возобновление генерации видео…');
    }
    const videoPath = await _awaitVid(vidTaskId);

    updateBirolyEntry(gs.birolyId, { videoPath, status: 'done', duration: 6 });
    _removePendingGen(gs.genId);
    renderBirolyStrip?.();
    _genClose('✅ Сохранено в Биролы');
  }

  // ── Plus pipeline (throws on error) ─────────────────────────────────────────
  async function _execPlusGen(gs) {
    if (!gs.img1done) {
      _st(gs.currentTaskId ? '⏳ Возобновление…' : '⏳ 1/4 — Генерация изображения…');
      genImgEl.style.display = 'none';
      if (!gs.currentTaskId || gs.stage !== 'img1') {
        const r = await _post('/api/biroly/gen-image', { prompt: gs.prompt });
        if (!r.success) throw new Error(r.error || 'Ошибка запуска');
        gs.stage = 'img1'; gs.currentTaskId = r.taskId; _upsertPendingGen(gs);
      }
      const { imagePath: ip1 } = await _awaitImg(gs.currentTaskId);
      pushToGeni?.(ip1, null, null);
      gs.img1done = true; gs.stage = 'enhance'; gs.currentTaskId = null; _upsertPendingGen(gs);
    }

    if (!gs.enhancedPrompt) {
      _st('✨ 2/4 — Улучшение промпта (реализм)…');
      const realRes = await _post('/api/biroly/enhance-realism', { prompt: gs.prompt });
      if (!realRes.success) throw new Error(realRes.error || 'Ошибка улучшения');
      gs.enhancedPrompt = realRes.prompt; gs.stage = 'img2'; _upsertPendingGen(gs);
    }

    if (!gs.imagePath) {
      _st(gs.currentTaskId ? '⏳ Возобновление…' : '⏳ 3/4 — Генерация улучшенного изображения…');
      if (!gs.currentTaskId || gs.stage !== 'img2') {
        const r = await _post('/api/biroly/gen-image', { prompt: gs.enhancedPrompt });
        if (!r.success) throw new Error(r.error || 'Ошибка запуска');
        gs.stage = 'img2'; gs.currentTaskId = r.taskId; _upsertPendingGen(gs);
      }
      const { imagePath: ip2, thumbPath: tp2 } = await _awaitImg(gs.currentTaskId);
      gs.imagePath = ip2; gs.thumbPath = tp2; gs.stage = 'analyze'; gs.currentTaskId = null; _upsertPendingGen(gs);
      updateBirolyEntry(gs.birolyId, { imagePath: ip2, thumbPath: tp2 });
      pushToGeni?.(ip2, null, null);
    }
    _img(gs.imagePath);

    let vidTaskId = (gs.stage === 'video' && gs.currentTaskId) ? gs.currentTaskId : null;
    if (!vidTaskId) {
      _st('🔍 4/4 — Анализирую изображение…');
      const analRes = await _post('/api/biroly/analyze-for-video', { imagePath: gs.imagePath });
      if (!analRes.success) throw new Error(analRes.error || 'Ошибка анализа');
      _st('🎬 4/4 — Генерация видео…');
      const vidRes = await _post('/api/video/grok', { imagePath: gs.imagePath, prompt: analRes.prompt, aspectRatio: '9:16' });
      if (!vidRes.success) throw new Error(vidRes.error || 'Ошибка Grok');
      gs.stage = 'video'; gs.currentTaskId = vidRes.taskId; vidTaskId = vidRes.taskId; _upsertPendingGen(gs);
    } else {
      _st('🎬 4/4 — Возобновление генерации видео…');
    }
    const videoPath = await _awaitVid(vidTaskId);

    updateBirolyEntry(gs.birolyId, { videoPath, status: 'done', duration: 6 });
    _removePendingGen(gs.genId);
    renderBirolyStrip?.();
    _genClose('✅ Сохранено в Биролы');
  }

  // ── Auto-retry wrapper: 3 attempts, resumes from last checkpoint ─────────────
  const _MAX_RETRIES = 3;
  async function _execWithRetry(gs) {
    for (let attempt = 1; attempt <= _MAX_RETRIES; attempt++) {
      try {
        if (gs.mode === 'plus') await _execPlusGen(gs);
        else await _execBaseGen(gs);
        return;
      } catch (e) {
        gs.currentTaskId = null; // dead task id — don't try to resume it
        _upsertPendingGen(gs);
        if (attempt < _MAX_RETRIES) {
          const delaySec = attempt * 5;
          _st(`⚠ Попытка ${attempt}/${_MAX_RETRIES}: ${e.message}. Повтор через ${delaySec}с…`);
          updateBirolyEntry(gs.birolyId, { status: 'generating' });
          await new Promise(r => setTimeout(r, delaySec * 1000));
        } else {
          const retryState = gs.mode === 'plus'
            ? { mode: 'plus', prompt: gs.prompt, imagePath: gs.imagePath || null, thumbPath: gs.thumbPath || null,
                stage: gs.stage === 'video' ? 'analyze' : gs.stage,
                enhancedPrompt: gs.enhancedPrompt || null, img1done: gs.img1done || false }
            : { mode: 'base', prompt: gs.prompt, imagePath: gs.imagePath || null, thumbPath: gs.thumbPath || null,
                stage: gs.stage === 'video' ? 'analyze' : gs.stage };
          updateBirolyEntry(gs.birolyId, { status: 'error', errorMsg: e.message, retryState });
          _removePendingGen(gs.genId);
          _genClose(`❌ ${e.message}`);
        }
      }
    }
  }

  // ── Manual retry from database tab ───────────────────────────────────────────
  function retryBirolyEntry(birolyId) {
    const list = typeof getBirolyArchive === 'function' ? getBirolyArchive() : [];
    const entry = list.find(e => e.id === birolyId);
    if (!entry || !entry.retryState) return;
    const rs = entry.retryState;
    updateBirolyEntry(birolyId, { status: 'generating', retryState: null, errorMsg: null });
    const gs = {
      genId: _genUid(), mode: rs.mode, birolyId,
      prompt: rs.prompt, imagePath: rs.imagePath || null, thumbPath: rs.thumbPath || null,
      stage: rs.stage || (rs.mode === 'plus' ? 'img1' : 'img'), currentTaskId: null,
      enhancedPrompt: rs.enhancedPrompt || null, img1done: rs.img1done || false,
    };
    _upsertPendingGen(gs);
    _genOpen();
    _execWithRetry(gs);
  }
  window.retryBirolyEntry = retryBirolyEntry;

  // ── Public gen entry points ──────────────────────────────────────────────────

  /* ── Генерировать ── */
  function startBirolyGen() {
    if (!selectedId || !slots[selectedId]) return;
    const slot = slots[selectedId];
    const prompt = resolvePromptRandom(slot);
    saveState(); renderSpintaxDropdowns(slot);
    const catLabel = categories.find(c => c.id === slot.categoryId)?.label || '';
    const birolyId = addPendingBirolyEntry(slot.name || 'Бирол', prompt, { categoryId: slot.categoryId || '', categoryLabel: catLabel });
    const gs = { genId: _genUid(), mode: 'base', birolyId, prompt, imagePath: null, stage: 'img', currentTaskId: null };
    _upsertPendingGen(gs);
    _genOpen();
    _execWithRetry(gs);
  }

  /* ── Генерировать+ ── */
  function startBirolyGenPlus() {
    if (!selectedId || !slots[selectedId]) return;
    const slot = slots[selectedId];
    const prompt = resolvePromptRandom(slot);
    saveState(); renderSpintaxDropdowns(slot);
    const catLabel = categories.find(c => c.id === slot.categoryId)?.label || '';
    const birolyId = addPendingBirolyEntry(slot.name || 'Бирол', prompt, { categoryId: slot.categoryId || '', categoryLabel: catLabel });
    const gs = { genId: _genUid(), mode: 'plus', birolyId, prompt, enhancedPrompt: null, img1done: false, imagePath: null, stage: 'img1', currentTaskId: null };
    _upsertPendingGen(gs);
    _genOpen();
    _execWithRetry(gs);
  }

  // ── Resume pending gens on startup ───────────────────────────────────────────
  function resumePendingBirolyGens() {
    const pending = _getPendingGens();
    if (!pending.length) return;
    pending.forEach(gs => {
      _genOpen();
      _execWithRetry(gs);
    });
  }

  /* Wire gen buttons */
  genBtn?.addEventListener('click',     startBirolyGen);
  genPlusBtn?.addEventListener('click', startBirolyGenPlus);

  /* Open image in lightbox on click */
  genImgEl?.addEventListener('click', () => {
    if (genImgEl.src) openLightbox?.(genImgEl.getAttribute('src'));
  });

  // ── Legacy setGenUI stub (referenced nowhere after refactor, kept for safety) ──
  function setGenUI(phase, imagePath) {
    // phase: 'polling-img' | 'image-ready' | 'polling-vid' | 'error' | null
    const inGen = phase !== null;
    previewEmptyEl.style.display  = inGen ? 'none' : '';
    promptOutputEl.style.display  = inGen ? 'none' : 'none'; // managed by renderPreview
    copyBtn.style.display         = inGen ? 'none' : '';
    genAreaEl.style.display       = inGen ? 'flex' : 'none';

    if (phase === 'polling-img') {
      genStatusEl.textContent = '⏳ Генерация изображения…';
      genImgEl.style.display  = 'none';
      genActionsEl.style.display = 'none';
    } else if (phase === 'image-ready') {
      genStatusEl.textContent = '';
      if (imagePath) {
        genImgEl.src = imagePath;
        genImgEl.style.display = 'block';
      }
      genActionsEl.style.display = 'flex';
      genCancelBtn.style.display = '';
      genRetryBtn.style.display  = '';
      genConfirmBtn.style.display = '';
      genConfirmBtn.disabled = false;
    } else if (phase === 'polling-vid') {
      genStatusEl.textContent = '🎬 Генерация видео…';
      genActionsEl.style.display = 'none';
    } else if (phase === 'error') {
      // Show cancel + retry, hide confirm — let user retry or abort
      // Keep image visible if one was set (error during video gen phase)
      if (imagePath) {
        genImgEl.src = imagePath;
        genImgEl.style.display = 'block';
      } else if (!genImgEl.src || genImgEl.style.display === 'none') {
        genImgEl.style.display = 'none';
      }
      genActionsEl.style.display = 'flex';
      genCancelBtn.style.display = '';
      genRetryBtn.style.display  = '';
      genConfirmBtn.style.display = 'none';
    } else {
      // null — restore
      genAreaEl.style.display    = 'none';
      genImgEl.style.display     = 'none';
      genActionsEl.style.display = 'none';
      genImgEl.src               = '';
      genStatusEl.textContent    = '';
      // Reset button visibility for next time
      genCancelBtn.style.display  = '';
      genRetryBtn.style.display   = '';
      genConfirmBtn.style.display = '';
    }
  }

  /* Poll /api/status/:taskId for image result */
  function pollImageStatus(taskId, onDone, onError) {
    let stopped = false;
    let ticks = 0;
    const maxTicks = 75; // 75 * 4s = 5 min
    const stop = () => { stopped = true; };
    const tick = async () => {
      if (stopped) return;
      if (++ticks > maxTicks) { onError('Превышено время ожидания (5 мин)'); return; }
      try {
        const d = await fetch(`/api/status/${taskId}`).then(r => r.json());
        if (d.state === 'success') { if (!stopped) onDone({ imagePath: d.imagePath, thumbPath: d.thumbPath || null }); }
        else if (d.state === 'failed') { if (!stopped) onError(d.error || 'Ошибка генерации'); }
        else if (!stopped) setTimeout(tick, 4000);
      } catch (e) { if (!stopped) onError(e.message); }
    };
    setTimeout(tick, 4000);
    return stop;
  }

  /* Poll /api/video/grok/status/:taskId for video result */
  function pollVideoStatus(taskId, onDone, onError) {
    let stopped = false;
    let ticks = 0;
    const maxTicks = 50; // 50 * 6s = 5 min
    const stop = () => { stopped = true; };
    const tick = async () => {
      if (stopped) return;
      if (++ticks > maxTicks) { onError('Превышено время ожидания (5 мин)'); return; }
      try {
        const d = await fetch(`/api/video/grok/status/${taskId}`).then(r => r.json());
        if (d.state === 'success') { if (!stopped) onDone(d.videoPath); }
        else if (d.state === 'failed') { if (!stopped) onError(d.error || 'Ошибка видео'); }
        else if (!stopped) setTimeout(tick, 6000);
      } catch (e) { if (!stopped) onError(e.message); }
    };
    setTimeout(tick, 6000);
    return stop;
  }


  /* Cancel gen — close the UI (background gens continue and will save automatically) */
  function cancelBirolyGen() {
    setGenUI(null);
    renderPreview();
  }

  /* Retry — start a fresh gen */
  function retryBirolyGen() {
    setGenUI(null);
    startBirolyGen();
  }

  /* Wire gen buttons */
  genCancelBtn?.addEventListener('click', cancelBirolyGen);
  genRetryBtn?.addEventListener('click',  retryBirolyGen);

  /* ── Modal ──────────────────────────────────────────────────────── */
  let modalOverlay = null;

  function createModal() {
    const overlay = document.createElement('div');
    overlay.id = 'biroly-modal-overlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:5000;align-items:center;justify-content:center;';

    const win = document.createElement('div');
    win.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;width:560px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;box-shadow:4px 4px 0 #000;';

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'background:#000080;color:#fff;padding:4px 8px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;user-select:none;';
    const titleText = document.createElement('span');
    titleText.id = 'biroly-modal-title';
    titleText.style.cssText = 'font-size:11px;font-weight:bold;';
    titleText.textContent = 'Редактирование';
    const closeX = document.createElement('button');
    closeX.textContent = '✕';
    closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:12px;padding:0 2px;line-height:1;';
    closeX.addEventListener('click', closeModal);
    titleBar.appendChild(titleText);
    titleBar.appendChild(closeX);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding:12px;overflow-y:auto;flex:1;';

    // Name row
    const nameRow = document.createElement('div');
    nameRow.className = 'biroly-editor-row';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Название:';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.id = 'biroly-modal-name';
    nameInp.style.cssText = 'width:100%;font-size:11px;box-sizing:border-box;';
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInp);

    // Prompt row + Parse button
    const promptRow = document.createElement('div');
    promptRow.className = 'biroly-editor-row';
    const promptLabel = document.createElement('label');
    promptLabel.textContent = 'Промпт:';
    const promptTa = document.createElement('textarea');
    promptTa.id = 'biroly-modal-prompt';
    promptTa.rows = 6;
    promptTa.style.cssText = 'width:100%;font-size:10px;font-family:inherit;resize:vertical;box-sizing:border-box;padding:4px;';
    const promptHintRow = document.createElement('div');
    promptHintRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:3px;';
    const promptHint = document.createElement('span');
    promptHint.style.cssText = 'font-size:9px;color:#666;flex:1;';
    promptHint.innerHTML = 'Спинтакс: <code>{вар1|вар2|вар3}</code>';
    const parseBtn = document.createElement('button');
    parseBtn.textContent = '⟳ Разобрать';
    parseBtn.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;flex-shrink:0;';
    parseBtn.title = 'Разобрать спинтакс из промпта заново';
    parseBtn.addEventListener('click', () => {
      if (!selectedId || !slots[selectedId]) return;
      const raw = normalizeSpintax(promptTa.value);
      promptTa.value = raw;
      // Re-parse and rebuild group editors (reset names)
      const groups = parseSpintax(raw);
      const slot = slots[selectedId];
      slot.groupNames = groups.map((_, i) => (slot.groupNames?.[i]) || '');
      renderModalGroups(raw, slot);
    });
    promptHintRow.appendChild(promptHint);
    promptHintRow.appendChild(parseBtn);
    promptRow.appendChild(promptLabel);
    promptRow.appendChild(promptTa);
    promptRow.appendChild(promptHintRow);

    // ── Video analysis row ──────────────────────────────────────────────────
    const videoRow = document.createElement('div');
    videoRow.className = 'biroly-editor-row';
    videoRow.style.cssText = 'margin-top:8px;border-top:1px solid #c0c0c0;padding-top:8px;';

    const videoLbl = document.createElement('div');
    videoLbl.style.cssText = 'font-size:10px;font-weight:bold;color:#444;margin-bottom:5px;';
    videoLbl.textContent = '🎬 Анализ видео-референса';
    videoRow.appendChild(videoLbl);

    const videoControlRow = document.createElement('div');
    videoControlRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

    const videoInput = document.createElement('input');
    videoInput.type   = 'file';
    videoInput.accept = 'video/*';
    videoInput.id     = 'biroly-modal-video-input';
    videoInput.style.cssText = 'display:none;';

    const videoChooseBtn = document.createElement('button');
    videoChooseBtn.textContent = '📂 Выбрать видео';
    videoChooseBtn.style.cssText = 'font-size:9px;padding:2px 7px;cursor:pointer;';
    videoChooseBtn.addEventListener('click', () => videoInput.click());

    const videoFileLabel = document.createElement('span');
    videoFileLabel.id = 'biroly-modal-video-label';
    videoFileLabel.style.cssText = 'font-size:9px;color:#555;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
    videoFileLabel.textContent = 'Не выбрано';

    videoInput.addEventListener('change', () => {
      const f = videoInput.files?.[0];
      videoFileLabel.textContent = f ? f.name : 'Не выбрано';
    });

    const analyzeBtn = document.createElement('button');
    analyzeBtn.id = 'biroly-modal-analyze-btn';
    analyzeBtn.textContent = '🔍 Анализ';
    analyzeBtn.style.cssText = 'font-size:9px;padding:2px 7px;cursor:pointer;background:#e8f0ff;border:1px solid #5080c0;color:#103070;font-weight:bold;';
    analyzeBtn.title = 'Анализировать видео и заполнить промпт';

    const reanalyzeBtn = document.createElement('button');
    reanalyzeBtn.id = 'biroly-modal-reanalyze-btn';
    reanalyzeBtn.textContent = '↺ Переанал';
    reanalyzeBtn.style.cssText = 'font-size:9px;padding:2px 7px;cursor:pointer;background:#f4e8ff;border:1px solid #8050c0;color:#400070;display:none;';
    reanalyzeBtn.title = 'Отправить видео на повторный анализ';

    const analyzeStatus = document.createElement('span');
    analyzeStatus.id = 'biroly-modal-analyze-status';
    analyzeStatus.style.cssText = 'font-size:9px;color:#555;';

    videoControlRow.appendChild(videoInput);
    videoControlRow.appendChild(videoChooseBtn);
    videoControlRow.appendChild(videoFileLabel);
    videoControlRow.appendChild(analyzeBtn);
    videoControlRow.appendChild(reanalyzeBtn);
    videoControlRow.appendChild(analyzeStatus);
    videoRow.appendChild(videoControlRow);

    // Analysis handler (shared for both analyze + re-analyze)
    async function runVideoAnalysis() {
      const f = videoInput.files?.[0];
      if (!f) { analyzeStatus.textContent = '⚠ Выберите видео'; return; }
      analyzeBtn.disabled = true;
      reanalyzeBtn.disabled = true;
      analyzeStatus.textContent = '⏳ Извлекаем кадр…';

      try {
        // Extract frame client-side
        const frameDataUrl = await new Promise(resolve => {
          const url = URL.createObjectURL(f);
          const vid = document.createElement('video');
          vid.muted = true; vid.playsInline = true; vid.preload = 'metadata';
          let resolved = false;
          const done = v => { if (!resolved) { resolved = true; URL.revokeObjectURL(url); resolve(v); } };
          vid.addEventListener('loadedmetadata', () => { vid.currentTime = Math.min(1.0, (vid.duration || 2) * 0.15); }, { once: true });
          vid.addEventListener('seeked', () => {
            try {
              const w = 640, h = Math.round((vid.videoHeight || 360) / (vid.videoWidth || 640) * 640);
              const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h || 360;
              canvas.getContext('2d').drawImage(vid, 0, 0, w, canvas.height);
              done(canvas.toDataURL('image/jpeg', 0.85));
            } catch { done(null); }
          }, { once: true });
          vid.addEventListener('error', () => done(null), { once: true });
          setTimeout(() => done(null), 8000);
          vid.src = url;
        });

        if (!frameDataUrl) throw new Error('Не удалось извлечь кадр из видео');
        const frameBase64 = frameDataUrl.split(',')[1];

        // Gather existing slot examples from localStorage
        const existingExamples = (() => {
          try {
            const saved = JSON.parse(localStorage.getItem('biroly_slots_v2') || '{}');
            return Object.values(saved)
              .filter(s => s.prompt && s.prompt.includes('{'))
              .slice(0, 6)
              .map(s => ({ prompt: s.prompt, groupNames: s.groupNames || [] }));
          } catch { return []; }
        })();

        const slotName = document.getElementById('biroly-modal-name')?.value?.trim() || '';

        // Get category system prompt from Мозги if the slot's category has one
        let categorySystemPrompt = null;
        const slotCatId = selectedId && slots[selectedId] ? slots[selectedId].categoryId : null;
        const slotCat   = slotCatId ? categories.find(c => c.id === slotCatId) : null;
        if (slotCat?.systemPromptKey) {
          categorySystemPrompt = await window.getPromptText?.(slotCat.systemPromptKey) || null;
        }

        analyzeStatus.textContent = '⏳ Анализируем видео…';
        const r  = await fetch('/api/biroly/analyze-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frameBase64, existingExamples, slotName, categorySystemPrompt }),
        });
        const rj = await r.json();
        if (!rj.success) throw new Error(rj.error || 'Ошибка AI');

        // Fill in prompt textarea
        const ta = document.getElementById('biroly-modal-prompt');
        if (ta) ta.value = rj.prompt;

        // Update slot groupNames and re-render groups
        if (selectedId && slots[selectedId]) {
          const slot = slots[selectedId];
          slot.groupNames = rj.groupNames || [];
          renderModalGroups(rj.prompt, slot);
        }

        analyzeStatus.textContent = '✓ Промпт заполнен';
        reanalyzeBtn.style.display = '';
        setTimeout(() => { analyzeStatus.textContent = ''; }, 3000);
      } catch (err) {
        analyzeStatus.textContent = `⚠ ${err.message}`;
      } finally {
        analyzeBtn.disabled   = false;
        reanalyzeBtn.disabled = false;
      }
    }

    analyzeBtn.addEventListener('click', runVideoAnalysis);
    reanalyzeBtn.addEventListener('click', runVideoAnalysis);

    // Groups editor section
    const groupsSection = document.createElement('div');
    groupsSection.id = 'biroly-modal-spintax';
    groupsSection.style.cssText = 'margin-top:8px;';

    // Actions
    const actions = document.createElement('div');
    actions.className = 'biroly-editor-actions';
    actions.style.cssText = 'margin-top:10px;';
    const modalSaveBtn = document.createElement('button');
    modalSaveBtn.textContent = '💾 Сохранить';
    modalSaveBtn.style.cssText = 'flex:1;font-size:10px;';
    modalSaveBtn.addEventListener('click', () => saveFromModal());
    const modalCancelBtn = document.createElement('button');
    modalCancelBtn.textContent = 'Отмена';
    modalCancelBtn.style.cssText = 'flex:1;font-size:10px;';
    modalCancelBtn.addEventListener('click', closeModal);
    actions.appendChild(modalSaveBtn);
    actions.appendChild(modalCancelBtn);

    body.appendChild(nameRow);
    body.appendChild(promptRow);
    body.appendChild(videoRow);
    body.appendChild(groupsSection);
    body.appendChild(actions);
    win.appendChild(titleBar);
    win.appendChild(body);
    overlay.appendChild(win);

    win.addEventListener('mousedown', e => e.stopPropagation());
    win.addEventListener('click',     e => e.stopPropagation());
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
    modalOverlay = overlay;
  }

  function openModal(slotId) {
    if (!modalOverlay) createModal();
    if (!slotId || !slots[slotId]) return;
    const slot = slots[slotId];

    document.getElementById('biroly-modal-title').textContent = `Редактирование: ${slot.name || 'Слот'}`;
    document.getElementById('biroly-modal-name').value    = slot.name   || '';
    document.getElementById('biroly-modal-prompt').value  = slot.prompt || '';

    renderModalGroups(slot.prompt || '', slot);
    modalOverlay.style.display = 'flex';
  }

  function closeModal() {
    if (modalOverlay) modalOverlay.style.display = 'none';
  }

  /* Render editable group boxes in the modal */
  function renderModalGroups(promptText, slot) {
    const container = document.getElementById('biroly-modal-spintax');
    if (!container) return;
    container.innerHTML = '';

    const groups = parseSpintax(promptText);
    if (!groups.length) return;

    const hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:10px;font-weight:bold;color:#444;margin-bottom:6px;border-top:1px solid #808080;padding-top:8px;';
    hdr.textContent = `Группы спинтакса (${groups.length}):`;
    container.appendChild(hdr);

    groups.forEach(({ options }, groupIdx) => {
      const box = document.createElement('div');
      box.className = 'biroly-modal-group-box';
      box.style.cssText = 'border:1px solid #808080;padding:6px 8px;margin-bottom:8px;background:#d4d0c8;';

      // Group header: number + editable name
      const groupHdr = document.createElement('div');
      groupHdr.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';

      const groupNum = document.createElement('span');
      groupNum.style.cssText = 'font-size:10px;font-weight:bold;color:#444;flex-shrink:0;';
      groupNum.textContent = `Группа ${groupIdx + 1}`;

      const nameInp = document.createElement('input');
      nameInp.type = 'text';
      nameInp.className = 'biroly-modal-group-name';
      nameInp.placeholder = `Название группы ${groupIdx + 1}`;
      nameInp.value = (slot.groupNames && slot.groupNames[groupIdx]) || '';
      nameInp.style.cssText = 'flex:1;font-size:10px;padding:1px 4px;';

      groupHdr.appendChild(groupNum);
      groupHdr.appendChild(nameInp);
      box.appendChild(groupHdr);

      // Options list
      const optList = document.createElement('div');
      optList.className = 'biroly-modal-opt-list';
      optList.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin-bottom:5px;';

      options.forEach(opt => appendOptionRow(optList, opt));
      box.appendChild(optList);

      appendNewVarRow(box, optList);

      container.appendChild(box);
    });
  }

  /* Append a single editable option row to optList (• text [✕ delete]) */
  function appendOptionRow(optList, value) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:1px;';

    const bullet = document.createElement('span');
    bullet.textContent = '•';
    bullet.style.cssText = 'font-size:10px;color:#666;flex-shrink:0;';

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'biroly-modal-opt-input';
    inp.value = value;
    inp.style.cssText = 'flex:1;font-size:10px;padding:1px 4px;';

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = 'Удалить вариант';
    delBtn.style.cssText = 'font-size:9px;padding:0 4px;cursor:pointer;color:#a00;flex-shrink:0;border:none;background:transparent;';
    delBtn.addEventListener('click', () => row.remove());

    row.appendChild(bullet);
    row.appendChild(inp);
    row.appendChild(delBtn);
    optList.appendChild(row);
  }

  /* Append new-variant input row at bottom of group: [input] [mode] [ген] [✓] */
  function appendNewVarRow(box, optList) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px dashed #999;margin:5px 0 4px;';
    box.appendChild(sep);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const newInp = document.createElement('input');
    newInp.type = 'text';
    newInp.className = 'biroly-modal-new-opt-input';
    newInp.placeholder = 'Новый вариант…';
    newInp.style.cssText = 'flex:1;font-size:10px;padding:1px 4px;';

    const modeSel = document.createElement('select');
    modeSel.style.cssText = 'font-size:9px;padding:1px 2px;flex-shrink:0;cursor:pointer;';
    modeSel.title = 'Режим генерации';
    [['friend', 'друг'], ['expand', 'шире+вар']].forEach(([val, label]) => {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = label;
      modeSel.appendChild(o);
    });
    modeSel.value = 'friend';

    const genBtn = document.createElement('button');
    genBtn.textContent = 'ген';
    genBtn.title = 'Сгенерировать вариант (пусто → новый по образцу; с текстом → улучшить/расширить)';
    genBtn.style.cssText = 'font-size:9px;padding:1px 6px;cursor:pointer;flex-shrink:0;background:#000080;color:#fff;border:1px solid #000055;';
    genBtn.addEventListener('click', async () => {
      const text = newInp.value.trim();
      const existingVariants = [...optList.querySelectorAll('.biroly-modal-opt-input')]
        .map(i => i.value.trim()).filter(Boolean);

      genBtn.disabled = true;
      genBtn.textContent = '⏳';
      try {
        const r = await fetch('/api/biroly/gen-variant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variant: text || null,
            existingVariants,
            mode: text ? modeSel.value : 'new',
          }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        newInp.value = d.text;
        newInp.focus();
      } catch (e) {
        genBtn.style.background = '#a00';
        setTimeout(() => { genBtn.style.background = '#000080'; }, 2000);
      } finally {
        genBtn.disabled = false;
        if (genBtn.textContent === '⏳') genBtn.textContent = 'ген';
      }
    });

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '✓';
    saveBtn.title = 'Сохранить вариант';
    saveBtn.style.cssText = 'font-size:11px;padding:0 6px;cursor:pointer;flex-shrink:0;background:#006600;color:#fff;border:1px solid #004400;font-weight:bold;line-height:1.4;';
    saveBtn.addEventListener('click', () => {
      const text = newInp.value.trim();
      if (!text) return;
      appendOptionRow(optList, text);
      newInp.value = '';
      newInp.focus();
    });

    // Enter key in new input = save
    newInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
    });

    row.appendChild(newInp);
    row.appendChild(modeSel);
    row.appendChild(genBtn);
    row.appendChild(saveBtn);
    box.appendChild(row);
  }

  function saveFromModal() {
    if (!selectedId || !slots[selectedId]) return;
    const slot = slots[selectedId];

    const newName   = (document.getElementById('biroly-modal-name')?.value || '').trim() || 'Слот';
    const rawPrompt = document.getElementById('biroly-modal-prompt')?.value || '';
    const basePrompt = normalizeSpintax(rawPrompt);

    // Read group names and options from group editor UI
    const container = document.getElementById('biroly-modal-spintax');
    const groupBoxes = container ? [...container.querySelectorAll('.biroly-modal-group-box')] : [];

    const newGroupNames   = groupBoxes.map(box =>
      (box.querySelector('.biroly-modal-group-name')?.value || '').trim()
    );
    const newGroupOptions = groupBoxes.map(box =>
      [...box.querySelectorAll('.biroly-modal-opt-input')]
        .map(i => i.value.trim()).filter(Boolean)
    );

    // Rebuild prompt: replace each {group} in basePrompt with new options
    let gIdx = 0;
    const newPrompt = basePrompt.replace(/\{([^}]+)\}/g, () => {
      const opts = newGroupOptions[gIdx] || [];
      gIdx++;
      return opts.length ? `{${opts.join('|')}}` : '';
    });

    // Update selections: clamp to new option counts, reset if group count changed
    const newGroups = parseSpintax(newPrompt);
    const oldCount  = parseSpintax(slot.prompt || '').length;
    if (newGroups.length !== oldCount) {
      slot.selections = new Array(newGroups.length).fill(0);
    } else {
      slot.selections = newGroups.map((g, i) => {
        const prev = slot.selections?.[i] ?? 0;
        return Math.min(prev, g.options.length - 1);
      });
    }

    slot.name       = newName;
    slot.prompt     = newPrompt;
    slot.groupNames = newGroupNames;

    // Update textarea + title bar
    const ta = document.getElementById('biroly-modal-prompt');
    if (ta) ta.value = newPrompt;
    document.getElementById('biroly-modal-title').textContent = `Редактирование: ${newName}`;

    // Rebuild modal groups with updated data
    renderModalGroups(newPrompt, slot);

    saveState();
    render();
  }

  /* ── Render: left column categories ────────────────────────────── */
  function renderCategories() {
    catListEl.innerHTML = '';
    let _dragSrcIdx = null;

    categories.forEach((cat, catIdx) => {
      const catDiv = document.createElement('div');
      catDiv.className = 'biroly-cat';

      // Drag-over highlight
      catDiv.addEventListener('dragover', e => {
        if (_dragSrcIdx === null || _dragSrcIdx === catIdx) return;
        e.preventDefault();
        catDiv.classList.add('drag-over');
      });
      catDiv.addEventListener('dragleave', () => catDiv.classList.remove('drag-over'));
      catDiv.addEventListener('drop', e => {
        e.preventDefault();
        catDiv.classList.remove('drag-over');
        if (_dragSrcIdx === null || _dragSrcIdx === catIdx) return;
        const moved    = categories.splice(_dragSrcIdx, 1)[0];
        let insertAt   = catIdx;
        if (_dragSrcIdx < catIdx) insertAt--;
        categories.splice(insertAt, 0, moved);
        _dragSrcIdx = null;
        saveState();
        renderCategories();
      });

      const headerDiv = document.createElement('div');
      headerDiv.className = 'biroly-cat-header';

      // Drag handle
      const dragHandle = document.createElement('span');
      dragHandle.className = 'biroly-cat-drag-handle';
      dragHandle.textContent = '⠿';
      dragHandle.title = 'Перетащить для изменения порядка';
      dragHandle.draggable = true;
      dragHandle.addEventListener('dragstart', e => {
        _dragSrcIdx = catIdx;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(catIdx));
        setTimeout(() => catDiv.style.opacity = '0.5', 0);
      });
      dragHandle.addEventListener('dragend', () => {
        catDiv.style.opacity = '';
        _dragSrcIdx = null;
        document.querySelectorAll('.biroly-cat.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
      headerDiv.appendChild(dragHandle);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'biroly-cat-title-text';
      titleSpan.textContent = cat.label;

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'biroly-cat-title-input';
      titleInput.value = cat.label;

      const renameBtn = document.createElement('button');
      renameBtn.className = 'biroly-cat-rename-btn';
      renameBtn.textContent = '✏';
      renameBtn.title = 'Переименовать';

      let renaming = false;
      renameBtn.addEventListener('click', () => {
        renaming = !renaming;
        if (renaming) {
          titleSpan.style.display = 'none';
          titleInput.style.display = 'block';
          titleInput.focus(); titleInput.select();
          renameBtn.textContent = '✔';
        } else {
          cat.label = titleInput.value.trim() || cat.label;
          titleSpan.textContent = cat.label;
          titleInput.style.display = 'none';
          titleSpan.style.display = '';
          renameBtn.textContent = '✏';
          saveState();
        }
      });
      titleInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') renameBtn.click();
        if (e.key === 'Escape') {
          titleInput.value = cat.label;
          renaming = false;
          titleInput.style.display = 'none';
          titleSpan.style.display = '';
          renameBtn.textContent = '✏';
        }
      });

      const delCatBtn = document.createElement('button');
      delCatBtn.className = 'biroly-cat-rename-btn biroly-cat-del-btn';
      delCatBtn.textContent = '✕';
      delCatBtn.title = 'Удалить категорию';
      let delPending = false, delTimer = null;
      delCatBtn.addEventListener('click', () => {
        if (!delPending) {
          delPending = true;
          delCatBtn.textContent = '?';
          delCatBtn.style.cssText = 'background:#ffaaaa;color:#a00;';
          delTimer = setTimeout(() => {
            delPending = false;
            delCatBtn.textContent = '✕';
            delCatBtn.style.cssText = '';
          }, 2500);
          return;
        }
        clearTimeout(delTimer);
        Object.keys(slots).forEach(id => {
          if (slots[id].categoryId === cat.id) delete slots[id];
        });
        if (selectedId && slots[selectedId] === undefined) selectedId = null;
        // Delete category system prompt from Мозги if it has one
        if (cat.systemPromptKey) {
          fetch(`/api/prompts/dynamic/${cat.systemPromptKey}`, { method: 'DELETE' }).catch(() => {});
          promptsLoaded = false;
        }
        categories = categories.filter(c => c.id !== cat.id);
        saveState();
        render();
      });

      headerDiv.appendChild(titleSpan);
      headerDiv.appendChild(titleInput);
      headerDiv.appendChild(renameBtn);
      headerDiv.appendChild(delCatBtn);
      catDiv.appendChild(headerDiv);

      const slotsDiv = document.createElement('div');
      slotsDiv.className = 'biroly-cat-slots';

      Object.values(slots)
        .filter(s => s.categoryId === cat.id)
        .forEach(slot => {
          const card = document.createElement('div');
          card.className = 'biroly-slot-card' + (slot.id === selectedId ? ' selected' : '');
          card.dataset.id = slot.id;

          const emojiSpan = document.createElement('span');
          emojiSpan.className = 'slot-emoji';
          emojiSpan.textContent = slot.emoji;

          const nameSpan = document.createElement('span');
          nameSpan.className = 'slot-name';
          nameSpan.textContent = slot.name || '';

          card.appendChild(emojiSpan);
          card.appendChild(nameSpan);
          card.addEventListener('click', () => selectSlot(slot.id));
          slotsDiv.appendChild(card);
        });

      const addBtn = document.createElement('button');
      addBtn.className = 'biroly-add-btn';
      addBtn.textContent = '+';
      addBtn.title = 'Добавить слот';
      addBtn.addEventListener('click', () => addSlot(cat.id));
      slotsDiv.insertBefore(addBtn, slotsDiv.firstChild);

      catDiv.appendChild(slotsDiv);
      catListEl.appendChild(catDiv);
    });
  }

  /* ── Render: center preview ─────────────────────────────────────── */
  function renderPreview() {
    // While gen is active, center column is managed by setGenUI
    if (_genCount > 0) return;
    setGenUI(null);

    if (!selectedId || !slots[selectedId]) {
      previewEmptyEl.innerHTML = '<span class="preview-emoji">📋</span>Выберите слот';
      previewEmptyEl.style.display = 'flex';
      promptOutputEl.style.display = 'none';
      copyBtn.style.display = '';
      if (realismRowEl) realismRowEl.style.display = 'none';
      return;
    }
    const slot = slots[selectedId];
    const html = buildPreviewHTML(slot);
    if (!html) {
      previewEmptyEl.innerHTML = `<span class="preview-emoji">${slot.emoji || '?'}</span><span style="color:#888;font-size:10px;">Промпт не задан</span>`;
      previewEmptyEl.style.display = 'flex';
      promptOutputEl.style.display = 'none';
      if (realismRowEl) realismRowEl.style.display = 'none';
    } else {
      previewEmptyEl.style.display = 'none';
      if (birolEnhancedPrompt) {
        // Keep showing the enhanced prompt, don't overwrite it
        promptOutputEl.style.display = 'block';
      } else {
        promptOutputEl.style.display = 'block';
        promptOutputEl.innerHTML = html;
      }
      if (realismRowEl) realismRowEl.style.display = 'flex';
    }
  }

  /* ── Render: right column editor (slot header + dropdowns + buttons) */
  function renderEditor() {
    if (!selectedId || !slots[selectedId]) {
      noSelEl.style.display = 'block';
      editorEl.style.display = 'none';
      if (imgvidRow) imgvidRow.style.display = 'none';
      return;
    }
    noSelEl.style.display = 'none';
    editorEl.style.display = 'block';
    if (imgvidRow) imgvidRow.style.display = 'block';

    const slot = slots[selectedId];
    if (slotHeaderEl) {
      slotHeaderEl.textContent = `${slot.emoji || ''} ${slot.name || 'Слот'}`;
    }

    // Category move dropdown
    let moveSel = document.getElementById('biroly-move-cat-sel');
    if (!moveSel) {
      const moveRow = document.createElement('div');
      moveRow.id = 'biroly-move-cat-row';
      moveRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;';
      const moveLabel = document.createElement('label');
      moveLabel.textContent = 'Группа:';
      moveLabel.style.cssText = 'font-size:11px;font-weight:bold;flex-shrink:0;';
      moveSel = document.createElement('select');
      moveSel.id = 'biroly-move-cat-sel';
      moveSel.style.cssText = 'flex:1;font-size:11px;';
      moveSel.addEventListener('change', () => {
        if (!selectedId || !slots[selectedId]) return;
        slots[selectedId].categoryId = moveSel.value;
        saveState();
        renderCategories();
      });
      moveRow.appendChild(moveLabel);
      moveRow.appendChild(moveSel);
      editorEl.insertBefore(moveRow, document.getElementById('biroly-spintax-controls'));
    }
    // Populate options
    moveSel.innerHTML = '';
    categories.forEach(cat => {
      const o = document.createElement('option');
      o.value = cat.id;
      o.textContent = cat.label;
      moveSel.appendChild(o);
    });
    moveSel.value = slot.categoryId || '';

    renderSpintaxDropdowns(slot);
  }

  /* ── Render: spintax dropdowns in right column ──────────────────── */
  function renderSpintaxDropdowns(slot) {
    spintaxContainer.innerHTML = '';
    if (!slot.prompt) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#888;font-size:10px;font-style:italic;margin-bottom:8px;';
      hint.textContent = 'Нажмите «Редактировать» чтобы добавить промпт';
      spintaxContainer.appendChild(hint);
      return;
    }
    const groups = parseSpintax(slot.prompt);
    if (!groups.length) {
      const note = document.createElement('div');
      note.style.cssText = 'color:#888;font-size:10px;font-style:italic;margin-bottom:8px;';
      note.textContent = 'Промпт без спинтакса';
      spintaxContainer.appendChild(note);
      return;
    }

    groups.forEach(({ options }, idx) => {
      const group = document.createElement('div');
      group.className = 'biroly-spintax-group';

      const label = document.createElement('label');
      label.textContent = `Группа ${idx + 1}`;
      group.appendChild(label);

      const sel = document.createElement('select');
      options.forEach((opt, optIdx) => {
        const o = document.createElement('option');
        o.value = String(optIdx);
        o.textContent = opt;
        sel.appendChild(o);
      });
      const curIdx = (slot.selections && slot.selections[idx] != null)
        ? Math.min(slot.selections[idx], options.length - 1) : 0;
      sel.value = String(curIdx);
      sel.addEventListener('change', () => {
        if (!selectedId || !slots[selectedId]) return;
        if (!slots[selectedId].selections) slots[selectedId].selections = [];
        slots[selectedId].selections[idx] = Number(sel.value);
        clearEnhanced();
        saveState();
        renderPreview();
      });

      group.appendChild(sel);
      spintaxContainer.appendChild(group);
    });
  }

  /* ── Full re-render ─────────────────────────────────────────────── */
  function render() {
    renderCategories();
    renderPreview();
    renderEditor();
  }

  /* ── Actions ────────────────────────────────────────────────────── */
  function selectSlot(id) {
    clearEnhanced();
    selectedId = id;
    // Randomize spintax selections on every slot click
    if (slots[id]?.prompt) {
      const groups = parseSpintax(slots[id].prompt);
      slots[id].selections = groups.map(g => Math.floor(Math.random() * g.options.length));
      saveState();
    }
    render();
  }

  function addSlot(categoryId) {
    const id    = uid();
    const emoji = EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
    slots[id]   = { id, categoryId, emoji, name: 'Новый', prompt: '', selections: [] };
    saveState();
    selectedId = id;
    render();
    // Open modal immediately so user can fill in name + prompt
    openModal(id);
  }

  /* ── Events ─────────────────────────────────────────────────────── */

  // Save selections (right column)
  saveBtn?.addEventListener('click', () => {
    if (!selectedId || !slots[selectedId]) return;
    saveState();
    saveBtn.textContent = '✅ Сохранено';
    setTimeout(() => { saveBtn.textContent = '💾 Сохранить'; }, 1200);
  });

  // Open edit modal
  editBtn?.addEventListener('click', () => {
    if (!selectedId) return;
    openModal(selectedId);
  });

  // Delete slot
  deleteBtn?.addEventListener('click', () => {
    if (!selectedId || !slots[selectedId]) return;
    delete slots[selectedId];
    selectedId = null;
    saveState();
    render();
  });

  // Copy prompt (plain text, selected options substituted)
  copyBtn?.addEventListener('click', () => {
    if (!selectedId || !slots[selectedId]) return;
    const text = (promptOutputEl.innerText || '').trim();
    if (!text) return;
    navigator.clipboard.writeText(text).catch(() => {});
    copyBtn.textContent = '✅ Скопировано!';
    setTimeout(() => { copyBtn.textContent = '📋 Копировать'; }, 1500);
  });

  // Add new category — opens creation popup
  addRowBtn?.addEventListener('click', () => openNewCategoryPopup());

  /* ── New category popup with AI system prompt generation ────────────────── */
  function openNewCategoryPopup() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:10500;display:flex;align-items:center;justify-content:center;';

    const popup = document.createElement('div');
    popup.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;padding:10px;width:520px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;overflow:hidden;';

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#000080;color:#fff;padding:3px 8px;margin:-10px -10px 0;flex-shrink:0;';
    const titleTxt = document.createElement('span');
    titleTxt.style.cssText = 'font-size:11px;font-weight:bold;';
    titleTxt.textContent = 'Новая категория слотов';
    const closeX = document.createElement('button');
    closeX.textContent = '✕';
    closeX.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;';
    closeX.addEventListener('click', () => overlay.remove());
    titleBar.appendChild(titleTxt); titleBar.appendChild(closeX);
    popup.appendChild(titleBar);

    // Step 1: inputs
    const step1 = document.createElement('div');
    step1.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex-shrink:0;';

    const mkRow = (labelText, el) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
      const lbl = document.createElement('label');
      lbl.style.cssText = 'font-size:10px;font-weight:bold;';
      lbl.textContent = labelText;
      row.appendChild(lbl); row.appendChild(el);
      return row;
    };

    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = randomCatName();
    nameInp.style.cssText = 'font-size:11px;padding:3px 5px;box-sizing:border-box;width:100%;';
    nameInp.placeholder = 'Название категории';

    const descTa = document.createElement('textarea');
    descTa.rows = 2;
    descTa.style.cssText = 'font-size:10px;padding:3px 5px;resize:vertical;box-sizing:border-box;width:100%;';
    descTa.placeholder = 'Описание — что это за категория, какой тип контента (необязательно)';

    const markersTa = document.createElement('textarea');
    markersTa.rows = 2;
    markersTa.style.cssText = 'font-size:10px;padding:3px 5px;resize:vertical;box-sizing:border-box;width:100%;';
    markersTa.placeholder = 'Маркеры — ключевые слова, которые хочешь видеть в генерациях (необязательно)';

    step1.appendChild(mkRow('Название *', nameInp));
    step1.appendChild(mkRow('Описание категории', descTa));
    step1.appendChild(mkRow('Маркеры / ключевые слова', markersTa));
    popup.appendChild(step1);

    // Analyse button row
    const analyseRow = document.createElement('div');
    analyseRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';
    const analyseBtn = document.createElement('button');
    analyseBtn.textContent = '🤖 Анализ';
    analyseBtn.style.cssText = 'font-size:10px;padding:4px 14px;cursor:pointer;background:#dde8ff;border:1px solid #446;font-weight:bold;';
    const analyseStatus = document.createElement('span');
    analyseStatus.style.cssText = 'font-size:10px;color:#555;flex:1;';
    analyseRow.appendChild(analyseBtn); analyseRow.appendChild(analyseStatus);
    popup.appendChild(analyseRow);

    // Step 2: generated prompt view (hidden until analysis done)
    const step2 = document.createElement('div');
    step2.style.cssText = 'display:none;flex-direction:column;gap:6px;flex:1;min-height:0;';

    const promptLabel = document.createElement('div');
    promptLabel.style.cssText = 'font-size:10px;font-weight:bold;flex-shrink:0;';
    promptLabel.textContent = 'Системный промпт категории:';

    const protectedNote = document.createElement('div');
    protectedNote.style.cssText = 'font-size:9px;color:#004;background:#e8edff;padding:4px 6px;border:1px solid #99b;flex-shrink:0;line-height:1.5;';

    const promptEditor = document.createElement('div');
    promptEditor.contentEditable = 'true';
    promptEditor.spellcheck = false;
    promptEditor.style.cssText = 'flex:1;min-height:120px;overflow-y:auto;background:#fff;border:1px inset #808080;padding:5px;font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-word;font-family:monospace;';

    step2.appendChild(promptLabel);
    step2.appendChild(protectedNote);
    step2.appendChild(promptEditor);
    popup.appendChild(step2);

    // Bottom buttons
    const bottomRow = document.createElement('div');
    bottomRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;margin-top:4px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Отмена';
    cancelBtn.style.cssText = 'font-size:10px;padding:3px 12px;cursor:pointer;';
    cancelBtn.addEventListener('click', () => overlay.remove());
    const createBtn = document.createElement('button');
    createBtn.textContent = '✓ Создать категорию';
    createBtn.disabled = true;
    createBtn.style.cssText = 'font-size:10px;padding:3px 14px;cursor:pointer;background:#c0ffc0;border:1px solid #4a8a4a;font-weight:bold;margin-left:auto;';
    bottomRow.appendChild(cancelBtn); bottomRow.appendChild(createBtn);
    popup.appendChild(bottomRow);

    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    popup.addEventListener('mousedown', e => e.stopPropagation());
    popup.addEventListener('click',     e => e.stopPropagation());
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });
    nameInp.focus();

    // State
    let generatedPrompt = '';
    let protectedPhrases = [];

    function renderPromptWithHighlights(text, phrases) {
      promptEditor.innerHTML = '';
      if (!phrases.length) { promptEditor.textContent = text; return; }
      const escaped = phrases.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const re = new RegExp(`(${escaped.join('|')})`, 'g');
      const parts = text.split(re);
      for (const part of parts) {
        if (phrases.includes(part)) {
          const b = document.createElement('b');
          b.style.cssText = 'color:#000080;background:#e0e8ff;border-radius:2px;padding:0 1px;';
          b.textContent = part;
          promptEditor.appendChild(b);
        } else {
          promptEditor.appendChild(document.createTextNode(part));
        }
      }
    }

    analyseBtn.addEventListener('click', async () => {
      const name = nameInp.value.trim();
      if (!name) { analyseStatus.textContent = '⚠ Введите название'; return; }
      analyseBtn.disabled = true;
      analyseStatus.textContent = '⏳ Генерируем промпт…';
      step2.style.display = 'none';
      createBtn.disabled = true;
      try {
        const r = await fetch('/api/biroly/generate-category-prompt', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description: descTa.value.trim(), markers: markersTa.value.trim() }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        generatedPrompt = d.systemPrompt;
        protectedPhrases = d.protectedPhrases || [];
        renderPromptWithHighlights(generatedPrompt, protectedPhrases);
        protectedNote.innerHTML = '🔒 <b>Выделенные синим части менять не рекомендуется</b> — они необходимы для корректной работы парсера. Остальное можно редактировать.';
        step2.style.display = 'flex';
        createBtn.disabled = false;
        analyseStatus.textContent = '✓ Промпт готов — проверьте и нажмите «Создать»';
        analyseStatus.style.color = '#007700';
      } catch (err) {
        analyseStatus.textContent = '⚠ ' + err.message;
        analyseStatus.style.color = '#aa0000';
      } finally {
        analyseBtn.disabled = false;
      }
    });

    createBtn.addEventListener('click', async () => {
      const name = nameInp.value.trim() || 'Категория';
      const finalPrompt = promptEditor.innerText.trim() || generatedPrompt;
      if (!finalPrompt) return;
      createBtn.disabled = true;
      const catId = uid();
      const promptKey = 'biroly_cat_' + catId;
      try {
        // Save system prompt to Мозги (server)
        await fetch('/api/prompts/dynamic/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: promptKey, text: finalPrompt, label: 'Бирол: ' + name, fixedPhrases: protectedPhrases }),
        });
      } catch (e) {
        console.warn('[biroly] Не удалось сохранить промпт категории в Мозги:', e.message);
      }
      categories.push({ id: catId, label: name, systemPromptKey: promptKey });
      saveState();
      render();
      overlay.remove();
      // Invalidate promptsData cache so Мозги reloads fresh data
      promptsLoaded = false;
    });
  }

  /* ── Init ───────────────────────────────────────────────────────── */
  loadState();
  render();
  setTimeout(() => { resumePendingBirolyGens(); recoverOrphanBirolys?.(); }, 500);

})();
