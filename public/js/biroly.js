/* ═══════════════════════════════════════════════════════════════════
   БИРОЛЫ TAB — prompt builder, 3-column Win95 layout.
   Each slot is an independent scene editor with its own state.
   Categories are user-editable (rename, add new, delete).
   Custom scenes can be added/removed from the scene dropdown.
   State persisted in localStorage.
   ═══════════════════════════════════════════════════════════════════ */

(function () {

  /* ── Spintax dictionary ─────────────────────────────────────────── */
  const DICT = {
    pillowFight: {
      shotType:          ["Cinematic b-roll", "High-end lifestyle footage", "Artistic film shot"],
      angle:             ["high-angle", "elevated", "slightly overhead"],
      bedroomAtmosphere: ["cozy, sun-drenched", "bright, airy", "warm, rustic"],
      manHair:           ["salt-and-pepper hair", "distinguished silver hair", "short grey hair"],
      clothing:          ["light cotton loungewear", "relaxed linen pajamas", "soft oversized home clothes"],
      fightCharacter:    ["playful", "joyous", "dynamic", "spirited"],
      bedState:          ["large unmade", "messy", "textured king-size"],
      lightSource:       ["Golden sunlight", "Warm morning light", "Soft amber glow"],
      lightAction:       ["illuminating", "highlighting", "catching"],
      particles:         ["swirling dust motes and tiny feathers", "a cloud of white down and floating particles", "ethereal dust motes and drifting lint"],
      faces:             ["lit with genuine laughter", "beaming with pure joy", "captured in mid-laugh", "full of vibrant energy"],
      depthOfField:      ["shallow depth of field", "creamy bokeh effect", "dreamy background blur"],
      cameraMovement:    ["Slow panning movement around the bed", "Smooth 360-degree cinematic orbit", "Hypnotic circular camera tracking"]
    },
    oyster: {
      motion:      ["Extreme macro dolly-in video", "Ultra-close-up slow-motion macro pan", "Extreme macro rack-focus shot"],
      description: ["elongated, oval-shaped fresh oyster", "distinctively oval raw oyster", "slender, oval-form oyster"],
      dish:        ["an opulent crystal dish featuring a gold edge", "a luxury crystal bowl with a gilt rim"],
      drop:        ["translucent server", "effervescent, tart drop", "perfect, golden-yellow server"],
      texture:     ["delicate, wet oyster mantle", "glossy, moist center", "pearlescent meat"],
      reaction:    ["The oyster shows a subtle, realistic contraction reacting to the acidity", "A visible, instinctive flinch ripples through the mantle"],
      lighting:    ["Soft, diffused professional studio lighting emphasizes the slimy textures", "High-key luxury lighting highlights the glistening moisture"]
    },
    shock: {
      appearance: ["blonde girl with startled sapphire eyes", "sun-kissed redhead with wide amber eyes", "brunette woman with piercing emerald eyes"],
      emotion:    ["visibly starstruck and breathless", "absolutely thunderstruck with awe", "purely and radiantly surprised"],
      location:   ["warm rustic kitchen filled with flour dust", "cozy sun-drenched farmhouse porch", "quiet wooden cabin lit by a fireplace"],
      background: ["soft-focus background of wildflowers and sunbeams", "blurred rustic interior with wooden beams"],
      lighting:   ["Golden hour sunlight streaming through a window", "Soft, diffused morning light creating a gentle glow"]
    },
    stage18: {
      style:       ["Hand-held smartphone video quality, slightly grainy and shaky footage", "Raw lo-fi mobile footage with subtle motion blur and natural jitter"],
      womanOutfit: ["young woman in a dainty lace-trimmed linen camisole and micro-shorts", "girl wearing a minimalist cream-colored cotton bralette and thin sleep shorts"],
      manOutfit:   ["man in loose grey sweatpants and a plain white t-shirt", "guy wearing dark cotton lounge pants and no shirt"],
      environment: ["heavy lighting equipment, c-stands, and thick black cables", "boom mics, scattered scripts, and half-empty water bottles"],
      crewAction:  ["A bored sound operator is adjusting a boom mic in the background", "A makeup artist is quickly touching up the man's face"]
    }
  };

  /* ── RU labels ──────────────────────────────────────────────────── */
  const LABELS = {
    shotType: "Тип съёмки", angle: "Ракурс", bedroomAtmosphere: "Атмосфера спальни",
    manHair: "Волосы мужчины", clothing: "Одежда", fightCharacter: "Характер боя",
    bedState: "Состояние кровати", lightSource: "Источник света", lightAction: "Действие света",
    particles: "Частицы в воздухе", faces: "Выражение лиц", depthOfField: "Глубина резкости",
    cameraMovement: "Движение камеры", motion: "Движение / тип съёмки", description: "Описание",
    dish: "Посуда", drop: "Капля", texture: "Текстура", reaction: "Реакция", lighting: "Освещение",
    appearance: "Внешность", emotion: "Эмоция", location: "Локация", background: "Задний план",
    style: "Стиль съёмки", womanOutfit: "Наряд женщины", manOutfit: "Наряд мужчины",
    environment: "Окружение", crewAction: "Действие персонала"
  };

  /* ── Prompt templates ───────────────────────────────────────────── */
  const TEMPLATES = {
    pillowFight: p =>
      `${p.shotType}, ${p.angle} shot in a ${p.bedroomAtmosphere} bedroom. A 55-year-old man with ${p.manHair} and a 25-year-old woman, both in ${p.clothing}, are having a ${p.fightCharacter} pillow fight on a ${p.bedState} bed. ${p.lightSource} streams through the window, ${p.lightAction} ${p.particles} in the air. Their faces are ${p.faces}. Slow-motion, ${p.depthOfField}, warm color palette, soft focus on the background. Camera (Constant): ${p.cameraMovement}, 4k, professional lighting.`,
    oyster: p =>
      `${p.motion} of a premium, ${p.description} presented on ${p.dish}. A single, ${p.drop} of lemon juice is captured at the precise moment of impact on the ${p.texture}. ${p.reaction}. ${p.lighting}. High-speed photography, frozen motion, 8k resolution, ultra-detailed, commercial food styling, shot on Phase One, 100mm macro lens, f/2.8, shallow depth of field, sharp focus.`,
    shock: p =>
      `A candid, close-up video capturing a shocked ${p.appearance}. She is completely ${p.emotion}, her expression conveying intense shock. Both of her hands are pressed against her cheeks in a classic "Oh my God" gesture. Her mouth is dramatically open in a gasp of surprise, but she is smiling widely, combining shock with joy or amusement. Initially looking upwards, she then fast and deliberately shifts her wide-open eyes downward to look directly at the floor, tracking something moving from top to bottom off-camera with her intense gaze. Her hair is casually styled. The scene is set in a ${p.location}, with a ${p.background} (bokeh). ${p.lighting}. Shot in 4K resolution, cinematic quality, slow-motion (24fps) capturing every detail of her reaction. High detail, sharp focus on her eyes and expression. Minimal camera movement.`,
    stage18: p =>
      `${p.style} capturing a bustling film set. In the center, on a constructed bedroom set, a ${p.womanOutfit} and a ${p.manOutfit} are sitting casually on the bed, talking and waiting between takes. Around them, ${p.environment} are clearly visible. ${p.crewAction}. Natural studio lighting, casual atmosphere, raw 'behind-the-scenes' look, 16:9 vertical format.`
  };

  /* ── Built-in scenes list ───────────────────────────────────────── */
  const BUILTIN_SCENES = [
    { id: 'pillowFight', label: 'Драка подушками' },
    { id: 'oyster',      label: 'Устрица (Макро)' },
    { id: 'shock',       label: 'Шок / Восторг' },
    { id: 'stage18',     label: 'Стейдж 18+' },
  ];

  /* ── Default categories ─────────────────────────────────────────── */
  const DEFAULT_CATS = [
    { id: 'hooks',   label: 'Hooks' },
    { id: 'science', label: 'Science' },
    { id: 'hands',   label: 'Hands' },
    { id: 'faces',   label: 'Faces' },
  ];

  /* ── Random name pool for new categories ───────────────────────── */
  const ADJ  = ['Алый','Синий','Золотой','Зелёный','Серебряный','Пурпурный','Янтарный','Белый','Тёмный','Яркий','Дикий','Быстрый','Ленивый','Смелый','Тихий','Огненный','Ледяной','Бурный','Светлый','Мрачный'];
  const ANIM = ['Тигр','Лиса','Волк','Медведь','Орёл','Дельфин','Пантера','Енот','Сова','Лось','Рысь','Ягуар','Журавль','Кот','Лев','Краб','Акула','Конь','Змея','Олень'];
  function randomCatName() {
    return ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + ANIM[Math.floor(Math.random() * ANIM.length)];
  }

  /* ── Emoji pool for new slots ───────────────────────────────────── */
  const EMOJI_POOL = ['🎬','🎥','🌟','🎭','🎪','🎨','💡','🔥','⚡','🌊','🦋','🎯','💎','🌙','🎵','🍀','🦊','🐙','🌈','🎲'];

  /* ── State ──────────────────────────────────────────────────────── */
  let slots        = {};   // { [id]: { id, categoryId, emoji, name, activeScene, params, customPrompt } }
  let categories   = [];   // [{ id, label }]
  let customScenes = [];   // [{ id, label }]
  let hiddenScenes = [];   // ['pillowFight', ...] — hidden built-in scene ids
  let selectedId   = null;
  let _promptDirty = false; // true = user edited the preview manually

  const LS_SLOTS   = 'biroly_slots';
  const LS_CATS    = 'biroly_cats';
  const LS_CSCENES = 'biroly_custom_scenes';
  const LS_HSCENES = 'biroly_hidden_scenes';

  function loadState() {
    try {
      const rs  = localStorage.getItem(LS_SLOTS);
      const rc  = localStorage.getItem(LS_CATS);
      const rcs = localStorage.getItem(LS_CSCENES);
      const rhs = localStorage.getItem(LS_HSCENES);
      if (rs) slots = JSON.parse(rs);
      categories   = rc  ? JSON.parse(rc)  : [...DEFAULT_CATS];
      customScenes = rcs ? JSON.parse(rcs) : [];
      hiddenScenes = rhs ? JSON.parse(rhs) : [];
      if (!categories.length) categories = [...DEFAULT_CATS];
    } catch {
      slots = {}; categories = [...DEFAULT_CATS]; customScenes = []; hiddenScenes = [];
    }
  }

  function saveState() {
    try {
      localStorage.setItem(LS_SLOTS,   JSON.stringify(slots));
      localStorage.setItem(LS_CATS,    JSON.stringify(categories));
      localStorage.setItem(LS_CSCENES, JSON.stringify(customScenes));
      localStorage.setItem(LS_HSCENES, JSON.stringify(hiddenScenes));
    } catch {}
  }

  /* ── Helpers ────────────────────────────────────────────────────── */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function defaultParams(scene) {
    if (!DICT[scene]) return {};
    const p = {};
    for (const k in DICT[scene]) p[k] = DICT[scene][k][0];
    return p;
  }

  /* Returns HTML prompt with substituted values wrapped in <strong> */
  function buildPromptHTML(slot) {
    if (!slot.activeScene) return null;
    if (TEMPLATES[slot.activeScene]) {
      const boldParams = new Proxy(slot.params || {}, {
        get(target, key) {
          if (typeof key !== 'string') return target[key];
          const v = String(target[key] || '');
          const safe = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<strong>${safe}</strong>`;
        }
      });
      return TEMPLATES[slot.activeScene](boldParams);
    }
    // Custom scene: show stored prompt (escaped)
    const cp = slot.customPrompt || '';
    return cp ? cp.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : null;
  }

  /* All visible scenes (built-in non-hidden + custom) */
  function visibleScenes() {
    return [
      ...BUILTIN_SCENES.filter(s => !hiddenScenes.includes(s.id)),
      ...customScenes,
    ];
  }

  /* ── DOM refs ───────────────────────────────────────────────────── */
  const catListEl        = document.getElementById('biroly-category-list');
  const addRowBtn        = document.getElementById('biroly-add-row-btn');
  const previewEmptyEl   = document.getElementById('biroly-preview-empty');
  const promptOutputEl   = document.getElementById('biroly-prompt-output');
  const copyBtn          = document.getElementById('biroly-copy-btn');
  const noSelEl          = document.getElementById('biroly-no-sel');
  const editorEl         = document.getElementById('biroly-editor');
  const nameInput        = document.getElementById('biroly-name-input');
  const sceneSelect      = document.getElementById('biroly-scene-select');
  const spintaxContainer = document.getElementById('biroly-spintax-controls');
  const saveBtn          = document.getElementById('biroly-save-btn');
  const deleteBtn        = document.getElementById('biroly-delete-btn');
  const addSceneBtn      = document.getElementById('biroly-add-scene-btn');
  const delSceneBtn      = document.getElementById('biroly-del-scene-btn');

  /* ── Render: scene select options ──────────────────────────────── */
  function renderSceneSelect(currentScene) {
    sceneSelect.innerHTML = '<option value="">— без сцены —</option>';
    visibleScenes().forEach(s => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.label;
      sceneSelect.appendChild(o);
    });
    sceneSelect.value = currentScene || '';
  }

  /* ── Render: left column categories ────────────────────────────── */
  function renderCategories() {
    catListEl.innerHTML = '';

    categories.forEach(cat => {
      const catDiv = document.createElement('div');
      catDiv.className = 'biroly-cat';

      /* category header */
      const headerDiv = document.createElement('div');
      headerDiv.className = 'biroly-cat-header';

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
          titleInput.focus();
          titleInput.select();
          renameBtn.textContent = '✔';
        } else {
          const newLabel = titleInput.value.trim() || cat.label;
          cat.label = newLabel;
          titleSpan.textContent = newLabel;
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

      /* delete category button */
      const delCatBtn = document.createElement('button');
      delCatBtn.className = 'biroly-cat-rename-btn biroly-cat-del-btn';
      delCatBtn.textContent = '✕';
      delCatBtn.title = 'Удалить категорию';
      delCatBtn.addEventListener('click', () => {
        if (!confirm(`Удалить категорию «${cat.label}»?`)) return;
        Object.keys(slots).forEach(id => {
          if (slots[id].categoryId === cat.id) delete slots[id];
        });
        if (selectedId && slots[selectedId] === undefined) selectedId = null;
        categories = categories.filter(c => c.id !== cat.id);
        saveState();
        render();
      });

      headerDiv.appendChild(titleSpan);
      headerDiv.appendChild(titleInput);
      headerDiv.appendChild(renameBtn);
      headerDiv.appendChild(delCatBtn);
      catDiv.appendChild(headerDiv);

      /* slot cards */
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
      slotsDiv.appendChild(addBtn);

      catDiv.appendChild(slotsDiv);
      catListEl.appendChild(catDiv);
    });
  }

  /* ── Render: center preview ─────────────────────────────────────── */
  function renderPreview() {
    if (!selectedId || !slots[selectedId]) {
      previewEmptyEl.innerHTML = '<span class="preview-emoji">📋</span>Выберите слот';
      previewEmptyEl.style.display = 'flex';
      promptOutputEl.style.display = 'none';
      return;
    }
    const slot = slots[selectedId];
    const html = buildPromptHTML(slot);
    if (!html) {
      const isCustomScene = slot.activeScene && !TEMPLATES[slot.activeScene];
      if (isCustomScene) {
        // Custom scene with empty prompt — show editable area with hint
        previewEmptyEl.style.display = 'none';
        promptOutputEl.style.display = 'block';
        if (!_promptDirty) {
          promptOutputEl.innerHTML = '<span style="color:#555;font-style:italic;">Введите промпт вручную…</span>';
        }
      } else {
        previewEmptyEl.innerHTML = `<span class="preview-emoji">${slot.emoji || '?'}</span><span style="color:#888;font-size:10px;">Сцена не выбрана</span>`;
        previewEmptyEl.style.display = 'flex';
        promptOutputEl.style.display = 'none';
      }
    } else {
      previewEmptyEl.style.display = 'none';
      promptOutputEl.style.display = 'block';
      if (!_promptDirty) {
        promptOutputEl.innerHTML = html;
      }
    }
  }

  /* ── Render: right editor ───────────────────────────────────────── */
  function renderEditor() {
    if (!selectedId || !slots[selectedId]) {
      noSelEl.style.display = 'block';
      editorEl.style.display = 'none';
      return;
    }
    noSelEl.style.display = 'none';
    editorEl.style.display = 'block';

    const slot = slots[selectedId];
    nameInput.value = slot.name || '';
    renderSceneSelect(slot.activeScene);
    renderSpintax(slot.activeScene, slot.params);
  }

  /* ── Render: spintax dropdowns ──────────────────────────────────── */
  function renderSpintax(scene, params) {
    spintaxContainer.innerHTML = '';
    if (!scene || !DICT[scene]) return;
    for (const key in DICT[scene]) {
      const group = document.createElement('div');
      group.className = 'biroly-spintax-group';

      const label = document.createElement('label');
      label.textContent = LABELS[key] || key;
      group.appendChild(label);

      const sel = document.createElement('select');
      DICT[scene][key].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        sel.appendChild(o);
      });
      sel.value = (params && params[key]) ? params[key] : DICT[scene][key][0];
      sel.addEventListener('change', () => {
        if (!selectedId || !slots[selectedId]) return;
        if (!slots[selectedId].params) slots[selectedId].params = {};
        slots[selectedId].params[key] = sel.value;
        _promptDirty = false; // always re-render when params change
        renderPreview();
      });
      group.appendChild(sel);
      spintaxContainer.appendChild(group);
    }
  }

  /* ── Full re-render ─────────────────────────────────────────────── */
  function render() {
    renderCategories();
    renderPreview();
    renderEditor();
  }

  /* ── Actions ────────────────────────────────────────────────────── */
  function selectSlot(id) {
    selectedId = id;
    _promptDirty = false;
    render();
  }

  function addSlot(categoryId) {
    const id    = uid();
    const emoji = EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
    slots[id]   = { id, categoryId, emoji, name: 'Новый', activeScene: '', params: {}, customPrompt: '' };
    saveState();
    selectedId   = id;
    _promptDirty = false;
    render();
  }

  /* ── Events ─────────────────────────────────────────────────────── */

  // Scene change
  sceneSelect?.addEventListener('change', () => {
    if (!selectedId || !slots[selectedId]) return;
    const scene = sceneSelect.value;
    slots[selectedId].activeScene = scene;
    if (DICT[scene]) slots[selectedId].params = defaultParams(scene);
    _promptDirty = false;
    renderSpintax(scene, slots[selectedId].params);
    renderPreview();
  });

  // Save slot name (+ custom prompt if applicable)
  saveBtn?.addEventListener('click', () => {
    if (!selectedId || !slots[selectedId]) return;
    slots[selectedId].name = nameInput.value.trim() || 'Слот';
    // For custom scenes (no built-in template) save whatever is in the preview
    if (slots[selectedId].activeScene && !TEMPLATES[slots[selectedId].activeScene]) {
      const txt = promptOutputEl.innerText || '';
      slots[selectedId].customPrompt = txt.replace(/Введите промпт вручную…/g, '').trim();
    }
    saveState();
    render();
  });

  // Delete slot
  deleteBtn?.addEventListener('click', () => {
    if (!selectedId || !slots[selectedId]) return;
    delete slots[selectedId];
    selectedId = null;
    saveState();
    render();
  });

  // Copy prompt — reads innerText (strips any HTML bold tags)
  copyBtn?.addEventListener('click', () => {
    if (!selectedId || !slots[selectedId]) return;
    const text = (promptOutputEl.innerText || '').trim();
    if (!text || text === 'Введите промпт вручную…') return;
    navigator.clipboard.writeText(text).catch(() => {});
    copyBtn.textContent = '✅ Скопировано!';
    setTimeout(() => { copyBtn.textContent = '📋 Копировать'; }, 1500);
  });

  // Track manual edits in the preview
  promptOutputEl?.addEventListener('input', () => {
    _promptDirty = true;
  });

  // Add new category row
  addRowBtn?.addEventListener('click', () => {
    const id = uid();
    categories.push({ id, label: randomCatName() });
    saveState();
    render();
  });

  // Add new scene to dropdown
  addSceneBtn?.addEventListener('click', () => {
    const label = prompt('Название новой сцены:');
    if (!label || !label.trim()) return;
    const id = 'cscene_' + uid();
    customScenes.push({ id, label: label.trim() });
    saveState();
    if (selectedId && slots[selectedId]) renderSceneSelect(slots[selectedId].activeScene);
  });

  // Delete the currently selected scene from dropdown
  delSceneBtn?.addEventListener('click', () => {
    const sceneId = sceneSelect?.value;
    if (!sceneId) return;
    const sceneName = sceneSelect.options[sceneSelect.selectedIndex]?.text || sceneId;
    if (!confirm(`Удалить сцену «${sceneName}»?`)) return;

    if (customScenes.find(s => s.id === sceneId)) {
      customScenes = customScenes.filter(s => s.id !== sceneId);
    } else {
      if (!hiddenScenes.includes(sceneId)) hiddenScenes.push(sceneId);
    }

    // Reset any slots using the deleted scene
    Object.values(slots).forEach(slot => {
      if (slot.activeScene === sceneId) { slot.activeScene = ''; slot.params = {}; }
    });

    saveState();
    _promptDirty = false;
    if (selectedId && slots[selectedId]) {
      renderSceneSelect(slots[selectedId].activeScene);
      renderSpintax(slots[selectedId].activeScene, slots[selectedId].params);
      renderPreview();
    }
  });

  /* ── Init ───────────────────────────────────────────────────────── */
  loadState();
  render();

})();
