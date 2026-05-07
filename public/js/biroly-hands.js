/* biroly-hands.js
   Hands biroll builder — kitchen-only for now (scene dropdown has bathroom/desk/gym disabled).
   Flow: scene → angle (locked once chosen) → action (varies) → ingredients → realism markers → engine → generate.
   Talks to /api/biroly/hands-generate; polls the chosen engine's status endpoint.
*/
(function () {
  'use strict';

  const STORAGE = {
    angle: 'bh_angle_locked',
    realism: 'bh_realism_state',
    engine: 'bh_engine',
    scene: 'bh_scene',
    history: 'bh_history',
  };

  // ── Per-scene catalogs (only kitchen wired now) ─────────────────────────────
  const SCENE_CATALOG = {
    kitchen: {
      ingredients: [
        'tomato', 'onion', 'garlic', 'fresh herbs', 'eggs', 'flour',
        'butter', 'olive oil', 'cheese', 'meat', 'fish', 'pasta',
        'bread', 'mushrooms', 'lemon', 'milk', 'sugar', 'salt',
        'pepper', 'lettuce', 'cucumber', 'carrot', 'potato', 'rice',
      ],
      angleDesc: {
        'topdown':            'overhead camera mounted on a tripod, looking straight down at the countertop',
        'fpv':                'first-person POV, eye-level, hands extending forward into the scene',
        'side':               'side view at counter level, hands working horizontally across the frame',
        'macro':              'extreme macro close-up, shallow depth of field, hands and ingredient filling the frame',
        'from-fridge':        'camera placed inside an open fridge, looking outward as the hand reaches in',
        'from-cabinet':       'camera tucked inside an open cabinet/shelf, the hand reaches in toward the camera',
        'over-shoulder':      'over-the-shoulder angle behind the cook, blurred shoulder/back in foreground, hands sharp on the counter',
        'low-under-counter':  'low angle from beneath the counter looking upward at the hands',
        'stovetop-overhead':  'overhead view directly above the stovetop and pan, hands working from above',
      },
      // Cooking-specific realism markers — narrow, scene-relevant set
      realismDefault: [
        { id: 'surface-texture', label: 'detailed countertop / cutting-board texture', on: true },
        { id: 'crumbs-debris',   label: 'visible crumbs and small debris on surface', on: true },
        { id: 'steam',           label: 'detailed wispy steam rising from hot food', on: true },
        { id: 'oil-shimmer',     label: 'oil shimmer / shiny servers', on: true },
        { id: 'pollen-dust',     label: 'fine pollen / flour dust during sprinkling', on: true },
        { id: 'knife-shine',     label: 'subtle knife-blade reflection', on: true },
        { id: 'finger-detail',   label: 'realistic hand anatomy, visible knuckles, micro-skin texture', on: true },
        { id: 'natural-light',   label: 'soft natural window light, warm tone', on: true },
        { id: 'shallow-dof',     label: 'shallow depth of field, soft background falloff', on: true },
        { id: 'handheld-feel',   label: 'subtle handheld camera feel', on: false },
        { id: 'water-drops',     label: 'water servers / splash detail', on: false },
        { id: 'sizzle-sear',     label: 'sizzle / sear marks visible on food', on: false },
      ],
    },
  };

  // ── Action labels for prompt rendering ──────────────────────────────────────
  const ACTION_PHRASE = {
    'cutting':     'cutting / chopping {INGREDIENTS} on a wooden cutting board',
    'slicing':     'slicing {INGREDIENTS} into thin even pieces',
    'dicing':      'dicing {INGREDIENTS} into small cubes',
    'mixing':      'mixing / stirring {INGREDIENTS} in a bowl with a wooden spoon',
    'whisking':    'whisking {INGREDIENTS} into a smooth blend',
    'pouring':     'pouring {INGREDIENTS} from a container into a bowl/pan',
    'sprinkling':  'sprinkling {INGREDIENTS} over the dish',
    'kneading':    'kneading dough on a floured surface',
    'cracking':    'cracking eggs into a bowl',
    'peeling':     'peeling {INGREDIENTS} with a peeler',
    'grating':     'grating {INGREDIENTS} over a plate',
    'tossing':     'tossing {INGREDIENTS} in a hot pan',
    'plating':     'plating / arranging {INGREDIENTS} on a plate',
    'opening':     'opening a glass jar / package',
    'reaching':    'reaching for {INGREDIENTS}',
    'washing':     'washing {INGREDIENTS} under running tap water',
    'frying-flip': 'flipping {INGREDIENTS} in a sizzling frying pan',
  };

  // ── State ───────────────────────────────────────────────────────────────────
  const state = {
    scene: 'kitchen',
    angle: '',           // locked once chosen
    angleLocked: false,
    action: 'cutting',
    ingredients: new Set(),
    customIngredients: '',
    extra: '',
    realism: [],         // [{id,label,on}]
    engine: 'grok',
    history: [],         // [{ts, prompt, videoPath, action, angle, scene}]
  };

  // ── DOM helpers ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ── Init / mount ────────────────────────────────────────────────────────────
  let _booted = false;
  function ensureBoot() {
    if (_booted) return;
    _booted = true;

    // Restore from storage
    state.scene  = localStorage.getItem(STORAGE.scene)  || 'kitchen';
    state.angle  = localStorage.getItem(STORAGE.angle)  || '';
    state.angleLocked = !!state.angle;
    state.engine = localStorage.getItem(STORAGE.engine) || 'grok';

    try {
      const r = JSON.parse(localStorage.getItem(STORAGE.realism) || '[]');
      if (Array.isArray(r) && r.length) state.realism = r;
    } catch {}
    if (!state.realism.length) {
      state.realism = SCENE_CATALOG[state.scene].realismDefault.map(m => ({ ...m }));
    }

    try {
      const h = JSON.parse(localStorage.getItem(STORAGE.history) || '[]');
      if (Array.isArray(h)) state.history = h;
    } catch {}

    // Wire scene/angle/action/engine
    $('bh-scene').value = state.scene;
    if (state.angle) $('bh-angle').value = state.angle;
    $('bh-engine').value = state.engine;

    $('bh-scene').addEventListener('change', e => {
      state.scene = e.target.value;
      localStorage.setItem(STORAGE.scene, state.scene);
      renderIngredients();
      renderRealism();
      updatePromptPreview();
    });

    $('bh-angle').addEventListener('change', e => {
      if (state.angleLocked) {
        e.target.value = state.angle;
        $('bh-status').textContent = 'Angle is locked for this session — click 🔓 Unlock angle to change.';
        return;
      }
      state.angle = e.target.value;
      lockAngle();
      updatePromptPreview();
    });

    $('bh-reset-angle-btn').addEventListener('click', () => {
      state.angleLocked = false;
      state.angle = '';
      localStorage.removeItem(STORAGE.angle);
      $('bh-angle-locked-hint').style.display = 'none';
      $('bh-status').textContent = 'Angle unlocked — pick a new one.';
    });

    $('bh-action').addEventListener('change', e => {
      state.action = e.target.value;
      updatePromptPreview();
    });

    $('bh-engine').addEventListener('change', e => {
      state.engine = e.target.value;
      localStorage.setItem(STORAGE.engine, state.engine);
    });

    $('bh-ingredient-custom').addEventListener('input', e => {
      state.customIngredients = e.target.value;
      updatePromptPreview();
    });

    $('bh-extra').addEventListener('input', e => {
      state.extra = e.target.value;
      updatePromptPreview();
    });

    $('bh-generate-btn').addEventListener('click', onGenerate);

    // Initial UI
    if (state.angleLocked) {
      $('bh-angle-locked-hint').style.display = 'inline';
    }
    renderIngredients();
    renderRealism();
    renderHistory();
    updatePromptPreview();
  }

  function lockAngle() {
    state.angleLocked = true;
    localStorage.setItem(STORAGE.angle, state.angle);
    $('bh-angle-locked-hint').style.display = 'inline';
  }

  // ── Ingredients chips ───────────────────────────────────────────────────────
  function renderIngredients() {
    const wrap = $('bh-ingredients');
    wrap.innerHTML = '';
    const list = SCENE_CATALOG[state.scene]?.ingredients || [];
    list.forEach(ing => {
      const chip = document.createElement('div');
      chip.className = 'bh-chip' + (state.ingredients.has(ing) ? ' on' : '');
      chip.textContent = ing;
      chip.addEventListener('click', () => {
        if (state.ingredients.has(ing)) state.ingredients.delete(ing);
        else state.ingredients.add(ing);
        chip.classList.toggle('on');
        updatePromptPreview();
      });
      wrap.appendChild(chip);
    });
  }

  // ── Realism markers (toggle-strikethrough like Brains) ──────────────────────
  function renderRealism() {
    const wrap = $('bh-realism');
    wrap.innerHTML = '';
    state.realism.forEach((m, idx) => {
      const el = document.createElement('div');
      el.className = 'bh-marker' + (m.on ? '' : ' off');
      el.textContent = m.label;
      el.title = 'Click to toggle';
      el.addEventListener('click', () => {
        state.realism[idx].on = !state.realism[idx].on;
        el.classList.toggle('off');
        localStorage.setItem(STORAGE.realism, JSON.stringify(state.realism));
        updatePromptPreview();
      });
      wrap.appendChild(el);
    });
  }

  // ── Build prompt ────────────────────────────────────────────────────────────
  function getIngredientList() {
    const picked = Array.from(state.ingredients);
    const custom = (state.customIngredients || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    return [...picked, ...custom];
  }

  function getIngredientPhrase(actionTpl, list) {
    if (!actionTpl.includes('{INGREDIENTS}')) return actionTpl;
    if (!list.length) return actionTpl.replace(/\s*\{INGREDIENTS\}/g, '');
    const words = list.length === 1
      ? list[0]
      : list.length === 2
        ? `${list[0]} and ${list[1]}`
        : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    return actionTpl.replace(/\{INGREDIENTS\}/g, words);
  }

  function buildPrompt() {
    const sceneCat = SCENE_CATALOG[state.scene] || SCENE_CATALOG.kitchen;
    const angleId = state.angle || $('bh-angle').value || 'topdown';
    const angleDesc = sceneCat.angleDesc[angleId] || angleId;
    const actionTpl = ACTION_PHRASE[state.action] || state.action;
    const ingredients = getIngredientList();
    const actionPhrase = getIngredientPhrase(actionTpl, ingredients);
    const realismOn = state.realism.filter(m => m.on).map(m => m.label);
    const realismLine = realismOn.length
      ? `Realism markers: ${realismOn.join('; ')}.`
      : '';
    const extraLine = (state.extra || '').trim()
      ? `Extra detail: ${state.extra.trim()}.`
      : '';

    return [
      `Cinematic vertical 9:16 video, ${state.scene} setting, 5 seconds.`,
      `Camera: ${angleDesc}.`,
      `Hands-only shot — character is barely visible / out of frame; focus is on the hands and the product.`,
      `Action: ${actionPhrase}.`,
      extraLine,
      realismLine,
      `No faces. No body shots. Natural lighting, photorealistic textures.`,
    ].filter(Boolean).join(' ');
  }

  function updatePromptPreview() {
    $('bh-prompt-preview').textContent = buildPrompt();
  }

  // ── Generate flow ───────────────────────────────────────────────────────────
  let _busy = false;
  async function onGenerate() {
    if (_busy) return;
    if (!state.angleLocked && $('bh-angle').value) {
      // First generation also locks the angle
      state.angle = $('bh-angle').value;
      lockAngle();
    }
    const prompt = buildPrompt();
    const engine = state.engine;
    setBusy(true, '⏳ Submitting task to ' + engine + '…');

    try {
      const res = await fetch('/api/biroly/hands-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, engine, duration: 5, aspectRatio: '9:16' }),
      }).then(r => r.json());

      if (!res.success) throw new Error(res.error || 'Failed to submit');
      const taskId = res.taskId;
      setBusy(true, `⏳ Generating biroll (taskId ${taskId.slice(0, 8)}…)`);

      const final = await pollStatus(engine, taskId);
      if (!final || final.state !== 'success' || !final.videoPath) {
        throw new Error(final?.error || 'Generation failed');
      }

      const item = {
        ts: Date.now(),
        prompt,
        videoPath: final.videoPath,
        action: state.action,
        angle: state.angle,
        scene: state.scene,
        engine,
      };
      state.history.unshift(item);
      state.history = state.history.slice(0, 20);
      localStorage.setItem(STORAGE.history, JSON.stringify(state.history));

      showCurrent(item);
      renderHistory();
      setBusy(false, '✅ Biroll ready.');
    } catch (err) {
      console.error('[bh] generate error', err);
      setBusy(false, '❌ ' + (err.message || 'Unknown error'));
    }
  }

  function pollStatus(engine, taskId) {
    return new Promise((resolve) => {
      const start = Date.now();
      const TIMEOUT_MS = 8 * 60 * 1000;
      const tick = async () => {
        try {
          const r = await fetch(`/api/biroly/hands-status?engine=${encodeURIComponent(engine)}&taskId=${encodeURIComponent(taskId)}`)
            .then(x => x.json());
          if (!r.success) return resolve({ state: 'failed', error: r.error });
          if (r.state === 'success' || r.state === 'failed') return resolve(r);
          if (Date.now() - start > TIMEOUT_MS) return resolve({ state: 'failed', error: 'Timeout' });
          setTimeout(tick, 5000);
        } catch (e) {
          setTimeout(tick, 5000);
        }
      };
      tick();
    });
  }

  function setBusy(busy, msg) {
    _busy = busy;
    $('bh-generate-btn').disabled = busy;
    $('bh-generate-btn').style.opacity = busy ? '0.6' : '1';
    if (msg !== undefined) $('bh-status').textContent = msg;
  }

  // ── Preview / history ───────────────────────────────────────────────────────
  function showCurrent(item) {
    const v = $('bh-current-video');
    const empty = $('bh-current-empty');
    const cap = $('bh-current-caption');
    v.src = item.videoPath;
    v.style.display = 'block';
    empty.style.display = 'none';
    cap.textContent = `${item.action} · ${item.angle} · ${item.engine}`;
    try { v.play().catch(() => {}); } catch {}
  }

  function renderHistory() {
    const wrap = $('bh-history');
    wrap.innerHTML = '';
    if (!state.history.length) {
      wrap.innerHTML = '<div style="font-size:10px;color:#666;font-style:italic;">No previous birolls in this session</div>';
      return;
    }
    state.history.forEach((item, idx) => {
      // Skip the first one if it's already shown as current
      if (idx === 0 && $('bh-current-video').src && $('bh-current-video').src.includes(item.videoPath)) return;
      const row = document.createElement('div');
      row.className = 'bh-hist-item';
      const v = document.createElement('video');
      v.className = 'bh-hist-thumb';
      v.src = item.videoPath;
      v.muted = true; v.playsInline = true;
      const meta = document.createElement('div');
      meta.className = 'bh-hist-meta';
      const date = new Date(item.ts);
      meta.innerHTML = `<div><strong>${item.action}</strong></div><div>${item.angle} · ${item.engine}</div><div style="opacity:0.6;">${date.toLocaleTimeString()}</div>`;
      row.appendChild(v);
      row.appendChild(meta);
      row.addEventListener('click', () => showCurrent(item));
      wrap.appendChild(row);
    });
  }

  // ── Toggle visibility on Type=hands ─────────────────────────────────────────
  function applyMode(mode) {
    const isHands = mode === 'hands';
    const handsPanel = $('biroly-hands-panel');
    const brollPanel = $('l1-osnovnye');
    if (handsPanel) {
      handsPanel.style.display = isHands ? 'flex' : 'none';
      handsPanel.classList.toggle('active', isHands);
    }
    if (brollPanel) {
      // When hands mode is active, force-hide the b-roll 3-col panel even if it has .active class
      brollPanel.classList.toggle('active', !isHands);
    }
    if (isHands) ensureBoot();
  }

  function init() {
    const sel = $('biroly-mode-select');
    if (!sel) return;
    sel.addEventListener('change', e => applyMode(e.target.value));
    // Apply on first load
    applyMode(sel.value);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
